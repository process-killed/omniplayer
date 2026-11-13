# AniFrame — Embed Player

A zero-catalog, standalone anime embed player for Cloudflare Pages. One responsive
16:9 canvas that picks between **MoviPlayer** (direct MP4 / HLS via ArtPlayer) and
**WebTorrent** (authorised P2P magnet streams), wrapped in a calm, familiar interface:
neutral dark surfaces, one accent colour, plain labels, big touch targets.

Static files only — no build step, no framework. Drop the folder on Cloudflare Pages.

---

## 1. Design rules

The UI follows the patterns people already know from YouTube, Instagram and Facebook.

- **Neutral dark surfaces** (`#0f0f0f` / `#181818` / `#212121`), never neon.
- **One accent colour** for progress, toggles and primary buttons. Six choices in Settings.
- **Sentence case everywhere** — "Playback speed", not "PLAYBACK SPEED".
- **Settings, not features.** Every option lives in one place, with plain words.
- **44 px touch targets**, switches instead of checkboxes, sheets instead of dialogs on phones.
- **Nothing decorative competes with the video.** No animated backgrounds, no glowing borders.

Advanced options still exist, but they are off the main path: they sit inside
Settings → Features, and in the player's own Settings panel under "More".

---

## 2. What's in the box

| Area | What it does |
| --- | --- |
| Player settings | Speed, subtitles, sleep timer, repeat a section, picture, quality, screenshots, picture-in-picture, mini player, full screen, stats |
| Search (Ctrl + K) | Find any episode, setting, panel or action |
| Settings panel | Appearance, playback defaults, optional extras, keyboard shortcuts, developer notes |
| Panels | Servers, streams, episodes, details and comments — sliding sheets on phones |
| Continue watching | A resume row on the start screen with your saved position |
| Stability | Loading spinner, automatic retry when a stream stalls, plain-language messages |

---

## 3. File map

```
index.html                  shell markup + start screen
_headers, _redirects        Cloudflare Pages config
providers.js                servers, sub-servers, trackers (frozen config)
thirdpartyapi.js            provider clients (Luffy, Aniraku, Kuromi, Indian)
script.js                   AniList GraphQL, stream validation, ProgressTracker, toasts
assets/app.js               app orchestrator (routes, streams, panels, bridge)
assets/style.css            base app shell
player/player.js            VideoPlayerEngine (ArtPlayer + hls.js + recovery)
player/player.css           base player skin
comments/*                  comment engine
download/*                  download engine

assets/nexus/               ← the UI layer
  boot.js                   entry: imports features, starts the kernel
  core.js                   settings store · events · feature registry · hotkeys · theme
  nexus.css                 design system + player overlay + responsive rules
  features/
    index.js                the only file you edit to register a new module
    player-pro.js           player settings panel, gestures, stats
    command-palette.js      Ctrl + K search
    lab.js                  Settings panel
    shell-pro.js            phone sheets, continue watching, action list
    guardian.js             loading spinner + retry
    ambient.js              soft glow around the video
```

---

## 4. URL architecture

```
/{anilistId}/{episode}                     → default server, default audio
/{anilistId}/{episode}?server=server_2     → pick a server
/{anilistId}/{episode}?type=sub            → sub / dub
/{anilistId}/{episode}?provider=anibd      → Kuromi mirror network
```

`window.AniFrameBridge` is the safe surface the UI layer calls:
`goToEpisode`, `nextEpisode`, `prevEpisode`, `openDrawer`, `closeDrawers`,
`rescan`, `download`, `playFirst`.

---

## 5. Adding something new

Each extra is a small module that registers itself. The UI never needs to know about
it — it appears in Settings → Features automatically, with a working on/off switch.

**1. Create `assets/nexus/features/my-thing.js`:**

```js
import { Nexus, icon, toast } from '../core.js';

Nexus.defineFeature({
  id: 'my-thing',
  name: 'My Thing',              // shown in Settings → Features
  icon: 'sparkles',
  category: 'Player',
  description: 'One short sentence, plain words.',
  tags: ['demo'],
  hotkeys: [{ combo: 'shift+m', label: 'Do my thing' }],

  mount({ Nexus }) {
    const art = Nexus.player?.art;      // may be null until a stream starts
    toast('My Thing is on', 'success');

    return () => {
      // undo everything you created here
    };
  }
});
```

**2. Register it** in `assets/nexus/features/index.js`:

```js
import './my-thing.js';
```

**3. Reload.** It starts itself and shows up in Settings → Features.

### Useful kernel calls

```js
Nexus.store.get('player.defaultRate', 1)   // saved settings, dotted paths
Nexus.store.set('theme.accent', 'blue')
Nexus.on('player:attached', fn)            // event bus
Nexus.addCommand({ id, title, group, icon, run })
Nexus.registerHotkey('mod+shift+p', fn, { label: 'Thing', group: 'My group' })
Nexus.toast('Saved', 'success')
Nexus.el('div', { class: 'x' }, '<b>html</b>')
Nexus.icon('film', 16)
Nexus.player                               // { art, engine, hud } while playing
Nexus.bridge                               // app actions
```

### Rules that keep it stable

1. **Never throw in `mount`.** Errors are caught and shown in Settings → Features.
2. **Always return a cleanup.** Turning a module off must leave nothing behind.
3. **Guard the player.** `Nexus.player?.art` is null until a stream mounts.
4. **Use the tokens.** `--nx-accent`, `--nx-surface`, `--nx-line`, `--nx-text`, `--nx-sans`.
5. **Plain language.** Labels are read by viewers, not by developers.

---

## 6. Keyboard shortcuts

| Combo | Action |
| --- | --- |
| `Ctrl/⌘ + K` | Search |
| `Ctrl/⌘ + J` | Settings |
| `Shift + ?` | Shortcut list |
| `Ctrl/⌘ + 1…5` | Servers · Streams · Episodes · Details · Comments |
| `Space` | Play / pause |
| `F` | Full screen |
| `P` | Picture-in-picture |
| `← / →` | Seek ±10s (`Shift` = ±30s) |
| `J / L` | Seek ±10s |
| `↑ / ↓` | Volume |
| `M` | Mute |
| `C` | Subtitles |
| `, / .` | Speed −/+ 0.25× |
| `Shift + D` | Player settings |
| `S` | Save current frame |
| `B` | Repeat a section |
| `I` | Stats for nerds |
| `Z` | Focus mode |
| `Shift + S` | Sleep timer 30 min |
| `N / Shift + N` | Next / previous episode |
| `Esc` | Close search, settings, focus mode |

---

## 7. Player settings panel

Open it from the sliders button in the control bar, `Shift + D`, or Search.

One scrollable list, no tabs:

- **Playback speed** — presets, fine slider, "keep voices natural".
- **Subtitles** — size, colour, background, sync.
- **Sleep timer** — off / 15 / 30 / 45 / 60 minutes.
- **Repeat a section** — mark start, mark end, turn off.
- **Picture** — fit / stretch / crop / 16:9 / 4:3, brightness, contrast, colour, zoom, soft glow.
- **Quality** — appears only when the stream offers more than one rendition.
- **More** — save frame, picture-in-picture, mini player, full screen, stats for nerds, copy details.

Touch gestures: double-tap left/right to skip 10s, drag horizontally to scrub, drag
vertically on the right for volume and on the left for brightness, hold for 2× speed,
pinch to zoom.

---

## 7b. Torrent playback

Torrents run **in the viewer's browser**, not on a server — the app stays a pure static
site on Cloudflare Pages.

- `webtorrent@1.9.7` is fetched from jsDelivr the first time a torrent is opened and
  cached for the session. Nothing torrent-related loads on page load.
- The client joins the WSS tracker swarm, streams the largest playable file through
  MediaSource, and falls back to a blob URL when the container is not streamable.
- A panel shows percentage, peers and download speed until playback starts; it then
  collapses to a `TORRENT 37%` badge. Stats for nerds adds Peers / Download / Torrent.
- **Browsers only decode MP4 and WebM.** MKV and AVI releases are reported with a plain
  message instead of a silent failure — that is the trade for not running a transcoder.

There is no third-party embed host: no webtor.io SDK, no iframe, no external player.
The player owns the `<video>` element for every source.

## 8. Responsive behaviour

| Viewport | Behaviour |
| --- | --- |
| ≤ 560 px | Panels become bottom sheets with a drag handle, top bar keeps only the essentials, player bar drops secondary buttons |
| 561–900 px | Tablet layout, side panels |
| 901–1359 px | Laptop layout |
| ≥ 1360 px | Desktop layout |
| > 2.1 aspect | Ultrawide: player panel anchored to the picture |
| ≤ 460 px height | Landscape phone: panel pinned bottom-right |
| ≤ 250 px height | Micro embeds: decorative overlay removed, playback untouched |

---

## 9. Theming

Settings → Appearance. Six colours (Rose, Blue, Green, Amber, Lavender, Graphite),
three motion levels, three surface levels, two densities. Everything is a CSS custom
property, and the player's progress bar follows the accent.

Settings persist in `localStorage` under `aniframe.nexus.v2`. Export them as JSON from
Settings → Developer.

---

## 10. Deploy

```bash
# Cloudflare Pages
Build command:      (none)
Build output dir:   /
```

`_headers` sets permissive CORS + CSP for embedding; `_redirects` keeps SPA routing.

---

## 11. Debug

```js
Nexus.version
Nexus.listFeatures()             // modules and their status
Nexus.toggleFeature('ambient-engine')
Nexus.player                     // live { art, engine, hud }
Nexus.player.hud.toggleSheet()
AniFrameBridge.state             // app state snapshot
```

If something misbehaves, turn it off in Settings → Features. The player keeps running.
