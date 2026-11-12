/**
 * Proxy support for engines that load segments through XMLHttpRequest and expose
 * no URL-rewrite hook (dash.js v5).
 *
 * `open()` is patched while the engine is alive and restored afterwards. Only
 * URLs that belong to the manifest's own origin are rewritten, so unrelated
 * requests on the page are never touched. A depth counter keeps two players on
 * one page from restoring each other's patch.
 */

type OpenFn = (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) => void;

interface PatchState {
  depth: number;
  original: OpenFn;
  origin: string;
  rewrite: (url: string) => string;
}

let state: PatchState | null = null;

function normalize(url: string | URL): string {
  return typeof url === 'string' ? url : url.toString();
}

/** Base for resolving relative URLs; falls back outside a browser (tests, SSR). */
function baseHref(): string {
  return typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/';
}

export function installXhrProxy(manifestUrl: string, rewrite: (url: string) => string): () => void {
  let origin = '';
  try {
    origin = new URL(manifestUrl, baseHref()).origin;
  } catch {
    return () => undefined;
  }

  if (state) {
    state.depth += 1;
    state.origin = origin;
    state.rewrite = rewrite;
    return () => release();
  }

  const proto = XMLHttpRequest.prototype as unknown as { open: OpenFn };
  const original = proto.open;
  state = { depth: 1, original, origin, rewrite };

  proto.open = function patched(method: string, url: string | URL, ...rest: unknown[]): void {
    const raw = normalize(url);
    try {
      const absolute = new URL(raw, baseHref());
      const current = state;
      // Only same-origin-as-the-manifest requests go through the proxy, and a
      // URL that is already proxied must never be rewritten twice.
      if (current && absolute.origin === current.origin) {
        const rewritten = current.rewrite(absolute.toString());
        return current.original.call(this, method, rewritten, ...rest);
      }
    } catch {
      /* relative or opaque URL — pass through untouched */
    }
    return state!.original.call(this, method, url, ...rest);
  } as OpenFn;

  return () => release();
}

function release(): void {
  if (!state) return;
  state.depth -= 1;
  if (state.depth > 0) return;
  (XMLHttpRequest.prototype as unknown as { open: OpenFn }).open = state.original;
  state = null;
}

/** Test helper: is the patch currently installed? */
export function xhrProxyActive(): boolean {
  return state !== null;
}
