// Loads the cards, reads what the viewer spends and draws what each card
// earns in a year. The working out lives in calc.js.

import { DEFAULT_MILE_VALUE, MAX_TRIPS, compare, minPrevOf, paysAbroad, yearOf } from './calc.js';

// Where this browser keeps what the viewer entered.
const FORM_KEY = 'skypass-cards.form';

// What the form starts with until the viewer changes it, amounts in 만원:
// an example, which the page says it is, not anyone's spending.
const EXAMPLE = {
  domestic: 100, daily: 20, online: 0, travel: 200, dutyFree: 0, koreanAir: 100, trips: 1,
  mileValue: DEFAULT_MILE_VALUE, maxFee: '', sort: 'value',
};

// The amount fields, in 만원, by the key calc.js reads.
const AMOUNTS = {
  domestic: 'domestic', daily: 'daily', online: 'online', travel: 'travel', dutyFree: 'duty-free',
  koreanAir: 'korean-air',
};

// The other fields, by the key the form keeps them under.
const SETTINGS = { trips: 'trips', mileValue: 'mile-value', maxFee: 'max-fee', sort: 'sort' };

const MAN = 10000;

const $ = (id) => document.getElementById(id);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

async function load(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function number(n) {
  return `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ko-KR')}`;
}

function won(n) {
  return `${number(n)}원`;
}

function miles(n) {
  return `${number(n)}마일`;
}

// "50만 원" for 500000.
function manwon(n) {
  return `${(n / MAN).toLocaleString('ko-KR')}만 원`;
}

// "2026.10.19" for '2026-10-19'.
function dotDate(date) {
  return date.replaceAll('-', '.');
}

const state = { cards: [] };

// The form as entered: amounts in 만원, the trips a year, a mile's value in
// won, the fee limit ('' for none) and the order.
function readForm() {
  const form = {};
  for (const [key, id] of Object.entries(AMOUNTS)) form[key] = Number($(id).value) || 0;
  for (const [key, id] of Object.entries(SETTINGS)) form[key] = $(id).value;
  form.trips = Number(form.trips);
  form.mileValue = form.mileValue === '' ? DEFAULT_MILE_VALUE : Math.max(0, Number(form.mileValue) || 0);
  return form;
}

function fillForm(form) {
  for (const [key, id] of Object.entries({ ...AMOUNTS, ...SETTINGS })) {
    if (form[key] != null) $(id).value = form[key];
  }
}

// What this browser kept of the form, or null.
function loadForm() {
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY));
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

function saveForm(form) {
  try {
    if (form) localStorage.setItem(FORM_KEY, JSON.stringify(form));
    else localStorage.removeItem(FORM_KEY);
  } catch {
    // Without storage the form lasts as long as the page.
  }
}

// What the month before has to come to for the card to earn, as a badge.
function minPrevLabel(card) {
  const { base, extra } = minPrevOf(card);
  if (base) return `전월 ${manwon(base)} 이상 적립`;
  if (extra) return `추가 적립은 전월 ${manwon(extra)} 이상`;
  return '전월실적 없음';
}

function figure(cls, label, value) {
  return el('div', { class: `figure ${cls}` }, el('span', { class: 'label' }, label), value);
}

function list(title, items) {
  if (!items || items.length === 0) return null;
  return [el('h3', null, title), el('ul', null, items.map((item) => el('li', null, item)))];
}

// How a year's miles add up, and what the fee is for.
function breakdown(result) {
  const { card } = result;
  const extra = miles(result.extra) + (result.capped > 0 ? ` (한도로 못 받은 ${miles(result.capped)})` : '');
  const bonus = card.annualBonus && (result.bonus > 0
    ? miles(result.bonus)
    : `0마일 (1년 ${manwon(card.annualBonus.minYearSpend)} 이상 쓰면 ${miles(card.annualBonus.miles)})`);
  const kind = card.fee.domestic == null || card.fee.overseas == null ? '' : result.abroad ? ', 해외겸용' : ', 국내전용';
  const rows = [
    ['기본 적립', miles(result.base)],
    ['추가 적립', extra],
    bonus && ['연간 보너스', bonus],
    ['연회비', `${won(result.fee)}${kind}`],
  ].filter(Boolean);
  return el('dl', { class: 'breakdown' }, rows.map(([term, value]) => [el('dt', null, term), el('dd', null, value)]));
}

function resultRow(result) {
  const { card } = result;
  const badges = [
    el('span', { class: 'badge' }, minPrevLabel(card)),
    result.option && el('span', { class: 'badge badge-option' }, `${result.option}으로 계산`),
    result.short > 0 && el('span', { class: 'badge badge-caution' }, `실적 미달 ${result.short}개월`),
    card.unverified.length > 0 && el('span', { class: 'badge badge-caution' }, `확인 못 한 조건 ${card.unverified.length}개`),
  ];
  return el('li', { class: 'result' },
    el('div', { class: 'card-name' },
      el('span', { class: 'issuer' }, card.issuer),
      el('strong', null, card.name)),
    el('div', { class: 'badges' }, badges),
    figure('miles', '1년 마일', el('strong', null, number(result.miles))),
    figure('fee', '연회비', won(result.fee)),
    figure(`value${result.value < 0 ? ' negative' : ''}`, '남는 가치', won(result.value)),
    figure('per-mile', '마일당 연회비', result.perMile == null ? '—' : `${result.perMile.toFixed(1)}원`),
    el('details', { class: 'detail' },
      el('summary', null, '계산 내역과 조건'),
      breakdown(result),
      list('알아 둘 조건', card.notes),
      list('계산에 넣지 않은 혜택', card.perks),
      list('확인 못 한 조건', card.unverified),
      el('p', { class: 'sources' },
        `확인한 곳 (${dotDate(card.checked)}): ${card.sources.map((source) => source.title).join(' · ')}`)));
}

function update() {
  const form = readForm();
  const spend = {
    ...Object.fromEntries(Object.keys(AMOUNTS).map((key) => [key, form[key] * MAN])), trips: form.trips,
  };
  const maxFee = form.maxFee === '' ? null : Number(form.maxFee);
  const results = compare(state.cards, spend, { mileValue: form.mileValue, maxFee, sort: form.sort });
  const left = state.cards.length - results.length;
  $('summary').textContent = [
    `카드 ${results.length}종`,
    left > 0 && `연회비 조건으로 ${left}종 뺌`,
    `1마일 ${form.mileValue.toLocaleString('ko-KR')}원`,
    `${paysAbroad(yearOf(spend)) ? '해외겸용' : '국내전용'} 연회비로 계산`,
  ].filter(Boolean).join(' · ');
  $('results').replaceChildren(...(results.length
    ? results.map(resultRow)
    : [el('li', { class: 'empty' }, '연회비 조건에 맞는 카드가 없습니다.')]));
  return form;
}

// Recomputes on a change and keeps what the viewer entered.
function changed() {
  saveForm(update());
  $('example-note').hidden = true;
}

function reset() {
  saveForm(null);
  fillForm(EXAMPLE);
  $('example-note').hidden = false;
  update();
}

async function main() {
  const doc = await load('data/cards.json');
  if (!doc) {
    $('status').textContent = 'data/cards.json을 읽지 못했습니다. 파일을 직접 열었다면 README의 로컬 실행 방법을 따라 주세요.';
    return;
  }
  state.cards = doc.cards;
  $('status').textContent = `카드 ${doc.cards.length}종 · 조건 확인 ${dotDate(doc.updated)}`;

  $('trips').replaceChildren(...Array.from({ length: MAX_TRIPS }, (_, i) =>
    el('option', { value: i + 1 }, `${i + 1}번`)));
  const saved = loadForm();
  fillForm({ ...EXAMPLE, ...saved });
  $('example-note').hidden = Boolean(saved);

  for (const id of [...Object.values(AMOUNTS), 'mile-value']) $(id).addEventListener('input', changed);
  for (const id of ['trips', 'max-fee', 'sort']) $(id).addEventListener('change', changed);
  $('reset').addEventListener('click', reset);
  $('form').addEventListener('submit', (event) => event.preventDefault());

  update();
}

main();
