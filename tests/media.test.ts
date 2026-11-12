// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { categoryOf, codecStringFor, detectContainer, extOf, manifestKindFromUrl, mseMimeForContainer } from '../src/media/formats';
import { buildMimeType, canPlayNatively, isNativelyPlayableContainer, selectEngineChain } from '../src/core/engineSelector';
import type { BrowserCapabilities } from '../src/core/capabilities';
import type { ProbeInfo, ResolvedSource, Settings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/storage/settings';

function bytes(values: number[], padTo = 64): Uint8Array {
  const out = new Uint8Array(Math.max(padTo, values.length));
  out.set(values);
  return out;
}

function asciiBytes(text: string): number[] {
  return Array.from(text).map((char) => char.charCodeAt(0));
}

const caps = (overrides: Partial<BrowserCapabilities> = {}): BrowserCapabilities => ({
  webcodecsVideo: true,
  webcodecsAudio: true,
  mse: true,
  hlsNative: false,
  dashMse: true,
  mediaCapabilities: true,
  wasm: true,
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  webgl2: true,
  offscreenCanvas: true,
  fileSystemAccess: false,
  pictureInPicture: true,
  remotePlayback: false,
  webAudio: true,
  indexedDB: true,
  serviceWorker: true,
  wakeLock: true,
  screenOrientation: true,
  hardwareConcurrency: 8,
  maxTouchPoints: 0,
  codecs: { avc: true, hevc: false, av1: true, vp9: true, vp8: true, mpeg2: false, aac: true, mp3: true, opus: true, flac: true, ac3: false, eac3: false },
  browser: { name: 'Test', version: '1', engine: 'Test' },
  os: 'Test',
  isMobile: false,
  isIOS: false,
  isSafari: false,
  isFirefox: false,
  isChromium: true,
  lowMemory: false,
  ...overrides,
});

const settings = (overrides: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

// jsdom has no media stack; emulate a browser that accepts MP4/H.264.
beforeAll(() => {
  HTMLMediaElement.prototype.canPlayType = ((type: string) =>
    type.includes('video/mp4') || type.includes('video/webm') ? 'probably' : '') as typeof HTMLMediaElement.prototype.canPlayType;
});

const probe = (overrides: Partial<ProbeInfo> = {}): ProbeInfo => ({
  container: 'mp4',
  videoCodec: 'avc',
  audioCodec: 'aac',
  videoTracks: [],
  audioTracks: [],
  subtitleTracks: [],
  chapters: [],
  method: 'mediabunny',
  ...overrides,
});

const source = (overrides: Partial<ResolvedSource> = {}): ResolvedSource => ({
  spec: { id: 'x', kind: 'file', name: 'clip.mp4' },
  playbackUrl: 'blob:test',
  kind: 'progressive',
  ...overrides,
});

describe('container sniffing', () => {
  it('detects MP4 from the ftyp box', () => {
    const data = bytes([0, 0, 0, 0x18, ...asciiBytes('ftypisom'), 0, 0, 2, 0, ...asciiBytes('isomiso2avc1mp41')]);
    expect(detectContainer(data)?.id).toBe('mp4');
  });

  it('distinguishes QuickTime from MP4', () => {
    const data = bytes([0, 0, 0, 0x14, ...asciiBytes('ftypqt  '), 0, 0, 0, 0]);
    expect(detectContainer(data)?.id).toBe('mov');
  });

  it('detects Matroska and WebM from the EBML header', () => {
    const mkv = bytes([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01, ...asciiBytes('matroska')]);
    expect(detectContainer(mkv)?.id).toBe('mkv');
    const webm = bytes([0x1a, 0x45, 0xdf, 0xa3, ...asciiBytes('webm')]);
    expect(detectContainer(webm)?.id).toBe('webm');
  });

  it('detects AVI, FLV and transport streams', () => {
    expect(detectContainer(bytes([...asciiBytes('RIFF'), 0, 0, 0, 0, ...asciiBytes('AVI ')]))?.id).toBe('avi');
    expect(detectContainer(bytes([...asciiBytes('FLV'), 0x01, 0x05]))?.id).toBe('flv');
    const ts = new Uint8Array(400);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect(detectContainer(ts)?.id).toBe('ts');
  });

  it('recognises an HTML page so it is not mistaken for media', () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>hello</body></html>');
    expect(detectContainer(html)?.id).toBe('html');
  });

  it('returns null for unrecognisable bytes', () => {
    expect(detectContainer(bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });
});

describe('names and mime types', () => {
  it('extracts extensions from URLs with query strings', () => {
    expect(extOf('https://cdn.example.com/movie.mkv?token=abc&x=1')).toBe('mkv');
    expect(extOf('https://example.com/live/index.m3u8')).toBe('m3u8');
  });

  it('categorises files', () => {
    expect(categoryOf('a.mp4')).toBe('video');
    expect(categoryOf('a.flac')).toBe('audio');
    expect(categoryOf('a.ass')).toBe('subtitle');
    expect(categoryOf('a.m3u8')).toBe('manifest');
    expect(categoryOf('page', 'text/html')).toBe('unknown');
  });

  it('detects manifests from URLs', () => {
    expect(manifestKindFromUrl('https://x/y/index.m3u8')).toBe('hls');
    expect(manifestKindFromUrl('https://x/y/manifest.mpd')).toBe('dash');
    expect(manifestKindFromUrl('https://x/y/file.mp4')).toBeNull();
  });

  it('maps containers to MSE mime prefixes', () => {
    expect(mseMimeForContainer('mkv')).toBe('video/x-matroska');
    expect(mseMimeForContainer('webm')).toBe('video/webm');
    expect(mseMimeForContainer('mp4')).toBe('video/mp4');
  });

  it('builds RFC 6381 codec strings', () => {
    expect(codecStringFor('avc', 'video')).toContain('avc1.');
    expect(codecStringFor('hevc', 'video')).toContain('hvc1.');
    expect(codecStringFor('aac', 'audio')).toBe('mp4a.40.2');
    expect(codecStringFor(undefined, 'video')).toBeNull();
  });
});

describe('engine selection', () => {
  it('prefers native for MP4 with H.264', () => {
    const result = selectEngineChain({ source: source(), probe: probe(), settings: settings(), caps: caps() });
    expect(result.chain[0]).toBe('native');
    expect(result.chain).toContain('webcodecs');
    expect(result.nativeSupported).toBe(true);
  });

  it('prefers WebCodecs for MKV', () => {
    const result = selectEngineChain({
      source: source({ spec: { id: 'x', kind: 'file', name: 'clip.mkv' } }),
      probe: probe({ container: 'mkv', videoCodec: 'hevc' }),
      settings: settings(),
      caps: caps(),
    });
    expect(result.chain[0]).toBe('webcodecs');
  });

  it('respects the WebCodecs preference', () => {
    const result = selectEngineChain({ source: source(), probe: probe(), settings: settings({ enginePreference: 'webcodecs' }), caps: caps() });
    expect(result.chain[0]).toBe('webcodecs');
    expect(result.chain[1]).toBe('native');
  });

  it('never offers WebCodecs when the browser lacks it', () => {
    const result = selectEngineChain({
      source: source({ spec: { id: 'x', kind: 'file', name: 'clip.mkv' } }),
      probe: probe({ container: 'mkv' }),
      settings: settings(),
      caps: caps({ webcodecsVideo: false }),
    });
    expect(result.chain).not.toContain('webcodecs');
    expect(result.chain).toEqual(['native']);
  });

  it('never uses the canvas engine for audio-only files', () => {
    const result = selectEngineChain({
      source: source({ spec: { id: 'x', kind: 'file', name: 'track.flac' } }),
      probe: probe({ container: 'flac', videoCodec: undefined, audioCodec: 'flac', videoTracks: [], audioTracks: [] }),
      settings: settings({ enginePreference: 'webcodecs' }),
      caps: caps(),
    });
    expect(result.chain).not.toContain('webcodecs');
    expect(result.chain[0]).toBe('native');
  });

  it('routes manifests to their streaming engines', () => {
    const hls = selectEngineChain({ source: source({ kind: 'hls' }), probe: null, settings: settings(), caps: caps() });
    expect(hls.chain[0]).toBe('hls');
    const dash = selectEngineChain({ source: source({ kind: 'dash' }), probe: null, settings: settings(), caps: caps() });
    expect(dash.chain[0]).toBe('dash');
  });

  it('reports HEVC as unsupported when the browser cannot decode it', () => {
    const result = canPlayNatively(source(), probe({ videoCodec: 'hevc' }), caps({ codecs: { ...caps().codecs, hevc: false } }));
    expect(result.supported).toBe(false);
    expect(result.reason).toContain('HEVC');
  });

  it('drops to native only when the host blocks browser access', () => {
    const blocked: ResolvedSource = {
      spec: { id: 'x', kind: 'url', name: 'clip.mkv', url: 'https://host/clip.mkv' },
      playbackUrl: 'https://host/clip.mkv',
      kind: 'progressive',
      network: { corsOk: false, error: 'blocked' },
    };
    const result = selectEngineChain({ source: blocked, probe: null, settings: settings(), caps: caps() });
    expect(result.chain).toEqual(['native']);
    expect(result.webcodecsAvailable).toBe(false);
    expect(result.notes.join(' ')).toMatch(/CORS/i);
  });

  it('knows which containers a <video> can open without reading bytes', () => {
    expect(isNativelyPlayableContainer('mp4')).toBe(true);
    expect(isNativelyPlayableContainer('webm')).toBe(true);
    expect(isNativelyPlayableContainer('mkv')).toBe(false);
    expect(isNativelyPlayableContainer('avi')).toBe(false);
    expect(isNativelyPlayableContainer(undefined)).toBe(false);
  });

  it('builds a full mime type from probe data', () => {
    const mime = buildMimeType(probe());
    expect(mime).toContain('video/mp4');
    expect(mime).toContain('codecs=');
    expect(mime).toContain('avc1');
  });
});
