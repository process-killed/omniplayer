import type { PageContext, PageInstance } from './types';
import { el, esc, copyText, toast } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { PROTOCOL_VERSION, mount, type MountedPlayer } from '../../app/embedApi';

/**
 * Developer documentation.
 *
 * Everything on this page is executable: the snippets are real, the preview is
 * the real player, and the example stream is a public HLS manifest that sends
 * the CORS headers the player needs. If a snippet does not work when copied,
 * that is a bug in this page, not in the reader's code.
 */

const EXAMPLE = 'https://content.jwplatform.com/manifests/vM7nH0Kl.m3u8';
const EXAMPLE_ENCODED = encodeURIComponent(EXAMPLE);

export function createDevelopersPage(_ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });
  const origin = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '');

  const embedUrl = `${origin}/#/embed?src=${EXAMPLE_ENCODED}&poster=&title=Demo%20stream`;
  const simpleUrl = `${origin}/?src=${EXAMPLE_ENCODED}`;

  /* ------------------------------------------------------------- copy blocks */

  const codeBlock = (label: string, code: string, hint?: string): HTMLElement => {
    const wrap = el('div', { class: 'dev-block' });
    const head = el('div', { class: 'dev-block__head' });
    head.innerHTML = `<span>${esc(label)}</span>`;
    const copy = el('button', { class: 'dev-copy', type: 'button' });
    copy.innerHTML = `${icon('copy', 13)} Copy`;
    copy.addEventListener('click', async () => {
      const ok = await copyText(code);
      copy.innerHTML = ok ? `${icon('check', 13)} Copied` : `${icon('x', 13)} Blocked`;
      toast(ok ? `${label} copied` : 'Clipboard blocked', ok ? 'ok' : 'warn');
      setTimeout(() => {
        copy.innerHTML = `${icon('copy', 13)} Copy`;
      }, 1600);
    });
    head.append(copy);

    const pre = el('pre', { class: 'dev-code' });
    pre.textContent = code;
    wrap.append(head, pre);
    if (hint) {
      const note = el('p', { class: 'dev-hint' });
      note.textContent = hint;
      wrap.append(note);
    }
    return wrap;
  };

  /* ---------------------------------------------------------------- snippets */

  const iframeSnippet = `<div style="position:relative;width:100%;aspect-ratio:16/9">
  <iframe
    src="${embedUrl}"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    title="OmniPlay"
    loading="lazy"
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
    allowfullscreen
    referrerpolicy="no-referrer"
  ></iframe>
</div>`;

  const componentSnippet = `<script type="module" src="${origin}/assets/main.js"></script>

<omni-play
  src="${EXAMPLE}"
  title="Demo stream"
  muted
></omni-play>`;

  const mountSnippet = `<script type="module" src="${origin}/assets/main.js"></script>
<div id="player"></div>

<script type="module">
  const player = OmniPlay.mount('#player', {
    src: '${EXAMPLE}',
    title: 'Demo stream',
    autoplay: true,
    muted: true,          // required for autoplay in every browser
    start: 0,
  });

  player.on('timeupdate', ({ currentTime, duration }) => {
    console.log(currentTime.toFixed(1), '/', duration.toFixed(1));
  });
  player.on('ended', () => console.log('finished'));
  player.on('error', (payload) => console.warn('player error', payload));
  player.on('closed', () => console.log('viewer dismissed the player'));
</script>`;

  const hostBridgeSnippet = `<!-- Host page: drive the player without importing any library -->
<button id="toggle">Play / pause</button>
<input id="seek" type="range" min="0" max="100" value="0" />
<span id="time">0:00</span>

<iframe id="p" src="${embedUrl}"
        style="width:100%;aspect-ratio:16/9;border:0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen></iframe>

<script>
  const frame = document.getElementById('p');

  // Host → player
  const send = (type, value) =>
    frame.contentWindow.postMessage({ omniplay: type, value }, '*');

  document.getElementById('toggle').onclick = () => send('toggle');
  document.getElementById('seek').oninput = (event) =>
    send('seek', Number(event.target.value));

  // Player → host
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.omniplay) return;

    if (data.omniplay === 'timeupdate') {
      document.getElementById('time').textContent = data.currentTime.toFixed(0) + 's';
      const pct = data.duration ? (data.currentTime / data.duration) * 100 : 0;
      document.getElementById('seek').value = String(pct);
    }
    if (data.omniplay === 'error') {
      // Show your own message instead of a bare player frame.
      console.warn('playback failed:', data.code, data.message);
    }
    if (data.omniplay === 'closed') {
      // The viewer dismissed the player — replace it with your own UI.
      frame.replaceWith(Object.assign(document.createElement('p'), {
        textContent: 'Try another episode',
      }));
    }
  });
</script>`;

  /* ------------------------------------------------------------- playground */

  const playground = el('div', { class: 'dev-playground' });
  let controller: MountedPlayer | null = null;
  const status = el('div', { class: 'dev-status', text: 'Mounting…' });

  const playExample = () => {
    controller?.destroy();
    playground.innerHTML = '';
    try {
      controller = mount(playground, {
        src: EXAMPLE,
        title: 'JW Player demo stream',
        muted: true,
        autoplay: true,
      });
      status.textContent = 'Mounted. Events appear below as they fire.';
      // One subscription covers every event; `type` tells them apart.
      controller?.on((event) => {
        if (event.type === 'timeupdate') return; // too chatty for the log
        if (event.type === 'error') {
          showPreviewFallback(event as { code?: string; message?: string });
          return;
        }
        status.textContent = `${event.type} → ${JSON.stringify(event).slice(0, 90)}`;
      });
    } catch (error) {
      status.textContent = `Mount failed: ${(error as Error).message}`;
    }
  };

  /**
   * If the demo stream cannot be reached from the reader's network, say so
   * calmly and keep the page useful — a full error card here would read as
   * "the docs are broken".
   */
  const showPreviewFallback = (event: { code?: string; message?: string }) => {
    controller?.destroy();
    controller = null;
    status.textContent = `${event.code ?? 'error'} — the demo stream could not be loaded from this network.`;
    playground.innerHTML = `
      <div class="dev-fallback">
        <b>The demo stream did not load here</b>
        <p>${event.code === 'cors-required'
          ? 'The player could not read this manifest from your network. The snippets on this page are still correct — swap in your own URL to test.'
          : 'Network blocked or the stream is offline. The snippets on this page are still correct — swap in your own URL to test.'}</p>
        <button class="btn btn--sm" id="dev-retry">Try again</button>
      </div>`;
    playground.querySelector('#dev-retry')?.addEventListener('click', () => playExample());
  };

  const replay = el('button', { class: 'btn btn--sm', type: 'button' });
  replay.innerHTML = `${icon('refresh', 14)} Reload preview`;
  replay.addEventListener('click', playExample);

  /* -------------------------------------------------------------- reference */

  const params: Array<[string, string, string, string]> = [
    ['src', 'required', 'Media URL — a file, an HLS playlist (.m3u8), a DASH manifest (.mpd), or a magnet link.', 'src=https://host/video.mp4'],
    ['start / t', '0', 'Start position in seconds. `t` is an alias, so share links from other players work.', 'start=90'],
    ['end', '—', 'Stop playback at this second. Useful for clip embeds.', 'end=180'],
    ['autoplay', '0', 'Start playing immediately. Browsers only allow this when muted.', 'autoplay=1&muted=1'],
    ['muted', '0', 'Start muted. Required for reliable autoplay.', 'muted=1'],
    ['loop', '0', 'Repeat the current source.', 'loop=1'],
    ['controls', '1', 'Set to 0 to hide every control; gestures and keyboard still work.', 'controls=0'],
    ['chromeless', '0', 'Hides all bars and the centre button — for hero banners.', 'chromeless=1'],
    ['branding', '1', 'Set to 0 to hide the engine badge and title bar (white-label).', 'branding=0'],
    ['title', '—', 'Caption shown in the player header.', 'title=Episode%201'],
    ['poster', '—', 'Image shown before playback starts.', 'poster=https://host/p.jpg'],
    ['sub', '—', 'External subtitle file (SRT, VTT, ASS).', 'sub=https://host/ep.srt'],
    ['playlist', '—', 'Comma-separated URLs played in order after the current one ends.', 'playlist=url1,url2'],
    ['sources', '—', 'Comma-separated mirrors; tried in order if the primary fails.', 'sources=a.mp4,b.mp4'],
    ['remember', '0', 'Remember the viewer’s position per source in this browser and resume it.', 'remember=1'],
    ['aspect', '—', 'Force a display ratio (16:9, 21:9, 4:3).', 'aspect=21:9'],
    ['accent', '—', 'Brand colour as a hex value, URL-encoded.', 'accent=%23ff6600'],
    ['audio', '—', 'Preferred audio language code, e.g. `hi` or `en`.', 'audio=hi'],
    ['subtitle', '—', 'Preferred subtitle language code.', 'subtitle=en'],
    ['quality', 'auto', 'Preferred quality level id, or `auto`.', 'quality=720'],
    ['pip', '1', 'Set to 0 to hide Picture-in-Picture (canvas playback cannot support it).', 'pip=0'],
    ['keyboard', '1', 'Set to 0 to disable keyboard shortcuts in the embed.', 'keyboard=0'],
    ['download', '1', 'Set to 0 to hide the download entry.', 'download=0'],
    ['origins', '—', 'Comma-separated parent origins allowed to send commands. Strongly recommended.', 'origins=https://yoursite.com'],
  ];

  const paramTable = el('div', { class: 'dev-table' });
  paramTable.innerHTML = `
    <div class="dev-table__row dev-table__row--head">
      <span>Parameter</span><span>Default</span><span>What it does</span><span>Example</span>
    </div>
    ${params
      .map(
        ([name, def, description, example]) => `
      <div class="dev-table__row">
        <code>${esc(name)}</code>
        <span class="muted">${esc(def)}</span>
        <span>${esc(description)}</span>
        <code class="muted">${esc(example)}</code>
      </div>`,
      )
      .join('')}`;

  const commands: Array<[string, string, string]> = [
    ['play', '—', 'Start playback'],
    ['pause', '—', 'Pause'],
    ['toggle', '—', 'Play or pause'],
    ['seek', 'seconds', 'Jump to a position'],
    ['volume', '0–1', 'Set volume'],
    ['muted', 'true / false', 'Mute or unmute'],
    ['rate', '0.25–4', 'Playback speed'],
    ['load', 'url', 'Load a different source'],
    ['subtitle', 'url', 'Load an external subtitle'],
    ['quality', 'level id | "auto"', 'Pick a quality level'],
    ['audio', 'track id | index', 'Pick an audio track'],
    ['danmaku', 'true / false', 'Toggle bullet comments'],
    ['fullscreen', '—', 'Enter or leave fullscreen'],
    ['getState', '—', 'Ask for a state-reply'],
  ];

  const events: Array<[string, string]> = [
    ['ready', 'Player mounted and the source resolved'],
    ['state', 'playing / paused / buffering changed'],
    ['timeupdate', 'Progress, throttled to ~4 Hz'],
    ['ended', 'Playback reached the end'],
    ['error', 'Playback failed — includes code and message'],
    ['tracks', 'Audio, subtitle and quality lists'],
    ['state-reply', 'Answer to getState'],
    ['closed', 'The viewer dismissed the player; replace it with your own UI'],
  ];

  /* ------------------------------------------------------------------ layout */

  root.append(
    pageHead(
      'For developers',
      'Put OmniPlay on any site. No build step, no SDK to install — an iframe, a query string and a tiny message protocol.',
      [replay],
    ),

    notice(
      'Every example below uses this public HLS stream and it genuinely plays here: ' +
        `${EXAMPLE}. It sends the CORS headers the player needs, which is why it works.`,
      'info',
    ),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, [el('span', { text: '1 · Live preview' })]),
      playground,
      status,
      el('p', { class: 'dev-hint' }, [
        el('span', {
          text: 'This is the real player, mounted with OmniPlay.mount(). Progress events are suppressed in the log; everything else is shown as it fires.',
        }),
      ]),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, [el('span', { text: '2 · The 30-second version' })]),
      el('p', {
        class: 'muted',
        text: 'Append your media URL to the player address and it plays. Nothing else required.',
      }),
      codeBlock(
        'Simplest possible embed',
        simpleUrl,
        'Open this in a tab first — if the source plays there, it will play in your iframe too.',
      ),
      el('p', { class: 'muted', text: 'Prefer an explicit embed route with options? Same thing, more control:' }),
      codeBlock('Full embed URL', embedUrl),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, [el('span', { text: '3 · Pick your integration' })]),
      codeBlock(
        'HTML — iframe (works everywhere)',
        iframeSnippet,
        'The wrapper keeps a 16:9 box so the page does not jump when the player loads. `allowfullscreen` and the `allow` list are what enable fullscreen and PiP.',
      ),
      codeBlock(
        'Web component — no JavaScript on your page',
        componentSnippet,
        'Attributes map 1:1 to the query parameters. Methods and events are available on the element if you need them later.',
      ),
      codeBlock(
        'JavaScript — OmniPlay.mount()',
        mountSnippet,
        'mount() returns a controller: play(), pause(), seek(), setVolume(), setMuted(), setRate(), load(), setSubtitle(), setQuality(), setAudioTrack(), setDanmaku(), requestFullscreen(), getState(), on(), destroy().',
      ),
      codeBlock(
        'Host page — drive it with postMessage only',
        hostBridgeSnippet,
        'No import, no bundle: the iframe talks to your page over postMessage. This is the pattern to use when your site is built on a framework you would rather not touch.',
      ),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, [el('span', { text: '4 · Every parameter' })]),
      el('p', {
        class: 'muted',
        text: 'All values are URL-encoded. Booleans accept 1/0 or true/false. Anything unknown is ignored, never fatal.',
      }),
      paramTable,
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, [el('span', { text: `5 · postMessage protocol (v${PROTOCOL_VERSION})` })]),
      el('p', {
        class: 'muted',
        text: 'Host → player: frame.contentWindow.postMessage({ omniplay: "<command>", value? }, "*"). Player → host: window.addEventListener("message", …), where event.data.omniplay is the event name.',
      }),
      el('h3', { class: 'dev-h3', text: 'Commands' }),
      el('div', { class: 'dev-table dev-table--two' , innerHTML: `
        <div class="dev-table__row dev-table__row--head"><span>Command</span><span>Value</span><span>Effect</span></div>
        ${commands.map(([name, value, description]) => `
          <div class="dev-table__row">
            <code>${esc(name)}</code>
            <span class="muted">${esc(value)}</span>
            <span>${esc(description)}</span>
          </div>`).join('')}` }),

      el('h3', { class: 'dev-h3', text: 'Events' }),
      el('div', { class: 'dev-table dev-table--two', innerHTML: `
        <div class="dev-table__row dev-table__row--head"><span>Event</span><span>When</span></div>
        ${events.map(([name, description]) => `
          <div class="dev-table__row">
            <code>${esc(name)}</code>
            <span>${esc(description)}</span>
          </div>`).join('')}` }),
      notice(
        'Lock it down with origins= in the embed URL. Without it, any page that frames the player can send it commands.',
        'warn',
      ),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, [el('span', { text: '6 · Things that will bite you' })]),
      el('ul', { class: 'dev-list', innerHTML: `
        <li><b>CORS.</b> If the host sends no <code>Access-Control-Allow-Origin</code>, the player cannot read the bytes — MKV, multi-audio and subtitle extraction all fail, and no client-side trick fixes it. The HLS example above works because jwplatform allows cross-origin reads.</li>
        <li><b>Autoplay.</b> Every browser blocks unmuted autoplay. Use <code>autoplay=1&amp;muted=1</code> and let the viewer unmute.</li>
        <li><b>Fullscreen on iOS.</b> iPhone Safari fullscreens the video element only, and cannot rotate the screen — the player asks the viewer to turn the device instead of faking a rotation.</li>
        <li><b>Manifests are not files.</b> An <code>.m3u8</code> or <code>.mpd</code> is a stream: “download this video” is not meaningful for it, and the player says so rather than saving a text file.</li>
        <li><b>Expiring URLs.</b> <code>remember=1</code> keys the saved position by URL, so signed links that change on every load will not resume.</li>
        <li><b>Errors are yours to style.</b> When playback fails the player shows a neutral card and posts <code>closed</code> if the viewer dismisses it — replace the frame with your own “try another episode” UI.</li>
      ` }),
    ]),
  );

  playExample();

  return {
    el: root,
    destroy: () => {
      controller?.destroy();
      controller = null;
    },
  };
}
