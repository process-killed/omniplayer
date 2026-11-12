import './styles/main.css';
import './styles/themes.css';
import './styles/player.css';
import './styles/mobile.css';

import { App } from './app/app';
import { library } from './storage/library';
import { audioProcessor } from './audio/audioProcessor';
import { toast } from './ui/dom';
import { store } from './app/store';
import { log, setLogLevel } from './utils/log';

/**
 * `https://player.example/?src=<link>` is the "paste the direct link after the
 * site URL" form. Rewrite it into the embed route before the app boots.
 */
function applyEmbedQuery(): void {
  const params = new URLSearchParams(window.location.search);
  const src = params.get('src') ?? params.get('url') ?? params.get('file');
  if (!src || window.location.hash.startsWith('#/embed')) return;
  const forwarded = new URLSearchParams(params);
  forwarded.set('src', src);
  window.history.replaceState(null, '', `${window.location.pathname}#/embed?${forwarded.toString()}`);
}

/** Public developer surface: `OmniPlay.mount(...)` and helpers. */
function exposeApi(): void {
  void import('./app/embedApi').then((api) => {
    (window as unknown as { OmniPlay: unknown }).OmniPlay = {
      version: '1.22.0',
      protocolVersion: api.PROTOCOL_VERSION,
      mount: api.mount,
      buildEmbedSrc: api.buildEmbedSrc,
    };
    void import('./app/webComponent').then((mod) => mod.defineOmniPlay());
  });
}

/** Apply the detected device profile to the document (CSS + budgets). */
async function applyDeviceProfile(): Promise<void> {
  const { deviceReport, applyProfileToDocument } = await import('./core/deviceProfile');
  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem('omniplay:settings:v1') ?? '{}').deviceProfile ?? 'auto';
    } catch {
      return 'auto';
    }
  })();
  const detected = deviceReport().profile;
  applyProfileToDocument(stored === 'auto' ? detected : stored);
}

async function bootstrap(): Promise<void> {
  exposeApi();
  void applyDeviceProfile();
  applyEmbedQuery();
  const mount = document.getElementById('app');
  if (!mount) throw new Error('Missing #app mount point');

  // Load local library before the first paint so counts are correct.
  await library.init().catch(() => undefined);

  setLogLevel(store.settings.logLevel);
  store.on('settings', ({ changed }) => {
    if (changed.includes('logLevel')) setLogLevel(store.settings.logLevel);
  });

  new App(mount);

  // iOS unlocks Web Audio only from a gesture; do it on the first interaction.
  const unlock = () => {
    void audioProcessor.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // Never let a stray drag navigate away from the app.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | undefined;
    log.error('unhandled rejection', event.reason);
    if (store.settings.logLevel === 'debug') toast(reason?.message ?? 'Unexpected error', 'err');
  });

  window.addEventListener('error', (event) => {
    if (event.message?.includes('ResizeObserver')) return;
    log.error('window error', event.error ?? event.message);
  });

  // The PWA manager owns service-worker registration and update prompts.
  document.documentElement.classList.toggle('is-standalone', window.matchMedia('(display-mode: standalone)').matches);
}

void bootstrap();
