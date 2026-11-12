import type { HistoryEntry } from '../../types';
import type { PageContext, PageInstance } from './types';
import { el, esc, openModal } from '../dom';
import { icon } from '../icons';
import { emptyState, mediaRow } from '../components';
import { formatBytes, formatRelative, formatTime } from '../../utils/format';
import { library } from '../../storage/library';
import { detectCapabilities } from '../../core/capabilities';
import { thumbnails } from '../../media/thumbnails';
import { toast } from '../dom';

export function createHomePage(ctx: PageContext): PageInstance {
  const { store, router, session } = ctx;
  const root = el('div', { class: 'page' });

  const fileInput = el('input', { type: 'file', accept: 'video/*,audio/*,.mkv,.avi,.mov,.flv,.ts,.m2ts,.m4v,.3gp,.wmv,.ogv', multiple: true, class: 'hidden' });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (files.length) void session.openFiles(files);
  });

  const hero = el('section', { class: 'hero' });
  hero.innerHTML = `
    <div class="hero__inner">
      <span class="hero__eyebrow">${icon('shield', 13)} 100% local playback</span>
      <h1>Your media. <em>Any format.</em><br />Nothing leaves this device.</h1>
      <p>
        A browser media engine built like a desktop player: local files, direct links,
        HLS and DASH, multiple audio languages, styled ASS subtitles, a ten-band
        equaliser and real playback diagnostics.
      </p>
      <div class="hero__actions">
        <button class="btn btn--primary" id="hero-open">${icon('folderOpen', 16)} Open media</button>
        <button class="btn" id="hero-url">${icon('link', 16)} Play a link</button>
      </div>
      <div class="hero__stats" id="hero-stats"></div>
    </div>
  `;
  hero.querySelector('#hero-open')?.addEventListener('click', () => fileInput.click());
  hero.querySelector('#hero-url')?.addEventListener('click', () => router.navigate('url'));
  root.append(hero, fileInput);

  const continueSection = el('section');
  const recentSection = el('section');
  const features = el('section');
  root.append(continueSection, recentSection, features);

  const renderStats = () => {
    const host = hero.querySelector('#hero-stats');
    if (!host) return;
    const history = library.history;
    const totalTime = history.reduce((sum, entry) => sum + (entry.duration || 0), 0);
    host.innerHTML = `
      <div class="hero__stat"><b>${history.length}</b><span>In library</span></div>
      <div class="hero__stat"><b>${library.bookmarks.length}</b><span>Bookmarks</span></div>
      <div class="hero__stat"><b>${library.playlists.length}</b><span>Playlists</span></div>
      <div class="hero__stat"><b>${totalTime > 0 ? formatTime(totalTime) : '0:00'}</b><span>Total runtime</span></div>
    `;
  };

  const openHistoryEntry = (entry: HistoryEntry) => {
    if (entry.kind === 'url' && entry.url) {
      const spec = session.specFromUrl(entry.url, entry.name);
      spec.startAt = entry.position > 5 ? entry.position : undefined;
      session.play(spec);
      return;
    }
    // Local files cannot be reopened automatically — the browser has no handle.
    const body = el('div', { class: 'stack' }, [
      el('p', {
        class: 'text-sm muted',
        text: 'Browsers cannot reopen a local file without your permission. Choose the same file again to continue from where you stopped.',
      }),
    ]);
    const picker = el('input', { type: 'file', class: 'hidden' });
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return;
      const spec = session.specFromFile(file);
      spec.startAt = entry.position > 5 ? entry.position : undefined;
      const queue = store.queue.length ? store.queue : [spec];
      store.setQueue(queue, 0);
      session.play(spec);
    });
    document.body.append(picker);
    openModal({
      title: entry.name,
      description: `${formatTime(entry.position)} watched · ${formatRelative(entry.updatedAt)}`,
      body,
      confirmLabel: 'Choose file',
      onConfirm: () => {
        picker.click();
      },
    });
  };

  const renderContinue = () => {
    continueSection.innerHTML = '';
    const items = library.continueWatching;
    if (items.length === 0) return;
    const title = el('div', { class: 'section-title' });
    title.innerHTML = `<h2>Continue watching</h2><span class="muted">${items.length}</span>`;
    const list = el('div', { class: 'media-list' });
    for (const entry of items) {
      const percent = entry.duration ? (entry.position / entry.duration) * 100 : 0;
      const row = mediaRow({
        title: entry.name,
        meta: `<span>${icon('clock', 12)} ${formatTime(entry.position)} / ${entry.duration ? formatTime(entry.duration) : '—'}</span>
               <span class="dot-sep">${entry.kind === 'file' ? 'Local file' : 'Stream'}</span>
               <span class="dot-sep">${formatRelative(entry.updatedAt)}</span>`,
        poster: entry.poster,
        progress: percent,
        onClick: () => openHistoryEntry(entry),
        actions: [
          { iconName: 'play', label: 'Resume', onClick: () => openHistoryEntry(entry) },
          {
            iconName: 'trash',
            label: 'Remove from history',
            danger: true,
            onClick: () => {
              void library.removeHistory(entry.id);
              toast('Removed from history', 'ok');
            },
          },
        ],
      });
      list.append(row);
      if (!entry.poster) {
        const spec = entry.kind === 'url' && entry.url ? session.specFromUrl(entry.url, entry.name) : null;
        if (spec) {
          void thumbnails.getPoster(spec).then((poster) => {
            if (!poster) return;
            const thumb = row.querySelector<HTMLElement>('.media-row__thumb');
            if (thumb) thumb.innerHTML = `<img src="${poster}" alt="" loading="lazy" />`;
            void library.recordProgress({ ...entry, poster });
          });
        }
      }
    }
    continueSection.append(title, list);
  };

  const renderRecent = () => {
    recentSection.innerHTML = '';
    const items = library.history.slice(0, 6);
    const title = el('div', { class: 'section-title' });
    title.innerHTML = `<h2>Recently played</h2><span class="muted">${library.history.length} total</span>`;
    const action = el('button', { class: 'btn btn--ghost btn--sm', text: 'View all' });
    action.addEventListener('click', () => router.navigate('history'));
    title.append(el('div', { class: 'section-title__actions' }, [action]));
    if (items.length === 0) {
      recentSection.append(
        title,
        emptyState({
          iconName: 'film',
          title: 'Nothing played yet',
          text: 'Open a local video or paste a direct link — playback history stays on this device.',
          actionLabel: 'Open media',
          onAction: () => router.navigate('open'),
        }),
      );
      return;
    }
    const list = el('div', { class: 'media-list' });
    for (const entry of items) {
      list.append(
        mediaRow({
          title: entry.name,
          meta: `<span>${entry.kind === 'file' ? formatBytes(entry.size) : 'Network'}</span>
                 <span class="dot-sep">${entry.duration ? formatTime(entry.duration) : '—'}</span>
                 <span class="dot-sep">${formatRelative(entry.updatedAt)}</span>`,
          poster: entry.poster,
          onClick: () => openHistoryEntry(entry),
        }),
      );
    }
    recentSection.append(title, list);
  };

  const renderFeatures = () => {
    const caps = detectCapabilities();
    const items: Array<[string, string, string]> = [
      ['layers', 'Universal container support', 'MP4, MKV, WebM, AVI, MOV, FLV, TS, M2TS and more — with real codec inspection, not extension guessing.'],
      ['zap', 'Intelligent engine choice', 'Native hardware decoding first, then MSE, then WebCodecs software decoding. Every fallback is visible, never silent.'],
      ['languages', 'Multi-language audio', 'Pick real embedded audio tracks, with preferred and fallback language rules that are remembered.'],
      ['subtitles', 'Anime-grade subtitles', 'Styled ASS/SSA rendering with positioning, outlines, fonts and karaoke — plus SRT, VTT and TTML.'],
      ['audio', 'Full audio engine', '10-band equaliser, presets, bass, balance, mono, compression and audio delay.'],
      ['hand', 'MX-style gestures', 'Double-tap zones, horizontal scrubbing, vertical volume and brightness, long-press speed, pinch zoom.'],
      ['activity', 'Honest diagnostics', 'Codec, engine, buffer health, dropped frames and hardware-acceleration status you can copy.'],
      ['shield', 'Private by architecture', 'No backend, no uploads, no analytics. History and settings live in your browser only.'],
    ];
    const title = el('div', { class: 'section-title' });
    title.innerHTML = `<h2>What makes it different</h2><span class="muted">${caps.browser.name} ${caps.browser.version} · ${caps.os}</span>`;
    const grid = el('div', { class: 'feature-grid' });
    for (const [iconName, heading, text] of items) {
      const card = el('div', { class: 'feature' });
      card.innerHTML = `${icon(iconName, 18)}<h3>${esc(heading)}</h3><p>${esc(text)}</p>`;
      grid.append(card);
    }
    features.append(title, grid);
  };

  const renderAll = () => {
    renderStats();
    renderContinue();
    renderRecent();
  };

  renderAll();
  renderFeatures();

  const offHistory = library.on('history', () => renderAll());
  const offBookmarks = library.on('bookmarks', () => renderStats());
  const offPlaylists = library.on('playlists', () => renderStats());

  return {
    el: root,
    destroy: () => {
      offHistory();
      offBookmarks();
      offPlaylists();
    },
  };
}
