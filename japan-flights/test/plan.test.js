import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays, airlineOf, dayOf, fliesOn, flightMarks, flightTimes, leaveFor, monthsAhead, recommend,
  roundTrips, searchLinks, timetableDays,
} from '../site/plan.js';

const data = (name) => JSON.parse(readFileSync(new URL(`../site/data/${name}`, import.meta.url)));
const { routes } = data('routes.json');
const holidays = data('holidays.json').dates;
const route = (id) => routes.find((r) => r.id === id);
const today = '2026-10-11';

test('dates step across months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(dayOf('2026-12-25'), 'fri');
  assert.equal(dayOf('2027-02-07'), 'sun');
});

test('every route has the fields the page reads', () => {
  const ids = new Set();
  for (const r of routes) {
    assert.match(r.id, /^[A-Z]{3}-[A-Z]{3}$/);
    assert.equal(r.id, `${r.origin}-${r.dest}`);
    assert.ok(!ids.has(r.id), `${r.id} appears twice`);
    ids.add(r.id);
    assert.ok(r.city && r.region && r.sources.length > 0, r.id);
    for (const p of r.periods) {
      assert.ok(p.from <= p.to, `${r.id} ${p.from}`);
      assert.ok(p.days === 'daily' || p.days.every((d) => /^(mon|tue|wed|thu|fri|sat|sun)$/.test(d)));
    }
    if (r.periods.length === 0) assert.ok(r.note, `${r.id} needs a note saying why it has no days`);
    for (const flight of r.flights ? [r.flights.out, r.flights.back] : []) {
      assert.match(flight.departs, /^([01]\d|2[0-3]):[0-5]\d$/, r.id);
      assert.match(flight.arrives, /^([01]\d|2[0-3]):[0-5]\d$/, r.id);
      if (flight.number) assert.match(flight.number, /^[A-Z0-9]{2}\d{1,4}$/, r.id);
    }
  }
});

test('a route card gives the flight times as the timetable writes them', () => {
  assert.equal(flightTimes(route('ICN-HIJ')),
    'KE2183 인천 10:35 → 히로시마 12:15 · KE2184 히로시마 13:25 → 인천 15:25');
  assert.equal(flightTimes(route('ICN-OIT')), '인천 09:15 → 오이타 10:50 · 오이타 12:00 → 인천 13:45');
  const gimpo = { ...route('GMP-HND'),
    flights: { out: { departs: '08:00', arrives: '10:20' }, back: { departs: '11:30', arrives: '14:00' } } };
  assert.equal(flightTimes(gimpo), '김포 08:00 → 도쿄 하네다 10:20 · 도쿄 하네다 11:30 → 김포 14:00');
});

test('Oita flies Monday, Wednesday, Friday and Sunday within its season', () => {
  const oita = route('ICN-OIT');
  assert.equal(fliesOn(oita, '2026-10-25'), true); // Sunday, the first day
  assert.equal(fliesOn(oita, '2026-10-24'), false); // the Saturday before
  assert.equal(fliesOn(oita, '2026-10-27'), false); // a Tuesday
  assert.equal(fliesOn(oita, '2027-03-26'), true); // Friday, the last day
  assert.equal(fliesOn(oita, '2027-03-28'), false); // the Sunday after
  assert.equal(timetableDays(oita.periods[0]), '1.3.5.7');
  assert.equal(timetableDays(route('ICN-KIJ').periods[0]), '1234567');
});

test('a round trip needs a flight at both ends', () => {
  const trips = roundTrips(route('ICN-OIT'), '2026-12-21', '2026-12-27', 2, 3);
  assert.deepEqual(trips.map((t) => `${t.depart}>${t.return}`), [
    '2026-12-21>2026-12-23', // Monday to Wednesday
    '2026-12-23>2026-12-25', // Wednesday to Friday
    '2026-12-25>2026-12-27', // Friday to Sunday
    '2026-12-25>2026-12-28', // Friday to Monday
    '2026-12-27>2026-12-30', // Sunday to Wednesday
  ]);
});

test('a round trip may cross from one season into the next', () => {
  const trips = roundTrips(route('ICN-AOJ'), '2026-10-22', '2026-10-22', 3, 3);
  // Thursday in summer (Mon/Wed/Thu/Fri/Sun) to Sunday in winter (Tue/Thu-Sun).
  assert.deepEqual(trips.map((t) => t.return), ['2026-10-25']);
});

test('leave counts the Mondays, Tuesdays and Thursdays that are not holidays', () => {
  assert.deepEqual(leaveFor('2026-12-25', '2026-12-27', holidays), { leave: 0, holidays: ['성탄절'] });
  assert.deepEqual(leaveFor('2026-11-13', '2026-11-15', holidays), { leave: 0, holidays: [] }); // Friday off
  assert.deepEqual(leaveFor('2027-02-06', '2027-02-09', holidays), { leave: 0, holidays: ['설 연휴'] });
  assert.equal(leaveFor('2027-02-05', '2027-02-10', holidays).leave, 0); // Friday and Wednesday off
  assert.equal(leaveFor('2026-11-16', '2026-11-19', holidays).leave, 3); // Monday to Thursday
});

test('a flight back that lands before noon frees the return day', () => {
  const back = { morningArrival: true };
  assert.equal(leaveFor('2026-11-16', '2026-11-19', holidays, back).leave, 2); // back on a Thursday
  assert.equal(leaveFor('2026-11-16', '2026-11-20', holidays, back).leave, 3); // Friday is off anyway

  // Haneda's late flight lands at Incheon before dawn on Monday.
  const fares = [{ route: 'ICN-HND', airline: 'KE', depart: '2026-11-13', return: '2026-11-16', price: 300000,
    seen: today, departs: '20:30', arrives: '04:35' }];
  const trips = recommend({ routes, fares, holidays, today },
    { from: '2026-11-01', to: '2026-11-30', minNights: 3, maxNights: 3, origins: new Set(['ICN']), cities: new Set(['HND']) });
  const leave = (depart) => trips.find((t) => t.depart === depart).leave;
  assert.equal(leave('2026-11-13'), 0);
  assert.equal(leave('2026-11-20'), 1); // the same days without a known arrival
});

test('the 2027 holidays leave 119 days off in a five-day week, as the official calendar says', () => {
  let off = 0;
  for (let d = '2027-01-01'; d <= '2027-12-31'; d = addDays(d, 1)) {
    if (holidays[d] || dayOf(d) === 'sat' || dayOf(d) === 'sun') off++;
  }
  assert.equal(off, 119);
});

test('an evening departure leaves Incheon at 4 p.m. or later, a morning arrival lands before noon', () => {
  const times = (departs, arrives) => ({
    flights: { out: { departs, arrives: '19:00' }, back: { departs: '08:00', arrives } },
  });
  assert.deepEqual(flightMarks(times('16:00', '11:59')), { eveningDeparture: true, morningArrival: true });
  assert.deepEqual(flightMarks(times('15:59', '12:00')), { eveningDeparture: false, morningArrival: false });
  // A route without times, and one that leaves at 09:15 and is back at 13:45.
  assert.deepEqual(flightMarks(route('ICN-KMQ')), { eveningDeparture: false, morningArrival: false });
  assert.deepEqual(flightMarks(route('ICN-OIT')), { eveningDeparture: false, morningArrival: false });
});

const december = { from: '2026-12-01', to: '2026-12-31', minNights: 2, maxNights: 3 };

test('each trip carries the marks its flight times earn', () => {
  const late = {
    ...route('ICN-KIJ'),
    flights: { out: { departs: '18:00', arrives: '20:05' }, back: { departs: '08:30', arrives: '10:50' } },
  };
  const ctx = { routes: routes.map((r) => (r.id === late.id ? late : r)), fares: [], holidays, today };
  const trips = recommend(ctx, { ...december, cities: new Set(['OIT', 'KIJ']) });
  const marks = (id, depart, ret) => {
    const t = trips.find((x) => x.route === id && x.depart === depart && x.return === ret);
    return [t.eveningDeparture, t.morningArrival];
  };
  assert.deepEqual(marks('ICN-OIT', '2026-12-25', '2026-12-27'), [false, false]);
  assert.deepEqual(marks('ICN-KIJ', '2026-12-21', '2026-12-23'), [true, true]);
});

test('the least leave comes first, then known fares, the cheapest first, then the soonest', () => {
  const fares = [
    { route: 'ICN-AOJ', depart: '2026-12-01', return: '2026-12-03', price: 310000, seen: today },
    { route: 'ICN-AOJ', depart: '2026-12-01', return: '2026-12-03', price: 290000, seen: today },
    { route: 'ICN-OIT', depart: '2026-12-25', return: '2026-12-27', price: 250000, seen: today },
    { route: 'ICN-OIT', depart: '2026-10-01', return: '2026-10-03', price: 90000, seen: today },
    { route: 'ICN-XXX', depart: '2026-12-02', return: '2026-12-04', price: 80000, seen: today },
  ];
  const trips = recommend({ routes, fares, holidays, today }, december);
  // The trip that has left and the unknown route's fare are dropped; the cheaper
  // of the two Aomori fares is kept.
  assert.deepEqual(trips.filter((t) => t.fare).map((t) => `${t.route} ${t.depart} ${t.fare.price}`),
    ['ICN-OIT 2026-12-25 250000', 'ICN-AOJ 2026-12-01 290000']);
  // Christmas takes no leave and has a fare; Aomori's Tuesday to Thursday takes two days,
  // so it waits behind every trip that takes less.
  assert.deepEqual([trips[0].route, trips[0].depart], ['ICN-OIT', '2026-12-25']);
  const aomori = trips.findIndex((t) => t.fare && t.route === 'ICN-AOJ');
  assert.ok(trips.slice(0, aomori).every((t) => t.leave < 2 || (t.leave === 2 && t.fare)));
  const order = (t) => [t.leave, t.fare ? t.fare.price : Infinity, t.depart, t.nights];
  for (let i = 1; i < trips.length; i++) {
    const [a, b] = [order(trips[i - 1]), order(trips[i])];
    const k = a.findIndex((x, j) => x !== b[j]);
    assert.ok(k === -1 || a[k] < b[k], `${a} before ${b}`);
  }
});

test('the airlines asked for decide the fares, and only Korean Air needs none', () => {
  const fares = [
    { route: 'ICN-OIT', airline: 'KE', depart: '2026-12-25', return: '2026-12-27', price: 280000, seen: today },
    { route: 'ICN-OIT', airline: '7C', depart: '2026-12-25', return: '2026-12-27', price: 190000, seen: today,
      departs: '18:40' },
    { route: 'ICN-KMQ', airline: 'TW', depart: '2026-12-04', return: '2026-12-06', price: 210000, seen: today },
  ];
  const ctx = { routes, fares, holidays, today };
  const base = { ...december, cities: new Set(['OIT', 'KMQ']) };
  const christmas = (trips) => {
    const t = trips.find((x) => x.route === 'ICN-OIT' && x.depart === '2026-12-25' && x.return === '2026-12-27');
    return [t.airline, t.fare.price, t.eveningDeparture];
  };
  // Every airline: the cheapest fare for the dates, with its airline and the times it flies.
  const all = recommend(ctx, base);
  assert.deepEqual(christmas(all), ['7C', 190000, true]);
  assert.ok(all.some((t) => t.route === 'ICN-KMQ'));
  // Korean Air alone: its own fare, and the trips its schedule allows without one.
  const ke = recommend(ctx, { ...base, airlines: new Set(['KE']) });
  assert.deepEqual(christmas(ke), ['KE', 280000, false]);
  assert.ok(ke.some((t) => t.fare === null && t.airline === 'KE'));
  assert.ok(!ke.some((t) => t.route === 'ICN-KMQ'));
  // Another airline alone: only the trips its fares prove.
  const tw = recommend(ctx, { ...base, airlines: new Set(['TW']) });
  assert.deepEqual(tw.map((t) => `${t.route} ${t.depart} ${t.airline}`), ['ICN-KMQ 2026-12-04 TW']);
  // A fare written without an airline is Korean Air's.
  assert.equal(airlineOf({ route: 'ICN-OIT' }), 'KE');
});

test("another airline's fare without times does not take Korean Air's", () => {
  const late = {
    ...route('ICN-KIJ'),
    flights: { out: { departs: '18:00', arrives: '20:05' }, back: { departs: '08:30', arrives: '10:50' } },
  };
  const ctx = {
    routes: routes.map((r) => (r.id === late.id ? late : r)), holidays, today,
    fares: [{ route: 'ICN-KIJ', airline: 'LJ', depart: '2026-12-21', return: '2026-12-23', price: 150000, seen: today }],
  };
  const trips = recommend(ctx, { ...december, cities: new Set(['KIJ']) });
  const marks = (t) => [t.airline, t.eveningDeparture, t.morningArrival];
  assert.deepEqual(marks(trips.find((t) => t.fare)), ['LJ', false, false]);
  assert.deepEqual(marks(trips.find((t) => !t.fare)), ['KE', true, true]);
});

test('a city takes in every Korean airport, and the airport picked narrows it', () => {
  const filter = { ...december, cities: new Set(['HND']) };
  const ctx = { routes, fares: [], holidays, today };
  const origins = (trips) => [...new Set(trips.map((t) => t.route))].sort();
  assert.deepEqual(origins(recommend(ctx, filter)), ['GMP-HND', 'ICN-HND']);
  assert.deepEqual(origins(recommend(ctx, { ...filter, origins: new Set(['GMP']) })), ['GMP-HND']);
  assert.deepEqual(origins(recommend(ctx, { ...filter, origins: new Set(['ICN']) })), ['ICN-HND']);
});

test('a fare brings in a trip on a route whose days are not known', () => {
  const fares = [{ route: 'ICN-KMQ', depart: '2026-11-20', return: '2026-11-22', price: 250000, seen: today }];
  const filter = { from: '2026-11-01', to: '2026-11-30', minNights: 1, maxNights: 6 };
  const trips = recommend({ routes, fares, holidays, today }, filter);
  assert.deepEqual(trips.filter((t) => t.route === 'ICN-KMQ').map((t) => t.depart), ['2026-11-20']);
});

test('filters on city, leave and budget', () => {
  const fares = [
    { route: 'ICN-OIT', depart: '2026-12-25', return: '2026-12-27', price: 280000, seen: today },
    { route: 'ICN-OIT', depart: '2026-12-21', return: '2026-12-23', price: 240000, seen: today },
  ];
  const base = { ...december, cities: new Set(['OIT']) };
  const ctx = { routes, fares, holidays, today };
  assert.ok(recommend(ctx, base).every((t) => t.route === 'ICN-OIT'));
  // Friday to Sunday takes none, Wednesday and Friday being days off; the fare comes first.
  assert.deepEqual(recommend(ctx, { ...base, maxLeave: 0 }).map((t) => t.depart),
    ['2026-12-25', '2026-12-04', '2026-12-11', '2026-12-18']);
  assert.deepEqual(recommend(ctx, { ...base, maxPrice: 250000 }).map((t) => t.depart), ['2026-12-21']);
});

test('the trips that already left are not offered', () => {
  const filter = { from: '2026-10-01', to: '2026-10-31', minNights: 2, maxNights: 2 };
  const trips = recommend({ routes, fares: [], holidays, today }, filter);
  assert.ok(trips.length > 0);
  assert.ok(trips.every((t) => t.depart >= today));
});

test('months run from this one to the end of the last known schedule', () => {
  assert.deepEqual(monthsAhead(routes, today),
    ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
});

test('search links carry the route and both dates', () => {
  const links = Object.fromEntries(
    searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27').map((l) => [l.name, l.url]));
  assert.equal(links['네이버'],
    'https://flight.naver.com/flights/international/ICN-OIT-20261225/OIT-ICN-20261227?adult=1&fareType=Y');
  assert.equal(links['스카이스캐너'], 'https://www.skyscanner.co.kr/transport/flights/icn/oit/261225/261227/'
    + '?adultsv2=1&cabinclass=economy&rtn=1&preferdirects=true');
  assert.match(links.Google, /q=Flights%20from%20ICN%20to%20OIT%20on%202026-12-25%20through%202026-12-27/);
  assert.match(links['카약'], /\/flights\/ICN-OIT\/2026-12-25\/2026-12-27\?.*airlines=KE;stops=0$/);
  const jeju = searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', '7C').find((l) => l.name === '카약');
  assert.match(jeju.url, /airlines=7C;stops=0$/);
});
