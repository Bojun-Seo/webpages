// What the page works out, kept apart from the DOM so Node can test it.
//
// sparemine is a native command-line miner. This page never mines; it only
// turns what the visitor enters — a BTC receive address and a few options —
// into the exact things they run on their own machine: a one-line command
// that downloads the binary and starts it, a config.toml, and a ready-made
// run script. The wallet address is a public RECEIVE address and never
// leaves the browser; it is only pasted into the text the page shows.

// Where the published binaries live. Option (a): a Release on this public
// repository, so the download link needs no login. `base` ends in a slash
// and takes an asset name; `page` is the human-facing Releases list.
export const RELEASE = {
  base: 'https://github.com/bojun-seo/webpages/releases/latest/download/',
  page: 'https://github.com/bojun-seo/webpages/releases',
};

// The binary to download per target. All three carry RandomX and SHA256d,
// so the chosen algorithm is always supported. The SHA256d-only build is a
// "does it run" demo and is deliberately left out here.
export const PLATFORMS = [
  {
    id: 'linux-static',
    label: 'Linux (권장 · 완전 정적)',
    os: 'linux',
    asset: 'sparemine-linux-x86_64-randomx-static',
    note: 'glibc·libstdc++ 없이 어떤 x86-64 리눅스에서도 바로 실행됩니다.',
  },
  {
    id: 'linux-gnu',
    label: 'Linux (glibc 폴백)',
    os: 'linux',
    asset: 'sparemine-linux-x86_64-randomx',
    note: '정적 빌드가 말썽이면 glibc ≥ 2.34 · libstdc++ 환경에서 쓰세요.',
  },
  {
    id: 'windows',
    label: 'Windows',
    os: 'windows',
    asset: 'sparemine-windows-x86_64-randomx.exe',
    note: 'PowerShell에서 내려받아 실행합니다.',
  },
];

// The hashing algorithm. RandomX earns on a CPU; SHA256d is an ASIC
// algorithm, kept for proving the whole path end to end.
export const ALGOS = [
  {
    id: 'randomx',
    label: 'RandomX (CPU 수익형 · 권장)',
    note: 'CPU로 실제 수익이 나는 알고리즘. BTC 지급 풀로 보내면 BTC로 정산됩니다.',
  },
  {
    id: 'sha256d',
    label: 'SHA256d (데모 · 경로 검증)',
    note: 'ASIC용이라 CPU로는 수익이 없고, 전체 채굴 경로를 검증하는 용도입니다.',
  },
];

// Pools paid out in BTC (the NiceHash model). "직접 입력" lets the visitor
// type any host:port; its `algo` is null so it does not force a choice.
export const POOLS = [
  {
    id: 'nicehash-randomx',
    label: 'NiceHash · RandomX (BTC 지급)',
    url: 'randomxmonero.auto.nicehash.com:9200',
    algo: 'randomx',
  },
  {
    id: 'nicehash-sha256',
    label: 'NiceHash · SHA256 (BTC 지급)',
    url: 'sha256.auto.nicehash.com:9200',
    algo: 'sha256d',
  },
  { id: 'custom', label: '직접 입력', url: '', algo: null },
];

// What the form starts with. These mirror sparemine's own cautious defaults,
// except max_cpu_percent, which the miner leaves at 50 and the page lowers to
// 40 to stay further out of the way.
export const DEFAULTS = {
  worker: 'rig1',
  algo: 'randomx',
  pool: 'nicehash-randomx',
  platform: 'linux-static',
  pass: 'x',
  threads: null,
  maxCpuPercent: 40,
  idleOnly: true,
  busyThreshold: 0.25,
  lowerPriority: true,
};

export function platformById(id) {
  return PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
}

export function poolById(id) {
  return POOLS.find((p) => p.id === id) || POOLS[0];
}

export function assetUrl(asset) {
  return RELEASE.base + asset;
}

// A worker name as the pool will accept it: letters, digits, '-' and '_',
// at most 32 of them.
export function cleanWorker(worker) {
  return String(worker || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

// The Stratum username for a BTC-payout pool: the receive address, and the
// worker name after a dot when there is one.
export function userField(address, worker) {
  const addr = String(address || '').trim();
  const name = cleanWorker(worker);
  return name ? `${addr}.${name}` : addr;
}

// Whether `addr` looks like a BTC receive address. Lenient on purpose: it
// catches an empty or obviously wrong entry without rejecting a valid one,
// since the page still generates usable text for any pool username.
export function checkAddress(addr) {
  const s = String(addr || '').trim();
  if (!s) return { ok: false, kind: null, reason: 'empty' };
  if (/^(bc1|tb1)[0-9ac-hj-np-z]{8,87}$/.test(s)) return { ok: true, kind: 'bech32' };
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(s)) return { ok: true, kind: 'base58' };
  return { ok: false, kind: null, reason: 'format' };
}

export function clampPercent(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULTS.maxCpuPercent;
  return Math.min(100, Math.max(1, v));
}

export function clampThreshold(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULTS.busyThreshold;
  return Math.min(0.95, Math.max(0.05, Math.round(v * 100) / 100));
}

// A clean, fully defaulted settings object the generators below all read, so
// one place decides what an empty or out-of-range field becomes.
export function normalize(raw) {
  const r = raw || {};
  const threads = r.threads != null && String(r.threads) !== '' && Number(r.threads) > 0
    ? Math.floor(Number(r.threads))
    : null;
  return {
    address: String(r.address || '').trim(),
    worker: cleanWorker(r.worker),
    algo: ALGOS.some((a) => a.id === r.algo) ? r.algo : DEFAULTS.algo,
    poolUrl: String(r.poolUrl || '').trim(),
    pass: String(r.pass || '').trim() || 'x',
    threads,
    maxCpuPercent: clampPercent(r.maxCpuPercent),
    idleOnly: Boolean(r.idleOnly),
    busyThreshold: clampThreshold(r.busyThreshold),
    lowerPriority: r.lowerPriority == null ? true : Boolean(r.lowerPriority),
  };
}

// The command-line flags, in the order sparemine documents them. `--threads`
// overrides `--max-cpu-percent`, so only one is emitted. The default pass
// ("x"), the default busy threshold and the default priority behaviour are
// left off to keep the line short.
export function argsFor(opts) {
  const o = normalize(opts);
  const args = ['--url', o.poolUrl, '--user', userField(o.address, o.worker)];
  if (o.pass !== 'x') args.push('--pass', o.pass);
  args.push('--algo', o.algo);
  if (o.threads != null) args.push('--threads', String(o.threads));
  else args.push('--max-cpu-percent', String(o.maxCpuPercent));
  if (o.idleOnly) {
    args.push('--idle-only');
    if (o.busyThreshold !== DEFAULTS.busyThreshold) {
      args.push('--busy-threshold', String(o.busyThreshold));
    }
  }
  if (!o.lowerPriority) args.push('--no-lower-priority');
  return args;
}

// `./sparemine <flags>` on Linux, `.\sparemine.exe <flags>` on Windows: the
// command once the binary is already in the current directory.
export function bareCommand(opts, platformId) {
  const platform = platformById(platformId);
  const bin = platform.os === 'windows' ? '.\\sparemine.exe' : './sparemine';
  return `${bin} ${argsFor(opts).join(' ')}`;
}

// One line that downloads the binary and starts it. On Linux a curl + chmod +
// run; on Windows a PowerShell download + run.
export function oneLiner(opts, platformId) {
  const platform = platformById(platformId);
  const url = assetUrl(platform.asset);
  const flags = argsFor(opts).join(' ');
  if (platform.os === 'windows') {
    return `Invoke-WebRequest ${url} -OutFile sparemine.exe; .\\sparemine.exe ${flags}`;
  }
  return `curl -fsSL ${url} -o sparemine && chmod +x sparemine && ./sparemine ${flags}`;
}

// A config.toml that `sparemine --config config.toml` reads. Keys and sections
// match miner-core's Config exactly.
export function configToml(opts) {
  const o = normalize(opts);
  const lines = [
    '[pool]',
    `url = "${o.poolUrl}"`,
    `user = "${userField(o.address, o.worker)}"`,
    `pass = "${o.pass}"`,
    `algo = "${o.algo}"`,
    '',
    '[mining]',
  ];
  if (o.threads != null) lines.push(`threads = ${o.threads}`);
  else lines.push(`max_cpu_percent = ${o.maxCpuPercent}`);
  lines.push(`idle_only = ${o.idleOnly}`);
  lines.push(`busy_threshold = ${o.busyThreshold}`);
  lines.push(`lower_priority = ${o.lowerPriority}`);
  return lines.join('\n') + '\n';
}

// A self-contained script that downloads the binary and runs it, for the
// visitor who would rather save a file than paste a line. `.sh` for Linux,
// `.ps1` for Windows.
export function runScript(opts, platformId) {
  const platform = platformById(platformId);
  const url = assetUrl(platform.asset);
  const flags = argsFor(opts).join(' ');
  const origin = 'https://bojun-seo.github.io/webpages/sparemine/';
  if (platform.os === 'windows') {
    return [
      `# sparemine — ${origin} 에서 생성한 실행 스크립트`,
      '# 내려받은 뒤 내용을 확인하고 PowerShell에서 실행하세요.',
      "$ErrorActionPreference = 'Stop'",
      `Invoke-WebRequest ${url} -OutFile sparemine.exe`,
      `.\\sparemine.exe ${flags}`,
      '',
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    `# sparemine — ${origin} 에서 생성한 실행 스크립트`,
    '# 내려받은 뒤 내용을 확인하고 실행하세요: sh run-sparemine.sh',
    'set -eu',
    `url="${url}"`,
    'curl -fsSL "$url" -o sparemine',
    'chmod +x sparemine',
    `exec ./sparemine ${flags}`,
    '',
  ].join('\n');
}

// The filename the run script downloads as.
export function scriptName(platformId) {
  return platformById(platformId).os === 'windows' ? 'run-sparemine.ps1' : 'run-sparemine.sh';
}
