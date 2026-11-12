import type { PageContext, PageInstance } from './types';
import { el, esc, openModal, toast } from '../dom';
import { icon } from '../icons';
import { emptyState, pageHead } from '../components';
import { formatDate, formatTime } from '../../utils/format';
import { library } from '../../storage/library';
import { thumbnails } from '../../media/thumbnails';

export function createBookmarksPage(ctx: PageContext): PageInstance {
  const { router, session } = ctx;
  const root = el('div', { class: 'page' });
  const host = el('div');

  root.append(
    pageHead('Bookmarks', 'Saved moments, per video. Bookmarks are stored locally and never synced anywhere.', [
      el('button', { class: 'btn btn--sm', html: `${icon('upload', 15)} Open media`, onclick: () => router.navigate('open') }),
    ]),
    host,
  );

  const jump = (mediaId: string, url: string | undefined, kind: 'file' | 'url', time: number, name: string) => {
    if (kind === 'url' && url) {
      const spec = session.specFromUrl(url, name);
      spec.startAt = time;
      session.play(spec);
      return;
    }
    const picker = el('input', { type: 'file', class: 'hidden' });
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return;
      const spec = session.specFromFile(file);
      spec.startAt = time;
      session.play(spec);
    });
    document.body.append(picker);
    openModal({
      title: 'Open the file to jump to this bookmark',
      description: `Local file: ${name}. Choose the same file and playback starts at ${formatTime(time)}.`,
      confirmLabel: 'Choose file',
      onConfirm: () => picker.click(),
    });
    void mediaId;
  };

  const render = () => {
    host.innerHTML = '';
    const bookmarks = library.bookmarks;
    if (bookmarks.length === 0) {
      host.append(
        emptyState({
          iconName: 'bookmark',
          title: 'No bookmarks yet',
          text: 'Press K while watching, or use the bookmark button in the player, to save a moment.',
          actionLabel: 'Open media',
          onAction: () => router.navigate('open'),
        }),
      );
      return;
    }

    const groups = new Map<string, typeof bookmarks>();
    for (const bookmark of bookmarks) {
      const list = groups.get(bookmark.mediaId) ?? [];
      list.push(bookmark);
      groups.set(bookmark.mediaId, list);
    }

    for (const [mediaId, items] of groups) {
      const first = items[0];
      const section = el('section');
      const title = el('div', { class: 'section-title' });
      title.innerHTML = `<h2>${esc(first.mediaName)}</h2><span class="muted">${items.length} bookmark${items.length > 1 ? 's' : ''}</span>`;
      const list = el('div', { class: 'media-list' });
      for (const bookmark of items) {
        const row = el('div', { class: 'media-row', role: 'button', tabindex: '0' });
        row.innerHTML = `
          <div class="media-row__thumb">${icon('bookmark', 20)}</div>
          <div class="media-row__body">
            <div class="media-row__title">${esc(bookmark.label)}</div>
            <div class="media-row__meta">
              <span>${formatTime(bookmark.time)}</span>
              <span class="dot-sep">${formatDate(bookmark.createdAt)}</span>
            </div>
          </div>`;
        const actions = el('div', { class: 'media-row__actions' });
        const play = el('button', { class: 'icon-btn', 'aria-label': 'Jump to bookmark', html: icon('play', 16) });
        play.addEventListener('click', (event) => {
          event.stopPropagation();
          jump(mediaId, bookmark.url, bookmark.kind, bookmark.time, bookmark.mediaName);
        });
        const remove = el('button', { class: 'icon-btn', 'aria-label': 'Delete bookmark', html: icon('trash', 16) });
        remove.style.color = 'var(--err)';
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          void library.removeBookmark(bookmark.id);
          toast('Bookmark removed', 'ok');
        });
        actions.append(play, remove);
        row.append(actions);
        row.addEventListener('click', () => jump(mediaId, bookmark.url, bookmark.kind, bookmark.time, bookmark.mediaName));

        if (bookmark.kind === 'url' && bookmark.url && !bookmark.thumbnail) {
          const spec = session.specFromUrl(bookmark.url, bookmark.mediaName);
          void thumbnails.getPoster(spec, Math.max(0.5, bookmark.time)).then((poster) => {
            if (!poster) return;
            const thumb = row.querySelector<HTMLElement>('.media-row__thumb');
            if (thumb) thumb.innerHTML = `<img src="${poster}" alt="" loading="lazy" />`;
          });
        }
        list.append(row);
      }
      section.append(title, list);
      host.append(section);
    }
  };

  render();
  const off = library.on('bookmarks', () => render());

  return {
    el: root,
    destroy: () => off(),
  };
}
