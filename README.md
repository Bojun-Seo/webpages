# webpages

A collection of web pages built for personal use, published with GitHub Pages at
<https://bojun-seo.github.io/webpages/>.

| Directory | Page | Description |
|---|---|---|
| [`japan-flights/`](japan-flights/) | [Short-Haul Flights](https://bojun-seo.github.io/webpages/japan-flights/) | Recommends round trips that take no leave, nonstop or with one connection, from Seoul and Cheongju to Japan, Taiwan, Hong Kong, Macau, Vietnam, Thailand, Guam and Saipan |
| [`skypass-cards/`](skypass-cards/) | [SKYPASS Card Calculator](https://bojun-seo.github.io/webpages/skypass-cards/) | Works out the Korean Air miles each SKYPASS credit card earns in a year for what the visitor spends, and what is left after the annual fee |
| [`sparemine/`](sparemine/) | [sparemine launcher](https://bojun-seo.github.io/webpages/sparemine/) | Turns a BTC receive address and a few options into the one-line command, `config.toml` and run script that start the [sparemine](https://github.com/bojun-seo/applications/tree/master/sparemine) miner on your own machine; the page itself never mines |
| [`fair-pick/`](fair-pick/) | [Group Vote](https://bojun-seo.github.io/webpages/fair-pick/) | Lets a group that must settle on one date or place get in with a group ID and PIN and vote under their own names, each date ○ △ ✕ and each place in order, and picks the option by a rule from social choice theory, showing how everyone voted once the poll closes; dates are picked on a Korean calendar with the public holidays. With no server, each poll travels in its links, sealed with the group ID and PIN |

What more than one page uses, or a page and its API, is in [`common/`](common/): the DOM helpers
every page's script takes, Korea's public holidays and calendar, fair-pick's voting rule and what its
polls may hold, and the server each page's `npm run serve` runs. It is published beside the pages,
so a page takes a shared module as `../common/<name>.js`.

## Publishing

A repository has one Pages site, and every deployment replaces all of it, so one workflow,
[`pages.yml`](.github/workflows/pages.yml), builds the whole site: each page's `site/` directory
under the page's name, `common/site/` as `common/`, and [`index.html`](index.html), which links to
the pages, at the root. A push to any branch that touches a page or common/ runs every page's tests
and common's, builds the site and opens each page in a browser at a phone's width
([`smoke/smoke.js`](smoke/smoke.js)), which fails the run when a page throws, logs an error, asks
for a file the site lacks, is wider than the screen or stops doing what it has been fixed to do. The
default branch then publishes the site. A tag builds nothing.

The fares japan-flights shows are fetched into the build by the run every day at 01:30 KST, and by
**Actions → pages → Run workflow**; a push keeps the fares the site has. GitHub starts a scheduled
run late when it is busy, often by hours.

Pages has to be set to deploy from GitHub Actions: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. Until it is, the deploy job fails.

fair-pick needs no server: it keeps its polls in links. It can keep them in an API of its own
instead, a Cloudflare Worker that [`fair-pick-api.yml`](.github/workflows/fair-pick-api.yml)
deploys when a push to the default branch changes it. That needs the secrets `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`, and the page finds the Worker at the repository variable
`FAIR_PICK_API`, which the build writes into it; [its README](fair-pick/README.md#set-up-the-api)
says how to set them up. The same Worker can keep, while the polls stay in links, what closed date
polls give to research with the consent of their maker and every voter, without names: the page
sends it to the repository variable `FAIR_PICK_RESEARCH_API`, else `FAIR_PICK_API`, and the secret
`FAIR_PICK_RESEARCH_TOKEN` reads it ([research donations](fair-pick/README.md#research-donations)).

GitHub turns off the scheduled workflows of a public repository that has seen no activity for 60
days. If that happens, **Actions → pages → Enable workflow** turns the daily run back on.

To run the browser check by hand, build the site as `pages.yml` does into `_site/`, which git
ignores, then:

```
cd smoke
npm ci && npx playwright install chromium
npm run smoke
```

To add a page, give it a directory with its files under `site/`, add a job that tests it and a
step that copies it to `pages.yml`, add what the page must keep doing to `smoke/smoke.js`, and link
it from `index.html` and the table above. Take what it shares with other pages from `../common/`,
point its `npm run serve` at `../common/tools/serve.js`, and move into `common/site/` whatever a
second page or an API comes to need. A page that calls an API of its own gets it answered in
`smoke/smoke.js` as fair-pick's is, by the API's own code on memory, since the browser is kept off
every other site.
