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

// Every route the page knows: one from each Korean airport in `origins` to
// each place in `destinations`, with the place's city, country and, outside
// UTC+9, time zone.
export function routesOf(doc) {
  return doc.origins.flatMap((origin) => doc.destinations.map((place) => ({
    id: `${origin}-${place.dest}`, origin, ...place,
  })));
}

// The trip lengths the page offers, in nights. It never offers a trip of
// one night.
export const TRIP_NIGHTS = [2, 3, 4, 5, 6];

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

// Whether a fare's flight back lands in Korea before noon, where it says.
export function landsInTheMorning(fare) {
  return Boolean(fare.arrives && fare.arrives < NOON);
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
  return fare.bags === 0 && !alwaysIncludesBag(fare.airline, country, baggage) ? 0 : 1;
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
  const included = bagsIncluded(fare, route.country, baggage);
  const count = Math.max(0, party.bags - party.people * included);
  const fee = { amount: 0, count, included, approx: false, unknown: false };
  if (count === 0) return fee;
  const { airline } = fare;
  const own = baggage && baggage.airlines && baggage.airlines[airline];
  const ownFee = own && (typeof own.fee === 'object' ? own.fee[route.country] : own.fee);
  if (ownFee) return { ...fee, amount: 2 * count * ownFee, approx: Boolean(own.approx) };
  const usual = !alwaysIncludesBag(airline, route.country, baggage) && baggage && baggage.usual
    && baggage.usual[route.country];
  if (usual) return { ...fee, amount: 2 * count * usual, approx: true };
  return { ...fee, unknown: true };
}

// Whether a fare's flight out lands abroad at 6 p.m. local time or later,
// or on a day after it leaves, so that the first day is lost; the page
// offers no such trip. A fare that does not give the times
// (`arrivesAbroad`, `landsAbroad`) is let through.
export function landsLate(fare) {
  return Boolean(fare.landsAbroad && fare.landsAbroad > fare.depart)
    || Boolean(fare.arrivesAbroad && fare.arrivesAbroad >= LATE);
}

// The connections a fare makes on the way out and on the way back; a fare
// that names none (`stops`) is nonstop both ways.
export function stopsOf(fare) {
  return fare.stops || [0, 0];
}

function nonstop(fare) {
  const [out, back] = stopsOf(fare);
  return out === 0 && back === 0;
}

// The three airline alliances, each with its members' codes as of October
// 2026, affiliates such as Japan Transocean Air and Shanghai Airlines
// included. Asiana is counted in SkyTeam: it leaves Star Alliance on
// 16 December 2026 and merges into Korean Air the next day.
export const ALLIANCES = {
  skyteam: ['KE', 'OZ', 'VN', 'MU', 'FM', 'MF', 'CI', 'GA', 'DL', 'AF', 'KL', 'VS', 'SK', 'SV', 'ME', 'KQ', 'AM',
    'AR', 'RO', 'UX'],
  star: ['NH', 'BR', 'CA', 'ZH', 'SQ', 'TG', 'UA', 'ET', 'AC', 'AI', 'NZ', 'LH', 'LX', 'OS', 'SN', 'TK', 'TP', 'LO',
    'MS', 'SA', 'A3', 'AV', 'CM', 'OU'],
  oneworld: ['JL', 'NU', 'CX', 'MH', 'QF', 'QR', 'BA', 'AA', 'AY', 'IB', 'AS', 'FJ', 'UL', 'RJ', 'AT', 'WY'],
};

// The alliance `airline` belongs to, or null for one in none.
export function allianceOf(airline) {
  return Object.keys(ALLIANCES).find((alliance) => ALLIANCES[alliance].includes(airline)) || null;
}

// How much less than its price a fare counts for each person when trips
// are ordered and a trip's fare is picked: an alliance airline's by 50,000
// won. The page still shows what the fare costs.
export const ADVANTAGE = 50000;

export function advantageOf(fare) {
  return allianceOf(fare.airline) ? ADVANTAGE : 0;
}

function tripKey(trip) {
  return `${trip.route} ${trip.depart} ${trip.return}`;
}

function byNumber(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function byString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The lowest rank first; then the soonest departure, and on the same day
// the shorter trip, and a nonstop one before one that connects.
function byRankDate(a, b) {
  return byNumber(a.rank, b.rank) || byString(a.depart, b.depart)
    || a.nights - b.nights || byString(a.route, b.route)
    || Number(!nonstop(a.fare)) - Number(!nonstop(b.fare));
}

// The trips that match `filter` and take no leave, each from a fare: the
// page works out the leave of each (`leaveFor`) to tell which to offer, and
// keeps it in `leave`, but does not show it. Of the fares of the airlines
// asked for, it offers for each pair of dates on a route the one nonstop
// both ways and the one that connects once on the way out, back or both
// that rank lowest, each with its airline and the airline's alliance, its
// connections, the day its flight back lands, the holidays it spans and
// whether it lands in the morning; the lowest rank first, then the
// soonest departure. A fare costs
// its price for each of the people in `party` and the fee for the bags
// they check that it does not include, each both ways (`bag`, from
// `bagFee`), and is held to the budget by that `total`; it ranks at that
// less its advantage for each person (`advantageOf`). A fare whose flight
// out lands late (`landsLate`) is not offered.
//
// filter: { from, to, nights, maxPrice, origins, cities, alliances, airlines, party }
// `from` and `to` bound the departure date, and `to` is left out for no
// end. `nights` (a Set of trip lengths in nights) is left out to mean all
// of TRIP_NIGHTS, and no other length is ever offered; `party` ({ people,
// bags }) to mean DEFAULT_PARTY; `maxPrice`, `origins` (a Set of Korean
// airport codes), `cities` (a Set of destination airport codes),
// `alliances` (a Set of ALLIANCES' keys, and 'none' for the airlines in
// none) and `airlines` (a Set of airline codes) to mean no limit.
export function recommend({ routes, fares, holidays, today, baggage }, filter) {
  const party = filter.party || DEFAULT_PARTY;
  const from = filter.from > today ? filter.from : today;
  const nights = new Set(TRIP_NIGHTS.filter((n) => !filter.nights || filter.nights.has(n)));
  const byId = new Map(routes.map((route) => [route.id, route]));
  const wanted = (route) => (!filter.origins || filter.origins.has(route.origin))
    && (!filter.cities || filter.cities.has(route.dest));
  const flown = (airline) => (!filter.airlines || filter.airlines.has(airline))
    && (!filter.alliances || filter.alliances.has(allianceOf(airline) || 'none'));

  const best = new Map();
  for (const fare of fares) {
    const route = byId.get(fare.route);
    if (!route || !wanted(route) || !flown(fare.airline)) continue;
    const n = daysBetween(fare.depart, fare.return);
    const leaves = fare.depart >= from && (!filter.to || fare.depart <= filter.to);
    if (!leaves || !nights.has(n) || !(fare.price > 0) || landsLate(fare)) continue;
    const morningArrival = landsInTheMorning(fare);
    // A flight back that leaves late at night lands the next day.
    const lands = fare.lands || fare.return;
    const { leave, holidays: names } = leaveFor(fare.depart, lands, holidays, { morningArrival });
    if (leave > 0) continue;
    const bag = bagFee(fare, route, baggage, party);
    const total = party.people * fare.price + bag.amount;
    if (filter.maxPrice != null && total > filter.maxPrice) continue;
    const trip = {
      route: fare.route, depart: fare.depart, return: fare.return, nights: n, fare, airline: fare.airline,
      alliance: allianceOf(fare.airline), stops: stopsOf(fare), total, rank: total - party.people * advantageOf(fare),
      bag, lands, leave, holidays: names, morningArrival,
    };
    const key = `${tripKey(trip)} ${nonstop(fare) ? 'nonstop' : 'via'}`;
    const held = best.get(key);
    if (!held || trip.rank < held.rank) best.set(key, trip);
  }
  return [...best.values()].sort(byRankDate);
}

// The months from today's to the last one a fare leaves in.
export function fareMonths(fares, today) {
  let last = today;
  for (const fare of fares) if (fare.depart > last) last = fare.depart;
  const months = [];
  for (let month = today.slice(0, 7); month <= last.slice(0, 7);
    month = addDays(lastDayOfMonth(month), 1).slice(0, 7)) {
    months.push(month);
  }
  return months;
}

// Searches for one trip on sites that show live prices, in economy: for
// `people` adults, and on KAYAK on `airline`, nonstop unless the trip
// connects (`nonstop`). None of the sites documents these URLs, so one may
// change its format without notice.
export function searchLinks(route, depart, ret, { airline, people = 1, nonstop: direct = true } = {}) {
  const from = route.origin;
  const to = route.dest;
  const compact = (date) => date.replaceAll('-', '');
  const query = `Flights from ${from} to ${to} on ${depart} through ${ret}`
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
        + `?adultsv2=${people}&cabinclass=economy&rtn=1&preferdirects=${direct}`,
    },
    {
      name: '카약',
      url: `https://www.kayak.co.kr/flights/${from}-${to}/${depart}/${ret}${people === 1 ? '' : `/${people}adults`}`
        + `?sort=price_a&fs=airlines=${airline}${direct ? ';stops=0' : ''}`,
    },
  ];
}
