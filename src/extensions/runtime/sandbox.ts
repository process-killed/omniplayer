/**
 * Isolated extension runtime.
 *
 * Extension code never runs in the application window. Each active extension
 * gets a sandboxed, opaque-origin iframe (`allow-scripts` only — no
 * `allow-same-origin`), which means it has no DOM access to the app, no cookies,
 * no storage and no same-origin requests. Everything it wants goes through the
 * message bridge below, which validates each request against the permissions the
 * user granted.
 */
import type { ExtensionRequest, HostResponse, InstalledExtension, Permission } from '../types';

export interface SandboxHooks {
  onLog(level: string, message: string): void;
  onNavigation(item: { id: string; title: string; icon?: string }): void;
  onPage(page: { id: string; title: string; html?: string }): void;
  onNotify(message: string, kind?: string): void;
  getPlayerState(): unknown;
  command(command: 'play' | 'pause' | 'seek', value?: number): void;
  storageGet(key: string): Promise<unknown>;
  storageSet(key: string, value: unknown): Promise<void>;
  storageDelete(key: string): Promise<void>;
}

export interface ActiveSandbox {
  id: string;
  frame: HTMLIFrameElement;
  destroy(): void;
}

const RUNTIME_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent;color:#fff;font:14px system-ui}</style>
</head><body><div id="root"></div>
<script>
(() => {
  const post = (payload) => parent.postMessage({ __omniplayExtension: true, ...payload }, '*');
  const listeners = new Map();
  const api = {
    version: '1.0.0',
    log: (level, message) => post({ type: 'log', level, message: String(message) }),
    logger: {
      info: (m) => post({ type: 'log', level: 'info', message: String(m) }),
      warn: (m) => post({ type: 'log', level: 'warn', message: String(m) }),
      error: (m) => post({ type: 'log', level: 'error', message: String(m) }),
      debug: (m) => post({ type: 'log', level: 'debug', message: String(m) }),
    },
    ui: {
      registerNavigation: (item) => post({ type: 'ui.registerNavigation', item }),
      registerPage: (page) => post({ type: 'ui.registerPage', page }),
      notify: (message, kind) => post({ type: 'notify', message: String(message), kind }),
    },
    storage: {
      get: (key) => post({ type: 'storage.get', key }),
      set: (key, value) => post({ type: 'storage.set', key, value }),
      delete: (key) => post({ type: 'storage.delete', key }),
    },
    player: {
      getState: () => post({ type: 'player.getState' }),
      play: () => post({ type: 'player.command', command: 'play' }),
      pause: () => post({ type: 'player.command', command: 'pause' }),
      seek: (value) => post({ type: 'player.command', command: 'seek', value: Number(value) || 0 }),
    },
    on: (event, handler) => {
      listeners.set(event, handler);
    },
  };
  window.omniplay = api;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__omniplayHost !== true) return;
    const handler = listeners.get(data.type);
    if (handler) {
      try { handler(data.payload); } catch (error) { post({ type: 'log', level: 'error', message: String(error) }); }
    }
  });
  post({ type: 'ready' });
})();
</script></body></html>`;

export function createSandbox(
  extension: InstalledExtension,
  entryUrl: string,
  hooks: SandboxHooks,
): ActiveSandbox {
  const frame = document.createElement('iframe');
  // No allow-same-origin: the frame is an opaque origin and cannot touch the app.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', `${extension.manifest.name} runtime`);
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;';
  frame.srcdoc = RUNTIME_HTML;

  const granted = new Set<Permission>(extension.granted);
  const deny = (permission: Permission, what: string) => {
    hooks.onLog('warn', `${what} blocked: the ${permission} permission was not granted`);
  };

  const onMessage = async (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as (ExtensionRequest & { __omniplayExtension?: boolean }) | undefined;
    if (!data || data.__omniplayExtension !== true) return;

    const reply = (payload: HostResponse) => frame.contentWindow?.postMessage({ __omniplayHost: true, ...payload }, '*');

    try {
      switch (data.type) {
        case 'ready':
          // Only now inject the extension's own entry module.
          frame.contentWindow?.postMessage({ __omniplayHost: true, type: 'activate', payload: { entryUrl } }, '*');
          break;
        case 'log':
          hooks.onLog(data.level, data.message);
          break;
        case 'notify':
          if (!granted.has('ui.register')) return deny('ui.register', 'notification');
          hooks.onNotify(data.message, data.kind);
          break;
        case 'ui.registerNavigation':
          if (!granted.has('ui.register')) return deny('ui.register', 'navigation entry');
          hooks.onNavigation(data.item);
          break;
        case 'ui.registerPage':
          if (!granted.has('ui.register')) return deny('ui.register', 'page');
          hooks.onPage(data.page);
          break;
        case 'storage.get':
          if (!granted.has('storage.local')) return deny('storage.local', 'storage read');
          reply({ type: 'ack', result: await hooks.storageGet(data.key) });
          break;
        case 'storage.set':
          if (!granted.has('storage.local')) return deny('storage.local', 'storage write');
          await hooks.storageSet(data.key, data.value);
          reply({ type: 'ack' });
          break;
        case 'storage.delete':
          if (!granted.has('storage.local')) return deny('storage.local', 'storage delete');
          await hooks.storageDelete(data.key);
          reply({ type: 'ack' });
          break;
        case 'player.getState':
          if (!granted.has('player.read')) return deny('player.read', 'player state');
          reply({ type: 'ack', result: hooks.getPlayerState() });
          break;
        case 'player.command':
          if (!granted.has('player.control')) return deny('player.control', 'player command');
          hooks.command(data.command, data.value);
          reply({ type: 'ack' });
          break;
        default:
          hooks.onLog('warn', `unknown request: ${String((data as { type?: string }).type)}`);
      }
    } catch (error) {
      reply({ type: 'error', message: (error as Error).message });
    }
  };

  window.addEventListener('message', onMessage);
  document.body.append(frame);

  return {
    id: extension.id,
    frame,
    destroy() {
      window.removeEventListener('message', onMessage);
      frame.remove();
    },
  };
}
