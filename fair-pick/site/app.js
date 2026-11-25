// Draws the page's three views and keeps its polls: home, with the way
// into a poll and to a new one; the form for a new poll, with a Korean
// calendar for dates; and a poll, with the voter's ballot, the results and
// the maker's menu. With an API address in config.js the polls live on the
// API, which api.js calls; without one they live in links, which link.js
// seals and merges, and those that went round in links before the API came
// keep going there. What a poll may hold, how the group's choice is picked,
// what a poll gives to research and the calendar are in ../common/, which
// the API shares.

import { API_BASE, RESEARCH_BASE } from './config.js';
import { createClient } from './api.js';
import { createLinkClient, payloadsIn, randomId } from './link.js';
import {
  WEEKDAYS, dateLabel, dayKind, holidaysThrough, isDate, koreaDate, monthOf, monthWeeks, monthsBetween, shiftMonth,
  toggleAll, weekdayDates,
} from '../common/calendar.js';
import { $, el } from '../common/dom.js';
import * as pollRules from '../common/poll-rules.js';
import { donationOf } from '../common/research.js';
import { decide, mileage, otherRules, pairwise, pick, scoreOf } from '../common/social-choice.js';

const {
  DATE_GRADES, LIMITS, MEH, NO, RESEARCH_IN, RESEARCH_OUT, YES, checkBallot, checkPoll, idProblem, newPinProblem,
  normalizeId, orderOf, pinProblem, pointsOf, weakPin,
} = pollRules;

// Where this browser keeps, for each poll it has been in, the token the
// PIN unlocked, the PIN, the maker's admin key, the keys of the ballots
// cast from it and the grades they were last sent with, which no one is
// told until the poll closes, whether each kept the poll out of research,
// as voters could until the page told them that voting goes along, and on
// the maker's device what went to research:
// { [id]: { token, pin, adminKey, keys, mine, optOut, current, title, kind, seen, donation } },
// `donation` { id, key, sent, failed, withdrawn }.
const STORE_KEY = 'fair-pick.polls';

// Where this browser keeps, when polls live in links, each poll it has by
// group ID: { uid, key, state }.
const LINKS_KEY = 'fair-pick.links';

// How many months past this one the calendar goes.
const MONTHS_AHEAD = 12;

const KIND_NAMES = { date: '날짜 투표', choice: '장소·메뉴 투표' };
const CHOICE_EXAMPLES = ['예: 삼겹살집', '예: 횟집', '예: 중식당'];

let linkMemory = null;
const linkStorage = {
  read() {
    try {
      const raw = localStorage.getItem(LINKS_KEY);
      return raw === null ? linkMemory : JSON.parse(raw);
    } catch {
      return linkMemory;
    }
  },
  write(polls) {
    linkMemory = polls;
    try {
      localStorage.setItem(LINKS_KEY, JSON.stringify(polls));
    } catch {
      // `linkMemory` keeps them as long as the page.
    }
  },
};

// Whether this device keeps the poll `id` in links.
function keptInLinks(id) {
  return Boolean(linkStorage.read()?.[id]);
}

// Whether the page at `url` keeps its poll in links though there is an
// API: one a link brings, one waiting for its group ID and PIN, or one
// this device keeps in links. So the polls that went round in links before
// the API keep going there, each page of theirs loading on its own, while
// home and every new poll go to the API.
function linksFor({ search, hash }) {
  if (payloadsIn(hash).length > 0) return true;
  const params = new URLSearchParams(search);
  if (params.has('new')) return false;
  if (params.has('join')) return true;
  return params.has('g') && keptInLinks(normalizeId(params.get('g')));
}

// Polls live on the API when config.js names one, and in links otherwise,
// as do those of the pages linksFor names.
const LINKS = !API_BASE || linksFor(location);

const linkClient = () => createLinkClient({ rules: { ...pollRules, isDate }, decide, storage: linkStorage });
const api = LINKS ? linkClient() : createClient(API_BASE);

const pad = (n) => String(n).padStart(2, '0');

const state = {
  holidays: {},
  through: null,
  today: koreaDate(),
  route: { view: 'home' },
  // The form for a new poll.
  kind: 'date',
  month: null,
  picked: new Set(),
  choices: ['', ''],
  // The poll shown, its ballots and when they were loaded, and the ballot
  // being filled in: { pollId, ballotId, count, name, grades, order }, as
  // ensureDraft makes it. It outlives a reload of the poll, so what the
  // voter has picked stays picked.
  poll: null,
  ballots: [],
  loadedAt: 0,
  draft: null,
  justMade: false,
  flash: '',
  // In link mode: a link's payload waiting for its group ID and PIN, the
  // link that carries this device's poll, the names cast from more than one
  // phone, and what to say once the poll shows.
  pending: null,
  link: '',
  sameNames: [],
  notice: '',
};

// What this browser keeps. Without storage it lasts as long as the page.
let memory = {};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === null) return memory;
    const store = JSON.parse(raw);
    return store && typeof store === 'object' && !Array.isArray(store) ? store : memory;
  } catch {
    return memory;
  }
}

function saveStore(store) {
  memory = store;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // `memory` keeps it.
  }
}

function entryOf(id) {
  return loadStore()[id] || null;
}

function updateEntry(id, patch) {
  const store = loadStore();
  store[id] = { ...(store[id] || {}), ...patch, seen: Date.now() };
  saveStore(store);
  return store[id];
}

function forgetEntry(id) {
  const store = loadStore();
  delete store[id];
  saveStore(store);
}

function authOf(entry) {
  return { token: entry?.token || '', adminKey: entry?.adminKey || '' };
}

function say(id, text = '', ok = false) {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('ok', ok);
}

// Runs `task` while `button` says it is busy, and not again until it is done.
async function withBusy(button, task) {
  if (button.getAttribute('aria-busy') === 'true') return undefined;
  button.setAttribute('aria-busy', 'true');
  try {
    return await task();
  } finally {
    button.removeAttribute('aria-busy');
  }
}

// Draws `container` again with `draw`, and puts the focus back on what had
// it, found by its data-focus, or on `fallback` when that is gone.
function keepFocus(container, draw, fallback) {
  const had = container.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
  draw();
  if (!had) return;
  const again = container.querySelector(`[data-focus="${CSS.escape(had)}"]`);
  const target = again && !again.disabled ? again : fallback?.();
  target?.focus();
}

const copyTimers = new WeakMap();

// Copies `text` and says so on `button` for a moment.
async function copyText(text, button) {
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const area = el('textarea', { class: 'offscreen', readonly: true, 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
  }
  button.textContent = ok ? '복사했어요' : '복사 실패';
  clearTimeout(copyTimers.get(button));
  copyTimers.set(button, setTimeout(() => {
    button.textContent = label;
  }, 1500));
}

const TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit',
});

function timeText(iso) {
  return TIME.format(new Date(iso));
}

function thisYear() {
  return Number(state.today.slice(0, 4));
}

// What option `index` of `poll` says, and for a date how the calendar
// marks it and the holiday it is.
function optionOf(poll, index) {
  const option = poll.options[index];
  if (poll.kind !== 'date') return { text: option.label, mark: '', holiday: null };
  return {
    text: dateLabel(option.date, thisYear()),
    mark: dayKind(option.date, state.holidays),
    holiday: state.holidays[option.date] || null,
  };
}

function optionNode(poll, index, tag = 'span') {
  const { text, mark, holiday } = optionOf(poll, index);
  return [el(tag, { class: `opt ${mark}` }, text), holiday && el('span', { class: 'tag holiday' }, holiday)];
}

// --- Views -----------------------------------------------------------------

function readRoute() {
  const params = new URLSearchParams(location.search);
  if (params.has('new')) return { view: 'create' };
  if (params.has('join')) return { view: 'poll', join: true };
  if (params.has('g')) return { view: 'poll', id: normalizeId(params.get('g')) };
  return { view: 'home' };
}

function navigate(search, { replace = false } = {}) {
  const url = search || location.pathname;
  // A page that keeps its poll the other way loads on its own.
  if (API_BASE && linksFor(new URL(url, location.href)) !== LINKS) {
    location[replace ? 'replace' : 'assign'](url);
    return;
  }
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  show();
}

function show() {
  state.route = readRoute();
  const { view } = state.route;
  for (const name of ['home', 'create', 'poll']) $(`view-${name}`).hidden = name !== view;
  if (view === 'home') showHome();
  else if (view === 'create') showCreate();
  else showPoll(state.route.id);
  window.scrollTo(0, 0);
}

// --- Home ------------------------------------------------------------------

function showHome() {
  document.title = '모임 투표';
  say('home-message', state.flash, true);
  state.flash = '';
  say('enter-message');
  const entries = Object.entries(loadStore())
    .filter(([, entry]) => entry.token || entry.adminKey)
    .sort(([, a], [, b]) => (b.seen || 0) - (a.seen || 0));
  $('recent-section').hidden = entries.length === 0;
  $('recent').replaceChildren(...entries.map(([id, entry]) => el('li', null,
    el('a', { href: `?g=${encodeURIComponent(id)}`, 'data-nav': true },
      el('strong', null, entry.title || id),
      el('span', null, `${KIND_NAMES[entry.kind] || '투표'} · ${id}`)))));
}

async function onEnter(event) {
  event.preventDefault();
  const id = normalizeId($('enter-id').value);
  const pin = $('enter-pin').value.trim();
  const problem = idProblem(id) || pinProblem(pin);
  if (problem) {
    say('enter-message', problem);
    return;
  }
  say('enter-message');
  await withBusy($('enter-submit'), async () => {
    try {
      // A poll this device keeps in links from before the API opens there.
      const data = await (!LINKS && keptInLinks(id) ? linkClient() : api).enter(id, pin);
      updateEntry(id, { token: data.token, pin, title: data.poll.title, kind: data.poll.kind });
      $('enter-pin').value = '';
      take(data);
      navigate(`?g=${encodeURIComponent(id)}`);
    } catch (error) {
      say('enter-message', error.message);
    }
  });
}

// --- A new poll ------------------------------------------------------------

function showCreate() {
  document.title = '새 투표 · 모임 투표';
  state.today = koreaDate();
  for (const date of [...state.picked]) if (date < state.today) state.picked.delete(date);
  const first = monthOf(state.today);
  if (!state.month || monthsBetween(first, state.month) < 0) state.month = first;
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16);
  $('deadline-input').min = now;
  renderKind();
  renderPicker();
  renderPicked();
  renderChoices();
}

function renderKind() {
  for (const radio of document.querySelectorAll('input[name="kind"]')) radio.checked = radio.value === state.kind;
  $('dates-fieldset').hidden = state.kind !== 'date';
  $('choices-fieldset').hidden = state.kind === 'date';
  // Only a date poll may go to research, and only when the page has somewhere to send it.
  $('research-fieldset').hidden = !RESEARCH_BASE || state.kind !== 'date';
}

function moveMonth(step) {
  const first = monthOf(state.today);
  const next = shiftMonth(state.month, step);
  const offset = monthsBetween(first, next);
  if (offset < 0 || offset > MONTHS_AHEAD) return;
  state.month = next;
  keepFocus($('picker'), renderPicker, () => $('picker').querySelector('.cal-nav:not(:disabled)'));
}

function pickDates(next) {
  if (next.size > LIMITS.options.date) {
    say('create-message', `날짜는 ${LIMITS.options.date}개까지 고를 수 있어요.`);
    return;
  }
  say('create-message');
  state.picked = next;
  keepFocus($('picker'), renderPicker);
  renderPicked();
}

function pickDate(iso) {
  const next = new Set(state.picked);
  if (next.has(iso)) next.delete(iso);
  else next.add(iso);
  pickDates(next);
}

// The short name a holiday goes by in a calendar cell.
function shortHoliday(name) {
  return name.replace(' 대체공휴일', ' 대체').replace(' 연휴', '');
}

function renderPicker() {
  const at = state.month;
  const offset = monthsBetween(monthOf(state.today), at);
  const prefix = `${at.year}-${pad(at.month)}`;
  const head = el('div', { class: 'cal-head' },
    el('button', {
      type: 'button', class: 'cal-nav', 'aria-label': '이전 달', 'data-focus': 'prev', disabled: offset <= 0,
      onclick: () => moveMonth(-1),
    }, '‹'),
    el('strong', { 'aria-live': 'polite' }, `${at.year}년 ${at.month}월`),
    el('button', {
      type: 'button', class: 'cal-nav', 'aria-label': '다음 달', 'data-focus': 'next', disabled: offset >= MONTHS_AHEAD,
      onclick: () => moveMonth(1),
    }, '›'));

  const weekdays = WEEKDAYS.map((name, weekday) => {
    const cls = `cal-wd${weekday === 0 ? ' sun' : weekday === 6 ? ' sat' : ''}`;
    const dates = weekdayDates(at.year, at.month, weekday, state.today);
    if (dates.length === 0) return el('span', { class: cls }, name);
    const all = dates.every((date) => state.picked.has(date));
    return el('button', {
      type: 'button', class: cls, 'data-focus': `wd:${weekday}`,
      'aria-label': `${at.month}월의 ${name}요일 ${all ? '모두 빼기' : '모두 고르기'}`,
      onclick: () => pickDates(toggleAll(state.picked, dates)),
    }, name);
  });

  const days = monthWeeks(at.year, at.month).flat().map((iso) => {
    if (!iso) return el('span', { class: 'cal-blank', 'aria-hidden': 'true' });
    const holiday = state.holidays[iso];
    const picked = state.picked.has(iso);
    return el('button', {
      type: 'button',
      class: `cal-day ${dayKind(iso, state.holidays)}${picked ? ' picked' : ''}${iso === state.today ? ' today' : ''}`,
      'aria-pressed': String(picked),
      'aria-label': `${dateLabel(iso, 0)}${holiday ? `, ${holiday}` : ''}${iso === state.today ? ', 오늘' : ''}`,
      'data-focus': iso,
      'data-date': iso,
      disabled: iso < state.today,
      onclick: () => pickDate(iso),
    }, el('span', { class: 'day-num' }, String(Number(iso.slice(8)))),
    holiday && el('span', { class: 'day-note', 'aria-hidden': 'true' }, shortHoliday(holiday)));
  });

  const holidays = Object.entries(state.holidays).filter(([date]) => date.startsWith(prefix));
  const unknown = state.through !== null && `${prefix}-01` > state.through;
  const note = holidays.length
    ? el('p', { class: 'cal-holidays' }, '이 달의 공휴일: ', holidays.map(([date, name], i) => [
      i ? ', ' : '', el('b', null, `${Number(date.slice(8))}일`), ` ${name}`]))
    : unknown && el('p', { class: 'cal-holidays' }, '이 달의 공휴일은 아직 발표되지 않아 표시하지 않았어요.');
  $('picker').replaceChildren(head, el('div', { class: 'cal-grid' }, weekdays, days), note || '');
}

function renderPicked() {
  const dates = [...state.picked].sort();
  $('picked-count').textContent = dates.length
    ? `${dates.length}개 골랐어요. (최대 ${LIMITS.options.date}개)`
    : '아직 고른 날짜가 없어요.';
  $('picked-list').replaceChildren(...dates.map((iso, i) => el('li', null,
    el('button', {
      type: 'button', 'data-focus': `chip:${iso}`, 'aria-label': `${dateLabel(iso, 0)} 빼기`,
      onclick: () => {
        const neighbour = dates[i + 1] || dates[i - 1];
        state.picked.delete(iso);
        renderPicker();
        renderPicked();
        const next = neighbour && $('picked-list').querySelector(`[data-focus="chip:${neighbour}"]`);
        (next || $('picker').querySelector('.cal-day:not(:disabled)'))?.focus();
      },
    }, el('span', { class: dayKind(iso, state.holidays) }, dateLabel(iso, thisYear())),
    el('span', { class: 'x', 'aria-hidden': 'true' }, '×')))));
}

function renderChoices() {
  $('choice-list').replaceChildren(...state.choices.map((value, i) => el('li', null,
    el('input', {
      type: 'text', value, maxlength: LIMITS.label, placeholder: CHOICE_EXAMPLES[i] || '후보', autocomplete: 'off',
      'aria-label': `후보 ${i + 1}`, 'data-focus': `choice:${i}`,
      oninput: (event) => {
        state.choices[i] = event.target.value;
      },
    }),
    el('button', {
      type: 'button', class: 'ghost remove', 'aria-label': `후보 ${i + 1} 빼기`,
      disabled: state.choices.length <= LIMITS.minOptions,
      onclick: () => {
        state.choices.splice(i, 1);
        renderChoices();
        $('choice-list').querySelector(`[data-focus="choice:${Math.min(i, state.choices.length - 1)}"]`)?.focus();
      },
    }, '빼기'))));
  $('add-choice').disabled = state.choices.length >= LIMITS.options.choice;
}

function addChoice() {
  if (state.choices.length >= LIMITS.options.choice) return;
  state.choices.push('');
  renderChoices();
  $('choice-list').querySelector(`[data-focus="choice:${state.choices.length - 1}"]`)?.focus();
}

function randomPin() {
  const digits = new Uint32Array(6);
  let pin;
  do {
    crypto.getRandomValues(digits);
    pin = [...digits].map((digit) => digit % 10).join('');
  } while (weakPin(pin));
  $('pin-input').value = pin;
}

function resetCreate() {
  $('create-form').reset();
  state.kind = 'date';
  state.picked = new Set();
  state.choices = ['', ''];
  state.month = null;
}

async function onCreate(event) {
  event.preventDefault();
  const deadline = $('deadline-input').value;
  const input = {
    kind: state.kind,
    title: $('title-input').value,
    note: $('note-input').value,
    options: state.kind === 'date' ? [...state.picked].sort() : state.choices,
    deadline: deadline ? `${deadline.length === 16 ? `${deadline}:00` : deadline}+09:00` : null,
    research: Boolean(RESEARCH_BASE) && state.kind === 'date' && $('research-input').checked,
  };
  const id = normalizeId($('id-input').value);
  const pin = $('pin-input').value.trim();
  const problem = checkPoll(input).problem || idProblem(id) || newPinProblem(pin)
    // Its pages would open the poll this device keeps in links.
    || (!LINKS && keptInLinks(id) && '이 기기에 같은 그룹 ID의 투표가 있어요. 다른 ID를 정해 주세요.');
  if (problem) {
    say('create-message', problem);
    return;
  }
  say('create-message');
  await withBusy($('create-submit'), async () => {
    try {
      const data = await api.create({ ...input, id, pin });
      updateEntry(data.poll.id, {
        token: data.token, adminKey: data.adminKey, pin, title: data.poll.title, kind: data.poll.kind,
      });
      take(data);
      markUnsent(data.poll.id, 'made');
      state.justMade = true;
      resetCreate();
      navigate(`?g=${encodeURIComponent(data.poll.id)}`);
    } catch (error) {
      say('create-message', error.message);
      if (error.body?.field === 'id') $('id-input').focus();
      else if (error.body?.field === 'pin') $('pin-input').focus();
    }
  });
}

// --- A poll ----------------------------------------------------------------

function take(data) {
  state.poll = data.poll;
  state.ballots = data.ballots;
  state.sameNames = data.sameNames || [];
  state.loadedAt = Date.now();
  state.link = '';
}

// After a change kept in links, what the send box asks for until it is
// sent: 'made' for the invitation, 'changed' for the link.
function markUnsent(id, why) {
  if (LINKS) updateEntry(id, { unsent: why });
}

function showPoll(id) {
  say('poll-message');
  say('vote-message');
  $('poll-id').textContent = id || '';
  $('poll-id-wrap').hidden = !id;
  $('poll-kind').textContent = '';
  $('poll-note').hidden = true;
  $('poll-status').textContent = '';
  if (state.route.join) {
    showJoin();
    return;
  }
  const problem = idProblem(id);
  if (problem) {
    $('poll-title').textContent = '없는 투표 주소예요';
    $('gate-form').hidden = true;
    $('poll-body').hidden = true;
    say('poll-message', problem);
    return;
  }
  const entry = entryOf(id);
  $('poll-title').textContent = entry?.title || id;
  document.title = `${entry?.title || id} · 모임 투표`;
  if (!entry?.token && !entry?.adminKey) {
    if (LINKS) missing();
    else showGate();
    return;
  }
  if (state.poll?.id === id && Date.now() - state.loadedAt < 5000) {
    renderPoll();
    return;
  }
  if (state.poll?.id !== id) {
    state.poll = null;
    state.draft = null;
  }
  $('gate-form').hidden = true;
  $('poll-body').hidden = !state.poll;
  refresh();
}

function showGate(message = '', { askId = false } = {}) {
  $('gate-form').hidden = false;
  $('poll-body').hidden = true;
  $('gate-id-field').hidden = !askId;
  $('gate-title').textContent = askId ? '그룹 ID와 PIN을 넣고 열기' : 'PIN을 넣고 들어가기';
  $('gate-pin').value = '';
  say('gate-message', message);
}

// In link mode, a poll this device does not keep: only a link brings it.
function missing(message = '이 기기에 없는 투표예요. 단톡방에서 받은 투표 링크를 열어 주세요.') {
  $('gate-form').hidden = true;
  $('poll-body').hidden = true;
  say('poll-message', message);
}

// A link's poll new to this device, which its group ID and PIN open.
function showJoin() {
  document.title = '받은 투표 열기 · 모임 투표';
  $('poll-title').textContent = '받은 투표 열기';
  if (state.pending) showGate('', { askId: true });
  else missing('받은 투표 링크를 다시 열어 주세요.');
}

// After an answer that the poll is gone or the token no longer opens it.
function signedOut(error) {
  forgetEntry(state.route.id);
  state.poll = null;
  state.draft = null;
  if (LINKS) missing(error.message);
  else showGate(error.message);
}

async function onGate(event) {
  event.preventDefault();
  const joining = LINKS && state.route.join;
  const id = joining ? normalizeId($('gate-id').value) : state.route.id;
  const pin = $('gate-pin').value.trim();
  const problem = (joining && idProblem(id)) || pinProblem(pin);
  if (problem) {
    say('gate-message', problem);
    return;
  }
  say('gate-message');
  await withBusy($('gate-submit'), async () => {
    try {
      const data = joining ? await api.open(state.pending, id, pin) : await api.enter(id, pin);
      const pollId = data.poll.id;
      updateEntry(pollId, { token: data.token, pin, title: data.poll.title, kind: data.poll.kind });
      $('gate-pin').value = '';
      $('gate-id').value = '';
      take(data);
      if (!joining) {
        renderPoll();
        return;
      }
      state.pending = null;
      state.notice = '투표를 열었어요. 이름을 걸고 투표한 뒤, 나오는 링크를 단톡방에 올려 주세요.';
      navigate(`?g=${encodeURIComponent(pollId)}`, { replace: true });
    } catch (error) {
      say('gate-message', error.message);
    }
  });
}

async function refresh() {
  const { id } = state.route;
  if (!state.poll) $('poll-status').textContent = '불러오는 중…';
  try {
    const data = await api.load(id, authOf(entryOf(id)));
    if (state.route.view !== 'poll' || state.route.id !== id) return;
    take(data);
    renderPoll();
  } catch (error) {
    if (state.route.view !== 'poll' || state.route.id !== id) return;
    if (error.status === 401) {
      signedOut(error);
      return;
    }
    if (!state.poll) $('poll-status').textContent = '';
    say('poll-message', error.message);
  }
}

// Draws the poll; `quiet` keeps what the page last said, as when the
// holidays arrive after the poll did.
function renderPoll({ quiet = false } = {}) {
  $('gate-form').hidden = true;
  $('poll-body').hidden = false;
  if (!quiet) {
    say('poll-message');
    say('vote-message');
  }
  if (state.notice) {
    say('poll-message', state.notice, true);
    state.notice = '';
  }
  updateEntry(state.poll.id, { title: state.poll.title, kind: state.poll.kind });
  renderHeader();
  renderDecision();
  renderResearch();
  renderSend();
  renderShare();
  renderBallot();
  renderResults();
  renderCloseRow();
  renderVoters();
  renderAdmin();
  if (LINKS) updateLink();
  if (state.poll.closedAt) syncResearch();
}

function renderHeader() {
  const { poll, ballots } = state;
  document.title = `${poll.title} · 모임 투표`;
  $('poll-kind').textContent = ` · ${KIND_NAMES[poll.kind]}`;
  $('poll-id').textContent = poll.id;
  $('poll-title').textContent = poll.title;
  $('poll-note').textContent = poll.note;
  $('poll-note').hidden = !poll.note;
  const bits = [`${ballots.length}명 투표`];
  if (poll.closedAt) bits.unshift('마감됨');
  else if (poll.deadline) bits.push(`${timeText(poll.deadline)} 마감`);
  else bits.push(LINKS ? '만든 사람이 마감할 때까지' : '누군가 마감할 때까지');
  $('poll-status').textContent = bits.join(' · ');
}

function renderDecision() {
  const { poll, ballots } = state;
  const box = $('decision');
  box.hidden = !poll.closedAt;
  if (!poll.closedAt) return;
  // A wheel that is turning is left alone until it rests.
  if (roulette.turning) return;
  if (!poll.decision) {
    box.className = 'decision none';
    box.replaceChildren(
      el('span', { class: 'label' }, `${timeText(poll.closedAt)} 마감`),
      el('p', null, '아무도 투표하지 않은 채 마감되어 정하지 못했어요.'));
    return;
  }
  const { index, tied, drawn, pending } = poll.decision;
  if (pending) {
    // On the API, which draws, anyone with the PIN spins; in links only the
    // maker's phone, which draws itself.
    const spins = !LINKS || Boolean(entryOf(poll.id)?.adminKey);
    box.className = 'decision none';
    box.replaceChildren(
      el('span', { class: 'label' }, `${timeText(poll.closedAt)} 마감 · ${ballots.length}명 투표`),
      el('strong', null, `공동 1위 ${tied.length}개`),
      el('p', null, spins
        ? '가운데 시작을 누르면 룰렛이 돌고, 멈춤을 누르면 그때 속도에서 서서히 멈추며 하나가 뽑혀요. 한 번 뽑힌 결과는 바뀌지 않아요.'
        : '투표를 만든 사람이 공동 1위를 룰렛에 올려 돌리면 정해져요.'),
      wheelOf(tied, { spin: spins }),
      el('p', { class: 'message', id: 'wheel-message', role: 'alert' }));
    return;
  }
  const { text, holiday } = optionOf(poll, index);
  // How the rule picked it, from the ballots it was decided by.
  const picked = pick(poll.kind, ballots, poll.options.length);
  // Who said they cannot come on the day picked, named for all to see.
  const absent = poll.kind === 'date' ? ballots.filter((ballot) => ballot.grades?.[index] === NO) : [];
  box.className = 'decision';
  box.replaceChildren(
    el('span', { class: 'label' }, `${timeText(poll.closedAt)} 마감 · ${ballots.length}명 투표 · 결정`),
    el('strong', { id: 'decided' }, holiday ? `${text} · ${holiday}` : text),
    el('p', null, drawn
      ? `공동 1위 ${tied.length}개를 룰렛에 올려 뽑았어요.`
      : reason(picked, index)),
    poll.kind === 'date' && (absent.length > 0
      ? el('div', { class: 'absent', id: 'absent' },
        el('span', { class: 'absent-head' }, `불참 ${absent.length}명`),
        el('span', { class: 'absent-names' }, absent.map((ballot) => ballot.name).join(', ')),
        el('small', null, '이날 ✕ 못 가요로 답한 사람이에요.'))
      : el('p', { class: 'all-in' }, '투표한 사람 모두 이날 올 수 있어요.')),
    drawn && wheelOf(tied, { winner: index }));
}

// --- Research ----------------------------------------------------------------

// A closed date poll whose maker asked, and whose voters went along by
// voting once told so, goes to research from its maker's device, without names
// (../common/research.js): once, again when a link brings a later ballot,
// and not after the maker takes it back. The page says which, and on the
// other devices only whether it goes.

let sendingResearch = false;

// The record the poll gives, or null when it gives none yet.
function researchRecord() {
  const { poll, ballots } = state;
  if (!poll.closedAt || poll.kind !== 'date' || poll.research !== 'ok') return null;
  if (!ballots.every((ballot) => Array.isArray(ballot.grades))) return null;
  return donationOf({ options: poll.options, ballots }, state.holidaysLoaded ? state.holidays : null);
}

async function syncResearch({ retry = false } = {}) {
  const { poll } = state;
  const entry = entryOf(poll.id);
  if (!RESEARCH_BASE || !entry?.adminKey || !state.holidaysTried || sendingResearch) return;
  const record = researchRecord();
  const donation = entry.donation || { id: randomId(18), key: randomId(18) };
  const text = record && JSON.stringify(record);
  if (!record || donation.withdrawn || donation.sent === text || (donation.failed && !retry)) return;
  sendingResearch = true;
  let failed = false;
  try {
    const res = await fetch(`${RESEARCH_BASE}/donations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: donation.id, key: donation.key, record }),
    });
    failed = !res.ok;
  } catch {
    failed = true;
  }
  sendingResearch = false;
  updateEntry(poll.id, { donation: failed ? { ...donation, failed: true } : { ...donation, sent: text, failed: false } });
  if (state.poll?.id === poll.id) renderResearch();
}

async function withdrawResearch(button) {
  const { poll } = state;
  const donation = entryOf(poll.id)?.donation;
  if (!donation?.sent) return;
  await withBusy(button, async () => {
    try {
      const res = await fetch(`${RESEARCH_BASE}/donations/${encodeURIComponent(donation.id)}`, {
        method: 'DELETE', headers: { 'x-donation-key': donation.key },
      });
      if (!res.ok && res.status !== 404) throw new Error(`${res.status}`);
      updateEntry(poll.id, { donation: { ...donation, sent: null, withdrawn: true } });
      renderResearch();
    } catch {
      say('research-message', '지우지 못했어요. 잠시 뒤에 다시 해 주세요.');
    }
  });
}

function renderResearch() {
  const { poll } = state;
  const box = $('research-status');
  box.hidden = !RESEARCH_BASE || !poll.research || !poll.closedAt;
  if (box.hidden) return;
  const entry = entryOf(poll.id) || {};
  const donation = entry.donation || {};
  const line = (text) => el('p', null, text);
  let parts;
  if (poll.research === 'declined') parts = [line('원하지 않은 사람이 있어서 이 투표의 답은 연구용으로 보내지 않아요.')];
  else if (poll.research === 'unasked') parts = [line('연구 안내가 없던 화면에서 한 투표가 있어서, 이 투표의 답은 연구용으로 보내지 않아요.')];
  else if (poll.research === 'few') parts = [line('투표한 사람이 두 명이 안 되어 연구용으로 보내지 않아요.')];
  else if (!entry.adminKey) parts = [line('투표를 만든 사람의 기기가 이름을 뺀 답(○ △ ✕)만 연구용으로 보내요.')];
  else if (donation.withdrawn) parts = [line('연구용으로 보낸 답을 지웠어요. 이 투표는 다시 보내지 않아요.')];
  else if (donation.sent) {
    parts = [
      line('이름을 뺀 답을 연구용으로 보냈어요. 고마워요!'),
      el('details', null, el('summary', null, '보낸 내용 보기'), el('pre', null, donation.sent)),
      el('div', { class: 'actions' }, el('button', {
        type: 'button', class: 'act', onclick: (event) => withdrawResearch(event.currentTarget),
      }, '보낸 기록 지우기')),
    ];
  } else if (donation.failed) {
    parts = [
      line('연구용으로 보내지 못했어요.'),
      el('div', { class: 'actions' }, el('button', {
        type: 'button', class: 'act', onclick: () => syncResearch({ retry: true }),
      }, '다시 보내기')),
    ];
  } else parts = [line('이름을 뺀 답을 연구용으로 보내고 있어요…')];
  box.replaceChildren(...parts, el('p', { class: 'message', id: 'research-message', role: 'alert' }));
}

// --- The roulette ------------------------------------------------------------

// When a closed poll has several options first, its maker spins a roulette
// of them. The button in the middle sets the wheel going; pressed again,
// it asks the API, or in links this phone, to draw one, and the wheel
// slows from the speed it has at a steady deceleration, as friction would
// stop it, picked within a natural range so that it comes to rest on the
// option drawn. The moment it is pressed decides nothing, so nobody can
// aim. Once drawn, anyone may watch the wheel land on it again.

const SVG_NS = 'http://www.w3.org/2000/svg';
const WHEEL = { centre: 150, radius: 138 };

// How the wheel moves, in degrees and seconds: how long it takes to get up
// to speed, the speeds it turns at, and the shortest it takes to stop.
const MOTION = { spinUp: 0.8, slowest: 780, fastest: 1000, stopping: 3.6, replayStopping: 2.6 };

const roulette = {
  // Whether a wheel is turning, which no redraw of the decision stops.
  turning: false,
  // Where each wheel last came to rest, by poll and options, so that one
  // drawn again rests where it stopped.
  rest: new Map(),
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function svg(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value != null && value !== false) node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child);
  return node;
}

// The point at `degrees` clockwise from the top, `radius` from the centre.
function onWheel(degrees, radius) {
  const angle = (degrees * Math.PI) / 180;
  const { centre } = WHEEL;
  return [centre + radius * Math.sin(angle), centre - radius * Math.cos(angle)];
}

// What a slice says of option `index`: a date short, 12/4 (금), and a label
// cut to `most` characters.
function sliceLabel(index, most) {
  const option = state.poll.options[index];
  if (state.poll.kind === 'date') {
    const [, month, day] = option.date.split('-').map(Number);
    return `${month}/${day} (${WEEKDAYS[new Date(`${option.date}T00:00:00Z`).getUTCDay()]})`;
  }
  const chars = [...option.label];
  return chars.length > most ? `${chars.slice(0, Math.max(1, most - 1)).join('')}…` : option.label;
}

// The colour of slice `i` of `count`, never the same as the slice beside it.
function sliceTone(i, count) {
  const tone = i % 6;
  return i === count - 1 && tone === 0 && count > 1 ? 2 : tone;
}

// The slice under the pointer when the wheel is turned `angle` degrees.
function sliceAt(angle, count) {
  const under = ((-angle % 360) + 360) % 360;
  return Math.floor(under / (360 / count)) % count;
}

// The angle at which the wheel rests with the pointer on slice `slot`,
// somewhere inside it rather than on its edge.
function restingAngle(slot, count, inside = 0.18 + Math.random() * 0.64) {
  const under = (slot + inside) * (360 / count);
  return ((-under % 360) + 360) % 360;
}

// A roulette of the options `tied`, with a button for its maker to spin it
// (`spin`), or one for anyone to watch it land on `winner` again.
function wheelOf(tied, { spin = false, winner = null }) {
  const { centre, radius } = WHEEL;
  const count = tied.length;
  const slice = 360 / count;
  const key = `${state.poll.id}:${tied.join(',')}`;
  const slot = winner === null ? -1 : tied.indexOf(winner);
  const angle = roulette.rest.get(key) ?? (slot >= 0 ? restingAngle(slot, count, 0.5) : 0);
  // Labels run round the rim for a few slices and out from the centre for many.
  const along = count <= 8;
  const size = along ? (count <= 3 ? 17 : count <= 5 ? 15 : 13) : (count <= 16 ? 12 : 10);
  const room = along ? (2 * Math.PI * radius * 0.6 * 0.82) / count : radius * 0.62;
  const most = Math.max(2, Math.floor(room / (size * 0.98)));
  const slices = tied.map((index, i) => {
    const from = i * slice;
    const to = (i + 1) * slice;
    const mid = from + slice / 2;
    const [x0, y0] = onWheel(from, radius);
    const [x1, y1] = onWheel(to, radius);
    const path = `M ${centre} ${centre} L ${x0.toFixed(2)} ${y0.toFixed(2)} `
      + `A ${radius} ${radius} 0 ${slice > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
    const at = along ? radius * 0.62 : radius * 0.6;
    const turn = along
      ? `rotate(${mid} ${centre} ${centre})`
      : `rotate(${mid} ${centre} ${centre}) rotate(-90 ${centre} ${centre - at})`;
    return svg('g', { class: `slice slice-${sliceTone(i, count)}${i === slot ? ' won' : ''}`, 'data-slot': i },
      svg('path', { d: path }),
      svg('text', {
        x: centre, y: centre - at, 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: turn,
        'font-size': size,
      }, sliceLabel(index, most)));
  });
  const pegs = tied.map((_, i) => {
    const [x, y] = onWheel(i * slice, radius + 1);
    return svg('circle', { class: 'peg', cx: x.toFixed(2), cy: y.toFixed(2), r: 3.2 });
  });
  const disc = svg('g', { class: 'wheel-disc', transform: `rotate(${angle} ${centre} ${centre})` }, slices,
    svg('circle', { class: 'rim', cx: centre, cy: centre, r: radius + 1 }), pegs);
  const pointer = svg('g', { class: 'wheel-pointer' },
    svg('path', { d: `M ${centre} ${centre - radius + 18} L ${centre - 12} ${centre - radius - 9} L ${centre + 12} ${centre - radius - 9} Z` }));
  const names = tied.map((index) => nameOf(index)).join(', ');
  const picture = svg('svg', { viewBox: '0 0 300 300', class: 'wheel-svg', role: 'img', 'aria-label': `룰렛: ${names}` },
    disc, svg('circle', { class: 'hub', cx: centre, cy: centre, r: radius * 0.2 }), pointer);
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  let button = el('span', { class: 'wheel-button idle', 'aria-hidden': 'true' }, '?');
  if (spin || winner !== null) {
    button = el('button', { type: 'button', class: 'wheel-button', id: 'wheel-button' }, spin ? '시작' : '다시 보기');
  }
  const wrap = el('div', { class: `wheel${winner !== null ? ' drawn' : ''}` },
    el('div', { class: 'wheel-stage' }, picture, button), live);
  const view = { tied, key, disc, pointer, picture, button, live, angle, count };
  if (spin) button.addEventListener('click', () => spinWheel(view));
  else if (winner !== null) button.addEventListener('click', () => replayWheel(view, slot));
  return wrap;
}

// Turns the wheel of `view` to `angle`, ticking the pointer as each peg
// goes by.
function turnWheel(view, angle) {
  const before = sliceAt(view.angle, view.count);
  view.angle = angle;
  view.disc.setAttribute('transform', `rotate(${angle % 360} ${WHEEL.centre} ${WHEEL.centre})`);
  if (sliceAt(angle, view.count) !== before) {
    view.pointer.classList.remove('tick');
    // Reading a box restarts the tick's animation.
    view.pointer.getBoundingClientRect();
    view.pointer.classList.add('tick');
  }
}

// Runs `step` on every frame, with the seconds since it started, until it
// says it is done.
function frames(step) {
  return new Promise((done) => {
    let start = null;
    const next = (time) => {
      if (start === null) start = time;
      if (step((time - start) / 1000)) done();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}

// Spins the wheel up to `top` degrees a second, easing in as a push would.
function spinUp(view, top, seconds) {
  const from = view.angle;
  return frames((t) => {
    const done = t >= seconds;
    const s = Math.min(t, seconds);
    // The angle is the integral of a speed that grows as the square of time.
    turnWheel(view, from + (top * s * s * s) / (3 * seconds * seconds));
    return done;
  }).then(() => from + (top * seconds) / 3);
}

// Slows the wheel from `speed` to rest on slice `slot`, at a steady
// deceleration chosen to stop it there after at least `least` seconds.
function slowDown(view, speed, slot, least) {
  const from = view.angle;
  const target = restingAngle(slot, view.count);
  let travel = (((target - from) % 360) + 360) % 360;
  while (travel < (speed * least) / 2) travel += 360;
  const deceleration = (speed * speed) / (2 * travel);
  const seconds = (2 * travel) / speed;
  return frames((t) => {
    const s = Math.min(t, seconds);
    turnWheel(view, from + speed * s - (deceleration * s * s) / 2);
    return t >= seconds;
  }).then(() => from + travel);
}

// Shows the slice the wheel came to rest on.
function landed(view, slot) {
  for (const node of view.disc.querySelectorAll('.slice')) node.classList.toggle('won', Number(node.dataset.slot) === slot);
  roulette.rest.set(view.key, view.angle % 360);
  view.live.textContent = `당첨: ${nameOf(view.tied[slot])}`;
  navigator.vibrate?.(40);
}

// The maker's spin: up to speed, round and round until the button is
// pressed again, then the draw and the slow stop on what it drew.
async function spinWheel(view) {
  const { poll } = state;
  const { button } = view;
  if (roulette.turning) return;
  roulette.turning = true;
  say('wheel-message');
  const top = MOTION.slowest + Math.random() * (MOTION.fastest - MOTION.slowest);
  const quick = reducedMotion();
  let stopRequested = false;
  let speed = top;
  if (!quick) {
    button.disabled = true;
    button.textContent = '돌리는 중';
    view.live.textContent = '룰렛이 돌아가요.';
    await spinUp(view, top, MOTION.spinUp);
    button.disabled = false;
    button.textContent = '멈춤';
    button.onclick = () => {
      stopRequested = true;
    };
    // Round and round at full speed until the button is pressed.
    const from = view.angle;
    await frames((t) => {
      turnWheel(view, from + top * t);
      return stopRequested;
    });
    button.onclick = null;
    button.disabled = true;
    button.textContent = '멈추는 중';
    view.live.textContent = '멈추는 중이에요.';
  }
  // The wheel keeps turning while the draw is asked for.
  let asked = true;
  const turning = quick ? Promise.resolve() : (() => {
    const from = view.angle;
    return frames((t) => {
      turnWheel(view, from + top * t);
      return !asked;
    });
  })();
  let data = null;
  let failure = null;
  try {
    data = await api.draw(poll.id, authOf(entryOf(poll.id)));
  } catch (error) {
    failure = error;
  }
  asked = false;
  await turning;
  const index = data?.poll.decision?.drawn ? data.poll.decision.index : null;
  const slot = index === null ? Math.floor(Math.random() * view.count) : view.tied.indexOf(index);
  if (quick) {
    turnWheel(view, view.angle + (((restingAngle(slot, view.count) - view.angle) % 360) + 360) % 360);
  } else {
    await slowDown(view, speed, slot, MOTION.stopping);
  }
  roulette.turning = false;
  if (index === null) {
    // Nothing was drawn: the wheel stops where friction takes it, and may go again.
    button.disabled = false;
    button.textContent = '시작';
    say('wheel-message', failure?.message || '결과를 받지 못했어요. 다시 돌려 주세요.');
    if (failure?.status === 401) signedOut(failure);
    else if (failure?.code === 'open' || failure?.code === 'admin') refresh();
    return;
  }
  landed(view, slot);
  if (!quick) await new Promise((wait) => setTimeout(wait, 900));
  markUnsent(poll.id, 'changed');
  state.notice = `룰렛이 ${nameOf(index)}에서 멈췄어요.`;
  take(data);
  renderPoll();
}

// Anyone's look at the wheel landing again on what was drawn.
async function replayWheel(view, slot) {
  if (roulette.turning) return;
  roulette.turning = true;
  view.button.disabled = true;
  if (reducedMotion()) {
    turnWheel(view, view.angle + 360 + (((restingAngle(slot, view.count) - view.angle) % 360) + 360) % 360);
  } else {
    const top = MOTION.slowest;
    await spinUp(view, top, MOTION.spinUp * 0.6);
    await slowDown(view, top, slot, MOTION.replayStopping);
  }
  landed(view, slot);
  roulette.turning = false;
  view.button.disabled = false;
}

// The link to the poll: on the API, its address; in link mode, the link
// that carries everything this device has of it, once it is sealed.
function shareLink(id) {
  return LINKS ? state.link : `${location.origin}${location.pathname}?g=${encodeURIComponent(id)}`;
}

// The link in link mode, sealed now if it is not yet.
async function linkNow() {
  if (!state.link) state.link = `${location.origin}${location.pathname}#${await api.linkOf(state.poll.id)}`;
  return state.link;
}

// Seals the link for the poll shown, and shows it once it is ready.
let linkRun = 0;
async function updateLink() {
  const run = ++linkRun;
  const { id } = state.poll;
  try {
    const link = `${location.origin}${location.pathname}#${await api.linkOf(id)}`;
    if (run !== linkRun || state.poll?.id !== id) return;
    state.link = link;
    renderShareLink();
  } catch {
    // The poll is gone from this device; the next load says so.
  }
}

function inviteText(poll, pin) {
  const how = LINKS
    ? '링크를 열고 그룹 ID와 PIN을 넣은 뒤 이름을 걸고 투표해 주세요. 투표하면 나오는 새 링크를 이 방에 올려 주시면 서로의 투표가 합쳐져요.'
    : '링크를 열고 PIN을 넣은 뒤, 이름을 걸고 투표해 주세요.';
  return [`[모임 투표] ${poll.title}`, how, shareLink(poll.id), `그룹 ID: ${poll.id}`, pin && `PIN: ${pin}`]
    .filter(Boolean).join('\n');
}

// What the send box hands on: the invitation after the poll is made, and
// the link after a change.
function sendText() {
  const { poll, ballots } = state;
  const entry = entryOf(poll.id) || {};
  if (entry.unsent === 'made') return inviteText(poll, entry.pin);
  return [`[모임 투표] ${poll.title} · ${ballots.length}명 투표${poll.closedAt ? ' · 마감' : ''}`, state.link].join('\n');
}

function renderSend() {
  const why = LINKS ? entryOf(state.poll.id)?.unsent : null;
  $('send').hidden = !why;
  if (!why) return;
  const made = why === 'made';
  $('send-title').textContent = made ? '단톡방에 초대해 주세요' : '단톡방에 올려 주세요';
  $('send-text').textContent = made
    ? '투표를 만들었어요. 링크와 그룹 ID, PIN이 든 초대 메시지를 단톡방에 올려 주세요.'
    : '방금 바뀐 내용은 아직 이 기기에만 있어요. 이 링크를 단톡방에 올려야 다른 사람에게도 반영돼요.';
  delete $('send-copy').dataset.label;
  $('send-copy').textContent = made ? '초대 메시지 복사' : '링크 복사';
  $('send-native').hidden = typeof navigator.share !== 'function';
}

// Hides the send box a moment after its text went out.
function sent(id) {
  setTimeout(() => {
    updateEntry(id, { unsent: null });
    if (state.poll?.id === id) renderSend();
  }, 1600);
}

function renderShareLink() {
  const link = shareLink(state.poll.id);
  let shown = link;
  if (LINKS) {
    shown = link ? `${link.slice(0, link.indexOf('#') + 12)}… (${link.length.toLocaleString('ko-KR')}자)` : '링크를 만드는 중…';
  } else {
    // The link as a person reads it; what is copied keeps a Hangul ID encoded.
    try {
      shown = decodeURI(link);
    } catch {
      // Shown encoded.
    }
  }
  $('share-link').textContent = shown;
  $('share-link').href = link || './';
}

function renderShare() {
  const { poll } = state;
  const entry = entryOf(poll.id) || {};
  renderShareLink();
  $('share-id').textContent = poll.id;
  $('share-pin').textContent = entry.pin || '이 기기에 없어요';
  $('share-native').hidden = typeof navigator.share !== 'function';
  if (state.justMade) {
    $('share').open = true;
    state.justMade = false;
  }
}

// The ballot this device is changing, if it still is in the poll.
function currentBallot() {
  const { poll, ballots } = state;
  const entry = entryOf(poll.id) || {};
  const keys = entry.keys || {};
  return ballots.find((ballot) => ballot.id === entry.current && keys[ballot.id]) || null;
}

// The grades this device last sent for ballot `id`, which the page is not
// told before the poll closes, its own no more than anyone's.
function sentGrades(entry, id) {
  const grades = entry?.mine?.[id];
  return Array.isArray(grades) ? grades : null;
}

function ensureDraft() {
  const { poll } = state;
  const count = poll.options.length;
  const mine = currentBallot();
  const want = mine ? mine.id : null;
  const { draft } = state;
  if (draft && draft.pollId === poll.id && draft.ballotId === want && draft.count === count) return draft;
  const had = mine ? mine.grades || sentGrades(entryOf(poll.id), mine.id) : null;
  const fits = Boolean(had) && had.length === count;
  state.draft = {
    pollId: poll.id,
    ballotId: want,
    count,
    name: mine ? mine.name : '',
    // For a date, each date's grade, null until picked; for a choice, the
    // order so far, best first.
    grades: poll.kind === 'date' ? (fits ? [...had] : Array(count).fill(null)) : null,
    order: poll.kind === 'choice' ? (fits ? orderOf(had) : []) : null,
    showMissing: false,
  };
  return state.draft;
}

// The grades of a date ballot as it shows them, ○ first.
const DATE_ORDER = [YES, MEH, NO];

function gradeText(grade) {
  const { short, label } = DATE_GRADES[grade];
  return `${short} ${label}`;
}

function dateRow(index, closed) {
  const { poll, draft } = state;
  const row = el('li', { 'data-index': index, class: draft.showMissing && draft.grades[index] == null ? 'missing' : null });
  row.append(el('fieldset', null,
    el('legend', null, optionNode(poll, index)),
    el('div', { class: 'grades', style: `--count: ${DATE_ORDER.length}` }, DATE_ORDER.map((grade) => el('label', {
      class: `grade tone-${DATE_GRADES[grade].tone}`,
    }, el('input', {
      type: 'radio', name: `grade-${index}`, value: grade, checked: draft.grades[index] === grade, disabled: closed,
      onchange: () => {
        draft.grades[index] = grade;
        row.classList.remove('missing');
        updateLeft();
      },
    }), el('span', null, gradeText(grade)))))));
  return row;
}

// The order a choice ballot gives: the options put in order, and the one
// left, if one is, last; null while more are left.
function fullOrder(draft, count) {
  if (draft.order.length === count) return draft.order;
  if (draft.order.length !== count - 1) return null;
  return [...draft.order, [...Array(count).keys()].find((index) => !draft.order.includes(index))];
}

// An option of a choice ballot: a button that puts it next in the order,
// or takes it out again. The one left once every other is in goes last.
function choiceRow(index, closed) {
  const { poll, draft } = state;
  const count = poll.options.length;
  const place = draft.order.indexOf(index);
  const last = place < 0 && draft.order.length === count - 1;
  const { text } = optionOf(poll, index);
  let label = `${text}, 누르면 ${draft.order.length + 1}위로 넣어요.`;
  if (place >= 0) label = `${text}, ${place + 1}위. 누르면 순위에서 빼요.`;
  else if (last) label = `${text}, 하나 남아서 저절로 ${count}위예요.`;
  return el('li', { 'data-index': index, class: draft.showMissing && place < 0 && !last ? 'missing' : null },
    el('button', {
      type: 'button',
      class: `rank-pick${place >= 0 ? ' ranked' : ''}${last ? ' last' : ''}`,
      'aria-pressed': String(place >= 0),
      'aria-label': label,
      'data-focus': `rank:${index}`,
      disabled: closed || last,
      onclick: () => {
        if (place >= 0) draft.order.splice(place, 1);
        else draft.order.push(index);
        keepFocus($('ballot'), renderBallotRows, () => $('ballot').querySelector('button:not(:disabled)'));
        updateLeft();
      },
    },
    el('span', { class: 'rank-num', 'aria-hidden': 'true' }, place >= 0 ? String(place + 1) : last ? String(count) : ''),
    el('span', { class: 'opt' }, text)));
}

function renderBallotRows() {
  const { poll } = state;
  const closed = Boolean(poll.closedAt);
  const row = poll.kind === 'date' ? dateRow : choiceRow;
  $('ballot').classList.toggle('ranking', poll.kind === 'choice');
  $('ballot').replaceChildren(...poll.options.map((_, index) => row(index, closed)));
}

// What each ○ of the date ballot being filled in weighs: its mileage.
function renderMileage() {
  const { poll, draft } = state;
  const node = $('mileage');
  node.hidden = poll.kind !== 'date' || Boolean(poll.closedAt);
  if (node.hidden) return;
  const count = poll.options.length;
  const now = mileage(draft.grades.map((grade) => grade ?? YES));
  node.replaceChildren(el('strong', null, `내 마일리지 ${percent(now)}`),
    ` · 내 ○ 하나의 무게예요. 100%에서 시작해 ✕ 하나에 1/${count}, △ 하나에 그 절반씩 줄어요.`);
}

function updateLeft() {
  const { poll, draft } = state;
  const mine = currentBallot();
  renderMileage();
  if (poll.closedAt) {
    $('vote-state').textContent = mine
      ? `${mine.name} 님으로 투표했고, 마감되어 더 바꿀 수 없어요.`
      : '마감되어 더 투표할 수 없어요.';
    return;
  }
  if (mine) {
    $('vote-state').textContent = `${mine.name} 님으로 ${timeText(mine.at)}에 투표했어요.`;
    return;
  }
  if (poll.kind === 'date') {
    const left = draft.grades.filter((grade) => grade == null).length;
    $('vote-state').textContent = left ? `날짜 ${draft.grades.length}개 가운데 ${left}개 남았어요.` : '모두 골랐어요.';
    return;
  }
  const left = poll.options.length - draft.order.length;
  $('vote-state').textContent = left > 1 ? `순위를 매길 후보가 ${left}개 남았어요.` : '순위를 모두 매겼어요.';
}

function fillRest(grade) {
  const { draft } = state;
  draft.grades = draft.grades.map((value) => value ?? grade);
  renderBallotRows();
  updateLeft();
}

function resetOrder() {
  state.draft.order = [];
  state.draft.showMissing = false;
  renderBallotRows();
  updateLeft();
  $('ballot').querySelector('button')?.focus();
}

function renderBallot() {
  const { poll } = state;
  const draft = ensureDraft();
  const closed = Boolean(poll.closedAt);
  const mine = currentBallot();
  // A closed poll shows how everyone voted under the results instead.
  $('vote-form').hidden = closed;
  $('voter-name').value = draft.name;
  $('voter-name').disabled = closed;
  $('vote-help').textContent = poll.kind === 'date'
    ? '날짜마다 ○ 좋아요, △ 되긴 해요(올 수는 있지만 다른 날이 좋아요), ✕ 못 가요 가운데 골라 주세요.'
    : '좋은 순서대로 후보를 눌러 주세요. 누른 차례대로 1위, 2위가 되고, 마지막 하나는 저절로 꼴찌가 돼요. 순위가 붙은 후보를 다시 누르면 빠져요.';
  let quick = [];
  if (!closed && poll.kind === 'date') {
    quick = [el('span', null, '안 고른 날 모두'), ...DATE_ORDER.map((grade) => el('button', {
      type: 'button', class: 'ghost', onclick: () => fillRest(grade),
    }, gradeText(grade)))];
  } else if (!closed) {
    quick = [el('button', { type: 'button', class: 'ghost', onclick: resetOrder }, '처음부터 다시 고르기')];
  }
  $('quick-fill').replaceChildren(...quick);
  $('research-note').hidden = closed || !poll.research;
  renderBallotRows();
  $('vote-submit').textContent = mine ? '고치기' : '투표하기';
  $('vote-submit').disabled = closed;
  $('vote-other').hidden = !mine || closed;
  $('vote-remove').hidden = !mine || closed;
  updateLeft();
}

// The grades the ballot being filled in gives, or null after saying what
// is still missing.
function draftGrades() {
  const { poll, draft } = state;
  if (poll.kind === 'date') {
    const missing = draft.grades.findIndex((grade) => grade == null);
    if (missing < 0) return draft.grades;
    draft.showMissing = true;
    for (const row of $('ballot').children) row.classList.toggle('missing', draft.grades[row.dataset.index] == null);
    const count = draft.grades.filter((grade) => grade == null).length;
    say('vote-message', `아직 고르지 않은 날이 ${count}개 있어요.`);
    $('ballot').children[missing].querySelector('input').focus();
    return null;
  }
  const order = fullOrder(draft, poll.options.length);
  if (order) return pointsOf(order);
  draft.showMissing = true;
  renderBallotRows();
  say('vote-message', `아직 순위를 매기지 않은 후보가 ${poll.options.length - draft.order.length}개 있어요.`);
  $('ballot').querySelector('.missing button')?.focus();
  return null;
}

async function onVote(event) {
  event.preventDefault();
  const { poll, draft } = state;
  if (!poll || poll.closedAt) return;
  draft.name = $('voter-name').value;
  const grades = draftGrades();
  if (!grades) return;
  const entry = entryOf(poll.id) || {};
  const changing = draft.ballotId;
  // Voting goes along with research, which the page told the voter of
  // above the ballot; a ballot whose voter kept the poll out, while the
  // page still let them, keeps it out.
  const research = poll.research ? (changing && entry.optOut?.[changing] ? RESEARCH_OUT : RESEARCH_IN) : undefined;
  const checked = checkBallot({ name: draft.name, grades, research }, poll);
  if (checked.problem) {
    say('vote-message', checked.problem);
    $('voter-name').focus();
    return;
  }
  const keys = { ...(entry.keys || {}) };
  await withBusy($('vote-submit'), async () => {
    try {
      const data = await api.vote(
        poll.id,
        { ...authOf(entry), ballotKey: changing ? keys[changing] : '' },
        { ...checked.ballot, ballotId: changing || undefined },
      );
      if (data.ballotKey) keys[data.ballotId] = data.ballotKey;
      const mine = { ...(entry.mine || {}), [data.ballotId]: [...checked.ballot.grades] };
      const optOut = { ...(entry.optOut || {}), [data.ballotId]: checked.ballot.research === RESEARCH_OUT };
      updateEntry(poll.id, { keys, mine, optOut, current: data.ballotId });
      markUnsent(poll.id, 'changed');
      state.draft = null;
      take(data);
      renderPoll();
      say('vote-message', changing
        ? '고쳤어요. 결과는 마감한 뒤에 공개돼요.'
        : '투표했어요. 마감 전에는 언제든 고칠 수 있고, 결과는 마감한 뒤에 공개돼요.', true);
    } catch (error) {
      if (error.status === 401) {
        signedOut(error);
        return;
      }
      if (error.code === 'closed') {
        // Closed meanwhile: the page shows it closed, with the decision.
        await refresh();
        return;
      }
      if (error.code === 'ballot') {
        // Taken out meanwhile by the maker: what was picked becomes a new ballot.
        updateEntry(poll.id, { current: null });
        draft.ballotId = null;
        renderBallot();
        renderVoters();
      }
      say('vote-message', error.message);
      if (error.body?.field === 'name') $('voter-name').focus();
    }
  });
}

function voteAsSomeoneElse() {
  updateEntry(state.poll.id, { current: null });
  state.draft = null;
  say('vote-message');
  renderBallot();
  renderVoters();
  $('voter-name').focus();
}

function editBallot(ballotId) {
  updateEntry(state.poll.id, { current: ballotId });
  state.draft = null;
  say('vote-message');
  renderBallot();
  renderVoters();
  $('vote-title').scrollIntoView({ block: 'start' });
  $('voter-name').focus({ preventScroll: true });
}

async function onRemoveMine() {
  const { poll } = state;
  const mine = currentBallot();
  if (!mine || !window.confirm(`${mine.name} 님의 투표를 지울까요?`)) return;
  const entry = entryOf(poll.id) || {};
  await withBusy($('vote-remove'), async () => {
    try {
      const data = await api.unvote(poll.id, { ...authOf(entry), ballotKey: entry.keys?.[mine.id] }, mine.id);
      const keys = { ...(entry.keys || {}) };
      const sent = { ...(entry.mine || {}) };
      delete keys[mine.id];
      delete sent[mine.id];
      updateEntry(poll.id, { keys, mine: sent, current: null });
      markUnsent(poll.id, 'changed');
      state.draft = null;
      take(data);
      renderPoll();
      say('vote-message', '투표를 지웠어요.', true);
    } catch (error) {
      if (error.status === 401) signedOut(error);
      else say('vote-message', error.message);
    }
  });
}

// `word` with the particle that follows it, the first of `pair` after a
// final consonant and the second after a vowel: 날이, 후보가. Only ㄹ takes
// 로 rather than 으로.
function josa(word, pair) {
  const [consonant, vowel] = pair.split('/');
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const last = code >= 0 && code < 11172 ? code % 28 : 0;
  return word + (last === 0 || (vowel === '로' && last === 8) ? vowel : consonant);
}

// A number with 으로 or 로 as it is read: 영, 삼, 육 and 십 take 으로.
function withRo(number) {
  return `${number}${/[036]$/.test(number) ? '으로' : '로'}`;
}

// What an option is called in a sentence: its label, for a date with its
// holiday.
function nameOf(index) {
  const { text, holiday } = optionOf(state.poll, index);
  return holiday ? `${text} ${holiday}` : text;
}

// Borda points as they read: 6, or 6.5.
function points(n) {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}점`;
}

// A share as it reads: 81%.
function percent(share) {
  return `${Math.round(share * 100)}%`;
}

// A date's preference score as it reads: 1.75.
function scoreText(score) {
  return String(Number(scoreOf(score, state.poll.options.length).toFixed(2)));
}

// Why option `index` was picked, from `picked`, what pick() said.
function reason(picked, index) {
  const { poll } = state;
  const t = picked.tallies[index];
  switch (picked.by) {
    case 'absent':
      return t.absent === 0
        ? '투표한 사람이 모두 올 수 있는 날은 이것뿐이에요.'
        : `못 오는 사람이 ${t.absent}명으로 가장 적어요.`;
    case 'score': {
      const who = t.absent === 0 ? '모두 올 수 있는' : `못 오는 사람이 가장 적은(${t.absent}명)`;
      const among = picked.pool.length === poll.options.length ? '' : `${who} 날 ${picked.pool.length}개 가운데 `;
      return `${among}선호 점수가 ${withRo(scoreText(t.score))} 가장 높아요.`;
    }
    case 'condorcet':
      return '맞대결에서 다른 모든 후보를 이겨요 (콩도르세 승자).';
    case 'borda': {
      const split = picked.cycle ? '맞대결이 서로 물고 물려(콩도르세의 역설)' : '맞대결에서 비겨';
      return `${split} 모두를 이기는 후보가 없어, 보르다 점수로 정했어요. ${points(picked.borda[index])}으로 가장 높아요.`;
    }
    default:
      return poll.decision?.drawn && poll.decision.index === index
        ? '끝까지 같아 공동 1위였고, 룰렛으로 뽑혔어요.'
        : '끝까지 같아 공동 1위예요.';
  }
}

// "2승 1무 1패" for a head-to-head record.
function recordText({ won, drew, lost }) {
  return [`${won}승`, drew > 0 && `${drew}무`, `${lost}패`].filter(Boolean).join(' ');
}

// A bar of `parts`, { tone, n, label }, each as long as its count.
function barOf(parts) {
  return el('div', { class: 'bar', role: 'img', 'aria-label': parts.map(({ label, n }) => `${label} ${n}명`).join(', ') },
    parts.filter(({ n }) => n > 0).map(({ tone, n }) => {
      const part = el('span', { class: `tone-${tone}` });
      part.style.flexGrow = String(n);
      return part;
    }));
}

// An option's row of the results, with no place: the option decided on,
// with why, or one of those the roulette is to pick from, or any other.
function resultRow(t, picked, body, who) {
  const { poll } = state;
  const decided = poll.decision?.index === t.index;
  const spinning = poll.decision?.pending && picked.first.includes(t.index);
  return el('li', { class: `result${decided ? ' first' : ''}` },
    el('div', { class: 'result-body' },
      el('div', { class: 'result-label' }, optionNode(poll, t.index, 'strong'),
        decided && el('span', { class: 'tag decided' }, '결정'),
        spinning && el('span', { class: 'tag' }, '룰렛 후보')),
      body,
      decided && el('p', { class: 'why' }, reason(picked, t.index)),
      el('details', { class: 'who' }, el('summary', null, who.title), who.body)));
}

function dateResult(t, picked) {
  const { ballots } = state;
  const parts = DATE_ORDER.map((grade) => ({ grade, tone: DATE_GRADES[grade].tone, label: DATE_GRADES[grade].label, n: t.counts[grade] }));
  const names = (grade) => ballots.filter((ballot) => ballot.grades[t.index] === grade)
    .map((ballot) => (grade === YES ? `${ballot.name} ${percent(mileage(ballot.grades))}` : ballot.name)).join(', ');
  return resultRow(t, picked, [
    barOf(parts),
    el('p', { class: 'stats' }, `${parts.map(({ grade, n }) => `${DATE_GRADES[grade].short} ${n}`).join(' · ')} · 선호 점수 ${scoreText(t.score)}`),
  ], {
    title: '누가 어떻게 골랐나요',
    body: [
      el('dl', null, parts.filter(({ n }) => n > 0).map(({ grade, tone }) => [
        el('dt', { class: `tone-${tone}` }, gradeText(grade)),
        el('dd', null, names(grade)),
      ])),
      t.counts[YES] > 0 && el('p', { class: 'fine' }, '%는 마일리지, 선호 점수는 ○를 준 사람들의 마일리지 합이에요.'),
    ],
  });
}

// The tone of place `place` of `count`: the first best, the last meh.
function placeTone(place, count) {
  if (place === 0) return 'best';
  if (place === count - 1) return 'meh';
  return place / (count - 1) < 0.5 ? 'good' : 'mid';
}

function choiceResult(t, picked, wins) {
  const { poll, ballots } = state;
  const count = poll.options.length;
  const places = Array.from({ length: count }, (_, place) => ({
    place,
    tone: placeTone(place, count),
    label: `${place + 1}순위`,
    voters: ballots.filter((ballot) => ballot.grades[t.index] === count - 1 - place).map((ballot) => ballot.name),
  })).map((part) => ({ ...part, n: part.voters.length }));
  const duels = picked.tallies.filter((u) => u.index !== t.index).map((u) => {
    const [mine, theirs] = [wins[t.index][u.index], wins[u.index][t.index]];
    const outcome = mine > theirs ? 'won' : mine < theirs ? 'lost' : 'drew';
    return el('li', { class: `duel duel-${outcome}` },
      el('span', null, nameOf(u.index)), ` ${mine} 대 ${theirs} ${{ won: '승', lost: '패', drew: '무' }[outcome]}`);
  });
  const stats = [`1순위 ${t.firsts}명`, `맞대결 ${recordText(t.record)}`, `보르다 ${points(t.total)}`];
  return resultRow(t, picked, [barOf(places), el('p', { class: 'stats' }, stats.join(' · '))], {
    title: '누가 몇 순위로 골랐나요',
    body: [
      el('dl', null, places.filter(({ n }) => n > 0).map(({ label, tone, voters }) => [
        el('dt', { class: `tone-${tone}` }, label),
        el('dd', null, voters.join(', ')),
      ])),
      duels.length > 0 && [el('p', { class: 'duels-title' }, '맞대결 (이 후보를 더 위에 둔 사람 대 상대를 더 위에 둔 사람)'),
        el('ul', { class: 'duels' }, duels)],
    ],
  });
}

// What the page says when majorities give no Condorcet winner at the top:
// the circle they go round, or the draw, and how the rule settles it.
function renderParadox(first, wins) {
  const box = $('paradox');
  box.hidden = first.smith.length < 2;
  if (box.hidden) return;
  if (first.cycle) {
    const circle = [...first.cycle, first.cycle[0]];
    box.replaceChildren(
      el('strong', null, '콩도르세의 역설'),
      el('p', null, '다수결로 둘씩 견주면 후보들이 서로 물고 물려서, 모두를 이기는 후보가 없어요. 화살표는 이긴 쪽에서 진 쪽으로, 숫자는 더 위에 둔 사람 수예요.'),
      el('ol', { class: 'circle' }, circle.slice(0, -1).map((a, i) => {
        const b = circle[i + 1];
        return el('li', null, el('span', null, nameOf(a)), el('span', { class: 'arrow' }, ` ${wins[a][b]}:${wins[b][a]} → `),
          el('span', null, nameOf(b)));
      })),
      el('p', null, `그래서 물고 물린 후보들(${first.smith.length}개) 가운데 보르다 점수가 가장 높은 후보를 골라요. 보르다 점수는 모든 맞대결을 한꺼번에 더하므로, 돌고 도는 부분은 서로 지워집니다.`));
    return;
  }
  box.replaceChildren(
    el('strong', null, '맞대결에서 비김'),
    el('p', null, `맞대결에서 비긴 후보가 있어 모두를 이기는 후보가 없어요. 그래서 맨 위에서 비긴 후보들(${first.smith.length}개) 가운데 보르다 점수가 가장 높은 후보를 골라요.`));
}

function renderResultCalendar(picked) {
  const { poll, ballots } = state;
  const byDate = new Map(poll.options.map((option, index) => [option.date, picked.tallies[index]]));
  const months = [...new Set(poll.options.map((option) => option.date.slice(0, 7)))];
  const voters = ballots.length;
  $('result-cal').replaceChildren(...months.map((ym) => {
    const { year, month } = monthOf(`${ym}-01`);
    return el('div', { class: 'result-month' },
      el('h3', null, `${year}년 ${month}월`),
      el('div', { class: 'cal-grid' },
        WEEKDAYS.map((name, weekday) => el('span', {
          class: `cal-wd${weekday === 0 ? ' sun' : weekday === 6 ? ' sat' : ''}`, 'aria-hidden': 'true',
        }, name)),
        monthWeeks(year, month).flat().map((iso) => {
          if (!iso) return el('span', { class: 'cal-blank', 'aria-hidden': 'true' });
          const kind = dayKind(iso, state.holidays);
          const t = byDate.get(iso);
          if (!t) return el('span', { class: `rc-day ${kind}`, 'aria-hidden': 'true' }, String(Number(iso.slice(8))));
          const can = voters - t.absent;
          const heat = t.counts[YES] === voters ? 3 : t.absent === 0 ? 2 : can * 2 >= voters ? 1 : 0;
          return el('span', {
            class: `rc-day candidate ${kind}${poll.decision?.index === t.index ? ' top' : ''}`,
            'data-heat': heat,
            title: `${dateLabel(iso, 0)} · ${voters}명 중 ${can}명 가능`,
          }, el('span', null, String(Number(iso.slice(8)))), el('span', { class: 'rc-count' }, `${can}/${voters}`));
        })));
  }), el('p', { class: 'rc-legend' }, '칸의 숫자는 올 수 있는 사람(○ 또는 △)/투표한 사람입니다. 진할수록 모두가 되고, 테두리가 진한 날이 결정된 날입니다.'));
}

const OTHER_RULES = {
  date: [
    ['flat', '마일리지 없이', '못 오는 사람이 가장 적은 날 가운데, 누구의 ○든 한 표로 세어 가장 많은 날.'],
    ['likes', '○만 센다면', '못 오는 사람은 따지지 않고 ○가 가장 많은 날.'],
    ['sum', '점수 합계 (공리주의)', '○ 2점, △ 1점, ✕ 0점을 모두 더한 값이 가장 큰 날. 여럿의 작은 만족이 몇 사람의 불참을 덮을 수 있어요.'],
  ],
  choice: [
    ['plurality', '최다 1위', '1위로 꼽은 사람이 가장 많은 후보. 흔한 다수결이지만, 표가 갈리면 다수가 꺼리는 후보가 뽑힐 수 있어요.'],
    ['borda', '보르다 점수', '모든 후보와 견준 보르다 점수가 가장 높은 후보. 역설은 없지만, 비슷한 후보가 늘면 결과가 흔들릴 수 있어요.'],
    ['copeland', '맞대결 승수 (코플랜드)', '맞대결에서 가장 많이 이긴 후보. 비기면 반 승으로 셉니다.'],
    ['rawls', '최소 수혜자 우선 (롤스)', '가장 낮은 순위가 가장 높은 후보. 누구에게도 꼴찌가 아닌 쪽이지만, 여럿이 크게 원하는 후보를 놓칠 수 있어요.'],
  ],
};

function renderOthers(picked) {
  const { poll, ballots } = state;
  const picks = otherRules(poll.kind, ballots, poll.options.length);
  const fair = picked.first;
  const same = (list) => list.length === fair.length && list.every((index) => fair.includes(index));
  $('others').replaceChildren(...OTHER_RULES[poll.kind].map(([key, name, what]) => el('li', null,
    el('span', { class: 'rule-name' }, name),
    el('span', { class: 'fine' }, what),
    el('span', { class: 'rule-pick' }, `→ ${picks[key].map((index) => nameOf(index)).join(', ')}`,
      same(picks[key]) && el('span', { class: 'same' }, ' 이 페이지와 같아요')))));
}

function renderHow() {
  const spinner = LINKS ? '투표를 만든 사람이' : '그룹 ID와 PIN을 아는 사람 누구나';
  const steps = state.poll.kind === 'date'
    ? [
      '✕(못 가요)가 가장 적은 날만 남겨요. 가장 많은 사람이 올 수 있는 날이에요. 여기서는 누구나 한 사람으로 셉니다.',
      '그중 선호 점수가 가장 높은 날이에요. 선호 점수는 그날에 ○를 준 사람들의 마일리지를 더한 값이에요.',
      `마일리지는 모두 100%에서 시작해 ✕ 하나에 1/${state.poll.options.length}(후보 날짜 수), △ 하나에 그 절반씩 줄고, 남은 만큼이 그 사람 ○ 하나의 무게예요. 여러 날을 열어 둔 사람의 ○는 더 무겁고, 그런 사람이 △를 준 날은 그만큼 점수를 덜 받아요. ✕와 △는 남에게 맞춰 달라는 부탁이라 그만큼 마일리지가 드는 셈이에요.`,
      `그래도 같으면 공동 1위로 두고, 마감한 뒤 ${spinner} 공동 1위를 룰렛에 올려 돌려서 하나를 뽑아요.`,
      '뽑힌 날에 ✕를 준 사람은 결정 바로 밑에 불참자로 이름이 나와요.',
    ]
    : [
      '모두가 모든 후보에 순위를 매겨요. 후보가 n개면 누구나 n-1점부터 0점까지를 한 번씩 주는 셈이라, 누구의 표든 무게가 같아요.',
      '맞대결에서 다른 모든 후보를 이기는 후보가 있으면(콩도르세 승자) 그 후보예요. 두 후보 가운데 한쪽을 더 위에 둔 사람이 많으면 그쪽이 이겨요.',
      '서로 물고 물리거나 비겨서 그런 후보가 없으면(콩도르세의 역설), 물고 물린 후보들 가운데 보르다 점수가 가장 높은 후보예요. 한 사람마다 아래에 둔 후보 하나에 1점씩 줘요.',
      `그래도 같으면 공동 1위로 두고, 마감한 뒤 ${spinner} 공동 1위를 룰렛에 올려 돌려서 하나를 뽑아요.`,
    ];
  steps.push('1위 하나만 고르고, 나머지 후보에는 순위를 매기지 않아요. 결과에는 후보마다 누가 무엇을 골랐는지만 보여요.',
    '누가 무엇을 골랐는지는 마감한 뒤에 공개돼요. 남의 표를 보고 셈을 해서 투표하는 일을 막기 위해서예요.');
  $('how-steps').replaceChildren(...steps.map((step) => el('li', null, step)));
}

function renderResults() {
  const { poll, ballots } = state;
  const closed = Boolean(poll.closedAt);
  const shown = closed && ballots.length > 0;
  renderHow();
  $('others-panel').hidden = !shown;
  $('result-cal').hidden = !shown || poll.kind !== 'date';
  $('paradox').hidden = true;
  if (!shown) {
    $('results-summary').textContent = closed ? '' : `${ballots.length}명 투표 · 마감 뒤 공개`;
    $('results').replaceChildren(el('li', { class: 'empty' }, closed
      ? '아무도 투표하지 않았어요.'
      : `${ballots.length ? '' : '아직 아무도 투표하지 않았어요. '}누가 무엇을 골랐는지와 결과는 마감한 뒤에 모두에게 공개돼요. 그 전에는 누가 투표했는지만 보여요.`));
    return;
  }
  const count = poll.options.length;
  const picked = pick(poll.kind, ballots, count);
  // The option decided on first, then the others as the poll lists them.
  const decided = poll.decision?.index ?? null;
  const order = picked.tallies.filter((t) => t.index === decided).concat(picked.tallies.filter((t) => t.index !== decided));
  $('results-summary').textContent = `${ballots.length}명 · 마감 결과${LINKS ? ' · 이 기기가 받은 투표' : ''}`;
  if (poll.kind === 'date') {
    $('results').replaceChildren(...order.map((t) => dateResult(t, picked)));
    renderResultCalendar(picked);
  } else {
    const wins = pairwise(ballots, count);
    renderParadox(picked, wins);
    $('results').replaceChildren(...order.map((t) => choiceResult(t, picked, wins)));
  }
  renderOthers(picked);
}

function renderVoters() {
  const { poll, ballots } = state;
  const keys = entryOf(poll.id)?.keys || {};
  // After a date poll closes, each voter's mileage, which weighed their ○.
  const weighed = Boolean(poll.closedAt) && poll.kind === 'date';
  $('voters-section').hidden = ballots.length === 0;
  $('voters').replaceChildren(...ballots.map((ballot) => {
    const editable = Boolean(keys[ballot.id]) && !poll.closedAt && state.draft?.ballotId !== ballot.id;
    return el('li', { class: editable ? null : 'plain' }, ballot.name,
      weighed && ballot.grades && el('small', { class: 'mileage-tag' }, `마일리지 ${percent(mileage(ballot.grades))}`),
      editable && el('button', {
        type: 'button', class: 'ghost', 'aria-label': `${ballot.name} 님의 투표 고치기`,
        onclick: () => editBallot(ballot.id),
      }, '고치기'));
  }));
  $('voters-note').hidden = state.sameNames.length === 0;
  $('voters-note').textContent = `이름이 같은 투표가 여러 기기에서 들어왔어요: ${state.sameNames.join(', ')}. 가장 나중 것만 셉니다.`;
}

// On the API anyone with the PIN may close the poll, so that it decides
// even when its maker has lost the admin code: from below the results, or
// for the maker from their menu, where they also reopen it. In links only
// the maker closes.
function renderCloseRow() {
  const { poll } = state;
  $('close-row').hidden = LINKS || Boolean(poll.closedAt) || Boolean(entryOf(poll.id)?.adminKey);
  say('close-message');
}

async function onCloseNow(event) {
  const { poll } = state;
  if (!poll || poll.closedAt) return;
  if (!window.confirm('지금 마감할까요? 마감하면 투표를 더 받지 않고 결과가 정해져요. 다시 여는 건 투표를 만든 사람만 할 수 있어요.')) return;
  await withBusy(event.currentTarget, async () => {
    try {
      reload(await api.close(poll.id, authOf(entryOf(poll.id))));
    } catch (error) {
      if (error.status === 401) {
        signedOut(error);
        return;
      }
      say('close-message', error.message);
    }
  });
}

async function adminCall(button, call, done) {
  const { poll } = state;
  await withBusy(button, async () => {
    try {
      done(await call(poll.id, authOf(entryOf(poll.id))));
    } catch (error) {
      if (error.status === 401) {
        signedOut(error);
        return;
      }
      if (error.code === 'admin') {
        updateEntry(poll.id, { adminKey: null });
        renderAdmin();
      }
      say('admin-message', error.message);
    }
  });
}

function reload(data) {
  take(data);
  markUnsent(data.poll.id, 'changed');
  renderPoll();
}

async function onAdminKey(event) {
  event.preventDefault();
  const key = $('admin-key-input').value.trim();
  if (!key) return;
  const { poll } = state;
  try {
    const data = await api.load(poll.id, { adminKey: key });
    updateEntry(poll.id, { adminKey: key });
    take(data);
    renderPoll();
    $('admin').open = true;
  } catch (error) {
    say('admin-message', error.status === 401 ? '관리 코드가 맞지 않아요.' : error.message);
  }
}

function renderAdmin() {
  const { poll, ballots } = state;
  const entry = entryOf(poll.id) || {};
  const body = $('admin-body');
  if (!entry.adminKey) {
    body.replaceChildren(el('form', { class: 'admin-block', novalidate: true, onsubmit: onAdminKey },
      el('p', { class: 'fine' }, '투표를 만든 기기에서는 이 메뉴가 바로 열려요. 다른 기기에서 쓰려면 투표를 만들 때 받은 관리 코드를 넣어 주세요.'),
      el('label', { class: 'field' }, el('span', null, '관리 코드'),
        el('input', { id: 'admin-key-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' })),
      el('p', { class: 'message', id: 'admin-message', role: 'alert' }),
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'ghost' }, '확인'))));
    return;
  }
  const closed = Boolean(poll.closedAt);
  body.replaceChildren(
    el('div', { class: 'admin-block' },
      el('h3', null, closed ? '다시 열기' : '마감하기'),
      el('p', { class: 'fine' }, closed
        ? '다시 열면 투표를 더 받고, 결정은 지워집니다. 지난 마감 시각도 지워집니다. 다시 마감했을 때 공동 1위가 같으면 룰렛 결과도 그대로예요.'
        : '마감하면 투표를 더 받지 않고, 지금까지의 투표로 하나를 정합니다. 공동 1위면 마감한 뒤 룰렛을 돌려 하나를 뽑아요.'),
      LINKS && el('p', { class: 'fine' }, closed
        ? '다시 연 링크를 단톡방에 올려야 다른 사람에게도 열려요.'
        : '마감하기 전에 단톡방에 올라온 링크를 모두 열어 투표를 합쳐 주세요. 마감한 뒤에는 마감 링크를 올려야 다른 사람에게도 마감돼요.'),
      el('div', { class: 'actions' }, el('button', {
        type: 'button', class: closed ? 'ghost' : 'primary', id: 'admin-close',
        onclick: (event) => adminCall(event.currentTarget, closed ? api.reopen : api.close, reload),
      }, closed ? '다시 열기' : '지금 마감하기'))),
    ballots.length > 0 && el('div', { class: 'admin-block' },
      el('h3', null, '투표 지우기'),
      el('p', { class: 'fine' }, closed
        ? '마감된 동안에는 투표를 지울 수 없어요.'
        : '잘못 들어간 투표나, 같은 사람이 다른 이름으로 두 번 한 투표를 지울 수 있어요.'),
      el('ul', { class: 'voter-list' }, ballots.map((ballot) => el('li', null, ballot.name, el('button', {
        type: 'button', class: 'ghost danger', disabled: closed, 'aria-label': `${ballot.name} 님의 투표 지우기`,
        onclick: (event) => {
          if (!window.confirm(`${ballot.name} 님의 투표를 지울까요?`)) return;
          adminCall(event.currentTarget, (id, auth) => api.unvote(id, auth, ballot.id), reload);
        },
      }, '지우기'))))),
    el('div', { class: 'admin-block' },
      el('h3', null, '관리 코드'),
      el('p', { class: 'fine' }, LINKS
        ? '다른 기기에서 이 메뉴를 쓰려면 이 코드가 필요해요. 이 코드가 있으면 마감하고 룰렛도 돌릴 수 있으니, 아무에게도 알려 주지 마세요.'
        : '다른 기기에서 이 메뉴를 쓰려면 이 코드가 필요해요. 다른 사람에게는 알려 주지 마세요.'),
      el('div', { class: 'key-row' }, el('code', null, entry.adminKey), el('button', {
        type: 'button', class: 'act', onclick: (event) => copyText(entry.adminKey, event.currentTarget),
      }, '복사'))),
    !LINKS && el('div', { class: 'admin-block' },
      el('h3', null, '투표 삭제'),
      el('p', { class: 'fine' }, '투표와 모든 기록을 지금 서버에서 지웁니다. 되돌릴 수 없어요.'),
      el('div', { class: 'actions' }, el('button', {
        type: 'button', class: 'ghost danger', id: 'admin-delete',
        onclick: (event) => {
          if (!window.confirm(`'${poll.title}' 투표와 모든 기록을 지울까요? 되돌릴 수 없어요.`)) return;
          adminCall(event.currentTarget, api.remove, () => {
            forgetEntry(poll.id);
            state.poll = null;
            state.draft = null;
            state.flash = `'${poll.title}' 투표를 지웠어요.`;
            navigate('');
          });
        },
      }, '투표 삭제'))),
    el('p', { class: 'message', id: 'admin-message', role: 'alert' }));
}

function leave() {
  const { id } = state.route;
  const ask = LINKS
    ? '이 기기에서 이 투표를 지울까요? 이 기기가 받은 투표와 열쇠, PIN이 사라져요. 단톡방의 링크로 다시 열 수 있고, 만든 사람이라면 관리 코드도 필요해요.'
    : '이 기기에서 이 투표의 열쇠와 PIN을 지울까요? 다시 들어오려면 PIN이 필요하고, 만든 사람이라면 관리 코드도 필요해요.';
  if (!window.confirm(ask)) return;
  if (LINKS) api.remove(id);
  forgetEntry(id);
  state.poll = null;
  state.draft = null;
  navigate('');
}

// --- Links -----------------------------------------------------------------

// A link opened on this page: its ballots added to the poll this device
// keeps, or, for a poll new to it, its group ID and PIN asked for. Says
// whether there was a link.
async function receive(text) {
  const [found] = payloadsIn(text);
  if (!found) return false;
  // A link put into a page that keeps its poll on the API loads in links.
  if (!LINKS) {
    location.reload();
    return true;
  }
  history.replaceState(null, '', location.pathname + location.search);
  const [result] = await api.absorb(found.payload);
  if (result) {
    if (!entryOf(result.id)?.token) updateEntry(result.id, { token: 'link' });
    state.loadedAt = 0;
    state.notice = result.added
      ? `링크에서 새 투표 ${result.added}개를 합쳤어요.`
      : result.changed ? '링크에서 마감이나 룰렛 결과를 받았어요.' : '링크의 내용은 이미 이 기기에 다 있어요.';
    navigate(`?g=${encodeURIComponent(result.id)}`, { replace: true });
    return true;
  }
  state.pending = found.payload;
  navigate('?join', { replace: true });
  return true;
}

async function onMerge() {
  const text = $('merge-input').value;
  if (payloadsIn(text).length === 0) {
    say('merge-message', '붙여 넣은 글에서 투표 링크를 찾지 못했어요.');
    return;
  }
  const results = (await api.absorb(text)).filter((result) => result.id === state.poll.id);
  if (results.length === 0) {
    say('merge-message', '이 투표의 링크가 아니에요.');
    return;
  }
  const added = results.reduce((sum, result) => sum + result.added, 0);
  const changed = results.some((result) => result.changed);
  $('merge-input').value = '';
  await refresh();
  let said = '이미 이 기기에 다 있는 내용이에요.';
  if (added) said = `새 투표 ${added}개를 합쳤어요.`;
  else if (changed) said = '마감이나 룰렛 결과를 받았어요.';
  say('merge-message', said, true);
}

// --- Start -----------------------------------------------------------------

async function loadHolidays() {
  try {
    const res = await fetch('../common/holidays.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const doc = await res.json();
    state.holidays = doc.dates || {};
    state.through = holidaysThrough(state.holidays);
    state.holidaysLoaded = true;
  } catch {
    // The calendar shows weekends without the holidays.
  } finally {
    // What goes to research waits for them, and says when they did not come.
    state.holidaysTried = true;
  }
}

function wire() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-nav]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(new URL(link.href).search);
  });
  window.addEventListener('popstate', () => (API_BASE && linksFor(location) !== LINKS ? location.reload() : show()));
  window.addEventListener('hashchange', () => receive(location.hash));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || state.route.view !== 'poll' || !state.poll) return;
    if (Date.now() - state.loadedAt > 15000) refresh();
  });

  $('enter-form').addEventListener('submit', onEnter);
  $('create-form').addEventListener('submit', onCreate);
  for (const radio of document.querySelectorAll('input[name="kind"]')) {
    radio.addEventListener('change', () => {
      state.kind = radio.value;
      say('create-message');
      renderKind();
    });
  }
  $('add-choice').addEventListener('click', addChoice);
  $('random-pin').addEventListener('click', randomPin);
  $('gate-form').addEventListener('submit', onGate);
  $('vote-form').addEventListener('submit', onVote);
  $('voter-name').addEventListener('input', () => {
    if (state.draft) state.draft.name = $('voter-name').value;
  });
  $('vote-other').addEventListener('click', voteAsSomeoneElse);
  $('vote-remove').addEventListener('click', onRemoveMine);
  $('refresh').addEventListener('click', (event) => withBusy(event.currentTarget, refresh));
  $('close-now').addEventListener('click', onCloseNow);
  $('leave').addEventListener('click', leave);
  $('copy-invite').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (LINKS) await linkNow();
    copyText(inviteText(state.poll, entryOf(state.poll.id)?.pin), button);
  });
  $('copy-link').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    copyText(LINKS ? await linkNow() : shareLink(state.poll.id), button);
  });
  $('share-native').addEventListener('click', async () => {
    try {
      if (LINKS) await linkNow();
      await navigator.share({ title: state.poll.title, text: inviteText(state.poll, entryOf(state.poll.id)?.pin) });
    } catch {
      // Cancelled, or the browser would not share.
    }
  });
  $('send-copy').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const { id } = state.poll;
    await linkNow();
    await copyText(sendText(), button);
    sent(id);
  });
  $('send-native').addEventListener('click', async () => {
    const { id } = state.poll;
    try {
      await linkNow();
      await navigator.share({ title: state.poll.title, text: sendText() });
      sent(id);
    } catch {
      // Cancelled, or the browser would not share.
    }
  });
  $('merge-submit').addEventListener('click', (event) => withBusy(event.currentTarget, onMerge));
}

async function main() {
  document.body.dataset.mode = LINKS ? 'links' : 'server';
  $('research-foot').hidden = !RESEARCH_BASE;
  wire();
  if (!await receive(location.hash)) show();
  await loadHolidays();
  if (state.route.view === 'create') {
    renderPicker();
    renderPicked();
  } else if (state.route.view === 'poll' && state.poll && !$('poll-body').hidden) {
    renderPoll({ quiet: true });
  }
}

main();
