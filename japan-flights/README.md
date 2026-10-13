# Short-Haul Flights

A static page that recommends round trips, nonstop or with one connection each way, from Incheon,
Gimpo and Cheongju to Japan, Taiwan, Hong Kong, Macau, Vietnam, Thailand, Guam and Saipan, from the
fares Aviasales users found in the last 48 hours. It counts the days of leave each trip takes
against a Monday, Tuesday and Thursday work week and Korean public holidays, offers only the trips
that take none, without showing the count, and lists them cheapest first, with the airlines of
SkyTeam, Star Alliance and oneworld given a head start. GitHub Pages serves it; there is no server.

The page is in Korean. It is not affiliated with any airline.

## Contents

- [What it does](#what-it-does)
- [Where the fares come from](#where-the-fares-come-from)
- [Publish on GitHub Pages](#publish-on-github-pages)
- [Update the data](#update-the-data)
- [Run and test locally](#run-and-test-locally)
- [Known limitations](#known-limitations)

## What it does

For the departure month, trip length, budget, Korean airport, destinations, alliances and airlines
the visitor picks, and the number of people and of checked bags between them, one each unless
picked, the page:

1. lists the round trips of two to six nights, or of the lengths picked among them, that a fare of
   one of the airlines picked gives, nonstop or with one connection on the way out, back or both;
   it never offers a trip of one night, nor one whose flight out lands abroad at 6 p.m. local time
   or later, or on a later day, which loses the first day;
2. counts the leave each takes, and offers only the trips that take none; it keeps the count to tell
   which those are, but does not show it: the workdays from departure to the day the flight back
   lands that are not public holidays, both ends included, except a landing day when the flight
   lands before noon. A flight back that leaves late at night lands the next day, so the day it
   leaves counts too. The workdays are Monday, Tuesday and Thursday, the week of the person the page
   was made for; `WORKDAYS` in `site/plan.js` sets them;
3. marks the trips whose flight back lands in Korea before noon (오전 도착, or 다음 날 오전 도착 when it lands
   the day after it leaves), where the fare gives the time, which the mark shows on hover, and the
   trips that connect (갈 때 경유, 올 때 경유 or 왕복 경유), with the airports they connect at on hover;
4. offers for each pair of dates on a route its best fare among the airlines picked, one nonstop
   both ways and one that connects, each as a trip of its own, and names its airline and the
   airline's alliance, SkyTeam, Star Alliance or oneworld (`ALLIANCES` in `site/plan.js`, as of
   October 2026), with Asiana in SkyTeam, since it leaves Star Alliance and merges into Korean Air
   in December 2026. Every fare is economy. A fare costs its price for each person, and the fee from
   `data/baggage.json` both ways for each bag it does not include, shown under the price: a fare
   with a checked bag includes one for each person, a fare without one none. Two people with one bag
   thus pay two fares, and the fee for one bag only on a fare without one. The budget holds that
   total. A fare ranks at its total less a head start of 50,000 won for each person on an airline of
   any of the three alliances (`ADVANTAGE` in `site/plan.js`); the price shown is the total. The
   best fare is the one that ranks lowest of those whose trip takes no leave;
5. lists the trips lowest rank first, then by departure date, soonest first; on the same day, the
   shorter trip first, and a nonstop one before one that connects.

Every trip links to Google Flights, Skyscanner and KAYAK searches with the route and dates filled
in, for the live price; each asks for economy and for as many adults as there are people, and the
KAYAK search for the trip's airline too, nonstop unless the trip connects.

## Where the fares come from

Korean Air publishes no fare API, and the page does not scrape koreanair.com: airline sites
commonly forbid automated access in their terms, and a scraper breaks whenever the site changes.
Amadeus closed its free Self-Service APIs on 17 July 2026. The fares come instead from the
[Travelpayouts Data
API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API): at each
deploy the workflow writes `site/data/live-fares.json` with the fares of every airline, nonstop or
with one connection each way, that Aviasales users found in the last 48 hours, for trips of two to
six nights whose flight out lands before 6 p.m. local time: the cheapest economy fare for each
route, pair of dates and airline, with and without a checked bag, nonstop and connecting, and for
each day and time of day the flight back lands, with the times the flights leave and land where the
API gives them.

`live-fares.json` is never committed; the workflow fetches it into the build. Without a token the
workflow writes an empty one and the page says live fares are not set up. Aviasales data comes from
its own users' searches, so regional routes may have few fares or none. The fetcher asks about every
route the page knows (`routesOf` in `site/plan.js`) with `direct=false`, keeps the tickets with no
more than one connection each way, and logs any query whose answer reaches the limit of 1,000
tickets, since then the dearest tickets are missing. A ticket counts only on the route between the
airports it names. The `static_fare_key` in its link says what its fare includes: `L0` for no
checked bag, `L1_1_15` for one bag of 15 kg, and so on. A fare gives the bags it includes for each
person in `bags`, `0` for none, when its link says, and its connections out and back in `stops` when
it makes any. The link's `t` lists the ticket's way out and way back, each with the Unix times it
leaves and lands, its minutes on the way and every airport it passes, `ICNKIXNRT` for Incheon to
Narita through Kansai, after its airline's code where that changes, so a connecting fare names the
airports it connects at in `via`: `[["KIX"], []]` for one connection on the way out at Kansai. The
log counts the connecting fares that say where, and shows the link of one ticket that does not. The
cheapest fare without a bag is kept apart from the cheapest other, so that the page can weigh the
first with its bag fee against the second, and a connecting fare from a nonstop one, and so is a
fare whose flight back lands on another day or at another time of day, since the leave a trip takes
depends on it. The log counts each airline's fares that include no bag, those that include one or
more, and those whose link does not say, and the fares left out because the flight out lands late.
The tests use the response format the API documents; each run logs the fields a real ticket has, to
check it against.

## Publish on GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Merge into the default branch. [`pages.yml`](../.github/workflows/pages.yml) runs the tests on
   every push that touches `japan-flights/`, and on the default branch publishes `site/` to
   <https://bojun-seo.github.io/webpages/japan-flights/>. It publishes again every day at
   06:23 KST so the live fares stay fresh, and **Actions → pages → Run workflow** publishes on
   demand. The [top-level README](../README.md#publishing) says how the site is put together.
3. For live fares, sign up at [Travelpayouts](https://www.travelpayouts.com/), copy the API token
   from its developer settings, and add it as the repository secret `TRAVELPAYOUTS_TOKEN`
   (**Settings → Secrets and variables → Actions**). The fetch makes about 2,200 queries, one for
   each route and pair of months, 0.15 seconds apart to stay well under the API's limit of 600 a
   minute, so it adds about eleven minutes to a deploy. Should the API answer HTTP 429, too many
   queries, all the same, the fetcher waits as long as its Retry-After header says, a minute if it
   says nothing, and asks again, up to twice; three queries refused in a row stop the fetch. Before
   it fetches, the workflow downloads the fares the site has now, and the fetcher keeps those of
   every query the API does not answer; should the API answer none, the page keeps the fares it had,
   with the time they were fetched. A failed fetch does not stop the page from publishing.

## Update the data

Everything the page knows is in `site/data/`:

- `routes.json`: `origins` names the Korean airports, Incheon (`ICN`), Gimpo (`GMP`) and Cheongju
  (`CJJ`), and `destinations` the airports abroad, each with its `dest` code, the `city` its chip
  shows, its `country` (`JP`, `TW`, `HK`, `MO`, `VN` for Vietnam, `TH` for Thailand, `GU` for Guam
  or `MP` for Saipan), which bag fees go by, and, outside UTC+9, its `utcOffset` (Taiwan, Hong Kong
  and Macau `8`, Vietnam and Thailand `7`, Guam and Saipan `10`), so that the fetcher gives the
  flight back its local date and the flight out its local landing time. The page and the fetcher
  take a route from every origin to every destination (`routesOf` in `site/plan.js`). Move `updated`
  on with each change.
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
  JAL, ANA, Ethiopian, Jin Air, Parata Air, Air Premia, Vietnam Airlines, Thai Airways, Cathay
  Pacific, Singapore Airlines, EVA Air, China Airlines, Air China and Thai Lion Air, and
  `includedTo` an airline that includes one only to some countries, as Trinity does to Guam and
  Saipan, so that the few fares of theirs Aviasales marks without one get no fee; `includedSources`
  gives the sources found for them. The page counts one bag for each person on their fares, and
  since the usual fee is a low-cost airline's, shows a bag beyond that as 요금 미확인 (fee not known) and
  adds nothing for it. Add an airline when the deploy log counts fares of its without a checked bag,
  the first of its three numbers there.

The tests check that every destination has the fields the page reads and that the 2027 holidays add
up to the 119 days off the official calendar gives, so run them after editing.

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

- The destinations are the airports in Japan and Taiwan with scheduled flights from Incheon, Gimpo
  or Cheongju, checked on 12 October 2026 against press reports, airline filings and airport pages,
  with Hong Kong, Macau, every Vietnamese airport, Bangkok's two, Guam and Saipan. Airports served
  only by charters, such as Toyama, Ube and Kushiro, and other Korean airports are left out. Kobe
  takes international flights only as charters until it opens to scheduled ones, but Korean Air
  flies there twice a day to a timetable and sells the seats like any other route's, so it is
  listed.
- The search links follow URL formats the sites do not document, and any of them can change. The
  KAYAK link asks for the trip's airline, nonstop for a nonstop trip; the others show every airline.
- Leave counts the departure day as a whole day, and knows only Korean public holidays and the days
  off of a Monday, Tuesday and Thursday week, not company holidays.
- A fare that does not give the times of its flights is let through the rule against a late flight
  out, and is not marked 오전 도착.
- Only the trips Aviasales users searched for in the last 48 hours have fares, so a route few of
  them search, regional Japan and most of Vietnam among them, may show few trips or none. Ca Mau was
  closed until at least 31 October 2026 and is listed so that its fares show once it flies again.
  Long Thanh, Ho Chi Minh City's new airport, opens on 1 December 2026, but the API answered every
  query for it with HTTP 400 on 13 October 2026, so it is left out until the API knows it. Most
  flights from Korea to Vietnam, Guam and Saipan leave in the evening and land at night, so the rule
  against a late flight out leaves few of their trips: on 13 October 2026 it left out 122 of the 257
  tickets from Incheon to Da Nang and every one to Guam and Saipan of two to six nights. The page
  says where a trip connects, but not for how long; the search links show that. A ticket's link
  lists its flights in a format Aviasales does not document, so where a trip connects can go
  missing should the format change.
- Prices are economy fares, one for each person picked, all as adults, and may differ from what a
  booking finally costs. Bag fees are the cheapest price online in advance, from the airlines' own
  pages for Jeju Air, Trinity, Air Seoul, Eastar Jet, Aero K, HK Express and ZIPAIR (whose won price
  out of Incheon the page also takes for the way back, charged in yen, and marks 약), and from a
  travel blog for Tigerair Taiwan, converted from Taiwan dollars, and for Jeju Air to Vietnam and
  Thailand. Peach, Air Busan, Scoot, Vietjet, Thai Vietjet, Thai AirAsia X, United, China Eastern,
  China Southern, Philippine Airlines and Malaysia Airlines published none that could be found, nor
  Eastar Jet to Taiwan or Hong Kong and Air Seoul to Guam, so they take the usual fee, Jeju Air's
  and Trinity's, which the page marks 약. An airline may charge more for a bag bought late: Air Seoul
  5,000 won more within 48 hours of departure, HK Express 72,000 won after booking. A second bag for
  one person is charged the same as the first, though an airline may charge more. A connecting fare
  pays the bag fee of the airline Aviasales names for it, once each way, though separate tickets on
  two airlines may each charge for the bag. A fare with a checked bag counts as including one for
  each person. Of the airlines that always include one, Korean Air, Asiana, Jin Air, Parata Air and
  Air Premia say so on their own pages, and the airlines added for Vietnam, Bangkok, Guam and Saipan
  were checked only through search results; JAL and ANA have given two in economy, and ANA's Basic
  fares, sold on some routes since November 2024, can include none.
