// What the page works out, kept apart from the DOM so Node can test it.
//
// Dates are 'YYYY-MM-DD' strings throughout. They compare correctly as
// strings and become UTC midnights only for arithmetic, so the viewer's
// time zone never moves a trip by a day.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_NAMES = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
const DAY_MS = 86400000;

function toUTC(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date, n) {
  return fromUTC(toUTC(date) + n * DAY_MS);
}

export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

export function dayOf(date) {
  return DAY_KEYS[new Date(toUTC(date)).getUTCDay()];
}

export function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return fromUTC(Date.UTC(y, m, 0));
}

function periodOn(route, date) {
  return route.periods.find((p) => p.from <= date && date <= p.to);
}

function periodFlies(period, day) {
  return period.days === 'daily' || period.days.includes(day);
}

// Whether `route` has flights on `date`. Every one of these routes turns
// around abroad the same day, so the flights out and back share days.
export function fliesOn(route, date) {
  const period = periodOn(route, date);
  return period ? periodFlies(period, dayOf(date)) : false;
}

// The trip lengths the page offers, in nights. It never offers a trip of
// one night.
export const TRIP_NIGHTS = [2, 3, 4, 5, 6];

// Every round trip on `route` leaving between `from` and `to` that stays
// one of `nights`, numbers of nights, with a flight at both ends.
export function roundTrips(route, from, to, nights) {
  const trips = [];
  for (let out = from; out <= to; out = addDays(out, 1)) {
    if (!fliesOn(route, out)) continue;
    for (const n of nights) {
      const back = addDays(out, n);
      if (fliesOn(route, back)) trips.push({ route: route.id, depart: out, return: back, nights: n });
    }
  }
  return trips;
}

// Leave is counted by day number, days since 1 January 1970, so that
// thousands of trips need no date strings built day by day.
function dayNumber(date) {
  return toUTC(date) / DAY_MS;
}

// 0 for Sunday to 6 for Saturday; day 0 was a Thursday.
function weekday(day) {
  return (day + 4) % 7;
}

// The days of the week that take leave: Monday, Tuesday and Thursday, the
// days the page's owner works. Wednesday and Friday are off like a weekend.
const WORKDAYS = new Set([1, 2, 4]);

const holidaysByDay = new WeakMap();

// The holidays by day number, worked out once for each holidays object.
function holidayDays(holidays) {
  let days = holidaysByDay.get(holidays);
  if (!days) {
    days = new Map(Object.entries(holidays).map(([date, name]) => [dayNumber(date), name]));
    holidaysByDay.set(holidays, days);
  }
  return days;
}

// The leave a trip takes: the workdays from departure to the day the
// flight back lands that are not public holidays, both ends included as
// whole days, except that the landing day takes none when the flight lands
// before noon (`morningArrival`), since there is still time to go to work.
// Also gives the holidays the trip spans, a substitute day under the name
// of the holiday it stands in for.
export function leaveFor(depart, lands, holidays, { morningArrival = false } = {}) {
  const named = holidayDays(holidays);
  let leave = 0;
  const names = [];
  const last = dayNumber(lands);
  for (let day = dayNumber(depart); day <= last; day++) {
    const name = named.get(day);
    if (name) {
      const shown = name.replace(/ 대체공휴일$/, '');
      if (!names.includes(shown)) names.push(shown);
    } else if (WORKDAYS.has(weekday(day)) && !(day === last && morningArrival)) {
      leave++;
    }
  }
  return { leave, holidays: names };
}

// Times are 'HH:MM', so they compare as strings. The marks read only times
// in Korea: when the flight out leaves and when the flight back lands.
const EVENING = '16:00';
const NOON = '12:00';

// Whether a route's Korean Air flight out leaves Korea at 4 p.m. or later,
// and whether its flight back lands there before noon. A route whose times
// are not known has neither.
export function flightMarks(route) {
  return {
    eveningDeparture: Boolean(route.flights && route.flights.out.departs >= EVENING),
    morningArrival: Boolean(route.flights && route.flights.back.arrives < NOON),
  };
}

// The airline a fare is for. Fares written before the page knew other
// airlines are Korean Air's.
export function airlineOf(fare) {
  return fare.airline || 'KE';
}

// The cabins a fare can be for, the cheapest first. A fare that names none
// is economy.
export const CABINS = ['economy', 'business', 'first'];

export function cabinOf(fare) {
  return fare.cabin || 'economy';
}

// What checking one bag each way adds to `fare` on `route`. Nothing when
// the fare includes a checked bag or does not say, or when its airline is
// one whose fares always include one here (`included`), though Aviasales
// marks a few of theirs without; else twice the one-way fee baggage.json
// gives the airline, or failing that the usual fee to the destination's
// country, which is a guess and so `approx`, as an airline's own fee may
// also be. `unknown` when baggage.json gives neither.
export function bagFee(fare, route, baggage) {
  const none = { amount: 0, approx: false, unknown: false };
  if (!fare || fare.bags !== 0) return none;
  if (baggage && baggage.included && baggage.included.includes(airlineOf(fare))) return none;
  const own = baggage && baggage.airlines && baggage.airlines[airlineOf(fare)];
  if (own) return { amount: 2 * own.fee, approx: Boolean(own.approx), unknown: false };
  const usual = baggage && baggage.usual && baggage.usual[route.country];
  if (usual) return { amount: 2 * usual, approx: true, unknown: false };
  return { amount: 0, approx: false, unknown: true };
}

// The marks a trip's flights earn: from the fare's own times where it has
// them, else from the route's times when the trip is Korean Air's. Another
// airline's fare without times earns neither.
function marksFor(route, fare) {
  if (fare && (fare.departs || fare.arrives)) {
    return {
      eveningDeparture: Boolean(fare.departs && fare.departs >= EVENING),
      morningArrival: Boolean(fare.arrives && fare.arrives < NOON),
    };
  }
  if (!fare || airlineOf(fare) === 'KE') return flightMarks(route);
  return { eveningDeparture: false, morningArrival: false };
}

function tripKey(trip) {
  return `${trip.route} ${trip.depart} ${trip.return}`;
}

// The cheapest fare for each route, pair of dates and cabin, among trips
// that have not left yet, by what `cost` makes of each: its price unless
// told otherwise.
export function cheapestFares(fares, today, cost = (fare) => fare.price) {
  const best = new Map();
  for (const fare of fares) {
    if (!(fare.depart >= today && fare.return > fare.depart && fare.price > 0)) continue;
    const key = `${tripKey(fare)} ${cabinOf(fare)}`;
    const held = best.get(key);
    if (!held || cost(fare) < cost(held)) best.set(key, fare);
  }
  return best;
}

function priceOf(trip) {
  return trip.fare ? trip.total : Infinity;
}

function byNumber(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function byString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The trips that take the least leave first; among them, those with a
// known fare, the cheapest first; then the soonest departure, and on the
// same day the shorter trip.
function byLeaveFareDate(a, b) {
  return a.leave - b.leave || byNumber(priceOf(a), priceOf(b)) || byString(a.depart, b.depart)
    || a.nights - b.nights || byString(a.route, b.route)
    || CABINS.indexOf(a.cabin) - CABINS.indexOf(b.cabin);
}

// The trips that match `filter`, one for each cabin with a known fare among
// the airlines asked for, each with its cheapest fare there, its airline and
// cabin, the day its flight back lands, its leave, the holidays it spans and
// the marks its flight times earn: the least leave first, then known fares,
// the cheapest first, then the soonest departure. A fare without a checked
// bag costs its price and a bag each way (`bagFee`, `total`), and is chosen,
// sorted and held to the budget by that. The schedules are Korean Air's,
// so another airline's trip comes only from a fare; a trip without a fare
// is offered in the cheaper cabin asked for of economy and business, but
// never in first, which Korean Air hardly sells on these routes.
//
// filter: { from, to, nights, maxLeave, maxPrice, origins, cities, airlines, cabins }
// `from` and `to` bound the departure date. `nights` (a Set of trip lengths
// in nights) is left out to mean all of TRIP_NIGHTS, and no other length is
// ever offered; `maxLeave`, `maxPrice`, `origins` (a Set of Korean airport
// codes), `cities` (a Set of destination airport codes), `airlines` (a Set
// of airline codes) and `cabins` (a Set of CABINS) are left out to mean no
// limit.
export function recommend({ routes, fares, holidays, today, baggage }, filter) {
  const from = filter.from > today ? filter.from : today;
  const nights = new Set(TRIP_NIGHTS.filter((n) => !filter.nights || filter.nights.has(n)));
  const wanted = (route) => (!filter.origins || filter.origins.has(route.origin))
    && (!filter.cities || filter.cities.has(route.dest));
  const flown = (airline) => !filter.airlines || filter.airlines.has(airline);
  const seated = (cabin) => !filter.cabins || filter.cabins.has(cabin);
  const byId = new Map(routes.map((route) => [route.id, route]));
  const feeOf = (fare) => bagFee(fare, fare && byId.get(fare.route), baggage);
  const cheapest = cheapestFares(fares.filter((fare) => byId.has(fare.route)
    && wanted(byId.get(fare.route)) && flown(airlineOf(fare)) && seated(cabinOf(fare))), today,
  (fare) => fare.price + feeOf(fare).amount);
  const faresOf = new Map();
  for (const fare of cheapest.values()) {
    const key = tripKey(fare);
    if (!faresOf.has(key)) faresOf.set(key, []);
    faresOf.get(key).push(fare);
  }

  const scheduled = ['economy', 'business'].find(seated);
  const trips = new Map();
  for (const route of flown('KE') && scheduled ? routes : []) {
    if (!wanted(route)) continue;
    for (const trip of roundTrips(route, from, filter.to, nights)) {
      trips.set(tripKey(trip), trip);
    }
  }
  // A fare proves a flight even where the schedule is not known.
  for (const [key, [fare]] of faresOf) {
    const n = daysBetween(fare.depart, fare.return);
    if (trips.has(key) || fare.depart < from || fare.depart > filter.to || !nights.has(n)) continue;
    trips.set(key, { route: fare.route, depart: fare.depart, return: fare.return, nights: n });
  }

  const out = [];
  for (const [key, trip] of trips) {
    for (const fare of faresOf.get(key) || [null]) {
      const marks = marksFor(byId.get(trip.route), fare);
      // A flight back that leaves late at night lands the next day.
      const lands = (fare && fare.lands) || trip.return;
      const { leave, holidays: names } = leaveFor(trip.depart, lands, holidays, marks);
      const fee = feeOf(fare);
      const total = fare ? fare.price + fee.amount : null;
      if (filter.maxLeave != null && leave > filter.maxLeave) continue;
      if (filter.maxPrice != null && !(fare && total <= filter.maxPrice)) continue;
      out.push({
        ...trip, fare, airline: fare ? airlineOf(fare) : 'KE', cabin: fare ? cabinOf(fare) : scheduled,
        total, bagFee: fee.amount, bagFeeApprox: fee.approx, bagFeeUnknown: fee.unknown,
        lands, leave, holidays: names, ...marks,
      });
    }
  }
  return out.sort(byLeaveFareDate);
}

// The months from today's to the last one any route has a schedule for.
export function monthsAhead(routes, today) {
  let last = today;
  for (const route of routes) {
    for (const period of route.periods) if (period.to > last) last = period.to;
  }
  const months = [];
  for (let month = today.slice(0, 7); month <= last.slice(0, 7);
    month = addDays(lastDayOfMonth(month), 1).slice(0, 7)) {
    months.push(month);
  }
  return months;
}

// Searches for one trip in one cabin on sites that show live prices. None
// of them documents these URLs, so a site may change its format without
// notice. KAYAK's asks for the trip's airline, nonstop.
export function searchLinks(route, depart, ret, airline = 'KE', cabin = 'economy') {
  const from = route.origin;
  const to = route.dest;
  const compact = (date) => date.replaceAll('-', '');
  const query = `Flights from ${from} to ${to} on ${depart} through ${ret}`
    + (cabin === 'economy' ? '' : ` in ${cabin} class`);
  const fareType = { economy: 'Y', business: 'C', first: 'F' }[cabin];
  return [
    {
      name: '네이버',
      url: `https://flight.naver.com/flights/international/${from}-${to}-${compact(depart)}/`
        + `${to}-${from}-${compact(ret)}?adult=1&fareType=${fareType}`,
    },
    {
      name: 'Google',
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=ko&gl=kr&curr=KRW`,
    },
    {
      name: '스카이스캐너',
      url: `https://www.skyscanner.co.kr/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/`
        + `${compact(depart).slice(2)}/${compact(ret).slice(2)}/`
        + `?adultsv2=1&cabinclass=${cabin}&rtn=1&preferdirects=true`,
    },
    {
      name: '카약',
      url: `https://www.kayak.co.kr/flights/${from}-${to}/${depart}/${ret}`
        + `${cabin === 'economy' ? '' : `/${cabin}`}?sort=price_a&fs=airlines=${airline};stops=0`,
    },
  ];
}
