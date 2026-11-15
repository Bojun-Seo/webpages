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
// page publishes without them.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

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

const checks = {
  async '/'(page, { base }) {
    const links = await page.$$eval('main a', (as) => as.map((a) => a.getAttribute('href')));
    if (links.length < 3) return [`the index links to ${links.length} pages`];
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
    const holidays = JSON.parse(await readFile(join(site, 'japan-flights/data/holidays.json'), 'utf8')).dates;
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
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
      page.on('console', (message) => {
        // A file that does not load is told by its response below, and another site's is kept off.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
          problems.push(`console error: ${message.text()}`);
        }
      });
      page.on('response', (res) => {
        const url = new URL(res.url());
        if (res.status() >= 400 && !OPTIONAL.includes(url.pathname)) problems.push(`${res.status()} ${url.pathname}`);
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
