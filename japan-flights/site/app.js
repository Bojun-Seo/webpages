// Loads the data files, reads the filters and draws the trips and routes.
// The working out lives in plan.js.

import {
  DAY_NAMES, TRIP_NIGHTS, airlineOf, daysBetween, dayOf, lastDayOfMonth, monthsAhead, recommend,
  searchLinks,
} from './plan.js';

const PAGE_SIZE = 30;

// Names for the airlines that fly these routes; any other shows its code.
const AIRLINE_NAMES = {
  KE: '대한항공', OZ: '아시아나항공', '7C': '제주항공', LJ: '진에어', TW: '트리니티(티웨이)',
  BX: '에어부산', RS: '에어서울', ZE: '이스타항공', RF: '에어로케이', YP: '에어프레미아', WE: '파라타항공',
  JL: '일본항공', NH: 'ANA', NQ: '에어재팬', MM: '피치항공', ZG: 'ZIPAIR', IJ: '스프링재팬',
  GK: '젯스타재팬', ET: '에티오피아항공', BR: '에바항공', CI: '중화항공', JX: '스타럭스항공',
  IT: '타이거에어 타이완', CX: '캐세이퍼시픽', UO: '홍콩익스프레스', HX: '홍콩항공', NX: '에어마카오', TR: '스쿠트',
};

function airlineName(code) {
  return AIRLINE_NAMES[code] || code;
}

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

function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function load(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function shortDate(date) {
  const [, m, d] = date.split('-');
  return `${Number(m)}.${Number(d)}`;
}

function dayLabel(date) {
  return `${shortDate(date)} (${DAY_NAMES[dayOf(date)]})`;
}

function monthLabel(month) {
  const [y, m] = month.split('-');
  return `${y}년 ${Number(m)}월`;
}

function won(price) {
  return `${price.toLocaleString('ko-KR')}원`;
}

function seenLabel(seen, today) {
  const days = daysBetween(seen.slice(0, 10), today);
  return days <= 0 ? '오늘 확인' : `${days}일 전 확인`;
}

function link(href, text, cls) {
  return el('a', { href, target: '_blank', rel: 'noopener', class: cls }, text);
}

const state = {
  data: null, nights: new Set(), cities: new Set(), airlines: new Set(), trips: [], shown: PAGE_SIZE,
};

function readFilter() {
  const { data } = state;
  const month = $('month').value;
  const leave = $('leave').value;
  const budget = Number($('budget').value);
  return {
    from: month === 'all' ? data.today : `${month}-01`,
    to: month === 'all' ? lastDayOfMonth(data.months.at(-1)) : lastDayOfMonth(month),
    nights: state.nights.size ? state.nights : null,
    maxLeave: leave === 'any' ? null : Number(leave),
    maxPrice: budget > 0 ? budget * 10000 : null,
    origins: $('origin').value === 'all' ? null : new Set([$('origin').value]),
    cities: state.cities.size ? state.cities : null,
    airlines: state.airlines.size ? state.airlines : null,
  };
}

function tripRow(trip) {
  const { data } = state;
  const route = data.byId.get(trip.route);
  const badges = [
    el('span', { class: `badge ${trip.leave === 0 ? 'badge-good' : ''}` }, `연차 ${trip.leave}일`),
    ...trip.holidays.map((name) => el('span', { class: 'badge badge-holiday' }, name)),
    trip.eveningDeparture && el('span', { class: 'badge' }, '저녁 출발'),
    trip.morningArrival && el('span', { class: 'badge' }, trip.lands > trip.return ? '다음 날 오전 도착' : '오전 도착'),
    route.tag && el('span', { class: 'badge' }, route.tag),
  ];
  const price = trip.fare
    ? el('div', { class: 'price' },
      el('strong', null, won(trip.fare.price)),
      el('span', null, `${airlineName(trip.airline)} · ${seenLabel(trip.fare.seen || data.today, data.today)}`))
    : el('div', { class: 'price price-unknown' }, el('strong', null, '가격 미확인'),
      el('span', null, `${airlineName(trip.airline)} · 검색 링크로 확인`));
  return el('li', { class: 'trip' },
    el('div', { class: 'when' },
      el('span', { class: 'dates' }, `${dayLabel(trip.depart)} → ${dayLabel(trip.return)}`),
      el('span', { class: 'stay' }, `${trip.nights}박 ${trip.nights + 1}일`)),
    el('div', { class: 'where' },
      el('span', { class: 'city' }, route.city),
      el('span', { class: 'code' }, `${route.origin}→${route.dest}`)),
    el('div', { class: 'badges' }, badges),
    price,
    el('div', { class: 'links' },
      searchLinks(route, trip.depart, trip.return, trip.airline).map((l) => link(l.url, l.name))));
}

function renderTrips() {
  const { data, trips } = state;
  const priced = trips.filter((t) => t.fare).length;
  $('summary').textContent = trips.length
    ? `조건에 맞는 일정 ${trips.length.toLocaleString('ko-KR')}개 · 가격 확인 ${priced}개`
    : '';
  const hint = $('hint');
  hint.hidden = data.fareCount > 0 || trips.length === 0;
  hint.textContent = '아직 확인된 운임이 없습니다. 일정마다 있는 링크로 실시간 가격을 확인하세요.';

  const list = $('trips');
  list.replaceChildren(...trips.slice(0, state.shown).map(tripRow));
  if (trips.length === 0) {
    list.append(el('li', { class: 'empty' },
      '조건에 맞는 일정이 없습니다. 출발 시기나 여행 기간을 넓히거나, 다른 도시나 항공사를 골라 보세요.'));
  }
  const more = $('more');
  more.hidden = trips.length <= state.shown;
  more.textContent = `더 보기 (${(trips.length - state.shown).toLocaleString('ko-KR')}개 남음)`;
}

// A row of toggle chips for `picked`, a Set that stays empty for "all".
function renderChips(box, allLabel, picked, options) {
  const chip = (label, pressed, onclick) =>
    el('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), onclick }, label);
  box.replaceChildren(
    chip(allLabel, picked.size === 0, () => { picked.clear(); update(); }),
    ...options.map(({ value, label }) => chip(label, picked.has(value), () => {
      if (picked.has(value)) picked.delete(value);
      else picked.add(value);
      update();
    })));
}

function renderNights() {
  renderChips($('nights'), `${TRIP_NIGHTS[0]}~${TRIP_NIGHTS.at(-1)}박 전체`, state.nights,
    TRIP_NIGHTS.map((n) => ({ value: n, label: `${n}박` })));
}

// One chip per destination airport, whichever Korean airport its routes leave.
function renderCities() {
  const airports = new Map();
  for (const route of state.data.routes) {
    if (!airports.has(route.dest)) airports.set(route.dest, route.city);
  }
  renderChips($('cities'), '모든 도시', state.cities,
    [...airports].map(([value, label]) => ({ value, label })));
}

function renderAirlines() {
  renderChips($('airlines'), '모든 항공사', state.airlines,
    state.data.airlines.map((code) => ({ value: code, label: airlineName(code) })));
}

function update() {
  state.shown = PAGE_SIZE;
  state.trips = recommend(state.data, readFilter());
  renderNights();
  renderCities();
  renderAirlines();
  renderTrips();
}

function statusLine(routesDoc, manual, live) {
  const parts = [`노선 정보 ${routesDoc.updated} 기준`, `저장된 운임 ${manual.length}건`];
  if (live && live.updated) {
    const at = new Date(live.updated);
    parts.push(`실시간 운임 ${live.fares.length}건 (${at.getMonth() + 1}.${at.getDate()} 갱신)`);
  } else if (live) {
    parts.push('실시간 운임 미설정');
  }
  return parts.join(' · ');
}

async function main() {
  const [routesDoc, manualDoc, live, holidaysDoc] = await Promise.all([
    load('data/routes.json'), load('data/fares.json'), load('data/live-fares.json'), load('data/holidays.json'),
  ]);
  if (!routesDoc) {
    $('status').textContent = 'data/routes.json을 읽지 못했습니다. 파일을 직접 열었다면 README의 로컬 실행 방법을 따라 주세요.';
    return;
  }
  const manual = manualDoc?.fares || [];
  const fares = [...manual, ...(live?.fares || [])];
  const today = localToday();
  const routes = routesDoc.routes;
  state.data = {
    routes,
    fares,
    holidays: holidaysDoc?.dates || {},
    today,
    byId: new Map(routes.map((r) => [r.id, r])),
    months: monthsAhead(routes, today),
    fareCount: fares.filter((f) => f.depart >= today).length,
    // Korean Air, whose schedules the page knows, then the airlines with fares.
    airlines: ['KE', ...[...new Set(fares.filter((f) => f.depart >= today).map(airlineOf))]
      .filter((code) => code !== 'KE')
      .sort((a, b) => airlineName(a).localeCompare(airlineName(b), 'ko'))],
  };

  $('status').textContent = statusLine(routesDoc, manual, live);
  $('month').replaceChildren(
    el('option', { value: 'all' }, '전체 기간'),
    ...state.data.months.map((m) => el('option', { value: m }, monthLabel(m))));

  for (const id of ['origin', 'month', 'leave']) $(id).addEventListener('change', update);
  $('budget').addEventListener('input', update);
  $('filters').addEventListener('submit', (event) => event.preventDefault());
  $('more').addEventListener('click', () => {
    state.shown += PAGE_SIZE;
    renderTrips();
  });

  update();
}

main();
