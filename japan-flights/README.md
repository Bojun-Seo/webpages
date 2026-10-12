# Japan Flights

A static page that recommends nonstop round trips from Seoul Incheon to Japan: Tokyo, Osaka,
Fukuoka and the other main cities, and regional airports such as Oita, Hiroshima and Aomori. It
knows the days Korean Air flies each route and lists the round trips that schedule allows; other
airlines' trips come from the fares known for them. It counts the days of leave each trip takes
against Korean public holidays, and puts trips with a known fare first, cheapest first. GitHub
Pages serves it; there is no server.

The page is in Korean. It is not affiliated with any airline.

## Contents

- [What it does](#what-it-does)
- [Where the fares come from](#where-the-fares-come-from)
- [Publish on GitHub Pages](#publish-on-github-pages)
- [Update the data](#update-the-data)
- [Run and test locally](#run-and-test-locally)
- [Known limitations](#known-limitations)

## What it does

The main routes fly every day, but regional ones fly a few days a week (Oita: Monday, Wednesday,
Friday and Sunday), so on those most pairs of dates are not a round trip at all. For the departure
month, trip length, leave, budget, cities and airlines the visitor picks, the page:

1. lists every round trip with a Korean Air flight at both ends, within the schedule periods in
   `data/routes.json`, and every trip a known fare of one of the airlines picked proves;
2. counts the leave each takes: the weekdays from departure to return, both ends included as
   whole days, that are not public holidays;
3. marks the trips that span a Friday (금요일 포함), and those whose flight out leaves Korea at
   4 p.m. or later (저녁 출발) or whose flight back lands there before noon (오전 도착), from the
   fare's own times, or for a Korean Air trip without them from the route's flight times;
4. attaches the cheapest known fare for the route and dates among the airlines picked, and names
   its airline;
5. lists the trips with a known fare first, cheapest first, then the rest by departure date,
   soonest first; on the same day, the shorter trip first.

Every trip links to Naver, Google Flights, Skyscanner and KAYAK searches with the route and dates
filled in, for the live price; the KAYAK search asks for the trip's airline. Below the list, a card
per route shows Korean Air's days of operation in airline timetable notation (`1.3.5.7` is Monday,
Wednesday, Friday and Sunday), flight times, aircraft, the airlines with known fares and the
announcement the schedule came from.

## Where the fares come from

Korean Air publishes no fare API, and the page does not scrape koreanair.com: airline sites
commonly forbid automated access in their terms, and a scraper breaks whenever the site changes.
Amadeus closed its free Self-Service APIs on 17 July 2026. That leaves two sources, both optional:

| File | Written by | What it holds |
|---|---|---|
| `site/data/fares.json` | you, by hand | fares you saw yourself, kept in the repository |
| `site/data/live-fares.json` | the workflow, at each deploy | nonstop fares of every airline that Aviasales users found in the last 48 hours, from the [Travelpayouts Data API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API): the cheapest for each route, pair of dates and airline, with the time the flight out leaves and, when the API gives the return flight's duration, the time the flight back lands |

`live-fares.json` is never committed; the workflow fetches it into the build. Without a token the
workflow writes an empty one and the page says live fares are not set up. Aviasales data comes from
its own users' searches, so regional routes may have few fares or none. The tests use the response
format the API documents; each run logs the fields a real ticket has, to check it against.

A hand-written fare looks like this. `airline` is the airline's two-letter code (`KE`, `7C`, `LJ`
...), and a fare without one counts as Korean Air's; `price` is the round trip for one adult, in
won; `seen` is when you saw it, and the page shows how long ago that was.

```json
{
  "fares": [
    { "route": "ICN-OIT", "airline": "KE", "depart": "2026-12-25", "return": "2026-12-27",
      "price": 289000, "seen": "2026-10-11", "source": "대한항공" }
  ]
}
```

Fares for trips that have left are ignored, so old entries do no harm. A fare also shows a trip on
a route whose days are not known yet.

## Publish on GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Merge into the default branch. [`pages.yml`](../.github/workflows/pages.yml) runs the tests on
   every push that touches `japan-flights/`, and on the default branch publishes `site/` to
   <https://bojun-seo.github.io/webpages/japan-flights/>. It publishes again every day at
   06:23 KST so the live fares stay fresh, and **Actions → pages → Run workflow** publishes on
   demand. The [top-level README](../README.md#publishing) says how the site is put together.
3. For live fares, sign up at [Travelpayouts](https://www.travelpayouts.com/), copy the API token
   from its developer settings, and add it as the repository secret `TRAVELPAYOUTS_TOKEN`
   (**Settings → Secrets and variables → Actions**). The fetch makes about 220 queries, a little
   over a second apart, so it adds about four minutes to a deploy. A failed fetch does not stop
   the page from publishing.

## Update the data

Schedules change every season (late March and late October). Everything is in `site/data/`:

- `routes.json`: one entry per route. `periods` lists the stretches whose days are known, each
  with `from`, `to` and `days` (`"daily"`, or a list such as `["mon", "wed", "fri", "sun"]`); the
  same days serve both directions, since each route turns around in Japan the same day. A route
  whose days are not known keeps `periods` empty and says why in `note`. `flights`, where known,
  gives the flight `out` and the flight `back`, each with `departs` and `arrives` in local 24-hour
  time (`"09:15"`) and the flight `number` where the source names it. The route card shows them,
  and they decide 저녁 출발 and 오전 도착. Add the source of every change to `sources`, and move
  `updated` on.
- `holidays.json`: public holidays by date, through 2027, from the 월력요항 that the Korea
  AeroSpace Administration publishes each June. A substitute holiday is named after the holiday it
  stands in for.
- `fares.json`: see above.

The tests check that every route has the fields the page reads and that the 2027 holidays add up
to the 119 days off the official calendar gives, so run them after editing.

## Run and test locally

The page loads its data with `fetch`, which browsers refuse for `file://` pages, so serve the
directory:

```
cd japan-flights
npm run serve        # http://localhost:8000
```

Tests need Node 20 or later and nothing else:

```
npm test
```

To fetch live fares by hand, `TRAVELPAYOUTS_TOKEN=... npm run fares` writes
`site/data/live-fares.json`, which git ignores.

## Known limitations

- Schedules were collected on 11 October 2026 from press reports and the announcements of
  Japanese prefectures and airports, for the 2026/27 winter season (to 27 March 2027). Komatsu,
  Kumamoto, Kagoshima and Okayama had not announced their winter days by then, and Sendai and
  Miyazaki join Korean Air only when Asiana merges into it on 17 December 2026; those routes
  appear in recommendations only through a fare.
- The main routes (Tokyo Narita and Haneda, Osaka, Nagoya, Fukuoka, Sapporo and Okinawa) were added
  on 12 October 2026 as flying daily. Only Narita, Osaka and Okinawa have a source for the winter
  season; for the others the page assumes the summer's daily service goes on, and their cards say
  so. Their flight times are not listed, since only summer times could be found, so they get
  neither 저녁 출발 nor 오전 도착.
- The search links follow URL formats the sites do not document, and any of them can change. The
  KAYAK link asks for Korean Air nonstop flights; the others show every airline.
- Leave counts the departure and return days as whole days even for a trip marked 저녁 출발 or
  오전 도착, and counts only Korean public holidays, not company holidays.
- A route lists one set of flight times, the latest its sources give, and 저녁 출발 and 오전 도착
  follow them even for a trip in another season. The routes with times all leave Incheon in the
  morning and land back in the afternoon, so no trip is marked either way yet.
- Prices are for one adult in economy and may differ from what a booking finally costs.
