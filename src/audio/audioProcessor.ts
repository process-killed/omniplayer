import { EQ_FREQUENCIES } from '../storage/settings';

/**
 * Web Audio processing chain.
 *
 *   media element / decoder → input → EQ bands → bass → compressor
 *     → mono → delay → balance → master gain → speakers
 *
 * The chain is only attached to a <video> when the browser can read its audio
 * without tainting (same-origin, CORS-enabled or blob:). Otherwise the element
 * plays natively and the EQ panel explains why effects are unavailable.
 */
export class AudioProcessor {
  private ctx: AudioContext | null = null;
  private inputGain: GainNode | null = null;
  private preamp: GainNode | null = null;
  private bands: BiquadFilterNode[] = [];
  private bassShelf: BiquadFilterNode | null = null;
  private trebleShelf: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private monoNode: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private panner: StereoPannerNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private attachedElement: HTMLMediaElement | null = null;
  private eqEnabled = false;
  private volume = 1;
  private muted = false;
  private analyserBuffer: Uint8Array<ArrayBuffer> | null = null;

  get context(): AudioContext | null {
    return this.ctx;
  }

  get isReady(): boolean {
    return !!this.ctx;
  }

  get graphAttached(): boolean {
    return !!this.attachedElement;
  }

  /** Lazily create the graph. Must be called from a user gesture on iOS. */
  ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor({ latencyHint: 'playback' });
      this.ctx = ctx;
      this.build(ctx);
      return ctx;
    } catch {
      return null;
    }
  }

  private build(ctx: AudioContext): void {
    this.inputGain = ctx.createGain();
    this.preamp = ctx.createGain();
    this.bassShelf = ctx.createBiquadFilter();
    this.bassShelf.type = 'lowshelf';
    this.bassShelf.frequency.value = 120;
    this.trebleShelf = ctx.createBiquadFilter();
    this.trebleShelf.type = 'highshelf';
    this.trebleShelf.frequency.value = 9000;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.25;
    this.monoNode = ctx.createGain();
    this.monoNode.channelCount = 2;
    this.monoNode.channelCountMode = 'max';
    this.delayNode = ctx.createDelay(3);
    this.delayNode.delayTime.value = 0;
    this.panner = ctx.createStereoPanner();
    this.masterGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyserBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    this.bands = EQ_FREQUENCIES.map((frequency) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });

    let node: AudioNode = this.inputGain;
    node.connect(this.preamp);
    node = this.preamp;
    for (const band of this.bands) {
      node.connect(band);
      node = band;
    }
    node.connect(this.bassShelf);
    this.bassShelf.connect(this.trebleShelf);
    this.trebleShelf.connect(this.compressor);
    this.compressor.connect(this.monoNode);
    this.monoNode.connect(this.delayNode);
    this.delayNode.connect(this.panner);
    this.panner.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.applyVolume();
    this.setEqEnabled(this.eqEnabled);
  }

  /** Input node for engines that generate audio themselves (WebCodecs). */
  get input(): AudioNode | null {
    return this.inputGain;
  }

  async resume(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* iOS may still refuse until a gesture */
      }
    }
  }

  attachMediaElement(element: HTMLMediaElement): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.inputGain) return false;
    if (this.attachedElement === element) return true;
    this.detachMediaElement();
    try {
      let source = this.elementSources.get(element);
      if (!source) {
        source = ctx.createMediaElementSource(element);
        this.elementSources.set(element, source);
      }
      source.connect(this.inputGain);
      this.attachedElement = element;
      // The graph now owns the level; keep the element at unity.
      element.volume = 1;
      this.applyVolume();
      return true;
    } catch {
      return false;
    }
  }

  detachMediaElement(): void {
    if (!this.attachedElement) return;
    const source = this.elementSources.get(this.attachedElement);
    try {
      source?.disconnect();
    } catch {
      /* ignore */
    }
    this.attachedElement = null;
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.masterGain || !this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
    // Visible in Diagnostics and useful when a user reports “no sound”.
    document.documentElement.dataset.audioGain = target.toFixed(2);
  }

  setEqEnabled(enabled: boolean): void {
    this.eqEnabled = enabled;
    if (!this.ctx) return;
    const time = this.ctx.currentTime;
    for (const band of this.bands) {
      band.gain.setTargetAtTime(enabled ? band.gain.value : 0, time, 0.02);
    }
  }

  setEqGains(gains: number[], enabled: boolean): void {
    this.eqEnabled = enabled;
    if (!this.ctx) return;
    const time = this.ctx.currentTime;
    this.bands.forEach((band, index) => {
      const value = enabled ? (gains[index] ?? 0) : 0;
      band.gain.setTargetAtTime(value, time, 0.02);
    });
  }

  setBassBoost(db: number): void {
    if (!this.ctx || !this.bassShelf) return;
    this.bassShelf.gain.setTargetAtTime(db, this.ctx.currentTime, 0.02);
  }

  setTreble(db: number): void {
    if (!this.ctx || !this.trebleShelf) return;
    this.trebleShelf.gain.setTargetAtTime(db, this.ctx.currentTime, 0.02);
  }

  setBalance(balance: number): void {
    if (!this.ctx || !this.panner) return;
    this.panner.pan.setTargetAtTime(Math.min(1, Math.max(-1, balance)), this.ctx.currentTime, 0.02);
  }

  setMono(mono: boolean): void {
    if (!this.ctx || !this.monoNode) return;
    this.monoNode.channelCount = mono ? 1 : 2;
    this.monoNode.channelCountMode = mono ? 'explicit' : 'max';
  }

  setNormalize(normalize: boolean): void {
    if (!this.ctx || !this.compressor) return;
    const time = this.ctx.currentTime;
    // Bypass by making the compressor effectively transparent.
    this.compressor.threshold.setTargetAtTime(normalize ? -18 : 0, time, 0.02);
    this.compressor.ratio.setTargetAtTime(normalize ? 3 : 1, time, 0.02);
    this.compressor.knee.setTargetAtTime(normalize ? 24 : 0, time, 0.02);
  }

  setDelayMs(ms: number): void {
    if (!this.ctx || !this.delayNode) return;
    const seconds = Math.min(3, Math.max(0, ms / 1000));
    this.delayNode.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.05);
  }

  /** Live spectrum data for the optional visualiser (0–255 per bin). */
  getSpectrum(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser || !this.analyserBuffer) return null;
    this.analyser.getByteFrequencyData(this.analyserBuffer);
    return this.analyserBuffer;
  }

  async suspend(): Promise<void> {
    if (this.ctx?.state === 'running') {
      try {
        await this.ctx.suspend();
      } catch {
        /* ignore */
      }
    }
  }

  async close(): Promise<void> {
    this.detachMediaElement();
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.bands = [];
  }
}

export const audioProcessor = new AudioProcessor();
