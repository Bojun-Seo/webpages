// Opens every page of the built site in a browser at a phone's width, as a
// visitor would, and fails when a page throws, logs an error, asks for a
// file the site does not have, is wider than the screen, or stops doing what
// it has been fixed to do. pages.yml runs it on the site it is about to
// publish, so it sees the files as Pages will serve them, the commit on
// their script and style URLs included.
//
//   node smoke/smoke.js _site
//
// It serves the directory itself and keeps the browser off every other
// site, so a font that does not load is no failure, and it uses whatever
// fares the build fetched: a japan-flights with no fares passes, since the
// page publishes without them. fair-pick is opened both as it publishes
// without an API, keeping its polls in links, and with one, its Worker run
// on memory here answering in place of the one config.js would name; both
// times its maker spins the roulette for a tie.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import fairPickWorker from '../fair-pick/api/src/worker.js';
import { memoryEnv } from '../fair-pick/api/memory.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// A file the site may lack: the fares, which the build does not stop for.
const OPTIONAL = ['/japan-flights/data/live-fares.json'];

// Where fair-pick is told its API is while it is checked with one.
const FAIR_PICK_API = 'https://fair-pick-api.test';

// Serves `root` on a free port of this machine, a directory by its
// index.html, and nothing outside it.
function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
    try {
      if (file !== root && !file.startsWith(root + sep)) throw new Error('outside the site');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

// The first Monday, Tuesday or Thursday after today in Korea that is no
// public holiday: a day japan-flights takes as a day off.
function workdayAhead(holidays) {
  const korea = Date.now() + 9 * 3600e3;
  for (let i = 1; ; i++) {
    const day = new Date(korea + i * 86400e3);
    const date = day.toISOString().slice(0, 10);
    if ([1, 2, 4].includes(day.getUTCDay()) && !holidays[date]) return date;
  }
}

// Votes on fair-pick's choice ballot shown on `page` as `name`, tapping the
// options at `order`, best first; the one left goes last by itself.
async function rankVote(page, name, order) {
  await page.fill('#voter-name', name);
  for (const index of order) await page.locator('#ballot > li').nth(index).locator('button').click();
  await page.click('#vote-submit');
  await page.waitForFunction(() => /투표했어요/.test(document.getElementById('vote-message').textContent));
}

// Spins the roulette fair-pick shows its maker for options level at the
// top, stops it, and waits until it lands on the decision.
async function spinRoulette(page) {
  await page.click('#wheel-button');
  await page.waitForFunction(() => document.getElementById('wheel-button')?.textContent === '멈춤');
  await page.click('#wheel-button');
  await page.waitForSelector('#decided', { timeout: 20000 });
}

// What a page needs before it opens, by path.
const setups = {
  // fair-pick with an API, which config.js names when the build has the
  // repository variable for it: the check names one of its own and answers
  // it with the Worker on memory.
  async '/fair-pick/?server'(context) {
    const env = memoryEnv();
    await context.route((url) => url.pathname.endsWith('/fair-pick/config.js'), (route) => route.fulfill({
      contentType: 'text/javascript; charset=utf-8',
      body: `export const API_BASE = '${FAIR_PICK_API}';\n`,
    }));
    await context.route(`${FAIR_PICK_API}/**`, async (route) => {
      const request = route.request();
      const answer = await fairPickWorker.fetch(new Request(request.url(), {
        method: request.method(), headers: request.headers(), body: request.postData() ?? undefined,
      }), env);
      await route.fulfill({
        status: answer.status,
        headers: Object.fromEntries(answer.headers),
        body: Buffer.from(await answer.arrayBuffer()),
      });
    });
  },
};

const checks = {
  async '/'(page, { base }) {
    const links = await page.$$eval('main a', (as) => as.map((a) => a.getAttribute('href')));
    if (links.length < 4) return [`the index links to ${links.length} pages`];
    const problems = [];
    for (const href of links) {
      const res = await page.request.get(new URL(href, base).href);
      if (!res.ok()) problems.push(`the index's link ${href} answers ${res.status()}`);
    }
    return problems;
  },

  async '/japan-flights/'(page, { site }) {
    const problems = [];
    await page.waitForFunction(() => document.getElementById('status').textContent !== '불러오는 중…');
    if (await page.locator('#nights .chip').count() !== 6) {
      return [`japan-flights: status "${await page.textContent('#status')}"`];
    }
    if (await page.locator('#trips li').count() === 0) problems.push('japan-flights lists neither trips nor why none');

    // A chip pressed from the keyboard keeps the focus.
    const chip = page.locator('#nights .chip').nth(2);
    await chip.focus();
    await page.keyboard.press('Space');
    if (!(await chip.evaluate((c) => document.activeElement === c && c.getAttribute('aria-pressed') === 'true'))) {
      problems.push('japan-flights: a trip-length chip pressed from the keyboard loses the focus or stays unpressed');
    }
    await page.keyboard.press('Space');

    // A mark that says more says it when pressed, for a touch screen.
    const mark = page.locator('.badge-more').first();
    if (await mark.count()) {
      const label = await mark.textContent();
      await mark.click();
      if (await mark.getAttribute('aria-expanded') !== 'true' || await mark.textContent() === label) {
        problems.push('japan-flights: a mark that says more does not say it when pressed');
      }
    }

    // A day off taken out from the keyboard hands the focus on.
    const holidays = JSON.parse(await readFile(join(site, 'common/holidays.json'), 'utf8')).dates;
    await page.fill('#day-off', workdayAhead(holidays));
    await page.click('#add-day-off');
    const dayOff = page.locator('#days-off .chip-day-off');
    if (await dayOff.count() !== 1) {
      problems.push(`japan-flights: adding a day off says "${await page.textContent('#day-off-note')}"`);
    } else {
      await dayOff.focus();
      await page.keyboard.press('Enter');
      const focus = await page.evaluate(() => document.activeElement.id);
      if (await dayOff.count() !== 0 || focus !== 'add-day-off') {
        problems.push(`japan-flights: taking out a day off leaves the focus on "${focus || 'nothing'}"`);
      }
    }
    return problems;
  },

  async '/skypass-cards/'(page, { site }) {
    const problems = [];
    const { cards } = JSON.parse(await readFile(join(site, 'skypass-cards/data/cards.json'), 'utf8'));
    await page.waitForSelector('#results li.result');
    const shown = await page.locator('#results li.result').count();
    if (shown !== cards.length) problems.push(`skypass-cards shows ${shown} of ${cards.length} cards`);

    // A card's details stay open while the form changes.
    const first = page.locator('#results li.result').first();
    const name = await first.locator('.card-name strong').textContent();
    await first.locator('summary').click();
    await page.fill('#domestic', '150');
    const row = page.locator('#results li.result', { has: page.locator('.card-name strong', { hasText: name }) });
    if (!(await row.locator('details').evaluate((d) => d.open))) {
      problems.push('skypass-cards: a card\'s details close when the form changes');
    }
    return problems;
  },

  // fair-pick with no API, as it is published until one is set up: a poll
  // goes from one phone to another in links, and their votes add up.
  async '/fair-pick/'(page, { base }) {
    const problems = [];
    if (await page.evaluate(() => document.body.dataset.mode) !== 'links') return ['fair-pick does not keep its polls in links'];
    await page.click('#new-link');
    await page.check('input[name="kind"][value="choice"]', { force: true });
    await page.fill('#title-input', '점검 링크');
    await page.locator('#choice-list input').nth(0).fill('가');
    await page.locator('#choice-list input').nth(1).fill('나');
    await page.fill('#id-input', 'smoke-links');
    await page.fill('#pin-input', '48291573');
    await page.click('#create-submit');
    await page.waitForSelector('#poll-body:not([hidden])');
    const linkOf = async (on) => {
      await on.waitForFunction(() => document.getElementById('share-link').href.includes('#1.'));
      return on.getAttribute('#share-link', 'href');
    };
    await rankVote(page, '갑', [0]);
    if (!(await page.isVisible('#send'))) problems.push('fair-pick: no link to send after a vote');
    if (!/마감한 뒤에/.test(await page.textContent('#results'))) problems.push('fair-pick shows the results before the close');
    const first = await linkOf(page);

    // Another phone opens the link with the group ID and PIN, and votes.
    const other = await page.context().browser().newContext({ viewport: { width: 375, height: 800 }, hasTouch: true });
    await other.route('**', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    const second = await other.newPage();
    second.on('pageerror', (error) => problems.push(`fair-pick, second phone: ${error.message}`));
    await second.goto(first);
    await second.waitForSelector('#gate-id-field:not([hidden])');
    await second.fill('#gate-id', 'smoke-links');
    await second.fill('#gate-pin', '11112222');
    await second.click('#gate-submit');
    await second.waitForFunction(() => document.getElementById('gate-message').textContent !== '');
    if (!/맞지 않아요/.test(await second.textContent('#gate-message'))) problems.push('fair-pick takes a wrong PIN for a link');
    await second.fill('#gate-pin', '48291573');
    await second.click('#gate-submit');
    await second.waitForSelector('#poll-body:not([hidden])');
    await rankVote(second, '을', [1]);
    const back = await linkOf(second);

    // Its link brings that vote to the first phone, and the close goes back.
    await page.goto(back);
    await page.waitForSelector('#poll-body:not([hidden])');
    const voters = await page.locator('#voters li').count();
    if (voters !== 2) problems.push(`fair-pick: the maker sees ${voters} voters after opening the other's link`);
    // 가 and 나 draw, so the maker spins the roulette, and its pick goes back too.
    await page.locator('#admin').evaluate((details) => { details.open = true; });
    await page.click('#admin-close');
    await page.waitForSelector('#decision:not([hidden])');
    await spinRoulette(page);
    const picked = await page.textContent('#decided');
    await second.goto(await linkOf(page));
    await second.waitForSelector('#decided');
    if (await second.textContent('#decided') !== picked) problems.push('fair-pick: the roulette\'s pick does not reach the other phone');
    if (!(await second.isHidden('#vote-form'))) problems.push('fair-pick: the closing link leaves the other phone voting');
    const shown = await second.textContent('#results');
    if (!shown.includes('갑') || !shown.includes('을')) problems.push('fair-pick: the closed poll does not show who picked what');
    await other.close();
    return problems;
  },

  async '/fair-pick/?server'(page) {
    const problems = [];

    // A poll of dates picked on the calendar: every Friday of next month at
    // once, from the weekday's name, which keeps the focus when pressed from
    // the keyboard.
    await page.click('#new-link');
    await page.waitForSelector('#picker .cal-day');
    await page.click('#picker [data-focus="next"]');
    const friday = page.locator('#picker [data-focus="wd:5"]');
    await friday.focus();
    await page.keyboard.press('Enter');
    if (!(await page.evaluate(() => document.activeElement?.dataset.focus === 'wd:5'))) {
      problems.push('fair-pick: a weekday pressed from the keyboard loses the focus');
    }
    const fridays = await page.locator('#picked-list li').count();
    if (fridays < 4) problems.push(`fair-pick: pressing 금 picked ${fridays} dates`);
    await page.fill('#title-input', '점검 회식');
    await page.fill('#id-input', 'smoke-check');
    await page.fill('#pin-input', '1234');
    await page.click('#create-submit');
    if (!/쉽게 맞힐/.test(await page.textContent('#create-message'))) problems.push('fair-pick takes the PIN 1234');
    await page.fill('#pin-input', '482915');
    await page.click('#create-submit');
    await page.waitForSelector('#poll-body:not([hidden])');

    // A named vote, every date ○ at once, shows who voted but not how until
    // the close; a second, every date ✕, is named as absent from the day
    // picked once the maker closes the poll.
    await page.fill('#voter-name', '점검');
    await page.locator('#quick-fill button').first().click();
    await page.click('#vote-submit');
    await page.waitForFunction(() => document.getElementById('vote-message').textContent !== '');
    const said = await page.textContent('#vote-message');
    if (!/투표했어요/.test(said)) problems.push(`fair-pick: voting says "${said}"`);
    if (!(await page.textContent('#voters')).includes('점검')) problems.push('fair-pick: the voters do not name the voter');
    if ((await page.textContent('#results')).includes('점검')) problems.push('fair-pick: the results show a vote before the close');
    await page.click('#vote-other');
    await page.fill('#voter-name', '못감');
    await page.locator('#quick-fill button').last().click();
    await page.click('#vote-submit');
    await page.waitForFunction(() => /투표했어요/.test(document.getElementById('vote-message').textContent));
    // Every date is level, so the maker spins the roulette for one.
    await page.locator('#admin').evaluate((details) => { details.open = true; });
    await page.click('#admin-close');
    await page.waitForSelector('#decision:not([hidden])');
    await spinRoulette(page);
    const absent = await page.locator('#absent').textContent().catch(() => '');
    if (!absent.includes('못감')) problems.push(`fair-pick: the day picked names no one absent: "${absent}"`);
    if (!(await page.textContent('#results')).includes('점검')) problems.push('fair-pick: the closed poll does not name the voters');

    // A wrong PIN is turned away with the tries left.
    await page.click('#view-poll .eyebrow a');
    await page.fill('#enter-id', 'smoke-check');
    await page.fill('#enter-pin', '111222');
    await page.click('#enter-submit');
    await page.waitForFunction(() => document.getElementById('enter-message').textContent !== '');
    const wrong = await page.textContent('#enter-message');
    if (!/번 더 틀리면/.test(wrong)) problems.push(`fair-pick: a wrong PIN says "${wrong}"`);

    // Majorities that go round in a circle, 가 over 나 3-2, 나 over 다 4-1 and
    // 다 over 가 3-2, show as the Condorcet paradox once the poll closes, and
    // 나 wins on Borda points.
    await page.click('#new-link');
    await page.check('input[name="kind"][value="choice"]', { force: true });
    await page.fill('#title-input', '점검 장소');
    await page.locator('#choice-list input').nth(0).fill('가');
    await page.locator('#choice-list input').nth(1).fill('나');
    await page.click('#add-choice');
    await page.locator('#choice-list input').nth(2).fill('다');
    await page.fill('#id-input', 'smoke-circle');
    await page.fill('#pin-input', '482915');
    await page.click('#create-submit');
    await page.waitForSelector('#poll-body:not([hidden])');
    const circle = [['갑', [0, 1]], ['을', [0, 1]], ['병', [1, 2]], ['정', [1, 2]], ['무', [2, 0]]];
    for (const [name, order] of circle) {
      if (await page.isVisible('#vote-other')) await page.click('#vote-other');
      await rankVote(page, name, order);
    }
    await page.locator('#admin').evaluate((details) => { details.open = true; });
    await page.click('#admin-close');
    await page.waitForSelector('#decision:not([hidden])');
    if (!(await page.isVisible('#paradox'))) problems.push('fair-pick: a circle of majorities shows no paradox');
    const first = await page.locator('#results .result').first().textContent();
    if (!/^나결정/.test(first) || !/보르다/.test(first)) {
      problems.push(`fair-pick: the circle's pick is "${first.slice(0, 60)}"`);
    }
    return problems;
  },

  async '/sparemine/'(page) {
    const problems = [];
    const line = () => page.textContent('#oneliner');
    if (!/YOUR_BTC_ADDRESS/.test(await line())) problems.push('sparemine: the command lacks the address placeholder');
    if (!(await page.isVisible('#pool-note'))) problems.push('sparemine: the NiceHash pool says nothing of its address');

    // --idle-only goes on Windows and comes back on Linux.
    if (!/ --idle-only/.test(await line())) problems.push('sparemine: the Linux command lacks --idle-only');
    await page.selectOption('#platform', 'windows');
    if (/--idle-only/.test(await line()) || !(await page.isDisabled('#idle-only'))) {
      problems.push('sparemine: the Windows command keeps --idle-only');
    }
    await page.selectOption('#platform', 'linux-static');
    if (!/ --idle-only/.test(await line())) problems.push('sparemine: --idle-only does not come back on Linux');

    // A pool typed in by hand is quoted, and half a thread is no thread count.
    await page.selectOption('#pool', 'custom');
    await page.fill('#pool-url', 'host:1; echo hi');
    if (!(await line()).includes("--url 'host:1; echo hi'")) {
      problems.push('sparemine: a pool typed in is not quoted');
    }
    await page.fill('#threads', '0.5');
    if (/--threads/.test(await line())) problems.push('sparemine: half a thread makes a --threads flag');

    // A copy button says how it went, and goes back to its label however often it is pressed.
    const copy = page.locator('[data-copy="oneliner"]');
    const label = await copy.textContent();
    await copy.click();
    await copy.click();
    await page.waitForTimeout(1600);
    if (await copy.textContent() !== label) problems.push(`sparemine: the copy button stays "${await copy.textContent()}"`);
    return problems;
  },
};

async function main([dir]) {
  if (!dir) throw new Error('usage: node smoke/smoke.js <site directory>');
  const site = resolve(dir);
  const server = await serve(site);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const [path, check] of Object.entries(checks)) {
      const context = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await context.route('**', (route) => (
        route.request().url().startsWith(base) ? route.continue() : route.abort()));
      await setups[path]?.(context);
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
      page.on('console', (message) => {
        // A file that does not load is told by its response below, and another site's is kept off.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
          problems.push(`console error: ${message.text()}`);
        }
      });
      // The site's own files; an API's refusals are a check's to judge.
      page.on('response', (res) => {
        const url = new URL(res.url());
        if (res.url().startsWith(base) && res.status() >= 400 && !OPTIONAL.includes(url.pathname)) {
          problems.push(`${res.status()} ${url.pathname}`);
        }
      });
      await page.goto(base + path);
      await page.waitForLoadState('networkidle');
      try {
        problems.push(...await check(page, { base, site }));
      } catch (error) {
        problems.push(`the check stopped: ${error.message.split('\n')[0]}`);
      }
      const { scroll, width } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth,
      }));
      if (scroll > width) problems.push(`${scroll}px wide on a ${width}px screen`);
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path}`);
      failures.push(...problems.map((problem) => `${path}: ${problem}`));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  for (const failure of failures) console.error(failure);
  return failures.length ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
