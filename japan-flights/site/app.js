// Loads the data files, reads the filters and draws the trips and routes.
// The working out lives in plan.js.

import {
  ALLIANCES, DAY_NAMES, DEFAULT_PARTY, TRIP_NIGHTS, allianceOf, dayOf, fareMonths, lastDayOfMonth, recommend,
  routesOf, searchLinks,
} from './plan.js';

const PAGE_SIZE = 30;

// The most people and checked bags the selects offer; booking sites take up
// to nine adults.
const MAX_PEOPLE = 9;
const MAX_BAGS = 9;

// Names for the airlines that fly these routes or connect on them; any
// other shows its code.
const AIRLINE_NAMES = {
  KE: '대한항공', OZ: '아시아나항공', '7C': '제주항공', LJ: '진에어', TW: '트리니티(티웨이)',
  BX: '에어부산', RS: '에어서울', ZE: '이스타항공', RF: '에어로케이', YP: '에어프레미아', WE: '파라타항공',
  JL: '일본항공', NH: 'ANA', NQ: '에어재팬', MM: '피치항공', ZG: 'ZIPAIR', IJ: '스프링재팬',
  GK: '젯스타재팬', BC: '스카이마크', HD: '에어두', '6J': '솔라시드에어', NU: '일본트랜스오션항공',
  ET: '에티오피아항공', BR: '에바항공', CI: '중화항공', JX: '스타럭스항공', IT: '타이거에어 타이완',
  CX: '캐세이퍼시픽', UO: '홍콩익스프레스', HX: '홍콩항공', NX: '에어마카오', TR: '스쿠트',
  VN: '베트남항공', VJ: '비엣젯항공', QH: '뱀부항공', VU: '비에트래블항공', '9G': '선푸꾸옥항공',
  TG: '타이항공', FD: '타이에어아시아', XJ: '타이에어아시아엑스', SL: '타이라이온에어', VZ: '타이비엣젯',
  UA: '유나이티드항공', PR: '필리핀항공', '5J': '세부퍼시픽', SQ: '싱가포르항공', MH: '말레이시아항공',
  AK: '에어아시아', D7: '에어아시아엑스', OD: '바틱에어 말레이시아',
};

function airlineName(code) {
  return AIRLINE_NAMES[code] || code;
}

// The alliances' names, in the order their chips show, and the chip for
// the airlines in none.
const ALLIANCE_NAMES = { skyteam: '스카이팀', star: '스타얼라이언스', oneworld: '원월드', none: '항공연합 없음' };

// Names for the airports trips connect at that are not destinations, whose
// names routes.json gives; any other shows its code alone.
const AIRPORT_NAMES = {
  ICN: '인천', GMP: '김포', CJJ: '청주', CJU: '제주', PUS: '부산', TAE: '대구', ITM: '오사카 이타미',
  PVG: '상하이 푸둥', SHA: '상하이 훙차오', PEK: '베이징 서우두', PKX: '베이징 다싱', TSN: '톈진', CAN: '광저우',
  SZX: '선전', XMN: '샤먼', FOC: '푸저우', TAO: '칭다오', TNA: '지난', YNT: '옌타이', WEH: '웨이하이', DLC: '다롄',
  SHE: '선양', HRB: '하얼빈', YNJ: '옌지', CGO: '정저우', NKG: '난징', HGH: '항저우', WUH: '우한', CSX: '창사',
  CTU: '청두 솽류', TFU: '청두 톈푸', CKG: '충칭', KMG: '쿤밍', NNG: '난닝', HAK: '하이커우', SYX: '싼야',
  MNL: '마닐라', CRK: '클라크', CEB: '세부', KUL: '쿠알라룸푸르', BKI: '코타키나발루', SIN: '싱가포르',
  CGK: '자카르타', DPS: '발리', HKT: '푸껫', CNX: '치앙마이', PNH: '프놈펜', VTE: '비엔티안', RGN: '양곤',
  UBN: '울란바토르', HNL: '호놀룰루', ROR: '팔라우',
};

function airportName(code) {
  const name = AIRPORT_NAMES[code] || state.data.places.get(code);
  return name ? `${name}(${code})` : code;
}

// Where a trip connects, from the airports its fare names (`via`): "갈 때
// 상하이 푸둥(PVG), 올 때 타이베이 타오위안(TPE) 경유", or "왕복 ... 경유" for
// the same both ways. Null for a fare that does not say.
function viaLabel(via) {
  if (!via) return null;
  const [out, back] = via.map((airports) => airports.map(airportName).join('·'));
  if (out && out === back) return `왕복 ${out} 경유`;
  const ways = [out && `갈 때 ${out}`, back && `올 때 ${back}`].filter(Boolean);
  return ways.length ? `${ways.join(', ')} 경유` : null;
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

function link(href, text, cls) {
  return el('a', { href, target: '_blank', rel: 'noopener', class: cls }, text);
}

const state = {
  data: null,
  party: DEFAULT_PARTY,
  nights: new Set(),
  cities: new Set(),
  alliances: new Set(),
  airlines: new Set(),
  trips: [],
  shown: PAGE_SIZE,
};

function readFilter() {
  const { data } = state;
  const month = $('month').value;
  const budget = Number($('budget').value);
  return {
    from: month === 'all' ? data.today : `${month}-01`,
    to: month === 'all' ? null : lastDayOfMonth(month),
    nights: state.nights.size ? state.nights : null,
    maxPrice: budget > 0 ? budget * 10000 : null,
    origins: $('origin').value === 'all' ? null : new Set([$('origin').value]),
    cities: state.cities.size ? state.cities : null,
    alliances: state.alliances.size ? state.alliances : null,
    airlines: state.airlines.size ? state.airlines : null,
    party: { people: Number($('people').value), bags: Number($('bags').value) },
  };
}

// The line under a price that says what it adds for checked bags,
// "왕복 위탁수하물 가격 약 90,000원 포함", with the number of bags when it is
// more than one, and 추가 when they come on top of bags the fare includes.
// The amount keeps to one line, so a narrow column breaks the line after 가격.
function bagLine(bag) {
  const bags = `${bag.included ? '추가 ' : ''}위탁수하물${bag.count > 1 ? ` ${bag.count}개` : ''}`;
  if (bag.unknown) return `${bags} 요금 미확인`;
  return `왕복 ${bags} 가격 ${bag.approx ? '약\u00a0' : ''}${won(bag.amount)}\u00a0포함`;
}

// Where a trip connects: "갈 때 경유", "올 때 경유" or "왕복 경유", or
// nothing for one nonstop both ways.
function stopsLabel([out, back]) {
  if (out && back) return '왕복 경유';
  if (out) return '갈 때 경유';
  return back ? '올 때 경유' : null;
}

function tripRow(trip) {
  const { data } = state;
  const route = data.byId.get(trip.route);
  const stops = stopsLabel(trip.stops);
  const morning = trip.lands > trip.return ? '다음 날 오전 도착' : '오전 도착';
  // A mark that says more on hover gives it as its title.
  const badges = [
    trip.alliance && el('span', { class: 'badge badge-alliance' }, ALLIANCE_NAMES[trip.alliance]),
    stops && el('span', { class: 'badge badge-stops', title: viaLabel(trip.fare.via) }, stops),
    ...trip.holidays.map((name) => el('span', { class: 'badge badge-holiday' }, name)),
    trip.morningArrival && el('span', { class: 'badge', title: `${trip.fare.arrives} 도착` }, morning),
  ];
  const price = el('div', { class: 'price' },
    el('strong', null, won(trip.total)),
    trip.bag.count > 0 && el('small', { class: 'bag-fee' }, bagLine(trip.bag)),
    el('span', null, airlineName(trip.airline)));
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
      searchLinks(route, trip.depart, trip.return, {
        airline: trip.airline, people: state.party.people, nonstop: !stops, marker: data.marker,
      }).map((l) => link(l.url, l.name))));
}

function renderTrips() {
  const { data, trips, party } = state;
  $('summary').textContent = trips.length
    ? `조건에 맞는 일정 ${trips.length.toLocaleString('ko-KR')}개 · `
      + `${party.people}명·위탁수하물 ${party.bags ? `${party.bags}개` : '없음'} 기준`
    : '';
  $('price-head').textContent = `${party.people}인 왕복`;

  const list = $('trips');
  list.replaceChildren(...trips.slice(0, state.shown).map(tripRow));
  if (trips.length === 0) {
    list.append(el('li', { class: 'empty' }, data.fareCount > 0
      ? '조건에 맞는 일정이 없습니다. 출발 시기나 여행 기간을 넓히거나, 다른 도시나 항공사를 골라 보세요.'
      : '아직 받아 온 운임이 없습니다.'));
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

function renderAlliances() {
  renderChips($('alliances'), '모든 항공연합', state.alliances,
    state.data.alliances.map((alliance) => ({ value: alliance, label: ALLIANCE_NAMES[alliance] })));
}

function renderAirlines() {
  renderChips($('airlines'), '모든 항공사', state.airlines,
    state.data.airlines.map((code) => ({ value: code, label: airlineName(code) })));
}

function update() {
  state.shown = PAGE_SIZE;
  const filter = readFilter();
  state.party = filter.party;
  state.trips = recommend(state.data, filter);
  renderNights();
  renderCities();
  renderAlliances();
  renderAirlines();
  renderTrips();
}

// How many fares there are and when they were fetched, in the viewer's
// time: "실시간 운임 742건 (10.13 06:41 갱신)".
function statusLine(live) {
  if (!live) return '운임을 불러오지 못했습니다.';
  if (!live.updated) return '실시간 운임 미설정';
  const at = new Date(live.updated);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return `실시간 운임 ${live.fares.length.toLocaleString('ko-KR')}건 (${at.getMonth() + 1}.${at.getDate()} ${time} 갱신)`;
}

async function main() {
  const [routesDoc, live, holidaysDoc, baggage] = await Promise.all([
    load('data/routes.json'), load('data/live-fares.json'), load('data/holidays.json'), load('data/baggage.json'),
  ]);
  if (!routesDoc) {
    $('status').textContent = 'data/routes.json을 읽지 못했습니다. 파일을 직접 열었다면 README의 로컬 실행 방법을 따라 주세요.';
    return;
  }
  const fares = live?.fares || [];
  const today = localToday();
  const routes = routesOf(routesDoc);
  state.data = {
    routes,
    fares,
    holidays: holidaysDoc?.dates || {},
    baggage,
    today,
    byId: new Map(routes.map((r) => [r.id, r])),
    places: new Map(routes.map((r) => [r.dest, r.city])),
    // The Travelpayouts partner marker the Aviasales links carry, where the fetch was given one.
    marker: live?.marker || null,
    months: fareMonths(fares, today),
    fareCount: fares.filter((f) => f.depart >= today).length,
    airlines: [...new Set(fares.filter((f) => f.depart >= today).map((f) => f.airline))]
      .sort((a, b) => airlineName(a).localeCompare(airlineName(b), 'ko')),
  };
  // The alliances of the airlines with fares, and the chip for those in none if there are any.
  const alliances = new Set(state.data.airlines.map((code) => allianceOf(code) || 'none'));
  state.data.alliances = [...Object.keys(ALLIANCES), 'none'].filter((alliance) => alliances.has(alliance));

  $('status').textContent = statusLine(live);
  $('month').replaceChildren(
    el('option', { value: 'all' }, '전체 기간'),
    ...state.data.months.map((m) => el('option', { value: m }, monthLabel(m))));
  const counts = (from, to, label, picked) => Array.from({ length: to - from + 1 }, (_, i) =>
    el('option', { value: from + i, selected: from + i === picked }, label(from + i)));
  $('people').replaceChildren(...counts(1, MAX_PEOPLE, (n) => `${n}명`, DEFAULT_PARTY.people));
  $('bags').replaceChildren(...counts(0, MAX_BAGS, (n) => (n ? `${n}개` : '없음'), DEFAULT_PARTY.bags));

  for (const id of ['origin', 'month', 'people', 'bags']) $(id).addEventListener('change', update);
  $('budget').addEventListener('input', update);
  $('filters').addEventListener('submit', (event) => event.preventDefault());
  $('more').addEventListener('click', () => {
    state.shown += PAGE_SIZE;
    renderTrips();
  });

  update();
}

main();
