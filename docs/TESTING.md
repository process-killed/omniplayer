# Testing

Two layers: fast unit tests for pure logic, and one end-to-end browser test that proves the
app can actually play media.

## Unit tests (vitest)

```bash
npm test
```

Covers:

| Area | What is asserted |
| --- | --- |
| SRT | millisecond timestamps, CRLF, missing indices, malformed blocks |
| WebVTT | header/NOTE/cue-id skipping, `MM:SS.mmm` times, cue settings |
| ASS/SSA | Script Info, style table, dialogue split with commas in text, colour conversion, alpha |
| TTML | clock and offset (`4s`, `dur`) timings, nested spans, `<br/>` |
| Encoding | UTF-16 BOM detection, UTF-8 fallback |
| ASS renderer | `\pos`/`\an` percentage layout, inline italics, karaoke run timings, no raw tags leaking |
| Sanitising | script tags escaped, whitelisted `<b>`/`<i>` kept, `<font color>` converted |
| Container sniffing | ftyp/EBML/RIFF/FLV/TS/HTML signatures, unknown bytes |
| Engine selection | MP4→native, MKV→WebCodecs, preference override, no-WebCodecs fallback, manifests |
| Settings | defaults, export/import round-trip, coercion, corrupted storage |

## End-to-end smoke test

```bash
npm run build
npm run smoke
```

The script:

1. Generates a real 6-second PCM WAV (no ffmpeg needed) and an SRT file.
2. Serves `dist/` over HTTP from the same process.
3. Launches headless Chrome via `puppeteer-core`.
4. Visits every route and asserts a heading rendered.
5. Uploads the WAV through the file input, then asserts: video element mounted, duration
   detected, playback advanced, pause works, timeline seek works.
6. Opens the audio panel (10 EQ bands), loads the SRT and asserts a cue is painted.
7. Presses ArrowRight and asserts the seek happened.
8. Navigates to a missing URL and asserts the `404` error card appears.
9. Asserts history recorded the file and that no console errors occurred.

Exit code is non-zero if any check fails, so it can run in CI. Set
`PUPPETEER_EXECUTABLE_PATH` or edit the candidate list in `scripts/smoke.mjs` if Chrome is
somewhere unusual.

## WebCodecs engine test

```bash
npm run build
npm run smoke:webcodecs
```

Chrome records a 3-second VP8/WebM clip from a canvas, the app is forced onto the
WebCodecs engine, and the test asserts that a canvas is mounted, the decoded frame size is
correct, pixels are actually painted, the engine badge reads “WebCodecs”, playback advances
and a timeline seek re-anchors the pipeline. This covers demux → `VideoDecoder` → canvas
without needing ffmpeg or a sample library.

## Interaction test (every control)

```bash
npm run ui
```

Drives the real player and asserts: autoplay, finite duration (including MediaRecorder
files that report `Infinity`), centre-overlay play/pause, brightness popover + filter,
speed menu apply/close, repeat cycling, all six panels opening with the right title and
closing on Escape, double-tap seek with ripple, settings section switching without reload,
the mobile bar (play/volume/fullscreen inside the viewport), the mobile volume popover
applying to the audio graph, all 16 action-sheet controls, and the install pill.

## Developer + torrents test

```bash
npm run dev
```

Covers the torrent screen (rejects non-magnets, explains the gateway, plays through a
gateway), the vendored WebTorrent bundle, the developers page, `OmniPlay.mount()` and the
postMessage round-trip (`ready`, `timeupdate`, `state-reply`).

## Pro features test

```bash
npm run pro
```

Loads a video and asserts: danmaku XML import renders scroll and top comments, `D` toggles
them off and clears the layer, `I` opens a live stats overlay, right-click opens the
context menu and its entries work, `?` shows the shortcut sheet, and the lock hides the
controls until you tap the badge.

## Embed test

```bash
npm run embed
```

Serves the app on one origin and a "host site" on another, then loads the player in an
iframe and asserts: it mounts, no app navigation leaks in, the caption comes from the URL,
autoplay + mute work, fullscreen is permitted, `?src=` on the site root rewrites to the
embed route, `controls=0` hides the bars but keeps tap-to-play, the builder generates a
valid snippet, and a missing `src` shows a helpful screen.

## Long-text test

```bash
npm run longtext
```

Feeds a 400-character signed URL and a 200-character filename through every screen at
390 px and 1280 px, asserting nothing scrolls sideways and no text is clipped.

## CORS test

```bash
npm run cors
```

Runs four servers: the app, a storage host that sends no CORS headers, a 302 gateway that
redirects to it, and a proxy that adds the header and forwards Range requests. The matrix:

| Case | Expected |
| --- | --- |
| Blocked host, WebM-profile MKV | Plays through the native element; badge `Native · CORS`; limited-mode notice |
| Blocked host, bytes the browser cannot decode | One clear CORS error, proxy/download actions, ≤5 requests |
| 302 gateway into the blocked host | Same explanation, no retry storm |
| Same MKV through a proxy | WebCodecs playback + embedded ASS/PGS tracks |
| Proxy that only accepts `?url=` | Shape negotiation finds it; no 400 wall |
| HLS on a blocked host with a proxy | Master, variant and segment all fetched through it |
| Link checker against a bucket that refuses HEAD + preflight | Reports "readable, ranges fail" instead of "no CORS" |

## Embedded subtitle test

```bash
npm run embedded
```

`scripts/make-embedded-subs-clip.mjs` records a real VP8/Opus MKV in Chrome and then
rewrites its Tracks element to add an ASS track and a PGS track (with real clusters).
The test plays it and asserts: both tracks are discovered with language/forced metadata,
the ASS track extracts and renders a styled cue, and the PGS track paints bitmap pixels
onto the subtitle canvas.

## Multi-audio test

```bash
npm run multiaudio
```

`scripts/make-multiaudio-clip.mjs` builds a real MKV with one VP8 video track and two Opus
audio tracks (English, Hindi) using mediabunny's encoders — no ffmpeg needed. The test then
plays it with the WebCodecs engine and asserts: both tracks are listed, exactly one is
active, switching to Hindi updates the active row and keeps playback running, switching back
works, and switching while paused preserves the position.

## PWA test

```bash
npm run pwa
```

Verifies the manifest (name, display, icons, maskable icon, shortcuts, screenshots),
that every icon and screenshot resolves, that the service worker registers, precaches the
hashed build and serves the app **offline** (network emulated down), that the offline banner
appears, and that the install affordance shows, installs and hides again. It also checks the
Settings → App section.

## Layout audit

```bash
npm run audit
```

Renders nine viewports (1440, 1280, 1024, 820, 1180×820, 430, 390, 360, 844×390) against
every screen plus the player and all six panels. It reports horizontal overflow, elements
clipped outside the viewport, controls under 30px, overlapping fixed bars and text overflow.
The build currently reports **0 issues**.

## Screenshots

```bash
npm run shots   # writes shots/*.png (desktop + mobile, player, panels, diagnostics)
```

## Manual media matrix

Some things cannot be faked in CI. Use this checklist with your own files:

| Test | Expected |
| --- | --- |
| MP4 H.264 + AAC | Native engine, instant start, hardware path |
| MP4 HEVC | Native on Safari/Edge; WebCodecs or clear error elsewhere |
| MKV H.264 + AAC, 2 audio tracks | WebCodecs engine; both tracks switchable in Tracks |
| MKV HEVC | WebCodecs; plays on Chrome/Edge with HEVC support |
| MKV AV1 | WebCodecs; heavy on old CPUs |
| MKV with embedded ASS | Not exposed — load the .ass file, styling preserved |
| MP4 with `mov_text` subtitles | Listed as embedded; cues extracted |
| ASS with signs, positioning, karaoke | Positioned signs, per-run colour, karaoke sweep |
| WebM VP9 / AV1 | Native |
| HLS master playlist | hls.js; quality list matches the manifest |
| DASH manifest | dash.js; audio/text renditions listed |
| Direct HTTP MP4 | Progressive playback, range seeking |
| CORS-blocked URL | Clear CORS explanation; no fake proxy |
| Interrupted stream | Buffering state, recovery notice, retry |
| Corrupted file | “damaged” error with suggestions, no crash |
| 4 GB local file | Opens without loading into RAM; seeking works |
| 3 GB RAM phone | Low-memory mode: smaller buffers, capped decode resolution |
| A-B repeat, speed, filters, gestures | All apply without restarting playback |

Record results with browser, OS, codec and engine — the Diagnostics page can copy the exact
engine/codec report for the entry.
