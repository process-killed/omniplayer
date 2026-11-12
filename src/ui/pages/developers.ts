import type { PageContext, PageInstance } from './types';
import { el, esc, toast, copyText } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { PROTOCOL_VERSION, mount, type MountedPlayer } from '../../app/embedApi';

/**
 * Everything a site owner or app developer needs: the iframe parameters, the
 * postMessage protocol and a live playground that mounts the real player.
 */
export function createDevelopersPage(_ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });
  let controller: MountedPlayer | null = null;

  const origin = `${window.location.origin}${window.location.pathname}`;
  const sampleSrc = 'https://example.com/video.mp4';

  const iframeCode = `<iframe
  src="${origin}#/embed?src=${encodeURIComponent(sampleSrc)}&autoplay=1&muted=1&title=My%20video"
  style="border:0;display:block;aspect-ratio:16/9;max-width:100%"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
  allowfullscreen
  referrerpolicy="no-referrer"></iframe>`;

  const jsCode = `<script src="${origin.replace(/\/$/, '')}/omniplay-embed.js"></script>
<div id="player"></div>
<script>
  const player = OmniPlay.mount('#player', {
    src: 'https://example.com/video.mp4',
    autoplay: true,
    muted: true,
    start: 30,
    title: 'Episode 1',
  });

  player.on((event) => {
    if (event.type === 'timeupdate') console.log(event.currentTime);
    if (event.type === 'ended') player.load('https://example.com/next.mp4');
  });
</script>`;

  const componentCode = `<script type="module" src="${origin.replace(/\/$/, '')}/assets/main.js"></script>
<omni-play src="https://example.com/video.mp4" title="Episode 1" muted></omni-play>
<script>
  const el = document.querySelector('omni-play');
  el.on((event) => console.log(event.type));
  el.seek(90);
</script>`;

  const postCode = `// Host page → player
player.post({ omniplay: 'seek', value: 120 });
player.post({ omniplay: 'setRate' in window ? 'rate' : 'rate', value: 1.5 });

// Player → host
window.addEventListener('message', (event) => {
  if (!event.data?.omniplay) return;
  console.log(event.data.type, event.data); // ready | timeupdate | state | ended | error | tracks
});`;

  const params: Array<[string, string, string]> = [
    ['src', 'Any link: a file, HLS/DASH manifest, magnet, IPFS path, Google Drive, or YouTube/Vimeo (played by their own embed).', 'required'],
    ['start', 'Seconds to start at.', '0'],
    ['autoplay', '1 to start automatically. Browsers require muted for this.', '0'],
    ['muted', '1 to start muted — makes autoplay reliable.', '0'],
    ['loop', '1 to restart at the end.', '0'],
    ['controls', '0 for a bare click-to-play surface.', '1'],
    ['title', 'Caption shown in the player bar.', '—'],
    ['poster', 'Image shown before playback.', '—'],
    ['sub', 'Subtitle file (.vtt, .srt, .ass) to load.', '—'],
    ['accent', 'Brand colour as a hex value, e.g. %23ff6600.', 'theme'],
    ['end', 'Stop playback at this many seconds.', '—'],
    ['next', 'Media loaded when the current one ends.', '—'],
    ['sources', 'Comma-separated mirror URLs, tried in order if the primary fails.', '—'],
    ['aspect', 'Force an aspect ratio, e.g. 16:9 or 21:9.', 'original'],
    ['theme', 'dark or light.', 'dark'],
    ['audio', 'Preferred audio language, e.g. hi or en.', '—'],
    ['subtitle', 'Preferred subtitle language.', '—'],
    ['quality', 'Preferred quality id, or auto.', 'auto'],
    ['pip', '0 hides picture-in-picture.', '1'],
    ['keyboard', '0 disables keyboard shortcuts.', '1'],
    ['origins', 'Comma-separated parent origins allowed to send commands.', 'any'],
  ];

  const copyButton = (label: string, text: () => string) => {
    const node = el('button', { class: 'btn btn--sm', type: 'button' });
    node.innerHTML = `${icon('copy', 15)} ${esc(label)}`;
    node.addEventListener('click', async () => {
      const ok = await copyText(text());
      toast(ok ? 'Copied' : 'Clipboard blocked', ok ? 'ok' : 'warn');
    });
    return node;
  };

  const playground = el('div', { class: 'dev-playground' });
  const status = el('div', { class: 'dev-status', text: 'Playground idle — press “Mount player”.' });

  const mountButton = el('button', { class: 'btn btn--primary btn--sm', type: 'button' });
  mountButton.innerHTML = `${icon('play', 15)} Mount player`;
  mountButton.addEventListener('click', () => {
    controller?.destroy();
    playground.innerHTML = '';
    controller = mount(playground, {
      src: sampleSrc,
      title: 'Playground',
      muted: true,
      autoplay: false,
    });
    controller.on((event) => {
      status.textContent = `${event.type}${event.currentTime !== undefined ? ` · ${Number(event.currentTime).toFixed(1)}s` : ''}`;
    });
    status.textContent = 'Mounted — the events below come from the iframe.';
  });

  const actionRow = el('div', { class: 'row' });
  for (const [label, action] of [
    ['Play', () => controller?.play()],
    ['Pause', () => controller?.pause()],
    ['Seek +30s', () => controller?.seek(30)],
    ['Mute', () => controller?.setMuted(true)],
    ['Unmute', () => controller?.setMuted(false)],
    ['1.5×', () => controller?.setRate(1.5)],
    ['State', () => controller?.getState()],
  ] as Array<[string, () => void]>) {
    const node = el('button', { class: 'btn btn--sm', type: 'button', text: label });
    node.addEventListener('click', action);
    actionRow.append(node);
  }

  const card = (title: string, description: string, children: Node[]) => {
    const node = el('div', { class: 'card' });
    const head = el('div');
    head.innerHTML = `<div class="card__title">${esc(title)}</div><div class="card__desc">${esc(description)}</div>`;
    node.append(head, ...children);
    return node;
  };

  root.append(
    pageHead(
      'For developers',
      `Drop the player on any site: an iframe with query parameters, a one-line JS mount, or the postMessage protocol (v${PROTOCOL_VERSION}).`,
    ),
    notice(
      'The iframe works anywhere. Files from another origin need CORS for MKV/AVI; MP4/WebM play without it. Add a proxy in Settings → Network for buckets you do not control.',
      'info',
    ),
    card('1 · Iframe', 'No JavaScript required. Every option is a query parameter.', [
      el('pre', { class: 'dev-code', text: iframeCode }),
      el('div', { class: 'row' }, [copyButton('Copy iframe', () => iframeCode)]),
      el('div', { class: 'dev-table' }, [
        el('div', { class: 'dev-table__row dev-table__row--head' }, [
          el('span', { text: 'Parameter' }),
          el('span', { text: 'Meaning' }),
          el('span', { text: 'Default' }),
        ]),
        ...params.map(([name, meaning, fallback]) =>
          el('div', { class: 'dev-table__row' }, [
            el('code', { text: name }),
            el('span', { text: meaning }),
            el('span', { class: 'dev-muted', text: fallback }),
          ]),
        ),
      ]),
    ]),
    card('2 · JavaScript mount', 'Creates the iframe and gives you a controller with methods and events.', [
      el('pre', { class: 'dev-code', text: jsCode }),
      el('div', { class: 'row' }, [copyButton('Copy snippet', () => jsCode)]),
    ]),
    card('3 · Web component', '<omni-play> works in plain HTML, React, Vue and Svelte.', [
      el('pre', { class: 'dev-code', text: componentCode }),
      el('div', { class: 'row' }, [copyButton('Copy component', () => componentCode)]),
    ]),
    card('4 · postMessage protocol', 'For pages that already have a player element or want full control.', [
      el('pre', { class: 'dev-code', text: postCode }),
      el('div', { class: 'row' }, [copyButton('Copy protocol', () => postCode)]),
      el('div', { class: 'dev-methods' }, [
        el('span', { text: 'play · pause · toggle · seek · volume · muted · rate · load · subtitle · quality · audio · danmaku · fullscreen · getState' }),
      ]),
    ]),
    card('Playground', 'Mounts the real player in this page and shows every event it emits.', [
      el('div', { class: 'row' }, [mountButton]),
      actionRow,
      playground,
      status,
    ]),
  );

  return {
    el: root,
    destroy: () => controller?.destroy(),
  };
}
