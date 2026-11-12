import type { MediaSourceSpec, NetworkInfo, ResolvedSource, Settings } from '../types';
import { AppError, httpErrorForStatus, redactUrl, toAppError } from './errors';
import { detectContainer, extOf, manifestKindFromUrl, mimeForExt } from '../media/formats';
import { hasProxy, proxiedUrl, proxyCandidates, rememberProxyShape } from './net';

/**
 * Turns a user-supplied source into something playable, and reports what the
 * server actually is: content type, size, range support, CORS behaviour.
 */
export class SourceResolver {
  /** Remember probe results for a few minutes so retries do not hammer the host. */
  private readonly cache = new Map<string, { at: number; info: NetworkInfo }>();
  private static readonly CACHE_MS = 120_000;

  constructor(private readonly getSettings: () => Settings) {}

  async resolve(spec: MediaSourceSpec): Promise<ResolvedSource> {
    if (spec.file) {
      const url = URL.createObjectURL(spec.file);
      return {
        spec,
        playbackUrl: url,
        objectUrl: url,
        kind: 'file',
        network: {
          contentType: spec.file.type || mimeForExt(extOf(spec.file.name)),
          contentLength: spec.file.size,
          acceptRanges: true,
          corsOk: true,
        },
      };
    }

    if (!spec.url) throw new AppError('invalid-url');

    const url = this.validateUrl(spec.url);
    const manifest = manifestKindFromUrl(url);
    const network = await this.inspectNetwork(url, spec.headers);

    // With a proxy configured every read goes through it, including playback.
    const playbackUrl = hasProxy(this.getSettings()) ? proxiedUrl(url, this.getSettings()) : url;

    if (network.contentType?.includes('text/html') && !manifest) {
      // A web page, not a media file. Say so instead of pretending.
      throw new AppError('not-media', {
        detail: `Server returned ${network.contentType} for ${redactUrl(url)}`,
      });
    }

    if (manifest === 'hls') {
      return { spec, playbackUrl, kind: 'hls', network };
    }
    if (manifest === 'dash') {
      return { spec, playbackUrl, kind: 'dash', network };
    }

    // Content-type may still reveal a manifest served without an extension.
    const ct = network.contentType ?? '';
    if (ct.includes('mpegurl')) return { spec, playbackUrl, kind: 'hls', network };
    if (ct.includes('dash+xml')) return { spec, playbackUrl, kind: 'dash', network };

    return { spec, playbackUrl, kind: 'progressive', network };
  }

  validateUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) throw new AppError('invalid-url');
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      // Accept bare host/path input and assume https.
      try {
        parsed = new URL(`https://${trimmed}`);
      } catch {
        throw new AppError('invalid-url');
      }
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new AppError('unsupported-protocol', {
        detail: `Blocked protocol: ${parsed.protocol}`,
      });
    }
    return parsed.toString();
  }

  /** HEAD first (cheap), then a one-byte ranged GET if HEAD is refused. */
  async inspectNetwork(url: string, headers?: Record<string, string>): Promise<NetworkInfo> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < SourceResolver.CACHE_MS) return { ...cached.info };

    const settings = this.getSettings();
    const timeout = Math.max(3, settings.requestTimeout) * 1000;
    const info: NetworkInfo = { finalUrl: url, proxied: hasProxy(settings) };
    const remember = () => {
      this.cache.set(url, { at: Date.now(), info: { ...info } });
      return info;
    };

    let networkFailure = false;
    // When a proxy is configured we do not know which URL shape it expects, so
    // try the candidates until one answers. A worker that only accepts ?url=
    // used to answer 400 for the path-style guess.
    const candidates = hasProxy(settings) ? proxyCandidates(url, settings.corsProxy) : [url];
    let candidateIndex = 0;

    const attempt = async (method: 'HEAD' | 'GET', ranged = method === 'GET'): Promise<Response | null> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(candidates[candidateIndex], {
          method,
          headers: {
            ...(headers ?? {}),
            ...(method === 'GET' && ranged ? { Range: 'bytes=0-1' } : {}),
          },
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'follow',
          cache: 'no-store',
        });
        return response;
      } catch (error) {
        const name = (error as Error).name;
        info.error = name === 'AbortError' ? 'timeout' : 'blocked';
        // A thrown fetch on an online device means CORS or an unreachable host.
        if (name !== 'AbortError') networkFailure = true;
        return null;
      } finally {
        window.clearTimeout(timer);
      }
    };

    let response = await attempt('HEAD');

    // The proxy itself rejected our shape (400/404/405) — try the other forms.
    while (
      candidates.length > 1 &&
      response &&
      [400, 404, 405, 422].includes(response.status) &&
      candidateIndex < candidates.length - 1
    ) {
      candidateIndex++;
      const retry = await attempt('HEAD');
      if (retry && !(retry.status >= 400 && retry.status < 500)) {
        response = retry;
        break;
      }
      if (retry) response = retry;
    }
    if (candidateIndex > 0 && response && response.status < 400) {
      rememberProxyShape(settings.corsProxy, candidateIndex);
      info.proxied = true;
    }

    let rangedOk = false;
    let readable = !!response && response.status < 400;

    if (!readable) {
      // A signed URL often refuses HEAD (403) while GET works. Ask with a plain
      // GET first: no Range header means no preflight, so a bucket whose CORS
      // policy only lists GET/HEAD still answers. We read the headers and drop
      // the body immediately.
      const plain = await attempt('GET', false);
      if (plain && plain.ok) {
        void plain.body?.cancel().catch(() => undefined);
        response = plain;
        readable = true;
      } else if (plain && (plain.status === 206 || plain.status < 400)) {
        response = plain;
        readable = true;
      } else if (plain) {
        response = plain;
      } else if (!response) {
        response = plain;
      }
    }

    // Only now ask for a byte range, to learn whether seeking is possible.
    if (readable && response && response.status < 400) {
      const ranged = await attempt('GET');
      if (ranged && (ranged.ok || ranged.status === 206)) {
        void ranged.body?.cancel().catch(() => undefined);
        rangedOk = true;
      } else if (ranged) {
        void ranged.body?.cancel().catch(() => undefined);
      }
    }

    // HEAD was refused *and* the ranged GET could not be read: the host is
    // blocking browser access, so report CORS rather than a misleading 403.
    if (!readable && networkFailure) {
      info.corsOk = false;
      info.error = navigator.onLine ? 'blocked' : 'offline';
      info.failure = 'cors';
      return remember();
    }

    if (!response) {
      // <video> may still work without CORS, so do not hard-fail here.
      info.corsOk = false;
      info.error = navigator.onLine ? 'blocked' : 'offline';
      info.failure = navigator.onLine ? 'cors' : 'offline';
      return remember();
    }

    info.status = response.status;
    info.rangeOk = rangedOk || response.status === 206;
    info.finalUrl = response.url || url;
    info.contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader) info.contentLength = Number(lengthHeader);
    const acceptRanges = response.headers.get('accept-ranges');
    info.acceptRanges = acceptRanges === 'bytes' || response.status === 206;
    info.corsOk = true;

    if (response.status >= 400) {
      throw httpErrorForStatus(response.status, url);
    }
    return remember();
  }

  /** Read the first bytes of a network source to identify its container. */
  async sniff(url: string, headers?: Record<string, string>): Promise<{ container?: string; label?: string; mime?: string } | null> {
    const settings = this.getSettings();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), Math.max(4, settings.requestTimeout) * 1000);
    try {
      const response = await fetch(proxiedUrl(url, settings), {
        headers: { ...(headers ?? {}), Range: 'bytes=0-8191' },
        signal: controller.signal,
        credentials: 'omit',
      });
      if (!response.ok && response.status !== 206) return null;
      const buffer = new Uint8Array(await response.arrayBuffer());
      const guess = detectContainer(buffer.slice(0, 8192));
      if (!guess) return null;
      return { container: guess.id, label: guess.label, mime: guess.mime };
    } catch (error) {
      throw toAppError(error, 'cors');
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** Validate a manifest before handing it to a streaming engine. */
  async checkManifest(url: string, kind: 'hls' | 'dash', headers?: Record<string, string>): Promise<{ ok: boolean; reason?: string }> {
    const settings = this.getSettings();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(proxiedUrl(url, settings), {
        headers: headers ?? {},
        signal: controller.signal,
        credentials: 'omit',
      });
      if (!response.ok) {
        return { ok: false, reason: `HTTP ${response.status}` };
      }
      const text = (await response.text()).slice(0, 4096);
      if (kind === 'hls' && !text.includes('#EXTM3U')) {
        return { ok: false, reason: 'Response is not an HLS playlist (#EXTM3U missing)' };
      }
      if (kind === 'dash' && !text.includes('<MPD')) {
        return { ok: false, reason: 'Response is not a DASH manifest (<MPD> missing)' };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    } finally {
      window.clearTimeout(timer);
    }
  }
}
