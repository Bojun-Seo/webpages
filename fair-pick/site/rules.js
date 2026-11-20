// What a poll and a ballot may hold, the grades a voter gives and how a
// group ID and PIN look. The page checks a form with these before it sends
// it, and the API checks again what it is sent, so both say the same.

// A poll decides a date, picked on a calendar, or one of the options its
// maker writes down: a place, a menu, anything.
export const KINDS = ['date', 'choice'];

// The grades a voter gives each option, worst first: a grade's index is its
// score. Grade 0 says the voter cannot come, or cannot have it at all.
// `approveAt` is the lowest grade that counts as yes for approval voting.
export const SCALES = {
  date: {
    grades: [
      { label: '안 돼요', short: '✕', tone: 'no' },
      { label: '되긴 해요', short: '△', tone: 'meh' },
      { label: '좋아요', short: '○', tone: 'best' },
    ],
    approveAt: 1,
  },
  choice: {
    grades: [
      { label: '안 돼요', short: '✕', tone: 'no' },
      { label: '별로', short: '별로', tone: 'meh' },
      { label: '보통', short: '보통', tone: 'mid' },
      { label: '좋아요', short: '좋아요', tone: 'good' },
      { label: '최고', short: '최고', tone: 'best' },
    ],
    approveAt: 2,
  },
};

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
const KOREA = 9 * 3600e3;

// The date in Korea at `ms`, 'YYYY-MM-DD'. Korea keeps no summer time.
export function koreaDate(ms = Date.now()) {
  return new Date(ms + KOREA).toISOString().slice(0, 10);
}

// Whether `iso` is a real date written 'YYYY-MM-DD'.
export function isDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const day = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === iso;
}

// The date `days` after `iso`.
export function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

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
// deadline }, as { poll } or { problem }: candidate dates sorted, text
// cleaned, the deadline an ISO time or null. `now` is the time in ms.
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
  return { poll: { kind, title, note, options: options.options, deadline } };
}

// A ballot for `poll` from what the voter entered, { name, grades }, as
// { ballot } or { problem }: a grade for every option, in its order.
export function checkBallot(input, poll) {
  const name = cleanText(input?.name);
  if (!name) return { problem: '이름을 넣어 주세요. 이 투표는 기명 투표예요.' };
  if (lengthOf(name) > LIMITS.name) return { problem: `이름은 ${LIMITS.name}자까지 쓸 수 있어요.` };
  const top = SCALES[poll.kind].grades.length - 1;
  const { grades } = input;
  if (!Array.isArray(grades) || grades.length !== poll.options.length) return { problem: '모든 후보에 답해 주세요.' };
  if (!grades.every((grade) => Number.isInteger(grade) && grade >= 0 && grade <= top)) {
    return { problem: '모든 후보에 답해 주세요.' };
  }
  return { ballot: { name, grades: [...grades] } };
}
