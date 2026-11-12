import type { PageContext, PageInstance } from './types';
import { el, esc, toast } from '../dom';
import { icon } from '../icons';
import { notice, pageHead, settingRow } from '../components';
import { library } from '../../storage/library';
import { formatRelative, shortUrl } from '../../utils/format';
import { describeLink } from '../../sources/registry';
import { redactUrl } from '../../core/errors';

export function createUrlPage(ctx: PageContext): PageInstance {
  const { store, session, router } = ctx;
  const root = el('div', { class: 'page' });

  root.append(
    pageHead(
      'Play a link',
      'Paste a direct media URL, an HLS playlist (.m3u8) or a DASH manifest (.mpd). The player inspects headers and container bytes before choosing an engine.',
    ),
  );

  const form = el('div', { class: 'card card--pad-lg stack' });
  const input = el('input', {
    class: 'input',
    type: 'url',
    placeholder: 'https://example.com/video.mp4  ·  .mkv  ·  .m3u8  ·  .mpd',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  input.value = '';

  const playButton = el('button', { class: 'btn btn--primary', html: `${icon('play', 16)} Play` });
  const pasteButton = el('button', { class: 'btn', html: `${icon('copy', 16)} Paste` });
  const embedButton = el('button', { class: 'btn', html: `${icon('code', 16)} Embed` });
  embedButton.addEventListener('click', () => {
    const value = input.value.trim();
    router.navigate('share', value ? { src: value } : {});
  });

  const row = el('div', { class: 'row', style: { gap: '10px' } }, [input, playButton, pasteButton, embedButton]);
  input.style.flex = '1';
  input.style.minWidth = '240px';

  const errorHost = el('div');

  // Live hint: say what the link is before the user presses Play.
  const preview = el('div', { class: 'link-preview' });
  const renderPreview = () => {
    const value = input.value.trim();
    if (!value) {
      preview.innerHTML = '';
      return;
    }
    const info = describeLink(value);
    const tone = info.kind === 'provider' ? 'warn' : info.kind === 'magnet' ? 'accent' : '';
    preview.innerHTML = `<span class="chip ${tone}">${esc(info.adapter)}</span>${
      info.note ? `<span class="link-preview__note">${esc(info.note)}</span>` : ''
    }`;
  };
  input.addEventListener('input', renderPreview);

  const submit = async () => {
    const value = input.value.trim();
    errorHost.innerHTML = '';
    if (/^magnet:\?/i.test(value)) {
      router.navigate('torrents', { magnet: value });
      return;
    }
    if (!value) {
      input.focus();
      return;
    }
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errorHost.append(notice('Only http:// and https:// links can be played.', 'err'));
        return;
      }
    } catch {
      errorHost.append(notice('That does not look like a valid URL. Include the full address, starting with https://', 'err'));
      return;
    }
    const headers = parseHeaders(store.settings.customHeaders);
    await session.openUrl(value, { headers });
  };

  playButton.addEventListener('click', () => void submit());
  pasteButton.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        input.value = text.trim();
        input.focus();
      }
    } catch {
      toast('Clipboard access was blocked — paste manually with Ctrl/Cmd+V.', 'warn');
    }
  });
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') void submit();
  });

  form.append(row, preview, errorHost);
  root.append(form);

  /* ---------------------------------------------------------- advanced */

  const advanced = el('details', { class: 'card', style: { marginTop: '14px' } });
  const summary = el('summary', {
    style: { cursor: 'pointer', fontSize: '13.5px', fontWeight: '600', listStyle: 'none' },
    html: `${icon('sliders', 15)} <span style="margin-left:6px">Request options</span>`,
  });
  advanced.append(summary);

  const advancedBody = el('div', { style: { marginTop: '14px' } });

  const headersArea = el('textarea', {
    class: 'input',
    placeholder: 'Referer: https://example.com\nAuthorization: Bearer …',
    spellcheck: 'false',
  });
  headersArea.value = store.settings.customHeaders;
  headersArea.addEventListener('change', () => store.updateSettings({ customHeaders: headersArea.value }));

  advancedBody.append(
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Extra request headers' }),
      headersArea,
      el('span', {
        class: 'field__hint',
        text: 'One “Name: value” per line. Browsers forbid User-Agent, Origin, Referer and Cookie — those are silently dropped, by design.',
      }),
    ]),
  );

  advancedBody.append(
    settingRow(
      'Request timeout',
      'How long to wait for the server before reporting a timeout.',
      numberSelect([5, 10, 20, 30, 60], store.settings.requestTimeout, (value) => store.updateSettings({ requestTimeout: value })),
    ),
    settingRow(
      'Retries',
      'Attempts for HLS/DASH segment and manifest failures.',
      numberSelect([0, 1, 2, 3, 5], store.settings.retryCount, (value) => store.updateSettings({ retryCount: value })),
    ),
    settingRow(
      'Buffer ahead',
      'Seconds of stream to keep buffered. Lower saves mobile data and memory.',
      numberSelect([10, 20, 30, 60, 90], store.settings.bufferAhead, (value) => store.updateSettings({ bufferAhead: value })),
    ),
  );
  advanced.append(advancedBody);
  root.append(advanced);

  root.append(
    el('div', { class: 'grid grid--2', style: { marginTop: '14px' } }, [
      notice(
        'Direct links only. A page URL (HTML) is detected and refused rather than pretending to play. Streaming sites usually hide their media behind tokens and DRM.',
        'info',
      ),
      notice(
        'CORS is a server decision. If a host does not send Access-Control-Allow-Origin, the browser blocks the bytes and no client-side trick can bypass it.',
        'warn',
      ),
    ]),
  );

  /* ------------------------------------------------------------ recents */

  const recents = el('section');
  const renderRecents = () => {
    recents.innerHTML = '';
    const urls = library.urls;
    const title = el('div', { class: 'section-title' });
    title.innerHTML = `<h2>Recent links</h2><span class="muted">${urls.length}</span>`;
    recents.append(title);

    if (urls.length === 0) {
      const empty = el('div', { class: 'empty' });
      empty.innerHTML = `${icon('link', 30)}<h3>No links yet</h3><p>Links you play are remembered here (query strings are hidden in the UI, never logged).</p>`;
      recents.append(empty);
      return;
    }

    const list = el('div', { class: 'media-list' });
    for (const record of urls) {
      const row = el('div', { class: 'media-row', role: 'button', tabindex: '0' });
      row.innerHTML = `
        <div class="media-row__thumb">${icon('link', 20)}</div>
        <div class="media-row__body">
          <div class="media-row__title">${esc(record.name)}</div>
          <div class="media-row__meta"><span class="mono truncate" title="${esc(redactUrl(record.url))}">${esc(shortUrl(record.url))}</span><span class="dot-sep">${formatRelative(record.lastUsed)}</span></div>
        </div>`;
      const actions = el('div', { class: 'media-row__actions' });
      const play = el('button', { class: 'icon-btn', 'aria-label': 'Play', html: icon('play', 16) });
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        void session.openUrl(record.url, { headers: parseHeaders(store.settings.customHeaders) });
      });
      const remove = el('button', { class: 'icon-btn', 'aria-label': 'Remove', html: icon('trash', 16) });
      remove.style.color = 'var(--err)';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        void library.removeUrl(record.id);
      });
      actions.append(play, remove);
      row.append(actions);
      row.addEventListener('click', () => void session.openUrl(record.url, { headers: parseHeaders(store.settings.customHeaders) }));
      list.append(row);
    }
    recents.append(list);
  };

  renderRecents();
  root.append(recents);

  const offUrls = library.on('urls', () => renderRecents());

  return {
    el: root,
    destroy: () => offUrls(),
    onShow: () => input.focus(),
  };
}

function numberSelect(values: number[], current: number, onChange: (value: number) => void): HTMLSelectElement {
  const select = el('select', { class: 'select' });
  for (const value of values) {
    const option = el('option', { value: String(value), text: `${value}s` });
    if (value === current) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(Number(select.value)));
  return select;
}

function parseHeaders(raw: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!name || !value) continue;
    if (/^(user-agent|origin|referer|cookie|host)$/i.test(name)) continue;
    headers[name] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}
