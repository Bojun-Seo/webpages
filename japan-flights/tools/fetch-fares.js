// Fetches the nonstop round-trip fares of every airline, in economy,
// business and first, for the routes in routes.json from the Travelpayouts
// (Aviasales) Data API and writes them where the page looks for live fares,
// each with its airline, its cabin and the times its flights leave and land
// where the API gives them. The API serves prices
// that Aviasales users found in the last 48 hours, so a route few people
// search there can come back empty.
//
//   TRAVELPAYOUTS_TOKEN=... node tools/fetch-fares.js \
//       [--routes site/data/routes.json] [--out site/data/live-fares.json] [--months 6]
//
// Without a token it writes an empty file, so the page can say live fares
// are not set up. It exits 1 only when every query failed.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
// The API takes 600 queries a minute; a pause of 0.15 s between them keeps
// well under that even when answers come back at once.
const PAUSE_MS = 150;

// The cabins fares are fetched for, as the API's `trip_class` numbers them.
export const CABINS = { economy: 0, business: 1, first: 2 };

// Local dates and times, whatever offset the API writes its times in.
// Korea and Japan keep UTC+9 all year, and Taiwan, Hong Kong and Macau
// UTC+8; a route outside UTC+9 says so in `utcOffset`.
const KOREA = 9;

function local(ms, offset) {
  return new Date(ms + offset * 3600e3).toISOString();
}

export function localDate(timestamp, offset = KOREA) {
  return local(Date.parse(timestamp), offset).slice(0, 10);
}

export function localTime(timestamp) {
  return local(Date.parse(timestamp), KOREA).slice(11, 16);
}

// The moment a flight that leaves at `timestamp` and flies `minutes` lands.
function landing(timestamp, minutes) {
  return new Date(Date.parse(timestamp) + minutes * 60e3).toISOString();
}

export function monthsFrom(today, count) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1 + i, 1));
    return date.toISOString().slice(0, 7);
  });
}

// The nonstop round trips in one API response for `route`, of every
// airline. A ticket names its cities (SEL, TYO) as well as its airports,
// and counts only when it flies between the route's own airports. The dates
// are each flight's local date of departure. `departs` is when the flight
// out leaves Korea; `arrives`, when the flight back lands there, is known
// only if the response gives its duration, and `lands` gives the day too
// when it is not the date the flight left on, as for a flight that leaves
// late at night. A fare in business or first says so in `cabin`.
export function pickFares(response, route, seen, cabin = 'economy') {
  if (!response || response.success === false || !Array.isArray(response.data)) return [];
  return response.data
    .filter((t) => t.airline && !t.transfers && !t.return_transfers
      && t.departure_at && t.return_at && t.price > 0
      && (!t.origin_airport || t.origin_airport === route.origin)
      && (!t.destination_airport || t.destination_airport === route.dest))
    .map((t) => {
      const fare = {
        route: route.id,
        airline: t.airline,
        depart: localDate(t.departure_at),
        return: localDate(t.return_at, route.utcOffset ?? KOREA),
        price: Math.round(t.price),
        seen,
        source: 'Aviasales',
        departs: localTime(t.departure_at),
        ...(cabin === 'economy' ? {} : { cabin }),
      };
      if (Number.isFinite(t.duration_back)) {
        const back = landing(t.return_at, t.duration_back);
        fare.arrives = localTime(back);
        if (localDate(back) > fare.return) fare.lands = localDate(back);
      }
      return fare;
    });
}

// The cheapest fare for each route, pair of dates, airline and cabin; the
// page needs no other.
export function keepCheapest(fares) {
  const best = new Map();
  for (const fare of fares) {
    const key = `${fare.route} ${fare.depart} ${fare.return} ${fare.airline} ${fare.cabin || 'economy'}`;
    const held = best.get(key);
    if (!held || fare.price < held.price) best.set(key, fare);
  }
  return [...best.values()];
}

// Whether the tickets an answer for business or first gives are mostly
// those of the economy answer for the same months, as they would be if the
// API paid no heed to `trip_class`, which `prices_for_dates` does not
// document. Such tickets are economy fares and must not pass for others.
export function repeatsEconomy(tickets, economy) {
  const sign = (t) => `${t.airline} ${t.departure_at} ${t.return_at} ${t.price}`;
  const signs = new Set(economy.map(sign));
  return tickets.length > 0 && tickets.filter((t) => signs.has(sign(t))).length * 2 > tickets.length;
}

// How many of `fares` there are in each cabin, with their airlines, for the
// log: "12 economy (7C, KE), 1 business (KE), 0 first".
function tally(fares) {
  return Object.keys(CABINS).map((cabin) => {
    const these = fares.filter((f) => (f.cabin || 'economy') === cabin);
    const airlines = [...new Set(these.map((f) => f.airline))].sort().join(', ');
    return `${these.length} ${cabin}${airlines ? ` (${airlines})` : ''}`;
  }).join(', ');
}

async function query(route, departMonth, returnMonth, tripClass, token) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    origin: route.origin,
    destination: route.dest,
    departure_at: departMonth,
    return_at: returnMonth,
    one_way: 'false',
    direct: 'true',
    unique: 'false',
    sorting: 'price',
    currency: 'krw',
    limit: '1000',
    trip_class: String(tripClass),
  });
  const res = await fetch(url, { headers: { 'X-Access-Token': token } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main(argv) {
  const here = (path) => fileURLToPath(new URL(path, import.meta.url));
  const { values } = parseArgs({
    args: argv,
    options: {
      routes: { type: 'string', default: here('../site/data/routes.json') },
      out: { type: 'string', default: here('../site/data/live-fares.json') },
      months: { type: 'string', default: '6' },
    },
  });
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const write = (doc) => writeFile(values.out, `${JSON.stringify(doc, null, 1)}\n`);
  if (!token) {
    await write({ updated: null, fares: [] });
    console.log('TRAVELPAYOUTS_TOKEN is not set; wrote no live fares.');
    return 0;
  }

  const { routes } = JSON.parse(await readFile(values.routes, 'utf8'));
  const seen = localDate(new Date().toISOString());
  const months = monthsFrom(seen, Number(values.months));
  let fares = [];
  let ok = 0;
  let failed = 0;
  // The API's own documentation is all the tests check the format against,
  // so the log names the fields a real ticket has and shows the first ticket
  // in business and in first, once a run, and each route's fares in each
  // cabin with their airlines.
  let shown = false;
  const sampled = new Set();
  const repeated = { business: 0, first: 0 };
  for (const route of routes) {
    const before = fares.length;
    for (const out of months) {
      // Ask for returns in the same month and the next, so a trip over a
      // month's end (New Year's) is not missed.
      for (const back of [out, monthsFrom(`${out}-01`, 2)[1]]) {
        // The economy answer, which the answers for the other cabins are
        // checked against; without it they are not asked for.
        let economy = null;
        for (const [cabin, tripClass] of Object.entries(CABINS)) {
          if (cabin !== 'economy' && !economy) continue;
          if (ok + failed > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
          try {
            const response = await query(route, out, back, tripClass, token);
            const tickets = Array.isArray(response?.data) ? response.data : [];
            ok++;
            if (!shown && tickets.length) {
              console.log(`Ticket fields: ${Object.keys(tickets[0]).join(', ')}`);
              shown = true;
            }
            if (cabin === 'economy') {
              economy = tickets;
            } else if (repeatsEconomy(tickets, economy)) {
              repeated[cabin]++;
              continue;
            } else if (tickets.length && !sampled.has(cabin)) {
              console.log(`First ${cabin} ticket: ${JSON.stringify(tickets[0])}`);
              sampled.add(cabin);
            }
            fares.push(...pickFares(response, route, seen, cabin));
          } catch (error) {
            failed++;
            console.warn(`${route.id} ${out}/${back} ${cabin}: ${error.message}`);
          }
        }
      }
    }
    console.log(`${route.id}: ${tally(fares.slice(before))}`);
  }

  fares = keepCheapest(fares);
  await write({ updated: new Date().toISOString(), source: 'Aviasales', fares });
  console.log(`Wrote ${fares.length} fares, ${tally(fares)}, from ${ok} queries `
    + `(${failed} failed) to ${values.out}.`);
  if (repeated.business + repeated.first > 0) {
    console.log(`Dropped as repeats of economy: ${repeated.business} answers in business, `
      + `${repeated.first} in first.`);
  }
  return ok === 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
