import type { EngineKind, ProbeInfo, ResolvedSource, Settings } from '../types';
import type { BrowserCapabilities } from './capabilities';
import { AUDIO_EXTENSIONS, codecStringFor, extOf, mseMimeForContainer } from '../media/formats';

export interface EngineSelection {
  chain: EngineKind[];
  reason: string;
  nativeSupported: boolean;
  webcodecsAvailable: boolean;
  notes: string[];
}

const NATIVE_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg', '3gp', 'f4v', 'ts', 'm2ts', 'aac', 'mp3', 'flac', 'wav']);

/** Containers a <video> element can open without the app reading the bytes. */
export function isNativelyPlayableContainer(container: string | undefined): boolean {
  return !!container && NATIVE_CONTAINERS.has(container.toLowerCase());
}

function videoCodecSupported(codec: string | undefined, caps: BrowserCapabilities): boolean {
  if (!codec) return true;
  const c = codec.toLowerCase();
  if (c.startsWith('avc') || c === 'h264') return caps.codecs.avc;
  if (c === 'hevc' || c === 'h265' || c.startsWith('hvc1') || c.startsWith('hev1')) return caps.codecs.hevc;
  if (c === 'av1' || c.startsWith('av01')) return caps.codecs.av1;
  if (c === 'vp9' || c.startsWith('vp09')) return caps.codecs.vp9;
  if (c === 'vp8') return caps.codecs.vp8;
  return false;
}

function audioCodecSupported(codec: string | undefined, caps: BrowserCapabilities): boolean {
  if (!codec) return true;
  const c = codec.toLowerCase();
  if (c === 'aac' || c.startsWith('mp4a')) return caps.codecs.aac;
  if (c === 'mp3') return caps.codecs.mp3;
  if (c === 'opus') return caps.codecs.opus;
  if (c === 'flac') return caps.codecs.flac;
  if (c === 'ac3' || c === 'ac-3') return caps.codecs.ac3;
  if (c === 'eac3' || c === 'ec-3') return caps.codecs.eac3;
  if (c === 'vorbis') return caps.codecs.opus || caps.codecs.flac;
  if (c.startsWith('pcm')) return true;
  return false;
}

/** Build a precise MSE type string for the probe, when enough is known. */
export function buildMimeType(probe: ProbeInfo | null, containerId?: string): string | null {
  if (!probe) return null;
  const container = containerId ?? probe.container ?? 'mp4';
  const base = mseMimeForContainer(container);
  const videoCodec = codecStringFor(probe.videoCodec, 'video');
  const audioCodec = codecStringFor(probe.audioCodec, 'audio');
  const codecs = [videoCodec, audioCodec].filter(Boolean);
  if (codecs.length === 0) return base;
  return `${base}; codecs="${codecs.join(', ')}"`;
}

export function canPlayNatively(source: ResolvedSource, probe: ProbeInfo | null, caps: BrowserCapabilities): { supported: boolean; reason: string } {
  if (source.kind === 'hls') {
    return { supported: caps.hlsNative, reason: caps.hlsNative ? 'Browser supports HLS natively' : 'HLS needs hls.js' };
  }
  if (source.kind === 'dash') {
    return { supported: false, reason: 'Browsers do not play DASH without a library' };
  }

  const container = probe?.container ?? extOf(source.spec.name) ?? '';
  if (!NATIVE_CONTAINERS.has(container)) {
    return { supported: false, reason: `${container || 'This container'} is not natively playable in browsers` };
  }

  if (probe?.videoCodec && !videoCodecSupported(probe.videoCodec, caps)) {
    return { supported: false, reason: `Native ${probe.videoCodec.toUpperCase()} decoding is unavailable` };
  }
  if (probe?.audioCodec && !audioCodecSupported(probe.audioCodec, caps)) {
    return { supported: false, reason: `Native ${probe.audioCodec.toUpperCase()} decoding is unavailable` };
  }

  const mime = buildMimeType(probe, container);
  if (mime) {
    try {
      const video = document.createElement('video');
      const answer = video.canPlayType(mime);
      if (answer === '') {
        return { supported: false, reason: `canPlayType("${mime}") is empty` };
      }
    } catch {
      /* keep the optimistic answer */
    }
  }
  return { supported: true, reason: probe ? 'Container and codecs are natively supported' : 'Container is natively supported' };
}

/**
 * Decide which engine to try first, and what to fall back to.
 * The order is deterministic and every entry is genuinely available.
 */
export function selectEngineChain(options: {
  source: ResolvedSource;
  probe: ProbeInfo | null;
  settings: Settings;
  caps: BrowserCapabilities;
}): EngineSelection {
  const { source, probe, settings, caps } = options;
  const notes: string[] = [];

  // Without CORS the app cannot fetch a single byte, so demuxing is impossible.
  // Only the browser's own <video> path can still work.
  if (source.network && source.network.corsOk === false) {
    return {
      chain: ['native'],
      reason: 'Host blocks browser access (CORS) — only native playback is possible',
      nativeSupported: canPlayNatively(source, probe, caps).supported,
      webcodecsAvailable: false,
      notes: ['CORS: the server did not allow this origin to read the file.'],
    };
  }

  if (source.kind === 'hls') {
    const chain: EngineKind[] = caps.hlsNative && !caps.mse ? ['hls', 'native'] : ['hls'];
    return {
      chain,
      reason: 'HLS manifest — hls.js with Media Source Extensions',
      nativeSupported: caps.hlsNative,
      webcodecsAvailable: false,
      notes: [caps.mse ? 'MSE available' : 'MSE unavailable — native HLS only'],
    };
  }
  if (source.kind === 'dash') {
    return {
      chain: ['dash'],
      reason: 'MPEG-DASH manifest — dash.js',
      nativeSupported: false,
      webcodecsAvailable: false,
      notes: [caps.mse ? 'MSE available' : 'MSE unavailable — DASH cannot play here'],
    };
  }

  const native = canPlayNatively(source, probe, caps);
  const lowMemory = settings.lowMemoryMode === 'on' || (settings.lowMemoryMode === 'auto' && caps.lowMemory);
  const audioExt = (AUDIO_EXTENSIONS as readonly string[]).includes(extOf(source.spec.name));
  const audioOnly = audioExt || (!!probe && probe.videoTracks.length === 0 && probe.audioTracks.length > 0);
  const webcodecsAvailable = caps.webcodecsVideo && settings.allowWebCodecs && !audioOnly;
  if (audioOnly) notes.push('Audio-only file: the canvas engine is not used.');
  if (!webcodecsAvailable) {
    notes.push(caps.webcodecsVideo ? 'WebCodecs disabled in settings' : 'WebCodecs is not available in this browser');
  }
  if (webcodecsAvailable && lowMemory) notes.push('Low-memory device: software decoding may be slow');

  const chain: EngineKind[] = [];
  const push = (kind: EngineKind) => {
    if (!chain.includes(kind)) chain.push(kind);
  };

  const addWebcodecs = () => {
    if (webcodecsAvailable) push('webcodecs');
  };

  if (settings.enginePreference === 'webcodecs') {
    addWebcodecs();
    push('native');
    notes.push('Engine preference: WebCodecs first');
  } else if (settings.enginePreference === 'native') {
    push('native');
    addWebcodecs();
    notes.push('Engine preference: native first');
  } else if (native.supported) {
    push('native');
    addWebcodecs();
  } else {
    addWebcodecs();
    push('native');
  }

  if (chain.length === 0) chain.push('native');

  const reason =
    settings.enginePreference === 'webcodecs'
      ? 'WebCodecs requested by settings'
      : native.supported
        ? `Native playback selected — ${native.reason}`
        : `Native playback not possible (${native.reason}) — trying WebCodecs`;

  return { chain, reason, nativeSupported: native.supported, webcodecsAvailable, notes };
}
