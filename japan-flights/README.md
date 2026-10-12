# Japan, Taiwan, Hong Kong and Macau Flights

A static page that recommends nonstop round trips from Incheon, Gimpo and Cheongju to Japan, Taiwan,
Hong Kong and Macau: Tokyo, Osaka, Fukuoka and the other main Japanese cities, regional airports
such as Oita, Hiroshima and Aomori, Taipei, Taichung, Kaohsiung, Hong Kong and Macau. It knows the
days Korean Air flies each route and lists the round trips that schedule allows; other airlines'
trips come from the fares known for them. It counts the days of leave each trip takes against a
Monday, Tuesday and Thursday work week and Korean public holidays, and puts the trips that take the
least leave first, then those with a known fare, cheapest first. GitHub Pages serves it; there is no
server.

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
month, trip length, leave, budget, Korean airport, cabins, destinations and airlines the visitor
picks, and the number of people and of checked bags between them, one each unless picked, the page:

1. lists every round trip of two to six nights, or of the lengths picked among them, with a Korean
   Air flight at both ends, within the schedule periods in `data/routes.json`, and every such trip a
   known fare of one of the airlines picked proves; a trip of one night is never offered;
2. counts the leave each takes: the workdays from departure to the day the flight back lands that
   are not public holidays, both ends included, except a landing day when the flight lands before
   noon. A flight back that leaves late at night lands the next day, so the day it leaves counts
   too. The workdays are Monday, Tuesday and Thursday, the week of the person the page was made
   for; `WORKDAYS` in `site/plan.js` sets them;
3. marks the trips whose flight out leaves Korea at 4 p.m. or later (저녁 출발) or whose flight
   back lands there before noon (오전 도착, or 다음 날 오전 도착 when it lands the day after it
   leaves), from the fare's own times, or for a Korean Air trip without them from the route's
   flight times;
4. for each cabin picked, economy, business or first, attaches the cheapest known fare for the route
   and dates among the airlines picked, as a trip of its own, and names its airline and cabin. A
   fare costs its price for each person, and the fee from `data/baggage.json` both ways for each bag
   it does not include, shown under the price: a fare with a checked bag includes one for each
   person, a fare without one none. Two people with one bag thus pay two fares, and the fee for one
   bag only on a fare without one. The fare is chosen, sorted and held to the budget by that total.
   A trip without a fare, from Korean Air's days, is offered in the cheaper cabin picked of economy
   and business, but never in first, which Korean Air hardly sells on these routes;
5. lists the trips that take the least leave first; among those, the trips with a known fare
   first, cheapest first, then the rest by departure date, soonest first; on the same day, the
   shorter trip first.

Every trip links to Naver, Google Flights, Skyscanner and KAYAK searches with the route and dates
filled in, for the live price; each asks for the trip's cabin and for as many adults as there are
people, and the KAYAK search for its airline too.

## Where the fares come from

Korean Air publishes no fare API, and the page does not scrape koreanair.com: airline sites
commonly forbid automated access in their terms, and a scraper breaks whenever the site changes.
Amadeus closed its free Self-Service APIs on 17 July 2026. That leaves two sources, both optional:

| File | Written by | What it holds |
|---|---|---|
| `site/data/fares.json` | you, by hand | fares you saw yourself, kept in the repository |
| `site/data/live-fares.json` | the workflow, at each deploy | nonstop fares of every airline that Aviasales users found in the last 48 hours, from the [Travelpayouts Data API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API): the cheapest economy fare for each route, pair of dates and airline, with and without a checked bag, with the time the flight out leaves and, when the API gives the return flight's duration, the time the flight back lands and, if it lands after midnight, the day |

`live-fares.json` is never committed; the workflow fetches it into the build. Without a token the
workflow writes an empty one and the page says live fares are not set up. Aviasales data comes from
its own users' searches, so regional routes may have few fares or none. A ticket counts only on the
route between the airports it names. The `static_fare_key` in its link says what its fare includes:
`L0` for no checked bag, `L1_1_15` for one bag of 15 kg, and so on. A fare gives the bags it
includes for each person in `bags`, `0` for none, when its link says, and the cheapest fare without
a bag is kept apart from the cheapest other, so that the page can weigh the first with its bag fee
against the second. The log counts each airline's fares that include no bag, those that include one
or more, and those whose link does not say. `prices_for_dates` documents no cabin, and asked for
business and first with `trip_class` (`1` and `2`), as the API's older methods take it, it answered
all 143 queries that had tickets on 12 October 2026 with the economy answer's tickets; so the
fetcher asks for economy only, and business and first fares come only from `fares.json`. The tests
use the response format the API documents; each run logs the fields a real ticket has, to check it
against.

A hand-written fare looks like this. `airline` is the airline's two-letter code (`KE`, `7C`, `LJ`
...), and a fare without one counts as Korean Air's; `cabin` is `business` or `first` for those
cabins, and a fare without one is economy; `bags` is the number of checked bags the fare includes
for each person, `0` for none, and a fare without it includes one; `price` is the round trip for one
adult, in won; `seen` is when you saw it, and the page shows how long ago that was.

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
   (**Settings → Secrets and variables → Actions**). The fetch makes about 610 queries, one for each
   route and pair of months, 0.15 seconds apart to stay well under the API's limit of 600 a minute,
   so it adds about two minutes to a deploy. A failed fetch does not stop the page from publishing.

## Update the data

Schedules change every season (late March and late October). Everything is in `site/data/`:

- `routes.json`: one entry per route, from Incheon (`ICN`), Gimpo (`GMP`) or Cheongju (`CJJ`); the
  city chips group routes by the airport they fly to. `country` is the destination's country (`JP`,
  `TW`, `HK` or `MO`), which bag fees go by. A destination outside UTC+9 gives `utcOffset` (Taiwan,
  Hong Kong and Macau: `8`), so the fetcher gives the flight back its local date. `periods` lists
  the stretches whose days are known, each with `from`, `to` and `days` (`"daily"`, or a list such
  as `["mon", "wed", "fri", "sun"]`); the same days serve both directions, since each route turns
  around abroad the same day. A route whose days are not known keeps `periods` empty and says why in
  `note`. `flights`, where known, gives the flight `out` and the flight `back`, each with `departs`
  and `arrives` in local 24-hour time (`"09:15"`) and the flight `number` where the source names it.
  They decide 저녁 출발 and 오전 도착. Add the source of every change to `sources`, and move `updated` on.
- `holidays.json`: public holidays by date, through 2027, from the 월력요항 that the Korea
  AeroSpace Administration publishes each June. A substitute holiday is named after the holiday it
  stands in for.
- `baggage.json`: what a checked bag bought in advance costs one way, in won, for a bag a fare does
  not include. `airlines` gives an airline's own `fee`, one for all its routes or one for each
  destination country (`{ "JP": 40000, "TW": 50000 }`), with the `kg` it buys, its `source`,
  `approx` when the fee is converted or otherwise rough, and a `note` on how it was worked out or
  when it applies; a country it gives none for, and an airline without one, take the `usual` fee to
  that country (`country` in `routes.json`), always shown as approximate. `included` names the
  airlines whose economy fares always include a checked bag on these routes, Korean Air, Asiana,
  JAL, ANA, Ethiopian, Jin Air, Parata Air and Air Premia, with `includedSources` for the last
  three, so that the few fares of theirs Aviasales marks without one get no fee. The page counts one
  bag for each person on their fares, and since the usual fee is a low-cost airline's, shows a bag
  beyond that as 요금 미확인 (fee not known) and adds nothing for it. Add an airline when the deploy log
  counts fares of its without a checked bag, the first of its three numbers there.
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
  season; for the others the page assumes the summer's daily service goes on, and their notes in
  `routes.json` say so. Their flight times are not listed, since only summer times could be found,
  so they get neither 저녁 출발 nor 오전 도착.
- Hakodate, Takamatsu, Matsuyama, Yonago, Shizuoka, Tokushima, Kitakyushu, Saga, Miyakojima and
  Ishigaki, which Korean Air does not fly, and Gimpo–Nagoya, which only Peach flies, were added on
  12 October 2026 for the fares of the airlines that do; Yonago's only source is a summary of
  routes.
- Kobe takes international flights only as charters until it opens to scheduled ones, but Korean Air
  flies there twice a day to a timetable and sells the seats like any other route's, so it is listed
  with Korean Air's days and marked 전세편.
- Taipei Taoyuan, Taichung and Hong Kong fly daily on Korean Air. Taoyuan's winter flights are on
  file; Taichung's daily service returns on 25 October 2026 with no end date given, so the page
  assumes it lasts the season; Hong Kong's winter season is assumed. Their notes in `routes.json`
  say so. Taipei Songshan, Kaohsiung (from Incheon and from Gimpo) and Macau come through fares
  only: Korean Air does not fly the first two, and its daily Macau service from July 2024 was not
  confirmed for 2026.
- On 12 October 2026 the routes were checked against press reports, airline filings and airport
  pages for every Japanese and Taiwanese airport with scheduled flights from Incheon, Gimpo or
  Cheongju. Routes flown only by charter, such as Toyama, Ube and Kushiro, and routes from other
  Korean airports are left out. Many of those sources could be read only as search-result excerpts,
  so the frequencies in the notes may be off.
- Cheongju's routes are Aero K's, and Eastar Jet's to Taipei, and come through fares only. Aero K
  had not published its winter days by 12 October 2026: Kumamoto is announced only to 24 October and
  Matsuyama only from 2 January, Fukuoka and Hiroshima have no 2026 schedule, and Kobe is a charter
  like Incheon's. Ibaraki and Obihiro, which Aero K suspended during the year, are left out.
- Gimpo–Haneda was added on 12 October 2026 as flying daily; for Gimpo–Kansai only Asiana's daily
  winter service was found, so Korean Air's days are not given and the route comes only through
  fares.
- The search links follow URL formats the sites do not document, and any of them can change. The
  KAYAK link asks for the trip's airline, nonstop; the others show every airline.
- Leave counts the departure day as a whole day even for a trip marked 저녁 출발, and knows only
  Korean public holidays and the days off of a Monday, Tuesday and Thursday week, not company
  holidays.
- A route lists one set of flight times, the latest its sources give, and 저녁 출발 and 오전 도착
  follow them even for a trip in another season. The routes with times all leave Incheon in the
  morning and land back in the afternoon, so only a fare's own times can mark a trip either way.
- Prices are a fare for each person picked, all as adults, in economy unless the trip is marked 비즈니스
  or 퍼스트, and may differ from what a booking finally costs. Business and first fares come only from
  `fares.json`, since the API gives economy alone. Bag fees are the cheapest price online in
  advance, from the airlines' own pages for Jeju Air, Trinity, Air Seoul, Eastar Jet, Aero K, HK
  Express and ZIPAIR (whose won price out of Incheon the page also takes for the way back, charged
  in yen, and marks 약), and from a travel blog for Tigerair Taiwan, converted from Taiwan dollars.
  Peach, Air Busan and Scoot published none that could be found, and Eastar Jet none to Taiwan or
  Hong Kong, so they take the usual fee, Jeju Air's and Trinity's, which the page marks 약. An
  airline may charge more for a bag bought late: Air Seoul 5,000 won more within 48 hours of
  departure, HK Express 72,000 won after booking. A second bag for one person is charged the same as
  the first, though an airline may charge more. A fare with a checked bag counts as including one
  for each person. Of the airlines that always include one, Korean Air, Asiana, Jin Air, Parata Air
  and Air Premia say so on their own pages; JAL and ANA have given two in economy, and ANA's Basic
  fares, sold on some routes since November 2024, can include none.
