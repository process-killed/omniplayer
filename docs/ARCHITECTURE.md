# Architecture

OmniPlay is deliberately built as a set of small modules with one job each. The goal is
that a bug in the subtitle renderer cannot break decoding, and that adding a new engine
requires touching only two files.

```
┌──────────────────────────────────────────────────────────────────────┐
│ UI (src/ui)                                                          │
│  pages: home / open / url / playlist / history / bookmarks /         │
│         settings / diagnostics / about / player                      │
│  player: player.ts (controller) + panels.ts (tracks, audio, subs,    │
│          picture, playback, info)                                    │
└───────────────▲──────────────────────────────────────────────────────┘
                │ normalised events (time, state, tracks, quality, error…)
┌───────────────┴──────────────────────────────────────────────────────┐
│ PlaybackManager (src/core/playbackManager.ts)                        │
│  resolve → probe → select chain → run engine → fall back → report    │
└───────┬───────────────┬───────────────────────┬──────────────────────┘
        │               │                       │
┌───────▼──────┐ ┌──────▼───────┐ ┌─────────────▼────────┐
│ SourceResolver│ │ MediaProbe   │ │ EngineSelector       │
│ (URL/headers) │ │ (bytes +     │ │ (capabilities +      │
│               │ │  mediabunny) │ │  codec tables)       │
└───────────────┘ └──────────────┘ └──────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│ Engines (src/engines)                                                │
│  NativeEngine  → <video>                                             │
│  HlsEngine     → hls.js + NativeEngine plumbing                      │
│  DashEngine    → dash.js + NativeEngine plumbing                     │
│  WebCodecsEngine → mediabunny demux → VideoDecoder → canvas          │
│                    + AudioBufferSink → Web Audio                     │
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼────────────┐  ┌──────────────┐  ┌──────────────┐
│ AudioProcessor     │  │ SubtitleMgr  │  │ Storage      │
│ (Web Audio chain)  │  │ + parsers    │  │ (IndexedDB)  │
└────────────────────┘  └──────────────┘  └──────────────┘
```

## Engine contract

Every engine implements `PlaybackEngine` (`src/types.ts`):

```ts
interface PlaybackEngine {
  kind: EngineKind;
  capabilities: EngineCapabilities;
  video: HTMLVideoElement | null;   // native-based engines
  canvas: HTMLCanvasElement | null; // canvas-based engines
  attach(container): void;
  load(source, startAt): Promise<void>;
  play/pause/seek/setVolume/setMuted/setRate
  currentTime / duration / paused / buffered / live
  getTracks() / selectAudioTrack() / selectSubtitleTrack() / setQuality()
  on(event, handler): () => void;
  destroy(): void;
}
```

`BaseEngine` supplies the event emitter, track bookkeeping and lifecycle. Native, HLS and
DASH share one `NativeEngine` instance internally, so media-element events are implemented
once; the streaming engines only add manifest handling, quality levels and renditions.

## Engine selection

`selectEngineChain()` returns an ordered list, for example:

- MP4 + H.264 + AAC → `['native', 'webcodecs']`
- MKV + HEVC → `['webcodecs', 'native']`
- `.m3u8` → `['hls']`
- `.mpd` → `['dash']`

Rules: manifests always use their streaming engine; otherwise the native container/codec
support check decides the order; `enginePreference` in settings overrides the first entry;
WebCodecs is only offered when `VideoDecoder` exists and the user allows it. The manager
tries entries in order, preserving playback position, and stops after the chain is
exhausted (no infinite fallback).

## WebCodecs pipeline

1. `mediabunny.Input` demuxes the container (`BlobSource` for files, `UrlSource` for links).
2. `CanvasSink` decodes frames on demand into canvases (capped resolution).
3. A queue of at most 5 frames feeds `requestAnimationFrame`; the frame whose timestamp is
   due is painted to the display canvas.
4. `AudioBufferSink` yields decoded audio; buffers are scheduled on an `AudioContext` with
   a media-time → context-time mapping (anchor + rate).
5. The audio clock is the master clock. Seeking re-anchors both, flushes scheduled nodes and
   restarts the iterators. Every seek carries a token so late results are discarded.

## Audio graph

```
<video> (MediaElementSource) ─┐
decoded buffers (WebCodecs)  ─┴→ input → 10 peaking bands → lowshelf → highshelf
                                   → compressor → mono → delay → panner → master → out
```

`createMediaElementSource` on cross-origin media without CORS yields silence, so the graph
is only attached for files, MSE streams and same-origin URLs. Otherwise the element plays
natively and the audio panel explains why effects are unavailable — it never silently
mutes.

## Subtitles

`SubtitleManager` owns tracks and a render clock. Each tick it finds active cues
(binary-search friendly, pointer-free), rebuilds DOM only when the active set changes, then
updates karaoke/fade/move state per frame. ASS coordinates are percentages of PlayResX/Y,
and one CSS variable (`--ass-scale` = container height / PlayResY) scales fonts, outlines
and shadows, so resizing costs one property write.

## Storage

`storage/db.ts` wraps IndexedDB (`history`, `bookmarks`, `playlists`, `urls`, `kv`, `thumbs`)
with a localStorage-backed fallback for private mode. Settings live in `localStorage` and are
validated field by field on load, so a corrupted or old file never breaks startup.

## Player UI

`ui/player/player.ts` owns one `<video>` stage and a normalised controller:

- `.player__stage` holds the media, subtitle layers, gesture layer, centre overlay,
  buffering spinner, HUDs and error card.
- `.pbar--top` / `.pbar--bottom` are glass bars that hide after `playerChromeDelay` and
  always stay visible while paused or while a panel is open.
- Every control exists exactly once in the DOM. On narrow screens CSS collapses the
  secondary buttons, and the same actions appear in `.sheet` (a 16-tile action sheet)
  so no feature becomes unreachable on a phone.
- `closeTransient()` guarantees Escape closes popovers/sheets before it can exit the video.

## Embedded subtitles

`subtitles/matroska.ts` is a streaming EBML reader:

- `scanMatroskaTracks()` stops after the Tracks element, so listing is instant.
- `extractMatroskaSubtitles()` walks clusters, decodes block lacing and collects packets
  for one track, reporting progress against the file size.
- Text tracks are rebuilt into SRT or a complete ASS script (the container's CodecPrivate
  header plus generated Dialogue lines), then handed to the existing parsers.
- PGS packets go to `subtitles/pgs.ts`, which decodes palettes, RLE bitmaps and
  compositions into cropped canvases with timings.

`SubtitleManager` renders text in the DOM overlay and bitmaps on a canvas sized to the
letterboxed picture, so both scale with the player.

## PWA layer

`app/pwa.ts` owns installability and updates:

- `beforeinstallprompt` is captured and replayed from the install card, the phone pill and
  Settings → App. iOS gets exact Share-sheet steps because no API exists there.
- The service worker is **generated at build time** (`vite.config.ts` plugin) with the real
  hashed asset list, so precaching can never reference a stale filename.
- Updates install into `waiting`; the UI offers “Reload”, posts `SKIP_WAITING`, and reloads
  once on `controllerchange`. A build id in the cache name removes old caches.

## Failure model

`AppError` carries a code, title, explanation, suggestions and whether it is fatal.
`toAppError` normalises unknown throws; `mediaElementError` maps `MediaError` codes. The UI
renders one error card with Retry, “Try another engine”, diagnostics and copy actions. The
player never claims hardware acceleration it cannot verify: MediaCapabilities results are
reported as “Unknown” when the browser declines to answer.
