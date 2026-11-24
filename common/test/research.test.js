import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, MEH, NO, RESEARCH_IN, RESEARCH_OUT, YES, checkBallot, checkPoll, researchStatus,
} from '../site/poll-rules.js';
import { RESEARCH_VERSION, donationOf, donationProblem, isToken } from '../site/research.js';

// 20 November 2026, 10:00 in Korea.
const NOW = Date.parse('2026-11-20T01:00:00Z');

const OPTIONS = [{ date: '2026-12-24' }, { date: '2026-12-25' }, { date: '2026-12-26' }];
const BALLOTS = [
  { id: 'b1', name: '민수', grades: [YES, MEH, NO], at: '2026-11-20T02:00:00Z' },
  { id: 'b2', name: '지영', grades: [NO, YES, YES], at: '2026-11-20T03:00:00Z' },
  { id: 'b3', name: '현우', grades: [MEH, YES, NO], at: '2026-11-20T04:00:00Z' },
];

test('only a date poll may ask for research, and only when its maker ticks it', () => {
  const dates = { kind: 'date', title: '송년회', note: '', options: ['2026-12-24', '2026-12-26'] };
  assert.equal(checkPoll({ ...dates, research: true }, NOW).poll.research, true);
  assert.equal('research' in checkPoll(dates, NOW).poll, false);
  assert.equal('research' in checkPoll({ ...dates, research: 'yes' }, NOW).poll, false);
  const choice = { kind: 'choice', title: '송년회 장소', note: '', options: ['횟집', '고깃집'], research: true };
  assert.equal('research' in checkPoll(choice, NOW).poll, false);
});

test('a ballot keeps its voter\'s answer to the question only when the poll asks it', () => {
  const asking = { kind: 'date', options: OPTIONS, research: true };
  const input = { name: '민수', grades: [YES, MEH, NO] };
  assert.equal(checkBallot({ ...input, research: RESEARCH_IN }, asking).ballot.research, RESEARCH_IN);
  assert.equal(checkBallot({ ...input, research: RESEARCH_OUT }, asking).ballot.research, RESEARCH_OUT);
  assert.equal('research' in checkBallot({ ...input, research: 7 }, asking).ballot, false);
  assert.equal('research' in checkBallot({ ...input, research: RESEARCH_IN }, { kind: 'date', options: OPTIONS }).ballot, false);
});

test('a poll goes to research only when every ballot, two or more, went along', () => {
  assert.equal(researchStatus(false, [RESEARCH_IN, RESEARCH_IN]), null);
  assert.equal(researchStatus(true, [RESEARCH_IN, RESEARCH_IN]), 'ok');
  assert.equal(researchStatus(true, [RESEARCH_IN, RESEARCH_OUT, RESEARCH_IN]), 'declined');
  assert.equal(researchStatus(true, [RESEARCH_IN, undefined]), 'unasked');
  assert.equal(researchStatus(true, [RESEARCH_IN]), 'few');
  assert.equal(researchStatus(true, []), 'few');
});

test('the record has the answers and each date\'s weekday and holiday, and nothing else', () => {
  const record = donationOf({ options: OPTIONS, ballots: BALLOTS }, { '2026-12-25': '성탄절' });
  assert.deepEqual(record, {
    v: RESEARCH_VERSION,
    weekdays: [4, 5, 6],
    holidays: [0, 1, 0],
    answers: [[0, 2, 2], [1, 2, 0], [2, 1, 0]],
  });
  const text = JSON.stringify(record);
  for (const word of ['민수', '지영', '현우', 'b1', '2026', '성탄절']) assert.equal(text.includes(word), false, word);
  assert.equal(donationProblem(record), null);
});

test('the record is the same whatever order the ballots came in, and holidays may be unknown', () => {
  const one = donationOf({ options: OPTIONS, ballots: BALLOTS }, {});
  const other = donationOf({ options: OPTIONS, ballots: [...BALLOTS].reverse() }, {});
  assert.deepEqual(one, other);
  const unknown = donationOf({ options: OPTIONS, ballots: BALLOTS }, null);
  assert.equal(unknown.holidays, null);
  assert.equal(donationProblem(unknown), null);
});

test('a record that does not fit is turned down', () => {
  const good = donationOf({ options: OPTIONS, ballots: BALLOTS }, {});
  assert.equal(donationProblem(null), 'not a record');
  assert.equal(donationProblem({ ...good, title: '송년회' }), 'unknown field');
  assert.equal(donationProblem({ ...good, v: 2 }), 'version');
  assert.equal(donationProblem({ ...good, weekdays: [4] }), 'dates');
  assert.equal(donationProblem({ ...good, weekdays: Array(LIMITS.options.date + 1).fill(1) }), 'dates');
  assert.equal(donationProblem({ ...good, weekdays: [4, 5, 7] }), 'weekdays');
  assert.equal(donationProblem({ ...good, holidays: [0, 1] }), 'holidays');
  assert.equal(donationProblem({ ...good, holidays: [0, 2, 0] }), 'holidays');
  assert.equal(donationProblem({ ...good, answers: [[0, 1, 2]] }), 'voters');
  assert.equal(donationProblem({ ...good, answers: Array(LIMITS.ballots + 1).fill([0, 1, 2]) }), 'voters');
  assert.equal(donationProblem({ ...good, answers: [[0, 1, 2], [0, 1, 3]] }), 'answers');
  assert.equal(donationProblem({ ...good, answers: [[0, 1, 2], [0, 1]] }), 'answers');
});

test('a record goes under a random ID and key of 16 to 64 URL-safe characters', () => {
  assert.equal(isToken('Abc_def-1234567890'), true);
  assert.equal(isToken('short'), false);
  assert.equal(isToken('has space in it 12345'), false);
  assert.equal(isToken(undefined), false);
});
