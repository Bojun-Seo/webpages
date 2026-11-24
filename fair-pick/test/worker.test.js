import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../api/src/worker.js';
import { CREATES, EXPORT_PAGE, IP_LOCK, IP_TRIES, KEEP, POLL_TRIES } from '../api/src/poll.js';
import { RESEARCH_IN, RESEARCH_OUT } from '../../common/site/poll-rules.js';
import { memoryEnv } from '../api/memory.js';

const ORIGIN = 'https://bojun-seo.github.io';
const START = Date.parse('2026-11-20T01:00:00Z');

// A Worker on memory whose clock the test moves, and a way to call it as
// the page would.
function setup(vars = {}) {
  const clock = { now: START };
  const env = memoryEnv({ ALLOWED_ORIGINS: ORIGIN, clock: () => clock.now, ...vars });
  async function call(method, path, { body, token, admin, ballotKey, donationKey, ip = '203.0.113.7', origin = ORIGIN } = {}) {
    const headers = { origin, 'cf-connecting-ip': ip };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (admin) headers['x-admin-key'] = admin;
    if (ballotKey) headers['x-ballot-key'] = ballotKey;
    if (donationKey) headers['x-donation-key'] = donationKey;
    const res = await worker.fetch(new Request(`https://api.test${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
  }
  return { clock, env, call };
}

const DINNER = {
  id: 'Team Dinner',
  pin: '482915',
  kind: 'date',
  title: '12월 팀 회식',
  note: '저녁 7시',
  options: ['2026-12-03', '2026-12-04', '2026-12-10'],
};

async function made(props = {}) {
  const t = setup();
  const res = await t.call('POST', '/polls', { body: { ...DINNER, ...props } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...t, ...res.body };
}

test('a poll is made under its group ID, which no second poll can take', async () => {
  const { call, token, adminKey, poll, ballots } = await made();
  assert.equal(poll.id, 'team-dinner');
  assert.deepEqual(poll.options.map((option) => option.date), DINNER.options);
  assert.deepEqual(ballots, []);
  assert.ok(token.length >= 20 && adminKey.length >= 20);
  // Nothing secret goes to the page.
  for (const secret of ['pinHash', 'pinSalt', 'memberToken', 'adminHash', 'draws']) assert.ok(!(secret in poll), secret);

  const again = await call('POST', '/polls', { body: { ...DINNER, id: 'team-dinner' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'taken');
});

test('a poll is turned down with what is wrong with it', async () => {
  const { call } = setup();
  const bad = async (props) => (await call('POST', '/polls', { body: { ...DINNER, ...props } })).body;
  assert.match((await bad({ id: 'ab' })).message, /4~30자/);
  assert.equal((await bad({ id: 'ab' })).field, 'id');
  assert.match((await bad({ pin: '1234' })).message, /쉽게 맞힐/);
  assert.match((await bad({ options: ['2026-11-01', '2026-12-01'] })).message, /지난 날짜/);
  assert.match((await bad({ title: ' ' })).message, /제목/);
  const notJson = await worker.fetch(new Request('https://api.test/polls', {
    method: 'POST', body: '{', headers: { origin: ORIGIN },
  }), setup().env);
  assert.equal(notJson.status, 400);
  const huge = await call('POST', '/polls', { body: { ...DINNER, note: 'x'.repeat(20000) } });
  assert.equal(huge.status, 413);
});

test('the PIN lets a member in, and a wrong one is counted', async () => {
  const { call } = await made();
  const ok = await call('POST', '/polls/team-dinner/enter', { body: { pin: '482915' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.poll.title, '12월 팀 회식');

  // The ID may be typed as it was made.
  assert.equal((await call('POST', `/polls/${encodeURIComponent('Team Dinner')}/enter`, { body: { pin: '482915' } })).status, 200);

  const wrong = await call('POST', '/polls/team-dinner/enter', { body: { pin: '000000' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'wrong');
  assert.equal(wrong.body.left, IP_TRIES - 1);
});

test('a poll that does not exist answers like a wrong PIN, and keeps nothing', async () => {
  const { call, env } = setup();
  const res = await call('POST', '/polls/no-such-poll/enter', { body: { pin: '482915' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'wrong');
  assert.equal(res.body.left, undefined);
  assert.equal(env.POLLS.objects.get('no-such-poll').storage.data.size, 0);
  assert.equal((await call('POST', '/polls/x/enter', { body: { pin: '482915' } })).body.error, 'wrong');
});

test('an address that keeps getting the PIN wrong waits, and others do not', async () => {
  const { call, clock } = await made();
  const enter = (pin, ip) => call('POST', '/polls/team-dinner/enter', { body: { pin }, ip });
  for (let i = 1; i < IP_TRIES; i++) assert.equal((await enter('111222', '198.51.100.1')).status, 401);
  const locked = await enter('111222', '198.51.100.1');
  assert.equal(locked.status, 429);
  assert.equal(locked.body.retryAfter, IP_LOCK / 1000);
  // Even the right PIN waits, or guessing would go on.
  assert.equal((await enter('482915', '198.51.100.1')).status, 429);
  // Another address gets in.
  assert.equal((await enter('482915', '198.51.100.2')).status, 200);
  clock.now += IP_LOCK;
  assert.equal((await enter('482915', '198.51.100.1')).status, 200);
});

test('a poll stops taking PINs for the hour once it has seen too many wrong ones', async () => {
  const { call, clock } = await made();
  let last;
  for (let i = 0; i < POLL_TRIES; i++) {
    last = await call('POST', '/polls/team-dinner/enter', { body: { pin: '111222' }, ip: `10.0.${i}.1` });
  }
  assert.equal(last.status, 429);
  assert.equal((await call('POST', '/polls/team-dinner/enter', { body: { pin: '482915' }, ip: '10.9.9.9' })).status, 429);
  clock.now += 3600e3;
  assert.equal((await call('POST', '/polls/team-dinner/enter', { body: { pin: '482915' }, ip: '10.9.9.9' })).status, 200);
});

test('only the token or the admin key reads a poll', async () => {
  const { call, token, adminKey } = await made();
  assert.equal((await call('GET', '/polls/team-dinner')).status, 401);
  assert.equal((await call('GET', '/polls/team-dinner', { token: 'x'.repeat(24) })).status, 401);
  assert.equal((await call('GET', '/polls/team-dinner', { token })).status, 200);
  assert.equal((await call('GET', '/polls/team-dinner', { admin: adminKey })).status, 200);
  assert.equal((await call('GET', '/polls/ab', { token })).status, 401);
});

test('a voter votes by name, changes it with the key their device keeps, and no one else can', async () => {
  const { call, token } = await made();
  const first = await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '김민수', grades: [2, 1, 0] } });
  assert.equal(first.status, 200);
  const { ballotId, ballotKey } = first.body;
  assert.ok(ballotId && ballotKey);
  // Until the poll closes, who voted shows but not how.
  assert.deepEqual(first.body.ballots, [{ id: ballotId, name: '김민수', at: first.body.ballots[0].at }]);

  // Someone else under the same name is turned away.
  const clash = await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: ' 김민수 ', grades: [0, 0, 0] } });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'name');
  // So is a change without the key.
  const stolen = await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '김민수', grades: [0, 0, 0], ballotId } });
  assert.equal(stolen.status, 403);

  const changed = await call('PUT', '/polls/team-dinner/ballot', {
    token, ballotKey, body: { name: '김민수', grades: [2, 2, 2], ballotId },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.ballotKey, undefined);
  assert.deepEqual(changed.body.ballots.map((ballot) => ballot.name), ['김민수']);

  const invalid = await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '이영희', grades: [2, 2] } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.message, /모든 후보/);
});

test('a voter takes back their own ballot, and the maker anyone’s', async () => {
  const { call, token, adminKey } = await made();
  const vote = async (name) => (await call('PUT', '/polls/team-dinner/ballot', { token, body: { name, grades: [2, 2, 2] } })).body;
  const mine = await vote('김민수');
  const theirs = await vote('이영희');
  assert.equal((await call('DELETE', `/polls/team-dinner/ballots/${theirs.ballotId}`, { token, ballotKey: mine.ballotKey })).status, 403);
  const own = await call('DELETE', `/polls/team-dinner/ballots/${mine.ballotId}`, { token, ballotKey: mine.ballotKey });
  assert.deepEqual(own.body.ballots.map((ballot) => ballot.name), ['이영희']);
  const byMaker = await call('DELETE', `/polls/team-dinner/ballots/${theirs.ballotId}`, { token, admin: adminKey });
  assert.deepEqual(byMaker.body.ballots, []);
  assert.equal((await call('DELETE', `/polls/team-dinner/ballots/${theirs.ballotId}`, { token, admin: adminKey })).status, 404);
});

test('the maker closes the poll and it decides; a member cannot, and nobody votes after', async () => {
  const { call, token, adminKey } = await made();
  await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '김민수', grades: [2, 1, 0] } });
  await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '이영희', grades: [1, 2, 0] } });
  assert.equal((await call('POST', '/polls/team-dinner/close', { token })).status, 403);
  // Neither the maker nor anyone else sees how anyone voted before the close.
  const before = await call('GET', '/polls/team-dinner', { token, admin: adminKey });
  assert.ok(before.body.ballots.every((ballot) => ballot.grades === undefined));
  assert.equal((await call('POST', '/polls/team-dinner/draw', { token, admin: adminKey })).status, 409);
  const closed = await call('POST', '/polls/team-dinner/close', { token, admin: adminKey });
  assert.equal(closed.status, 200);
  assert.ok(closed.body.poll.closedAt);
  assert.deepEqual(closed.body.ballots.map((ballot) => ballot.grades), [[2, 1, 0], [1, 2, 0]]);
  // Dates 0 and 1 are level on everything, so the decision waits for the maker's roulette.
  assert.deepEqual(closed.body.poll.decision, { index: null, tied: [0, 1], drawn: false, pending: true });
  const late = await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '박지훈', grades: [2, 2, 2] } });
  assert.equal(late.status, 423);
  assert.equal((await call('POST', '/polls/team-dinner/draw', { token })).status, 403);
  const drawn = await call('POST', '/polls/team-dinner/draw', { token, admin: adminKey });
  const picked = drawn.body.poll.decision.index;
  assert.deepEqual(drawn.body.poll.decision, { index: picked, tied: [0, 1], drawn: true });
  assert.ok([0, 1].includes(picked));

  // Spinning again, or reopening and closing again, cannot draw again.
  for (let i = 0; i < 5; i++) {
    const spun = await call('POST', '/polls/team-dinner/draw', { token, admin: adminKey });
    assert.equal(spun.body.poll.decision.index, picked);
    await call('POST', '/polls/team-dinner/reopen', { token, admin: adminKey });
    const again = await call('POST', '/polls/team-dinner/close', { token, admin: adminKey });
    assert.deepEqual(again.body.poll.decision, { index: picked, tied: [0, 1], drawn: true });
  }
});

test('the roulette picks any of the options level at the top', async () => {
  const seen = new Set();
  for (let i = 0; i < 24 && seen.size < 2; i++) {
    const { call, token, adminKey } = await made();
    await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '김민수', grades: [2, 2, 0] } });
    await call('POST', '/polls/team-dinner/close', { token, admin: adminKey });
    seen.add((await call('POST', '/polls/team-dinner/draw', { token, admin: adminKey })).body.poll.decision.index);
  }
  assert.deepEqual([...seen].sort(), [0, 1]);
});

test('a poll whose deadline passes closes by itself and decides', async () => {
  const { call, clock, token, adminKey } = await made({ deadline: '2026-11-25T18:00:00+09:00' });
  await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '김민수', grades: [0, 2, 1] } });
  clock.now = Date.parse('2026-11-25T09:00:01Z');
  const after = await call('GET', '/polls/team-dinner', { token });
  assert.equal(after.body.poll.closedAt, '2026-11-25T09:00:00.000Z');
  assert.deepEqual(after.body.poll.decision, { index: 1, tied: [1], drawn: false });
  assert.equal((await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '이영희', grades: [2, 2, 2] } })).status, 423);
  // Reopening drops the deadline that has passed.
  const reopened = await call('POST', '/polls/team-dinner/reopen', { token, admin: adminKey });
  assert.equal(reopened.body.poll.deadline, null);
  assert.equal(reopened.body.poll.closedAt, null);
  assert.equal(reopened.body.ballots[0].grades, undefined);
});

test('a choice poll takes every option in its place and goes with the one that beats every other', async () => {
  const { call, token, adminKey } = await made({ kind: 'choice', options: ['고깃집', '횟집', '중식당'] });
  const vote = (name, grades) => call('PUT', '/polls/team-dinner/ballot', { token, body: { name, grades } });
  assert.equal((await vote('김민수', [2, 2, 1])).status, 400);
  // Points, 2 for the first and 0 for the last: 횟집 beats 고깃집 2-1 and 중식당 3-0.
  for (const [name, grades] of [['김민수', [1, 2, 0]], ['이영희', [0, 2, 1]], ['박지훈', [2, 1, 0]]]) {
    assert.equal((await vote(name, grades)).status, 200);
  }
  const closed = await call('POST', '/polls/team-dinner/close', { token, admin: adminKey });
  assert.deepEqual(closed.body.poll.decision, { index: 1, tied: [1], drawn: false });
});

test('the maker deletes the poll, which frees its ID', async () => {
  const { call, token, adminKey, env } = await made();
  assert.equal((await call('DELETE', '/polls/team-dinner', { token })).status, 403);
  assert.equal((await call('DELETE', '/polls/team-dinner', { token, admin: adminKey })).status, 200);
  assert.equal(env.POLLS.objects.get('team-dinner').storage.data.size, 0);
  assert.equal((await call('GET', '/polls/team-dinner', { token })).status, 401);
  assert.equal((await call('POST', '/polls', { body: DINNER })).status, 201);
});

test('a poll goes 60 days after it last changed', async () => {
  const { call, clock, token, env } = await made();
  const object = env.POLLS.objects.get('team-dinner');
  assert.equal(await object.storage.getAlarm(), START + KEEP);
  clock.now += 10 * 86400e3;
  await call('PUT', '/polls/team-dinner/ballot', { token, body: { name: '김민수', grades: [2, 2, 2] } });
  assert.equal(await object.storage.getAlarm(), clock.now + KEEP);
  // An alarm that goes off early, as one left from before may, keeps it.
  await object.poll.alarm();
  assert.ok(object.storage.data.has('poll'));
  clock.now += KEEP;
  await object.poll.alarm();
  assert.equal(object.storage.data.size, 0);
});

test('one address can make only so many polls an hour', async () => {
  const { call, clock } = setup();
  for (let i = 0; i < CREATES; i++) {
    const res = await call('POST', '/polls', { body: { ...DINNER, id: `poll-${i}` }, ip: '192.0.2.5' });
    assert.equal(res.status, 201);
  }
  const busy = await call('POST', '/polls', { body: { ...DINNER, id: 'one-more' }, ip: '192.0.2.5' });
  assert.equal(busy.status, 429);
  assert.equal(busy.body.error, 'busy');
  assert.equal((await call('POST', '/polls', { body: { ...DINNER, id: 'one-more' }, ip: '192.0.2.6' })).status, 201);
  clock.now += 3600e3;
  assert.equal((await call('POST', '/polls', { body: { ...DINNER, id: 'later' }, ip: '192.0.2.5' })).status, 201);
});

test('the page’s own site and this machine get CORS headers, and other sites none', async () => {
  const { call } = setup();
  const preflight = await call('OPTIONS', '/polls', {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-ballot-key/);
  const local = await call('OPTIONS', '/polls', { origin: 'http://127.0.0.1:8000' });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8000');
  const other = await call('OPTIONS', '/polls', { origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const answer = await call('GET', '/polls/team-dinner', { origin: ORIGIN });
  assert.equal(answer.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(answer.headers.get('cache-control'), 'no-store');
});

test('a path that is no route says so', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/')).status, 404);
  assert.equal((await call('PATCH', '/polls/team-dinner')).status, 405);
  assert.equal((await call('GET', '/polls/%E0%A4%A')).status, 401);
});

// What a phone sends for research: a random ID and key, and the record.
const RECORD = { v: 1, weekdays: [4, 5, 4], holidays: [0, 0, 0], answers: [[0, 2, 2], [2, 1, 0]] };
const ID = 'donation-id-0123456789';
const KEY = 'donation-key-0123456789';

test('a date poll that asks for research says only whether it may go, not who said what', async () => {
  const { call, token, adminKey } = await made({ research: true });
  const vote = (name, grades, research, extra = {}) => call('PUT', '/polls/team-dinner/ballot', {
    token, ...extra, body: { name, grades, research, ...extra.body },
  });
  assert.equal((await vote('김민수', [2, 1, 0], RESEARCH_IN)).body.poll.research, 'few');
  const second = await vote('이영희', [1, 2, 2], RESEARCH_IN);
  assert.equal(second.body.poll.research, 'ok');
  const closed = await call('POST', '/polls/team-dinner/close', { token, admin: adminKey });
  assert.equal(closed.body.poll.research, 'ok');
  for (const ballot of closed.body.ballots) assert.deepEqual(Object.keys(ballot).sort(), ['at', 'grades', 'id', 'name']);
  await call('POST', '/polls/team-dinner/reopen', { token, admin: adminKey });
  const { ballotId, ballotKey } = second.body;
  const out = await vote('이영희', [1, 2, 2], RESEARCH_OUT, { ballotKey, body: { ballotId } });
  assert.equal(out.body.poll.research, 'declined');

  // A poll that does not ask, and a choice poll, which cannot.
  const plain = await made({ id: 'plain-dinner' });
  const cast = await plain.call('PUT', '/polls/plain-dinner/ballot', {
    token: plain.token, body: { name: '김민수', grades: [2, 1, 0], research: RESEARCH_IN },
  });
  assert.equal(cast.body.poll.research, null);
  const choice = await made({ id: 'choice-dinner', kind: 'choice', options: ['횟집', '고깃집'], research: true });
  assert.equal(choice.poll.research, null);
});

test('a record is kept once under its ID, replaced with its key, and taken back with it', async () => {
  const { call } = setup();
  const sent = await call('POST', '/donations', { body: { id: ID, key: KEY, record: RECORD } });
  assert.equal(sent.status, 201);
  const again = await call('POST', '/donations', { body: { id: ID, key: KEY, record: { ...RECORD, holidays: null } } });
  assert.equal(again.status, 200);
  const other = await call('POST', '/donations', { body: { id: ID, key: 'another-key-0123456789', record: RECORD } });
  assert.equal(other.status, 409);
  assert.equal((await call('DELETE', `/donations/${ID}`)).status, 403);
  assert.equal((await call('DELETE', `/donations/${ID}`, { donationKey: 'another-key-0123456789' })).status, 403);
  assert.equal((await call('DELETE', `/donations/${ID}`, { donationKey: KEY })).status, 200);
  assert.equal((await call('DELETE', `/donations/${ID}`, { donationKey: KEY })).status, 404);
});

test('a record that does not fit is turned down, and one address sends only so many an hour', async () => {
  const { call, clock } = setup();
  const bad = (body) => call('POST', '/donations', { body, ip: '192.0.2.9' });
  assert.equal((await bad({ id: ID, key: KEY, record: { ...RECORD, title: '송년회' } })).status, 400);
  assert.equal((await bad({ id: 'short', key: KEY, record: RECORD })).status, 400);
  assert.equal((await bad({ id: ID, key: KEY, record: { ...RECORD, answers: [[0, 2, 2]] } })).status, 400);
  for (let i = 3; i < CREATES; i++) {
    assert.equal((await bad({ id: `${ID}-${i}`, key: KEY, record: RECORD })).status, 201);
  }
  const busy = await bad({ id: `${ID}-busy`, key: KEY, record: RECORD });
  assert.equal(busy.status, 429);
  assert.match(busy.body.message, /연구용 기록/);
  clock.now += 3600e3;
  assert.equal((await bad({ id: `${ID}-later`, key: KEY, record: RECORD })).status, 201);
});

test('only the research token reads the records, a page at a time, without their keys', async () => {
  const closed = setup();
  await closed.call('POST', '/donations', { body: { id: ID, key: KEY, record: RECORD } });
  assert.equal((await closed.call('GET', '/donations', { token: 'anything' })).status, 404);

  const { call } = setup({ RESEARCH_TOKEN: 'research-token-0123456789' });
  const total = EXPORT_PAGE + 2;
  for (let i = 0; i < total; i++) {
    const id = `donation-${String(i).padStart(4, '0')}-0123456789`;
    const res = await call('POST', '/donations', { body: { id, key: KEY, record: RECORD }, ip: `198.51.100.${i % 200}` });
    assert.equal(res.status, 201);
  }
  assert.equal((await call('GET', '/donations')).status, 401);
  assert.equal((await call('GET', '/donations', { token: 'research-token-0123456780' })).status, 401);
  const first = await call('GET', '/donations', { token: 'research-token-0123456789' });
  assert.equal(first.status, 200);
  assert.equal(first.body.donations.length, EXPORT_PAGE);
  assert.deepEqual(first.body.donations[0], { id: 'donation-0000-0123456789', month: '2026-11', record: RECORD });
  const rest = await call('GET', `/donations?after=${first.body.next}`, { token: 'research-token-0123456789' });
  assert.equal(rest.body.donations.length, 2);
  assert.equal(rest.body.next, null);
});

test('a browser on the page’s site may send the key that takes a record back', async () => {
  const { call } = setup();
  const preflight = await call('OPTIONS', '/donations', {});
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-donation-key/);
  assert.equal((await call('PATCH', '/donations')).status, 405);
  assert.equal((await call('GET', '/donations/a/b')).status, 404);
});
