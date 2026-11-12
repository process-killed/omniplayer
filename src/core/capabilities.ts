/** Browser capability detection used for engine selection and diagnostics. */

export interface CodecSupport {
  avc: boolean;
  hevc: boolean;
  av1: boolean;
  vp9: boolean;
  vp8: boolean;
  mpeg2: boolean;
  aac: boolean;
  mp3: boolean;
  opus: boolean;
  flac: boolean;
  ac3: boolean;
  eac3: boolean;
}

export interface BrowserCapabilities {
  webcodecsVideo: boolean;
  webcodecsAudio: boolean;
  mse: boolean;
  hlsNative: boolean;
  dashMse: boolean;
  mediaCapabilities: boolean;
  wasm: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  webgl2: boolean;
  offscreenCanvas: boolean;
  fileSystemAccess: boolean;
  pictureInPicture: boolean;
  remotePlayback: boolean;
  webAudio: boolean;
  indexedDB: boolean;
  serviceWorker: boolean;
  wakeLock: boolean;
  screenOrientation: boolean;
  deviceMemory?: number;
  hardwareConcurrency: number;
  maxTouchPoints: number;
  codecs: CodecSupport;
  browser: { name: string; version: string; engine: string };
  os: string;
  isMobile: boolean;
  isIOS: boolean;
  isSafari: boolean;
  isFirefox: boolean;
  isChromium: boolean;
  lowMemory: boolean;
}

function mediaSourceSupported(type: string): boolean {
  try {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
  } catch {
    return false;
  }
}

function parseBrowser(): { name: string; version: string; engine: string } {
  const ua = navigator.userAgent;
  const match = (re: RegExp) => re.exec(ua)?.[1] ?? '';
  if (/Edg\//.test(ua)) return { name: 'Edge', version: match(/Edg\/([\d.]+)/), engine: 'Blink' };
  if (/OPR\//.test(ua)) return { name: 'Opera', version: match(/OPR\/([\d.]+)/), engine: 'Blink' };
  if (/SamsungBrowser/.test(ua)) return { name: 'Samsung Internet', version: match(/SamsungBrowser\/([\d.]+)/), engine: 'Blink' };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', version: match(/Firefox\/([\d.]+)/), engine: 'Gecko' };
  if (/CriOS\//.test(ua)) return { name: 'Chrome (iOS)', version: match(/CriOS\/([\d.]+)/), engine: 'WebKit' };
  if (/Chrome\//.test(ua)) return { name: 'Chrome', version: match(/Chrome\/([\d.]+)/), engine: 'Blink' };
  if (/Safari\//.test(ua)) return { name: 'Safari', version: match(/Version\/([\d.]+)/), engine: 'WebKit' };
  return { name: 'Unknown browser', version: '', engine: 'Unknown' };
}

function parseOS(): string {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return `Android ${(/Android ([\d.]+)/.exec(ua)?.[1] ?? '')}`.trim();
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS / iPadOS';
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown OS';
}

let cached: BrowserCapabilities | null = null;

export function detectCapabilities(): BrowserCapabilities {
  if (cached) return cached;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { platform?: string; mobile?: boolean };
  };
  const ua = navigator.userAgent;
  const browser = parseBrowser();
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari\//.test(ua) && !/Chrome|CriOS|Edg|OPR|Firefox|Android/.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  const isChromium = /Chrome|CriOS|Edg|OPR/.test(ua);

  const codecs: CodecSupport = {
    avc: mediaSourceSupported('video/mp4; codecs="avc1.42E01E"') || mediaSourceSupported('video/mp4; codecs="avc1.4D401E"'),
    hevc:
      mediaSourceSupported('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
      mediaSourceSupported('video/mp4; codecs="hev1.1.6.L93.B0"'),
    av1: mediaSourceSupported('video/mp4; codecs="av01.0.05M.08"') || mediaSourceSupported('video/webm; codecs="av01.0.05M.08"'),
    vp9: mediaSourceSupported('video/webm; codecs="vp09.00.10.08"'),
    vp8: mediaSourceSupported('video/webm; codecs="vp8"'),
    mpeg2: mediaSourceSupported('video/mp2t; codecs="mp2v"'),
    aac: mediaSourceSupported('audio/mp4; codecs="mp4a.40.2"'),
    mp3: mediaSourceSupported('audio/mpeg'),
    opus: mediaSourceSupported('audio/webm; codecs="opus"'),
    flac: mediaSourceSupported('audio/flac') || mediaSourceSupported('audio/mp4; codecs="flac"'),
    ac3: mediaSourceSupported('audio/mp4; codecs="ac-3"'),
    eac3: mediaSourceSupported('audio/mp4; codecs="ec-3"'),
  };

  const deviceMemory = nav.deviceMemory;
  const hardwareConcurrency = navigator.hardwareConcurrency || 4;

  cached = {
    webcodecsVideo: typeof window !== 'undefined' && 'VideoDecoder' in window,
    webcodecsAudio: typeof window !== 'undefined' && 'AudioDecoder' in window,
    mse: typeof MediaSource !== 'undefined',
    hlsNative: !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'),
    dashMse: mediaSourceSupported('video/mp4; codecs="avc1.42E01E"'),
    mediaCapabilities: typeof navigator.mediaCapabilities !== 'undefined',
    wasm: typeof WebAssembly === 'object',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    webgl2: (() => {
      try {
        return !!document.createElement('canvas').getContext('webgl2');
      } catch {
        return false;
      }
    })(),
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    fileSystemAccess: 'showOpenFilePicker' in window,
    pictureInPicture: typeof document !== 'undefined' && 'pictureInPictureEnabled' in document,
    remotePlayback: 'remote' in HTMLMediaElement.prototype,
    webAudio: typeof AudioContext !== 'undefined' || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined',
    serviceWorker: 'serviceWorker' in navigator,
    wakeLock: 'wakeLock' in navigator,
    screenOrientation: 'orientation' in screen,
    deviceMemory,
    hardwareConcurrency,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    codecs,
    browser,
    os: nav.userAgentData?.platform || parseOS(),
    isMobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/.test(ua),
    isIOS,
    isSafari,
    isFirefox,
    isChromium,
    lowMemory: (deviceMemory !== undefined && deviceMemory <= 3) || hardwareConcurrency <= 4,
  };
  return cached;
}

/** Ask the browser whether a specific type decodes, and how (hardware vs software). */
export async function decodingInfo(
  mime: string,
  width = 1920,
  height = 1080,
  framerate = 30,
): Promise<{ supported: boolean; smooth: boolean; powerEfficient: boolean } | null> {
  const caps = detectCapabilities();
  if (!caps.mediaCapabilities) return null;
  try {
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: 'file',
      video: { contentType: mime, width, height, bitrate: 8_000_000, framerate },
    });
    return {
      supported: info.supported,
      smooth: info.smooth,
      powerEfficient: info.powerEfficient,
    };
  } catch {
    return null;
  }
}

export function describeSupport(supported: boolean): string {
  return supported ? 'Supported' : 'Not supported';
}

/** Rough idea of whether software decoding will be usable on this device. */
export function softwareDecodeViable(): boolean {
  const caps = detectCapabilities();
  if (!caps.webcodecsVideo) return false;
  if (caps.lowMemory) return false;
  return true;
}

export function capabilityReport(): Array<{ label: string; value: string; ok?: boolean }> {
  const c = detectCapabilities();
  return [
    { label: 'Browser', value: `${c.browser.name} ${c.browser.version} (${c.browser.engine})` },
    { label: 'Operating system', value: c.os },
    { label: 'Media Source Extensions', value: describeSupport(c.mse), ok: c.mse },
    { label: 'WebCodecs video decoding', value: describeSupport(c.webcodecsVideo), ok: c.webcodecsVideo },
    { label: 'WebCodecs audio decoding', value: describeSupport(c.webcodecsAudio), ok: c.webcodecsAudio },
    { label: 'Native HLS', value: describeSupport(c.hlsNative), ok: c.hlsNative },
    { label: 'Media Capabilities API', value: describeSupport(c.mediaCapabilities), ok: c.mediaCapabilities },
    { label: 'Web Audio API', value: describeSupport(c.webAudio), ok: c.webAudio },
    { label: 'Picture-in-Picture', value: describeSupport(c.pictureInPicture), ok: c.pictureInPicture },
    { label: 'WebAssembly', value: describeSupport(c.wasm), ok: c.wasm },
    { label: 'SharedArrayBuffer', value: describeSupport(c.sharedArrayBuffer), ok: c.sharedArrayBuffer },
    { label: 'Cross-origin isolated', value: describeSupport(c.crossOriginIsolated), ok: c.crossOriginIsolated },
    { label: 'Logical cores', value: String(c.hardwareConcurrency) },
    { label: 'Device memory', value: c.deviceMemory ? `${c.deviceMemory} GB` : 'Not exposed' },
    { label: 'Touch points', value: String(c.maxTouchPoints) },
    { label: 'Low-memory device', value: c.lowMemory ? 'Yes' : 'No' },
  ];
}
