import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays, dateLabel, dayKind, daysIn, holidaysThrough, isDate, koreaDate, monthWeeks, monthsBetween, shiftMonth,
  toggleAll, weekdayDates, weekdayOf,
} from '../site/calendar.js';

const holidays = JSON.parse(readFileSync(new URL('../site/holidays.json', import.meta.url)));

test('the date in Korea turns at midnight there, not in UTC', () => {
  assert.equal(koreaDate(Date.parse('2026-11-20T14:59:00Z')), '2026-11-20');
  assert.equal(koreaDate(Date.parse('2026-11-20T15:00:00Z')), '2026-11-21');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.ok(isDate('2028-02-29'));
  assert.ok(!isDate('2027-02-29'));
  assert.ok(!isDate('2026-1-5'));
});

test('a month runs in weeks from Sunday, padded at both ends', () => {
  // November 2026 starts on a Sunday and has 30 days.
  const november = monthWeeks(2026, 11);
  assert.equal(november.length, 5);
  assert.equal(november[0][0], '2026-11-01');
  assert.deepEqual(november[4], ['2026-11-29', '2026-11-30', null, null, null, null, null]);
  // February 2027 starts on a Monday.
  const february = monthWeeks(2027, 2);
  assert.deepEqual(february[0].slice(0, 2), [null, '2027-02-01']);
  assert.ok(february.every((week) => week.length === 7));
  assert.equal(daysIn(2028, 2), 29);
});

test('months step across years', () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 2), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth({ year: 2027, month: 1 }, -1), { year: 2026, month: 12 });
  assert.equal(monthsBetween({ year: 2026, month: 11 }, { year: 2027, month: 11 }), 12);
});

test('Sundays and holidays are red, Saturdays blue, and each date says its weekday', () => {
  const dates = holidays.dates;
  assert.equal(dayKind('2026-12-25', dates), 'holiday');
  assert.equal(dayKind('2027-02-09', dates), 'holiday');
  assert.equal(dayKind('2026-11-21', dates), 'sat');
  assert.equal(dayKind('2026-11-22', dates), 'sun');
  assert.equal(dayKind('2026-11-20', dates), 'weekday');
  assert.equal(weekdayOf('2026-11-20'), 5);
  assert.equal(dateLabel('2026-12-04', 2026), '12월 4일 (금)');
  assert.equal(dateLabel('2027-02-07', 2026), '2027년 2월 7일 (일)');
});

test("a weekday's name picks its dates still ahead, and takes them out once all are in", () => {
  const fridays = weekdayDates(2026, 11, 5, '2026-11-20');
  assert.deepEqual(fridays, ['2026-11-20', '2026-11-27']);
  const some = toggleAll(new Set(['2026-11-20', '2026-11-03']), fridays);
  assert.deepEqual([...some].sort(), ['2026-11-03', '2026-11-20', '2026-11-27']);
  assert.deepEqual([...toggleAll(some, fridays)], ['2026-11-03']);
  assert.deepEqual([...toggleAll(new Set(['x']), [])], ['x']);
});

test('the holidays name every date they list, through the end of their last year', () => {
  for (const [date, name] of Object.entries(holidays.dates)) {
    assert.ok(isDate(date), date);
    assert.ok(typeof name === 'string' && name.length > 0, date);
  }
  assert.equal(holidaysThrough(holidays.dates), '2027-12-31');
  assert.equal(holidaysThrough({}), null);
});

test('the 2027 holidays leave 119 days off in a five-day week, as the official calendar says', () => {
  let off = 0;
  for (let d = '2027-01-01'; d <= '2027-12-31'; d = addDays(d, 1)) {
    if (dayKind(d, holidays.dates) !== 'weekday') off++;
  }
  assert.equal(off, 119);
});
