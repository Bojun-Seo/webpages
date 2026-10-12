# webpages

A collection of web pages built for personal use, published with GitHub Pages at
<https://bojun-seo.github.io/webpages/>.

| Directory | Page | Description |
|---|---|---|
| [`japan-flights/`](japan-flights/) | [Short-Haul Flights](https://bojun-seo.github.io/webpages/japan-flights/) | Recommends round trips, nonstop or with one connection, from Seoul and Cheongju to Japan, Taiwan, Hong Kong, Macau, Vietnam, Bangkok, Guam and Saipan |

## Publishing

A repository has one Pages site, and every deployment replaces all of it, so one workflow,
[`pages.yml`](.github/workflows/pages.yml), builds the whole site: each page's `site/` directory
under the page's name, and [`index.html`](index.html), which links to the pages, at the root. It
tests a page on every push that touches it, publishes from the default branch, and publishes again
every day at 06:23 KST so that data fetched into the build stays fresh.

Pages has to be set to deploy from GitHub Actions: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. Until it is, the deploy job fails. **Actions → pages → Run workflow**
publishes on demand.

GitHub turns off the scheduled workflows of a public repository that has seen no activity for 60
days. If that happens, **Actions → pages → Enable workflow** turns the daily run back on.

To add a page, give it a directory with its files under `site/`, add a job that tests it and a
step that copies it to `pages.yml`, and link it from `index.html` and the table above.
