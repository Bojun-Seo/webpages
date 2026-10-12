import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepCheapest, localDate, localTime, monthsFrom, pickFares } from '../tools/fetch-fares.js';

const oita = { id: 'ICN-OIT', origin: 'ICN', dest: 'OIT' };

// The shape the Aviasales Data API documents for prices_for_dates.
const ticket = (fields) => ({
  origin: 'SEL',
  destination: 'OIT',
  origin_airport: 'ICN',
  destination_airport: 'OIT',
  price: 236500,
  airline: 'KE',
  flight_number: '2181',
  departure_at: '2026-11-13T09:15:00+09:00',
  return_at: '2026-11-15T12:00:00+09:00',
  transfers: 0,
  return_transfers: 0,
  duration: 200,
  link: '/search/SEL1311OIT15111',
  ...fields,
});

test('a timestamp becomes the local date in Korea and Japan', () => {
  assert.equal(localDate('2026-11-13T08:20:00+09:00'), '2026-11-13');
  assert.equal(localDate('2026-11-12T23:20:00Z'), '2026-11-13');
  assert.equal(localDate('2026-11-13T14:59:00Z'), '2026-11-13');
});

test('the flight back takes the local date where it leaves', () => {
  const hongKong = { id: 'ICN-HKG', origin: 'ICN', dest: 'HKG', utcOffset: 8 };
  const late = { success: true, data: [ticket({ return_at: '2026-11-15T23:30:00+08:00' })] };
  assert.equal(pickFares(late, hongKong, '2026-10-11')[0].return, '2026-11-15');
  assert.equal(localDate('2026-11-15T23:30:00+08:00'), '2026-11-16'); // what Korea's clock says
});

test('a timestamp and some minutes after it become the local time', () => {
  assert.equal(localTime('2026-11-13T09:15:00+09:00'), '09:15');
  assert.equal(localTime('2026-11-12T23:20:00Z'), '08:20');
  assert.equal(localTime('2026-11-15T12:00:00+09:00', 115), '13:55');
});

test('months run on from the current one, across a year', () => {
  assert.deepEqual(monthsFrom('2026-11-30', 3), ['2026-11', '2026-12', '2027-01']);
});

test("every airline's nonstop round trips are kept, with their times", () => {
  const response = {
    success: true,
    currency: 'krw',
    data: [
      ticket({}),
      ticket({ airline: '7C', price: 150000, departure_at: '2026-11-13T18:40:00+09:00', duration_back: 95 }),
      ticket({ transfers: 1, price: 180000 }),
      ticket({ return_transfers: 1, price: 190000 }),
      ticket({ return_at: undefined, price: 120000 }),
      ticket({ airline: undefined, price: 110000 }),
      ticket({ departure_at: '2026-11-12T23:20:00Z', return_at: '2026-11-16T02:35:00Z', price: 251000.4 }),
    ],
  };
  const fare = (fields) => ({ route: 'ICN-OIT', seen: '2026-10-11', source: 'Aviasales', ...fields });
  assert.deepEqual(pickFares(response, oita, '2026-10-11'), [
    fare({ airline: 'KE', depart: '2026-11-13', return: '2026-11-15', price: 236500, departs: '09:15' }),
    fare({ airline: '7C', depart: '2026-11-13', return: '2026-11-15', price: 150000, departs: '18:40', arrives: '13:35' }),
    fare({ airline: 'KE', depart: '2026-11-13', return: '2026-11-16', price: 251000, departs: '08:20' }),
  ]);
});

test('only the cheapest fare for each route, pair of dates and airline is kept', () => {
  const fare = (airline, price, ret = '2026-11-15') =>
    ({ route: 'ICN-OIT', airline, depart: '2026-11-13', return: ret, price });
  assert.deepEqual(keepCheapest([fare('KE', 300000), fare('7C', 150000), fare('KE', 280000), fare('KE', 260000, '2026-11-16')]),
    [fare('KE', 280000), fare('7C', 150000), fare('KE', 260000, '2026-11-16')]);
});

test('an error response yields no fares', () => {
  assert.deepEqual(pickFares({ success: false, error: 'Unauthorized' }, oita, '2026-10-11'), []);
  assert.deepEqual(pickFares(null, oita, '2026-10-11'), []);
});

test('without a token the script writes an empty file and succeeds', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'fares-')), 'live-fares.json');
  const script = fileURLToPath(new URL('../tools/fetch-fares.js', import.meta.url));
  const env = { ...process.env };
  delete env.TRAVELPAYOUTS_TOKEN;
  execFileSync(process.execPath, [script, '--out', out], { env, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { updated: null, fares: [] });
});
