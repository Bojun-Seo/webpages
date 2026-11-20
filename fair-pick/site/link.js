// Polls kept in links rather than on a server, for when the page has no API.
//
// The poll and every ballot this device has seen go into the fragment of a
// link (after #, which a browser never sends to the site), compressed and
// sealed with AES-GCM under a key drawn from the group ID and the PIN with
// PBKDF2, so the link reads as noise to anyone without both. Each voter's
// link carries what they had seen and their own ballot; opening any link
// adds what it carries to what this device keeps. Ballots merge by their
// own ID, the newer change winning, and a ballot taken out stays out, so
// it does not matter in what order the links are opened, nor how often.
//
// The maker's device draws a seed when the poll is made and puts only its
// hash in the poll; closing the poll shows the seed, which orders a draw
// between options level at the top. Every device checks the seed against
// the hash, so the maker cannot draw again.
//
// Nothing here imports ../common/, whose path differs in a browser and in
// Node; the page hands in the poll rules and the decision.

export const VERSION = 1;

// PBKDF2 rounds for the key: slow enough that guessing PINs costs time,
// quick enough for a phone. Tests pass fewer.
export const ITERATIONS = 600_000;

// The most a link's poll may unpack to, so that no link can fill memory.
const MAX_STATE = 1 << 20;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class LinkError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = { error: code, message, ...extra };
  }
}

export function toBase64Url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function randomId(bytes) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Unpacks `bytes`, refusing to go past MAX_STATE.
async function inflate(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_STATE) {
      await reader.cancel();
      throw new Error('too big');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// The key a poll's links are sealed with, from its group ID as normalizeId
// gives it, the PIN and the poll's own random ID.
export async function deriveKey(id, pin, uid, iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(`${id}\n${pin}`), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(`fair-pick:${uid}`), iterations },
    material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

export async function exportKey(key) {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export function importKey(text) {
  return crypto.subtle.importKey('raw', fromBase64Url(text), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// What a sealed poll is bound to, so that a payload cannot pass for
// another poll's.
const boundTo = (uid) => encoder.encode(`fair-pick:${VERSION}:${uid}`);

// A payload, "1.<uid>.<sealed>", that carries `state`.
export async function seal(state, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await deflate(encoder.encode(JSON.stringify(state)));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: boundTo(state.uid) }, key, packed,
  ));
  const body = new Uint8Array(iv.length + sealed.length);
  body.set(iv);
  body.set(sealed, iv.length);
  return `${VERSION}.${state.uid}.${toBase64Url(body)}`;
}

// The state a payload carries; throws when `key` is not its key or the
// payload was changed.
export async function unseal(payload, key) {
  const [version, uid, data] = payload.split('.');
  if (Number(version) !== VERSION || !uid || !data) throw new Error('not a payload');
  const body = fromBase64Url(data);
  const packed = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: body.slice(0, 12), additionalData: boundTo(uid) }, key, body.slice(12),
  );
  const state = JSON.parse(decoder.decode(await inflate(new Uint8Array(packed))));
  if (state?.uid !== uid) throw new Error('not this poll');
  return state;
}

const PAYLOAD = /(?:^|[#\s/])(1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{40,}))/g;

// The payloads in `text`, a link or a fragment, or many links pasted
// together: [{ payload, uid }], each once.
export function payloadsIn(text) {
  const found = new Map();
  for (const match of String(text).matchAll(PAYLOAD)) found.set(match[1], { payload: match[1], uid: match[2] });
  return [...found.values()];
}

// Whether `a` is a later change than `b`: the later time, and of two at the
// same moment the one whose text sorts last, so every device agrees.
function newer(a, b, time = 't') {
  if (a[time] !== b[time]) return a[time] > b[time];
  return JSON.stringify(a) > JSON.stringify(b);
}

const byTime = (a, b) => a.t - b.t || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0);

// Two states of one poll as one: its definition as `base` has it, each
// ballot's latest change, the latest open or close, and the seed if either
// shows it. The same however many times and in whatever order.
export function merge(base, other) {
  if (base.uid !== other.uid) throw new Error('not the same poll');
  const ballots = new Map(base.ballots.map((ballot) => [ballot.i, ballot]));
  for (const ballot of other.ballots) {
    const had = ballots.get(ballot.i);
    if (!had || newer(ballot, had)) ballots.set(ballot.i, ballot);
  }
  return {
    ...base,
    status: newer(other.status, base.status, 'at') ? other.status : base.status,
    seed: base.seed || other.seed || null,
    ballots: [...ballots.values()].sort(byTime),
  };
}

// The ballots that count: those not taken out, and of several under one
// name, as two devices may cast before either sees the other's, the latest.
export function counted(state, nameKey) {
  const byName = new Map();
  for (const ballot of state.ballots) {
    if (ballot.x) continue;
    const key = nameKey(ballot.n);
    const had = byName.get(key);
    if (!had || newer(ballot, had)) byName.set(key, ballot);
  }
  return [...byName.values()].sort(byTime);
}

// The names more than one ballot not taken out is cast under.
export function sameNames(state, nameKey) {
  const seen = new Map();
  for (const ballot of state.ballots) {
    if (ballot.x) continue;
    const key = nameKey(ballot.n);
    seen.set(key, [...(seen.get(key) || []), ballot.n]);
  }
  return [...seen.values()].filter((names) => names.length > 1).map((names) => names[names.length - 1]);
}

// When the poll closed, in ms: when its maker closed it, or its deadline,
// unless its maker opened it again after; null while it is open.
export function closedAt(state, now) {
  if (state.status.closed) return state.status.at;
  const deadline = state.deadline ? Date.parse(state.deadline) : null;
  if (deadline !== null && now >= deadline && state.status.at < deadline) return deadline;
  return null;
}

// The order a draw takes between options level at the top: the options
// sorted by the hash of the seed and each option's place.
export async function tieOrderOf(seed, count) {
  const keyed = await Promise.all(Array.from({ length: count }, async (_, index) => [await sha256Hex(`${seed}:${index}`), index]));
  return keyed.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, index]) => index);
}

// `state` as it arrived in a link, checked: its poll whole, and of its
// ballots only those that fit it. Throws when the poll does not hold up.
export function checked(state, { KINDS, LIMITS, SCALES, isDate }) {
  const fail = () => {
    throw new Error('not a poll');
  };
  if (!state || state.v !== VERSION || typeof state.uid !== 'string' || typeof state.id !== 'string') fail();
  if (!KINDS.includes(state.kind) || typeof state.title !== 'string' || !state.title) fail();
  const { options } = state;
  if (!Array.isArray(options) || options.length < LIMITS.minOptions || options.length > LIMITS.options[state.kind]) fail();
  const fits = state.kind === 'date'
    ? options.every((option) => isDate(option?.date))
    : options.every((option) => typeof option?.label === 'string' && option.label !== '');
  if (!fits) fail();
  if (state.deadline !== null && Number.isNaN(Date.parse(state.deadline))) fail();
  if (!/^[0-9a-f]{64}$/.test(state.seedHash) || typeof state.status?.closed !== 'boolean') fail();
  if (!Number.isFinite(state.status.at)) fail();
  const top = SCALES[state.kind].grades.length - 1;
  const grades = new RegExp(`^[0-${top}]{${options.length}}$`);
  const ballots = (Array.isArray(state.ballots) ? state.ballots : []).filter((ballot) => (
    typeof ballot?.i === 'string' && Number.isFinite(ballot.t)
    && (ballot.x === 1 || (typeof ballot.n === 'string' && ballot.n !== '' && [...ballot.n].length <= LIMITS.name
      && grades.test(ballot.g)))));
  return {
    v: VERSION,
    uid: state.uid,
    id: state.id,
    kind: state.kind,
    title: state.title,
    note: typeof state.note === 'string' ? state.note : '',
    options: options.map((option) => (state.kind === 'date' ? { date: option.date } : { label: option.label })),
    deadline: state.deadline,
    createdAt: state.createdAt,
    seedHash: state.seedHash,
    status: { closed: state.status.closed, at: state.status.at },
    seed: typeof state.seed === 'string' ? state.seed : null,
    ballots: ballots.slice(0, LIMITS.ballots * 3).map(({ i, n, g, t, x }) => (x === 1 ? { i, t, x } : { i, n, g, t })),
  };
}

const iso = (ms) => new Date(ms).toISOString();

// `state` without a seed that does not match the hash its poll was made
// with, which only the maker's seed does.
async function trusted(state) {
  if (state.seed && await sha256Hex(state.seed) !== state.seedHash) return { ...state, seed: null };
  return state;
}

// A client that does what api.js's does, with every poll kept on this
// device and passed on in links. `rules` is common's poll-rules.js and
// calendar.js together, `decide` common's social-choice.js's, `storage`
// { read(), write(polls) } of this device's polls by group ID, each
// { uid, key, state }.
export function createLinkClient({ rules, decide, storage, now = Date.now, iterations = ITERATIONS }) {
  const polls = () => storage.read() || {};
  const keep = (id, record) => storage.write({ ...polls(), [id]: record });
  const kept = (id) => {
    const record = polls()[id];
    if (!record) throw new LinkError(401, 'token', '이 기기에 없는 투표예요. 단톡방에서 받은 투표 링크를 다시 열어 주세요.');
    return record;
  };
  const isMaker = async (state, adminKey) => (
    typeof adminKey === 'string' && adminKey !== '' && await sha256Hex(adminKey) === state.seedHash);
  // A change made here is later than anything this device has seen of it,
  // even with its clock behind another's.
  const after = (time) => Math.max(now(), time + 1);

  async function view(id, extra = {}) {
    const { state } = polls()[id];
    const shut = closedAt(state, now());
    const ballots = counted(state, rules.nameKey).map((ballot) => ({
      id: ballot.i, name: ballot.n, grades: [...ballot.g].map(Number), at: iso(ballot.t),
    }));
    let decision = null;
    if (shut !== null && ballots.length > 0) {
      const top = rules.SCALES[state.kind].grades.length - 1;
      const order = state.seed ? await tieOrderOf(state.seed, state.options.length) : [];
      decision = decide(ballots, state.options.length, top, order);
      // Level at the top, and the maker has not shown the seed yet.
      if (decision.drawn && !state.seed) decision = { index: null, tied: decision.tied, drawn: false, pending: true };
    }
    const { kind, title, note, options, createdAt, deadline } = state;
    return {
      poll: { id, kind, title, note, options, createdAt, deadline, closedAt: shut === null ? null : iso(shut), decision },
      ballots,
      sameNames: sameNames(state, rules.nameKey),
      ...extra,
    };
  }

  // Adds the polls of the payloads in `text` this device keeps: for each,
  // { id, added }, how many ballots were new or changed.
  async function absorb(text) {
    const out = [];
    for (const { payload, uid } of payloadsIn(text)) {
      const entry = Object.entries(polls()).find(([, record]) => record.uid === uid);
      if (!entry) continue;
      const [id, record] = entry;
      let incoming;
      try {
        incoming = checked(await unseal(payload, await importKey(record.key)), rules);
      } catch {
        continue;
      }
      const state = await trusted(merge(record.state, incoming));
      const before = new Map(record.state.ballots.map((ballot) => [ballot.i, JSON.stringify(ballot)]));
      const added = state.ballots.filter((ballot) => before.get(ballot.i) !== JSON.stringify(ballot)).length;
      keep(id, { ...record, state });
      out.push({ id, added });
    }
    return out;
  }

  return {
    links: true,
    absorb,

    // The payload that carries everything this device has of the poll.
    async linkOf(id) {
      const { state, key } = kept(id);
      return seal(state, await importKey(key));
    },

    async create(input) {
      const id = rules.normalizeId(input.id);
      const idError = rules.idProblem(id);
      if (idError) throw new LinkError(400, 'invalid', idError, { field: 'id' });
      const pinError = rules.newPinProblem(input.pin);
      if (pinError) throw new LinkError(400, 'invalid', pinError, { field: 'pin' });
      const result = rules.checkPoll(input, now());
      if (result.problem) throw new LinkError(400, 'invalid', result.problem);
      if (polls()[id]) {
        throw new LinkError(409, 'taken', '이 기기에 같은 그룹 ID로 만든 투표가 있어요. 다른 ID를 정해 주세요.', { field: 'id' });
      }
      const uid = randomId(12);
      const seed = randomId(16);
      const state = {
        v: VERSION, uid, id, ...result.poll, createdAt: iso(now()), seedHash: await sha256Hex(seed),
        status: { closed: false, at: now() }, seed: null, ballots: [],
      };
      const key = await deriveKey(id, input.pin, uid, iterations);
      keep(id, { uid, key: await exportKey(key), state });
      return { token: 'link', adminKey: seed, ...await view(id) };
    },

    // A poll this device keeps, by its group ID and PIN.
    async enter(rawId, pin) {
      const id = rules.normalizeId(rawId);
      const record = polls()[id];
      if (!record) {
        throw new LinkError(404, 'unknown', '이 기기에는 이 투표가 없어요. 단톡방에서 받은 투표 링크를 열어 주세요.');
      }
      if (await exportKey(await deriveKey(id, pin, record.uid, iterations)) !== record.key) {
        throw new LinkError(401, 'wrong', '그룹 ID나 PIN이 맞지 않아요.');
      }
      return { token: 'link', ...await view(id) };
    },

    // A link's poll, opened with its group ID and PIN: kept from now on, or
    // added to what this device keeps of it.
    async open(payload, rawId, pin) {
      const id = rules.normalizeId(rawId);
      const problem = rules.idProblem(id) || rules.pinProblem(pin);
      if (problem) throw new LinkError(400, 'invalid', problem);
      const [found] = payloadsIn(payload);
      if (!found) throw new LinkError(400, 'invalid', '투표 링크가 아니에요. 받은 링크를 그대로 열어 주세요.');
      const key = await deriveKey(id, pin, found.uid, iterations);
      let incoming;
      try {
        incoming = checked(await unseal(found.payload, key), rules);
      } catch {
        throw new LinkError(401, 'wrong', '그룹 ID나 PIN이 맞지 않아요.');
      }
      const record = polls()[id];
      if (record && record.uid !== found.uid) {
        throw new LinkError(409, 'other', '이 기기에 같은 그룹 ID의 다른 투표가 있어요. 그 투표를 이 기기에서 잊은 뒤 다시 열어 주세요.');
      }
      const state = await trusted(record ? merge(record.state, incoming) : incoming);
      keep(id, { uid: found.uid, key: record?.key || await exportKey(key), state });
      return { token: 'link', ...await view(id) };
    },

    // The poll as this device has it. The maker's device shows the seed
    // once the deadline has passed, which the next link carries.
    async load(id, auth = {}) {
      const record = kept(id);
      const { state } = record;
      if (auth.adminKey && !await isMaker(state, auth.adminKey)) {
        throw new LinkError(401, 'token', '관리 코드가 맞지 않아요.');
      }
      if (auth.adminKey && !state.seed && closedAt(state, now()) !== null) {
        keep(id, { ...record, state: { ...state, seed: auth.adminKey } });
        return view(id, { changed: true });
      }
      return view(id);
    },

    async vote(id, auth, input) {
      const record = kept(id);
      const { state } = record;
      if (closedAt(state, now()) !== null) throw new LinkError(423, 'closed', '마감된 투표예요.');
      const result = rules.checkBallot(input, state);
      if (result.problem) throw new LinkError(400, 'invalid', result.problem);
      const { name, grades } = result.ballot;
      const live = counted(state, rules.nameKey);
      let mine = null;
      if (input.ballotId) {
        mine = state.ballots.find((ballot) => ballot.i === input.ballotId && !ballot.x);
        if (!mine) throw new LinkError(404, 'ballot', '고치려던 투표가 지워졌어요. 새로 투표해 주세요.');
        if (!auth.ballotKey && !await isMaker(state, auth.adminKey)) {
          throw new LinkError(403, 'ballot-key', '이 기기에서 한 투표가 아니라서 고칠 수 없어요.');
        }
      }
      if (live.some((ballot) => ballot.i !== mine?.i && rules.nameKey(ballot.n) === rules.nameKey(name))) {
        throw new LinkError(409, 'name', '같은 이름으로 한 투표가 이미 있어요. 내 투표라면 처음 투표한 기기에서 고치거나, 투표를 만든 사람에게 지워 달라고 하세요.', {
          field: 'name',
        });
      }
      if (!mine && live.length >= rules.LIMITS.ballots) {
        throw new LinkError(409, 'full', `한 투표에는 ${rules.LIMITS.ballots}명까지 참여할 수 있어요.`);
      }
      const ballot = { i: mine ? mine.i : randomId(6), n: name, g: grades.join(''), t: after(mine ? mine.t : 0) };
      const ballots = [...state.ballots.filter((one) => one.i !== ballot.i), ballot].sort(byTime);
      keep(id, { ...record, state: { ...state, ballots } });
      return { ballotId: ballot.i, ...(mine ? {} : { ballotKey: 'own' }), ...await view(id) };
    },

    async unvote(id, auth, ballotId) {
      const record = kept(id);
      const { state } = record;
      if (closedAt(state, now()) !== null) throw new LinkError(423, 'closed', '마감된 투표예요.');
      const ballot = state.ballots.find((one) => one.i === ballotId && !one.x);
      if (!ballot) throw new LinkError(404, 'ballot', '이미 지워진 투표예요.');
      if (!auth.ballotKey && !await isMaker(state, auth.adminKey)) {
        throw new LinkError(403, 'ballot-key', '내 투표나, 투표를 만든 사람만 지울 수 있어요.');
      }
      const gone = { i: ballot.i, t: after(ballot.t), x: 1 };
      const ballots = [...state.ballots.filter((one) => one.i !== ballot.i), gone].sort(byTime);
      keep(id, { ...record, state: { ...state, ballots } });
      return view(id);
    },

    async close(id, auth) {
      const record = kept(id);
      const { state } = record;
      if (!await isMaker(state, auth.adminKey)) {
        throw new LinkError(403, 'admin', '투표를 만든 사람만 할 수 있어요. 관리 코드를 넣어 주세요.');
      }
      // Closing shows the seed; a poll its deadline closed keeps that time.
      let next = state;
      if (closedAt(state, now()) === null) next = { ...next, status: { closed: true, at: after(state.status.at) } };
      if (!next.seed) next = { ...next, seed: auth.adminKey };
      if (next !== state) keep(id, { ...record, state: next });
      return view(id);
    },

    async reopen(id, auth) {
      const record = kept(id);
      const { state } = record;
      if (!await isMaker(state, auth.adminKey)) {
        throw new LinkError(403, 'admin', '투표를 만든 사람만 할 수 있어요. 관리 코드를 넣어 주세요.');
      }
      if (closedAt(state, now()) !== null) {
        keep(id, { ...record, state: { ...state, status: { closed: false, at: after(Math.max(state.status.at, now())) } } });
      }
      return view(id);
    },

    // Forgets the poll on this device; the links others have keep it.
    async remove(id) {
      const all = polls();
      delete all[id];
      storage.write(all);
      return { deleted: true };
    },
  };
}
