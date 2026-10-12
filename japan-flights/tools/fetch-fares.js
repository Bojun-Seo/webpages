// Fetches the round-trip economy fares of every airline for the routes the
// page knows (routes.json, and its origins to each destination) from the
// Travelpayouts (Aviasales) Data API, nonstop or with one connection each
// way, and writes the ones the page can offer where it looks for live
// fares, each with its airline, its connections, the checked bags it
// includes and the times its flights leave and land where the API gives
// them. The API takes no cabin: asked for business or first with
// `trip_class`, it answers with the same economy tickets. The API serves
// prices that Aviasales users found in the last 48 hours, so a route few
// people search there can come back empty.
//
//   TRAVELPAYOUTS_TOKEN=... node tools/fetch-fares.js \
//       [--routes site/data/routes.json] [--out site/data/live-fares.json] [--months 6]
//
// Without a token it writes an empty file, so the page can say live fares
// are not set up. It exits 1 only when every query failed.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { TRIP_NIGHTS, daysBetween, landsInTheMorning, landsLate, routesOf } from '../site/plan.js';

const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
const LIMIT = 1000;
// The API takes 600 queries a minute; a pause of 0.15 s between them keeps
// well under that even when answers come back at once.
const PAUSE_MS = 150;

// Local dates and times, whatever offset the API writes its times in.
// Korea and Japan keep UTC+9 all year; a route outside UTC+9 says so in
// `utcOffset`: Taiwan, Hong Kong and Macau UTC+8, Vietnam and Thailand
// UTC+7, Guam and Saipan UTC+10.
const KOREA = 9;

function local(ms, offset) {
  return new Date(ms + offset * 3600e3).toISOString();
}

export function localDate(timestamp, offset = KOREA) {
  return local(Date.parse(timestamp), offset).slice(0, 10);
}

export function localTime(timestamp, offset = KOREA) {
  return local(Date.parse(timestamp), offset).slice(11, 16);
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

// The round trips in one API response for `route`, of every airline, with
// no more than one connection each way; `stops` gives the connections out
// and back of a ticket that makes any. A ticket names its cities (SEL, TYO)
// as well as its airports, and counts only when it flies between the
// route's own airports. The dates are each flight's local date of
// departure. `departs` is when the flight out leaves Korea, Korean time.
// The times the flights land are known only if the response gives their
// durations: `arrivesAbroad` when the flight out lands, local time, with
// `landsAbroad` for its day when that is not the day it left; `arrives`
// when the flight back lands in Korea, with `lands` for its day when that
// is not the day it left, as for a flight that leaves late at night.
// `bags` is the checked bags the fare includes for each person, 0 for
// none, where the ticket's link says.
export function pickFares(response, route, seen) {
  if (!response || response.success === false || !Array.isArray(response.data)) return [];
  const abroad = route.utcOffset ?? KOREA;
  return response.data
    .filter((t) => t.airline && (t.transfers || 0) <= 1 && (t.return_transfers || 0) <= 1
      && t.departure_at && t.return_at && t.price > 0
      && (!t.origin_airport || t.origin_airport === route.origin)
      && (!t.destination_airport || t.destination_airport === route.dest))
    .map((t) => {
      const bags = checkedBags(t.link);
      const fare = {
        route: route.id,
        airline: t.airline,
        depart: localDate(t.departure_at),
        return: localDate(t.return_at, abroad),
        price: Math.round(t.price),
        seen,
        source: 'Aviasales',
        departs: localTime(t.departure_at),
        ...(t.transfers || t.return_transfers ? { stops: [t.transfers || 0, t.return_transfers || 0] } : {}),
        ...(bags == null ? {} : { bags }),
      };
      if (Number.isFinite(t.duration_to)) {
        const there = landing(t.departure_at, t.duration_to);
        fare.arrivesAbroad = localTime(there, abroad);
        if (localDate(there, abroad) !== fare.depart) fare.landsAbroad = localDate(there, abroad);
      }
      if (Number.isFinite(t.duration_back)) {
        const back = landing(t.return_at, t.duration_back);
        fare.arrives = localTime(back);
        if (localDate(back) > fare.return) fare.lands = localDate(back);
      }
      return fare;
    });
}

// The fares the page could offer: the cheapest for each route, pair of
// dates and airline, apart for those without a checked bag, since the page
// adds the bag's fee to them, for those that connect, which it lists apart
// from nonstop ones, and for each day and time of day the flight back
// lands that the leave a trip takes depends on.
export function keepCheapest(fares) {
  const best = new Map();
  for (const fare of fares) {
    const key = `${fare.route} ${fare.depart} ${fare.return} ${fare.airline}`
      + (fare.bags === 0 ? ' no bag' : '') + (fare.stops ? ' via' : '')
      + ` ${fare.lands || fare.return}${landsInTheMorning(fare) ? ' morning' : ''}`;
    const held = best.get(key);
    if (!held || fare.price < held.price) best.set(key, fare);
  }
  return [...best.values()];
}

// The checked bags a ticket's fare includes, from the `static_fare_key` its
// link carries: its `L` part reads "L0" for none, "L1_1_15" for one bag of
// 15 kg and "L1_2_0" for two. Null when the link does not say.
export function checkedBags(link) {
  const query = String(link || '').split('?')[1];
  const key = query && new URLSearchParams(query).get('static_fare_key');
  const part = key && key.split('|').find((p) => /^L\d/.test(p));
  if (!part) return null;
  return part === 'L0' ? 0 : Number(part.split('_')[1] || 1);
}

// How many `fares` there are, with their airlines, for the log:
// "12 fares (7C, KE)".
function tally(fares) {
  const airlines = [...new Set(fares.map((f) => f.airline))].sort().join(', ');
  return `${fares.length} fares${airlines ? ` (${airlines})` : ''}`;
}

// How many of each airline's `fares` include no checked bag, include one or
// more, and do not say, for the log: "TW 71/30/2".
export function bagTally(fares) {
  const counts = {};
  for (const fare of fares) {
    counts[fare.airline] ||= [0, 0, 0];
    counts[fare.airline][fare.bags === 0 ? 0 : fare.bags > 0 ? 1 : 2]++;
  }
  return Object.entries(counts).sort().map(([airline, n]) => `${airline} ${n.join('/')}`).join(', ');
}

async function query(route, departMonth, returnMonth, token) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    origin: route.origin,
    destination: route.dest,
    departure_at: departMonth,
    return_at: returnMonth,
    one_way: 'false',
    direct: 'false',
    unique: 'false',
    sorting: 'price',
    currency: 'krw',
    limit: String(LIMIT),
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

  const routes = routesOf(JSON.parse(await readFile(values.routes, 'utf8')));
  const seen = localDate(new Date().toISOString());
  const months = monthsFrom(seen, Number(values.months));
  let fares = [];
  let ok = 0;
  let failed = 0;
  let late = 0;
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
          if (response?.data?.length >= LIMIT) {
            console.warn(`${route.id} ${out}/${back}: the answer reached the limit of ${LIMIT} tickets`);
          }
          for (const fare of pickFares(response, route, seen)) {
            if (!TRIP_NIGHTS.includes(daysBetween(fare.depart, fare.return))) continue;
            if (landsLate(route, fare)) late++;
            else fares.push(fare);
          }
          ok++;
        } catch (error) {
          failed++;
          console.warn(`${route.id} ${out}/${back}: ${error.message}`);
        }
      }
    }
    console.log(`${route.id}: ${tally(fares.slice(before))}`);
  }

  fares = keepCheapest(fares);
  await write({ updated: new Date().toISOString(), source: 'Aviasales', fares });
  console.log(`Wrote ${tally(fares)}, ${fares.filter((f) => f.stops).length} of them connecting, `
    + `from ${ok} queries (${failed} failed) to ${values.out}; left out ${late} whose flight out lands late.`);
  console.log(`Checked bags, by airline (none/included/not said): ${bagTally(fares) || 'no fares'}.`);
  return ok === 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
