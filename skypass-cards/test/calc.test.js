import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, cardYear, compare, feeOf, minPrevOf, totalOf, yearOf } from '../site/calc.js';

const doc = JSON.parse(readFileSync(new URL('../site/data/cards.json', import.meta.url)));
const real = (id) => doc.cards.find((card) => card.id === id);

// A card that earns a mile for each 1,000 won and nothing more, unless told otherwise.
const card = (props) => ({
  id: 'test', issuer: '테스트카드', name: '테스트 카드', fee: { domestic: 10000, overseas: 12000 },
  base: { per: 1000, miles: 1 }, caps: {}, notes: [], perks: [], unverified: [], ...props,
});

// A year that spends nothing but what it is told, on one trip.
const spend = (props) => ({ domestic: 0, daily: 0, online: 0, travel: 0, dutyFree: 0, koreanAir: 0, trips: 1, ...props });

const year = (c, s, mileValue = 15) => cardYear(c, yearOf(spend(s)), mileValue);

// The page's example: a million won a month in Korea, 200,000 of it at the
// shops that earn more on some cards, and one trip spending two million
// abroad on a million won of Korean Air tickets.
const EXAMPLE = spend({ domestic: 1000000, daily: 200000, travel: 2000000, koreanAir: 1000000 });

test('trips spread across the year, and their tickets are bought the month before', () => {
  const months = yearOf(spend({
    domestic: 1000000, daily: 200000, online: 100000, travel: 1200000, dutyFree: 600000, koreanAir: 900000, trips: 3,
  }));
  assert.equal(months.length, 12);
  const at = (key) => months.flatMap((month, m) => (month[key] > 0 ? [m] : []));
  assert.deepEqual(at('dutyFree'), [0, 4, 8]);
  assert.deepEqual(at('koreanAir'), [3, 7, 11]);
  assert.deepEqual(months[0], { domestic: 1000000, daily: 200000, overseas: 500000, dutyFree: 200000, koreanAir: 0 });
  assert.deepEqual(months[3], { domestic: 1000000, daily: 200000, overseas: 100000, dutyFree: 0, koreanAir: 300000 });
  assert.equal(months.reduce((sum, month) => sum + totalOf(month), 0), 12000000 + 1200000 + 1200000 + 600000 + 900000);
});

test('the part spent at the shops some cards favour is never more than all spent in Korea', () => {
  assert.equal(yearOf(spend({ domestic: 300000, daily: 500000 }))[0].daily, 300000);
});

test('trips count from one to twelve a year, and odd entries fall back within that', () => {
  const tripsOf = (trips) => yearOf(spend({ dutyFree: 1200000, trips })).filter((month) => month.dutyFree > 0).length;
  assert.equal(tripsOf(0), 1);
  assert.equal(tripsOf(Number.NaN), 1);
  assert.equal(tripsOf(5), 5);
  assert.equal(tripsOf(20), 12);
  // Negative or missing amounts count as none.
  assert.equal(totalOf(yearOf(spend({ domestic: -5, online: undefined }))[0]), 0);
});

test('the base rule earns on everything spent, as whole miles', () => {
  const result = year(card(), { domestic: 1000000 });
  assert.equal(result.miles, 12000);
  assert.equal(result.fee, 10000);
  assert.equal(result.value, 12000 * 15 - 10000);
  // 666.66… miles a month makes 8,000 in a year, not 7,999, however floating point adds them up.
  assert.equal(year(card({ base: { per: 1500, miles: 1 } }), { domestic: 1000000 }).miles, 8000);
  assert.equal(year(card({ base: { per: 1500, miles: 1 } }), { domestic: 999999 }).miles, 7999);
});

test('a month earns only if the month before came to the spend a rule asks for', () => {
  const picky = card({ base: { per: 1000, miles: 1, minPrev: 500000 } });
  assert.deepEqual([year(picky, { domestic: 400000 }).miles, year(picky, { domestic: 400000 }).short], [0, 12]);
  assert.equal(year(picky, { domestic: 500000 }).miles, 6000);
  // Tickets bought in month 11 lift month 0 over the bar, but are bought in a month that earns nothing.
  const lifted = year(picky, { domestic: 400000, koreanAir: 1000000 });
  assert.deepEqual([lifted.miles, lifted.short], [400, 11]);
});

test('extra miles that share a monthly cap stop at it together', () => {
  const capped = card({
    extra: [{ on: ['overseas', 'dutyFree'], per: 1000, miles: 1, cap: 'extra' }],
    caps: { extra: { miles: 1000, per: 'month' } },
  });
  const result = year(capped, { travel: 3000000, dutyFree: 1000000 });
  assert.deepEqual([result.base, result.extra, result.capped, result.miles], [4000, 1000, 3000, 5000]);
});

test('a cap on all the miles a rule earns leaves the extra ones their share', () => {
  // Two miles a 1,000 won abroad up to 4,000 miles a month, one beyond: 2 million won earns 4,000, 4 million more 4,000.
  const double = card({
    extra: [{ on: ['overseas'], per: 1000, miles: 1, cap: 'overseas' }],
    caps: { overseas: { miles: 4000, per: 'month', counts: 'total' } },
  });
  assert.equal(year(double, { travel: 6000000 }).miles, 8000);
  // Three miles up to 6,000 a month: 2 million won earns 6,000, a million more 1,000.
  const triple = card({
    extra: [{ on: ['overseas'], per: 1000, miles: 2, cap: 'overseas' }],
    caps: { overseas: { miles: 6000, per: 'month', counts: 'total' } },
  });
  assert.equal(year(triple, { travel: 3000000 }).miles, 7000);
});

test('a yearly cap carries across the months it is spent in', () => {
  // Two miles up to 20,000 a year on tickets: 10 million won earns 20,000, 20 million more 20,000.
  const tickets = card({
    extra: [{ on: ['koreanAir'], per: 1000, miles: 1, cap: 'koreanAir' }],
    caps: { koreanAir: { miles: 20000, per: 'year', counts: 'total' } },
  });
  const result = year(tickets, { koreanAir: 30000000, trips: 2 });
  assert.deepEqual([result.base, result.extra, result.capped, result.miles], [30000, 10000, 20000, 40000]);
});

test('extra miles can ask for a spend the month before that the base miles do not', () => {
  const abroad = card({ extra: [{ on: ['overseas'], per: 1000, miles: 1, minPrev: 500000 }] });
  const short = year(abroad, { domestic: 300000, travel: 1000000 });
  assert.deepEqual([short.miles, short.short], [4600, 1]);
  assert.equal(year(abroad, { domestic: 500000, travel: 1000000 }).miles, 8000);
  assert.deepEqual(minPrevOf(abroad), { base: 0, extra: 500000 });
});

test('a card with options earns under the best one, an overseas one only for a card that pays abroad', () => {
  const choosy = card({
    options: [
      { name: '해외형', overseasOnly: true, extra: [{ on: ['overseas'], per: 1000, miles: 1, cap: 'option' }] },
      { name: '국내형', extra: [{ on: ['daily'], per: 1000, miles: 1, cap: 'option' }] },
    ],
    caps: { option: { miles: 2000, per: 'month' } },
  });
  const home = year(choosy, { domestic: 1000000, daily: 300000 });
  assert.deepEqual([home.option, home.miles, home.fee, home.abroad], ['국내형', 15600, 10000, false]);
  const away = year(choosy, { domestic: 1000000, daily: 100000, travel: 5000000 });
  assert.deepEqual([away.option, away.miles, away.fee, away.abroad], ['해외형', 19000, 12000, true]);
});

test('the annual bonus comes with a year that spends what it asks', () => {
  const bonus = card({ annualBonus: { miles: 1000, minYearSpend: 6000000 } });
  assert.equal(year(bonus, { domestic: 500000 }).bonus, 1000);
  assert.equal(year(bonus, { domestic: 490000 }).bonus, 0);
});

test('a card that comes in one kind costs that, abroad or not', () => {
  assert.equal(feeOf(card({ fee: { overseas: 45000 } }), false), 45000);
  assert.equal(feeOf(card(), false), 10000);
  assert.equal(feeOf(card(), true), 12000);
});

test('cards are listed by what is left, miles or fee for each mile, and the fee limit leaves some out', () => {
  const cards = [
    card({ id: 'a', name: 'A', fee: { domestic: 10000, overseas: 10000 } }),
    card({ id: 'b', name: 'B', fee: { domestic: 50000, overseas: 50000 }, base: { per: 1000, miles: 2 } }),
    card({ id: 'c', name: 'C', fee: { domestic: 30000, overseas: 30000 }, base: { per: 1500, miles: 1 } }),
    card({ id: 'd', name: 'D', fee: { domestic: 5000, overseas: 5000 }, base: { per: 1000, miles: 1, minPrev: 9e9 } }),
  ];
  const ids = (options) => compare(cards, spend({ domestic: 1000000 }), options).map((r) => r.card.id).join('');
  assert.equal(ids({ sort: 'value' }), 'bacd');
  assert.equal(ids({ sort: 'miles' }), 'bacd');
  assert.equal(ids({ sort: 'perMile' }), 'abcd');
  assert.equal(ids({ sort: 'value', maxFee: 40000 }), 'acd');
  assert.equal(compare(cards, spend({ domestic: 1000000 }), { mileValue: 15 })[0].value, 24000 * 15 - 50000);
});

test('대한항공카드 060 earns what its guidebook gives for the page’s example', () => {
  // 15 million won a year at a mile each, a mile more on the 2 million abroad and the million of
  // tickets, and the bonus 1,000 for a year over 6 million won.
  const result = cardYear(real('hyundai-korean-air-060'), yearOf(EXAMPLE), 15);
  assert.deepEqual([result.base, result.extra, result.bonus, result.miles, result.fee], [15000, 3000, 1000, 19000, 60000]);
});

test('every card works out to whole miles and a fee for the page’s example', () => {
  for (const result of compare(doc.cards, EXAMPLE)) {
    assert.ok(Number.isInteger(result.miles) && result.miles > 0, result.card.id);
    assert.ok(Number.isInteger(result.fee) && result.fee > 0, result.card.id);
    assert.ok(Number.isInteger(result.value), result.card.id);
  }
});

test('every card has the fields the page reads, and its rules name caps and kinds of spending it has', () => {
  const isDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  const isAmount = (n) => Number.isInteger(n) && n > 0;
  const strings = (list) => Array.isArray(list) && list.every((s) => typeof s === 'string' && s.length > 0);
  assert.ok(isDate(doc.updated));
  const ids = new Set();
  for (const c of doc.cards) {
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(c.id), `${c.id} appears twice`);
    ids.add(c.id);
    assert.ok(c.issuer && c.name, c.id);
    // Every card can be had in a kind that works abroad, for a viewer who pays abroad.
    assert.ok(isAmount(c.fee.overseas), c.id);
    assert.ok(c.fee.domestic === undefined || isAmount(c.fee.domestic), c.id);
    const rules = [...(c.extra || []), ...(c.options || []).flatMap((option) => option.extra)];
    for (const rule of [c.base, ...rules]) {
      assert.ok([1000, 1500].includes(rule.per), c.id);
      assert.ok(rule.miles > 0, c.id);
      assert.ok(rule.minPrev === undefined || isAmount(rule.minPrev), c.id);
    }
    for (const rule of rules) {
      assert.ok(rule.on.length > 0 && rule.on.every((category) => CATEGORIES.includes(category)), c.id);
      // `daily` is part of `domestic`, so a rule naming both would count it twice.
      assert.ok(!(rule.on.includes('domestic') && rule.on.includes('daily')), c.id);
      assert.ok(rule.cap === undefined || c.caps[rule.cap], `${c.id} names a cap it does not have`);
    }
    for (const [id, cap] of Object.entries(c.caps)) {
      assert.ok(isAmount(cap.miles) && ['month', 'year'].includes(cap.per), `${c.id} ${id}`);
      assert.ok([undefined, 'total'].includes(cap.counts), `${c.id} ${id}`);
      // A cap on all the miles is worked out from its one rule's rate.
      if (cap.counts === 'total') assert.equal(rules.filter((rule) => rule.cap === id).length, 1, `${c.id} ${id}`);
    }
    for (const option of c.options || []) assert.ok(option.name && option.extra.length > 0, c.id);
    if (c.annualBonus) assert.ok(isAmount(c.annualBonus.miles) && isAmount(c.annualBonus.minYearSpend), c.id);
    assert.ok(strings(c.notes) && strings(c.perks) && strings(c.unverified), c.id);
    assert.ok(isDate(c.checked) && c.checked <= doc.updated, c.id);
    assert.ok(c.sources.length > 0 && c.sources.every((s) => s.title && /^https:\/\//.test(s.url)), c.id);
  }
});
