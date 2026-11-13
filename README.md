<img width="1536" height="1024" alt="Neon Media Player Interface (1)" src="https://github.com/user-attachments/assets/3b78f0fd-ddce-4ad8-97fc-656d0f03b639" />
Seedance 2.0 | DeepLaunch.io

OmniPlayer
A modern, powerful and customizable media player.

# OmniPlay — Universal Browser Media Player

A professional, **100% client-side** media player for the browser: local files, direct
links, HLS and DASH, multiple audio languages, styled ASS subtitles, a ten-band
equaliser, picture controls, MX-style gestures and honest playback diagnostics.

Everything decodes on your device. There is no backend, no account, no analytics and
no media upload — the app is a folder of static files, installable as a PWA that works
offline.

```
open a file or paste a link  →  inspect it  →  pick the best engine  →  play
```

![Home](docs/screenshots/home.png)

| Player | Audio engine |
| --- | --- |
| ![Player](docs/screenshots/player.png) | ![Equaliser](docs/screenshots/audio-panel.png) |

| Diagnostics | Install as an app |
| --- | --- |
| ![Diagnostics](docs/screenshots/diagnostics.png) | ![Install](docs/screenshots/install-settings.png) |

| Phone player | Phone controls |
| --- | --- |
| ![Mobile player](docs/screenshots/mobile-player.png) | ![Action sheet](docs/screenshots/mobile-sheet.png) |

| Multi-audio tracks | Blocked host (CORS) |
| --- | --- |
| ![Multi-audio](docs/screenshots/multi-audio.png) | ![CORS error](docs/screenshots/cors-error.png) |

| CORS proxy setting | Embedded subtitle tracks |
| --- | --- |
| ![Proxy](docs/screenshots/cors-proxy.png) | ![Embedded tracks](docs/screenshots/embedded-tracks.png) |

| Embed builder | Embedded on another site |
| --- | --- |
| ![Embed builder](docs/screenshots/embed-builder.png) | ![Embed iframe](docs/screenshots/embed-iframe.png) |

| Torrents | For developers |
| --- | --- |
| ![Torrents](docs/screenshots/torrents.png) | ![Developers](docs/screenshots/developers.png) |

| Danmaku | Stats for nerds | Context menu |
| --- | --- | --- |
| ![Danmaku](docs/screenshots/danmaku.png) | ![Stats](docs/screenshots/stats.png) | ![Context menu](docs/screenshots/context-menu.png) |

| ASS from the file | PGS bitmap subtitle |
| --- | --- |
| ![ASS](docs/screenshots/embedded-ass.png) | ![PGS](docs/screenshots/embedded-pgs.png) |

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (static, deployable anywhere):

```bash
npm run build      # type-check + bundle into dist/
npm run preview    # serve dist/ on http://localhost:4173
```

`dist/` is fully static. Drop it on Cloudflare Pages, GitHub Pages, Netlify, S3, or any
web server. Because the app uses ES modules, serve it over HTTP — opening
`dist/index.html` from `file://` is blocked by the browser, not by the app.

> `base: './'` is set in `vite.config.ts`, so the build also works from a sub-path
> such as `https://user.github.io/omniplay/`.

---

## What it actually does

### Playback engines (chosen per source, never silently)

| Order | Engine | Used for | Notes |
| --- | --- | --- | --- |
| 1 | **Native** (`<video>`) | MP4/M4V/MOV/WebM/OGG/TS with supported codecs | Hardware decoding when the browser offers it; lowest power use |
| 2 | **MSE streaming** | HLS (`.m3u8`) via hls.js, DASH (`.mpd`) via dash.js | Adaptive bitrate, manual quality, audio/subtitle renditions, live |
| 3 | **WebCodecs** (mediabunny demuxer) | MKV, AVI, FLV, TS, MOV and unusual codecs | Frames decoded by `VideoDecoder`, painted to a canvas; audio through Web Audio |
| 4 | **Diagnostic stop** | Anything undecodable | Exact codec, reason, suggestions, copyable report |

Selection uses `MediaSource.isTypeSupported`, `canPlayType`, `VideoDecoder.isConfigSupported`,
real container sniffing (magic bytes) and demuxer metadata — not file extensions.
Fallbacks are announced in the UI and recorded in diagnostics; the chain is capped so it
can never loop.

### Media handling

- Containers probed: MP4, M4V, MOV, MKV, WebM, AVI, FLV, TS/M2TS, OGV/OGG, 3GP, ASF/WMV, VOB, MXF, F4V, MPEG-PS
- Video codecs: H.264, HEVC, AV1, VP8, VP9 (plus whatever else your browser's WebCodecs exposes)
- Audio codecs: AAC, MP3, Opus, Vorbis, FLAC, AC-3/E-AC-3, PCM (browser-dependent)
- Direct URLs with Range requests, progressive loading, redirects, custom headers (where CORS allows)
- HTTP/network inspection: content type, length, range support, CORS outcome, manifest validation

### Audio

- Real embedded audio tracks with language, codec, channel count and sample rate
- Preferred + fallback language rules, remembered between sessions
- 10-band equaliser with 13 presets and custom curves
- Bass, treble, balance, mono downmix, volume normalisation (compressor), audio delay (0–2000 ms)
- Web Audio chain: `input → EQ bands → shelves → compressor → mono → delay → pan → master`

### Subtitles

- SRT, WebVTT, ASS, SSA, TTML/DFXP parsers (forgiving of BOMs, CRLF, odd timestamps)
- **Styled ASS rendering**: PlayRes scaling, `\pos`, `\an`, `\move`, `\fad`, colours,
  outlines, shadows, blur, italics/bold/underline, per-run font sizes and karaoke (`\k`, `\K`, `\kf`)
- Per-track sync offset (±500/100/50 ms buttons), styling (font, size, weight, colour,
  outline, shadow, opacity, background, width, position)
- Embedded text tracks where the engine exposes them; file/URL loading with encoding detection

### Player (VLC-style transport)

- **Centre play overlay** with a spring animation, plus a bar play button — both work
- **Volume**: inline slider on desktop, popover on touch, mute toggle, remembered level
- **Brightness**: quick popover slider (a real video filter, not screen brightness)
- **Repeat**: cycles off → one → queue, with a HUD confirmation
- **Overflow sheet on phones**: every control that does not fit becomes a thumb-friendly
  action sheet (tracks, audio, subtitles, picture, playback, speed, brightness, volume,
  repeat, bookmark, screenshot, info, sleep, PiP, fullscreen, settings)
- Timeline with buffered ranges, chapter ticks, A-B loop band, glowing playhead and
  hover storyboard thumbnails
- Speed 0.25×–4× (pitch preserved on the native engine), frame stepping (`.` / `,`),
  A-B repeat, sleep timer, bookmarks, skip-intro / next prompts
- Picture: brightness, contrast, saturation, hue, gamma, sharpen (SVG kernel), grayscale,
  sepia, invert, blur, presets; aspect modes; rotate, mirror, zoom, pan
- Gestures: double-tap zones (with ripple feedback), horizontal scrub, vertical
  volume/brightness, long-press speed, pinch zoom — all configurable
- Picture-in-Picture, fullscreen (hidden where the platform cannot do it), wake lock,
  remappable keyboard shortcuts, Shift+Arrow large seeks
- Library: history with resume, continue watching, bookmarks, playlists, recent links — all in IndexedDB
- Diagnostics: engine, codecs, decoder path, hardware-acceleration status, dropped frames,
  buffer health, copyable JSON report
- Themes: dark, light, AMOLED black, eight accent colours, compact density
- Motion: page/panel transitions, staggered lists, hover lift, shimmer placeholders,
  all disabled by the “Reduce motion” setting

### Player features borrowed from the best of the field

Built in the spirit of ArtPlayer, Video.js, Shaka, Vidstack and Media Chrome — but on our
own engine, so they work for MKV, multi-audio and PGS too.

| Feature | What it does | Inspired by |
| --- | --- | --- |
| **Danmaku** | Bullet comments in lanes (scroll / top / bottom), Bilibili XML + ArtPlayer JSON import, in-player composer, opacity/size/speed/area controls | ArtPlayer |
| **Stats for nerds** | Live overlay: engine, resolution, codec, buffer, dropped frames, fps, rate, state | Shaka Player |
| **Context menu** | Right-click for play/pause, screenshot, copy link at this time, danmaku, stats, picture, keys, lock, fullscreen | ArtPlayer |
| **Shortcut sheet** | Press `?` for a searchable cheat sheet built from your own remapped bindings | Plyr / Video.js |
| **Lock screen** | Freeze the controls (and gestures) so a stray tap cannot scrub — tap to unlock | ArtPlayer / MX Player |
| **ARIA status** | Screen-reader announcements for playing / paused / buffering, labelled controls | Video.js / Media Chrome |

### Any link, not just files

A pasted link is routed by a **source adapter registry** instead of a pile of `if`s:

| Input | Handled by | Plays as |
| --- | --- | --- |
| `.mp4 .mkv .webm .mov .avi .ts .mp3 …` | Direct media | Any engine |
| `.m3u8` / `.mpd` | HLS / DASH | Adaptive streaming |
| `magnet:?xt=urn:btih:…` | Torrent | Gateway or WebTorrent — **also inside embeds** |
| `ipfs://…` or `/ipfs/CID` | IPFS | Several public gateways, tried in order |
| Google Drive, Dropbox, OneDrive | Cloud storage | Rewritten to direct links |
| YouTube, Vimeo, Dailymotion, Twitch, Streamable, Facebook | Provider | The site's own embed, with our chrome hidden |

Provider links are honest about what they are — YouTube's streams are protected, so the
official embed plays them and the transport bar is hidden. The URL field previews the
detected adapter as you type.

### Live streams

The LIVE badge becomes a live-edge control: it shows how far behind you are
(`LIVE −42s`) and one click jumps back to the newest point.

### Device compatibility testing

`npm run audit` now walks the full matrix — 320×568, 360×640, 390×844, 430×932,
768×1024, 1024×600, 1280×720, 1920×1080, 2560×1440, 3840×2160, phone landscape — plus
**200% zoom on a phone** and **135% system text**, over every route and every player panel.

Touch screens are held to a **44 CSS px** minimum target (mouse layouts to 30), and the
suite runs a self-test: it injects a deliberately tiny button and fails if the rule does
not catch it, so a broken check can never masquerade as a clean result.

### Device profiles

Four budgets — **low**, **balanced**, **high**, **TV** — chosen from what the browser
actually reports: device memory, core count, mobile vs desktop, data-saver, connection
type and TV user agents. **Unknown values get the conservative profile on purpose**;
a device is never assumed powerful because it claims many cores.

Each profile sets the WebCodecs decode cap, decoded-frame queue depth, audio look-ahead,
demux cache, effects, danmaku rate, thumbnails and subtitle effects. Settings →
Performance lets you override it.

A **resource governor** watches dropped frames and stalls once a second. Repeated trouble
steps the budget down (max three times), and a level is only restored after two minutes of
stable playback. Healthy native hardware decoding is never downgraded.

### Intelligent playback

Mirrors are ranked by measured health, not by guesswork: each attempt records success
rate and startup time, and the best source for an episode is remembered for next time.
If the clock stops advancing while the player believes it is playing, it nudges the
pipeline once, then twice, and finally switches to another mirror at the same timestamp
with a short notice. Losing the network pauses playback and reconnecting resumes at the
same position.

**Smart resume** stores the position *plus* the audio track, subtitle track and playback
speed, so returning to an episode restores the whole state, not just the timestamp.

### Downloads

**Downloads** is a real queue, not a save button: concurrent jobs (1–4), pause and
resume over HTTP `Range`, progress with speed and ETA, automatic retry with backoff,
duplicate detection, and a storage monitor. Bytes go straight to the origin — never
through your CORS proxy.

Resume is only offered when the origin proves it: a `206` with a matching
`Content-Range`. If a server ignores `Range` (or answers `200`), the job is marked
**no resume**, the button becomes *Stop*, and starting again restarts cleanly instead
of appending a duplicate copy.

Large files never sit in RAM: with the File System Access API the stream is written
straight to disk; elsewhere chunks go to IndexedDB (4 MB each) and are assembled into a
Blob at the end. Manifests (`.m3u8`, `.mpd`) are refused — a manifest is a stream, not a
single file.

### Downloading subtitles and playlists

Each external subtitle in the player's Subtitles panel has a **Download** button, plus
**Download all subtitles** when several exist. Names are generated as
`Show S01E01 · Hindi.srt`, the origin's own filename is kept when it is sane, and bitmap
subtitles (`.sup`) are refused — they are images, not text files.

The Playlist page has **Download all** and **Download selected** (checkbox per row).
Duplicates are skipped automatically, so re-running a half-finished playlist only queues
what is missing. A download folder can be remembered, and the history exports as JSON.

### Folder library

**Open media → Open a folder** (Chrome/Edge/Opera): the folder is remembered via its
File System Access handle, so you can rescan and queue everything inside later. Files
stream straight from disk — nothing is copied or uploaded.

### Playlists

Import and export **M3U** playlists from the Playlist page — the format VLC and every
IPTV list uses. HLS media playlists are detected and refused (they are streams, not
collections), and entries run through the source adapters, so a magnet or an IPFS link
inside an M3U still works.

### Torrents (magnet links)

**Torrents** takes a magnet link and plays it. Two routes, because they have very
different reach:

| Route | How it works | When it plays |
| --- | --- | --- |
| **WebTorrent** | Runs in the page (`/vendor/webtorrent.min.js`, loaded lazily) | Swarms with WebRTC peers or a web seed (`ws=`) |
| **Gateway** | An HTTP service you point at (`Settings → Torrents`) fetches it server-side and serves ranges | Any magnet |

Browsers speak WebRTC, not TCP, so a classic public swarm will not stream directly —
the player says so instead of spinning. A gateway URL supports `{magnet}` or `{hash}`.

### For developers

Three integration levels, documented in-app under **For developers** with copy buttons
and a live playground:

```html
<iframe src="https://player.example/#/embed?src=…&autoplay=1&muted=1"
  allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
```

```js
const player = OmniPlay.mount('#player', { src, start: 30, muted: true });
player.on((event) => console.log(event.type, event.currentTime));
player.seek(120);
```

There is also a custom element for frameworks:

```html
<omni-play src="https://example.com/video.mp4" title="Episode 1" muted></omni-play>
```

`window.OmniPlay` exposes `mount()`, `buildEmbedSrc()` and the protocol version. Inside an
iframe the player answers `play · pause · toggle · seek · volume · muted · rate · load ·
subtitle · quality · audio · danmaku · fullscreen · getState` and emits `ready · state ·
timeupdate · ended · error · tracks · state-reply`.

### Embed on any site

Paste a direct link after the player URL and it becomes a self-contained player:

```
https://your-player.example/?src=https%3A%2F%2Fhost%2Fvideo.mp4
https://your-player.example/#/embed?src=…&autoplay=1&muted=1&title=Episode%201
```

**Embed & share** (sidebar) turns any link into a ready-to-paste iframe, with a live
preview and options for caption, poster, subtitles, start time, autoplay, mute, loop and
controls. The generated snippet:

```html
<iframe src="https://your-player.example/#/embed?src=…"
  style="border:0;display:block;aspect-ratio:16/9;max-width:100%"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
  allowfullscreen referrerpolicy="no-referrer"></iframe>
```

Inside an embed the app chrome, navigation and history writes are removed; the player
fills the frame, honours `?start=`, `?poster=`, `?sub=`, and mutes *before* the first
`play()` so autoplay is allowed. `controls=0` gives a clean click-to-play surface.

### Why a link is refused — built-in checker

Diagnostics → **Check a link** runs the same three requests the player does and names the
failure instead of guessing:

| Probe | What it proves |
| --- | --- |
| `HEAD`, no preflight | Whether the URL answers at all (signed URLs often 403 here — harmless) |
| `GET`, no `Range` | A simple request: if this resolves, CORS *is* configured |
| `GET` with `Range` | Whether the preflight `OPTIONS` and the `Range` header are allowed |

It prints the origin the requests come from, so you can compare it with `AllowedOrigins`.
A common trap: a bucket policy listing only `GET, HEAD` rejects the preflight that a
`Range` header triggers, which looks exactly like "no CORS". The player now probes with a
plain `GET` first, so that case is no longer misreported.

### When a host blocks browser access (CORS)

Some links — signed storage buckets, download gateways that 302 into one — never send
`Access-Control-Allow-Origin`. A web player cannot read those bytes, so MKV cannot be
demuxed and no client-side player can open it. What OmniPlay does now:

- **Detects it in one probe** (HEAD + one ranged GET) and explains the cause instead of
  showing a decoder error.
- **Always hands the source to the native element first**, like movi-player's
  `fallback="native"`: `<video>` fetches opaquely, so it plays anything the browser can
  decode — MP4, WebM, and even WebM-profile MKV (VP8/VP9/AV1 + Opus). The badge shows
  `Native · CORS` and a one-time notice explains that track switching and embedded
  subtitles need CORS or a proxy. Only if that also fails do you get the CORS error.
- **Offers the three real fixes**: download the file and open it locally, add a bucket CORS
  policy (copy-ready JSON), or route through a **CORS proxy you control**.
- **CORS proxy support**: Settings → Network takes a template like
  `https://my-worker.dev/?url={url}` — or just the worker root, e.g.
  `https://my-worker.dev/proxy`, and the player negotiates the shape (`?url=`, `?u=`,
  path-style) instead of failing with a 400.
  Files, MKV subtitle extraction, thumbnails, subtitle downloads **and HLS** go through it:
  a custom hls.js loader rewrites every playlist/segment request and makes each playlist
  URI absolute against the original manifest, so there is exactly one proxy hop per request.
  DASH is proxied too: dash.js v5 exposes no URL hook, so a scoped XMLHttpRequest
  interceptor routes MPD/init/segment requests through the proxy while the engine is alive
  (and is removed on destroy). Your proxy must answer `OPTIONS` (a `Range` header triggers a
  preflight) and forward `Range`/`Content-Range`.

### Embedded subtitles (the movi-player gap)

MKV files keep their subtitles inside the container, which `<video>` never exposes and
mediabunny does not read. OmniPlay now parses the Matroska container itself:

- **Discovery**: every subtitle track is listed with codec, language, name, default/forced
  flags — before you press play.
- **Extraction**: the selected track is pulled out on demand, streaming the file in 2 MB
  windows so a 4 GB MKV never lands in memory.
- **ASS/SSA** keep their full styling (fonts, colours, outlines, positioning, karaoke)
  because the script's own header is used.
- **PGS bitmap subtitles** (Blu-ray) are decoded in TypeScript: palettes, RLE bitmaps,
  composition placement and display-set timing, painted onto a subtitle canvas that
  follows the letterboxed picture.
- **SRT/WebVTT** tracks inside MKV work the same way.
- External `.sup` files use the same PGS decoder.

movi-player does this inside FFmpeg/WASM. OmniPlay does it in ~700 lines of TypeScript,
with no wasm download and no extra memory — the trade-off is that container support is
Matroska (the format that actually needs it), not every format FFmpeg knows.

### Multi-audio, and what it requires

Language switching is real track switching, not a fake list:

- **Local files** (MKV/MP4 with several audio tracks): every track is demuxed and
  switchable through the WebCodecs engine, including while paused. The chosen language is
  remembered and reapplied next time.
- **Remote files**: the browser must be allowed to read the bytes, i.e. the host has to send
  `Access-Control-Allow-Origin` for `GET`/`HEAD`. Without it, `<video>` cannot expose the
  tracks and no client-side player can decode MKV at all. OmniPlay now detects this before
  playback, sends only two probe requests, and explains the fix — including a copy-ready
  CORS policy for your bucket.
- **HLS/DASH**: audio renditions come from the manifest and switch without a reload.
- **Native `<video>`** only exposes audio tracks where the platform allows it (Safari). When
  a file has more tracks than the engine can reach, the panel lists them all and offers a
  one-tap reload with the engine that can switch.

### Installable PWA

- **Install** from Chrome/Edge (address bar or in-app button) or Safari (Share → Add to
  Home Screen, with in-app instructions). The app runs in its own window, no browser chrome.
- **Offline**: a generated service worker precaches the exact hashed build, so the app
  opens with no network. Media you own still plays; network streams obviously need a link.
- **Safe updates**: a new build downloads in the background and shows a “Reload” prompt —
  playback is never interrupted by a forced refresh.
- **App shortcuts**: Open media, Play a link, Continue watching from the OS app icon.
- **Persistent storage** request, offline indicator, and an install nudge on phones that
  can be dismissed.
- Works from any sub-path; the manifest, icons and service worker are all relative.

---

## Project structure

```
src/
  app/          app shell, router, store, session (open/queue flows)
  core/         capabilities, probing, source resolver, engine selector,
                playback manager, errors, diagnostics helpers
  engines/      native, hls, dash, webcodecs (+ shared base)
  media/        container/codec knowledge, thumbnails & storyboards
  audio/        Web Audio processing chain
  subtitles/    parsers, ASS renderer, subtitle manager
  video/        filters, aspect, geometry
  gestures/     touch gestures, keyboard manager
  storage/      IndexedDB wrapper, settings, library
  ui/           icons, DOM helpers, components, pages, player UI & panels
  styles/       design system, player, themes, responsive
tests/          unit tests (vitest)
scripts/        smoke test, screenshots, packaging
docs/           architecture, compatibility, testing
```

The player is a set of independent modules: an engine only knows how to play bytes, a
manager chooses and supervises engines, the UI subscribes to normalised events. No module
reaches into another's DOM.

---

## Browser support

| Browser | Native | HLS | DASH | WebCodecs (MKV/AVI) | Notes |
| --- | --- | --- | --- | --- | --- |
| Chrome / Edge (desktop, recent) | ✅ | ✅ hls.js | ✅ dash.js | ✅ (H.264/HEVC/AV1/VP9 per device) | Best overall; installable PWA |
| Firefox (desktop) | ✅ | ✅ hls.js | ✅ dash.js | ⚠️ partial | WebCodecs coverage varies by build |
| Safari 17+ (macOS) | ✅ | ✅ native + hls.js | ✅ dash.js | ⚠️ partial | Native HLS; HEVC hardware decode |
| Chrome (Android) | ✅ | ✅ | ✅ | ✅ on most 2020+ devices | Installable; low-memory mode recommended |
| Safari (iOS/iPadOS) | ✅ | ✅ native | ✅ dash.js | ⚠️ limited | Add to Home Screen for full-screen; audio graph needs a gesture |
| Samsung Internet / Opera | ✅ | ✅ | ✅ | ✅ (Chromium) | Treated as Chromium |

See [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for the codec matrix and what was
verified versus what depends on the device.

---

## Testing

```bash
npm test            # 50 unit tests: parsers, ASS renderer, sniffing, engine choice, settings
npm run smoke       # playback end-to-end: routes, playback, subtitles, errors, history
npm run ui          # every player control + mobile sheet + install pill
npm run multiaudio  # real 2-track MKV: list, switch, switch back, paused switching
npm run embedded    # real MKV with ASS + PGS: discovery, extraction, styling, bitmap paint
npm run pwa         # manifest, service worker, offline start, install flow
npm run cors        # blocked host, 302 gateway, and playback through a proxy
npm run embed       # iframe embedding on another origin + builder + controls=0
npm run pro         # danmaku import/rendering, stats, context menu, shortcuts, lock
npm run dev         # torrent gateway playback, developer API, postMessage protocol
npm run longtext    # 400-char signed links and 200-char filenames on phone and desktop
npm run smoke:webcodecs  # records a clip and drives the WebCodecs engine
npm run audit       # layout audit across 9 viewports × every screen
```

All browser tests serve `dist/`, drive headless Chrome and assert real behaviour — a real
media file plays, the timeline seeks, subtitles paint, panels open, the sheet exposes every
control, and the app still boots offline. Run `npm run build` first.

See [`docs/TESTING.md`](docs/TESTING.md) for the media compatibility matrix and what still
needs manual testing with your own files.

---

## Known limitations (honest list)

A browser is not VLC. These are real constraints, surfaced in the UI rather than hidden:

- **Codecs without browser decoders** — DTS, DTS-HD, TrueHD, VC-1, RMVB, APE, most ProRes
  profiles. The player names the codec and suggests re-encoding.
- **Embedded MKV subtitles** — the demuxer exposes video/audio tracks only. Load the
  `.ass`/`.srt` alongside the file; MP4/WebVTT embedded tracks do work.
- **Multiple audio tracks in the native engine** — browsers hide MP4 audio tracks from
  `<video>`. Switch to the WebCodecs engine to change them (the panel does it in one tap).
- **CORS is a hard requirement for MKV/AVI** — the browser must read the bytes to demux.
  A host without `Access-Control-Allow-Origin` cannot play MKV in any web player; the app
  says so up front instead of retrying.
- **Negative audio delay** — video cannot be delayed in a browser, so audio can only be
  pushed later (0–2000 ms).
- **WebCodecs speed** — speed changes pitch there; the native engine preserves pitch.
- **Device brightness** — impossible from JavaScript; the gesture dims the video with a filter.
- **Chromecast / AirPlay** — no public web API for arbitrary senders; not faked.
- **DRM** — never bypassed.
- **Local file re-open** — after a reload the browser requires you to pick the file again.
- **iOS installation** — no install API; Safari installs from the Share sheet, and an
  installed iOS web app gets its own storage container (history starts fresh there).
- **Fullscreen on iPhone** — element fullscreen is not exposed; install to Home Screen
  for a full-screen player instead.
- **360°/3D** — not included in this build, so no decorative toggle exists.

---

## Privacy

No network calls except the media you ask for (and any subtitle URL you paste). Fonts are
system fonts, not a CDN. History, bookmarks, playlists, settings and thumbnails live in
IndexedDB/localStorage on your device. Signed URLs are redacted in diagnostics so tokens
never end up in a copied report.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check + production bundle into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run smoke` | Headless Chrome end-to-end test (native engine) |
| `npm run ui` | Control-by-control UI test (desktop + phone) |
| `npm run pwa` | PWA manifest, service worker, offline and install test |
| `npm run cors` | Blocked host, 302 gateway, proxy negotiation, HLS via proxy, link checker |
| `npm run embed` | Third-party page embeds the player in an iframe and it plays |
| `npm run pro` | Danmaku, stats overlay, context menu, shortcut sheet and lock |
| `npm run dev` | Torrents (gateway flow), provider links, magnet embeds, `OmniPlay.mount`, postMessage |
| `npm run longtext` | Signed 400-character links never push the layout off-screen |
| `npm run audit` | Layout audit over 9 viewports and every screen |
| `npm run smoke:webcodecs` | Records a WebM clip and verifies the WebCodecs engine |
| `npm run multiaudio` | Builds a 2-audio-track MKV and verifies language switching |
| `npm run embedded` | Plays an MKV with embedded ASS + PGS tracks and verifies extraction and rendering |
| `npm run demo` | Generates `smoke-tmp/demo.webm` for manual testing |
| `npm run shots` | Screenshot the main screens into `shots/` |
| `npm run zip` | Package source + build + docs into a zip |

---

## Licence

MIT — see [LICENSE](LICENSE). Third-party libraries: hls.js (Apache-2.0),
dash.js (BSD-3-Clause), mediabunny (MPL-2.0).
