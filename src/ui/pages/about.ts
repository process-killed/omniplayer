import type { PageContext, PageInstance } from './types';
import { el, esc } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { DEFAULT_KEYBINDINGS, KEY_ACTION_LABELS } from '../../storage/settings';
import { capabilityReport } from '../../core/capabilities';

const LIMITATIONS: Array<[string, string]> = [
  ['Codecs without browser decoders', 'DTS, DTS-HD, TrueHD, VC-1, RMVB, APE and many ProRes profiles have no WebCodecs decoder. OmniPlay identifies them and says so instead of failing silently.'],
  ['Embedded subtitles in MKV', 'ASS/SSA/SRT/WebVTT and PGS tracks inside MKV are extracted on demand and rendered by the player. DVD/VobSub (.idx/.sub) is not decoded yet — .sup (PGS) is.'],
  ['Remote MKV needs CORS', 'To demux MKV the player must read the bytes. Without Access-Control-Allow-Origin it falls back to the native element, which plays WebM-profile MKV but not H.264/HEVC MKV — those need CORS, a proxy, or a local copy.'],
  ['Multiple audio tracks', 'Browsers do not expose MP4 audio tracks through <video>. The WebCodecs engine can switch them; the native engine cannot.'],
  ['Negative audio delay', 'Browsers cannot delay video, so audio can only be pushed later (0–2000 ms).'],
  ['WebCodecs speed changes', 'The WebCodecs engine changes pitch with speed because it schedules decoded buffers. The native engine preserves pitch.'],
  ['Device brightness', 'JavaScript cannot change screen brightness. Gesture brightness is a video filter.'],
  ['Chromecast / AirPlay', 'These need platform APIs that are not exposed to ordinary web pages. OmniPlay does not fake them.'],
  ['DRM', 'Encrypted media is never bypassed. Play protected content in its official app.'],
  ['Persistent local files', 'After a reload the browser gives no access to a local file unless you pick it again.'],
  ['360°/3D', 'Experimental projection modules are not part of this build, so the toggle is intentionally absent rather than decorative.'],
  ['iOS installation', 'Safari has no install API — use Share → Add to Home Screen. An installed iOS web app also gets its own storage container, so history starts fresh there.'],
  ['iPhone fullscreen', 'Element fullscreen is not exposed on iPhone Safari. Install to the Home Screen for a full-screen player instead.'],
];

export function createAboutPage(_ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });
  root.append(
    pageHead('About OmniPlay', 'A universal media player that runs entirely in your browser — built to behave like a desktop player, not a demo.'),
  );

  const hero = el('div', { class: 'card card--pad-lg' });
  hero.innerHTML = `
    <div class="row" style="gap:14px;align-items:flex-start">
      <div class="brand__mark" style="width:46px;height:46px;border-radius:14px">${icon('play', 22)}</div>
      <div style="flex:1;min-width:220px">
        <h2 style="font-size:18px;font-weight:700;letter-spacing:-.02em">OmniPlay 1.22.0</h2>
        <p class="text-sm muted" style="margin-top:4px;max-width:70ch">
          Local files, direct links, HLS and DASH. Native hardware decoding first, then MSE, then WebCodecs
          software decoding with a real demuxer. Multi-language audio, styled ASS subtitles, a ten-band equaliser,
          picture filters, gestures and diagnostics — all client-side.
        </p>
      </div>
    </div>`;
  root.append(hero);

  const architecture = el('div', { class: 'card' });
  architecture.innerHTML = `<div class="card__title">${icon('layers', 16)} Engine hierarchy</div>
    <div class="card__desc">Chosen per source from real capability checks, with visible fallbacks.</div>`;
  const steps = el('div', { class: 'media-list', style: { marginTop: '12px' } });
  const chain: Array<[string, string, string]> = [
    ['1', 'Native HTML5', 'Best performance and battery life; hardware decoding when the browser offers it.'],
    ['2', 'MSE streaming', 'hls.js for HLS, dash.js for DASH, with adaptive bitrate and manual quality.'],
    ['3', 'WebCodecs + demuxer', 'mediabunny reads MKV, AVI, MOV and more; frames render to canvas, audio goes through Web Audio.'],
    ['4', 'Diagnostic stop', 'If no engine can decode the file, you get the exact codec, the reason and what to do next.'],
  ];
  for (const [index, title, text] of chain) {
    const row = el('div', { class: 'media-row' });
    row.innerHTML = `<div class="media-row__thumb" style="width:40px;aspect-ratio:1;border-radius:10px">${index}</div>
      <div class="media-row__body"><div class="media-row__title">${esc(title)}</div><div class="media-row__meta">${esc(text)}</div></div>`;
    steps.append(row);
  }
  architecture.append(steps);

  const privacy = el('div', { class: 'card' });
  privacy.innerHTML = `<div class="card__title">${icon('shield', 16)} Privacy</div>
    <div class="card__desc" style="margin-top:8px">
      No backend, no accounts, no analytics, no ads. Media is decoded on your device. History, bookmarks,
      playlists and settings live in IndexedDB/localStorage. Signed URLs are redacted in diagnostics so tokens
      never end up in a report.
    </div>`;

  const limitations = el('div', { class: 'card' });
  limitations.innerHTML = `<div class="card__title">${icon('alertCircle', 16)} Honest limitations</div>
    <div class="card__desc">A browser is not VLC. These are the things this build genuinely cannot do, and why.</div>`;
  const table = el('table', { class: 'table', style: { marginTop: '12px' } });
  table.innerHTML = '<thead><tr><th>Area</th><th>Reality</th></tr></thead>';
  const tbody = el('tbody');
  for (const [area, text] of LIMITATIONS) {
    const tr = el('tr');
    tr.innerHTML = `<td style="color:var(--txt);font-weight:550">${esc(area)}</td><td>${esc(text)}</td>`;
    tbody.append(tr);
  }
  table.append(tbody);
  limitations.append(table);

  const keys = el('div', { class: 'card' });
  keys.innerHTML = `<div class="card__title">${icon('keyboard', 16)} Keyboard shortcuts</div>`;
  const keyTable = el('table', { class: 'table', style: { marginTop: '12px' } });
  keyTable.innerHTML = '<thead><tr><th>Action</th><th>Key</th></tr></thead>';
  const keyBody = el('tbody');
  for (const [action, label] of Object.entries(KEY_ACTION_LABELS)) {
    const tr = el('tr');
    tr.innerHTML = `<td>${esc(label)}</td><td><span class="chip" style="font-family:var(--font-mono)">${esc(DEFAULT_KEYBINDINGS[action] ?? '—')}</span></td>`;
    keyBody.append(tr);
  }
  keyTable.append(keyBody);
  keys.append(keyTable, el('div', { class: 'card__desc', style: { marginTop: '10px' }, text: 'Every shortcut can be remapped in Settings → Keyboard.' }));

  const tech = el('div', { class: 'card' });
  tech.innerHTML = `<div class="card__title">${icon('bookOpen', 16)} Built with</div>
    <div class="card__desc" style="margin-top:8px">
      TypeScript · Vite · hls.js (Apache-2.0) · dash.js (BSD-3-Clause) · mediabunny (MPL-2.0) · WebCodecs ·
      Media Source Extensions · Web Audio API · IndexedDB. The interface is hand-written CSS — no UI framework.
    </div>`;

  const environment = el('div', { class: 'card' });
  environment.innerHTML = `<div class="card__title">${icon('activity', 16)} This device</div>`;
  const envRows = capabilityReport().slice(0, 8);
  const dl = el('dl', { class: 'kv', style: { marginTop: '12px' } });
  for (const row of envRows) dl.append(el('dt', { text: row.label }), el('dd', { text: row.value }));
  environment.append(dl);

  root.append(
    el('div', { class: 'grid grid--2', style: { marginTop: '14px' } }, [architecture, privacy]),
    el('div', { style: { marginTop: '14px' } }, [limitations]),
    el('div', { class: 'grid grid--2', style: { marginTop: '14px' } }, [keys, el('div', { class: 'stack' }, [tech, environment])]),
    el('div', { style: { marginTop: '14px' } }, [
      notice('OmniPlay does not download, decrypt or redistribute media. It plays what you already have access to.', 'info'),
    ]),
  );

  return { el: root };
}
