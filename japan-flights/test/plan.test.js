import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays, bagFee, dayOf, fareMonths, landsInTheMorning, landsLate, leaveFor, recommend, routesOf, searchLinks,
} from '../site/plan.js';

const data = (name) => JSON.parse(readFileSync(new URL(`../site/data/${name}`, import.meta.url)));
const routes = routesOf(data('routes.json'));
const holidays = data('holidays.json').dates;
const route = (id) => routes.find((r) => r.id === id);
const today = '2026-10-11';
const december = { from: '2026-12-01', to: '2026-12-31', nights: new Set([2, 3]) };

test('dates step across months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(dayOf('2026-12-25'), 'fri');
  assert.equal(dayOf('2027-02-07'), 'sun');
});

test('every destination has the fields the page reads, and every Korean airport reaches it', () => {
  const doc = data('routes.json');
  assert.deepEqual(doc.origins, ['ICN', 'GMP', 'CJJ']);
  const dests = new Set();
  for (const place of doc.destinations) {
    assert.match(place.dest, /^[A-Z]{3}$/);
    assert.ok(!dests.has(place.dest), `${place.dest} appears twice`);
    dests.add(place.dest);
    assert.ok(place.city, place.dest);
    assert.match(place.country, /^(JP|TW|HK|MO|VN|TH|GU|MP)$/, place.dest);
    // Japan keeps Korea's time; everywhere else says what it keeps.
    assert.equal('utcOffset' in place, place.country !== 'JP', place.dest);
    if ('utcOffset' in place) assert.ok(Number.isInteger(place.utcOffset) && place.utcOffset !== 9, place.dest);
  }
  assert.equal(routes.length, doc.origins.length * doc.destinations.length);
  assert.equal(new Set(routes.map((r) => r.id)).size, routes.length);
});

test('a route runs from a Korean airport to a destination, with its city, country and time zone', () => {
  const doc = {
    origins: ['ICN', 'GMP'],
    destinations: [{ dest: 'NRT', city: '도쿄 나리타', country: 'JP' },
      { dest: 'HAN', city: '하노이', country: 'VN', utcOffset: 7 }],
  };
  assert.deepEqual(routesOf(doc).map((r) => `${r.id} ${r.city} ${r.country} ${r.utcOffset ?? 9}`),
    ['ICN-NRT 도쿄 나리타 JP 9', 'ICN-HAN 하노이 VN 7', 'GMP-NRT 도쿄 나리타 JP 9', 'GMP-HAN 하노이 VN 7']);
});

test('trips run two to six nights, never one, and the lengths picked narrow them', () => {
  // Seollal 2027 runs from Saturday 6 to Tuesday 9 February, so from Friday 5 up to five nights take no leave.
  const fares = [1, 2, 3, 4, 5, 6, 7].map((nights) => ({ route: 'ICN-NRT', airline: '7C', depart: '2027-02-05',
    return: addDays('2027-02-05', nights), price: 200000 }));
  const ctx = { routes, fares, holidays, today };
  const lengths = (filter) => recommend(ctx, { from: '2027-02-01', to: '2027-02-10', ...filter })
    .map((t) => t.nights).sort((a, b) => a - b);
  assert.deepEqual(lengths({}), [2, 3, 4, 5]);
  assert.deepEqual(lengths({ nights: new Set([3, 5]) }), [3, 5]);
  assert.deepEqual(lengths({ nights: new Set([1, 4]) }), [4]);
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

  // Back from Haneda on Monday: before dawn the trip takes no leave, in the afternoon it takes Monday.
  const fare = (depart, arrives) => ({ route: 'ICN-HND', airline: 'KE', depart, return: addDays(depart, 3),
    price: 300000, arrives });
  const fares = [fare('2026-11-13', '04:35'), fare('2026-11-20', '15:00')];
  const trips = recommend({ routes, fares, holidays, today }, { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(trips.map((t) => t.depart), ['2026-11-13']);
});

test('a flight back that lands after midnight frees the day it lands, not the day it leaves', () => {
  // Hong Kong at 23:30, Incheon at 04:05 the next day.
  const fare = (ret, lands) => ({ route: 'ICN-HKG', airline: 'CX', depart: '2026-11-20', return: ret,
    price: 400000, departs: '10:00', arrives: '04:05', lands });
  const fares = [fare('2026-11-22', '2026-11-23'), fare('2026-11-23', '2026-11-24')];
  const trips = recommend({ routes, fares, holidays, today },
    { from: '2026-11-01', to: '2026-11-30', airlines: new Set(['CX']) });
  const trip = (ret) => trips.find((t) => t.return === ret);
  assert.equal(trip('2026-11-22').lands, '2026-11-23'); // back Monday morning, so it takes no leave
  assert.equal(trip('2026-11-23'), undefined); // away all Monday
  assert.equal(leaveFor('2026-11-20', '2026-11-24', holidays, { morningArrival: true }).leave, 1);
});

test('the 2027 holidays leave 119 days off in a five-day week, as the official calendar says', () => {
  let off = 0;
  for (let d = '2027-01-01'; d <= '2027-12-31'; d = addDays(d, 1)) {
    if (holidays[d] || dayOf(d) === 'sat' || dayOf(d) === 'sun') off++;
  }
  assert.equal(off, 119);
});

test('a morning arrival lands in Korea before noon', () => {
  assert.equal(landsInTheMorning({ arrives: '11:59' }), true);
  assert.equal(landsInTheMorning({ arrives: '12:00' }), false);
  assert.equal(landsInTheMorning({}), false); // a fare that does not say
});

test('a flight out that lands abroad at 6 p.m. local time or later, or the next day, is late', () => {
  const fare = (arrivesAbroad, landsAbroad) => ({ route: 'ICN-HAN', airline: 'VJ', depart: '2026-11-20',
    departs: '10:00', arrivesAbroad, ...(landsAbroad ? { landsAbroad } : {}) });
  assert.equal(landsLate(fare('17:59')), false);
  assert.equal(landsLate(fare('18:00')), true);
  assert.equal(landsLate(fare('01:30', '2026-11-21')), true);
  // A fare that does not give the times is let through.
  assert.equal(landsLate({ route: 'ICN-HAN', airline: 'VJ', depart: '2026-11-20' }), false);
});

test('each trip carries whether its flight back lands in the morning', () => {
  const fare = (depart, ret, arrives) => ({ route: 'ICN-KIJ', airline: '7C', depart, return: ret, price: 150000,
    arrives });
  const fares = [fare('2026-12-25', '2026-12-27', '13:45'), fare('2026-12-18', '2026-12-21', '10:50')];
  const trips = recommend({ routes, fares, holidays, today }, december);
  const morning = (depart) => trips.find((t) => t.depart === depart).morningArrival;
  assert.equal(morning('2026-12-25'), false);
  // Friday to Monday takes no leave only because the flight back lands before noon.
  assert.equal(morning('2026-12-18'), true);
});

test('no trip is offered whose flight out lands late', () => {
  const fares = [
    { route: 'ICN-KIJ', airline: 'LJ', depart: '2026-12-04', return: '2026-12-06', price: 150000,
      departs: '09:00', arrivesAbroad: '11:05' },
    { route: 'ICN-KIJ', airline: 'LJ', depart: '2026-12-11', return: '2026-12-13', price: 130000,
      departs: '18:00', arrivesAbroad: '20:05' },
  ];
  const trips = recommend({ routes, fares, holidays, today }, december);
  assert.deepEqual(trips.map((t) => `${t.depart} ${t.airline}`), ['2026-12-04 LJ']);
});

test('only trips that take no leave are offered, the lowest rank first, then the soonest', () => {
  const fare = (id, airline, depart, ret, price) => ({ route: id, airline, depart, return: ret, price });
  const fares = [
    fare('ICN-AOJ', 'KE', '2026-12-04', '2026-12-06', 310000),
    fare('ICN-AOJ', 'KE', '2026-12-04', '2026-12-06', 290000),
    fare('ICN-AOJ', 'KE', '2026-12-01', '2026-12-03', 200000),
    fare('ICN-OIT', 'KE', '2026-12-25', '2026-12-27', 250000),
    fare('ICN-OIT', 'KE', '2026-10-01', '2026-10-03', 90000),
    fare('ICN-XXX', 'KE', '2026-12-02', '2026-12-04', 80000),
    fare('ICN-NRT', '7C', '2026-12-18', '2026-12-20', 250000),
    fare('ICN-NRT', '7C', '2026-12-11', '2026-12-13', 250000),
  ];
  const trips = recommend({ routes, fares, holidays, today }, december);
  assert.ok(trips.every((t) => t.leave === 0));
  // Aomori's Tuesday to Thursday takes two days, the trip that has left and the unknown route's fare
  // are dropped, and the cheaper of the two Aomori fares for Friday is kept. Korean Air's fares rank
  // 50,000 won lower, and of Jeju Air's two at the same price the sooner comes first.
  assert.deepEqual(trips.map((t) => `${t.route} ${t.depart} ${t.fare.price}`), ['ICN-OIT 2026-12-25 250000',
    'ICN-AOJ 2026-12-04 290000', 'ICN-NRT 2026-12-11 250000', 'ICN-NRT 2026-12-18 250000']);
});

test('the airlines asked for decide the fares', () => {
  const fares = [
    { route: 'ICN-OIT', airline: 'KE', depart: '2026-12-25', return: '2026-12-27', price: 280000 },
    { route: 'ICN-OIT', airline: '7C', depart: '2026-12-25', return: '2026-12-27', price: 190000 },
    { route: 'ICN-KMQ', airline: 'TW', depart: '2026-12-04', return: '2026-12-06', price: 210000 },
  ];
  const offered = (airlines) => recommend({ routes, fares, holidays, today }, { ...december, airlines })
    .map((t) => `${t.route} ${t.depart} ${t.airline} ${t.fare.price}`);
  // Every airline: the cheapest fare for the dates, with its airline.
  assert.deepEqual(offered(null), ['ICN-OIT 2026-12-25 7C 190000', 'ICN-KMQ 2026-12-04 TW 210000']);
  // One airline: only the trips its fares give.
  assert.deepEqual(offered(new Set(['KE'])), ['ICN-OIT 2026-12-25 KE 280000']);
  assert.deepEqual(offered(new Set(['TW'])), ['ICN-KMQ 2026-12-04 TW 210000']);
});

test('a trip gets a nonstop row and a connecting row, each with its cheapest fare', () => {
  const fare = (airline, price, stops) => ({ route: 'ICN-OIT', airline, depart: '2026-12-25', return: '2026-12-27',
    price, ...(stops ? { stops } : {}) });
  const rows = (fares) => recommend({ routes, holidays, today, fares }, december)
    .map((t) => `${t.airline} ${t.fare.price} ${t.stops}`);
  const connecting = [fare('MM', 150000, [1, 0]), fare('7C', 170000, [1, 1])];
  assert.deepEqual(rows(connecting), ['MM 150000 1,0']);
  assert.deepEqual(rows([...connecting, fare('TW', 230000)]), ['MM 150000 1,0', 'TW 230000 0,0']);
});

test('Korean Air and Asiana rank 50,000 won lower for each person', () => {
  const fare = (airline, price, depart) => ({ route: 'ICN-OIT', airline, depart, return: addDays(depart, 2),
    price });
  const order = (fares, party) => recommend({ routes, holidays, today, fares }, { ...december, party })
    .map((t) => `${t.airline} ${t.total} ${t.rank}`);
  // Trinity at 330,000 and Korean Air at 360,000 for the same days: Korean Air's fare is the one shown.
  assert.deepEqual(order([fare('TW', 330000, '2026-12-25'), fare('KE', 360000, '2026-12-25')]),
    ['KE 360000 310000']);
  // On other days, Korean Air's 360,000 comes before Trinity's 330,000, and two people double the lead.
  const fares = [fare('TW', 330000, '2026-12-25'), fare('KE', 360000, '2026-12-11')];
  assert.deepEqual(order(fares), ['KE 360000 310000', 'TW 330000 330000']);
  assert.deepEqual(order(fares, { people: 2, bags: 0 }), ['KE 720000 620000', 'TW 660000 660000']);
  // Asiana has the same lead, and no other airline has any.
  assert.deepEqual(order([fare('TW', 330000, '2026-12-25'), fare('OZ', 370000, '2026-12-18'),
    fare('7C', 335000, '2026-12-04')]), ['OZ 370000 320000', 'TW 330000 330000', '7C 335000 335000']);
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
  const guam = { id: 'ICN-GUM', origin: 'ICN', dest: 'GUM', country: 'GU' };
  const toGuam = { ...baggage, usual: { GU: 45000, JP: 40000 }, includedTo: { TW: ['GU'] } };
  assert.equal(bagFee({ airline: 'TW', bags: 0 }, guam, toGuam).amount, 0);
  assert.equal(bagFee({ airline: 'TW', bags: 0 }, route('ICN-NRT'), toGuam).amount, 80000);
});

test('a fare without a checked bag costs a bag each way, and the cheapest all in is offered', () => {
  const baggage = { usual: { JP: 45000 }, airlines: {} };
  const fare = (airline, price, bags) => ({ route: 'ICN-NRT', airline, depart: '2026-11-20', return: '2026-11-22',
    price, ...(bags === 0 ? { bags } : {}) });
  const november = { from: '2026-11-01', to: '2026-11-30', cities: new Set(['NRT']), origins: new Set(['ICN']) };
  const row = (fares, filter = november) => recommend({ routes, fares, holidays, today, baggage }, filter)
    .find((t) => t.depart === '2026-11-20' && t.return === '2026-11-22');
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
    price, ...(bags === 0 ? { bags } : {}) });
  const fares = [fare('MM', 120000, 0), fare('7C', 155000)];
  const november = { from: '2026-11-01', to: '2026-11-30', cities: new Set(['NRT']), origins: new Set(['ICN']) };
  const row = (party, filter = november) => recommend({ routes, fares, holidays, today, baggage }, { ...filter, party })
    .find((t) => t.depart === '2026-11-20' && t.return === '2026-11-22');
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
  const fare = (id) => ({ route: id, airline: 'MM', depart: '2026-12-04', return: '2026-12-06', price: 200000 });
  const ctx = { routes, fares: [fare('ICN-HND'), fare('GMP-HND'), fare('ICN-NRT')], holidays, today };
  const filter = { ...december, cities: new Set(['HND']) };
  const offered = (trips) => trips.map((t) => t.route).sort();
  assert.deepEqual(offered(recommend(ctx, filter)), ['GMP-HND', 'ICN-HND']);
  assert.deepEqual(offered(recommend(ctx, { ...filter, origins: new Set(['GMP']) })), ['GMP-HND']);
  assert.deepEqual(offered(recommend(ctx, { ...filter, origins: new Set(['ICN']) })), ['ICN-HND']);
});

test('the budget holds the total, and a trip that takes leave is left out however cheap', () => {
  const fare = (depart, price) => ({ route: 'ICN-OIT', airline: '7C', depart, return: addDays(depart, 2), price });
  const fares = [fare('2026-12-25', 280000), fare('2026-12-18', 240000), fare('2026-12-21', 200000)];
  const ctx = { routes, fares, holidays, today };
  // Friday to Sunday takes no leave; Monday to Wednesday does.
  assert.deepEqual(recommend(ctx, december).map((t) => t.depart), ['2026-12-18', '2026-12-25']);
  assert.deepEqual(recommend(ctx, { ...december, maxPrice: 250000 }).map((t) => t.depart), ['2026-12-18']);
});

test('the trips that already left are not offered, and with no end every fare ahead is', () => {
  const fare = (depart) => ({ route: 'ICN-NRT', airline: '7C', depart, return: addDays(depart, 2), price: 200000 });
  const ctx = { routes, fares: [fare('2026-10-09'), fare('2026-10-16'), fare('2027-03-05')], holidays, today };
  assert.deepEqual(recommend(ctx, { from: '2026-10-01', to: '2026-10-31' }).map((t) => t.depart), ['2026-10-16']);
  assert.deepEqual(recommend(ctx, { from: '2026-10-01' }).map((t) => t.depart), ['2026-10-16', '2027-03-05']);
});

test('months run from this one to the last a fare leaves in', () => {
  const fares = [{ depart: '2026-10-01' }, { depart: '2027-01-15' }, { depart: '2026-11-20' }];
  assert.deepEqual(fareMonths(fares, today), ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(fareMonths([], today), ['2026-10']);
});

test('search links carry the route and both dates', () => {
  const links = Object.fromEntries(
    searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', { airline: 'KE' }).map((l) => [l.name, l.url]));
  assert.deepEqual(Object.keys(links), ['Google', '스카이스캐너', '카약']);
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

test('search links ask for as many adults as there are people', () => {
  const links = Object.fromEntries(searchLinks(route('ICN-OIT'), '2026-12-25', '2026-12-27', { airline: 'KE', people: 2 })
    .map((l) => [l.name, l.url]));
  assert.match(links['스카이스캐너'], /\?adultsv2=2&/);
  assert.match(links.Google, /through%202026-12-27%20for%202%20adults&/);
  assert.match(links['카약'], /\/2026-12-27\/2adults\?sort=/);
});
