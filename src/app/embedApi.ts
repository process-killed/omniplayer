/**
 * Developer surface.
 *
 * Three ways to put OmniPlay on a page, in order of complexity:
 *
 *  1. Declarative iframe with query parameters (no JS at all).
 *  2. `OmniPlay.mount(element, options)` — creates the iframe and hands back a
 *     controller whose methods speak the postMessage protocol below.
 *  3. The raw postMessage protocol, for existing players/players-in-a-page.
 *
 * The protocol is deliberately tiny and string-tagged so a host page can talk to
 * the player without loading any of our code.
 */

export const PROTOCOL_VERSION = 1;

/** Commands a host page may send to the player. */
export type PlayerCommand =
  | { omniplay: 'play' }
  | { omniplay: 'pause' }
  | { omniplay: 'toggle' }
  | { omniplay: 'seek'; value: number }
  | { omniplay: 'volume'; value: number }
  | { omniplay: 'muted'; value: boolean }
  | { omniplay: 'rate'; value: number }
  | { omniplay: 'load'; src: string; start?: number }
  | { omniplay: 'subtitle'; src: string }
  | { omniplay: 'quality'; value: string }
  | { omniplay: 'audio'; value: number }
  | { omniplay: 'danmaku'; value: boolean }
  | { omniplay: 'fullscreen' }
  | { omniplay: 'getState' };

/** Events the player emits to its host. */
export interface PlayerEvent {
  omniplay: 'ready' | 'timeupdate' | 'state' | 'ended' | 'error' | 'tracks' | 'state-reply';
  [key: string]: unknown;
}

export function isPlayerCommand(data: unknown): data is PlayerCommand {
  if (!data || typeof data !== 'object') return false;
  const value = (data as { omniplay?: unknown }).omniplay;
  return typeof value === 'string' && value.length > 0;
}

export interface MountOptions {
  src: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  start?: number;
  title?: string;
  poster?: string;
  subtitle?: string;
  accent?: string;
  /** Base URL of the player build; defaults to this document. */
  base?: string;
  className?: string;
  style?: Partial<CSSStyleDeclaration>;
}

export interface MountedPlayer {
  iframe: HTMLIFrameElement;
  /** Send a raw protocol command. */
  post(command: PlayerCommand): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(value: number): void;
  setMuted(muted: boolean): void;
  setRate(rate: number): void;
  load(src: string, start?: number): void;
  setSubtitle(src: string): void;
  setQuality(id: string): void;
  setAudioTrack(index: number): void;
  setDanmaku(on: boolean): void;
  requestFullscreen(): void;
  getState(): void;
  /** Subscribe to player events. Returns an unsubscribe function. */
  on(handler: (event: PlayerEvent) => void): () => void;
  destroy(): void;
}

export function buildEmbedSrc(options: MountOptions): string {
  const base = options.base ?? `${window.location.origin}${window.location.pathname}`;
  const url = new URL(base);
  const params = new URLSearchParams();
  params.set('src', options.src);
  if (options.autoplay) params.set('autoplay', '1');
  if (options.muted) params.set('muted', '1');
  if (options.loop) params.set('loop', '1');
  if (options.controls === false) params.set('controls', '0');
  if (options.start) params.set('start', String(Math.round(options.start)));
  if (options.title) params.set('title', options.title);
  if (options.poster) params.set('poster', options.poster);
  if (options.subtitle) params.set('sub', options.subtitle);
  if (options.accent) params.set('accent', options.accent);
  url.hash = `#/embed?${params.toString()}`;
  return url.toString();
}

/** Create an iframe player inside `container` and return a controller. */
export function mount(container: HTMLElement | string, options: MountOptions): MountedPlayer {
  const host = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
  if (!host) throw new Error('OmniPlay.mount: container not found');

  const iframe = document.createElement('iframe');
  iframe.src = buildEmbedSrc(options);
  iframe.title = options.title ?? 'OmniPlay player';
  iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.className = options.className ?? 'omniplay-frame';
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.aspectRatio = '16 / 9';
  Object.assign(iframe.style, options.style ?? {});
  host.append(iframe);

  const target = () => iframe.contentWindow ?? undefined;
  const post = (command: PlayerCommand) => target()?.postMessage(command, '*');
  const listeners = new Set<(event: PlayerEvent) => void>();

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as PlayerEvent | undefined;
    if (!data || typeof data !== 'object' || typeof data.omniplay !== 'string') return;
    listeners.forEach((handler) => handler(data));
  };
  window.addEventListener('message', onMessage);

  return {
    iframe,
    post,
    play: () => post({ omniplay: 'play' }),
    pause: () => post({ omniplay: 'pause' }),
    seek: (value) => post({ omniplay: 'seek', value }),
    setVolume: (value) => post({ omniplay: 'volume', value }),
    setMuted: (value) => post({ omniplay: 'muted', value }),
    setRate: (value) => post({ omniplay: 'rate', value }),
    load: (src, start) => post({ omniplay: 'load', src, start }),
    setSubtitle: (src) => post({ omniplay: 'subtitle', src }),
    setQuality: (value) => post({ omniplay: 'quality', value }),
    setAudioTrack: (value) => post({ omniplay: 'audio', value }),
    setDanmaku: (value) => post({ omniplay: 'danmaku', value }),
    requestFullscreen: () => post({ omniplay: 'fullscreen' }),
    getState: () => post({ omniplay: 'getState' }),
    on(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    destroy() {
      listeners.clear();
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
}
