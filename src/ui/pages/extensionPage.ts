import type { PageContext, PageInstance } from './types';
import { el, toast } from '../dom';
import { icon } from '../icons';
import { pageHead } from '../components';
import { extensionManager } from '../../extensions/core/manager';

/**
 * Hosts an extension's own interface.
 *
 * The extension supplies HTML; it is rendered inside a sandboxed frame with an
 * opaque origin, so its script cannot touch the application DOM, storage or the
 * player. Anything it wants goes through the bridge in the parent.
 */
export function createExtensionPage(ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });
  const host = el('div', { class: 'ext-page-frame' });

  const params = ctx.router.current.params as Record<string, string>;
  const extensionId = params.id ?? '';
  const pageId = params.page ?? '';

  const pages = extensionManager.pagesFor(extensionId);
  const page = pages.find((entry) => entry.id === pageId) ?? pages[0];

  if (!page) {
    root.append(
      pageHead('Extension page', 'This page is no longer registered. The extension may have been disabled.'),
    );
    return { el: root };
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', page.title);
  frame.className = 'ext-page-iframe';
  frame.srcdoc = page.html ?? '<p style="font:14px system-ui;padding:20px">This extension did not provide any content.</p>';

  host.append(frame);

  const back = el('button', { class: 'btn btn--sm', type: 'button' });
  back.innerHTML = `${icon('arrowLeft', 15)} Extensions`;
  back.addEventListener('click', () => ctx.router.navigate('extensions'));

  root.append(pageHead(page.title, 'Provided by an extension · runs sandboxed on your device', [back]), host);

  // The frame can ask the host for its stored settings through postMessage.
  const onMessage = async (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { __omniplayPage?: boolean; type?: string; key?: string; value?: unknown; message?: string };
    if (!data || data.__omniplayPage !== true) return;
    if (data.type === 'notify' && data.message) toast(String(data.message), 'ok');
    if (data.type === 'storage.get' && data.key) {
      const value = await extensionManager.kvGet(extensionId, data.key);
      frame.contentWindow?.postMessage({ __omniplayHost: true, type: 'storage', key: data.key, value }, '*');
    }
    if (data.type === 'storage.set' && data.key) {
      await extensionManager.kvSet(extensionId, data.key, data.value);
    }
  };
  window.addEventListener('message', onMessage);

  return {
    el: root,
    destroy: () => window.removeEventListener('message', onMessage),
  };
}
