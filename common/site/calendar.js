// Dates in Korea, and a month as a Korean wall calendar shows it: weeks
// that start on Sunday, Sundays and public holidays in red, Saturdays in
// blue. Dates are 'YYYY-MM-DD' strings and months { year, month } with
// month 1 to 12, worked out in UTC so that the viewer's time zone cannot
// shift a day. The public holidays are in holidays.json beside this file.

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const DAY = 86400e3;
const KOREA = 9 * 3600e3;

const pad = (n) => String(n).padStart(2, '0');

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

export function isoOf(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function monthOf(iso) {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

// 0 for Sunday to 6 for Saturday.
export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function daysIn(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The month `n` months after `at`.
export function shiftMonth(at, n) {
  const index = at.year * 12 + (at.month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// How many months `to` is after `from`.
export function monthsBetween(from, to) {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

// The weeks of a month, from Sunday: seven cells each, a date or null for
// a day of the month before or after.
export function monthWeeks(year, month) {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells = [
    ...Array(lead).fill(null),
    ...Array.from({ length: daysIn(year, month) }, (_, i) => isoOf(year, month, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

// How the calendar marks a date: 'holiday' for a public holiday in
// `holidays` ({ date: name }), 'sun', 'sat' or 'weekday'.
export function dayKind(iso, holidays) {
  if (holidays[iso]) return 'holiday';
  const weekday = weekdayOf(iso);
  return weekday === 0 ? 'sun' : weekday === 6 ? 'sat' : 'weekday';
}

// '12월 4일 (금)', with the year in front when it is not `thisYear`.
export function dateLabel(iso, thisYear) {
  const { year, month } = monthOf(iso);
  const text = `${month}월 ${Number(iso.slice(8, 10))}일 (${WEEKDAYS[weekdayOf(iso)]})`;
  return year === thisYear ? text : `${year}년 ${text}`;
}

// The dates of a month on `weekday`, from `from` on.
export function weekdayDates(year, month, weekday, from) {
  const dates = [];
  for (let day = 1; day <= daysIn(year, month); day++) {
    const iso = isoOf(year, month, day);
    if (iso >= from && weekdayOf(iso) === weekday) dates.push(iso);
  }
  return dates;
}

// `picked` with every one of `dates` taken out if all of them are in it,
// and put in otherwise: what pressing a weekday's name does.
export function toggleAll(picked, dates) {
  const next = new Set(picked);
  const all = dates.length > 0 && dates.every((date) => next.has(date));
  for (const date of dates) {
    if (all) next.delete(date);
    else next.add(date);
  }
  return next;
}

// The last date the holiday list speaks for: the end of the last year it
// lists a holiday in, since each year's holidays come out together.
export function holidaysThrough(holidays) {
  const dates = Object.keys(holidays).sort();
  return dates.length ? `${dates[dates.length - 1].slice(0, 4)}-12-31` : null;
}
