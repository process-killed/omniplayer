import type { PageContext, PageInstance } from './types';
import { el, esc, toast, copyText } from '../dom';
import { icon } from '../icons';
import { notice, pageHead, settingRow, switchRow } from '../components';
import { DEFAULT_EMBED, buildIframeCode, buildShareUrl, extractSource, type EmbedOptions } from '../../app/embed';

/**
 * Builds the iframe snippet a site owner pastes into their page, and previews it.
 * This is the "put a direct link after the site URL" workflow.
 */
export function createSharePage(ctx: PageContext): PageInstance {
  const { router } = ctx;
  const root = el('div', { class: 'page' });

  const options: EmbedOptions = { ...DEFAULT_EMBED };
  const incoming = extractSource(router.current.params.src ?? '');
  if (incoming) options.src = incoming;

  const base = `${window.location.origin}${window.location.pathname}`;

  const linkInput = el('input', {
    class: 'input',
    type: 'url',
    placeholder: 'https://host/path/video.mp4 — or an .mkv with CORS enabled',
    value: options.src,
    spellcheck: 'false',
  });

  const titleInput = el('input', { class: 'input', type: 'text', placeholder: 'Optional caption', value: options.title, maxlength: '120' });
  const posterInput = el('input', { class: 'input', type: 'url', placeholder: 'https://host/poster.jpg', value: options.poster });
  const subtitleInput = el('input', { class: 'input', type: 'url', placeholder: 'https://host/subs.vtt or .srt', value: options.subtitle });
  const startInput = el('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: '0', value: options.start ? String(options.start) : '' });

  const iframeOut = el('textarea', { class: 'code-area', rows: '7', readonly: 'true', spellcheck: 'false' });
  const linkOut = el('input', { class: 'input mono-input', type: 'text', readonly: 'true' });

  const previewBox = el('div', { class: 'embed-preview' });

  const render = () => {
    const url = buildShareUrl(base, options);
    iframeOut.value = buildIframeCode(url, options);
    linkOut.value = url;

    const missing = !options.src;
    previewBox.innerHTML = missing
      ? `<div class="embed-preview__empty">${icon('monitor', 22)}<span>Paste a direct link to preview the embed.</span></div>`
      : `<iframe src="${esc(url)}" title="Preview" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
  };

  const sync = () => {
    options.src = extractSource(linkInput.value);
    options.title = titleInput.value.trim();
    options.poster = posterInput.value.trim();
    options.subtitle = subtitleInput.value.trim();
    const start = Number(startInput.value);
    options.start = Number.isFinite(start) && start > 0 ? start : 0;
    render();
  };

  for (const input of [linkInput, titleInput, posterInput, subtitleInput, startInput]) {
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
  }

  root.append(
    pageHead('Embed & share', 'Paste a direct media link and copy a ready-to-use iframe — or share the player link itself.'),
    el('div', { class: 'share-grid' }, [
      sectionCard('Source', 'Direct file links only. HLS (.m3u8) and DASH (.mpd) work too.', [
        settingRow('Media link', 'The file the iframe should play.', linkInput),
        settingRow('Caption', 'Shown in the player title bar.', titleInput),
        settingRow('Poster', 'Image shown before playback starts.', posterInput),
        settingRow('Subtitles', 'A .vtt/.srt/.ass file served with CORS.', subtitleInput),
        settingRow('Start at', 'Seconds to skip on load.', startInput),
        el('div', { class: 'row', style: { marginTop: '4px' } }, [
          switchRow('Autoplay', 'Most browsers only allow this when muted.', options.autoplay, (value) => {
            options.autoplay = value;
            render();
          }),
          switchRow('Muted', 'Guarantees autoplay works.', options.muted, (value) => {
            options.muted = value;
            render();
          }),
          switchRow('Loop', 'Restart when the video ends.', options.loop, (value) => {
            options.loop = value;
            render();
          }),
          switchRow('Controls', 'Turn off for a click-to-play surface.', options.controls, (value) => {
            options.controls = value;
            render();
          }),
        ]),
      ]),
      sectionCard('Embed code', 'Paste this where the player should appear.', [
        iframeOut,
        el('div', { class: 'share-link-row' }, [
          el('span', { class: 'share-link-row__label', text: 'Player link' }),
          linkOut,
        ]),
        el('div', { class: 'row' }, [
          button('Copy iframe', 'copy', async () => {
            const ok = await copyText(iframeOut.value);
            toast(ok ? 'Iframe copied' : 'Clipboard blocked', ok ? 'ok' : 'warn');
          }),
          button('Copy player link', 'link', async () => {
            const ok = await copyText(linkOut.value);
            toast(ok ? 'Player link copied' : 'Clipboard blocked', ok ? 'ok' : 'warn');
          }),
          button('Open preview', 'externalLink', () => window.open(linkOut.value, '_blank', 'noopener')),
        ]),
        notice(
          'The iframe works on any site. Your host must allow the file over CORS for MKV/AVI; MP4/WebM play without it. Add a proxy in Settings → Network if a bucket blocks access.',
        ),
      ]),
    ]),
    sectionCard('Live preview', 'Exactly what the iframe shows — resized to fit here.', [previewBox]),
  );

  render();
  linkInput.focus();

  return { el: root };
}

function sectionCard(title: string, description: string, children: Node[]): HTMLElement {
  const card = el('div', { class: 'card' });
  const head = el('div');
  head.innerHTML = `<div class="card__title">${esc(title)}</div><div class="card__desc">${esc(description)}</div>`;
  card.append(head, ...children);
  return card;
}

function button(label: string, iconName: string, onClick: () => void): HTMLElement {
  const node = el('button', { class: 'btn btn--sm', type: 'button' });
  node.innerHTML = `${icon(iconName, 15)} ${esc(label)}`;
  node.addEventListener('click', onClick);
  return node;
}
