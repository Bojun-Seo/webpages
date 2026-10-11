// Fetches Korean Air nonstop round-trip fares for the routes in routes.json
// from the Travelpayouts (Aviasales) Data API and writes them where the page
// looks for live fares. The API serves prices that Aviasales users found in
// the last 48 hours, so a route few people search there can come back empty.
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

// Korea and Japan both keep UTC+9 all year, so one offset gives the local
// date at either end, whatever offset the API writes its times in.
export function localDate(timestamp) {
  return new Date(Date.parse(timestamp) + 9 * 3600e3).toISOString().slice(0, 10);
}

export function monthsFrom(today, count) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1 + i, 1));
    return date.toISOString().slice(0, 7);
  });
}

// The Korean Air nonstop round trips in one API response for `route`.
export function pickFares(response, route, seen) {
  if (!response || response.success === false || !Array.isArray(response.data)) return [];
  return response.data
    .filter((t) => t.airline === 'KE' && !t.transfers && !t.return_transfers
      && t.departure_at && t.return_at && t.price > 0)
    .map((t) => ({
      route: route.id,
      depart: localDate(t.departure_at),
      return: localDate(t.return_at),
      price: Math.round(t.price),
      seen,
      source: 'Aviasales',
    }));
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
  const fares = [];
  let ok = 0;
  let failed = 0;
  for (const route of routes) {
    for (const [i, out] of months.entries()) {
      // Ask for returns in the same month and the next, so a trip over a
      // month's end (New Year's) is not missed.
      for (const back of [out, monthsFrom(`${out}-01`, 2)[1]]) {
        if (ok + failed > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        try {
          fares.push(...pickFares(await query(route, out, back, token), route, seen));
          ok++;
        } catch (error) {
          failed++;
          console.warn(`${route.id} ${out}/${back}: ${error.message}`);
        }
      }
      if (i === months.length - 1) console.log(`${route.id}: ${fares.length} fares so far`);
    }
  }

  await write({ updated: new Date().toISOString(), source: 'Aviasales', fares });
  console.log(`Wrote ${fares.length} fares from ${ok} queries (${failed} failed) to ${values.out}.`);
  return ok === 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
