// What the page works out, kept apart from the DOM so Node can test it.
//
// Amounts are in won. A year is twelve months: every month the viewer
// spends their monthly amounts, what they spend travelling falls in the
// months they travel, spread evenly across the year, and the Korean Air
// tickets for each trip are bought the month before it.

// The kinds of spending a card's rules name: `domestic`, everything paid in
// Korea each month; `daily`, the part of it at department stores, gas
// stations, coffee shops, convenience stores and taxis; `overseas`,
// payments abroad and to overseas online shops; `dutyFree`, duty-free
// shops; and `koreanAir`, tickets bought from Korean Air itself.
export const CATEGORIES = ['domestic', 'daily', 'overseas', 'dutyFree', 'koreanAir'];

// The most trips a year the page spreads spending over: one a month.
export const MAX_TRIPS = 12;

// What the page values a mile at until the viewer says otherwise, in won.
export const DEFAULT_MILE_VALUE = 15;

function amount(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The twelve months of a year of `spend`, { domestic, daily, online, travel,
// dutyFree, koreanAir, trips }: a month's spending in Korea, the part of it
// in `daily` and a month's at overseas online shops, then a year's spending
// abroad on trips, at duty-free shops and on Korean Air tickets, all in won,
// and the trips a year. Each trip has a month of its own, the first in the
// first month and the rest spread evenly after it, and an equal share of
// the spending abroad and at duty-free shops; its Korean Air tickets, an
// equal share of theirs, are bought the month before.
export function yearOf(spend) {
  const trips = Math.min(MAX_TRIPS, Math.max(1, Math.round(spend.trips) || 1));
  const domestic = amount(spend.domestic);
  const away = new Set(Array.from({ length: trips }, (_, i) => Math.floor((i * 12) / trips)));
  return Array.from({ length: 12 }, (_, m) => ({
    domestic,
    daily: Math.min(amount(spend.daily), domestic),
    overseas: amount(spend.online) + (away.has(m) ? amount(spend.travel) / trips : 0),
    dutyFree: away.has(m) ? amount(spend.dutyFree) / trips : 0,
    koreanAir: away.has((m + 1) % 12) ? amount(spend.koreanAir) / trips : 0,
  }));
}

// What a month's spending comes to; `daily` is part of `domestic`.
export function totalOf(month) {
  return month.domestic + month.overseas + month.dutyFree + month.koreanAir;
}

// Whether any of `months` pays abroad, so that the card has to be one that
// works abroad (해외겸용).
export function paysAbroad(months) {
  return months.some((month) => month.overseas > 0);
}

// The annual fee of `card` as one that works abroad (`abroad`) or in Korea
// only; a card that comes in one kind only costs that.
export function feeOf(card, abroad) {
  const { domestic, overseas } = card.fee;
  return abroad ? overseas ?? domestic : domestic ?? overseas;
}

// The spend the month before has to come to for `card` to earn at all
// (`base`) and for any of its extra miles (`extra`), 0 for none.
export function minPrevOf(card) {
  const rules = [...(card.extra || []), ...(card.options || []).flatMap((option) => option.extra)];
  return { base: card.base.minPrev || 0, extra: Math.max(0, ...rules.map((rule) => rule.minPrev || 0)) };
}

// The miles a rule gives for each won.
function rate(rule) {
  return rule.miles / rule.per;
}

function spentOn(month, categories) {
  return categories.reduce((sum, category) => sum + month[category], 0);
}

// The extra miles `cap` lets a month or a year have: its miles, or, for a
// cap on all the miles its one rule's spending earns, base ones included
// ('total'), the extra miles' share of them.
function capLimit(cap, rules, base) {
  if (cap.counts !== 'total') return cap.miles;
  const extra = rate(rules[0]);
  return (cap.miles * extra) / (extra + rate(base));
}

// What `card` earns over `months` with the extra rules `extra` on top of its
// base rule: { base, extra, bonus, capped, short }. Every month the base
// rule earns on everything spent and each extra rule on what its categories
// take, so long as the month before came to the spend the rule asks for
// (`minPrev`); `short` counts the months that missed miles so. The extra
// miles of the rules that share a cap stop at it, each month or over the
// year, and `capped` is what the caps held back. A year that comes to the
// spend the annual bonus asks for (`minYearSpend`) earns that too.
function earn(card, months, extra) {
  // The rules that count against each cap.
  const capRules = new Map();
  for (const rule of extra) {
    if (rule.cap) capRules.set(rule.cap, [...(capRules.get(rule.cap) || []), rule]);
  }
  const yearLeft = new Map();
  for (const [id, rules] of capRules) {
    if (card.caps[id].per === 'year') yearLeft.set(id, capLimit(card.caps[id], rules, card.base));
  }
  const result = { base: 0, extra: 0, bonus: 0, capped: 0, short: 0 };
  months.forEach((month, m) => {
    const before = totalOf(months[(m + 11) % 12]);
    const meets = (rule) => before >= (rule.minPrev || 0);
    let short = false;
    if (meets(card.base)) result.base += totalOf(month) * rate(card.base);
    else short = totalOf(month) > 0;
    const byCap = new Map();
    for (const rule of extra) {
      const miles = spentOn(month, rule.on) * rate(rule);
      if (!miles) continue;
      if (!meets(rule)) short = true;
      else if (!rule.cap) result.extra += miles;
      else byCap.set(rule.cap, (byCap.get(rule.cap) || 0) + miles);
    }
    for (const [id, miles] of byCap) {
      const cap = card.caps[id];
      const limit = cap.per === 'year' ? yearLeft.get(id) : capLimit(cap, capRules.get(id), card.base);
      const kept = Math.min(miles, limit);
      result.extra += kept;
      result.capped += miles - kept;
      if (cap.per === 'year') yearLeft.set(id, limit - kept);
    }
    if (short) result.short++;
  });
  const spent = months.reduce((sum, month) => sum + totalOf(month), 0);
  if (card.annualBonus && spent >= card.annualBonus.minYearSpend) result.bonus = card.annualBonus.miles;
  return result;
}

// Whole miles, as a card counts them, from a sum of fractions that floating
// point may leave a hair under a whole number.
function whole(miles) {
  return Math.floor(miles + 1e-6);
}

function milesOf(earned) {
  return whole(earned.base) + whole(earned.extra) + earned.bonus;
}

// What `card` comes to over `months` (yearOf) at `mileValue` won a mile: the
// miles it earns, under the option that earns most if it has options
// (`options`; one for a card that works abroad only when the months pay
// abroad), what it costs a year (`fee`), what is left when the miles are
// valued and the fee taken off (`value`), and the fee for each mile
// (`perMile`, null when it earns none).
export function cardYear(card, months, mileValue) {
  const abroad = paysAbroad(months);
  const options = (card.options || []).filter((option) => abroad || !option.overseasOnly);
  const tries = options.length
    ? options.map((option) => ({ option: option.name, ...earn(card, months, [...(card.extra || []), ...option.extra]) }))
    : [{ option: null, ...earn(card, months, card.extra || []) }];
  const best = tries.reduce((a, b) => (milesOf(b) > milesOf(a) ? b : a));
  const miles = milesOf(best);
  const fee = feeOf(card, abroad);
  return {
    card, option: best.option, miles, base: whole(best.base), extra: whole(best.extra), bonus: best.bonus,
    capped: whole(best.capped), short: best.short, abroad, fee,
    value: Math.round(miles * mileValue - fee), perMile: miles > 0 ? fee / miles : null,
  };
}

// The orders the page lists cards in: most left once the miles are valued
// and the fee taken off, most miles, or least fee for each mile, a card
// that earns none last. Ties go to the card that earns more, then to the
// cheaper one.
export const SORTS = {
  value: (a, b) => b.value - a.value || b.miles - a.miles || a.fee - b.fee,
  miles: (a, b) => b.miles - a.miles || b.value - a.value || a.fee - b.fee,
  perMile: (a, b) => (a.perMile ?? Infinity) - (b.perMile ?? Infinity) || b.miles - a.miles || a.fee - b.fee,
};

// Every card in `cards` over a year of `spend` (yearOf) at `mileValue` won a
// mile, but those whose fee is over `maxFee` (null for no limit), in the
// order `sort` names (SORTS).
export function compare(cards, spend, { mileValue = DEFAULT_MILE_VALUE, maxFee = null, sort = 'value' } = {}) {
  const months = yearOf(spend);
  const order = SORTS[sort] || SORTS.value;
  return cards.map((card) => cardYear(card, months, mileValue))
    .filter((result) => maxFee == null || result.fee <= maxFee)
    .sort((a, b) => order(a, b) || a.card.name.localeCompare(b.card.name, 'ko'));
}
