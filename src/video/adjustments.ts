import { clamp } from '../utils/format';

export interface VideoAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  gamma: number;
  sharpen: number;
  grayscale: number;
  sepia: number;
  invert: number;
  blur: number;
  zoom: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  panX: number;
  panY: number;
  aspect: AspectMode;
}

export type AspectMode = 'auto' | 'original' | '16:9' | '21:9' | '4:3' | '1:1' | 'fill' | 'fit' | 'cover' | 'stretch' | 'zoom';

export const DEFAULT_ADJUSTMENTS: VideoAdjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  gamma: 1,
  sharpen: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  blur: 0,
  zoom: 1,
  rotate: 0,
  flipH: false,
  flipV: false,
  panX: 0,
  panY: 0,
  aspect: 'auto',
};

export const ASPECT_PRESETS: Array<{ id: AspectMode; label: string; ratio?: number }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'original', label: 'Original' },
  { id: 'fit', label: 'Fit' },
  { id: 'fill', label: 'Fill' },
  { id: 'cover', label: 'Crop' },
  { id: 'stretch', label: 'Stretch' },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '21:9', label: '21:9', ratio: 21 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: '1:1', ratio: 1 },
];

const SHARPEN_FILTER_ID = 'op-sharpen-filter';

function ensureSharpenFilter(): void {
  if (document.getElementById(SHARPEN_FILTER_ID)) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  const filter = document.createElementNS(ns, 'filter');
  filter.setAttribute('id', SHARPEN_FILTER_ID);
  const convolve = document.createElementNS(ns, 'feConvolveMatrix');
  convolve.setAttribute('order', '3');
  convolve.setAttribute('kernelMatrix', '0 -1 0 -1 5 -1 0 -1 0');
  convolve.setAttribute('preserveAlpha', 'true');
  filter.append(convolve);
  svg.append(filter);
  document.body.append(svg);
}

/** Build a CSS filter string. Sharpening uses an SVG convolution kernel. */
export function buildFilter(adj: VideoAdjustments): string {
  const parts: string[] = [];
  if (adj.sharpen > 0) {
    ensureSharpenFilter();
    parts.push(`url(#${SHARPEN_FILTER_ID})`);
  }
  if (adj.brightness !== 1) parts.push(`brightness(${adj.brightness.toFixed(3)})`);
  if (adj.contrast !== 1) parts.push(`contrast(${adj.contrast.toFixed(3)})`);
  if (adj.saturation !== 1) parts.push(`saturate(${adj.saturation.toFixed(3)})`);
  if (adj.hue !== 0) parts.push(`hue-rotate(${adj.hue}deg)`);
  if (adj.grayscale > 0) parts.push(`grayscale(${adj.grayscale.toFixed(3)})`);
  if (adj.sepia > 0) parts.push(`sepia(${adj.sepia.toFixed(3)})`);
  if (adj.invert > 0) parts.push(`invert(${adj.invert.toFixed(3)})`);
  if (adj.blur > 0) parts.push(`blur(${adj.blur.toFixed(2)}px)`);
  return parts.join(' ') || 'none';
}

/**
 * Apply filters and geometry to the media wrapper.
 * CSS transforms keep this on the GPU — no per-frame canvas work.
 */
export function applyAdjustments(media: HTMLElement, adj: VideoAdjustments): void {
  media.style.filter = buildFilter(adj);
  const scale = adj.zoom;
  const transforms: string[] = [];
  if (adj.panX || adj.panY) transforms.push(`translate(${adj.panX}%, ${adj.panY}%)`);
  if (adj.rotate) transforms.push(`rotate(${adj.rotate}deg)`);
  const flipX = adj.flipH ? -1 : 1;
  const flipY = adj.flipV ? -1 : 1;
  if (scale !== 1 || flipX !== 1 || flipY !== 1) transforms.push(`scale(${scale * flipX}, ${scale * flipY})`);
  media.style.transform = transforms.join(' ') || 'none';
}

export function applyAspect(stage: HTMLElement, media: HTMLElement, mode: AspectMode): void {
  const preset = ASPECT_PRESETS.find((item) => item.id === mode);
  stage.dataset.fit = mode === 'cover' || mode === 'zoom' ? 'cover' : mode === 'stretch' ? 'fill' : mode === 'fit' ? 'contain' : 'contain';

  if (mode === 'fill') {
    media.style.width = '100%';
    media.style.height = '100%';
    media.style.aspectRatio = '';
    stage.dataset.fit = 'fill';
    return;
  }
  if (mode === 'stretch') {
    media.style.width = '100%';
    media.style.height = '100%';
    media.style.aspectRatio = '';
    stage.dataset.fit = 'fill';
    return;
  }
  if (mode === 'cover' || mode === 'zoom') {
    media.style.width = '100%';
    media.style.height = '100%';
    media.style.aspectRatio = '';
    stage.dataset.fit = 'cover';
    return;
  }
  if (preset?.ratio) {
    media.style.width = '100%';
    media.style.height = '100%';
    media.style.aspectRatio = '';
    // Crop into the requested ratio while keeping the frame centred.
    media.style.objectFit = 'cover';
    media.style.clipPath = 'none';
    stage.style.setProperty('--target-ratio', String(preset.ratio));
    stage.dataset.ratio = String(preset.ratio);
    media.style.aspectRatio = String(preset.ratio);
    media.style.maxHeight = '100%';
    media.style.maxWidth = '100%';
    media.style.height = 'auto';
    media.style.width = '100%';
    return;
  }
  // auto / original / fit
  media.style.aspectRatio = '';
  media.style.width = '100%';
  media.style.height = '100%';
  media.style.objectFit = 'contain';
  stage.style.removeProperty('--target-ratio');
  delete stage.dataset.ratio;
}

export function resetAdjustments(): VideoAdjustments {
  return { ...DEFAULT_ADJUSTMENTS };
}

export function nudgeZoom(adj: VideoAdjustments, delta: number): VideoAdjustments {
  return { ...adj, zoom: clamp(Number((adj.zoom + delta).toFixed(2)), 0.5, 4) };
}

export const FILTER_PRESETS: Array<{ name: string; values: Partial<VideoAdjustments> }> = [
  { name: 'None', values: {} },
  { name: 'Cinema', values: { contrast: 1.12, saturation: 1.08, brightness: 1.02, gamma: 1.05 } },
  { name: 'Vivid', values: { contrast: 1.1, saturation: 1.35, brightness: 1.03 } },
  { name: 'Warm', values: { saturation: 1.1, hue: -8, brightness: 1.05 } },
  { name: 'Cool', values: { saturation: 1.05, hue: 12, brightness: 1.02 } },
  { name: 'Noir', values: { grayscale: 1, contrast: 1.2, brightness: 0.98 } },
  { name: 'Sepia', values: { sepia: 0.85, contrast: 1.05 } },
  { name: 'Night', values: { brightness: 0.78, contrast: 1.15, saturation: 0.9 } },
  { name: 'Sharp', values: { sharpen: 1, contrast: 1.06 } },
  { name: 'Soft', values: { blur: 0.6, brightness: 1.03 } },
];
