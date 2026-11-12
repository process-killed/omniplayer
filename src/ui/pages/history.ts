import type { HistoryEntry } from '../../types';
import type { PageContext, PageInstance } from './types';
import { el, openModal, toast } from '../dom';
import { icon } from '../icons';
import { emptyState, mediaRow, pageHead } from '../components';
import { formatBytes, formatRelative, formatTime } from '../../utils/format';
import { library } from '../../storage/library';

export function createHistoryPage(ctx: PageContext): PageInstance {
  const { router, session } = ctx;
  const root = el('div', { class: 'page' });
  const listHost = el('div');
  let query = '';

  const search = el('input', { class: 'input', placeholder: 'Search history…', type: 'search', style: { maxWidth: '320px' } });
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    render();
  });

  const clearButton = el('button', { class: 'btn btn--danger btn--sm', html: `${icon('trash', 15)} Clear history` });
  clearButton.addEventListener('click', () => {
    openModal({
      title: 'Clear all history?',
      description: 'This removes every entry from this browser. Bookmarks and playlists are kept.',
      confirmLabel: 'Clear history',
      danger: true,
      onConfirm: () => {
        void library.clearHistory();
        toast('History cleared', 'ok');
      },
    });
  });

  root.append(
    pageHead('Watch history', 'Stored only in this browser. Local files cannot be reopened automatically — pick the file again to resume.', [search, clearButton]),
    listHost,
  );

  const openEntry = (entry: HistoryEntry) => {
    if (entry.kind === 'url' && entry.url) {
      const spec = session.specFromUrl(entry.url, entry.name);
      spec.startAt = entry.position > 5 ? entry.position : undefined;
      session.play(spec);
      return;
    }
    const picker = el('input', { type: 'file', class: 'hidden' });
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return;
      const spec = session.specFromFile(file);
      spec.startAt = entry.position > 5 ? entry.position : undefined;
      session.play(spec);
    });
    document.body.append(picker);
    openModal({
      title: 'Reopen this file',
      description: 'Browsers require you to pick the file again after a reload. Progress will resume from where you stopped.',
      body: el('p', { class: 'text-sm muted', text: entry.name }),
      confirmLabel: 'Choose file',
      onConfirm: () => picker.click(),
    });
  };

  const render = () => {
    listHost.innerHTML = '';
    const items = library.history.filter((entry) => !query || entry.name.toLowerCase().includes(query));
    if (items.length === 0) {
      listHost.append(
        emptyState({
          iconName: 'clock',
          title: query ? 'No matches' : 'No history yet',
          text: query ? 'Try a different search term.' : 'Videos you play appear here with your progress.',
          actionLabel: 'Open media',
          onAction: () => router.navigate('open'),
        }),
      );
      return;
    }
    const list = el('div', { class: 'media-list' });
    for (const entry of items) {
      const percent = entry.duration ? (entry.position / entry.duration) * 100 : 0;
      list.append(
        mediaRow({
          title: entry.name,
          meta: `<span>${entry.completed ? 'Finished' : `Resume at ${formatTime(entry.position)}`}</span>
                 <span class="dot-sep">${entry.duration ? formatTime(entry.duration) : '—'}</span>
                 <span class="dot-sep">${entry.kind === 'file' ? formatBytes(entry.size) : 'Network'}</span>
                 <span class="dot-sep">${formatRelative(entry.updatedAt)}</span>`,
          poster: entry.poster,
          progress: entry.completed ? 100 : percent,
          onClick: () => openEntry(entry),
          actions: [
            { iconName: 'play', label: 'Play', onClick: () => openEntry(entry) },
            {
              iconName: 'trash',
              label: 'Remove',
              danger: true,
              onClick: () => void library.removeHistory(entry.id),
            },
          ],
        }),
      );
    }
    listHost.append(list);
  };

  render();
  const off = library.on('history', () => render());

  return {
    el: root,
    destroy: () => off(),
  };
}
