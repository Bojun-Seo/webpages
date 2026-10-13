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

// Every route the page knows: those routes.json lists, and one from each
// Korean airport in `origins` to each destination that has none listed,
// which only fares bring trips to, nonstop or with a connection. A place in
// `destinations` gives its city, country and time zone; any other
// destination takes those of a route listed to it.
export function routesOf(doc) {
  const listed = new Set(doc.routes.map((route) => route.id));
  const places = new Map();
  for (const place of [...doc.routes, ...(doc.destinations || [])]) {
    if (!places.has(place.dest)) places.set(place.dest, place);
  }
  const routes = [...doc.routes];
  for (const origin of doc.origins || []) {
    for (const [dest, place] of places) {
      if (listed.has(`${origin}-${dest}`)) continue;
      routes.push({
        id: `${origin}-${dest}`, origin, dest, city: place.city, country: place.country,
        ...('utcOffset' in place ? { utcOffset: place.utcOffset } : {}), periods: [],
      });
    }
  }
  return routes;
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

// Times are 'HH:MM', so they compare as strings.
const NOON = '12:00';
const LATE = '18:00';

// Whether a route's Korean Air flight back lands in Korea before noon. A
// route whose times are not known says no.
export function flightMarks(route) {
  return { morningArrival: Boolean(route.flights && route.flights.back.arrives < NOON) };
}

// Whether a fare's flight back lands in Korea before noon, where it says.
export function landsInTheMorning(fare) {
  return Boolean(fare.arrives && fare.arrives < NOON);
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

// Whether `airline`'s fares always include a checked bag here (`included`
// in baggage.json), or to `country` (`includedTo`), though Aviasales marks a
// few of theirs without.
function alwaysIncludesBag(airline, country, baggage) {
  if (!baggage) return false;
  return Boolean((baggage.included && baggage.included.includes(airline))
    || (baggage.includedTo && baggage.includedTo[airline] && baggage.includedTo[airline].includes(country)));
}

// The checked bags `fare` to `country` includes for each person: as many
// as it says (`bags`), but one for an airline that always includes one
// there, and one for a fare that does not say.
export function bagsIncluded(fare, country, baggage) {
  if (fare.bags > 0) return fare.bags;
  return fare.bags === 0 && !alwaysIncludesBag(airlineOf(fare), country, baggage) ? 0 : 1;
}

// Whom the page prices a trip for when not told otherwise: one person
// checking one bag.
export const DEFAULT_PARTY = { people: 1, bags: 1 };

// What `party`, its `people` checking `bags` bags between them, pays for
// the bags `fare` on `route` does not include (`count`), each both ways:
// twice the one-way fee baggage.json gives the airline, for all its routes
// or for the destination's country, or failing that the usual fee to that
// country, which is a guess and so `approx`, as an airline's own fee may
// also be. The usual fee is a low-cost airline's, so it is not used for one
// that always includes a bag; the fee is `unknown` then, and when
// baggage.json gives neither. `included` is the bags the fare includes for
// each person.
export function bagFee(fare, route, baggage, party = DEFAULT_PARTY) {
  const included = fare ? bagsIncluded(fare, route.country, baggage) : 0;
  const count = fare ? Math.max(0, party.bags - party.people * included) : 0;
  const fee = { amount: 0, count, included, approx: false, unknown: false };
  if (count === 0) return fee;
  const airline = airlineOf(fare);
  const own = baggage && baggage.airlines && baggage.airlines[airline];
  const ownFee = own && (typeof own.fee === 'object' ? own.fee[route.country] : own.fee);
  if (ownFee) return { ...fee, amount: 2 * count * ownFee, approx: Boolean(own.approx) };
  const usual = !alwaysIncludesBag(airline, route.country, baggage) && baggage && baggage.usual
    && baggage.usual[route.country];
  if (usual) return { ...fee, amount: 2 * count * usual, approx: true };
  return { ...fee, unknown: true };
}

// The marks a trip's flights earn: from the fare's own times where it has
// them, else from the route's times when the trip is Korean Air's. Another
// airline's fare without times earns none.
function marksFor(route, fare) {
  if (fare && (fare.departs || fare.arrives)) return { morningArrival: landsInTheMorning(fare) };
  if (!fare || airlineOf(fare) === 'KE') return flightMarks(route);
  return { morningArrival: false };
}

// Whether the flight out lands abroad at 6 p.m. local time or later, or on
// a day after it leaves, so that the first day is lost; the page offers no
// such trip. A fare's own times decide where it has them (`arrivesAbroad`,
// `landsAbroad`), else a Korean Air trip goes by the route's times, and
// another airline's fare without them is let through.
export function landsLate(route, fare) {
  if (fare && (fare.departs || fare.arrivesAbroad)) {
    return Boolean(fare.landsAbroad && fare.landsAbroad > fare.depart)
      || Boolean(fare.arrivesAbroad && fare.arrivesAbroad >= LATE);
  }
  if (!fare || airlineOf(fare) === 'KE') return Boolean(route.flights && route.flights.out.arrives >= LATE);
  return false;
}

// The connections a fare makes on the way out and on the way back; a fare
// that names none (`stops`) is nonstop both ways.
export function stopsOf(fare) {
  return (fare && fare.stops) || [0, 0];
}

function nonstop(fare) {
  const [out, back] = stopsOf(fare);
  return out === 0 && back === 0;
}

// How much less than its price a fare counts for each person when trips
// are ordered and a trip's fare is picked: Korean Air and Asiana by 50,000
// won, business by 200,000 and first by 500,000, together for Korean Air's
// business. The page still shows what the fare costs.
export const ADVANTAGE = { airlines: { KE: 50000, OZ: 50000 }, cabins: { business: 200000, first: 500000 } };

export function advantageOf(fare) {
  return (ADVANTAGE.airlines[airlineOf(fare)] || 0) + (ADVANTAGE.cabins[cabinOf(fare)] || 0);
}

function tripKey(trip) {
  return `${trip.route} ${trip.depart} ${trip.return}`;
}

function priceOf(trip) {
  return trip.fare ? trip.rank : Infinity;
}

function byNumber(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function byString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The trips with a known fare first, the lowest rank first; then the
// soonest departure, and on the same day the shorter trip, and a nonstop
// one before one that connects.
function byFareDate(a, b) {
  return byNumber(priceOf(a), priceOf(b)) || byString(a.depart, b.depart)
    || a.nights - b.nights || byString(a.route, b.route)
    || CABINS.indexOf(a.cabin) - CABINS.indexOf(b.cabin)
    || Number(!nonstop(a.fare)) - Number(!nonstop(b.fare));
}

// The trips that match `filter` and take no leave: the page works out the
// leave of each (`leaveFor`) to tell which to offer, and keeps it in
// `leave`, but does not show it. For each cabin with a known fare among the
// airlines asked for, it offers one nonstop both ways and one that connects
// once on the way out, back or both, each with the fare that ranks lowest,
// and with its airline and cabin, its connections, the day its flight back
// lands, the holidays it spans and the marks its flight times earn; known
// fares first, the lowest rank first, then the soonest departure. A fare
// costs its price for
// each of the people in `party` and the fee for the bags they check that it
// does not include, each both ways (`bag`, from `bagFee`), and is held to the
// budget by that `total`; it ranks at that less its advantage for each
// person (`advantageOf`). A trip whose flight out lands late (`landsLate`) is
// not offered. The schedules are Korean Air's, so another airline's trip
// comes only from a fare; a trip from them without a nonstop fare is offered
// without one, in the cheaper cabin asked for of economy and business, but
// never in first, which Korean Air hardly sells on these routes.
//
// filter: { from, to, nights, maxPrice, origins, cities, airlines, cabins, party }
// `from` and `to` bound the departure date. `nights` (a Set of trip lengths
// in nights) is left out to mean all of TRIP_NIGHTS, and no other length is
// ever offered; `party` ({ people, bags }) to mean DEFAULT_PARTY;
// `maxPrice`, `origins` (a Set of Korean airport codes), `cities` (a Set of
// destination airport codes), `airlines` (a Set of airline codes) and
// `cabins` (a Set of CABINS) to mean no limit.
export function recommend({ routes, fares, holidays, today, baggage }, filter) {
  const party = filter.party || DEFAULT_PARTY;
  const from = filter.from > today ? filter.from : today;
  const nights = new Set(TRIP_NIGHTS.filter((n) => !filter.nights || filter.nights.has(n)));
  const wanted = (route) => (!filter.origins || filter.origins.has(route.origin))
    && (!filter.cities || filter.cities.has(route.dest));
  const flown = (airline) => !filter.airlines || filter.airlines.has(airline);
  const seated = (cabin) => !filter.cabins || filter.cabins.has(cabin);
  const scheduled = ['economy', 'business'].find(seated);
  const byId = new Map(routes.map((route) => [route.id, route]));

  const rowFor = (trip, fare) => {
    const route = byId.get(trip.route);
    const marks = marksFor(route, fare);
    // A flight back that leaves late at night lands the next day.
    const lands = (fare && fare.lands) || trip.return;
    const { leave, holidays: names } = leaveFor(trip.depart, lands, holidays, marks);
    const bag = bagFee(fare, route, baggage, party);
    const total = fare ? party.people * fare.price + bag.amount : null;
    return {
      ...trip, fare, airline: fare ? airlineOf(fare) : 'KE', cabin: fare ? cabinOf(fare) : scheduled,
      stops: stopsOf(fare), total, rank: fare ? total - party.people * advantageOf(fare) : null,
      bag, lands, leave, holidays: names, ...marks,
    };
  };
  const kept = (row) => row.leave === 0
    && (filter.maxPrice == null || (row.fare && row.total <= filter.maxPrice));

  // A fare proves a flight even where the schedule is not known.
  const best = new Map();
  const nonstopTrips = new Set();
  for (const fare of fares) {
    const route = byId.get(fare.route);
    if (!route || !wanted(route) || !flown(airlineOf(fare)) || !seated(cabinOf(fare))) continue;
    const n = daysBetween(fare.depart, fare.return);
    if (!(fare.depart >= from && fare.depart <= filter.to && nights.has(n) && fare.price > 0)) continue;
    if (landsLate(route, fare)) continue;
    const row = rowFor({ route: fare.route, depart: fare.depart, return: fare.return, nights: n }, fare);
    if (!kept(row)) continue;
    if (nonstop(fare)) nonstopTrips.add(tripKey(row));
    const key = `${tripKey(row)} ${row.cabin} ${nonstop(fare) ? 'nonstop' : 'via'}`;
    const held = best.get(key);
    if (!held || row.rank < held.rank) best.set(key, row);
  }

  const out = [...best.values()];
  for (const route of flown('KE') && scheduled ? routes : []) {
    if (!wanted(route) || landsLate(route, null)) continue;
    for (const trip of roundTrips(route, from, filter.to, nights)) {
      if (nonstopTrips.has(tripKey(trip))) continue;
      const row = rowFor(trip, null);
      if (kept(row)) out.push(row);
    }
  }
  return out.sort(byFareDate);
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

// Searches for one trip on sites that show live prices: in `cabin`, for
// `people` adults, and on KAYAK on `airline`, nonstop unless the trip
// connects (`nonstop`). None of the sites documents these URLs, so one may
// change its format without notice.
export function searchLinks(route, depart, ret, {
  airline = 'KE', cabin = 'economy', people = 1, nonstop: direct = true,
} = {}) {
  const from = route.origin;
  const to = route.dest;
  const compact = (date) => date.replaceAll('-', '');
  const query = `Flights from ${from} to ${to} on ${depart} through ${ret}`
    + (cabin === 'economy' ? '' : ` in ${cabin} class`)
    + (people === 1 ? '' : ` for ${people} adults`);
  return [
    {
      name: 'Google',
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=ko&gl=kr&curr=KRW`,
    },
    {
      name: '스카이스캐너',
      url: `https://www.skyscanner.co.kr/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/`
        + `${compact(depart).slice(2)}/${compact(ret).slice(2)}/`
        + `?adultsv2=${people}&cabinclass=${cabin}&rtn=1&preferdirects=${direct}`,
    },
    {
      name: '카약',
      url: `https://www.kayak.co.kr/flights/${from}-${to}/${depart}/${ret}`
        + `${cabin === 'economy' ? '' : `/${cabin}`}${people === 1 ? '' : `/${people}adults`}`
        + `?sort=price_a&fs=airlines=${airline}${direct ? ';stops=0' : ''}`,
    },
  ];
}
