import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../site/calendar.js';
import {
  DATE_GRADES, LIMITS, MEH, NO, YES, checkBallot, checkPoll, cleanText, gradesFit, idProblem, nameKey, newPinProblem,
  normalizeId, orderOf, pinProblem, pointsOf, weakPin,
} from '../site/poll-rules.js';

// 20 November 2026, 10:00 in Korea.
const NOW = Date.parse('2026-11-20T01:00:00Z');

const datePoll = (props) => ({
  kind: 'date', title: '12월 팀 회식', note: '', options: ['2026-12-04', '2026-12-03'], ...props,
});

test('a group ID is lower case with hyphens for spaces, and Hangul is welcome', () => {
  assert.equal(normalizeId('  Team Dinner '), 'team-dinner');
  assert.equal(idProblem(normalizeId('영업2팀 회식')), null);
  assert.equal(idProblem('abc'), `그룹 ID는 ${LIMITS.idMin}~${LIMITS.idMax}자로 해 주세요.`);
  assert.match(idProblem('-team'), /시작해야/);
  assert.match(idProblem('team/../x'), /만 쓸 수 있고/);
  assert.match(idProblem('~gate'), /만 쓸 수 있고/);
  assert.equal(idProblem(''), '그룹 ID를 넣어 주세요.');
});

test('a PIN is four to eight digits, and a new one may not be the first anyone tries', () => {
  assert.equal(pinProblem('482915'), null);
  assert.match(pinProblem('48a915'), /숫자로만/);
  assert.match(pinProblem('123'), /4~8자리/);
  assert.match(pinProblem('123456789'), /4~8자리/);
  for (const pin of ['0000', '1111', '1234', '123456', '9876', '7890', '0987', '45678']) {
    assert.ok(weakPin(pin), pin);
  }
  for (const pin of ['1212', '482915', '2468', '1004']) assert.ok(!weakPin(pin), pin);
  assert.match(newPinProblem('1234'), /쉽게 맞힐/);
  assert.equal(newPinProblem('1004'), null);
});

test('text loses hidden characters and extra spaces, and a note keeps its lines', () => {
  assert.equal(cleanText('  강남​역   근처\t'), '강남 역 근처');
  assert.equal(cleanText('ㅎㅏㄴ'), 'ㅎㅏㄴ');
  assert.equal(cleanText('한'), '한');
  assert.equal(cleanText('저녁 7시\r\n\r\n\r\n 강남역 '), '저녁 7시 강남역');
  assert.equal(cleanText('저녁 7시\r\n\r\n\r\n 강남역 ', { lines: true }), '저녁 7시\n\n강남역');
  assert.equal(cleanText(42), '');
  assert.equal(nameKey(' Minsu  Kim '), 'minsu kim');
});

test('a date poll keeps its dates sorted and turns down the past, the far future and repeats', () => {
  const { poll } = checkPoll(datePoll(), NOW);
  assert.deepEqual(poll.options, [{ date: '2026-12-03' }, { date: '2026-12-04' }]);
  assert.equal(poll.deadline, null);
  // Today is a candidate; yesterday is not.
  assert.ok(checkPoll(datePoll({ options: ['2026-11-20', '2026-11-21'] }), NOW).poll);
  assert.match(checkPoll(datePoll({ options: ['2026-11-19', '2026-11-21'] }), NOW).problem, /지난 날짜/);
  assert.match(checkPoll(datePoll({ options: ['2026-12-01', '2028-12-01'] }), NOW).problem, /2년 안/);
  assert.match(checkPoll(datePoll({ options: ['2026-12-01', '2026-12-01'] }), NOW).problem, /두 번/);
  assert.match(checkPoll(datePoll({ options: ['2026-12-01'] }), NOW).problem, /2개 이상/);
  assert.match(checkPoll(datePoll({ options: ['2026-12-01', '2026-02-30'] }), NOW).problem, /다시 골라/);
  const month = Array.from({ length: 32 }, (_, i) => addDays('2026-12-01', i));
  assert.match(checkPoll(datePoll({ options: month }), NOW).problem, /31개까지/);
});

test('a choice poll cleans its options and turns down blanks and repeats', () => {
  const input = { kind: 'choice', title: ' 회식 장소 ', options: [' 고깃집 ', '횟집', { label: '중식당' }] };
  const { poll } = checkPoll(input, NOW);
  assert.equal(poll.title, '회식 장소');
  assert.deepEqual(poll.options, [{ label: '고깃집' }, { label: '횟집' }, { label: '중식당' }]);
  assert.match(checkPoll({ ...input, options: ['고깃집', ' '] }, NOW).problem, /비어 있는/);
  assert.match(checkPoll({ ...input, options: ['Pizza', 'pizza'] }, NOW).problem, /두 번/);
  assert.match(checkPoll({ ...input, options: ['가'.repeat(41), '나'] }, NOW).problem, /40자까지/);
  assert.match(checkPoll({ ...input, kind: 'vote' }, NOW).problem, /무엇을 정할지/);
  assert.match(checkPoll({ ...input, title: '' }, NOW).problem, /제목/);
});

test('a deadline is a time ahead, within a year', () => {
  const at = (deadline) => checkPoll(datePoll({ deadline }), NOW);
  assert.equal(at('2026-12-01T18:00:00+09:00').poll.deadline, '2026-12-01T09:00:00.000Z');
  assert.equal(at('').poll.deadline, null);
  assert.match(at('2026-11-20T09:00:00+09:00').problem, /지금보다 뒤/);
  assert.match(at('2028-01-01T00:00:00+09:00').problem, /1년 안/);
  assert.match(at('someday').problem, /다시 골라/);
});

test('a ballot names its voter and answers every date ✕, △ or ○', () => {
  const poll = { kind: 'date', options: [{ date: '2026-12-03' }, { date: '2026-12-04' }] };
  assert.deepEqual(checkBallot({ name: ' 김민수 ', grades: [2, 0] }, poll), { ballot: { name: '김민수', grades: [2, 0] } });
  assert.match(checkBallot({ name: ' ', grades: [2, 0] }, poll).problem, /기명 투표/);
  assert.match(checkBallot({ name: '가'.repeat(21), grades: [2, 0] }, poll).problem, /20자까지/);
  assert.match(checkBallot({ name: '김민수', grades: [2] }, poll).problem, /모든 후보에 답해/);
  assert.match(checkBallot({ name: '김민수', grades: [2, 3] }, poll).problem, /모든 후보에 답해/);
  assert.match(checkBallot({ name: '김민수', grades: [2, 1.5] }, poll).problem, /모든 후보에 답해/);
  assert.deepEqual(DATE_GRADES.map((grade) => grade.short), ['✕', '△', '○']);
  assert.deepEqual([NO, MEH, YES], [0, 1, 2]);
});

test('a choice ballot puts every option in its own place', () => {
  const poll = { kind: 'choice', options: [{ label: '고깃집' }, { label: '횟집' }, { label: '중식당' }] };
  assert.ok(checkBallot({ name: '김민수', grades: [0, 2, 1] }, poll).ballot);
  assert.match(checkBallot({ name: '김민수', grades: [2, 2, 1] }, poll).problem, /모든 후보에 순위를/);
  assert.match(checkBallot({ name: '김민수', grades: [3, 2, 1] }, poll).problem, /모든 후보에 순위를/);
  assert.match(checkBallot({ name: '김민수', grades: [1, 0] }, poll).problem, /모든 후보에 순위를/);
  // The points of an order, n - 1 for the first, and back.
  assert.deepEqual(pointsOf([1, 2, 0]), [0, 2, 1]);
  assert.deepEqual(orderOf([0, 2, 1]), [1, 2, 0]);
  assert.equal(gradesFit('choice', 3, pointsOf([2, 0, 1])), true);
  assert.equal(gradesFit('date', 2, [2, -1]), false);
});
