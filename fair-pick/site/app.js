// Draws the page's three views and talks to the API: home, with the way
// into a poll and to a new one; the form for a new poll, with a Korean
// calendar for dates; and a poll, with the voter's ballot, the results and
// the maker's menu. The API is called from api.js, what is allowed is in
// rules.js, how the group's choice is ranked in rank.js and the calendar in
// calendar.js.

import { API_BASE } from './config.js';
import { createClient } from './api.js';
import {
  WEEKDAYS, dateLabel, dayKind, holidaysThrough, monthOf, monthWeeks, monthsBetween, shiftMonth, toggleAll,
  weekdayDates,
} from './calendar.js';
import { geometricMean, otherRules, rank, tally } from './rank.js';
import {
  LIMITS, SCALES, checkBallot, checkPoll, idProblem, koreaDate, newPinProblem, normalizeId, pinProblem, weakPin,
} from './rules.js';

// Where this browser keeps, for each poll it has been in, the token the
// PIN unlocked, the PIN, the maker's admin key and the keys of the ballots
// cast from it: { [id]: { token, pin, adminKey, keys, current, title, kind, seen } }.
const STORE_KEY = 'fair-pick.polls';

// How many months past this one the calendar goes.
const MONTHS_AHEAD = 12;

const KIND_NAMES = { date: '날짜 투표', choice: '장소·메뉴 투표' };
const CHOICE_EXAMPLES = ['예: 삼겹살집', '예: 횟집', '예: 중식당'];

const api = API_BASE ? createClient(API_BASE) : null;

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
  // being filled in: { pollId, ballotId, name, grades }, a grade null until
  // picked. It outlives a reload of the poll, so what the voter has picked
  // stays picked.
  poll: null,
  ballots: [],
  loadedAt: 0,
  draft: null,
  justMade: false,
  flash: '',
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
  if (params.has('g')) return { view: 'poll', id: normalizeId(params.get('g')) };
  return { view: 'home' };
}

function navigate(search) {
  history.pushState(null, '', search || location.pathname);
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
  document.title = '모임 공정 투표';
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
  if (!api) return;
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
      const data = await api.enter(id, pin);
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
  document.title = '새 투표 · 모임 공정 투표';
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
  if (!api) return;
  const deadline = $('deadline-input').value;
  const input = {
    kind: state.kind,
    title: $('title-input').value,
    note: $('note-input').value,
    options: state.kind === 'date' ? [...state.picked].sort() : state.choices,
    deadline: deadline ? `${deadline.length === 16 ? `${deadline}:00` : deadline}+09:00` : null,
  };
  const id = normalizeId($('id-input').value);
  const pin = $('pin-input').value.trim();
  const problem = checkPoll(input).problem || idProblem(id) || newPinProblem(pin);
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
      state.justMade = true;
      resetCreate();
      navigate(`?g=${encodeURIComponent(data.poll.id)}`);
    } catch (error) {
      say('create-message', error.message);
      if (error.body.field === 'id') $('id-input').focus();
      else if (error.body.field === 'pin') $('pin-input').focus();
    }
  });
}

// --- A poll ----------------------------------------------------------------

function take(data) {
  state.poll = data.poll;
  state.ballots = data.ballots;
  state.loadedAt = Date.now();
}

function showPoll(id) {
  say('poll-message');
  say('vote-message');
  $('poll-id').textContent = id;
  $('poll-kind').textContent = '';
  $('poll-note').hidden = true;
  $('poll-status').textContent = '';
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
  document.title = `${entry?.title || id} · 모임 공정 투표`;
  if (!entry?.token && !entry?.adminKey) {
    showGate();
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

function showGate(message = '') {
  $('gate-form').hidden = false;
  $('poll-body').hidden = true;
  $('gate-pin').value = '';
  say('gate-message', message);
}

// After an answer that the poll is gone or the token no longer opens it.
function signedOut(error) {
  forgetEntry(state.route.id);
  state.poll = null;
  state.draft = null;
  showGate(error.message);
}

async function onGate(event) {
  event.preventDefault();
  if (!api) return;
  const { id } = state.route;
  const pin = $('gate-pin').value.trim();
  const problem = pinProblem(pin);
  if (problem) {
    say('gate-message', problem);
    return;
  }
  await withBusy($('gate-submit'), async () => {
    try {
      const data = await api.enter(id, pin);
      updateEntry(id, { token: data.token, pin, title: data.poll.title, kind: data.poll.kind });
      $('gate-pin').value = '';
      take(data);
      renderPoll();
    } catch (error) {
      say('gate-message', error.message);
    }
  });
}

async function refresh() {
  const { id } = state.route;
  if (!api) {
    say('poll-message', '투표 서버가 아직 연결되지 않았어요.');
    return;
  }
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

function renderPoll() {
  $('gate-form').hidden = true;
  $('poll-body').hidden = false;
  say('poll-message');
  say('vote-message');
  updateEntry(state.poll.id, { title: state.poll.title, kind: state.poll.kind });
  renderHeader();
  renderDecision();
  renderShare();
  renderBallot();
  renderResults();
  renderVoters();
  renderAdmin();
}

function renderHeader() {
  const { poll, ballots } = state;
  document.title = `${poll.title} · 모임 공정 투표`;
  $('poll-kind').textContent = `${KIND_NAMES[poll.kind]} · `;
  $('poll-id').textContent = poll.id;
  $('poll-title').textContent = poll.title;
  $('poll-note').textContent = poll.note;
  $('poll-note').hidden = !poll.note;
  const bits = [`${ballots.length}명 투표`];
  if (poll.closedAt) bits.unshift('마감됨');
  else bits.push(poll.deadline ? `${timeText(poll.deadline)} 마감` : '만든 사람이 마감할 때까지');
  $('poll-status').textContent = bits.join(' · ');
}

function renderDecision() {
  const { poll, ballots } = state;
  const box = $('decision');
  box.hidden = !poll.closedAt;
  if (!poll.closedAt) return;
  if (!poll.decision) {
    box.className = 'decision none';
    box.replaceChildren(
      el('span', { class: 'label' }, `${timeText(poll.closedAt)} 마감`),
      el('p', null, '아무도 투표하지 않은 채 마감되어 정하지 못했어요.'));
    return;
  }
  const { index, tied, drawn } = poll.decision;
  const { text, holiday } = optionOf(poll, index);
  box.className = 'decision';
  box.replaceChildren(
    el('span', { class: 'label' }, `${timeText(poll.closedAt)} 마감 · 결정`),
    el('strong', null, holiday ? `${text} · ${holiday}` : text),
    el('p', null, drawn
      ? `공동 1위 ${tied.length}개 가운데, 투표를 만들 때 미리 뽑아 둔 무작위 순서로 골랐어요.`
      : `${ballots.length}명의 투표를 아래 규칙으로 센 1위예요.`));
}

function shareLink(id) {
  return `${location.origin}${location.pathname}?g=${encodeURIComponent(id)}`;
}

function inviteText(poll, pin) {
  return [
    `[모임 공정 투표] ${poll.title}`,
    '링크를 열고 PIN을 넣은 뒤, 이름을 걸고 투표해 주세요.',
    shareLink(poll.id),
    `그룹 ID: ${poll.id}`,
    pin && `PIN: ${pin}`,
  ].filter(Boolean).join('\n');
}

function renderShare() {
  const { poll } = state;
  const entry = entryOf(poll.id) || {};
  // The link as a person reads it; what is copied keeps a Hangul ID encoded.
  let link = shareLink(poll.id);
  try {
    link = decodeURI(link);
  } catch {
    // Shown encoded.
  }
  $('share-link').textContent = link;
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

function ensureDraft() {
  const { poll } = state;
  const mine = currentBallot();
  const want = mine ? mine.id : null;
  const { draft } = state;
  if (draft && draft.pollId === poll.id && draft.ballotId === want && draft.grades.length === poll.options.length) {
    return draft;
  }
  state.draft = {
    pollId: poll.id,
    ballotId: want,
    name: mine ? mine.name : '',
    grades: mine ? [...mine.grades] : poll.options.map(() => null),
    showMissing: false,
  };
  return state.draft;
}

// The scores of a poll's scale, the best first, as the ballot shows them.
function bestFirst(poll) {
  return SCALES[poll.kind].grades.map((_, score) => score).reverse();
}

function gradeText(poll, score) {
  const grade = SCALES[poll.kind].grades[score];
  return poll.kind === 'date' ? `${grade.short} ${grade.label}` : grade.label;
}

function ballotRow(index, closed) {
  const { poll, draft } = state;
  const order = bestFirst(poll);
  const row = el('li', { 'data-index': index, class: draft.showMissing && draft.grades[index] == null ? 'missing' : null });
  row.append(el('fieldset', null,
    el('legend', null, optionNode(poll, index)),
    el('div', { class: 'grades', style: `--count: ${order.length}` }, order.map((score) => el('label', {
      class: `grade tone-${SCALES[poll.kind].grades[score].tone}`,
    }, el('input', {
      type: 'radio', name: `grade-${index}`, value: score, checked: draft.grades[index] === score, disabled: closed,
      onchange: () => {
        draft.grades[index] = score;
        row.classList.remove('missing');
        updateLeft();
      },
    }), el('span', null, gradeText(poll, score)))))));
  return row;
}

function renderBallotRows() {
  const closed = Boolean(state.poll.closedAt);
  $('ballot').replaceChildren(...state.poll.options.map((_, index) => ballotRow(index, closed)));
}

function updateLeft() {
  const { poll, draft } = state;
  const mine = currentBallot();
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
  const left = draft.grades.filter((grade) => grade == null).length;
  $('vote-state').textContent = left
    ? `후보 ${draft.grades.length}개 가운데 ${left}개 남았어요.`
    : '모두 골랐어요.';
}

function fillRest(score) {
  const { draft } = state;
  draft.grades = draft.grades.map((grade) => grade ?? score);
  renderBallotRows();
  updateLeft();
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
  $('quick-fill').replaceChildren(...(closed ? [] : [
    el('span', null, '안 고른 후보 모두'),
    ...bestFirst(poll).map((score) => el('button', {
      type: 'button', class: 'ghost', onclick: () => fillRest(score),
    }, gradeText(poll, score))),
  ]));
  renderBallotRows();
  $('vote-submit').textContent = mine ? '고치기' : '투표하기';
  $('vote-submit').disabled = closed || !api;
  $('vote-other').hidden = !mine || closed;
  $('vote-remove').hidden = !mine || closed;
  updateLeft();
}

async function onVote(event) {
  event.preventDefault();
  const { poll, draft } = state;
  if (!api || !poll || poll.closedAt) return;
  draft.name = $('voter-name').value;
  const missing = draft.grades.findIndex((grade) => grade == null);
  if (missing >= 0) {
    draft.showMissing = true;
    for (const row of $('ballot').children) row.classList.toggle('missing', draft.grades[row.dataset.index] == null);
    const count = draft.grades.filter((grade) => grade == null).length;
    say('vote-message', `아직 고르지 않은 후보가 ${count}개 있어요.`);
    $('ballot').children[missing].querySelector('input').focus();
    return;
  }
  const checked = checkBallot({ name: draft.name, grades: draft.grades }, poll);
  if (checked.problem) {
    say('vote-message', checked.problem);
    $('voter-name').focus();
    return;
  }
  const entry = entryOf(poll.id) || {};
  const keys = { ...(entry.keys || {}) };
  const changing = draft.ballotId;
  await withBusy($('vote-submit'), async () => {
    try {
      const data = await api.vote(
        poll.id,
        { ...authOf(entry), ballotKey: changing ? keys[changing] : '' },
        { ...checked.ballot, ballotId: changing || undefined },
      );
      if (data.ballotKey) keys[data.ballotId] = data.ballotKey;
      updateEntry(poll.id, { keys, current: data.ballotId });
      state.draft = {
        pollId: poll.id, ballotId: data.ballotId, name: checked.ballot.name, grades: [...checked.ballot.grades],
        showMissing: false,
      };
      take(data);
      renderPoll();
      say('vote-message', changing ? '고쳤어요.' : '투표했어요. 마감 전에는 언제든 고칠 수 있어요.', true);
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
      if (error.body.field === 'name') $('voter-name').focus();
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
      delete keys[mine.id];
      updateEntry(poll.id, { keys, current: null });
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

function namesWith(index, score) {
  return state.ballots.filter((ballot) => ballot.grades[index] === score).map((ballot) => ballot.name);
}

// Why the option ranked first is first, against the one ranked after it.
function reason(t, ranked) {
  const { poll } = state;
  const date = poll.kind === 'date';
  const word = date ? '날' : '후보';
  const firsts = ranked.filter((u) => u.rank === 1);
  if (firsts.length > 1) {
    if (poll.decision?.drawn && poll.decision.index === t.index) {
      return '공동 1위 가운데 투표를 만들 때 미리 뽑아 둔 무작위 순서로 뽑혔어요.';
    }
    return poll.closedAt
      ? '공동 1위였어요.'
      : '공동 1위예요. 마감하면 투표를 만들 때 미리 뽑아 둔 무작위 순서로 하나를 고릅니다.';
  }
  const next = ranked.find((u) => u.rank > 1);
  if (!next) return '';
  if (t.vetoes < next.vetoes) {
    return t.vetoes === 0 ? `'안 돼요'가 아무도 없는 ${word}는 이것뿐이에요.` : `'안 돼요'가 ${t.vetoes}명으로 가장 적어요.`;
  }
  const among = t.vetoes === 0 ? `'안 돼요'가 없는 ${word}` : `'안 돼요'가 똑같이 ${t.vetoes}명인 ${word}`;
  if (t.product !== next.product) {
    return date ? `${among} 가운데 ○가 가장 많아요.` : `${among} 가운데 만족도를 곱한 값이 가장 커요.`;
  }
  if (t.level.includes(next.index)) return `만족도가 똑같은 ${word} 가운데 일대일 맞대결에서 더 많이 이겨요.`;
  return `만족도를 곱한 값이 같은 ${word} 가운데 가장 불만인 사람이 덜 불만이에요.`;
}

function resultRow(t, ranked) {
  const { poll } = state;
  const scale = SCALES[poll.kind];
  const counts = bestFirst(poll).map((score) => ({ score, n: t.counts[score] }));
  const sharing = ranked.filter((u) => u.rank === t.rank).length > 1;
  const first = t.rank === 1;
  const geo = geometricMean(t);
  const stats = poll.kind === 'date'
    ? counts.map(({ score, n }) => `${scale.grades[score].short} ${n}`).join(' · ')
    : [`안 돼요 ${t.vetoes}명`, geo != null && `기하평균 ${geo.toFixed(2)}점`, `합계 ${t.sum}점`].filter(Boolean).join(' · ');
  const bar = el('div', {
    class: 'bar', role: 'img',
    'aria-label': counts.map(({ score, n }) => `${scale.grades[score].label} ${n}명`).join(', '),
  }, counts.filter(({ n }) => n > 0).map(({ score, n }) => {
    const part = el('span', { class: `tone-${scale.grades[score].tone}` });
    part.style.flexGrow = String(n);
    return part;
  }));
  return el('li', { class: `result${first ? ' first' : ''}` },
    el('div', { class: 'rank-badge', 'aria-label': `${sharing ? '공동 ' : ''}${t.rank}위` },
      sharing && el('small', null, '공동'), String(t.rank)),
    el('div', { class: 'result-body' },
      el('div', { class: 'result-label' }, optionNode(poll, t.index, 'strong'),
        poll.decision?.index === t.index && el('span', { class: 'tag decided' }, '결정')),
      bar,
      el('p', { class: 'stats' }, stats),
      first && el('p', { class: 'why' }, reason(t, ranked)),
      el('details', { class: 'who' }, el('summary', null, '누가 어떻게 골랐나요'),
        el('dl', null, counts.filter(({ n }) => n > 0).map(({ score }) => [
          el('dt', { class: `tone-${scale.grades[score].tone}` }, scale.grades[score].label),
          el('dd', null, namesWith(t.index, score).join(', ')),
        ])))));
}

function renderResultCalendar(ranked) {
  const { poll, ballots } = state;
  const scale = SCALES[poll.kind];
  const byDate = new Map(poll.options.map((option, index) => [option.date, ranked.find((t) => t.index === index)]));
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
          const can = t.grades.filter((grade) => grade >= scale.approveAt).length;
          const all = t.counts[t.counts.length - 1];
          const heat = all === voters ? 3 : t.vetoes === 0 ? 2 : can * 2 >= voters ? 1 : 0;
          return el('span', {
            class: `rc-day candidate ${kind}${t.rank === 1 ? ' top' : ''}`,
            'data-heat': heat,
            title: `${dateLabel(iso, 0)} · ${t.rank}위 · ${voters}명 중 ${can}명 가능`,
          }, el('span', null, String(Number(iso.slice(8)))), el('span', { class: 'rc-count' }, `${can}/${voters}`));
        })));
  }), el('p', { class: 'rc-legend' }, '칸의 숫자는 되는 사람(○ 또는 △)/투표한 사람입니다. 진할수록 모두가 되고, 테두리가 진한 날이 1위입니다.'));
}

const OTHER_RULES = [
  ['approval', '승인 투표', {
    date: "'되긴 해요' 이상이 가장 많은 날. 흔히 일정을 잡는 방식이에요.",
    choice: "'보통' 이상이 가장 많은 후보.",
  }],
  ['sum', '점수 합계 (공리주의)', '모두의 점수를 더한 값이 가장 큰 것. 여럿의 작은 만족이 한 사람의 큰 불만을 덮을 수 있어요.'],
  ['rawls', '최소 수혜자 우선 (롤스)', '가장 낮은 점수가 가장 높은 것. 여럿이 크게 좋아하는 것을 놓칠 수 있어요.'],
  ['median', '다수 판단 (중앙값)', '절반 이상이 그 점수 이상을 준 점수, 곧 중앙값이 가장 높은 것 (발린스키·라라키).'],
  ['condorcet', '콩도르세 승자', '다른 모든 후보와 일대일로 붙어 모두 이기는 것. 서로 물고 물리면 없어요.'],
];

function renderOthers(tallies, ranked) {
  const { poll } = state;
  const picks = otherRules(tallies, SCALES[poll.kind].approveAt);
  const fair = ranked.filter((t) => t.rank === 1).map((t) => t.index);
  const same = (list) => list.length === fair.length && list.every((index) => fair.includes(index));
  $('others').replaceChildren(...OTHER_RULES.map(([key, name, what]) => {
    const list = picks[key];
    const text = list.length ? list.map((index) => optionOf(poll, index).text).join(', ') : '없음 (서로 물고 물려요)';
    return el('li', null,
      el('span', { class: 'rule-name' }, name),
      el('span', { class: 'fine' }, typeof what === 'string' ? what : what[poll.kind]),
      el('span', { class: 'rule-pick' }, `→ ${text}`, list.length > 0 && same(list) && el('span', { class: 'same' }, ' 이 페이지와 같아요')));
  }));
}

function renderHow() {
  const date = state.poll.kind === 'date';
  const steps = date ? [
    "'안 돼요(✕)'가 가장 적은 날. 그날로 정하면 빠져야 하는 사람이 가장 적어요.",
    "그중 '좋아요(○)'가 가장 많은 날. ○를 2점, △를 1점으로 놓고 올 수 있는 사람들의 점수를 곱한 값(내쉬 사회후생)이 가장 큰 날과 같아요.",
    '그래도 같으면 일대일 맞대결에서 더 많이 이기는 날. 두 날 가운데 한쪽을 더 높게 고른 사람이 많으면 그쪽이 이겨요.',
    '끝까지 같으면 공동 순위로 두고, 마감할 때 투표를 만들 때 미리 뽑아 둔 무작위 순서로 하나를 골라요.',
  ] : [
    "'안 돼요'가 가장 적은 후보. 그 후보로 정하면 빠져야 하는 사람이 가장 적어요.",
    '그중 함께할 사람들의 점수(최고 4 · 좋아요 3 · 보통 2 · 별로 1)를 곱한 값이 가장 큰 후보(내쉬 사회후생). 기하평균이 높은 순서와 같아요.',
    '그래도 같으면 가장 낮은 점수가 더 높은 후보, 그다음 일대일 맞대결에서 더 많이 이기는 후보.',
    '끝까지 같으면 공동 순위로 두고, 마감할 때 투표를 만들 때 미리 뽑아 둔 무작위 순서로 하나를 골라요.',
  ];
  $('how-steps').replaceChildren(...steps.map((step) => el('li', null, step)));
}

function renderResults() {
  const { poll, ballots } = state;
  const has = ballots.length > 0;
  renderHow();
  $('others-panel').hidden = !has;
  $('result-cal').hidden = !has || poll.kind !== 'date';
  if (!has) {
    $('results-summary').textContent = '';
    $('results').replaceChildren(el('li', { class: 'empty' },
      poll.closedAt ? '아무도 투표하지 않았어요.' : '아직 아무도 투표하지 않았어요. 첫 투표를 해 주세요.'));
    return;
  }
  const tallies = tally(ballots, poll.options.length, SCALES[poll.kind].grades.length - 1);
  const ranked = rank(tallies);
  $('results-summary').textContent = `${ballots.length}명 · ${poll.closedAt ? '마감 결과' : '지금까지'}`;
  $('results').replaceChildren(...ranked.map((t) => resultRow(t, ranked)));
  if (poll.kind === 'date') renderResultCalendar(ranked);
  renderOthers(tallies, ranked);
}

function renderVoters() {
  const { poll, ballots } = state;
  const keys = entryOf(poll.id)?.keys || {};
  $('voters-section').hidden = ballots.length === 0;
  $('voters').replaceChildren(...ballots.map((ballot) => {
    const editable = Boolean(keys[ballot.id]) && !poll.closedAt && state.draft?.ballotId !== ballot.id;
    return el('li', { class: editable ? null : 'plain' }, ballot.name,
      editable && el('button', {
        type: 'button', class: 'ghost', 'aria-label': `${ballot.name} 님의 투표 고치기`,
        onclick: () => editBallot(ballot.id),
      }, '고치기'));
  }));
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
  renderPoll();
}

async function onAdminKey(event) {
  event.preventDefault();
  const key = $('admin-key-input').value.trim();
  if (!key || !api) return;
  const { poll } = state;
  try {
    const data = await api.load(poll.id, { adminKey: key });
    updateEntry(poll.id, { adminKey: key });
    reload(data);
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
      el('p', { class: 'fine' }, '투표를 만든 기기에서는 이 메뉴가 바로 열려요. 다른 기기에서 만들었다면 그때 받은 관리 코드를 넣어 주세요.'),
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
        ? '다시 열면 투표를 더 받고, 결정은 지워집니다. 지난 마감 시각도 지워집니다. 다시 마감해도 공동 1위를 고르는 무작위 순서는 그대로예요.'
        : '마감하면 투표를 더 받지 않고, 지금까지의 투표로 하나를 정합니다. 공동 1위면 투표를 만들 때 미리 뽑아 둔 무작위 순서로 고릅니다.'),
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
      el('p', { class: 'fine' }, '다른 기기에서 이 메뉴를 쓰려면 이 코드가 필요해요. 다른 사람에게는 알려 주지 마세요.'),
      el('div', { class: 'key-row' }, el('code', null, entry.adminKey), el('button', {
        type: 'button', class: 'act', onclick: (event) => copyText(entry.adminKey, event.currentTarget),
      }, '복사'))),
    el('div', { class: 'admin-block' },
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
  if (!window.confirm('이 기기에서 이 투표의 열쇠와 PIN을 지울까요? 다시 들어오려면 PIN이 필요하고, 만든 사람이라면 관리 코드도 필요해요.')) return;
  forgetEntry(id);
  state.poll = null;
  state.draft = null;
  navigate('');
}

// --- Start -----------------------------------------------------------------

async function loadHolidays() {
  try {
    const res = await fetch('data/holidays.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const doc = await res.json();
    state.holidays = doc.dates || {};
    state.through = holidaysThrough(state.holidays);
  } catch {
    // The calendar shows weekends without the holidays.
  }
}

function wire() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-nav]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(new URL(link.href).search);
  });
  window.addEventListener('popstate', show);
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
  $('leave').addEventListener('click', leave);
  $('copy-invite').addEventListener('click', (event) => {
    copyText(inviteText(state.poll, entryOf(state.poll.id)?.pin), event.currentTarget);
  });
  $('copy-link').addEventListener('click', (event) => copyText(shareLink(state.poll.id), event.currentTarget));
  $('share-native').addEventListener('click', async () => {
    try {
      await navigator.share({ title: state.poll.title, text: inviteText(state.poll, entryOf(state.poll.id)?.pin) });
    } catch {
      // Cancelled, or the browser would not share.
    }
  });
}

async function main() {
  if (!api) {
    $('server-note').hidden = false;
    for (const id of ['enter-submit', 'create-submit', 'gate-submit']) $(id).disabled = true;
  }
  wire();
  show();
  await loadHolidays();
  if (state.route.view === 'create') {
    renderPicker();
    renderPicked();
  } else if (state.route.view === 'poll' && state.poll && !$('poll-body').hidden) {
    renderPoll();
  }
}

main();
