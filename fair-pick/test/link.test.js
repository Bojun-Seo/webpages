import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isDate } from '../../common/site/calendar.js';
import * as pollRules from '../../common/site/poll-rules.js';
import { decide } from '../../common/site/social-choice.js';
import {
  STATE_VERSION, checked, closedAt, counted, createLinkClient, importKey, merge, payloadsIn, sameNames, seal, sha256Hex,
  tieOrderOf,
} from '../site/link.js';

const rules = { ...pollRules, isDate };
const NOW = Date.parse('2026-11-20T01:00:00Z');
const DINNER = {
  id: 'Team Dinner', pin: '482915', kind: 'date', title: '12월 팀 회식', note: '저녁 7시',
  options: ['2026-12-03', '2026-12-04', '2026-12-10'],
};

// A phone: its own storage, and a clock the test moves. Few PBKDF2 rounds,
// so the tests run quickly.
function phone(clock = { now: NOW }) {
  let kept = null;
  const storage = {
    read: () => (kept ? structuredClone(kept) : null),
    write: (polls) => {
      kept = structuredClone(polls);
    },
  };
  const client = createLinkClient({ rules, decide, storage, now: () => clock.now, iterations: 1000 });
  return { client, clock, storage };
}

const names = (data) => data.ballots.map((ballot) => ballot.name).sort();

// The grades of the ballots that count on a phone, as its links carry them,
// for the page is not told them before the poll closes.
const stored = (on, id = 'team-dinner') => counted(on.storage.read()[id].state, pollRules.nameKey).map((ballot) => ballot.g);

async function maker(props = {}) {
  const a = phone();
  const made = await a.client.create({ ...DINNER, ...props });
  return { a, made, admin: { adminKey: made.adminKey } };
}

test('a link reads as noise without the group ID and the PIN, and opens with both', async () => {
  const { a, made } = await maker();
  assert.equal(made.poll.id, 'team-dinner');
  assert.equal(made.poll.title, '12월 팀 회식');
  const link = await a.client.linkOf('team-dinner');
  assert.match(link, /^1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  const b = phone();
  await assert.rejects(b.client.open(link, 'team-dinner', '000000'), { status: 401, code: 'wrong' });
  await assert.rejects(b.client.open(link, 'other-group', '482915'), { status: 401, code: 'wrong' });
  // The ID may be typed as it was made.
  const opened = await b.client.open(`https://example.com/fair-pick/#${link}`, 'Team Dinner', '482915');
  assert.equal(opened.poll.title, '12월 팀 회식');
  assert.deepEqual(opened.poll.options.map((option) => option.date), DINNER.options);
  assert.deepEqual(opened.ballots, []);
});

test('votes go round in links and add up whatever order they are opened in', async () => {
  const { a } = await maker();
  await a.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 1, 0] });
  const first = await a.client.linkOf('team-dinner');
  const b = phone();
  const c = phone();
  await b.client.open(first, 'team-dinner', '482915');
  await c.client.open(first, 'team-dinner', '482915');
  await b.client.vote('team-dinner', {}, { name: '이영희', grades: [1, 2, 2] });
  await c.client.vote('team-dinner', {}, { name: '박지훈', grades: [2, 2, 1] });
  const fromB = await b.client.linkOf('team-dinner');
  const fromC = await c.client.linkOf('team-dinner');

  // Pasted together, as from a chat.
  const added = await a.client.absorb(`이영희: ${fromB}\n박지훈: https://x.test/fair-pick/#${fromC}`);
  assert.deepEqual(added, [{ id: 'team-dinner', added: 1 }, { id: 'team-dinner', added: 1 }]);
  assert.deepEqual(names(await a.client.load('team-dinner')), ['김민수', '박지훈', '이영희']);
  await b.client.absorb(fromC);
  await c.client.absorb(fromB);
  assert.deepEqual(names(await b.client.load('team-dinner')), ['김민수', '박지훈', '이영희']);
  assert.deepEqual(names(await c.client.load('team-dinner')), ['김민수', '박지훈', '이영희']);
  // Opening a link again adds nothing.
  assert.deepEqual(await a.client.absorb(fromB), [{ id: 'team-dinner', added: 0 }]);
  // A link of a poll this phone does not keep is left alone.
  const other = await (await maker({ id: 'another-poll' })).a.client.linkOf('another-poll');
  assert.deepEqual(await a.client.absorb(other), []);
});

test('the later change to a ballot wins, whichever link brings it first', async () => {
  const { a } = await maker();
  const cast = await a.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 1, 0] });
  const before = await a.client.linkOf('team-dinner');
  a.clock.now += 60e3;
  await a.client.vote('team-dinner', { ballotKey: 'own' }, { name: '김민수', grades: [0, 0, 2], ballotId: cast.ballotId });
  const after = await a.client.linkOf('team-dinner');
  const b = phone();
  await b.client.open(after, 'team-dinner', '482915');
  await b.client.absorb(before);
  assert.deepEqual(stored(b), ['002']);
});

test('a ballot taken out stays out, and only its voter or the maker takes it out', async () => {
  const { a, admin } = await maker();
  const b = phone();
  await b.client.open(await a.client.linkOf('team-dinner'), 'team-dinner', '482915');
  const cast = await b.client.vote('team-dinner', {}, { name: '이영희', grades: [1, 2, 2] });
  const voted = await b.client.linkOf('team-dinner');
  await a.client.absorb(voted);
  await assert.rejects(a.client.unvote('team-dinner', {}, cast.ballotId), { status: 403 });
  await a.client.unvote('team-dinner', admin, cast.ballotId);
  const removed = await a.client.linkOf('team-dinner');
  await b.client.absorb(removed);
  await b.client.absorb(voted);
  assert.deepEqual((await b.client.load('team-dinner')).ballots, []);
});

test('a name cast from two phones before either saw the other counts once, the later', async () => {
  const { a } = await maker();
  const start = await a.client.linkOf('team-dinner');
  const b = phone();
  const c = phone();
  await b.client.open(start, 'team-dinner', '482915');
  await c.client.open(start, 'team-dinner', '482915');
  await b.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 2, 2] });
  c.clock.now += 1000;
  await c.client.vote('team-dinner', {}, { name: ' 김민수', grades: [0, 0, 0] });
  await a.client.absorb(`${await b.client.linkOf('team-dinner')} ${await c.client.linkOf('team-dinner')}`);
  const data = await a.client.load('team-dinner');
  assert.deepEqual(names(data), ['김민수']);
  assert.deepEqual(stored(a), ['000']);
  assert.deepEqual(data.sameNames, ['김민수']);
  // A phone that knows the name turns a second ballot under it down.
  await assert.rejects(a.client.vote('team-dinner', {}, { name: '김민수', grades: [1, 1, 1] }), { status: 409, code: 'name' });
});

test('only the maker closes, and closing shows the seed that settles a tie the same everywhere', async () => {
  const { a, admin } = await maker();
  const b = phone();
  await b.client.open(await a.client.linkOf('team-dinner'), 'team-dinner', '482915');
  await b.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 1, 0] });
  await b.client.vote('team-dinner', {}, { name: '이영희', grades: [1, 2, 0] });
  await assert.rejects(b.client.close('team-dinner', {}), { status: 403, code: 'admin' });
  await a.client.absorb(await b.client.linkOf('team-dinner'));
  const closed = await a.client.close('team-dinner', admin);
  assert.ok(closed.poll.closedAt);
  assert.deepEqual(closed.poll.decision.tied, [0, 1]);
  assert.equal(closed.poll.decision.drawn, true);
  const order = await tieOrderOf(admin.adminKey, 3);
  assert.equal(closed.poll.decision.index, order.find((index) => index < 2));
  await b.client.absorb(await a.client.linkOf('team-dinner'));
  const seen = await b.client.load('team-dinner');
  assert.deepEqual(seen.poll.decision, closed.poll.decision);
  await assert.rejects(b.client.vote('team-dinner', {}, { name: '박지훈', grades: [2, 2, 2] }), { status: 423 });
});

test('until the poll closes a phone is told who voted but not how, and then everything', async () => {
  const { a, admin } = await maker();
  await a.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 1, 0] });
  const open = await a.client.load('team-dinner', admin);
  assert.deepEqual(open.ballots.map((ballot) => Object.keys(ballot).sort()), [['at', 'id', 'name']]);
  const closed = await a.client.close('team-dinner', admin);
  assert.deepEqual(closed.ballots.map((ballot) => ballot.grades), [[2, 1, 0]]);
  assert.deepEqual(closed.poll.decision, { index: 0, tied: [0], drawn: false });
});

test('a choice poll goes round in links as orders, and goes with the one that beats every other', async () => {
  const { a, admin } = await maker({ id: 'dinner-place', kind: 'choice', options: ['고깃집', '횟집', '중식당', '분식'] });
  // Points, 3 for the first and 0 for the last; base 36 in the link.
  await a.client.vote('dinner-place', {}, { name: '김민수', grades: [2, 3, 1, 0] });
  await a.client.vote('dinner-place', {}, { name: '이영희', grades: [0, 3, 2, 1] });
  await assert.rejects(a.client.vote('dinner-place', {}, { name: '박지훈', grades: [3, 3, 1, 0] }), { status: 400 });
  const b = phone();
  await b.client.open(await a.client.linkOf('dinner-place'), 'dinner-place', '482915');
  await b.client.vote('dinner-place', {}, { name: '박지훈', grades: [3, 2, 1, 0] });
  await a.client.absorb(await b.client.linkOf('dinner-place'));
  assert.deepEqual(stored(a, 'dinner-place').sort(), ['0321', '2310', '3210']);
  const closed = await a.client.close('dinner-place', admin);
  assert.deepEqual(closed.poll.decision, { index: 1, tied: [1], drawn: false });
});

test('a link from before polls of places were ranked opens with its grades turned into orders', async () => {
  const { a } = await maker({ id: 'dinner-place', kind: 'choice', options: ['고깃집', '횟집', '중식당', '분식'] });
  const record = a.storage.read()['dinner-place'];
  // Grades from 안 돼요 (0) to 최고 (4), as a version 1 link carried them.
  const old = {
    ...record.state, v: 1,
    ballots: [{ i: 'aa', n: '갑', g: '4130', t: 1 }, { i: 'bb', n: '을', g: '2240', t: 2 }, { i: 'cc', n: '병', g: '41', t: 3 }],
  };
  const link = await seal(old, await importKey(record.key));
  const b = phone();
  const c = phone();
  await b.client.open(link, 'dinner-place', '482915');
  await c.client.open(link, 'dinner-place', '482915');
  const [kept, level] = stored(b, 'dinner-place');
  assert.equal(b.storage.read()['dinner-place'].state.v, STATE_VERSION);
  // Graded 4, 3, 1, 0: the order stands. Graded 2, 2, 4, 0: 중식당 first,
  // 분식 last, and the two graded alike in an order every phone draws alike.
  assert.equal(kept, '3120');
  assert.ok(['2130', '1230'].includes(level), level);
  assert.deepEqual(stored(c, 'dinner-place'), stored(b, 'dinner-place'));
  // A phone that kept the poll from before brings it up to date on reading it.
  const d = phone();
  d.storage.write({ 'dinner-place': { ...record, state: old } });
  assert.equal(d.storage.read()['dinner-place'].state.v, 1);
  assert.equal((await d.client.load('dinner-place')).ballots.length, 2);
  assert.deepEqual(stored(d, 'dinner-place'), stored(b, 'dinner-place'));
});

test('the deadline closes the poll everywhere; the maker’s phone shows the seed, and may open it again', async () => {
  const { a, admin } = await maker({ deadline: '2026-11-25T18:00:00+09:00' });
  const b = phone();
  await b.client.open(await a.client.linkOf('team-dinner'), 'team-dinner', '482915');
  await b.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 1, 0] });
  await b.client.vote('team-dinner', {}, { name: '이영희', grades: [1, 2, 0] });
  b.clock.now = Date.parse('2026-11-25T09:00:01Z');
  const late = await b.client.load('team-dinner');
  assert.equal(late.poll.closedAt, '2026-11-25T09:00:00.000Z');
  assert.deepEqual(late.poll.decision, { index: null, tied: [0, 1], drawn: false, pending: true });

  a.clock.now = b.clock.now;
  await a.client.absorb(await b.client.linkOf('team-dinner'));
  const shown = await a.client.load('team-dinner', admin);
  assert.equal(shown.changed, true);
  assert.equal(shown.poll.decision.drawn, true);
  await b.client.absorb(await a.client.linkOf('team-dinner'));
  assert.deepEqual((await b.client.load('team-dinner')).poll.decision, shown.poll.decision);

  await a.client.reopen('team-dinner', admin);
  await b.client.absorb(await a.client.linkOf('team-dinner'));
  assert.equal((await b.client.load('team-dinner')).poll.closedAt, null);
  assert.ok(await b.client.vote('team-dinner', {}, { name: '박지훈', grades: [2, 2, 2] }));
});

test('a seed that does not match the poll’s hash is not trusted', async () => {
  const { a } = await maker({ deadline: '2026-11-25T18:00:00+09:00' });
  const b = phone();
  await b.client.open(await a.client.linkOf('team-dinner'), 'team-dinner', '482915');
  await b.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 1, 0] });
  await b.client.vote('team-dinner', {}, { name: '이영희', grades: [1, 2, 0] });
  // Someone with the PIN seals the poll again with a seed of their own.
  const record = b.storage.read()['team-dinner'];
  const forged = await seal({ ...record.state, seed: 'chosen-to-win' }, await importKey(record.key));
  const c = phone({ now: Date.parse('2026-11-26T00:00:00Z') });
  await c.client.open(forged, 'team-dinner', '482915');
  assert.equal((await c.client.load('team-dinner')).poll.decision.pending, true);
});

test('a phone enters a poll it keeps by group ID and PIN, and no other', async () => {
  const { a } = await maker();
  assert.equal((await a.client.enter('team-dinner', '482915')).poll.title, '12월 팀 회식');
  await assert.rejects(a.client.enter('team-dinner', '111222'), { status: 401 });
  await assert.rejects(phone().client.enter('team-dinner', '482915'), { status: 404, code: 'unknown' });
  // One poll to a group ID on a phone.
  await assert.rejects(a.client.create(DINNER), { status: 409, code: 'taken' });
  const other = await (await maker({ title: '다른 회식' })).a.client.linkOf('team-dinner');
  await assert.rejects(a.client.open(other, 'team-dinner', '482915'), { status: 409, code: 'other' });
});

test('a poll is checked as the API checks it', async () => {
  const a = phone();
  const field = (name) => (error) => error.status === 400 && error.body.field === name;
  await assert.rejects(a.client.create({ ...DINNER, pin: '1234' }), field('pin'));
  await assert.rejects(a.client.create({ ...DINNER, id: 'ab' }), field('id'));
  await assert.rejects(a.client.create({ ...DINNER, options: ['2026-11-01', '2026-12-01'] }), { status: 400 });
  const { a: b } = await maker();
  await assert.rejects(b.client.vote('team-dinner', {}, { name: '김민수', grades: [2, 2] }), { status: 400 });
});

test('merging is the same in any order and however often', async () => {
  const { a } = await maker();
  const base = a.storage.read()['team-dinner'].state;
  const ballot = (i, n, g, t, x) => (x ? { i, t, x: 1 } : { i, n, g, t });
  const one = { ...base, ballots: [ballot('aa', '갑', '210', 5), ballot('bb', '을', '111', 6)] };
  const closed = { closed: true, at: base.status.at + 50 };
  const two = { ...base, ballots: [ballot('aa', '갑', '012', 9), ballot('cc', '병', '222', 7)], status: closed };
  const three = { ...base, ballots: [ballot('bb', '', '', 8, 1)], seed: 'x' };
  const both = merge(merge(one, two), three);
  assert.deepEqual(both, merge(one, merge(two, three)));
  assert.deepEqual(merge(one, two), merge(two, one));
  assert.deepEqual(merge(both, both), both);
  assert.deepEqual(both.ballots.map((b) => [b.i, b.g ?? 'gone']), [['cc', '222'], ['bb', 'gone'], ['aa', '012']]);
  assert.deepEqual(both.status, closed);
  assert.equal(both.seed, 'x');
  assert.deepEqual(counted(both, pollRules.nameKey).map((b) => b.n), ['병', '갑']);
  assert.deepEqual(sameNames({ ballots: [ballot('x1', '갑', '0', 1), ballot('x2', '갑 ', '1', 2)] }, pollRules.nameKey), ['갑 ']);
});

test('a link’s ballots that do not fit its poll are dropped, and a broken poll is refused', async () => {
  const { a } = await maker();
  const { state } = a.storage.read()['team-dinner'];
  const fixed = checked({ ...state, ballots: [
    { i: 'ok', n: '갑', g: '210', t: 1 }, { i: 'short', n: '을', g: '21', t: 2 }, { i: 'high', n: '병', g: '213', t: 3 },
    { i: 'noname', n: '', g: '210', t: 4 }, { i: 'gone', t: 5, x: 1 },
  ] }, rules);
  assert.deepEqual(fixed.ballots.map((b) => b.i), ['ok', 'gone']);
  const choice = { ...state, kind: 'choice', options: [{ label: '가' }, { label: '나' }, { label: '다' }] };
  const places = checked({ ...choice, ballots: [
    { i: 'ok', n: '갑', g: '021', t: 1 }, { i: 'twice', n: '을', g: '112', t: 2 }, { i: 'upper', n: '병', g: '0A1', t: 3 },
  ] }, rules);
  assert.deepEqual(places.ballots.map((b) => b.i), ['ok']);
  assert.throws(() => checked({ ...state, v: 3 }, rules));
  assert.throws(() => checked({ ...state, kind: 'vote' }, rules));
  assert.throws(() => checked({ ...state, options: [{ date: '2026-02-30' }, { date: '2026-12-01' }] }, rules));
});

test('the poll closes at its deadline unless its maker opens it again after', () => {
  const deadline = '2026-11-25T09:00:00.000Z';
  const at = Date.parse(deadline);
  const open = { deadline, status: { closed: false, at: NOW } };
  assert.equal(closedAt(open, at - 1), null);
  assert.equal(closedAt(open, at), at);
  assert.equal(closedAt({ ...open, status: { closed: false, at: at + 5 } }, at + 10), null);
  assert.equal(closedAt({ deadline: null, status: { closed: true, at: 42 } }, 0), 42);
});

test('a link of thirty voters on a whole month of dates stays short enough to send', async () => {
  const month = Array.from({ length: 31 }, (_, i) => addDays('2026-12-01', i));
  const { a } = await maker({ options: month });
  for (let v = 0; v < 30; v++) {
    const grades = month.map((_, d) => (v * 7 + d * 3) % 3);
    a.clock.now += 1000;
    await a.client.vote('team-dinner', {}, { name: `투표자${v}`, grades });
  }
  const link = await a.client.linkOf('team-dinner');
  assert.ok(link.length < 4000, `${link.length} characters`);
});

test('pasted text gives up each payload once', async () => {
  const payload = `1.${'a'.repeat(16)}.${'b'.repeat(60)}`;
  assert.deepEqual(payloadsIn(`보세요 https://x.test/fair-pick/#${payload} 그리고 ${payload}`).map((p) => p.uid), ['a'.repeat(16)]);
  assert.deepEqual(payloadsIn('https://x.test/fair-pick/?g=team-dinner'), []);
  assert.equal((await sha256Hex('a')).length, 64);
});
