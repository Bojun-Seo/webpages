# sparemine launcher

A static page that turns a BTC receive address and a few options into the exact
things you run to start [sparemine](https://github.com/bojun-seo/applications/tree/master/sparemine)
— a multi-algorithm CPU/GPU miner paid out in BTC — on your own machine: a
one-line command, a `config.toml`, and a run script. GitHub Pages serves it;
there is no server.

**The page never mines.** sparemine is a native command-line program; a web
page cannot launch it, and this one does not try. It only writes out, in the
browser, the text you paste into your own terminal. The receive address stays
in the browser. This is the opposite of the in-browser "mine in the visitor's
tab" pattern (cryptojacking), which earns almost nothing and spends someone
else's battery.

The page is in Korean.

## Contents

- [What it does](#what-it-does)
- [Why a generator and not in-browser mining](#why-a-generator-and-not-in-browser-mining)
- [Publish the binaries](#publish-the-binaries)
- [Publish on GitHub Pages](#publish-on-github-pages)
- [Run and test locally](#run-and-test-locally)
- [Safety and the law](#safety-and-the-law)
- [Known limitations](#known-limitations)

## What it does

The visitor enters:

- a **BTC receive address** and a **worker name**, joined as the Stratum user
  `ADDRESS.worker` that a BTC-payout pool expects;
- the **algorithm** (RandomX, which earns on a CPU, or SHA256d, kept for
  proving the path end to end), the **pool** (a NiceHash BTC-payout endpoint or
  a `host:port` they type), and the **platform** to run on;
- how much of the machine to use — a **CPU percentage** or an explicit **thread
  count** — and whether to **pause while the machine is busy** (`--idle-only`)
  and **lower the process priority** (both on by default).

`site/gen.js` turns that into three things, shown live and copyable:

1. **A one-line command** that downloads the right binary and starts it: a
   `curl` + `chmod` + run on Linux, a PowerShell download + run on Windows.
2. **A `config.toml`** whose `[pool]` and `[mining]` keys match miner-core's
   `Config` exactly, for `sparemine --config config.toml`.
3. **A run script** (`run-sparemine.sh` or `run-sparemine.ps1`) that does the
   same as the one-liner but as a file you can read before running.

Picking a preset pool lines the algorithm up with it; a thread count overrides
the CPU percentage; and the busy threshold only shows while `--idle-only` is on,
so the generated flags stay valid. Until a real address is entered the commands
show `YOUR_BTC_ADDRESS`, so the shape is visible but nothing runs by accident.
The address is validated loosely (bech32 or base58) — enough to catch an empty
or obviously wrong entry without rejecting a valid one. What the visitor enters
is kept in the browser's local storage and sent nowhere.

The flag names, the `config.toml` keys and the NiceHash endpoints are checked
against sparemine itself in `test/gen.test.js`.

## Why a generator and not in-browser mining

sparemine is a native Rust binary: it loads an OpenCL runtime when a GPU is
present, calls into the reference RandomX C++ library, reads `/proc/stat` to
pause while the machine is busy, and lowers its own OS priority. None of that
exists in a browser sandbox, so there is nothing to "just run here". A WASM
miner in the page would be a different program entirely, would earn next to
nothing, and — on a public site — would run in whoever opened the page, which is
not mining for yourself. A page that writes the command you run on your own
hardware is the honest and useful shape, and it is the one that removes the real
pain: no hand-editing a config per platform, no remembering flags.

## Publish the binaries

The page links to binaries on **this repository's Releases**, so the download
needs no login:
`https://github.com/bojun-seo/webpages/releases/latest/download/<asset>`.

[`sparemine-binaries.yml`](../.github/workflows/sparemine-binaries.yml) builds
them from the (private) `applications` repository and publishes the Release
here. Push a tag like `sparemine-v0.1.0` to build and publish; a manual run
(**Actions → sparemine binaries → Run workflow**) builds the same binaries as
downloadable artifacts without creating a Release.

It needs one secret, **`APPLICATIONS_TOKEN`** — a fine-grained personal access
token with **Contents: Read** on `bojun-seo/applications` — to check the miner
source out of the private repo. Add it under **Settings → Secrets and variables
→ Actions**. The source ref defaults to `master`; override it on a manual run
(the `source_ref` input) while the miner still lives on a branch.

The assets it publishes, and that the page selects between, are:

| Asset | What |
|---|---|
| `sparemine-linux-x86_64-randomx-static` | RandomX + SHA256d, fully static; the page's default for Linux |
| `sparemine-linux-x86_64-randomx` | RandomX + SHA256d; needs glibc ≥ 2.34 + libstdc++ (fallback) |
| `sparemine-windows-x86_64-randomx.exe` | RandomX + SHA256d, for Windows |

Until the first Release exists the page still generates correct commands; only
the download link 404s. The asset names and the release base URL live in
`site/gen.js` (`RELEASE`, `PLATFORMS`), so moving the binaries elsewhere is a
one-place change.

## Publish on GitHub Pages

[`pages.yml`](../.github/workflows/pages.yml) runs the tests on every push that
touches `sparemine/`, and on the default branch publishes `site/` to
<https://bojun-seo.github.io/webpages/sparemine/>. The
[top-level README](../README.md#publishing) says how the site is put together.
The page itself needs no secret.

## Run and test locally

The page is plain static files with no `fetch`, so opening `site/index.html`
works; to serve it like Pages does:

```
cd sparemine
npm run serve        # http://localhost:8000
```

Tests need Node 20 or later and nothing else:

```
npm test
```

## Safety and the law

- sparemine only ever needs a **public BTC receive address**. It never asks
  for, stores or transmits a private key or seed phrase, and neither does this
  page. Keep your keys in your own wallet.
- Run it on **your own machine, or hardware whose owner has agreed**. Mining on
  a machine you do not own or have permission for — a PC-room or office PC as a
  customer or employee — uses someone else's electricity and hardware beyond
  what you are entitled to and may breach that venue's terms; circumventing a
  managed PC's lockdown to install it is a clearer problem. The footer says so.
  This is not legal advice.

## Known limitations

- The binaries are **x86-64 Linux and Windows** only, matching what sparemine's
  release builds. There is no macOS or ARM asset, so the page offers none.
- RandomX is the CPU algorithm that earns; SHA256d is an ASIC algorithm, offered
  only for proving the whole path. GPU (KawPoW) mining is not built yet, so the
  page has no GPU-specific option.
- The page builds the command; it cannot check that the pool is reachable, that
  the address is really yours, or that the binary has been published. Run
  `./sparemine --print-devices` first to see what hardware it found.
