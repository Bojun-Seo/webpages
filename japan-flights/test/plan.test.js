import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays, airlineOf, bagFee, dayOf, fliesOn, flightMarks, leaveFor, monthsAhead, recommend,
  roundTrips, searchLinks,
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
    assert.ok(r.city && r.sources.length > 0, r.id);
    assert.match(r.country, /^(JP|TW|HK|MO)$/, r.id);
    for (const p of r.periods) {
      assert.ok(p.from <= p.to, `${r.id} ${p.from}`);
      assert.ok(p.days === 'daily' || p.days.every((d) => /^(mon|tue|wed|thu|fri|sat|sun)$/.test(d)));
    }
    if (r.periods.length === 0) assert.ok(r.note, `${r.id} needs a note saying why it has no days`);
    if ('utcOffset' in r) assert.ok(Number.isInteger(r.utcOffset) && r.utcOffset !== 9, r.id);
    for (const flight of r.flights ? [r.flights.out, r.flights.back] : []) {
      assert.match(flight.departs, /^([01]\d|2[0-3]):[0-5]\d$/, r.id);
      assert.match(flight.arrives, /^([01]\d|2[0-3]):[0-5]\d$/, r.id);
      if (flight.number) assert.match(flight.number, /^[A-Z0-9]{2}\d{1,4}$/, r.id);
    }
  }
});

test('Oita flies Monday, Wednesday, Friday and Sunday within its season', () => {
  const oita = route('ICN-OIT');
  assert.equal(fliesOn(oita, '2026-10-25'), true); // Sunday, the first day
  assert.equal(fliesOn(oita, '2026-10-24'), false); // the Saturday before
  assert.equal(fliesOn(oita, '2026-10-27'), false); // a Tuesday
  assert.equal(fliesOn(oita, '2027-03-26'), true); // Friday, the last day
  assert.equal(fliesOn(oita, '2027-03-28'), false); // the Sunday after
});

test('a round trip needs a flight at both ends', () => {
  const trips = roundTrips(route('ICN-OIT'), '2026-12-21', '2026-12-27', [2, 3]);
  assert.deepEqual(trips.map((t) => `${t.depart}>${t.return}`), [
    '2026-12-21>2026-12-23', // Monday to Wednesday
    '2026-12-23>2026-12-25', // Wednesday to Friday
    '2026-12-25>2026-12-27', // Friday to Sunday
    '2026-12-25>2026-12-28', // Friday to Monday
    '2026-12-27>2026-12-30', // Sunday to Wednesday
  ]);
});

test('a round trip may cross from one season into the next', () => {
  const trips = roundTrips(route('ICN-AOJ'), '2026-10-22', '2026-10-22', [3]);
  // Thursday in summer (Mon/Wed/Thu/Fri/Sun) to Sunday in winter (Tue/Thu-Sun).
  assert.deepEqual(trips.map((t) => t.return), ['2026-10-25']);
});

test('trips run two to six nights, never one, and the lengths picked narrow them', () => {
  const fares = [1, 2].map((nights) => ({ route: 'ICN-KMQ', depart: '2026-11-20',
    return: addDays('2026-11-20', nights), price: 200000, seen: today }));
  const ctx = { routes, fares, holidays, today };
  const november = { from: '2026-11-01', to: '2026-11-30' };
  const lengths = (filter) => [...new Set(recommend(ctx, { ...november, ...filter }).map((t) => t.nights))]
    .sort((a, b) => a - b);
  assert.deepEqual(lengths({}), [2, 3, 4, 5, 6]);
  assert.deepEqual(lengths({ nights: new Set([3, 5]) }), [3, 5]);
  assert.deepEqual(lengths({ nights: new Set([1, 4]) }), [4]);
  assert.deepEqual(recommend(ctx, { ...november, cities: new Set(['KMQ']) }).map((t) => t.nights), [2]);
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
    { from: '2026-11-01', to: '2026-11-30', nights: new Set([3]), origins: new Set(['ICN']), cities: new Set(['HND']) });
  const leave = (depart) => trips.find((t) => t.depart === depart).leave;
  assert.equal(leave('2026-11-13'), 0);
  assert.equal(leave('2026-11-20'), 1); // the same days without a known arrival
});

test('a flight back that lands after midnight frees the day it lands, not the day it leaves', () => {
  // Hong Kong at 23:30, Incheon at 04:05 the next day.
  const fare = (ret, lands) => ({ route: 'ICN-HKG', airline: 'CX', depart: '2026-11-20', return: ret,
    price: 400000, seen: today, departs: '10:00', arrives: '04:05', lands });
  const fares = [fare('2026-11-22', '2026-11-23'), fare('2026-11-23', '2026-11-24')];
  const trips = recommend({ routes, fares, holidays, today },
    { from: '2026-11-01', to: '2026-11-30', airlines: new Set(['CX']) });
  const trip = (ret) => trips.find((t) => t.return === ret);
  assert.deepEqual([trip('2026-11-22').lands, trip('2026-11-22').leave], ['2026-11-23', 0]); // back Monday morning
  assert.deepEqual([trip('2026-11-23').lands, trip('2026-11-23').leave], ['2026-11-24', 1]); // Monday away
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

const december = { from: '2026-12-01', to: '2026-12-31', nights: new Set([2, 3]) };

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

test('each cabin with a fare gets its own trip, and the cabins picked narrow them', () => {
  const fare = (airline, price, cabin) => ({ route: 'ICN-HND', airline, depart: '2026-11-20', return: '2026-11-22',
    price, seen: today, ...(cabin ? { cabin } : {}) });
  const fares = [fare('MM', 180000), fare('KE', 690000, 'business'), fare('KE', 720000, 'business'), fare('NH', 990000, 'first')];
  const ctx = { routes, fares, holidays, today };
  const november = { from: '2026-11-01', to: '2026-11-30', cities: new Set(['HND']), origins: new Set(['ICN']) };
  const rows = (filter) => recommend(ctx, { ...november, ...filter })
    .filter((t) => t.depart === '2026-11-20' && t.return === '2026-11-22')
    .map((t) => `${t.cabin} ${t.airline} ${t.fare ? t.fare.price : '?'}`);
  assert.deepEqual(rows({}), ['economy MM 180000', 'business KE 690000', 'first NH 990000']);
  assert.deepEqual(rows({ cabins: new Set(['business', 'first']) }), ['business KE 690000', 'first NH 990000']);
  // Without economy, Korean Air's days bring in trips in business, without a fare; first has only fares.
  const business = recommend(ctx, { ...november, cabins: new Set(['business']) });
  assert.ok(business.every((t) => t.cabin === 'business') && business.some((t) => !t.fare));
  assert.ok(recommend(ctx, { ...november, cabins: new Set(['first']) }).every((t) => t.fare && t.cabin === 'first'));
  assert.ok(recommend(ctx, november).some((t) => !t.fare && t.cabin === 'economy'));
});

test('baggage.json has a usual fee for every country flown to, and a fee with a source for each airline', () => {
  const baggage = data('baggage.json');
  for (const r of routes) assert.ok(baggage.usual[r.country] > 0, r.id);
  for (const code of baggage.included) assert.ok(/^[A-Z0-9]{2}$/.test(code) && !(code in baggage.airlines), code);
  for (const [code, airline] of Object.entries(baggage.airlines)) {
    assert.match(code, /^[A-Z0-9]{2}$/);
    assert.ok(Number.isInteger(airline.fee) && airline.fee > 0 && airline.source.url, code);
  }
});

test('the bag fee follows the airline, then the country of the destination', () => {
  const baggage = { included: ['KE'], usual: { JP: 45000, HK: 59000 },
    airlines: { UO: { fee: 59000 }, ZG: { fee: 37000, approx: true } } };
  const fee = (airline, id, bags, data = baggage) => bagFee({ airline, ...(bags === 0 ? { bags } : {}) }, route(id), data);
  assert.deepEqual(fee('KE', 'ICN-NRT'), { amount: 0, approx: false, unknown: false });
  // Korean Air's fares include a bag, whatever Aviasales says.
  assert.deepEqual(fee('KE', 'ICN-NRT', 0), { amount: 0, approx: false, unknown: false });
  assert.deepEqual(fee('UO', 'ICN-HKG', 0), { amount: 118000, approx: false, unknown: false });
  assert.deepEqual(fee('ZG', 'ICN-NRT', 0), { amount: 74000, approx: true, unknown: false });
  assert.deepEqual(fee('MM', 'ICN-HND', 0), { amount: 90000, approx: true, unknown: false });
  assert.deepEqual(fee('IT', 'ICN-TPE', 0), { amount: 0, approx: false, unknown: true });
  assert.deepEqual(fee('IT', 'ICN-TPE', 0, null), { amount: 0, approx: false, unknown: true });
});

test('a fare without a checked bag costs a bag each way, and the cheapest all in is offered', () => {
  const baggage = { usual: { JP: 45000 }, airlines: {} };
  const fare = (airline, price, bags) => ({ route: 'ICN-NRT', airline, depart: '2026-11-20', return: '2026-11-22',
    price, seen: today, ...(bags === 0 ? { bags } : {}) });
  const november = { from: '2026-11-01', to: '2026-11-30', cities: new Set(['NRT']), origins: new Set(['ICN']) };
  const row = (fares, filter = november) => recommend({ routes, fares, holidays, today, baggage }, filter)
    .find((t) => t.depart === '2026-11-20' && t.return === '2026-11-22' && t.fare);
  // Peach without a bag, 120,000 and 2 × 45,000, comes to 210,000 and beats Jeju Air's 230,000 with one.
  let t = row([fare('MM', 120000, 0), fare('7C', 230000)]);
  assert.deepEqual([t.airline, t.fare.price, t.bagFee, t.total, t.bagFeeApprox], ['MM', 120000, 90000, 210000, true]);
  // At 150,000 it would come to 240,000, so Jeju Air's fare, which needs nothing added, is offered.
  t = row([fare('MM', 150000, 0), fare('7C', 230000)]);
  assert.deepEqual([t.airline, t.bagFee, t.total], ['7C', 0, 230000]);
  // The budget holds the total.
  assert.equal(row([fare('MM', 120000, 0)], { ...november, maxPrice: 200000 }), undefined);
  assert.equal(row([fare('MM', 120000, 0)], { ...november, maxPrice: 210000 }).total, 210000);
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
  const filter = { from: '2026-11-01', to: '2026-11-30' };
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
  const filter = { from: '2026-10-01', to: '2026-10-31', nights: new Set([2]) };
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

test('search links ask for the cabin of the fare', () => {
  const links = Object.fromEntries(
    searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', 'KE', 'business').map((l) => [l.name, l.url]));
  assert.match(links['네이버'], /fareType=C$/);
  assert.match(links['스카이스캐너'], /cabinclass=business/);
  assert.match(links.Google, /through%202026-12-27%20in%20business%20class/);
  assert.match(links['카약'], /\/2026-12-27\/business\?sort=/);
  assert.match(searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', 'KE', 'first')[0].url, /fareType=F$/);
});
