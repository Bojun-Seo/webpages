import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays, airlineOf, bagFee, dayOf, fliesOn, flightMarks, landsLate, leaveFor, monthsAhead, recommend,
  roundTrips, routesOf, searchLinks,
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

test('a morning arrival lands in Korea before noon', () => {
  const times = (arrives) => ({
    flights: { out: { departs: '09:00', arrives: '11:00' }, back: { departs: '08:00', arrives } },
  });
  assert.deepEqual(flightMarks(times('11:59')), { morningArrival: true });
  assert.deepEqual(flightMarks(times('12:00')), { morningArrival: false });
  // A route without times, and one that leaves at 09:15 and is back at 13:45.
  assert.deepEqual(flightMarks(route('ICN-KMQ')), { morningArrival: false });
  assert.deepEqual(flightMarks(route('ICN-OIT')), { morningArrival: false });
});

test('a flight out that lands abroad at 6 p.m. local time or later, or the next day, is late', () => {
  const fare = (arrivesAbroad, landsAbroad) => ({ route: 'ICN-HAN', airline: 'VJ', depart: '2026-11-20',
    departs: '10:00', arrivesAbroad, ...(landsAbroad ? { landsAbroad } : {}) });
  const hanoi = { id: 'ICN-HAN', origin: 'ICN', dest: 'HAN', periods: [] };
  assert.equal(landsLate(hanoi, fare('17:59')), false);
  assert.equal(landsLate(hanoi, fare('18:00')), true);
  assert.equal(landsLate(hanoi, fare('01:30', '2026-11-21')), true);
  // Without its own times, Korean Air goes by the route's; another airline is let through.
  const late = { ...hanoi, flights: { out: { departs: '13:00', arrives: '18:20' }, back: { departs: '00:20', arrives: '06:40' } } };
  assert.equal(landsLate(late, null), true);
  assert.equal(landsLate(late, { route: 'ICN-HAN', airline: 'KE', depart: '2026-11-20' }), true);
  assert.equal(landsLate(late, { route: 'ICN-HAN', airline: 'VJ', depart: '2026-11-20' }), false);
});

const december = { from: '2026-12-01', to: '2026-12-31', nights: new Set([2, 3]) };

test('each trip carries the marks its flight times earn', () => {
  const early = {
    ...route('ICN-KIJ'),
    flights: { out: { departs: '10:00', arrives: '12:05' }, back: { departs: '08:30', arrives: '10:50' } },
  };
  const ctx = { routes: routes.map((r) => (r.id === early.id ? early : r)), fares: [], holidays, today };
  const trips = recommend(ctx, { ...december, cities: new Set(['OIT', 'KIJ']) });
  const morning = (id, depart, ret) =>
    trips.find((x) => x.route === id && x.depart === depart && x.return === ret).morningArrival;
  assert.equal(morning('ICN-OIT', '2026-12-25', '2026-12-27'), false);
  assert.equal(morning('ICN-KIJ', '2026-12-21', '2026-12-23'), true);
});

test('no trip is offered whose flight out lands late', () => {
  const late = {
    ...route('ICN-KIJ'),
    flights: { out: { departs: '16:00', arrives: '18:05' }, back: { departs: '08:30', arrives: '10:50' } },
  };
  const fares = [
    { route: 'ICN-KIJ', airline: 'LJ', depart: '2026-12-21', return: '2026-12-23', price: 150000, seen: today,
      departs: '09:00', arrivesAbroad: '11:05' },
    { route: 'ICN-KIJ', airline: 'LJ', depart: '2026-12-22', return: '2026-12-24', price: 130000, seen: today,
      departs: '18:00', arrivesAbroad: '20:05' },
  ];
  const ctx = { routes: routes.map((r) => (r.id === late.id ? late : r)), fares, holidays, today };
  const trips = recommend(ctx, { ...december, cities: new Set(['KIJ']) });
  // Korean Air's days bring in nothing; only the fare that lands at 11:05 is left.
  assert.deepEqual(trips.map((t) => `${t.depart} ${t.airline}`), ['2026-12-21 LJ']);
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
    return [t.airline, t.fare.price];
  };
  // Every airline: the cheapest fare for the dates, with its airline.
  const all = recommend(ctx, base);
  assert.deepEqual(christmas(all), ['7C', 190000]);
  assert.ok(all.some((t) => t.route === 'ICN-KMQ'));
  // Korean Air alone: its own fare, and the trips its schedule allows without one.
  const ke = recommend(ctx, { ...base, airlines: new Set(['KE']) });
  assert.deepEqual(christmas(ke), ['KE', 280000]);
  assert.ok(ke.some((t) => t.fare === null && t.airline === 'KE'));
  assert.ok(!ke.some((t) => t.route === 'ICN-KMQ'));
  // Another airline alone: only the trips its fares prove.
  const tw = recommend(ctx, { ...base, airlines: new Set(['TW']) });
  assert.deepEqual(tw.map((t) => `${t.route} ${t.depart} ${t.airline}`), ['ICN-KMQ 2026-12-04 TW']);
  // A fare written without an airline is Korean Air's.
  assert.equal(airlineOf({ route: 'ICN-OIT' }), 'KE');
});

test("another airline's fare without times does not take Korean Air's", () => {
  const early = {
    ...route('ICN-KIJ'),
    flights: { out: { departs: '10:00', arrives: '12:05' }, back: { departs: '08:30', arrives: '10:50' } },
  };
  const ctx = {
    routes: routes.map((r) => (r.id === early.id ? early : r)), holidays, today,
    fares: [{ route: 'ICN-KIJ', airline: 'LJ', depart: '2026-12-21', return: '2026-12-23', price: 150000, seen: today }],
  };
  const trips = recommend(ctx, { ...december, cities: new Set(['KIJ']) });
  const marks = (t) => [t.airline, t.morningArrival];
  assert.deepEqual(marks(trips.find((t) => t.fare)), ['LJ', false]);
  assert.deepEqual(marks(trips.find((t) => !t.fare)), ['KE', true]);
});

test('a trip gets a nonstop row and a connecting row, and Korean Air\'s days stay without a nonstop fare', () => {
  const fare = (airline, price, stops) => ({ route: 'ICN-OIT', airline, depart: '2026-12-25', return: '2026-12-27',
    price, seen: today, ...(stops ? { stops } : {}) });
  const ctx = { routes, holidays, today, fares: [fare('MM', 150000, [1, 0]), fare('7C', 170000, [1, 1])] };
  const christmas = (trips) => trips.filter((t) => t.route === 'ICN-OIT' && t.depart === '2026-12-25'
    && t.return === '2026-12-27').map((t) => `${t.airline} ${t.fare ? t.fare.price : '?'} ${t.stops}`);
  // Only connecting fares: the cheaper of them, and Korean Air's nonstop days without a fare.
  assert.deepEqual(christmas(recommend(ctx, december)), ['MM 150000 1,0', 'KE ? 0,0']);
  // A nonstop fare takes the place of the days without one.
  ctx.fares.push(fare('TW', 230000));
  assert.deepEqual(christmas(recommend(ctx, december)), ['MM 150000 1,0', 'TW 230000 0,0']);
});

test('Korean Air and Asiana rank 50,000 won lower, business 200,000 and first 500,000, per person', () => {
  const fare = (airline, price, depart, cabin) => ({ route: 'ICN-OIT', airline, depart, return: addDays(depart, 2),
    price, seen: today, ...(cabin ? { cabin } : {}) });
  const order = (fares, party) => recommend({ routes, holidays, today, fares }, { ...december, party })
    .filter((t) => t.fare).map((t) => `${t.airline} ${t.cabin} ${t.total} ${t.rank}`);
  // Trinity at 330,000 and Korean Air at 360,000 for the same days: Korean Air's fare is the one shown.
  assert.deepEqual(order([fare('TW', 330000, '2026-12-25'), fare('KE', 360000, '2026-12-25')]),
    ['KE economy 360000 310000']);
  // On other days, Korean Air's 360,000 comes before Trinity's 330,000, and two people double the lead.
  const fares = [fare('TW', 330000, '2026-12-25'), fare('KE', 360000, '2026-12-11')];
  assert.deepEqual(order(fares), ['KE economy 360000 310000', 'TW economy 330000 330000']);
  assert.deepEqual(order(fares, { people: 2, bags: 0 }), ['KE economy 720000 620000', 'TW economy 660000 660000']);
  // Business and first, and Korean Air's business with both leads; every trip here takes no leave.
  assert.deepEqual(order([fare('TW', 330000, '2026-12-25'), fare('7C', 520000, '2026-12-11', 'business'),
    fare('NH', 900000, '2026-12-18', 'first'), fare('KE', 600000, '2026-12-04', 'business')]),
  ['7C business 520000 320000', 'TW economy 330000 330000', 'KE business 600000 350000', 'NH first 900000 400000']);
});

test('every Korean airport reaches every destination, through fares where no route is listed', () => {
  const doc = {
    origins: ['ICN', 'GMP'],
    routes: [{ id: 'ICN-NRT', origin: 'ICN', dest: 'NRT', city: '도쿄 나리타', country: 'JP', periods: [] }],
    destinations: [{ dest: 'HAN', city: '하노이', country: 'VN', utcOffset: 7 }],
  };
  assert.deepEqual(routesOf(doc).map((r) => `${r.id} ${r.city} ${r.utcOffset ?? 9}`),
    ['ICN-NRT 도쿄 나리타 9', 'ICN-HAN 하노이 7', 'GMP-NRT 도쿄 나리타 9', 'GMP-HAN 하노이 7']);
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

test('every destination has the fields a route would give it', () => {
  const doc = data('routes.json');
  assert.deepEqual(doc.origins, ['ICN', 'GMP', 'CJJ']);
  const listed = new Set(routes.map((r) => r.dest));
  for (const place of doc.destinations) {
    assert.match(place.dest, /^[A-Z]{3}$/);
    assert.ok(place.city && !listed.has(place.dest), place.dest);
    assert.match(place.country, /^(VN|TH|GU|MP)$/, place.dest);
    assert.ok(Number.isInteger(place.utcOffset), place.dest);
  }
  // Every Korean airport reaches every place, once.
  const all = routesOf(doc);
  assert.equal(new Set(all.map((r) => r.id)).size, all.length);
  assert.equal(all.length, doc.origins.length * new Set(all.map((r) => r.dest)).size);
});

test('baggage.json has a usual fee for every country flown to, and a fee with a source for each airline', () => {
  const baggage = data('baggage.json');
  const countries = new Set(routesOf(data('routes.json')).map((r) => r.country));
  for (const country of countries) assert.ok(baggage.usual[country] > 0, country);
  for (const code of baggage.included) assert.ok(/^[A-Z0-9]{2}$/.test(code) && !(code in baggage.airlines), code);
  for (const [code, places] of Object.entries(baggage.includedTo)) {
    assert.ok(/^[A-Z0-9]{2}$/.test(code) && places.every((c) => countries.has(c)), code);
  }
  for (const [code, airline] of Object.entries(baggage.airlines)) {
    assert.match(code, /^[A-Z0-9]{2}$/);
    const fees = typeof airline.fee === 'object' ? Object.entries(airline.fee) : [[null, airline.fee]];
    assert.ok(fees.length > 0 && airline.source.url, code);
    for (const [country, fee] of fees) {
      assert.ok(Number.isInteger(fee) && fee > 0 && (country === null || countries.has(country)), `${code} ${country}`);
    }
  }
});

test('the bag fee follows the airline, then the country of the destination', () => {
  const baggage = { included: ['KE'], usual: { JP: 45000, HK: 59000 },
    airlines: { UO: { fee: 59000 }, ZG: { fee: 37000, approx: true } } };
  const fee = (airline, id, bags, data = baggage) => {
    const { amount, approx, unknown } = bagFee({ airline, ...(bags === 0 ? { bags } : {}) }, route(id), data);
    return { amount, approx, unknown };
  };
  assert.deepEqual(fee('KE', 'ICN-NRT'), { amount: 0, approx: false, unknown: false });
  // Korean Air's fares include a bag, whatever Aviasales says.
  assert.deepEqual(fee('KE', 'ICN-NRT', 0), { amount: 0, approx: false, unknown: false });
  assert.deepEqual(fee('UO', 'ICN-HKG', 0), { amount: 118000, approx: false, unknown: false });
  assert.deepEqual(fee('ZG', 'ICN-NRT', 0), { amount: 74000, approx: true, unknown: false });
  assert.deepEqual(fee('MM', 'ICN-HND', 0), { amount: 90000, approx: true, unknown: false });
  assert.deepEqual(fee('IT', 'ICN-TPE', 0), { amount: 0, approx: false, unknown: true });
  assert.deepEqual(fee('IT', 'ICN-TPE', 0, null), { amount: 0, approx: false, unknown: true });
  // An airline's fee can differ by country; a country it gives none for takes the usual fee.
  const byCountry = { ...baggage, airlines: { '7C': { fee: { JP: 35000, HK: 50000 } } } };
  assert.deepEqual(fee('7C', 'ICN-NRT', 0, byCountry), { amount: 70000, approx: false, unknown: false });
  assert.deepEqual(fee('7C', 'ICN-HKG', 0, byCountry), { amount: 100000, approx: false, unknown: false });
  assert.deepEqual(fee('7C', 'ICN-TPE', 0, { ...byCountry, usual: { TW: 59000 } }), { amount: 118000, approx: true, unknown: false });
  // An airline can include a bag to some countries only.
  const guam = { id: 'ICN-GUM', origin: 'ICN', dest: 'GUM', country: 'GU', periods: [] };
  const toGuam = { ...baggage, usual: { GU: 45000, JP: 40000 }, includedTo: { TW: ['GU'] } };
  assert.equal(bagFee({ airline: 'TW', bags: 0 }, guam, toGuam).amount, 0);
  assert.equal(bagFee({ airline: 'TW', bags: 0 }, route('ICN-NRT'), toGuam).amount, 80000);
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
  assert.deepEqual([t.airline, t.fare.price, t.bag.amount, t.total, t.bag.approx], ['MM', 120000, 90000, 210000, true]);
  // At 150,000 it would come to 240,000, so Jeju Air's fare, which needs nothing added, is offered.
  t = row([fare('MM', 150000, 0), fare('7C', 230000)]);
  assert.deepEqual([t.airline, t.bag.amount, t.total], ['7C', 0, 230000]);
  // The budget holds the total.
  assert.equal(row([fare('MM', 120000, 0)], { ...november, maxPrice: 200000 }), undefined);
  assert.equal(row([fare('MM', 120000, 0)], { ...november, maxPrice: 210000 }).total, 210000);
});

test('a party pays a fare each and the fee for each bag its fares do not include', () => {
  const baggage = { included: ['KE'], usual: { JP: 45000 }, airlines: {} };
  const fee = (fare, people, bags) => {
    const { amount, count, included, unknown } = bagFee(fare, route('ICN-NRT'), baggage, { people, bags });
    return [amount, count, included, unknown];
  };
  const peach = { airline: 'MM', bags: 0 };
  const jeju = { airline: '7C' };
  // Two people with one bag between them: one bag both ways on a fare without one.
  assert.deepEqual(fee(peach, 2, 1), [90000, 1, 0, false]);
  assert.deepEqual(fee(peach, 2, 2), [180000, 2, 0, false]);
  assert.deepEqual(fee(peach, 1, 0), [0, 0, 0, false]);
  // A fare with a bag includes one for each person; a bag more costs the same fee.
  assert.deepEqual(fee(jeju, 2, 2), [0, 0, 1, false]);
  assert.deepEqual(fee(jeju, 1, 2), [90000, 1, 1, false]);
  assert.deepEqual(fee({ ...jeju, bags: 2 }, 1, 2), [0, 0, 2, false]);
  // Korean Air includes one each, whatever Aviasales says; a bag more has no known fee.
  assert.deepEqual(fee({ airline: 'KE', bags: 0 }, 2, 2), [0, 0, 1, false]);
  assert.deepEqual(fee({ airline: 'KE', bags: 0 }, 1, 2), [0, 1, 1, true]);

  const fare = (airline, price, bags) => ({ route: 'ICN-NRT', airline, depart: '2026-11-20', return: '2026-11-22',
    price, seen: today, ...(bags === 0 ? { bags } : {}) });
  const fares = [fare('MM', 120000, 0), fare('7C', 155000)];
  const november = { from: '2026-11-01', to: '2026-11-30', cities: new Set(['NRT']), origins: new Set(['ICN']) };
  const row = (party, filter = november) => recommend({ routes, fares, holidays, today, baggage }, { ...filter, party })
    .find((t) => t.depart === '2026-11-20' && t.return === '2026-11-22' && t.fare);
  const offer = (t) => [t.airline, t.total, t.bag.count];
  // One person with a bag: Jeju Air's 155,000 beats Peach's 120,000 and 90,000.
  assert.deepEqual(offer(row({ people: 1, bags: 1 })), ['7C', 155000, 0]);
  // Three people sharing a bag: Peach's 3 × 120,000 and 90,000 beat Jeju Air's 3 × 155,000.
  assert.deepEqual(offer(row({ people: 3, bags: 1 })), ['MM', 450000, 1]);
  // No bag at all: the cheaper fare as it is.
  assert.deepEqual(offer(row({ people: 1, bags: 0 })), ['MM', 120000, 0]);
  // The budget holds the party's total.
  assert.equal(row({ people: 3, bags: 1 }, { ...november, maxPrice: 449999 }), undefined);
  assert.equal(row({ people: 3, bags: 1 }, { ...november, maxPrice: 450000 }).total, 450000);
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
  const jeju = searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', { airline: '7C' }).find((l) => l.name === '카약');
  assert.match(jeju.url, /airlines=7C;stops=0$/);
  // A trip that connects is not held to nonstop flights.
  const via = Object.fromEntries(searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', { airline: '7C', nonstop: false })
    .map((l) => [l.name, l.url]));
  assert.match(via['카약'], /airlines=7C$/);
  assert.match(via['스카이스캐너'], /preferdirects=false$/);
});

test('search links ask for the cabin of the fare', () => {
  const links = Object.fromEntries(
    searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', { cabin: 'business' }).map((l) => [l.name, l.url]));
  assert.match(links['네이버'], /fareType=C$/);
  assert.match(links['스카이스캐너'], /cabinclass=business/);
  assert.match(links.Google, /through%202026-12-27%20in%20business%20class/);
  assert.match(links['카약'], /\/2026-12-27\/business\?sort=/);
  assert.match(searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', { cabin: 'first' })[0].url, /fareType=F$/);
});

test('search links ask for as many adults as there are people', () => {
  const links = Object.fromEntries(
    searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', { cabin: 'business', people: 2 }).map((l) => [l.name, l.url]));
  assert.match(links['네이버'], /\?adult=2&/);
  assert.match(links['스카이스캐너'], /\?adultsv2=2&/);
  assert.match(links.Google, /in%20business%20class%20for%202%20adults&/);
  assert.match(links['카약'], /\/2026-12-27\/business\/2adults\?sort=/);
});
