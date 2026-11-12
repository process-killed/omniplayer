import type { Settings } from '../types';
import { hasProxy, proxiedUrl } from './net';

/**
 * "Why can't this link play?" — a step-by-step probe of a single URL.
 *
 * It separates the three failures that all look like "CORS" from the outside:
 *   1. the bucket sends no Access-Control-Allow-Origin at all,
 *   2. HEAD is refused but GET works (signed URLs often scope the method),
 *   3. a ranged GET is refused because the preflight OPTIONS is not allowed.
 *
 * A resolved fetch is the proof CORS passed: the browser hides
 * Access-Control-Allow-Origin from scripts, so success/failure is the signal.
 */

export type StepState = 'ok' | 'warn' | 'fail';

export interface LinkCheckStep {
  label: string;
  state: StepState;
  status?: number;
  detail: string;
}

export interface LinkCheckResult {
  url: string;
  origin: string;
  steps: LinkCheckStep[];
  verdict: string;
  verdictState: StepState;
}

const TIMEOUT = 12_000;

async function probe(url: string, init: RequestInit): Promise<{ response?: Response; error?: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    // Do not download the file: we only want headers.
    if (init.method !== 'HEAD') void response.body?.cancel().catch(() => undefined);
    return { response };
  } catch (error) {
    const name = (error as Error).name;
    return { error: name === 'AbortError' ? 'timed out' : 'blocked by CORS or unreachable' };
  } finally {
    window.clearTimeout(timer);
  }
}

function describe(response: Response): string {
  const parts = [`HTTP ${response.status}`];
  const type = response.headers.get('content-type');
  if (type) parts.push(type.split(';')[0]);
  const length = response.headers.get('content-length');
  if (length) parts.push(`${(Number(length) / 1024 / 1024).toFixed(1)} MB`);
  const ranges = response.headers.get('accept-ranges');
  if (ranges) parts.push(`ranges: ${ranges}`);
  return parts.join(' · ');
}

export async function checkLink(rawUrl: string, settings: Settings): Promise<LinkCheckResult> {
  let url = rawUrl.trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

  const steps: LinkCheckStep[] = [];
  const origin = window.location.origin;
  let usable = false;
  let ranged = false;

  const head = await probe(url, { method: 'HEAD' });
  if (head.response) {
    const ok = head.response.status < 400;
    steps.push({
      label: 'HEAD (no preflight)',
      state: ok ? 'ok' : 'warn',
      status: head.response.status,
      detail: ok ? describe(head.response) : `${describe(head.response)} — HEAD refused, which is common for signed URLs`,
    });
  } else {
    steps.push({ label: 'HEAD (no preflight)', state: 'warn', detail: head.error ?? 'failed' });
  }

  const plain = await probe(url, { method: 'GET' });
  if (plain.response && plain.response.status < 400) {
    usable = true;
    steps.push({
      label: 'GET, no Range (simple request)',
      state: 'ok',
      status: plain.response.status,
      detail: `${describe(plain.response)} — the browser was allowed to read this`,
    });
  } else if (plain.response) {
    steps.push({
      label: 'GET, no Range (simple request)',
      state: 'fail',
      status: plain.response.status,
      detail: `${describe(plain.response)} — the server refused the read`,
    });
  } else {
    steps.push({
      label: 'GET, no Range (simple request)',
      state: 'fail',
      detail: `${plain.error ?? 'failed'} — no Access-Control-Allow-Origin for ${origin}`,
    });
  }

  const rangeProbe = await probe(url, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
  if (rangeProbe.response && (rangeProbe.response.ok || rangeProbe.response.status === 206)) {
    ranged = true;
    steps.push({
      label: 'GET with Range (preflight OPTIONS)',
      state: 'ok',
      status: rangeProbe.response.status,
      detail: `${describe(rangeProbe.response)} — seeking and demuxing will work`,
    });
  } else if (rangeProbe.response) {
    steps.push({
      label: 'GET with Range (preflight OPTIONS)',
      state: 'warn',
      status: rangeProbe.response.status,
      detail: `${describe(rangeProbe.response)} — range requests are refused`,
    });
  } else {
    steps.push({
      label: 'GET with Range (preflight OPTIONS)',
      state: usable ? 'warn' : 'fail',
      detail: `${rangeProbe.error ?? 'failed'} — the preflight was refused. Add OPTIONS to AllowedMethods, or allow the Range header.`,
    });
  }

  if (hasProxy(settings)) {
    const proxied = await probe(proxiedUrl(url, settings), { method: 'GET' });
    if (proxied.response && proxied.response.status < 400) {
      steps.push({
        label: 'Through your proxy',
        state: 'ok',
        status: proxied.response.status,
        detail: `${describe(proxied.response)} — the proxy answers`,
      });
      usable = true;
    } else {
      steps.push({
        label: 'Through your proxy',
        state: 'fail',
        status: proxied.response?.status,
        detail: proxied.response ? describe(proxied.response) : (proxied.error ?? 'failed'),
      });
    }
  }

  let verdict: string;
  let verdictState: StepState;
  if (!usable) {
    verdictState = 'fail';
    verdict = `The browser is not allowed to read this file from ${origin}. Check that the bucket policy lists this exact origin, the exact bucket/path, and that the signed URL has not expired.`;
  } else if (!ranged) {
    verdictState = 'warn';
    verdict = 'The file is readable, but range requests fail — MKV/AVI need ranges to seek. Allow OPTIONS and the Range header in the bucket policy.';
  } else {
    verdictState = 'ok';
    verdict = 'Everything the player needs works: readable bytes, ranges and CORS.';
  }

  return { url, origin, steps, verdict, verdictState };
}
