# Japan Flights

A static page that recommends Korean Air round trips from Seoul Incheon to Japan's regional
airports (Oita, Nagasaki, Hiroshima, Niigata, Aomori and others). It knows the days each route
flies, lists the round trips the schedule allows, soonest first, counts the days of leave each trip
takes against Korean public holidays, and shows the fares it knows. GitHub Pages serves it; there
is no server.

The page is in Korean. It is not affiliated with Korean Air.

## Contents

- [What it does](#what-it-does)
- [Where the fares come from](#where-the-fares-come-from)
- [Publish on GitHub Pages](#publish-on-github-pages)
- [Update the data](#update-the-data)
- [Run and test locally](#run-and-test-locally)
- [Known limitations](#known-limitations)

## What it does

Regional routes fly a few days a week (Oita: Monday, Wednesday, Friday and Sunday), so most pairs
of dates are not a round trip at all. For the departure month, trip length, leave and budget the
visitor picks, the page:

1. lists every round trip with a flight at both ends, within the schedule periods in
   `data/routes.json`;
2. counts the leave each takes: the weekdays from departure to return, both ends included, that
   are not public holidays (the flights leave Incheon in the morning and land back in the
   afternoon);
3. attaches the cheapest known fare for the route and dates;
4. lists them by departure date, soonest first; on the same day, the shorter trip first.

Every trip links to Naver, Google Flights, Skyscanner and KAYAK searches with the route and dates
filled in, for the live price. Below the list, a card per route shows its days of operation in
airline timetable notation (`1.3.5.7` is Monday, Wednesday, Friday and Sunday), flight times,
aircraft and the announcement the schedule came from.

## Where the fares come from

Korean Air publishes no fare API, and the page does not scrape koreanair.com: airline sites
commonly forbid automated access in their terms, and a scraper breaks whenever the site changes.
Amadeus closed its free Self-Service APIs on 17 July 2026. That leaves two sources, both optional:

| File | Written by | What it holds |
|---|---|---|
| `site/data/fares.json` | you, by hand | fares you saw yourself, kept in the repository |
| `site/data/live-fares.json` | the workflow, at each deploy | Korean Air nonstop fares that Aviasales users found in the last 48 hours, from the [Travelpayouts Data API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API) |

`live-fares.json` is never committed; the workflow fetches it into the build. Without a token the
workflow writes an empty one and the page says live fares are not set up. Aviasales data comes from
its own users' searches, so regional routes may have few fares or none. The fetcher is tested
against the documented response format only: the API could not be reached from where this was
written.

A hand-written fare looks like this. `price` is the round trip for one adult, in won; `seen` is
when you saw it, and the page shows how long ago that was.

```json
{
  "fares": [
    { "route": "ICN-OIT", "depart": "2026-12-25", "return": "2026-12-27", "price": 289000,
      "seen": "2026-10-11", "source": "대한항공" }
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
   (**Settings → Secrets and variables → Actions**). The fetch makes about 130 queries, a little
   over a second apart, so it adds two to three minutes to a deploy. A failed fetch does not stop
   the page from publishing.

## Update the data

Schedules change every season (late March and late October). Everything is in `site/data/`:

- `routes.json`: one entry per route. `periods` lists the stretches whose days are known, each
  with `from`, `to` and `days` (`"daily"`, or a list such as `["mon", "wed", "fri", "sun"]`); the
  same days serve both directions, since each route turns around in Japan the same day. A route
  whose days are not known keeps `periods` empty and says why in `note`. `flights`, where known,
  gives the flight `out` and the flight `back`, each with `departs` and `arrives` in local 24-hour
  time (`"09:15"`) and the flight `number` where the source names it; the route card shows them.
  Add the source of every change to `sources`, and move `updated` on.
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
- The search links follow URL formats the sites do not document, and any of them can change. The
  KAYAK link asks for Korean Air nonstop flights; the others show every airline.
- Leave assumes a morning departure and an afternoon return, and counts only Korean public
  holidays, not company holidays.
- Prices are for one adult in economy and may differ from what a booking finally costs.
