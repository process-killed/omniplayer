import type { PageContext, PageInstance } from './types';
import { el, esc, openModal, toast } from '../dom';
import { icon } from '../icons';
import { emptyState, mediaRow, pageHead } from '../components';
import { formatTime } from '../../utils/format';
import { library } from '../../storage/library';
import { buildPlaylist, parsePlaylist, playlistFileName } from '../../utils/m3u';

export function createPlaylistPage(ctx: PageContext): PageInstance {
  const { store, router, session } = ctx;
  const root = el('div', { class: 'page' });
  const queueHost = el('div');
  const playlistHost = el('div');

  // M3U import/export — the playlist format every IPTV/VLC user has.
  const importM3u = el('button', { class: 'btn btn--sm', type: 'button' });
  importM3u.innerHTML = `${icon('upload', 15)} Import .m3u`;
  importM3u.addEventListener('click', () => {
    const input = el('input', { type: 'file', class: 'hidden', accept: '.m3u,.m3u8,audio/x-mpegurl' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const entries = parsePlaylist(await file.text());
      if (entries.length === 0) {
        toast('That playlist is empty, or it is an HLS stream (play it as a link instead).', 'warn');
        return;
      }
      const specs = entries.map((entry) => session.specFromLink(entry.url, entry.title || undefined));
      store.setQueue(specs, 0);
      session.play(specs[0]);
      toast(`Imported ${specs.length} item${specs.length === 1 ? '' : 's'}`, 'ok');
    });
    document.body.append(input);
    input.click();
  });

  const exportM3u = el('button', { class: 'btn btn--sm', type: 'button' });
  exportM3u.innerHTML = `${icon('download', 15)} Export .m3u`;
  exportM3u.addEventListener('click', () => {
    const items = store.queue;
    if (items.length === 0) {
      toast('The queue is empty', 'warn');
      return;
    }
    const text = buildPlaylist(items.map((item) => ({ url: item.url ?? '', name: item.name })).filter((entry) => entry.url));
    const blob = new Blob([text], { type: 'audio/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: playlistFileName('omniplay-queue') });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Exported ${items.length} items`, 'ok');
  });

  const downloadAll = el('button', { class: 'btn btn--sm', type: 'button' });
  downloadAll.innerHTML = `${icon('download', 15)} Download all`;
  downloadAll.addEventListener('click', () => void queueDownloads(store.queue));

  const downloadSelected = el('button', { class: 'btn btn--sm', type: 'button' });
  downloadSelected.innerHTML = `${icon('download', 15)} Download selected`;

  const queueDownloads = async (items: Array<{ url?: string; name?: string }>) => {
    const { downloads } = await import('../../downloads/manager');
    const urls = items.map((item) => item.url).filter((url): url is string => !!url && /^https?:/i.test(url));
    if (urls.length === 0) {
      toast('Nothing here has a downloadable URL', 'warn');
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const [index, url] of urls.entries()) {
      const job = await downloads.enqueue(url, { name: items[index]?.name, kind: 'playlist' });
      if (job) added += 1;
      else skipped += 1;
    }
    toast(`${added} queued${skipped ? `, ${skipped} already there` : ''}`, added ? 'ok' : 'warn');
  };

  downloadSelected.addEventListener('click', () => {
    const checked = Array.from(root.querySelectorAll<HTMLInputElement>('.pl-select:checked'));
    const items = checked
      .map((box) => store.queue[Number(box.dataset.index ?? '-1')])
      .filter(Boolean);
    if (items.length === 0) {
      toast('Select some items first', 'warn');
      return;
    }
    void queueDownloads(items);
  });

  const addFiles = el('button', { class: 'btn btn--primary btn--sm', html: `${icon('plus', 15)} Add files` });
  addFiles.addEventListener('click', () => {
    const input = el('input', { type: 'file', multiple: true, class: 'hidden', accept: 'video/*,audio/*,.mkv,.avi,.mov,.ts,.flv' });
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (!files.length) return;
      const specs = files.map((file) => session.specFromFile(file));
      store.setQueue([...store.queue, ...specs], store.queueIndex < 0 ? 0 : store.queueIndex);
      toast(`${specs.length} item${specs.length > 1 ? 's' : ''} added to queue`, 'ok');
    });
    document.body.append(input);
    input.click();
  });

  const newPlaylist = el('button', { class: 'btn btn--sm', html: `${icon('list', 15)} New playlist` });
  newPlaylist.addEventListener('click', () => {
    const input = el('input', { class: 'input', placeholder: 'Playlist name', value: 'My playlist' });
    openModal({
      title: 'New playlist',
      description: 'Playlists are saved in this browser only.',
      body: input,
      confirmLabel: 'Create',
      onConfirm: () => {
        void library.createPlaylist(input.value).then(() => toast('Playlist created', 'ok'));
      },
    });
  });

  root.append(
    pageHead('Playlists', 'The play queue and your saved collections. Queue playback continues automatically when “auto next” is on.', [
      addFiles,
      importM3u,
      exportM3u,
      downloadAll,
      downloadSelected,
      newPlaylist,
    ]),
    queueHost,
    playlistHost,
  );

  const renderQueue = () => {
    queueHost.innerHTML = '';
    const title = el('div', { class: 'section-title' });
    title.innerHTML = `<h2>Current queue</h2><span class="muted">${store.queue.length} item${store.queue.length === 1 ? '' : 's'}</span>`;
    const clear = el('button', { class: 'btn btn--ghost btn--sm', text: 'Clear' });
    clear.addEventListener('click', () => {
      store.setQueue([], -1);
      toast('Queue cleared', 'ok');
    });
    title.append(el('div', { class: 'section-title__actions' }, [clear]));
    queueHost.append(title);

    if (store.queue.length === 0) {
      queueHost.append(
        emptyState({
          iconName: 'listVideo',
          title: 'Queue is empty',
          text: 'Open several files at once, or add them here.',
          actionLabel: 'Open media',
          onAction: () => router.navigate('open'),
        }),
      );
      return;
    }

    const list = el('div', { class: 'media-list' });
    store.queue.forEach((item, index) => {
      const active = index === store.queueIndex;
      const row = mediaRow({
        title: item.name,
        meta: `<span>${item.kind === 'file' ? 'Local file' : 'Stream'}</span><span class="dot-sep">#${index + 1}</span>`,
        progress: undefined,
        badge: active ? 'Now playing' : undefined,
        onClick: () => {
          store.setQueueIndex(index);
          session.play(item);
        },
        actions: [
          { iconName: 'play', label: 'Play', onClick: () => { store.setQueueIndex(index); session.play(item); } },
          {
            iconName: 'trash',
            label: 'Remove from queue',
            danger: true,
            onClick: () => {
              const next = store.queue.filter((_, i) => i !== index);
              store.setQueue(next, Math.min(store.queueIndex, next.length - 1));
            },
          },
        ],
      });
      // A checkbox drives "Download selected".
      if (item.url) {
        const wrap = el('div', { class: 'pl-row' });
        const box = el('input', { class: 'pl-select', type: 'checkbox', 'data-index': String(index) });
        box.setAttribute('aria-label', `Select ${item.name}`);
        wrap.append(box, row);
        list.append(wrap);
      } else {
        list.append(row);
      }
    });
    queueHost.append(list);
  };

  const renderPlaylists = () => {
    playlistHost.innerHTML = '';
    const title = el('div', { class: 'section-title' });
    title.innerHTML = `<h2>Saved playlists</h2><span class="muted">${library.playlists.length}</span>`;
    playlistHost.append(title);

    if (library.playlists.length === 0) {
      playlistHost.append(
        emptyState({
          iconName: 'bookmark',
          title: 'No saved playlists',
          text: 'Create one and add the video you are watching from the player’s “more” menu.',
        }),
      );
      return;
    }

    for (const playlist of library.playlists) {
      const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
      const head = el('div', { class: 'row', style: { marginBottom: '10px' } });
      head.innerHTML = `<div style="flex:1;min-width:0"><div class="card__title">${esc(playlist.name)}</div>
        <div class="card__desc">${playlist.items.length} item${playlist.items.length === 1 ? '' : 's'} · updated ${new Date(playlist.updatedAt).toLocaleDateString()}</div></div>`;
      const actions = el('div', { class: 'row' });
      const addCurrent = el('button', { class: 'btn btn--sm', html: `${icon('plus', 14)} Add current` });
      addCurrent.addEventListener('click', () => {
        const media = store.current;
        if (!media) {
          toast('Nothing is open in the player yet.', 'warn');
          return;
        }
        void library.addToPlaylist(playlist.id, { name: media.name, kind: media.kind, url: media.url, duration: 0 });
        toast('Added to playlist', 'ok');
      });
      const removePlaylist = el('button', { class: 'icon-btn', 'aria-label': 'Delete playlist', html: icon('trash', 16) });
      removePlaylist.style.color = 'var(--err)';
      removePlaylist.addEventListener('click', () => {
        openModal({
          title: `Delete “${playlist.name}”?`,
          description: 'The playlist is removed from this browser. The videos themselves are untouched.',
          confirmLabel: 'Delete',
          danger: true,
          onConfirm: () => void library.deletePlaylist(playlist.id),
        });
      });
      actions.append(addCurrent, removePlaylist);
      head.append(actions);
      card.append(head);

      if (playlist.items.length === 0) {
        card.append(el('div', { class: 'p-note', text: 'No items yet.' }));
      } else {
        const list = el('div', { class: 'media-list' });
        for (const item of playlist.items) {
          list.append(
            mediaRow({
              title: item.name,
              meta: `<span>${item.kind === 'file' ? 'Local file' : 'Stream'}</span>${item.duration ? `<span class="dot-sep">${formatTime(item.duration)}</span>` : ''}`,
              onClick: () => {
                if (item.kind === 'url' && item.url) {
                  session.play(session.specFromUrl(item.url, item.name));
                } else {
                  toast('Local playlist items need the file picked again — use Open media.', 'warn');
                  router.navigate('open');
                }
              },
              actions: [
                {
                  iconName: 'trash',
                  label: 'Remove item',
                  danger: true,
                  onClick: () => void library.removeFromPlaylist(playlist.id, item.id),
                },
              ],
            }),
          );
        }
        card.append(list);
      }
      playlistHost.append(card);
    }
  };

  renderQueue();
  renderPlaylists();

  const offQueue = store.on('queue', () => renderQueue());
  const offPlaylists = library.on('playlists', () => renderPlaylists());

  return {
    el: root,
    destroy: () => {
      offQueue();
      offPlaylists();
    },
  };
}
