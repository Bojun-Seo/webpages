// What a fair-pick poll and a ballot may hold, how a voter answers each
// kind of poll and how a group ID and PIN look. The page checks a form with
// these before it sends it, and its API checks again what it is sent, so
// both say the same.

import { addDays, isDate, koreaDate } from './calendar.js';

// A poll decides a date, picked on a calendar, or one of the options its
// maker writes down: a place, a menu, anything.
export const KINDS = ['date', 'choice'];

// How a voter answers a date poll: each date ✕, △ or ○, a grade's index
// its value. ○ says they would like that day, △ that they can come but
// would rather not, ✕ that they cannot come.
export const DATE_GRADES = [
  { label: '못 가요', short: '✕', tone: 'no' },
  { label: '되긴 해요', short: '△', tone: 'meh' },
  { label: '좋아요', short: '○', tone: 'best' },
];

export const NO = 0;
export const MEH = 1;
export const YES = 2;

// A date poll's maker may ask, when making it, that once it closes the
// voters' answers go to research without names (research.js). Each ballot
// cast then says what its voter chose after the page told them: IN, to
// go along, or OUT, to keep the poll out of it. A ballot with neither was
// cast without the question, from a page from before it.
export const RESEARCH_IN = 1;
export const RESEARCH_OUT = 2;

// Whether a poll's answers may go to research: null when its maker did
// not ask; 'ok' when every ballot that counts, two or more, says IN;
// 'declined' when one says OUT; 'unasked' when one was cast without the
// question; 'few' with fewer than two ballots. `consents` are the ballots'
// answers to the question.
export function researchStatus(asked, consents) {
  if (!asked) return null;
  if (consents.some((consent) => consent === RESEARCH_OUT)) return 'declined';
  if (consents.some((consent) => consent !== RESEARCH_IN)) return 'unasked';
  return consents.length < 2 ? 'few' : 'ok';
}

// A choice poll is answered by putting every option in order, best first.
// A ballot carries the order as points, one for each option in the poll's
// order: n - 1 for the first of n options, n - 2 for the next and 0 for
// the last, so that more is better there as for dates.
export function pointsOf(order) {
  const points = Array(order.length);
  order.forEach((index, place) => {
    points[index] = order.length - 1 - place;
  });
  return points;
}

// The options in the order a choice ballot's points put them, best first.
export function orderOf(points) {
  return points.map((value, index) => [value, index]).sort((a, b) => b[0] - a[0]).map(([, index]) => index);
}

// Whether `grades` answer each of `count` options of a `kind` poll: a grade
// of DATE_GRADES for every date, or every option's place for a choice.
export function gradesFit(kind, count, grades) {
  if (!Array.isArray(grades) || grades.length !== count) return false;
  if (!grades.every((grade) => Number.isInteger(grade) && grade >= 0)) return false;
  if (kind === 'date') return grades.every((grade) => grade < DATE_GRADES.length);
  return grades.every((grade) => grade < count) && new Set(grades).size === count;
}

export const LIMITS = {
  title: 60,
  note: 300,
  label: 40,
  name: 20,
  minOptions: 2,
  options: { date: 31, choice: 20 },
  ballots: 100,
  idMin: 4,
  idMax: 30,
  pinMin: 4,
  pinMax: 8,
  // How far ahead a candidate date and a deadline may be, in days.
  dateAhead: 730,
  deadlineAhead: 366,
};

const DAY = 86400e3;

// Characters that do not show or turn text around: controls, zero-width
// spaces and direction marks.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

// `value` as kept: composed (NFC), without hidden characters, its spaces
// run together and trimmed. A note keeps its lines, at most one blank
// line in a row.
export function cleanText(value, { lines = false } = {}) {
  if (typeof value !== 'string') return '';
  const clean = (line) => line.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  const text = value.normalize('NFC');
  if (!lines) return clean(text);
  return text.split(/\r\n|\r|\n/).map(clean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The length a person counts: one for each character, a Hangul syllable
// included.
export function lengthOf(text) {
  return [...text].length;
}

// What two names compare as, so that 'Minsu' and 'minsu ' are one voter.
export function nameKey(name) {
  return cleanText(name).toLowerCase();
}

// A group ID as kept: lower case, spaces made hyphens.
export function normalizeId(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, '-');
}

const ID = /^[0-9a-z가-힣][0-9a-z가-힣_-]*$/u;

// What is wrong with a group ID as `normalizeId` gives it, or null.
export function idProblem(id) {
  const length = lengthOf(id);
  if (length === 0) return '그룹 ID를 넣어 주세요.';
  if (length < LIMITS.idMin || length > LIMITS.idMax) {
    return `그룹 ID는 ${LIMITS.idMin}~${LIMITS.idMax}자로 해 주세요.`;
  }
  if (!ID.test(id)) return '그룹 ID에는 영문 소문자·숫자·한글과 -, _만 쓸 수 있고, 글자나 숫자로 시작해야 해요.';
  return null;
}

// What is wrong with a PIN, or null.
export function pinProblem(pin) {
  if (typeof pin !== 'string' || pin === '') return 'PIN을 넣어 주세요.';
  if (!/^\d+$/.test(pin)) return 'PIN은 숫자로만 넣어 주세요.';
  if (pin.length < LIMITS.pinMin || pin.length > LIMITS.pinMax) {
    return `PIN은 숫자 ${LIMITS.pinMin}~${LIMITS.pinMax}자리로 해 주세요.`;
  }
  return null;
}

// Whether a PIN is one that is guessed first: one digit over and over
// (0000) or digits counting up or down by one (1234, 9876, 7890).
export function weakPin(pin) {
  if (/^(\d)\1*$/.test(pin)) return true;
  const steps = new Set();
  for (let i = 1; i < pin.length; i++) steps.add((pin.charCodeAt(i) - pin.charCodeAt(i - 1) + 10) % 10);
  return steps.size === 1 && (steps.has(1) || steps.has(9));
}

// The problem with a PIN chosen for a new poll, or null.
export function newPinProblem(pin) {
  return pinProblem(pin) || (weakPin(pin) ? '1234나 0000처럼 쉽게 맞힐 수 있는 PIN은 쓸 수 없어요.' : null);
}

function checkOptions(kind, options, today) {
  const most = LIMITS.options[kind];
  if (!Array.isArray(options) || options.length < LIMITS.minOptions) {
    return { problem: `후보를 ${LIMITS.minOptions}개 이상 넣어 주세요.` };
  }
  if (options.length > most) return { problem: `후보는 ${most}개까지 넣을 수 있어요.` };
  if (kind === 'date') {
    const last = addDays(today, LIMITS.dateAhead);
    const dates = options.map((option) => (typeof option === 'string' ? option : option?.date));
    if (!dates.every(isDate)) return { problem: '날짜를 다시 골라 주세요.' };
    if (dates.some((date) => date < today)) return { problem: '지난 날짜는 후보로 넣을 수 없어요.' };
    if (dates.some((date) => date > last)) return { problem: '2년 안의 날짜만 넣을 수 있어요.' };
    const unique = [...new Set(dates)].sort();
    if (unique.length !== dates.length) return { problem: '같은 날짜가 두 번 들어 있어요.' };
    return { options: unique.map((date) => ({ date })) };
  }
  const labels = options.map((option) => cleanText(typeof option === 'string' ? option : option?.label));
  if (labels.some((label) => label === '')) return { problem: '비어 있는 후보가 있어요.' };
  if (labels.some((label) => lengthOf(label) > LIMITS.label)) {
    return { problem: `후보 이름은 ${LIMITS.label}자까지 쓸 수 있어요.` };
  }
  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
    return { problem: '같은 후보가 두 번 들어 있어요.' };
  }
  return { options: labels.map((label) => ({ label })) };
}

// A new poll from what its maker entered, { kind, title, note, options,
// deadline, research }, as { poll } or { problem }: candidate dates sorted,
// text cleaned, the deadline an ISO time or null, and `research: true` only
// for a date poll whose maker asked. `now` is the time in ms.
export function checkPoll(input, now = Date.now()) {
  const kind = KINDS.includes(input?.kind) ? input.kind : null;
  if (!kind) return { problem: '무엇을 정할지 골라 주세요.' };
  const title = cleanText(input.title);
  if (!title) return { problem: '제목을 넣어 주세요.' };
  if (lengthOf(title) > LIMITS.title) return { problem: `제목은 ${LIMITS.title}자까지 쓸 수 있어요.` };
  const note = cleanText(input.note, { lines: true });
  if (lengthOf(note) > LIMITS.note) return { problem: `설명은 ${LIMITS.note}자까지 쓸 수 있어요.` };
  const options = checkOptions(kind, input.options, koreaDate(now));
  if (options.problem) return options;
  let deadline = null;
  if (input.deadline != null && input.deadline !== '') {
    const at = typeof input.deadline === 'string' ? Date.parse(input.deadline) : Number.NaN;
    if (Number.isNaN(at)) return { problem: '마감 시각을 다시 골라 주세요.' };
    if (at <= now) return { problem: '마감 시각은 지금보다 뒤여야 해요.' };
    if (at > now + LIMITS.deadlineAhead * DAY) return { problem: '마감 시각은 1년 안으로 정해 주세요.' };
    deadline = new Date(at).toISOString();
  }
  const research = kind === 'date' && input.research === true;
  return { poll: { kind, title, note, options: options.options, deadline, ...(research && { research }) } };
}

// A ballot for `poll` from what the voter entered, { name, grades,
// research }, as { ballot } or { problem }: for every option in its order,
// its grade or, for a choice, its points, and when the poll asks, the
// voter's RESEARCH_IN or RESEARCH_OUT.
export function checkBallot(input, poll) {
  const name = cleanText(input?.name);
  if (!name) return { problem: '이름을 넣어 주세요. 이 투표는 기명 투표예요.' };
  if (lengthOf(name) > LIMITS.name) return { problem: `이름은 ${LIMITS.name}자까지 쓸 수 있어요.` };
  if (!gradesFit(poll.kind, poll.options.length, input.grades)) {
    return { problem: poll.kind === 'date' ? '모든 후보에 답해 주세요.' : '모든 후보에 순위를 매겨 주세요.' };
  }
  const research = poll.research && [RESEARCH_IN, RESEARCH_OUT].includes(input.research) ? input.research : null;
  return { ballot: { name, grades: [...input.grades], ...(research && { research }) } };
}
