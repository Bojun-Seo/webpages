// What the page works out, kept apart from the DOM so Node can test it.
//
// Dates are 'YYYY-MM-DD' strings throughout. They compare correctly as
// strings and become UTC midnights only for arithmetic, so the viewer's
// time zone never moves a trip by a day.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
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
// around in Japan the same day, so the flights out and back share days.
export function fliesOn(route, date) {
  const period = periodOn(route, date);
  return period ? periodFlies(period, dayOf(date)) : false;
}

// The days a period flies in airline timetable notation: a digit per day
// from 1 for Monday, a dot where there is no flight, so Monday, Wednesday,
// Friday and Sunday read "1.3.5.7".
export function timetableDays(period) {
  return WEEK.map((day, i) => (periodFlies(period, day) ? String(i + 1) : '.')).join('');
}

export function weeklyFlights(period) {
  return WEEK.filter((day) => periodFlies(period, day)).length;
}

// A route's flight times as its card shows them, such as
// "KE2183 인천 10:35 → 히로시마 12:15 · KE2184 히로시마 13:25 → 인천 15:25".
// Every route starts at Incheon.
export function flightTimes(route) {
  const leg = (flight, from, to) =>
    `${flight.number ? `${flight.number} ` : ''}${from} ${flight.departs} → ${to} ${flight.arrives}`;
  return `${leg(route.flights.out, '인천', route.city)} · ${leg(route.flights.back, route.city, '인천')}`;
}

// Every round trip on `route` leaving between `from` and `to` that stays
// `minNights` to `maxNights` nights with a flight at both ends.
export function roundTrips(route, from, to, minNights, maxNights) {
  const trips = [];
  for (let out = from; out <= to; out = addDays(out, 1)) {
    if (!fliesOn(route, out)) continue;
    for (let nights = minNights; nights <= maxNights; nights++) {
      const back = addDays(out, nights);
      if (fliesOn(route, back)) trips.push({ route: route.id, depart: out, return: back, nights });
    }
  }
  return trips;
}

// Leave and Fridays are counted by day number, days since 1 January 1970,
// so that thousands of trips need no date strings built day by day.
function dayNumber(date) {
  return toUTC(date) / DAY_MS;
}

// 0 for Sunday to 6 for Saturday; day 0 was a Thursday.
function weekday(day) {
  return (day + 4) % 7;
}

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

// The leave a trip takes: weekdays from departure to return, both ends
// included as whole days, that are not public holidays. Also gives the
// holidays the trip spans, a substitute day under the name of the holiday
// it stands in for.
export function leaveFor(depart, ret, holidays) {
  const named = holidayDays(holidays);
  let leave = 0;
  const names = [];
  for (let day = dayNumber(depart), last = dayNumber(ret); day <= last; day++) {
    const name = named.get(day);
    if (name) {
      const shown = name.replace(/ 대체공휴일$/, '');
      if (!names.includes(shown)) names.push(shown);
    } else if (weekday(day) !== 0 && weekday(day) !== 6) {
      leave++;
    }
  }
  return { leave, holidays: names };
}

// Whether a trip spans a Friday, departure and return days included.
export function spansFriday(depart, ret) {
  const first = dayNumber(depart);
  return (5 - weekday(first) + 7) % 7 <= dayNumber(ret) - first;
}

// Times are 'HH:MM' on the clock Korea and Japan share, so they compare as
// strings.
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

// The cheapest fare for each route and pair of dates, among trips that
// have not left yet.
export function cheapestFares(fares, today) {
  const best = new Map();
  for (const fare of fares) {
    if (!(fare.depart >= today && fare.return > fare.depart && fare.price > 0)) continue;
    const key = tripKey(fare);
    const held = best.get(key);
    if (!held || fare.price < held.price) best.set(key, fare);
  }
  return best;
}

function priceOf(trip) {
  return trip.fare ? trip.fare.price : Infinity;
}

function byNumber(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function byString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Trips with a known fare first, the cheapest first; then the soonest
// departure, and on the same day the shorter trip.
function byFareThenDate(a, b) {
  return byNumber(priceOf(a), priceOf(b)) || byString(a.depart, b.depart) || a.nights - b.nights
    || byString(a.route, b.route);
}

// The trips that match `filter`, each with the cheapest known fare among
// the airlines asked for and its airline, its leave, the holidays it spans,
// whether it spans a Friday and the marks its flight times earn: known
// fares first, the cheapest first, then the soonest departure. The
// schedules are Korean Air's, so another airline's trip comes only from a
// fare.
//
// filter: { from, to, minNights, maxNights, maxLeave, maxPrice, cities, airlines }
// `from` and `to` bound the departure date; `maxLeave`, `maxPrice`,
// `cities` (a Set of route ids) and `airlines` (a Set of airline codes) are
// left out to mean no limit.
export function recommend({ routes, fares, holidays, today }, filter) {
  const from = filter.from > today ? filter.from : today;
  const wanted = (id) => !filter.cities || filter.cities.has(id);
  const flown = (airline) => !filter.airlines || filter.airlines.has(airline);
  const byId = new Map(routes.map((route) => [route.id, route]));
  const cheapest = cheapestFares(
    fares.filter((fare) => byId.has(fare.route) && flown(airlineOf(fare))), today);

  const trips = new Map();
  for (const route of flown('KE') ? routes : []) {
    if (!wanted(route.id)) continue;
    for (const trip of roundTrips(route, from, filter.to, filter.minNights, filter.maxNights)) {
      trips.set(tripKey(trip), trip);
    }
  }
  // A fare proves a flight even where the schedule is not known.
  for (const [key, fare] of cheapest) {
    const nights = daysBetween(fare.depart, fare.return);
    if (trips.has(key) || !wanted(fare.route) || fare.depart < from || fare.depart > filter.to
      || nights < filter.minNights || nights > filter.maxNights) continue;
    trips.set(key, { route: fare.route, depart: fare.depart, return: fare.return, nights });
  }

  const out = [];
  for (const [key, trip] of trips) {
    const fare = cheapest.get(key) || null;
    const { leave, holidays: names } = leaveFor(trip.depart, trip.return, holidays);
    if (filter.maxLeave != null && leave > filter.maxLeave) continue;
    if (filter.maxPrice != null && !(fare && fare.price <= filter.maxPrice)) continue;
    out.push({
      ...trip, fare, airline: fare ? airlineOf(fare) : 'KE', leave, holidays: names,
      friday: spansFriday(trip.depart, trip.return), ...marksFor(byId.get(trip.route), fare),
    });
  }
  return out.sort(byFareThenDate);
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

// Searches for one trip on sites that show live prices. None of them
// documents these URLs, so a site may change its format without notice.
// KAYAK's asks for the trip's airline, nonstop.
export function searchLinks(route, depart, ret, airline = 'KE') {
  const from = route.origin;
  const to = route.dest;
  const compact = (date) => date.replaceAll('-', '');
  const query = `Flights from ${from} to ${to} on ${depart} through ${ret}`;
  return [
    {
      name: '네이버',
      url: `https://flight.naver.com/flights/international/${from}-${to}-${compact(depart)}/`
        + `${to}-${from}-${compact(ret)}?adult=1&fareType=Y`,
    },
    {
      name: 'Google',
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=ko&gl=kr&curr=KRW`,
    },
    {
      name: '스카이스캐너',
      url: `https://www.skyscanner.co.kr/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/`
        + `${compact(depart).slice(2)}/${compact(ret).slice(2)}/`
        + '?adultsv2=1&cabinclass=economy&rtn=1&preferdirects=true',
    },
    {
      name: '카약',
      url: `https://www.kayak.co.kr/flights/${from}-${to}/${depart}/${ret}`
        + `?sort=price_a&fs=airlines=${airline};stops=0`,
    },
  ];
}
