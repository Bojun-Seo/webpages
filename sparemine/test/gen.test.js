import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULTS,
  PLATFORMS,
  POOLS,
  argsFor,
  bareCommand,
  checkAddress,
  cleanWorker,
  configToml,
  normalize,
  oneLiner,
  psWord,
  runScript,
  scriptName,
  shWord,
  threadsOf,
  tomlString,
  userField,
} from '../site/gen.js';

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const base = {
  address: BTC,
  worker: 'rig1',
  algo: 'randomx',
  poolUrl: 'randomxmonero.auto.nicehash.com:9200',
};

test('userField joins address and worker with a dot', () => {
  assert.equal(userField(BTC, 'rig1'), `${BTC}.rig1`);
  assert.equal(userField(BTC, ''), BTC);
  assert.equal(userField(`  ${BTC} `, '  '), BTC);
});

test('cleanWorker keeps only safe characters and caps the length', () => {
  assert.equal(cleanWorker('rig 1!'), 'rig1');
  assert.equal(cleanWorker('home-pc_2'), 'home-pc_2');
  assert.equal(cleanWorker('x'.repeat(40)).length, 32);
});

test('checkAddress accepts bech32 and base58, rejects junk', () => {
  assert.equal(checkAddress(BTC).ok, true);
  assert.equal(checkAddress(BTC).kind, 'bech32');
  assert.equal(checkAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2').ok, true);
  assert.equal(checkAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy').ok, true);
  assert.equal(checkAddress('').ok, false);
  assert.equal(checkAddress('not an address').ok, false);
  // A bech32 address all in capitals, as a QR code gives it, is the same address.
  assert.equal(checkAddress(BTC.toUpperCase()).kind, 'bech32');
});

test('normalize fills defaults and clamps out-of-range values', () => {
  const o = normalize({ address: BTC, poolUrl: base.poolUrl, maxCpuPercent: 999, busyThreshold: 5 });
  assert.equal(o.pass, 'x');
  assert.equal(o.algo, DEFAULTS.algo);
  assert.equal(o.maxCpuPercent, 100);
  assert.equal(o.busyThreshold, 0.95);
  assert.equal(o.threads, null);
  assert.equal(o.lowerPriority, true);
});

test('normalize treats a positive thread count as explicit', () => {
  assert.equal(normalize({ threads: '4' }).threads, 4);
  assert.equal(normalize({ threads: 0 }).threads, null);
  assert.equal(normalize({ threads: '' }).threads, null);
});

test('a thread count is a whole number of one or more, and anything else leaves the CPU share to decide', () => {
  assert.equal(threadsOf('2.9'), 2);
  assert.equal(threadsOf('0.5'), null);
  assert.equal(threadsOf('-3'), null);
  assert.equal(threadsOf('many'), null);
  assert.equal(threadsOf(' '), null);
  assert.equal(threadsOf(undefined), null);
  const args = argsFor({ ...base, threads: '0.5', maxCpuPercent: 30 });
  assert.ok(!args.includes('--threads'));
  assert.equal(args[args.indexOf('--max-cpu-percent') + 1], '30');
});

test('normalize follows the page\'s defaults for what it is not told', () => {
  const o = normalize({});
  assert.equal(o.idleOnly, DEFAULTS.idleOnly);
  assert.equal(o.lowerPriority, DEFAULTS.lowerPriority);
  assert.equal(normalize({ idleOnly: false }).idleOnly, false);
  // A line break pasted with an address does not reach the command.
  assert.equal(normalize({ address: ` ${BTC}\r\n` }).address, BTC);
});

test('--idle-only is left out on a platform that does not offer it', () => {
  assert.deepEqual(PLATFORMS.map((p) => `${p.os} ${p.idleOnly}`), ['linux true', 'linux true', 'windows false']);
  const opts = { ...base, idleOnly: true, busyThreshold: 0.4 };
  assert.ok(argsFor(opts, 'linux-static').includes('--idle-only'));
  assert.ok(argsFor(opts).includes('--idle-only'));
  const windows = argsFor(opts, 'windows');
  assert.ok(!windows.includes('--idle-only') && !windows.includes('--busy-threshold'));
  assert.ok(!oneLiner(opts, 'windows').includes('--idle-only'));
  assert.ok(!runScript(opts, 'windows').includes('--idle-only'));
  assert.match(configToml(opts, 'windows'), /idle_only = false/);
  assert.match(configToml(opts, 'linux-gnu'), /idle_only = true/);
});

test('a word is quoted for its shell only when the shell would read it otherwise', () => {
  assert.equal(shWord(`${BTC}.rig1`), `${BTC}.rig1`);
  assert.equal(shWord('randomxmonero.auto.nicehash.com:9200'), 'randomxmonero.auto.nicehash.com:9200');
  assert.equal(shWord('stratum+tcp://pool.example:3333'), 'stratum+tcp://pool.example:3333');
  assert.equal(shWord('host:1; echo hi'), "'host:1; echo hi'");
  assert.equal(shWord("it's"), "'it'\\''s'");
  assert.equal(shWord(''), "''");
  assert.equal(psWord(`${BTC}.rig1`), `${BTC}.rig1`);
  assert.equal(psWord('host:1; echo hi'), "'host:1; echo hi'");
  assert.equal(psWord("it's"), "'it''s'");
  assert.equal(psWord('a,b'), "'a,b'");
  assert.equal(tomlString('ho"st\\:1'), '"ho\\"st\\\\:1"');
});

test('what the visitor types by hand cannot end the command or the config where it stands', () => {
  const odd = { ...base, poolUrl: 'host:1; echo "hi"', address: 'me@example.com wallet' };
  assert.match(oneLiner(odd, 'linux-static'),
    / \.\/sparemine --url 'host:1; echo "hi"' --user 'me@example\.com wallet\.rig1' --algo randomx /);
  assert.match(oneLiner(odd, 'windows'), /sparemine\.exe --url 'host:1; echo "hi"' --user 'me@example\.com wallet\.rig1' /);
  assert.match(runScript(odd, 'linux-static'), /exec \.\/sparemine --url 'host:1; echo "hi"' /);
  assert.match(configToml(odd), /^url = "host:1; echo \\"hi\\""$/m);
  // What needs no quoting stays as it was.
  assert.match(oneLiner(base, 'linux-static'), new RegExp(` --url ${base.poolUrl} --user ${BTC}\\.rig1 --algo randomx `));
});

test('the preset pools line an algorithm up with an endpoint, and NiceHash says which address it takes', () => {
  assert.deepEqual(POOLS.map((p) => `${p.id} ${p.url} ${p.algo}`), [
    'nicehash-randomx randomxmonero.auto.nicehash.com:9200 randomx',
    'nicehash-sha256 sha256.auto.nicehash.com:9200 sha256d',
    'custom  null',
  ]);
  assert.deepEqual(POOLS.map((p) => Boolean(p.note)), [true, true, false]);
});

test('argsFor emits documented flags and omits defaults', () => {
  const args = argsFor({ ...base, maxCpuPercent: 40, idleOnly: true });
  assert.deepEqual(args, [
    '--url', 'randomxmonero.auto.nicehash.com:9200',
    '--user', `${BTC}.rig1`,
    '--algo', 'randomx',
    '--max-cpu-percent', '40',
    '--idle-only',
  ]);
});

test('argsFor includes pass, threads, busy-threshold and no-lower-priority when non-default', () => {
  const args = argsFor({
    ...base, pass: 'secret', threads: 3, idleOnly: true, busyThreshold: 0.4, lowerPriority: false,
  });
  assert.ok(args.includes('--pass') && args[args.indexOf('--pass') + 1] === 'secret');
  assert.ok(args.includes('--threads') && args[args.indexOf('--threads') + 1] === '3');
  assert.ok(!args.includes('--max-cpu-percent'), 'threads overrides max-cpu-percent');
  assert.ok(args.includes('--busy-threshold') && args[args.indexOf('--busy-threshold') + 1] === '0.4');
  assert.ok(args.includes('--no-lower-priority'));
});

test('argsFor drops --idle-only and --busy-threshold when idle is off', () => {
  const args = argsFor({ ...base, idleOnly: false, busyThreshold: 0.4 });
  assert.ok(!args.includes('--idle-only'));
  assert.ok(!args.includes('--busy-threshold'));
});

test('oneLiner downloads and runs per platform', () => {
  const linux = oneLiner(base, 'linux-static');
  assert.match(linux, /^curl -fsSL https:\/\/github\.com\/bojun-seo\/webpages\/releases\/latest\/download\/sparemine-linux-x86_64-randomx-static -o sparemine && chmod \+x sparemine && \.\/sparemine /);
  // On Windows the miner starts only if the download worked.
  const win = oneLiner(base, 'windows');
  assert.match(win, /^Invoke-WebRequest \S+sparemine-windows-x86_64-randomx\.exe -OutFile sparemine\.exe; if \(\$\?\) \{ \.\\sparemine\.exe --url .* \}$/);
});

test('bareCommand uses the right binary name per OS', () => {
  assert.match(bareCommand(base, 'linux-static'), /^\.\/sparemine --url /);
  assert.match(bareCommand(base, 'windows'), /^\.\\sparemine\.exe --url /);
});

test('configToml matches miner-core keys and parses back the key fields', () => {
  const toml = configToml({ ...base, maxCpuPercent: 40, idleOnly: true });
  assert.match(toml, /\[pool\]/);
  assert.match(toml, new RegExp(`user = "${BTC}\\.rig1"`));
  assert.match(toml, /algo = "randomx"/);
  assert.match(toml, /\[mining\]/);
  assert.match(toml, /max_cpu_percent = 40/);
  assert.match(toml, /idle_only = true/);
  assert.match(toml, /busy_threshold = 0.25/);
  assert.match(toml, /lower_priority = true/);
  // threads replaces max_cpu_percent when set
  const withThreads = configToml({ ...base, threads: 2 });
  assert.match(withThreads, /threads = 2/);
  assert.ok(!/max_cpu_percent/.test(withThreads));
});

test('runScript is a shell script on Linux and PowerShell on Windows', () => {
  const sh = runScript(base, 'linux-static');
  assert.ok(sh.startsWith('#!/bin/sh'));
  assert.match(sh, /curl -fsSL "\$url" -o sparemine/);
  assert.match(sh, /exec \.\/sparemine --url /);
  assert.equal(scriptName('linux-static'), 'run-sparemine.sh');

  const ps = runScript(base, 'windows');
  assert.match(ps, /Invoke-WebRequest \S+ -OutFile sparemine\.exe/);
  assert.ok(ps.includes('\r\n'), 'PowerShell script uses CRLF');
  assert.equal(scriptName('windows'), 'run-sparemine.ps1');
});
