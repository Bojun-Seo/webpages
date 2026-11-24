// What a closed date poll gives to research when its maker asked and every
// voter went along (poll-rules.js, researchStatus): each voter's ✕ △ ○ for
// each date, and of each date only its weekday and whether it is a public
// holiday. No name, title, note, date, group ID or PIN, and no order of the
// voters: the rows are sorted, so that nobody can tell from the record who
// voted first. The page builds it on its maker's phone; the API checks it
// with the same rules before it keeps it. fair-pick/README.md says more.

import { LIMITS, gradesFit } from './poll-rules.js';
import { weekdayOf } from './calendar.js';

export const RESEARCH_VERSION = 1;

// The fields a record has, and the form of the random ID and key a phone
// sends it under: the key, kept as a hash, lets that phone change or
// take back what it sent.
const FIELDS = ['v', 'weekdays', 'holidays', 'answers'];
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

// The record of a closed date poll: `options` its dates in order,
// `ballots` the ballots that count, each with its grades, and `holidays`
// the public holidays as { date: name }, or null when the page could not
// load them, which leaves `holidays` out of the record as null too.
export function donationOf({ options, ballots }, holidays) {
  const answers = ballots.map((ballot) => ballot.grades.join('')).sort().map((row) => [...row].map(Number));
  return {
    v: RESEARCH_VERSION,
    weekdays: options.map(({ date }) => weekdayOf(date)),
    holidays: holidays ? options.map(({ date }) => (holidays[date] ? 1 : 0)) : null,
    answers,
  };
}

// What is wrong with a record as it arrives, or null.
export function donationProblem(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'not a record';
  if (Object.keys(record).some((field) => !FIELDS.includes(field))) return 'unknown field';
  if (record.v !== RESEARCH_VERSION) return 'version';
  const { weekdays, holidays, answers } = record;
  if (!Array.isArray(weekdays) || weekdays.length < LIMITS.minOptions || weekdays.length > LIMITS.options.date) {
    return 'dates';
  }
  if (!weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) return 'weekdays';
  if (holidays !== null && !(Array.isArray(holidays) && holidays.length === weekdays.length
    && holidays.every((flag) => flag === 0 || flag === 1))) return 'holidays';
  if (!Array.isArray(answers) || answers.length < 2 || answers.length > LIMITS.ballots) return 'voters';
  if (!answers.every((row) => gradesFit('date', weekdays.length, row))) return 'answers';
  return null;
}

// Whether `text` is an ID or key a record may be sent under.
export function isToken(text) {
  return typeof text === 'string' && TOKEN.test(text);
}
