// Loads the data files, reads the filters and draws the trips and routes.
// The working out lives in plan.js.

import {
  DAY_NAMES, WEEK, daysBetween, dayOf, flightTimes, lastDayOfMonth, monthsAhead, recommend,
  searchLinks, timetableDays, weeklyFlights,
} from './plan.js';

const PAGE_SIZE = 30;
const NIGHTS = { '1-2': [1, 2], '2-3': [2, 3], '3-4': [3, 4], '4-5': [4, 5], any: [1, 6] };

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

const state = { data: null, cities: new Set(), shown: PAGE_SIZE };

function readFilter() {
  const { data } = state;
  const month = $('month').value;
  const [minNights, maxNights] = NIGHTS[$('nights').value];
  const leave = $('leave').value;
  const budget = Number($('budget').value);
  return {
    from: month === 'all' ? data.today : `${month}-01`,
    to: month === 'all' ? lastDayOfMonth(data.months.at(-1)) : lastDayOfMonth(month),
    minNights,
    maxNights,
    maxLeave: leave === 'any' ? null : Number(leave),
    maxPrice: budget > 0 ? budget * 10000 : null,
    cities: state.cities.size ? state.cities : null,
  };
}

function tripRow(trip) {
  const { data } = state;
  const route = data.byId.get(trip.route);
  const badges = [
    el('span', { class: `badge ${trip.leave === 0 ? 'badge-good' : ''}` }, `연차 ${trip.leave}일`),
    ...trip.holidays.map((name) => el('span', { class: 'badge badge-holiday' }, name)),
    route.tag && el('span', { class: 'badge' }, route.tag),
  ];
  const price = trip.fare
    ? el('div', { class: 'price' },
      el('strong', null, won(trip.fare.price)),
      el('span', null, `${trip.fare.source || '직접 입력'} · ${seenLabel(trip.fare.seen || data.today, data.today)}`))
    : el('div', { class: 'price price-unknown' }, el('strong', null, '가격 미확인'), el('span', null, '검색 링크로 확인'));
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
      searchLinks(route, trip.depart, trip.return).map((l) => link(l.url, l.name))));
}

function renderTrips() {
  const { data } = state;
  const trips = recommend(data, readFilter());
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
      '조건에 맞는 일정이 없습니다. 출발 시기나 여행 기간을 넓히거나, 운항 요일이 확인된 도시를 골라 보세요.'));
  }
  const more = $('more');
  more.hidden = trips.length <= state.shown;
  more.textContent = `더 보기 (${(trips.length - state.shown).toLocaleString('ko-KR')}개 남음)`;
}

function weekStrip(period) {
  const flies = (day) => period.days === 'daily' || period.days.includes(day);
  const names = WEEK.filter(flies).map((day) => DAY_NAMES[day]).join('·');
  return el('span', { class: 'week', role: 'img', 'aria-label': `운항 요일 ${names}` },
    WEEK.map((day) => el('span', { class: flies(day) ? 'on' : null, 'aria-hidden': 'true' }, DAY_NAMES[day])));
}

function routeCard(route) {
  const periods = route.periods.filter((p) => p.to >= state.data.today);
  return el('article', { class: 'route' },
    el('header', null,
      el('h3', null, route.city, el('span', { class: 'code' }, route.dest)),
      route.tag && el('span', { class: 'badge' }, route.tag)),
    el('p', { class: 'region' }, route.region),
    el('p', { class: 'about' }, route.about),
    periods.map((p) => el('div', { class: 'period' },
      el('span', { class: 'range' }, `${shortDate(p.from)} – ${shortDate(p.to)}`),
      weekStrip(p),
      el('span', { class: 'freq' }, `주 ${weeklyFlights(p)}회 · ${timetableDays(p)}`))),
    route.note && el('p', { class: 'note' }, route.note),
    route.flights && el('p', { class: 'times' }, flightTimes(route)),
    route.aircraft && el('p', { class: 'aircraft' }, route.aircraft),
    el('p', { class: 'sources' }, '출처 ',
      route.sources.map((s, i) => [i > 0 && ' · ', link(s.url, s.title)])));
}

function renderRoutes() {
  $('routes').replaceChildren(...state.data.routes.map(routeCard));
}

function renderCities() {
  const box = $('cities');
  const chip = (label, pressed, onclick) =>
    el('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), onclick }, label);
  box.replaceChildren(
    chip('전체', state.cities.size === 0, () => { state.cities.clear(); update(); }),
    ...state.data.routes.map((route) => chip(route.city, state.cities.has(route.id), () => {
      if (state.cities.has(route.id)) state.cities.delete(route.id);
      else state.cities.add(route.id);
      update();
    })));
}

function update() {
  state.shown = PAGE_SIZE;
  renderCities();
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
  };

  $('status').textContent = statusLine(routesDoc, manual, live);
  $('month').replaceChildren(
    el('option', { value: 'all' }, '전체 기간'),
    ...state.data.months.map((m) => el('option', { value: m }, monthLabel(m))));

  for (const id of ['month', 'nights', 'leave']) $(id).addEventListener('change', update);
  $('budget').addEventListener('input', update);
  $('filters').addEventListener('submit', (event) => event.preventDefault());
  $('more').addEventListener('click', () => {
    state.shown += PAGE_SIZE;
    renderTrips();
  });

  renderRoutes();
  update();
}

main();
