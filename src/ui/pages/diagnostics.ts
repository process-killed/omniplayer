import type { PageContext, PageInstance } from './types';
import { el, esc, copyText, downloadFile, toast } from '../dom';
import { icon } from '../icons';
import { kvList, notice, pageHead } from '../components';
import { capabilityReport, detectCapabilities } from '../../core/capabilities';
import { checkLink } from '../../core/linkCheck';
import { codecLabel } from '../../utils/format';

interface CodecRow {
  name: string;
  mime: string;
  native: boolean;
  webcodecs: boolean;
}

const LAST_DIAGNOSTICS_KEY = 'omniplay:last-diagnostics';

export function createDiagnosticsPage(_ctx: PageContext): PageInstance {
  const store = _ctx.store;
  const root = el('div', { class: 'page' });
  const host = el('div');
  root.append(
    pageHead('Playback diagnostics', 'What this browser can actually decode, how the last file was played, and why a link is refused. Nothing here is uploaded.', [
      el('button', { class: 'btn btn--sm', html: `${icon('refresh', 15)} Refresh`, onclick: () => void render() }),
    ]),
    host,
  );

  /* ------------------------------------------------ link checker card */

  const linkCard = el('div', { class: 'card' });
  linkCard.innerHTML = `<div class="card__title">${icon('link', 16)} Check a link</div>
    <div class="card__desc">Runs the same three requests the player does and says which one fails — missing CORS header, refused HEAD, or a blocked preflight.</div>`;

  const linkInput = el('input', {
    class: 'input',
    type: 'url',
    placeholder: 'https://bucket.example/file.mkv?X-Amz-Signature=…',
    spellcheck: 'false',
  });
  const linkRun = el('button', { class: 'btn btn--primary btn--sm', html: `${icon('activity', 15)} Check` });
  const linkOut = el('div', { class: 'link-check' });
  linkCard.append(el('div', { class: 'row', style: { marginTop: '12px' } }, [linkInput, linkRun]), linkOut);

  const runCheck = async () => {
    const value = linkInput.value.trim();
    if (!value) {
      linkInput.focus();
      return;
    }
    linkRun.disabled = true;
    linkOut.innerHTML = `<div class="p-note">Probing…</div>`;
    try {
      const result = await checkLink(value, store.settings);
      linkOut.innerHTML = `
        <div class="link-check__verdict link-check__verdict--${result.verdictState}">${esc(result.verdict)}</div>
        <div class="p-note">Requests are sent from <code>${esc(result.origin)}</code> — your bucket policy must list exactly this origin.</div>
        ${result.steps
          .map(
            (step) => `<div class="link-check__row link-check__row--${step.state}">
              <span class="link-check__dot"></span>
              <b>${esc(step.label)}</b>
              <span class="link-check__detail">${esc(step.detail)}</span>
            </div>`,
          )
          .join('')}`;
    } catch (error) {
      linkOut.innerHTML = `<div class="p-note">${esc((error as Error).message)}</div>`;
    } finally {
      linkRun.disabled = false;
    }
  };
  linkRun.addEventListener('click', () => void runCheck());
  linkInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void runCheck();
  });

  const render = async () => {
    host.innerHTML = '';
    host.append(linkCard);
    const caps = detectCapabilities();

    const capabilityCard = el('div', { class: 'card' });
    capabilityCard.innerHTML = `<div class="card__title">${icon('monitor', 16)} Browser capabilities</div>`;
    const rows: Array<[string, string]> = capabilityReport().map((row) => [row.label, row.value]);
    capabilityCard.append(el('div', { style: { marginTop: '14px' } }, [kvList(rows)]));

    const codecRows = await detectCodecMatrix();
    const codecCard = el('div', { class: 'card' });
    codecCard.innerHTML = `<div class="card__title">${icon('layers', 16)} Codec matrix</div>
      <div class="card__desc">Native = Media Source Extensions support. WebCodecs = the browser exposes a decoder for that codec on this device.</div>`;
    const table = el('table', { class: 'table', style: { marginTop: '12px' } });
    table.innerHTML = `<thead><tr><th>Codec</th><th>Type</th><th>Native</th><th>WebCodecs</th></tr></thead>`;
    const tbody = el('tbody');
    for (const row of codecRows) {
      const tr = el('tr');
      tr.innerHTML = `<td>${esc(row.name)}</td><td>${esc(row.mime)}</td>
        <td><span class="chip ${row.native ? 'chip--ok' : 'chip--err'}" style="height:22px">${row.native ? 'Yes' : 'No'}</span></td>
        <td><span class="chip ${row.webcodecs ? 'chip--ok' : 'chip--err'}" style="height:22px">${row.webcodecs ? 'Yes' : 'No'}</span></td>`;
      tbody.append(tr);
    }
    table.append(tbody);
    codecCard.append(table);

    const lastRaw = sessionStorage.getItem(LAST_DIAGNOSTICS_KEY);
    const lastCard = el('div', { class: 'card' });
    lastCard.innerHTML = `<div class="card__title">${icon('activity', 16)} Last playback</div>`;
    if (!lastRaw) {
      lastCard.append(notice('No playback has been inspected in this tab yet. Open a video, then come back — the report is kept for this tab only.', 'info'));
    } else {
      try {
        const data = JSON.parse(lastRaw) as Record<string, unknown>;
        const rows2: Array<[string, string]> = [
          ['Engine', String(data.engine ?? '—')],
          ['Engine chain', Array.isArray(data.engineChain) ? (data.engineChain as string[]).join(' → ') : '—'],
          ['Container', String(data.container ?? '—')],
          ['Video codec', codecLabel(String(data.videoCodec ?? ''))],
          ['Audio codec', codecLabel(String(data.audioCodec ?? ''))],
          ['Resolution', data.width && data.height ? `${data.width} × ${data.height}` : '—'],
          ['Decoder path', String(data.decoderPath ?? '—')],
          ['Hardware acceleration', String(data.hardwareAcceleration ?? 'Unknown')],
          ['Dropped frames', data.droppedFrames !== undefined ? `${data.droppedFrames} / ${data.totalFrames ?? 0}` : 'Not measurable'],
          ['Buffer health', data.bufferHealth !== undefined ? `${data.bufferHealth}s` : '—'],
          ['Source', String(data.url ?? 'Local file')],
        ];
        lastCard.append(el('div', { style: { marginTop: '14px' } }, [kvList(rows2)]));
        if (Array.isArray(data.notes) && (data.notes as string[]).length) {
          const notes = el('div', { class: 'code-block', style: { marginTop: '12px' } });
          notes.textContent = (data.notes as string[]).join('\n');
          lastCard.append(notes);
        }
      } catch {
        lastCard.append(notice('The stored report could not be parsed.', 'warn'));
      }
    }

    const actions = el('div', { class: 'row', style: { marginTop: '14px' } });
    const copyButton = el('button', { class: 'btn btn--sm', html: `${icon('copy', 15)} Copy report` });
    copyButton.addEventListener('click', async () => {
      const report = buildReport(caps, codecRows, lastRaw);
      const ok = await copyText(report);
      toast(ok ? 'Report copied' : 'Clipboard blocked', ok ? 'ok' : 'warn');
    });
    const downloadButton = el('button', { class: 'btn btn--sm', html: `${icon('download', 15)} Download JSON` });
    downloadButton.addEventListener('click', () => {
      downloadFile('omniplay-diagnostics.json', buildReport(caps, codecRows, lastRaw), 'application/json');
    });
    actions.append(copyButton, downloadButton);
    lastCard.append(actions);

    host.append(
      el('div', { class: 'grid grid--2' }, [capabilityCard, codecCard]),
      el('div', { style: { marginTop: '14px' } }, [lastCard]),
      el('div', { style: { marginTop: '14px' } }, [
        notice(
          'Hardware acceleration can only be reported, never forced. Chrome exposes it through MediaCapabilities; Firefox and Safari often report “unknown”, which is why OmniPlay says “Unknown” instead of guessing.',
          'info',
        ),
      ]),
    );
  };

  void render();

  return { el: root };
}

async function detectCodecMatrix(): Promise<CodecRow[]> {
  const caps = detectCapabilities();
  const checks: Array<{ name: string; mime: string; native: boolean; codec: string }> = [
    { name: 'H.264 / AVC', mime: 'video/mp4', native: caps.codecs.avc, codec: 'avc1.42E01E' },
    { name: 'H.265 / HEVC', mime: 'video/mp4', native: caps.codecs.hevc, codec: 'hvc1.1.6.L93.B0' },
    { name: 'AV1', mime: 'video/mp4', native: caps.codecs.av1, codec: 'av01.0.05M.08' },
    { name: 'VP9', mime: 'video/webm', native: caps.codecs.vp9, codec: 'vp09.00.10.08' },
    { name: 'VP8', mime: 'video/webm', native: caps.codecs.vp8, codec: 'vp8' },
    { name: 'AAC', mime: 'audio/mp4', native: caps.codecs.aac, codec: 'mp4a.40.2' },
    { name: 'MP3', mime: 'audio/mpeg', native: caps.codecs.mp3, codec: 'mp3' },
    { name: 'Opus', mime: 'audio/webm', native: caps.codecs.opus, codec: 'opus' },
    { name: 'FLAC', mime: 'audio/flac', native: caps.codecs.flac, codec: 'flac' },
    { name: 'AC-3', mime: 'audio/mp4', native: caps.codecs.ac3, codec: 'ac-3' },
    { name: 'E-AC-3', mime: 'audio/mp4', native: caps.codecs.eac3, codec: 'ec-3' },
  ];

  const rows: CodecRow[] = [];
  for (const check of checks) {
    let webcodecs = false;
    const isVideo = check.mime.startsWith('video');
    try {
      if (isVideo && 'VideoDecoder' in window) {
        const result = await VideoDecoder.isConfigSupported({ codec: check.codec, codedWidth: 1280, codedHeight: 720 });
        webcodecs = !!result.supported;
      } else if (!isVideo && 'AudioDecoder' in window) {
        const result = await AudioDecoder.isConfigSupported({ codec: check.codec, sampleRate: 48000, numberOfChannels: 2 });
        webcodecs = !!result.supported;
      }
    } catch {
      webcodecs = false;
    }
    rows.push({ name: check.name, mime: check.mime, native: check.native, webcodecs });
  }
  return rows;
}

function buildReport(caps: ReturnType<typeof detectCapabilities>, codecs: CodecRow[], last: string | null): string {
  return JSON.stringify(
    {
      app: 'OmniPlay',
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      capabilities: caps,
      codecMatrix: codecs,
      lastPlayback: last ? JSON.parse(last) : null,
    },
    null,
    2,
  );
}
