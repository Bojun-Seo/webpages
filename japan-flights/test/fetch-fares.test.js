import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDate, monthsFrom, pickFares } from '../tools/fetch-fares.js';

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

test('months run on from the current one, across a year', () => {
  assert.deepEqual(monthsFrom('2026-11-30', 3), ['2026-11', '2026-12', '2027-01']);
});

test('only Korean Air nonstop round trips are kept', () => {
  const response = {
    success: true,
    currency: 'krw',
    data: [
      ticket({}),
      ticket({ airline: '7C', price: 150000 }),
      ticket({ transfers: 1, price: 180000 }),
      ticket({ return_transfers: 1, price: 190000 }),
      ticket({ return_at: undefined, price: 120000 }),
      ticket({ departure_at: '2026-11-12T23:20:00Z', return_at: '2026-11-16T02:35:00Z', price: 251000.4 }),
    ],
  };
  assert.deepEqual(pickFares(response, oita, '2026-10-11'), [
    { route: 'ICN-OIT', depart: '2026-11-13', return: '2026-11-15', price: 236500, seen: '2026-10-11', source: 'Aviasales' },
    { route: 'ICN-OIT', depart: '2026-11-13', return: '2026-11-16', price: 251000, seen: '2026-10-11', source: 'Aviasales' },
  ]);
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
