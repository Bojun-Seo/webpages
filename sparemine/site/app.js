// Reads the settings form and draws the command, config and script the
// visitor runs on their own machine. The generating lives in gen.js.

import {
  ALGOS, DEFAULTS, PLATFORMS, POOLS,
  bareCommand, checkAddress, configToml, oneLiner, platformById, poolById, runScript, scriptName,
} from './gen.js';

// Where this browser keeps what the visitor entered.
const FORM_KEY = 'sparemine.form';

// Shown in the generated text until a real address is entered, so the shape
// is visible but obviously not runnable. No shell metacharacters.
const ADDRESS_PLACEHOLDER = 'YOUR_BTC_ADDRESS';

// The form's starting values. The address is deliberately empty: a prefilled
// example could be mistaken for a working one and send mining rewards to a
// stranger.
const EXAMPLE = {
  address: '',
  worker: DEFAULTS.worker,
  algo: DEFAULTS.algo,
  pool: DEFAULTS.pool,
  poolUrl: '',
  platform: DEFAULTS.platform,
  maxCpuPercent: DEFAULTS.maxCpuPercent,
  threads: '',
  idleOnly: DEFAULTS.idleOnly,
  busyThreshold: DEFAULTS.busyThreshold,
  lowerPriority: DEFAULTS.lowerPriority,
};

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

function option(value, label) {
  return el('option', { value }, label);
}

// The current generated text, by the key the copy/download buttons name.
const output = { oneliner: '', toml: '', script: '' };

function readForm() {
  const poolId = $('pool').value;
  const pool = poolById(poolId);
  return {
    address: $('address').value.trim(),
    worker: $('worker').value,
    algo: $('algo').value,
    pool: poolId,
    poolUrl: poolId === 'custom' ? $('pool-url').value.trim() : pool.url,
    platform: $('platform').value,
    maxCpuPercent: $('max-cpu-percent').value,
    threads: $('threads').value,
    idleOnly: $('idle-only').checked,
    busyThreshold: $('busy-threshold').value,
    lowerPriority: $('lower-priority').checked,
  };
}

function fillForm(form) {
  $('address').value = form.address ?? '';
  $('worker').value = form.worker ?? '';
  $('algo').value = form.algo ?? DEFAULTS.algo;
  $('pool').value = form.pool ?? DEFAULTS.pool;
  $('pool-url').value = form.poolUrl ?? '';
  $('platform').value = form.platform ?? DEFAULTS.platform;
  $('max-cpu-percent').value = form.maxCpuPercent ?? DEFAULTS.maxCpuPercent;
  $('threads').value = form.threads ?? '';
  $('idle-only').checked = form.idleOnly ?? DEFAULTS.idleOnly;
  $('busy-threshold').value = form.busyThreshold ?? DEFAULTS.busyThreshold;
  $('lower-priority').checked = form.lowerPriority ?? DEFAULTS.lowerPriority;
}

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

function setStatus(address) {
  const node = $('status');
  if (!address) {
    node.textContent = 'BTC 수신 주소를 넣으면 아래 명령이 완성됩니다.';
    node.className = 'status';
    return;
  }
  const check = checkAddress(address);
  if (check.ok) {
    node.textContent = `주소 확인됨 (${check.kind}). 아래를 복사해서 실행하세요.`;
    node.className = 'status ok';
  } else {
    node.textContent = '주소가 BTC 주소 형식이 아닙니다. 명령은 만들어 두지만, 주소를 다시 확인하세요.';
    node.className = 'status caution';
  }
}

function setNotes(form) {
  const algo = ALGOS.find((a) => a.id === form.algo);
  const pool = poolById(form.pool);
  const platform = platformById(form.platform);
  const algoNote = $('algo-note');
  if (pool.algo && pool.algo !== form.algo) {
    const wanted = ALGOS.find((a) => a.id === pool.algo);
    algoNote.textContent = `선택한 풀은 ${wanted ? wanted.label.split(' ')[0] : pool.algo}용입니다. 알고리즘을 맞추는 게 좋습니다.`;
    algoNote.className = 'fine caution';
  } else {
    algoNote.textContent = algo ? algo.note : '';
    algoNote.className = 'fine';
  }
  $('platform-note').textContent = platform.note;
}

function render() {
  const form = readForm();

  // The commands show a visible placeholder until there is a real address.
  const address = form.address || ADDRESS_PLACEHOLDER;
  const opts = {
    address,
    worker: form.worker,
    algo: form.algo,
    poolUrl: form.poolUrl,
    pass: 'x',
    threads: form.threads,
    maxCpuPercent: form.maxCpuPercent,
    idleOnly: form.idleOnly,
    busyThreshold: form.busyThreshold,
    lowerPriority: form.lowerPriority,
  };

  output.oneliner = oneLiner(opts, form.platform);
  output.toml = configToml(opts);
  output.script = runScript(opts, form.platform);

  $('oneliner').textContent = output.oneliner;
  $('toml').textContent = output.toml;
  $('script').textContent = output.script;

  const platform = platformById(form.platform);
  $('oneliner-plat').textContent = platform.label;
  $('script-name').textContent = scriptName(form.platform);
  $('devices-cmd').textContent = `${bareCommand({ ...opts }, form.platform).split(' ')[0]} --print-devices`;

  setStatus(form.address);
  setNotes(form);

  const algo = ALGOS.find((a) => a.id === form.algo);
  $('summary').textContent = [
    algo ? algo.label.split(' ')[0] : form.algo,
    poolById(form.pool).label.split(' ')[0],
    platform.label,
    form.threads ? `${form.threads} 스레드` : `CPU ${form.maxCpuPercent}%`,
  ].join(' · ');

  return form;
}

function syncEnabled() {
  const custom = $('pool').value === 'custom';
  $('pool-url-field').hidden = !custom;
  // Threads override the CPU percentage, so dim it when a thread count is set.
  const hasThreads = Number($('threads').value) > 0;
  $('max-cpu-percent').disabled = hasThreads;
  // The busy threshold only matters while idle-only pauses mining.
  $('busy-threshold').disabled = !$('idle-only').checked;
}

function changed() {
  syncEnabled();
  saveForm(render());
  $('example-note').hidden = true;
}

// Picking a preset pool lines the algorithm up with it.
function poolChanged() {
  const pool = poolById($('pool').value);
  if (pool.algo) $('algo').value = pool.algo;
  changed();
}

function reset() {
  saveForm(null);
  fillForm(EXAMPLE);
  $('example-note').hidden = false;
  syncEnabled();
  render();
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { style: 'position:fixed;top:0;left:0;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
    ta.remove();
  }
  const label = btn.textContent;
  btn.textContent = '복사됨';
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1200);
}

function download(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function main() {
  $('algo').replaceChildren(...ALGOS.map((a) => option(a.id, a.label)));
  $('pool').replaceChildren(...POOLS.map((p) => option(p.id, p.label)));
  $('platform').replaceChildren(...PLATFORMS.map((p) => option(p.id, p.label)));

  const saved = loadForm();
  fillForm({ ...EXAMPLE, ...saved });
  $('example-note').hidden = Boolean(saved);

  for (const id of ['address', 'worker', 'pool-url', 'max-cpu-percent', 'threads', 'busy-threshold']) {
    $(id).addEventListener('input', changed);
  }
  for (const id of ['algo', 'platform', 'idle-only', 'lower-priority']) {
    $(id).addEventListener('change', changed);
  }
  $('pool').addEventListener('change', poolChanged);
  $('reset').addEventListener('click', reset);
  $('form').addEventListener('submit', (event) => event.preventDefault());

  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', () => copyText(output[btn.dataset.copy], btn));
  }
  $('dl-toml').addEventListener('click', () => download('config.toml', output.toml));
  $('dl-script').addEventListener('click', () => download(scriptName($('platform').value), output.script));

  syncEnabled();
  render();
}

main();
