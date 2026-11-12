import type { PageContext, PageInstance } from './types';
import { el, esc, toast } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { formatTime } from '../../utils/format';
import { parseMagnet, isMagnet, formatBytes } from '../../torrent/magnet';
import { TorrentSession, gatewayUrl, type TorrentFile, type TorrentStats } from '../../torrent/engine';
import { webtorWebUrl } from '../../torrent/webtor';

/**
 * Torrents: paste a magnet link, pick a file, watch it.
 *
 * Two engines behind one screen — WebTorrent in the page (WebRTC peers or a web
 * seed) and an optional HTTP gateway, which is the only route that reliably
 * plays classic swarms.
 */
export function createTorrentsPage(ctx: PageContext): PageInstance {
  const { store, session, router } = ctx;
  const root = el('div', { class: 'page' });

  const torrentSession = new TorrentSession();
  let files: TorrentFile[] = [];

  const input = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'magnet:?xt=urn:btih:…',
    spellcheck: 'false',
  });
  if (router.current.params.magnet) input.value = decodeURIComponent(router.current.params.magnet);

  const addButton = el('button', { class: 'btn btn--primary', type: 'button' });
  addButton.innerHTML = `${icon('cloud', 16)} Load magnet`;
  const pasteButton = el('button', { class: 'btn', type: 'button' });
  pasteButton.innerHTML = `${icon('copy', 16)} Paste`;

  const statusHost = el('div');
  const filesHost = el('div', { class: 'torrent-files' });
  const gatewayNote = el('div');

  const gatewayConfigured = () => store.settings.torrentGateway.trim().length > 0;
  const provider = () => store.settings.torrentProvider;

  const playWithWebtor = (magnet: string) => {
    // The player recognises a magnet URL and hands it to the webtor.io SDK.
    const spec = session.specFromUrl(magnet, 'Torrent');
    session.play(spec);
  };

  const renderGatewayNote = () => {
    gatewayNote.innerHTML = '';
    const lowMemory = document.documentElement.dataset.profile === 'low';
    if (!gatewayConfigured() && lowMemory) {
      statusHost.append(
        notice(
          'This device reports low memory, and WebTorrent holds the whole file in RAM. A torrent gateway plays it without that cost — set one in Settings → Torrents.',
          'warn',
        ),
      );
    }

    if (gatewayConfigured()) {
      gatewayNote.append(
        notice(
          `Gateway set: ${store.settings.torrentGateway}. Magnets open instantly through it; WebTorrent is used only if the gateway fails.`,
          'ok',
        ),
      );
      return;
    }
    gatewayNote.append(
      notice(
        'Magnets play through webtor.io by default: their servers fetch the torrent and stream it over HTTPS, so any swarm works. The torrent is downloaded by them, not by you — add your own gateway in Settings → Torrents if you would rather keep that traffic yours.',
        'info',
      ),
    );
  };

  const setStatus = (html: string) => {
    statusHost.innerHTML = html;
  };

  const progressCard = () => {
    const card = el('div', { class: 'torrent-progress' });
    card.innerHTML = `
      <div class="torrent-progress__bar"><span style="width:0%"></span></div>
      <div class="torrent-progress__meta"><span class="peers">0 peers</span><span class="pct">0%</span><span class="speed">—</span><span class="eta"></span></div>`;
    return card;
  };

  const playFile = async (file: TorrentFile) => {
    setStatus('');
    const card = progressCard();
    statusHost.append(card);
    const bar = card.querySelector<HTMLElement>('.torrent-progress__bar span')!;
    const meta = card.querySelector<HTMLElement>('.torrent-progress__meta')!;

    try {
      const url = await torrentSession.download(file.index, (stats: TorrentStats) => {
        bar.style.width = `${Math.round(stats.progress * 100)}%`;
        meta.innerHTML = `<span>${stats.peers} peers</span><span>${Math.round(stats.progress * 100)}%</span><span>${formatBytes(stats.downloadSpeed)}/s</span><span>${
          stats.timeRemaining > 0 && stats.timeRemaining < 86_400_000 ? `${formatTime(stats.timeRemaining / 1000)} left` : ''
        }</span>`;
      });
      toast('Torrent file ready — starting playback', 'ok');
      const spec = session.specFromUrl(url, file.name);
      session.play(spec);
    } catch (error) {
      setStatus('');
      statusHost.append(notice((error as Error).message, 'err'));
    }
  };

  const renderFiles = () => {
    filesHost.innerHTML = '';
    if (files.length === 0) return;
    const list = el('div', { class: 'media-list' });
    for (const file of files) {
      const row = el('div', { class: `media-row${file.playable ? '' : ' is-muted'}`, role: 'button', tabindex: '0' });
      row.innerHTML = `
        <div class="media-row__thumb">${icon(file.playable ? 'play' : 'file', 18)}</div>
        <div class="media-row__body">
          <div class="media-row__title">${esc(file.name)}</div>
          <div class="media-row__meta"><span>${formatBytes(file.length)}</span>${file.playable ? '<span class="chip chip--ok">playable</span>' : '<span class="chip">not media</span>'}</div>
        </div>`;
      if (file.playable) {
        row.addEventListener('click', () => void playFile(file));
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') void playFile(file);
        });
      }
      list.append(row);
    }
    filesHost.append(list);
  };

  const load = async () => {
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    if (!isMagnet(value)) {
      setStatus('');
      statusHost.append(notice('That is not a magnet link. It should start with magnet:?xt=urn:btih:…', 'err'));
      return;
    }
    const info = parseMagnet(value);
    if (!info) {
      setStatus('');
      statusHost.append(notice('The magnet link has no usable info hash.', 'err'));
      return;
    }
    addButton.disabled = true;
    setStatus(`<div class="p-note">Looking for peers for ${esc(info.name)}…</div>`);

    // webtor.io is the default third-party route when no gateway of your own exists.
    if (provider() === 'webtor' || (provider() === 'auto' && !gatewayConfigured())) {
      playWithWebtor(value);
      return;
    }

    // Gateway first when configured: it is the reliable route.
    const gateway = gatewayUrl(value, store.settings.torrentGateway);
    if (gateway) {
      try {
        const spec = session.specFromUrl(gateway, `${info.name} (gateway)`);
        session.play(spec);
        return;
      } catch {
        /* fall through to WebTorrent */
      }
    }

    try {
      files = await torrentSession.add(value);
      setStatus('');
      const playable = files.filter((file) => file.playable);
      if (playable.length === 0) {
        statusHost.append(notice('This torrent has no playable media files.', 'warn'));
      }
      renderFiles();
    } catch (error) {
      setStatus('');
      statusHost.append(
        notice((error as Error).message, 'err'),
        el('div', { class: 'row', style: { marginTop: '10px' } }, [
          button('Open torrent settings', 'settings', () => router.navigate('settings', { section: 'torrents' })),
        ]),
      );
    } finally {
      addButton.disabled = false;
    }
  };

  addButton.addEventListener('click', () => void load());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void load();
  });
  pasteButton.addEventListener('click', async () => {
    try {
      input.value = await navigator.clipboard.readText();
      void load();
    } catch {
      toast('Clipboard blocked — paste manually', 'warn');
    }
  });

  torrentSession.onStats((stats) => {
    if (stats.state === 'metadata') setStatus(`<div class="p-note">${esc(stats.message ?? 'Connecting…')}</div>`);
  });

  renderGatewayNote();

  const providerSelect = el('select', { class: 'select' }) as HTMLSelectElement;
  for (const [value, label] of [
    ['auto', 'Auto — my gateway, else webtor.io'],
    ['webtor', 'webtor.io (third party)'],
    ['gateway', 'My gateway only'],
    ['webtorrent', 'In-page WebTorrent only'],
  ] as Array<[string, string]>) {
    const option = el('option', { value, text: label });
    if (store.settings.torrentProvider === value) option.selected = true;
    providerSelect.append(option);
  }
  providerSelect.addEventListener('change', () => {
    store.updateSettings({ torrentProvider: providerSelect.value as never });
    renderGatewayNote();
    toast('Torrent provider updated', 'ok');
  });

  root.append(
    pageHead('Torrents', 'Play a magnet link — files stream through WebTorrent, or instantly through a gateway you configure.'),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [input, addButton, pasteButton]),
      el('div', { class: 'row', style: { marginTop: '10px' } }, [
        el('span', { class: 'p-note', text: 'Provider' }),
        providerSelect,
      ]),
      gatewayNote,
      statusHost,
      el('div', { class: 'row', style: { marginTop: '10px' } }, [
        button('Open on webtor.io', 'externalLink', () => {
          const value = input.value.trim();
          if (!value) {
            toast('Paste a magnet link first', 'warn');
            return;
          }
          window.open(webtorWebUrl(value), '_blank', 'noopener');
        }),
      ]),
    ]),
    filesHost,
    el('div', { class: 'card' }, [
      el('div', { class: 'card__title', html: `${icon('help', 16)} How this works` }),
      el('div', { class: 'card__desc', text: 'Browsers speak WebRTC, not TCP, so a direct magnet only works when the swarm has WebRTC peers or a web seed. A gateway does the fetching for you and serves the file over HTTP with range support — that is what makes any magnet play.' }),
    ]),
  );

  return {
    el: root,
    destroy: () => torrentSession.destroy(),
    onShow: () => input.focus(),
  };
}

function button(label: string, iconName: string, onClick: () => void): HTMLElement {
  const node = el('button', { class: 'btn btn--sm', type: 'button' });
  node.innerHTML = `${icon(iconName, 15)} ${esc(label)}`;
  node.addEventListener('click', onClick);
  return node;
}
