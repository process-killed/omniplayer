/**
 * webtor.io through the official embed SDK.
 *
 * The SDK replaces a container element with its own player iframe and accepts a
 * plain config object (`window.webtor.push({...})`). That is far more reliable
 * than hand-building a hash URL, and it gives us poster, subtitle tracks, title,
 * feature toggles and a custom `baseUrl` for self-hosted Webtor instances.
 *
 * Trade-off, stated plainly: with webtor.io the torrent is fetched by their
 * servers, not the visitor's browser. That is what makes any swarm playable, and
 * it is also why this stays an explicit provider choice.
 */

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js/dist/index.min.js';

export interface WebtorSubtitle {
  srclang: string;
  label: string;
  src: string;
  default?: boolean;
}

export interface WebtorConfig {
  id: string;
  magnet?: string;
  torrentUrl?: string;
  poster?: string;
  subtitles?: WebtorSubtitle[];
  title?: string;
  imdbId?: string;
  header?: boolean;
  lang?: string;
  controls?: boolean;
  baseUrl?: string;
}

type WebtorQueue = WebtorConfig[] & { push(config: WebtorConfig): number };

declare global {
  interface Window {
    webtor?: WebtorQueue;
  }
}

/** Load the SDK once; resolves when the script has run. */
export function loadWebtorSdk(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>('script[data-omniplay-webtor]');
  if (existing) {
    return existing.dataset.loaded === 'true'
      ? Promise.resolve()
      : new Promise((resolve) => existing.addEventListener('load', () => resolve(), { once: true }));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.charset = 'utf-8';
    script.dataset.omniplayWebtor = 'true';
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error('The webtor.io embed SDK could not be loaded.')));
    document.head.append(script);
  });
}

/** Mount a webtor player inside `host` and return a disposer. */
export async function mountWebtor(
  host: HTMLElement,
  options: { magnet: string; title?: string; poster?: string; subtitles?: WebtorSubtitle[]; baseUrl?: string },
): Promise<() => void> {
  await loadWebtorSdk();
  window.webtor = window.webtor || ([] as unknown as WebtorQueue);

  const id = `webtor-${Math.random().toString(36).slice(2, 9)}`;
  const container = document.createElement('div');
  container.id = id;
  container.className = 'webtor-host';
  container.style.width = '100%';
  container.style.height = '100%';
  host.append(container);

  window.webtor.push({
    id,
    magnet: options.magnet,
    poster: options.poster,
    subtitles: options.subtitles,
    title: options.title,
    header: true,
    controls: true,
    baseUrl: options.baseUrl,
  });

  return () => container.remove();
}

/** Shareable link for the "open on webtor.io" escape hatch. */
export function webtorWebUrl(magnet: string): string {
  return `https://webtor.io/#/show?magnet=${encodeURIComponent(magnet)}`;
}

export function isWebtorUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('webtor.io');
  } catch {
    return false;
  }
}
