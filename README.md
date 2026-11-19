<div align="center">

<img src="assets/hero.svg" alt="OmniPlay — universal media player" width="100%" />

<br/>

**A media player that actually plays your files.** MKV, HEVC, AV1, HLS, DASH, torrents,
multi-audio, ASS and PGS subtitles — in the browser, on your device, with no uploads,
no accounts and no tracking.

<br/>

[![Release](https://img.shields.io/badge/release-v1.24-6d5efc?style=for-the-badge)](#)
[![Engines](https://img.shields.io/badge/engines-4-22d3ee?style=for-the-badge)](#the-four-engines)
[![Tests](https://img.shields.io/badge/tests-176%20passing-2ea043?style=for-the-badge)](#quality)
[![PWA](https://img.shields.io/badge/PWA-installable-f472b6?style=for-the-badge)](#install-it)
[![License](https://img.shields.io/badge/license-MIT-8b94ad?style=for-the-badge)](#license)

[**Quick start**](#quick-start) · [**The four engines**](#the-four-engines) · [**Features**](#features) · [**Embed**](#embed-it-on-your-site) · [**Screens**](#screens) · [**Deploy**](#deploy)

</div>

---

## Why this exists

Most browser players are `<video controls>` with a nicer skin. That works until you hand
them a 10-bit HEVC MKV with three audio tracks and PGS subtitles — then it silently fails,
or plays the video with no sound and no subtitles.

OmniPlay reads the container itself. It probes the bytes, picks the engine that can
actually decode them, and falls through to another one when that engine cannot. If the
server blocks browser access entirely, it says so in plain language and tells you which
of the four real fixes applies to your situation — instead of showing a spinner forever.

<div align="center">
<img src="assets/engines.svg" alt="Engine selection and fallback chain" width="100%" />
</div>

---

## The four engines

| Engine | Handles | Why it exists |
| :-- | :-- | :-- |
| **Native `<video>`** | MP4 · WebM · MOV, anything the browser decodes | Hardware decoding, zero main-thread cost. Always tried first when supported. |
| **HLS.js / DASH.js** | `.m3u8` · `.mpd` adaptive streams | Quality levels, audio renditions, live edge, subtitle renditions |
| **WebCodecs + mediabunny** | MKV · HEVC · AV1 · multi-audio · embedded ASS/PGS | Software decode into a canvas, so containers the browser refuses still play |
| **Provider embed** | YouTube · Vimeo · Twitch · Dailymotion · Streamable | Their streams are protected; their own player is the correct answer |

> **Honest limits.** H.264/HEVC inside MKV cannot be demuxed without reading the bytes, so a
> host that sends no `Access-Control-Allow-Origin` blocks every browser-only player — this one
> included. DTS, TrueHD and VC-1 need decoders browsers do not ship. `.idx/.sub` DVD subtitles
> are not decoded. The player tells you which of these you hit rather than pretending.

---

## Features

<table>
<tr>
<td width="50%" valign="top">

**Playback**

- Four-engine chain with automatic fallback
- Stall recovery that keeps your timestamp
- Mirror ranking from measured startup time
- Quality, speed, A-B loop, chapters
- Live streams with a live-edge button
- Smart resume: position, audio track, subtitle, speed

</td>
<td width="50%" valign="top">

**Subtitles & audio**

- SRT · VTT · ASS · SSA with real styling
- **Embedded** ASS and PGS extracted from the container
- Bitmap subtitle rendering on canvas
- Multiple audio tracks, switchable mid-play
- 10-band equaliser, balance, delay, mono
- Volume applied instantly on both audio paths

</td>
</tr>
<tr>
<td valign="top">

**Interface**

- Danmaku with lanes, colours and a composer
- Stats-for-nerds overlay
- Right-click menu, shortcut sheet, lock screen
- Gestures: seek, volume, brightness, zoom
- Responsive from 320 px to 4K, plus TV layout
- Light motion design, disabled on low-memory devices

</td>
<td valign="top">

**Everything else**

- Torrents: in-page WebTorrent or your gateway
- Downloads with real range resume
- M3U playlists, import and export
- Media tools: remux, compress, extract (FFmpeg.wasm, opt-in)
- PWA: installable, works offline
- 176 unit tests, 14-viewport layout audit

</td>
</tr>
</table>

---

## Screens

<div align="center">

### Desktop

<img src="assets/screenshots/home.png" alt="Library" width="49%" />
<img src="assets/screenshots/player.png" alt="Player" width="49%" />

<img src="assets/screenshots/multi-audio.png" alt="Multiple audio tracks" width="49%" />
<img src="assets/screenshots/embedded-ass.png" alt="Embedded ASS subtitles" width="49%" />

<img src="assets/screenshots/danmaku.png" alt="Danmaku" width="49%" />
<img src="assets/screenshots/stats.png" alt="Stats for nerds" width="49%" />

</div>

<details>
<summary><b>More screens — subtitles, panels, torrents, developer docs</b></summary>

<br/>

<div align="center">

<img src="assets/screenshots/embedded-pgs.png" alt="PGS bitmap subtitles" width="49%" />
<img src="assets/screenshots/context-menu.png" alt="Context menu" width="49%" />

<img src="assets/screenshots/shortcuts.png" alt="Keyboard shortcuts" width="49%" />
<img src="assets/screenshots/audio-panel.png" alt="Audio panel and equaliser" width="49%" />

<img src="assets/screenshots/torrents.png" alt="Torrents" width="49%" />
<img src="assets/screenshots/diagnostics.png" alt="Diagnostics" width="49%" />

<img src="assets/screenshots/developers.png" alt="Developer documentation" width="49%" />
<img src="assets/screenshots/webcodecs-engine.png" alt="WebCodecs engine" width="49%" />

</div>

</details>

<details>
<summary><b>Mobile</b></summary>

<br/>

<div align="center">

<img src="assets/screenshots/mobile-home.png" alt="Mobile library" width="31%" />
<img src="assets/screenshots/mobile-player.png" alt="Mobile player" width="31%" />
<img src="assets/screenshots/mobile-sheet.png" alt="Mobile control sheet" width="31%" />

</div>

</details>

---

## Quick start

```bash
git clone https://github.com/process-killed/omniplayer
cd omniplayer
npm ci --ignore-scripts     # --ignore-scripts is required: one dependency runs a failing postinstall
npm run build
npx serve dist              # or any static server
```

Open the printed URL. That is the whole setup — there is no backend, no database and no
environment variables to configure.

<details>
<summary><b>Why <code>--ignore-scripts</code>?</b></summary>

<br/>

`webtorrent` pulls a dependency whose install script runs `npx only-allow pnpm`, which fails
outside pnpm and aborts the install. Nothing in the build needs those scripts: the browser
bundle is vendored at `public/vendor/webtorrent.min.js`.

</details>

---

## Embed it on your site

<div align="center">
<img src="assets/embed.svg" alt="Embed flow" width="100%" />
</div>

```html
<div style="position:relative;width:100%;aspect-ratio:16/9">
  <iframe
    src="https://your-host/#/embed?src=ENCODED_URL&muted=1&origins=https://yoursite.com"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
    allowfullscreen referrerpolicy="no-referrer" loading="lazy"
  ></iframe>
</div>
```

Four integrations, 24 parameters, 14 commands and 8 events — all documented with copy
buttons inside the app at **For developers**, including a live preview on a public HLS
stream. Highlights: `playlist=` for episode chains, `chromeless=1` for hero banners,
`branding=0` for white-label, `remember=1` to resume, `origins=` to restrict who can
send commands.

```js
const player = OmniPlay.mount('#player', { src, muted: true, autoplay: true });
player.on((event) => console.log(event.type));
```

---

## Keyboard

| Key | Action | Key | Action |
| :-- | :-- | :-- | :-- |
| `Space` / `K` | Play or pause | `←` `→` | Seek ±5 s |
| `J` / `L` | Seek ±10 s | `↑` `↓` | Volume |
| `F` | Fullscreen | `M` | Mute |
| `C` | Subtitles | `D` | Danmaku |
| `I` | Stats overlay | `?` | Shortcut sheet |
| `0`–`9` | Jump to 0–90 % | `,` `.` | Frame step |

All bindings are remappable in **Settings → Keyboard**, and the shortcut sheet reads your
custom map, so it never goes stale.

---

## Deploy

<details open>
<summary><b>Cloudflare Pages</b></summary>

<br/>

| Setting | Value |
| :-- | :-- |
| Build command | `npm ci --ignore-scripts && npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave empty)* |

The build ships `_headers` (manifest as `application/manifest+json`, `no-cache` for
`sw.js`, immutable assets) and `_redirects` (SPA fallback). Upload **`dist/`** — deploying
the repository root serves `src/*.ts` and produces
`Expected a JavaScript module script … "video/mp2t"`.

</details>

<details>
<summary><b>Any static host</b></summary>

<br/>

Serve `dist/` at the domain root and fall unknown paths back to `index.html`:

```nginx
location / { try_files $uri $uri/ /index.html; }
location = /manifest.webmanifest { types { } default_type application/manifest+json; }
```

</details>

---

## Quality

<div align="center">

| Suite | What it covers |
| :-- | :-- |
| **176 unit tests** | engines, subtitles, torrents, downloads, embeds, profiles |
| **10 browser suites** | playback, UI, embed, CORS, multi-audio, subtitles, WebCodecs, PWA |
| **14-viewport audit** | 320 × 568 → 3840 × 2160, 200 % zoom, 44 px touch targets |

</div>

```bash
npm test          # unit
npm run smoke     # playback
npm run cors      # proxy, gateway, preflight
npm run audit     # every viewport, every route
npm run test:all  # everything
```

---

## Architecture

```text
src/
├── core/          engine selection, playback manager, CORS, health, profiles
├── engines/       native · hls · dash · webcodecs
├── subtitles/     parser, ASS renderer, Matroska extraction, PGS decoder
├── audio/         Web Audio graph, 10-band EQ
├── downloads/     range downloader, queue, IndexedDB chunks
├── torrent/       WebTorrent session, magnet parsing
├── media/         formats, thumbnails, FFmpeg tools
├── sources/       link adapters (files, HLS, DASH, IPFS, providers)
├── ui/            player, panels, pages
└── storage/       IndexedDB library, settings, resume
```

Everything is plain TypeScript with no UI framework. Engine bundles load lazily — a
session that only plays an MP4 never downloads hls.js, dash.js or mediabunny.

---

## Install it

OmniPlay is a PWA: install from the browser menu, then launch it offline. The service
worker precaches the shell and the player, so a cached session starts instantly and keeps
working without a network.

---

## License

MIT. Built on the shoulders of [hls.js](https://github.com/video-dev/hls.js),
[dash.js](https://github.com/Dash-Industry-Forum/dash.js),
[mediabunny](https://github.com/Vanilagy/mediabunny) and
[WebTorrent](https://github.com/webtorrent/webtorrent).

<div align="center">
<br/>
<sub><b>OmniPlay</b> · everything plays on your device · nothing is uploaded</sub>
</div>
