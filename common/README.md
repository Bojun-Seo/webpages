# common

What more than one page, or a page and its API, use, kept in one place. `pages.yml` publishes
`site/` beside the pages, at <https://bojun-seo.github.io/webpages/common/>, so a page's script
takes a module as `../common/<name>.js` and its data as `../common/<name>.json`; Node, a page's
tests and an API take the same file from `common/site/`.

| File | What | Used by |
|---|---|---|
| [`site/dom.js`](site/dom.js) | `$`, an element by its ID, and `el`, which builds an element with its attributes, listeners and children | every page's `app.js` |
| [`site/calendar.js`](site/calendar.js) | Dates in Korea (`koreaDate`, `isDate`, `addDays`) and a month as a Korean wall calendar shows it: weeks from Sunday, Sundays and holidays in red, Saturdays in blue | fair-pick's page and API |
| [`site/holidays.json`](site/holidays.json) | Korea's public holidays by date, through 2027, from the 월력요항 the Korea AeroSpace Administration publishes each June | japan-flights' page and fare fetcher, fair-pick's calendar |
| [`site/social-choice.js`](site/social-choice.js) | How a group settles on one option from everyone's grades, and what the other well-known voting rules would pick | fair-pick's page and API |
| [`site/poll-rules.js`](site/poll-rules.js) | What a fair-pick poll and ballot may hold, the grades, and how a group ID and PIN look | fair-pick's page and API |
| [`tools/serve.js`](tools/serve.js) | Serves the repository as Pages serves the built site, for every page's `npm run serve` | every page |

The modules work in a browser and in Node alike: no DOM but in `dom.js`, nothing to install, and
they import nothing but each other, by `./<name>.js`, so the same path works published and in the
repository. A page's own modules that its tests import do not import from here, since a browser
finds common/ at `../common/` and Node at `../../common/site/`; the page's `app.js` hands them what
they need.

## Update the holidays

Add each year's holidays to `site/holidays.json` when the 월력요항 for it comes out, in June: a page
takes a day the file does not list for a working day. A substitute holiday is named after the
holiday it stands in for. japan-flights' fare fetcher warns on the run's summary page once it
fetches trips past the last holiday listed, from July 2027 for 2028, and fair-pick's calendar
names no holiday past it.

## Test

Tests need Node 20 or later and nothing else:

```
cd common
npm test
```

They check the calendar, that the 2027 holidays leave the 119 days off the official calendar gives,
the voting rule and the poll rules. `pages.yml` runs them with every page's on a push that touches
any page or common/, and `fair-pick-api.yml` before it deploys the API that uses them.
