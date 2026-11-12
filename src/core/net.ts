import type { Settings } from '../types';

/**
 * Optional CORS proxy support.
 *
 * Some hosts (signed storage buckets, download gateways) send no
 * `Access-Control-Allow-Origin`, so the browser refuses to let the player read
 * the bytes. A player cannot override that. What it *can* do is route requests
 * through a proxy the user controls — a Cloudflare Worker, a small server, or
 * any URL that adds the header and forwards Range requests.
 *
 * Template examples:
 *   https://my-worker.dev/?url={url}
 *   https://my-worker.dev/proxy/
 */

/**
 * The URL shapes a proxy might expect, most common first. Workers in the wild
 * use `?url=`, `?u=`, a path segment, or an explicit `{url}` placeholder; the
 * player negotiates instead of assuming one.
 */
export function proxyCandidates(target: string, template: string): string[] {
  const trimmed = (template ?? '').trim();
  if (!trimmed) return [target];
  const encoded = encodeURIComponent(target);
  if (trimmed.includes('{url}')) return [trimmed.replace(/\{url\}/g, encoded)];

  const hasQuery = trimmed.includes('?');
  const separator = hasQuery ? (trimmed.endsWith('?') || trimmed.endsWith('&') ? '' : '&') : '?';
  const candidates = [
    `${trimmed}${separator}url=${encoded}`,
    `${trimmed}${separator}u=${encoded}`,
  ];
  // Path-style: /proxy/<encoded> — only when the template has no query of its own.
  if (!hasQuery) {
    candidates.push(`${trimmed.replace(/\/+$/, '')}/${encoded}`);
  }
  return candidates;
}

/** Which candidate worked last time, per template (so we stop guessing). */
const shapeCache = new Map<string, number>();

export function rememberProxyShape(template: string, index: number): void {
  if (template) shapeCache.set(template.trim(), index);
}

export function buildProxyUrl(target: string, template: string): string {
  const trimmed = (template ?? '').trim();
  if (!trimmed) return target;
  const candidates = proxyCandidates(target, trimmed);
  const known = shapeCache.get(trimmed) ?? 0;
  return candidates[Math.min(known, candidates.length - 1)] ?? target;
}

export function hasProxy(settings: Settings | null | undefined): boolean {
  return !!settings?.corsProxy?.trim();
}

/** The URL every byte-level request should use for this source. */
export function proxiedUrl(target: string, settings: Settings | null | undefined): string {
  if (!settings) return target;
  return buildProxyUrl(target, settings.corsProxy ?? '');
}

/** fetch() that goes through the configured proxy. */
export function netFetch(url: string, init: RequestInit, settings: Settings | null | undefined): Promise<Response> {
  return fetch(proxiedUrl(url, settings), init);
}

/** Basic sanity check for the settings field. */
export function isValidProxyTemplate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (trimmed.includes('{url}')) return true;
  return trimmed.endsWith('/') || trimmed.includes('?');
}
