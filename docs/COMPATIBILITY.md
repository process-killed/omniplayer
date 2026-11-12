# Compatibility

Support is decided at runtime, per file, from actual browser APIs. This page documents what
that means in practice and separates **verified** from **device-dependent**.

## Containers

| Container | Native | WebCodecs path | Notes |
| --- | --- | --- | --- |
| MP4 / M4V | ✅ all browsers | n/a | H.264 + AAC is the universally safe combination |
| MOV | ✅ (Safari best) | ✅ | Some ProRes profiles have no decoder anywhere |
| WebM | ✅ | n/a | VP8/VP9/AV1 + Opus/Vorbis |
| MKV | ❌ | ✅ Chrome/Edge, partial FF/Safari | Depends on codecs inside; H.264/HEVC/AV1/VP9 covered |
| AVI | ❌ | ⚠️ if codec supported | MPEG-4 Part 2 usually not decodable |
| FLV | ❌ | ⚠️ H.264 + AAC only | Common older streaming container |
| TS / M2TS | ✅ Chrome/Edge (H.264) | ✅ | Broadcast streams may use unsupported audio |
| OGV / OGG | ✅ Firefox, partial others | ✅ | Theora decoders are rare outside Firefox |
| 3GP | ✅ | ✅ | H.263 rarely supported |
| WMV / ASF | ❌ | ❌ | VC-1 has no browser decoder |
| VOB / MXF | ❌ | ⚠️ | MPEG-2 video is not decodable in browsers |

## Video codecs

| Codec | Native (MSE) | WebCodecs | Reality |
| --- | --- | --- | --- |
| H.264 / AVC | ✅ everywhere | ✅ | Baseline/main/high profiles |
| H.265 / HEVC | ⚠️ Safari, Edge/Chrome on some GPUs | ⚠️ hardware-dependent | Not on Firefox; Linux Chrome often lacks it |
| AV1 | ✅ recent Chrome/Firefox/Edge | ✅ | Software decode is heavy on old devices |
| VP9 / VP8 | ✅ | ✅ | Universal in Chromium/Firefox |
| MPEG-2 / MPEG-1 | ❌ | ❌ | Needs re-encoding |
| Theora | ⚠️ Firefox | ❌ | Legacy |
| ProRes / DNxHD / VC-1 / MJPEG | ❌ | ❌ | Not available to web decoders |
| H.266 / VVC | ❌ | ❌ | No browser decoder yet |

## Audio codecs

| Codec | Native | Notes |
| --- | --- | --- |
| AAC | ✅ | Default for MP4 |
| MP3 | ✅ | Universal |
| Opus / Vorbis | ✅ | WebM/OGG |
| FLAC | ✅ most, ⚠️ Safari | Also in MP4 |
| AC-3 / E-AC-3 | ⚠️ Safari/Edge (device) | Common in MKV rips |
| DTS / DTS-HD / TrueHD | ❌ | No browser decoder — reported clearly |
| ALAC / WMA / APE / AMR | ❌ | Not exposed to browsers |

## Features by browser

| Feature | Chrome/Edge | Firefox | Safari |
| --- | --- | --- | --- |
| Native HLS | via hls.js | via hls.js | ✅ built-in |
| DASH | ✅ dash.js | ✅ dash.js | ✅ dash.js |
| WebCodecs video | ✅ | ⚠️ partial | ⚠️ 17+ partial |
| Web Audio effects | ✅ | ✅ | ✅ (needs gesture) |
| Picture-in-Picture | ✅ | ✅ | ✅ (video only) |
| Wake lock | ✅ | ✅ (recent) | ⚠️ |
| File System Access | ✅ | ❌ | ❌ |
| PWA install | ✅ | ✅ | ✅ (iOS: share → Add to Home) |
| Range-request seeking | ✅ | ✅ | ✅ |

## Known limits (stated, not hidden)

- **Save dialog cancelled** → the job returns to *paused* with "Cancelled — the file was not saved", never stuck in *downloading*.
- **Range responses** are validated against the requested offset; a mismatched `Content-Range` aborts rather than writing wrong bytes.
- **DASH errors** are classified: network hiccups stay recoverable, manifest/segment/decoder failures escalate to the engine fallback chain.
- **Buffer budget** (`maxBufferMb / 4`) applies to remote sources as well as local files.
- **Blob assembly** for downloads without the file-system writer still needs RAM equal to the file size once; the Downloads page warns.

## Torrents

| Route | Needs | Reality |
| --- | --- | --- |
| WebTorrent (in page) | A swarm with WebRTC peers or a `ws=` web seed | Most public magnets have neither; classic TCP peers are unreachable from a browser |
| Gateway | Any HTTP service that accepts a magnet and serves the file with ranges | Works for every magnet; configure it in Settings → Torrents |

The file is downloaded to memory before playback (WebTorrent route), so very large
torrents are better played through a gateway.

## Embedding

| Concern | Behaviour |
| --- | --- |
| Iframe on another origin | Works — no `X-Frame-Options` is set, so any site can embed it |
| Autoplay | Allowed when `muted=1`; the player mutes before `play()` |
| Fullscreen | Needs `allow="fullscreen"` on the iframe (in the generated snippet) |
| Picture-in-picture | Needs `allow="picture-in-picture"` |
| Wake lock | Silently skipped inside an iframe that does not grant `screen-wake-lock` |
| Storage | History/bookmarks are not written in embed mode |

## Subtitles

| Format | Where | Support |
| --- | --- | --- |
| SRT / WebVTT | External file, MKV track | ✅ styled by the player |
| ASS / SSA | External file, MKV track | ✅ full styling incl. positioning and karaoke |
| PGS | MKV track, `.sup` file | ✅ decoded in TypeScript and painted to canvas |
| TTML / DFXP | External file | ✅ basic timing and text |
| DVD/VobSub (.idx/.sub) | — | ❌ not decoded yet |
| MP4 embedded text | MP4 | ⚠️ only what `<video>` exposes |

## Multi-audio and CORS

| Source | Audio tracks | Requirement |
| --- | --- | --- |
| Local MKV/MP4 with several tracks | All, switchable (WebCodecs) | None — file access is granted by the picker |
| Remote MKV/MP4 | All, switchable (WebCodecs) | `Access-Control-Allow-Origin` on GET and HEAD |
| Remote MP4 (native engine) | Only what `<video>` exposes (usually one) | None, but track switching is unavailable |
| HLS / DASH | Renditions from the manifest | CORS on the manifest and segments |

A host that does not send `Access-Control-Allow-Origin` cannot play MKV in any browser-based
player, because the container is not natively supported and JavaScript is not allowed to read
the bytes. OmniPlay detects this in one probe (HEAD + one ranged GET), shows the reason, and
offers a copy-ready bucket CORS policy, a download link, and an optional CORS proxy
(Settings → Network) for users who run one. The proxy covers files, MKV subtitles,
thumbnails and HLS playlists/segments; DASH is not proxied yet.

Download gateways that 302 into such a bucket behave the same way. The player always attempts
native playback first, which succeeds whenever the browser can decode the file on its own:
MP4, WebM, and WebM-profile MKV (VP8/VP9/AV1 + Opus/Vorbis). H.264/HEVC inside MKV is not
natively decodable, so those still need CORS (or a proxy) to be demuxed.

## What was verified in this build

Automated, headless Chrome 156 on Linux (`npm run smoke`):

- App boots with no console errors; all ten routes render
- Local media opens, metadata loads, playback advances, pause works
- Timeline click seeks, keyboard seek works
- Equaliser panel renders 10 bands; panel open/close
- External SRT loads and its cue renders over the video
- Missing URL produces the correct `404` error screen with suggestions
- History records the played file
- A two-audio-track MKV lists both languages and switches between them, including while paused
- A host without CORS produces one clear error after two requests (no retry storm)

Unit tests (`npm test`) cover the subtitle parsers (SRT/VTT/ASS/TTML), ASS layout maths and
karaoke, container sniffing, codec strings, engine-chain selection and settings
import/export.

## What still needs a real device

These depend on hardware, OS codecs or live servers, so they are **not** claimed as verified:

- HLS/DASH playback against a real CDN (hls.js/dash.js integrations are standard but need a
  live manifest with CORS)
- HEVC/AV1 hardware decoding on your GPU
- MKV with multiple audio tracks on your device
- iOS Safari audio-graph behaviour and PiP
- Very large files (>10 GB) on low-memory phones

Use **Diagnostics** after playing a file: it reports the engine, decoder path and whether
the browser claims hardware acceleration. If something fails, the error card names the
codec and the reason.
