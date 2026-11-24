// A poll, kept by a Durable Object of its own: what it holds, who may
// read and change it, and when it closes and goes. The Worker in worker.js
// routes each call here; see there for the calls. Two objects are not
// polls: GATE counts what each address makes, and RESEARCH keeps the
// records closed polls give to research (common/site/research.js).
//
// The PIN is kept as a salted hash, and the admin and ballot keys as
// hashes. Each address may get a poll's PIN wrong five times before it
// waits ten minutes, and the poll takes fifty wrong PINs an hour from
// everywhere before it stops taking any until the hour is out. A poll is
// deleted 60 days after it last changed.
//
// workerd takes every name the Worker's main module exports for an entry
// point, so the constants the tests read live here, not there.

import {
  LIMITS, checkBallot, checkPoll, nameKey, newPinProblem, pinProblem, researchStatus,
} from '../../../common/site/poll-rules.js';
import { donationProblem, isToken } from '../../../common/site/research.js';
import { decide, tieKey } from '../../../common/site/social-choice.js';

const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long a poll is kept after it last changed.
export const KEEP = 60 * DAY;

// Wrong PINs one address may try on a poll before it waits IP_LOCK, and
// wrong PINs a poll takes in an hour from everywhere.
export const IP_TRIES = 5;
export const IP_LOCK = 10 * MINUTE;
export const POLL_TRIES = 50;

// Polls one address may try to make in an hour.
export const CREATES = 20;

// The object that counts new polls and records. No group ID can be this.
export const GATE = '~gate';

// The object that keeps the records given to research. No group ID can be
// this either.
export const RESEARCH = '~research';

// Records one export answers with at most.
export const EXPORT_PAGE = 500;

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function problem(status, error, message, extra = {}) {
  return { status, body: { error, message, ...extra } };
}

export const WRONG = '그룹 ID나 PIN이 맞지 않아요.';
export const SIGNED_OUT = problem(401, 'token', '투표가 지워졌거나 PIN이 바뀌었어요. 다시 들어와 주세요.');
const NOT_ADMIN = problem(403, 'admin', '투표를 만든 사람만 할 수 있어요. 관리 코드를 넣어 주세요.');
const CLOSED = problem(423, 'closed', '마감된 투표예요.');

// A random key of `bytes` bytes, in base64url.
function randomKey(bytes = 18) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A random whole number from 0 to n - 1, without modulo bias.
function randomBelow(n) {
  const limit = Math.floor(2 ** 32 / n) * n;
  const word = new Uint32Array(1);
  do crypto.getRandomValues(word); while (word[0] >= limit);
  return word[0] % n;
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Whether two strings are equal, taking as long whichever character
// differs.
export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const iso = (ms) => new Date(ms).toISOString();

// What the page may see of a poll and its ballots: no PIN hash and no
// keys, and until the poll closes who voted but not how, so that nobody
// votes by what the others did.
function view(poll, ballots) {
  const { id, kind, title, note, options, createdAt, deadline, closedAt, decision, expiresAt } = poll;
  // Whether it may go to research, and not which voter said what.
  const research = researchStatus(Boolean(poll.research), ballots.map((ballot) => ballot.research));
  return {
    poll: { id, kind, title, note, options, createdAt, deadline, closedAt, decision, expiresAt, research },
    ballots: ballots.map(({ id: ballotId, name, grades, at }) => ({
      id: ballotId, name, at, ...(closedAt && { grades }),
    })),
  };
}

// How long `key` must wait before trying another PIN, in ms, 0 for none.
function lockedFor(guard, key, now) {
  const ip = guard.ips[key];
  return Math.max(0, guard.window.until - now, ip ? ip.until - now : 0);
}

// Counts a wrong PIN from `key`, and gives how many more it may try.
function fail(guard, key, now) {
  const all = guard.window;
  if (now - all.start >= HOUR) Object.assign(all, { start: now, fails: 0, until: 0 });
  all.fails += 1;
  if (all.fails >= POLL_TRIES) all.until = all.start + HOUR;
  let ip = guard.ips[key];
  if (!ip || now - ip.at >= HOUR || (ip.until && ip.until <= now)) {
    ip = { fails: 0, at: now, until: 0 };
    guard.ips[key] = ip;
  }
  ip.fails += 1;
  ip.at = now;
  if (ip.fails >= IP_TRIES) ip.until = now + IP_LOCK;
  for (const [other, entry] of Object.entries(guard.ips)) {
    if (entry.until <= now && now - entry.at >= HOUR) delete guard.ips[other];
  }
  return Math.max(0, Math.min(IP_TRIES - ip.fails, POLL_TRIES - all.fails));
}

function lockedProblem(wait) {
  return problem(429, 'locked', `PIN을 여러 번 틀려서 잠겼어요. ${Math.ceil(wait / MINUTE)}분 뒤에 다시 해 주세요.`, {
    retryAfter: Math.ceil(wait / 1000),
  });
}

// One poll, or under the name GATE the count of polls each address makes.
export class Poll {
  constructor(state, env) {
    this.storage = state.storage;
    // Tests set the clock.
    this.now = env?.clock || Date.now;
    this.queue = Promise.resolve();
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    const input = await request.json();
    const { status, body } = await this.serialize(() => this.handle(action, input));
    return json(status, body);
  }

  async alarm() {
    await this.serialize(async () => {
      const poll = await this.storage.get('poll');
      if (!poll) return;
      const expires = Date.parse(poll.expiresAt);
      if (expires <= this.now()) await this.storage.deleteAll();
      else await this.storage.setAlarm(expires);
    });
  }

  // Runs `task` after every task before it, so that what one call reads
  // no other call changes before it writes, however long it waits on a hash.
  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async save(poll, ballots, now) {
    poll.expiresAt = iso(now + KEEP);
    await this.storage.put({ poll, ballots });
    await this.storage.setAlarm(now + KEEP);
  }

  decisionOf(poll, ballots) {
    return decide(poll.kind, ballots, poll.options.length, poll.draws || {});
  }

  // Closes a poll whose deadline has passed; says whether it did.
  settle(poll, ballots, now) {
    if (poll.closedAt || !poll.deadline || Date.parse(poll.deadline) > now) return false;
    poll.closedAt = poll.deadline;
    poll.decision = this.decisionOf(poll, ballots);
    return true;
  }

  async handle(action, input) {
    const now = this.now();
    if (action === 'gate') return this.gate(input, now);
    if (action === 'create') return this.create(input, now);
    if (action === 'donate') return this.donate(input, now);
    if (action === 'withdraw') return this.withdraw(input);
    if (action === 'donations') return this.donations(input);
    const poll = await this.storage.get('poll');
    if (!poll) return action === 'enter' ? problem(401, 'wrong', WRONG) : SIGNED_OUT;
    if (action === 'enter') return this.enter(poll, input, now);

    const { token, adminKey } = input.auth;
    const admin = typeof adminKey === 'string' && adminKey !== '' && sameText(await sha256(adminKey), poll.adminHash);
    if (!admin && !sameText(token, poll.memberToken)) return SIGNED_OUT;
    const ballots = (await this.storage.get('ballots')) || [];
    if (this.settle(poll, ballots, now)) await this.save(poll, ballots, now);

    switch (action) {
      case 'get':
        return { status: 200, body: view(poll, ballots) };
      case 'vote':
        return this.vote(poll, ballots, input, now, admin);
      case 'unvote':
        return this.unvote(poll, ballots, input, now, admin);
      case 'close':
        if (!admin) return NOT_ADMIN;
        if (!poll.closedAt) {
          poll.closedAt = iso(now);
          poll.decision = this.decisionOf(poll, ballots);
          await this.save(poll, ballots, now);
        }
        return { status: 200, body: view(poll, ballots) };
      case 'draw': {
        // The maker's roulette among the options level at the top: drawn
        // here, once for each set of them, so that neither the moment the
        // wheel is stopped nor closing again draws another.
        if (!admin) return NOT_ADMIN;
        if (!poll.closedAt) return problem(409, 'open', '마감한 뒤에 룰렛을 돌릴 수 있어요.');
        if (poll.decision?.pending) {
          const { tied } = poll.decision;
          poll.draws = { ...poll.draws, [tieKey(tied)]: tied[randomBelow(tied.length)] };
          poll.decision = this.decisionOf(poll, ballots);
          await this.save(poll, ballots, now);
        }
        return { status: 200, body: view(poll, ballots) };
      }
      case 'reopen':
        if (!admin) return NOT_ADMIN;
        if (poll.closedAt) {
          poll.closedAt = null;
          poll.decision = null;
          if (poll.deadline && Date.parse(poll.deadline) <= now) poll.deadline = null;
          await this.save(poll, ballots, now);
        }
        return { status: 200, body: view(poll, ballots) };
      case 'delete':
        if (!admin) return NOT_ADMIN;
        await this.storage.deleteAlarm();
        await this.storage.deleteAll();
        return { status: 200, body: { deleted: true } };
      default:
        return problem(404, 'route', '없는 요청이에요.');
    }
  }

  async gate({ key, what = 'create' }, now) {
    const counts = (await this.storage.get('gate')) || {};
    for (const [other, entry] of Object.entries(counts)) {
      if (now - entry.start >= HOUR) delete counts[other];
    }
    const entry = counts[key] || { start: now, count: 0 };
    if (entry.count >= CREATES) {
      const message = what === 'donate'
        ? '여기서 연구용 기록을 너무 많이 보냈어요. 한 시간쯤 뒤에 다시 해 주세요.'
        : '여기서 투표를 너무 많이 만들었어요. 한 시간쯤 뒤에 다시 해 주세요.';
      return problem(429, 'busy', message, {
        retryAfter: Math.ceil((entry.start + HOUR - now) / 1000),
      });
    }
    entry.count += 1;
    counts[key] = entry;
    await this.storage.put('gate', counts);
    return { status: 200, body: { ok: true } };
  }

  async create({ id, body }, now) {
    if (await this.storage.get('poll')) {
      return problem(409, 'taken', '이미 쓰고 있는 그룹 ID예요. 다른 ID를 정해 주세요.', { field: 'id' });
    }
    const pinError = newPinProblem(body.pin);
    if (pinError) return problem(400, 'invalid', pinError, { field: 'pin' });
    const checked = checkPoll(body, now);
    if (checked.problem) return problem(400, 'invalid', checked.problem);
    const salt = randomKey(16);
    const adminKey = randomKey();
    const poll = {
      v: 1,
      id,
      ...checked.poll,
      createdAt: iso(now),
      closedAt: null,
      decision: null,
      pinSalt: salt,
      pinHash: await sha256(`${salt}:${body.pin}`),
      memberToken: randomKey(),
      adminHash: await sha256(adminKey),
      // What the maker's roulette drew, by the options it was spun among.
      draws: {},
    };
    await this.save(poll, [], now);
    return { status: 201, body: { token: poll.memberToken, adminKey, ...view(poll, []) } };
  }

  async enter(poll, { body, key }, now) {
    const guard = (await this.storage.get('guard')) || { ips: {}, window: { start: 0, fails: 0, until: 0 } };
    const wait = lockedFor(guard, key, now);
    if (wait > 0) return lockedProblem(wait);
    const { pin } = body;
    const right = !pinProblem(pin) && sameText(await sha256(`${poll.pinSalt}:${pin}`), poll.pinHash);
    if (!right) {
      const left = fail(guard, key, now);
      await this.storage.put('guard', guard);
      if (left === 0) return lockedProblem(lockedFor(guard, key, now));
      return problem(401, 'wrong', `${WRONG} ${left}번 더 틀리면 잠시 잠겨요.`, { left });
    }
    if (guard.ips[key]) {
      delete guard.ips[key];
      await this.storage.put('guard', guard);
    }
    const ballots = (await this.storage.get('ballots')) || [];
    if (this.settle(poll, ballots, now)) await this.save(poll, ballots, now);
    return { status: 200, body: { token: poll.memberToken, ...view(poll, ballots) } };
  }

  async vote(poll, ballots, { body, auth }, now, admin) {
    if (poll.closedAt) return CLOSED;
    const checked = checkBallot(body, poll);
    if (checked.problem) return problem(400, 'invalid', checked.problem);
    const { name, grades, research } = checked.ballot;
    let mine = null;
    if (typeof body.ballotId === 'string' && body.ballotId !== '') {
      mine = ballots.find((ballot) => ballot.id === body.ballotId);
      if (!mine) return problem(404, 'ballot', '고치려던 투표가 지워졌어요. 새로 투표해 주세요.');
      const owner = typeof auth.ballotKey === 'string' && sameText(await sha256(auth.ballotKey), mine.keyHash);
      if (!owner && !admin) return problem(403, 'ballot-key', '이 기기에서 한 투표가 아니라서 고칠 수 없어요.');
    }
    if (ballots.some((ballot) => ballot !== mine && nameKey(ballot.name) === nameKey(name))) {
      return problem(409, 'name', '같은 이름으로 한 투표가 이미 있어요. 내 투표라면 처음 투표한 기기에서 고치거나, 투표를 만든 사람에게 지워 달라고 하세요.', {
        field: 'name',
      });
    }
    let ballotKey;
    if (mine) {
      Object.assign(mine, { name, grades, research, at: iso(now) });
    } else {
      if (ballots.length >= LIMITS.ballots) {
        return problem(409, 'full', `한 투표에는 ${LIMITS.ballots}명까지 참여할 수 있어요.`);
      }
      ballotKey = randomKey();
      mine = { id: randomKey(9), name, grades, research, keyHash: await sha256(ballotKey), at: iso(now) };
      ballots.push(mine);
    }
    await this.save(poll, ballots, now);
    return { status: 200, body: { ballotId: mine.id, ...(ballotKey && { ballotKey }), ...view(poll, ballots) } };
  }

  async unvote(poll, ballots, { ballotId, auth }, now, admin) {
    if (poll.closedAt) return CLOSED;
    const index = ballots.findIndex((ballot) => ballot.id === ballotId);
    if (index < 0) return problem(404, 'ballot', '이미 지워진 투표예요.');
    const owner = typeof auth.ballotKey === 'string' && sameText(await sha256(auth.ballotKey), ballots[index].keyHash);
    if (!owner && !admin) return problem(403, 'ballot-key', '내 투표나, 투표를 만든 사람만 지울 수 있어요.');
    ballots.splice(index, 1);
    await this.save(poll, ballots, now);
    return { status: 200, body: view(poll, ballots) };
  }

  // A closed poll's record for research, kept under the random ID its
  // maker's phone sent it under with the hash of its key, and the month it
  // came: sent again under the same ID and key, it replaces what was kept.
  async donate({ body }, now) {
    const { id, key, record } = body;
    if (!isToken(id) || !isToken(key) || donationProblem(record)) {
      return problem(400, 'invalid', '연구용 기록을 읽지 못했어요.');
    }
    const name = `d:${id}`;
    const had = await this.storage.get(name);
    if (had && !sameText(await sha256(key), had.keyHash)) {
      return problem(409, 'taken', '같은 이름의 연구용 기록이 이미 있어요.');
    }
    const month = had?.month || iso(now).slice(0, 7);
    await this.storage.put(name, { keyHash: had?.keyHash || await sha256(key), month, record });
    return { status: had ? 200 : 201, body: { kept: true } };
  }

  // Takes back a record, with the key it was sent with.
  async withdraw({ id, key }) {
    const name = `d:${id}`;
    const had = isToken(id) ? await this.storage.get(name) : null;
    if (!had) return problem(404, 'gone', '이미 지워진 연구용 기록이에요.');
    if (!sameText(await sha256(key || ''), had.keyHash)) return problem(403, 'key', '이 기기에서 보낸 기록이 아니라서 지울 수 없어요.');
    await this.storage.delete(name);
    return { status: 200, body: { deleted: true } };
  }

  // The records, EXPORT_PAGE at a time in the order of their IDs, each
  // without its key's hash; `after` is the ID the last page ended with.
  async donations({ after }) {
    const start = isToken(after) ? { startAfter: `d:${after}` } : {};
    const found = await this.storage.list({ prefix: 'd:', limit: EXPORT_PAGE + 1, ...start });
    const records = [...found].map(([name, { month, record }]) => ({ id: name.slice(2), month, record }));
    const more = records.length > EXPORT_PAGE;
    const page = records.slice(0, EXPORT_PAGE);
    return { status: 200, body: { donations: page, next: more ? page[page.length - 1].id : null } };
  }
}
