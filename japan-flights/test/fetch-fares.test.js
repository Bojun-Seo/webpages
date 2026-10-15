import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays } from '../site/plan.js';
import {
  bagTally, carryOver, checkedBags, connections, keepCheapest, leftOut, localDate, localTime, monthsFrom, pickFares,
  query, retryAfter,
} from '../tools/fetch-fares.js';

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

const hongKong = { id: 'ICN-HKG', origin: 'ICN', dest: 'HKG', utcOffset: 8 };
const toHongKong = (fields) => ticket({ destination: 'HKG', destination_airport: 'HKG', ...fields });

test('the flight back takes the local date where it leaves', () => {
  const late = { success: true, data: [toHongKong({ return_at: '2026-11-15T23:30:00+08:00' })] };
  assert.equal(pickFares(late, hongKong)[0].return, '2026-11-15');
  assert.equal(localDate('2026-11-15T23:30:00+08:00'), '2026-11-16'); // what Korea's clock says
});

test('a flight back that lands after midnight gives the day it lands', () => {
  const response = {
    success: true,
    data: [
      toHongKong({ return_at: '2026-11-15T23:30:00+08:00', duration_back: 215 }),
      toHongKong({ return_at: '2026-11-15T15:00:00+08:00', duration_back: 215 }),
    ],
  };
  const [late, day] = pickFares(response, hongKong);
  assert.deepEqual([late.return, late.arrives, late.lands], ['2026-11-15', '04:05', '2026-11-16']);
  assert.deepEqual([day.return, day.arrives, 'lands' in day], ['2026-11-15', '19:35', false]);
});

test('a timestamp becomes the local time in Korea', () => {
  assert.equal(localTime('2026-11-13T09:15:00+09:00'), '09:15');
  assert.equal(localTime('2026-11-12T23:20:00Z'), '08:20');
  assert.equal(localTime('2026-11-15T23:30:00+08:00'), '00:30');
});

test('months run on from the current one, across a year', () => {
  assert.deepEqual(monthsFrom('2026-11-30', 3), ['2026-11', '2026-12', '2027-01']);
});

test("every airline's round trips with no more than one connection each way are kept, with their times", () => {
  const response = {
    success: true,
    currency: 'krw',
    data: [
      ticket({}),
      ticket({ airline: '7C', price: 150000, departure_at: '2026-11-13T18:40:00+09:00', duration_to: 85, duration_back: 95 }),
      ticket({ transfers: 1, price: 180000 }),
      ticket({ return_transfers: 1, price: 190000 }),
      ticket({ transfers: 2, price: 170000 }),
      ticket({ return_at: undefined, price: 120000 }),
      ticket({ airline: undefined, price: 110000 }),
      ticket({ departure_at: '2026-11-12T23:20:00Z', return_at: '2026-11-16T02:35:00Z', price: 251000.4 }),
    ],
  };
  const fare = (fields) => ({ route: 'ICN-OIT', ...fields });
  assert.deepEqual(pickFares(response, oita), [
    fare({ airline: 'KE', depart: '2026-11-13', return: '2026-11-15', price: 236500, departs: '09:15' }),
    fare({ airline: '7C', depart: '2026-11-13', return: '2026-11-15', price: 150000, departs: '18:40',
      arrivesAbroad: '20:05', arrives: '13:35' }),
    fare({ airline: 'KE', depart: '2026-11-13', return: '2026-11-15', price: 180000, departs: '09:15', stops: [1, 0] }),
    fare({ airline: 'KE', depart: '2026-11-13', return: '2026-11-15', price: 190000, departs: '09:15', stops: [0, 1] }),
    fare({ airline: 'KE', depart: '2026-11-13', return: '2026-11-16', price: 251000, departs: '08:20' }),
  ]);
});

test('the flight out lands abroad at local time, with its day when that is a later one', () => {
  const vietnam = { id: 'ICN-HAN', origin: 'ICN', dest: 'HAN', utcOffset: 7 };
  const toHanoi = (departure_at, duration_to) => ticket({ destination: 'HAN', destination_airport: 'HAN',
    departure_at, duration_to, return_at: '2026-11-16T10:00:00+07:00' });
  const [day, night] = pickFares({ success: true, data: [toHanoi('2026-11-13T10:00:00+09:00', 290),
    toHanoi('2026-11-13T22:30:00+09:00', 300)] }, vietnam);
  assert.deepEqual([day.arrivesAbroad, 'landsAbroad' in day], ['12:50', false]);
  assert.deepEqual([night.arrivesAbroad, night.landsAbroad], ['01:30', '2026-11-14']);
});

test("a ticket counts only between the route's own airports", () => {
  // Should the API answer for all of Seoul and Tokyo, only Gimpo-Haneda stays.
  const haneda = { id: 'GMP-HND', origin: 'GMP', dest: 'HND' };
  const tokyo = (from, to, price) =>
    ticket({ destination: 'TYO', origin_airport: from, destination_airport: to, price });
  const response = {
    success: true,
    data: [tokyo('ICN', 'NRT', 200000), tokyo('GMP', 'HND', 310000), tokyo('ICN', 'HND', 250000), tokyo('GMP', 'NRT', 220000)],
  };
  assert.deepEqual(pickFares(response, haneda).map((f) => f.price), [310000]);
  assert.deepEqual(response.data.map((t) => leftOut(t, haneda)), ['ICN-NRT', null, 'ICN-HND', 'GMP-NRT']);
  assert.equal(leftOut(ticket({ transfers: 2 }), oita), 'connections');
  assert.equal(leftOut(ticket({ price: 0 }), oita), 'incomplete');
});

test('only the cheapest fare for each route, pair of dates and airline is kept', () => {
  const fare = (airline, price, ret = '2026-11-15') =>
    ({ route: 'ICN-OIT', airline, depart: '2026-11-13', return: ret, price });
  assert.deepEqual(keepCheapest([fare('KE', 300000), fare('7C', 150000), fare('KE', 280000), fare('KE', 260000, '2026-11-16')]),
    [fare('KE', 280000), fare('7C', 150000), fare('KE', 260000, '2026-11-16')]);
});

test('a connecting fare, and one back by noon or on another day, is kept apart from the cheapest', () => {
  const fare = (price, fields) => ({ route: 'ICN-OIT', airline: 'KE', depart: '2026-11-13', return: '2026-11-15',
    price, ...fields });
  const kept = keepCheapest([fare(300000, { arrives: '10:50' }), fare(250000, { arrives: '15:00' }),
    fare(200000, { stops: [1, 0] }), fare(260000, { arrives: '04:35', lands: '2026-11-16' })]);
  assert.deepEqual(kept.map((f) => f.price), [300000, 250000, 200000, 260000]);
});

// The link of a real ticket, which says in its static_fare_key what the fare includes.
const link = (bags) => '/search/ICN1410NRT22101'
  + '?t=TW17920086001792017600000150ICNNRT17927055001792715100000160NRTICN_09b109b912e1556e10d7a64a938bcc92_14980'
  + `&static_fare_key=TY%7CP1_JW%7CH1%7C${bags}%7CCH0%7CR0%7CTBC1&expected_price_currency=krw`;

test('the link of a ticket tells whether its fare includes a checked bag', () => {
  assert.equal(checkedBags(link('L0')), 0);
  assert.equal(checkedBags(link('L1_1_15')), 1);
  assert.equal(checkedBags(link('L1_2_0')), 2);
  assert.equal(checkedBags('/search/ICN1410NRT22101'), null);
  assert.equal(checkedBags(undefined), null);
  const response = { success: true, data: [ticket({ link: link('L0') }), ticket({ link: link('L1_1_15'), price: 260000 }),
    ticket({ price: 270000 })] };
  const fares = pickFares(response, oita);
  assert.deepEqual(fares.map((f) => f.bags), [0, 1, undefined]);
  assert.equal(bagTally([...fares, { airline: '7C', bags: 0 }]), '7C 1/0/0, KE 1/1/1');
});

test('the link of a real ticket lists its ways out and back, and so says where it connects', () => {
  const toNarita = ticket({ destination: 'TYO', destination_airport: 'NRT', link: link('L0') });
  assert.deepEqual(connections(toNarita), [[], []]);
  // Jetstar Japan from Incheon to Narita through Kansai, and back through Kagoshima.
  const through = ticket({ airline: 'GK', destination: 'TYO', destination_airport: 'NRT', transfers: 1,
    return_transfers: 1, link: '/search/ICN1810NRT26101?t=GK17923626001792448700001435ICNKIXNRT'
      + '17930190001793044200000420NRTKOJICN_ed75cbc3f2cf3ba1c32033b311ad3ba2_23920&search_date=09102026'
      + '&static_fare_key=TY%7CP1%7CH1%7CL0%7CCH0%7CR0%7CTBC0&origin_airports=0,1&destination_airports=0,1' });
  assert.deepEqual(connections(through), [['KIX'], ['KOJ']]);
  // Peach to Haneda, and back from Haneda to Kobe, then from Kansai: one connection that changes airports.
  const change = ticket({ airline: 'MM', destination: 'TYO', destination_airport: 'HND', return_transfers: 1,
    link: '/search/ICN2510HND29101?t=MM17929686001792976100000125ICNHND17932584001793281800000390HNDUKBKIXICN'
      + '_635a3012c0e3b1b1ee11b556ad39cdfe_38201&static_fare_key=TY%7CP0%7CH1%7CL0%7CCH0%7CR0%7CTBC0' });
  assert.deepEqual(connections(change), [[], ['UKB', 'KIX']]);
});

// A link that lists a ticket's ways as a real one does: each the Unix times it leaves and lands, its
// minutes on the way and every airport it passes, after its airline's code where that changes.
const listing = (...ways) => '/search/ICN1311OIT15111?t='
  + ways.map(([airline, ...airports], i) => `${i > 0 && ways[i - 1][0] === airline ? '' : airline}`
    + `17923068001792312500000095${airports.join('')}`).join('')
  + '_e44efbf0187589ac43b5421875bdebd7_25135';

test('a connecting fare names the airports it connects at, where its link lists its ways', () => {
  const nonstop = ticket({ link: listing(['7C', 'ICN', 'OIT'], ['7C', 'OIT', 'ICN']) });
  const out = ticket({ transfers: 1, price: 180000, link: listing(['CI', 'ICN', 'TPE', 'OIT'], ['KE', 'OIT', 'ICN']) });
  const both = ticket({ transfers: 1, return_transfers: 1, price: 170000,
    link: listing(['CX', 'ICN', 'HKG', 'OIT'], ['IT', 'OIT', 'TPE', 'ICN']) });
  assert.deepEqual(connections(out), [['TPE'], []]);
  assert.deepEqual(connections(both), [['HKG'], ['TPE']]);
  assert.deepEqual(pickFares({ success: true, data: [nonstop, out, both] }, oita).map((f) => f.via),
    [undefined, [['TPE'], []], [['HKG'], ['TPE']]]);
  // Ways that make other connections than the ticket says, a way out that ends elsewhere, or none
  // listed say nothing.
  assert.equal(connections(ticket({ transfers: 1, link: nonstop.link })), null);
  assert.equal(connections(ticket({ transfers: 1, link: listing(['MU', 'ICN', 'PVG', 'TPE'], ['CI', 'OIT', 'ICN']) })),
    null);
  assert.equal(connections(ticket({ transfers: 1 })), null);
});

test('a ticket on an airline left out does not count, by its own airline or one its link names', () => {
  // Jeju Air out, and China Eastern back through Shanghai or Thai AirAsia back.
  const back = ticket({ airline: '7C', return_transfers: 1,
    link: listing(['7C', 'ICN', 'OIT'], ['MU', 'OIT', 'PVG', 'ICN']) });
  const thai = ticket({ airline: '7C', link: listing(['7C', 'ICN', 'OIT'], ['FD', 'OIT', 'ICN']) });
  const out = [ticket({ airline: 'MU' }), back, ticket({ airline: '9C', transfers: 1 }), ticket({ airline: 'AK' }), thai];
  assert.deepEqual(out.map((t) => leftOut(t, oita)), ['airline', 'airline', 'airline', 'airline', 'airline']);
  // China Airlines is Taiwan's, and Hong Kong Airlines Hong Kong's.
  const kept = [ticket({ airline: 'CI' }), ticket({ airline: 'HX', link: listing(['HX', 'ICN', 'OIT'], ['HX', 'OIT', 'ICN']) })];
  assert.deepEqual(kept.map((t) => leftOut(t, oita)), [null, null]);
  assert.deepEqual(pickFares({ success: true, data: [...out, ...kept] }, oita).map((f) => f.airline), ['CI', 'HX']);
});

test('the cheapest fare with a checked bag is kept apart from the cheapest without', () => {
  const fare = (price, bags) => ({ route: 'ICN-OIT', airline: 'MM', depart: '2026-11-13', return: '2026-11-15', price,
    ...(bags === 0 ? { bags } : {}) });
  assert.deepEqual(keepCheapest([fare(120000, 0), fare(110000, 0), fare(190000), fare(170000)]),
    [fare(110000, 0), fare(170000)]);
});

test('Retry-After says how long to wait, in seconds or as a date, a minute if neither, five at most', () => {
  const now = Date.parse('2026-10-13T08:00:00Z');
  assert.equal(retryAfter('120', now), 120);
  assert.equal(retryAfter('Tue, 13 Oct 2026 08:01:30 GMT', now), 90);
  assert.equal(retryAfter(null, now), 60);
  assert.equal(retryAfter('', now), 60);
  assert.equal(retryAfter('soon', now), 60);
  assert.equal(retryAfter('3600', now), 300);
  assert.equal(retryAfter('-5', now), 0);
});

test('a query the API refuses with 429 is asked again after the wait, twice at most', async (t) => {
  const answer = (status, retry) => ({ ok: status === 200, status, headers: { get: () => retry },
    json: async () => ({ success: true, data: [] }) });
  const ask = async (statuses) => {
    const waits = [];
    let i = 0;
    t.mock.method(globalThis, 'fetch', async () => answer(statuses[Math.min(i++, statuses.length - 1)], '7'));
    t.mock.method(console, 'warn', () => {});
    try {
      return { result: await query(oita, '2026-11', '2026-11', 'token', async (ms) => { waits.push(ms); }), waits };
    } catch (error) {
      return { error: error.message, waits };
    } finally {
      globalThis.fetch.mock.restore();
      console.warn.mock.restore();
    }
  };
  assert.deepEqual(await ask([429, 200]), { result: { success: true, data: [] }, waits: [7000] });
  assert.deepEqual(await ask([429, 429, 429]), { error: 'HTTP 429', waits: [7000, 7000] });
  assert.deepEqual(await ask([500]), { error: 'HTTP 500', waits: [] });
});

test('an error response yields no fares', () => {
  assert.deepEqual(pickFares({ success: false, error: 'Unauthorized' }, oita), []);
  assert.deepEqual(pickFares(null, oita), []);
});

test('without a token the script writes an empty file and succeeds', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'fares-')), 'live-fares.json');
  const script = fileURLToPath(new URL('../tools/fetch-fares.js', import.meta.url));
  const env = { ...process.env };
  delete env.TRAVELPAYOUTS_TOKEN;
  execFileSync(process.execPath, [script, '--out', out], { env, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { updated: null, fares: [] });
});

test('fares fetched before stand in for the queries the API did not answer', () => {
  const fare = (route, depart, ret, price) => ({ route, airline: '7C', depart, return: ret, price });
  const before = [fare('ICN-NRT', '2026-11-13', '2026-11-15', 150000), fare('ICN-NRT', '2026-11-27', '2026-12-01', 160000),
    fare('ICN-KIX', '2026-11-13', '2026-11-15', 140000), fare('ICN-NRT', '2026-10-09', '2026-10-11', 90000)];
  const unanswered = [{ route: 'ICN-NRT', out: '2026-11', back: '2026-12' }, { route: 'ICN-NRT', out: '2026-10', back: '2026-10' }];
  // A query's fares leave in its month out and come back in its month back; those that have left stay out.
  assert.deepEqual(carryOver(before, unanswered, '2026-10-13').map((f) => f.price), [160000]);
});

// Runs the script on a route to Narita and one to Kansai, for this month, against an API that `answer`
// stands in for, with `previous` as the fares fetched before and `marker` as the partner marker; gives
// the fares it wrote and its exit code.
function fetchWith(answer, previous, marker) {
  const dir = mkdtempSync(join(tmpdir(), 'fares-'));
  const path = (name) => join(dir, name);
  writeFileSync(path('stub.mjs'), `globalThis.fetch = async (url) => (${answer})(new URL(url));\n`);
  writeFileSync(path('routes.json'), JSON.stringify({ origins: ['ICN'], destinations: [
    { dest: 'NRT', city: '도쿄 나리타', country: 'JP' }, { dest: 'KIX', city: '오사카', country: 'JP' }] }));
  writeFileSync(path('previous.json'), JSON.stringify(previous));
  const script = fileURLToPath(new URL('../tools/fetch-fares.js', import.meta.url));
  let status = 0;
  try {
    execFileSync(process.execPath, ['--import', path('stub.mjs'), script, '--routes', path('routes.json'),
      '--out', path('out.json'), '--months', '1', '--previous', path('previous.json')],
    { env: { ...process.env, TRAVELPAYOUTS_TOKEN: 'token', TRAVELPAYOUTS_MARKER: marker || '' }, stdio: 'pipe' });
  } catch (error) {
    status = error.status;
  }
  return { doc: JSON.parse(readFileSync(path('out.json'), 'utf8')), status };
}

test('when the API answers no query, the fares fetched before stay as they were, with the marker set now', () => {
  const today = localDate(new Date().toISOString());
  const previous = { updated: '2026-10-12T21:40:00.000Z', source: 'Aviasales', marker: '111111', fares: [
    { route: 'ICN-NRT', airline: '7C', depart: today, return: addDays(today, 2), price: 150000 }] };
  const refusing = `() => ({ ok: false, status: 429, headers: { get: () => '0' } })`;
  assert.deepEqual(fetchWith(refusing, previous, '123456'), { doc: { ...previous, marker: '123456' }, status: 1 });
  const { marker, ...unmarked } = previous;
  assert.deepEqual(fetchWith(refusing, previous), { doc: unmarked, status: 1 });
});

test('when the API answers some queries, the fares fetched before stand in for the others', () => {
  const today = localDate(new Date().toISOString());
  const ret = addDays(today, 2);
  // The China Eastern fare was fetched before the page left out mainland Chinese airlines.
  const previous = { updated: '2026-10-12T21:40:00.000Z', source: 'Aviasales', fares: [
    { route: 'ICN-NRT', airline: '7C', depart: today, return: ret, price: 99000 },
    { route: 'ICN-KIX', airline: 'MM', depart: today, return: ret, price: 120000 },
    { route: 'ICN-KIX', airline: 'MU', depart: today, return: ret, price: 110000 }] };
  // Narita answers with a fare; Kansai fails.
  const narita = `(url) => url.searchParams.get('destination') === 'KIX'
    ? { ok: false, status: 500, headers: { get: () => null } }
    : { ok: true, status: 200, json: async () => ({ success: true, data: [{ origin: 'SEL', destination: 'TYO',
      origin_airport: 'ICN', destination_airport: 'NRT', airline: '7C', price: 150000, transfers: 0,
      return_transfers: 0, departure_at: '${today}T09:00:00+09:00', return_at: '${ret}T12:00:00+09:00' }] }) }`;
  const { doc, status } = fetchWith(narita, previous, '123456');
  assert.equal(status, 0);
  assert.notEqual(doc.updated, previous.updated);
  assert.equal(doc.marker, '123456');
  assert.deepEqual(doc.fares.map((f) => `${f.route} ${f.airline} ${f.price}`), ['ICN-NRT 7C 150000', 'ICN-KIX MM 120000']);
});
