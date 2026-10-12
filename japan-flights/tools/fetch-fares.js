// Fetches the nonstop round-trip fares of every airline for the routes in
// routes.json from the Travelpayouts (Aviasales) Data API and writes them
// where the page looks for live fares, each with its airline and the times
// its flights leave and land where the API gives them. The API serves prices
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
const PAUSE_MS = 1100;

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
// late at night.
export function pickFares(response, route, seen) {
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
      };
      if (Number.isFinite(t.duration_back)) {
        const back = landing(t.return_at, t.duration_back);
        fare.arrives = localTime(back);
        if (localDate(back) > fare.return) fare.lands = localDate(back);
      }
      return fare;
    });
}

// The cheapest fare for each route, pair of dates and airline; the page
// needs no other.
export function keepCheapest(fares) {
  const best = new Map();
  for (const fare of fares) {
    const key = `${fare.route} ${fare.depart} ${fare.return} ${fare.airline}`;
    const held = best.get(key);
    if (!held || fare.price < held.price) best.set(key, fare);
  }
  return [...best.values()];
}

async function query(route, departMonth, returnMonth, token) {
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
  // so the log names the fields a real ticket has, once a run, and the
  // airlines of each route's fares.
  let shown = false;
  for (const route of routes) {
    const before = fares.length;
    for (const out of months) {
      // Ask for returns in the same month and the next, so a trip over a
      // month's end (New Year's) is not missed.
      for (const back of [out, monthsFrom(`${out}-01`, 2)[1]]) {
        if (ok + failed > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        try {
          const response = await query(route, out, back, token);
          if (!shown && response?.data?.length) {
            console.log(`Ticket fields: ${Object.keys(response.data[0]).join(', ')}`);
            shown = true;
          }
          fares.push(...pickFares(response, route, seen));
          ok++;
        } catch (error) {
          failed++;
          console.warn(`${route.id} ${out}/${back}: ${error.message}`);
        }
      }
    }
    const airlines = [...new Set(fares.slice(before).map((f) => f.airline))].sort().join(', ');
    console.log(`${route.id}: ${fares.length - before} fares${airlines ? ` (${airlines})` : ''}`);
  }

  fares = keepCheapest(fares);
  await write({ updated: new Date().toISOString(), source: 'Aviasales', fares });
  const airlines = [...new Set(fares.map((f) => f.airline))].sort().join(', ');
  console.log(`Wrote ${fares.length} fares (${airlines || 'no airline'}) from ${ok} queries `
    + `(${failed} failed) to ${values.out}.`);
  return ok === 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
