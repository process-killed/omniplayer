/**
 * =============================================================================
 * NEXUS · AMBIENT ENGINE (bias lighting)
 * =============================================================================
 * Samples the current frame into a 12×7 canvas once per second and paints the
 * sampled colour into the app backdrop, the player edge glow and the splash.
 * Cross-origin streams that taint the canvas simply fall back to the theme
 * accent — nothing breaks.
 * =============================================================================
 */

import { Nexus, store, toast } from '../core.js';

class AmbientEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.timer = null;
    this.lastPaint = 0;
    this.enabled = Boolean(store.get('player.ambient', false));
    this.failed = false;
  }

  mount() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 12;
    this.canvas.height = 7;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.timer = setInterval(() => this.tick(), 1000);

    const off = Nexus.on('ambient:toggle', (on) => this.setEnabled(on));
    this.setEnabled(this.enabled);

    return () => {
      clearInterval(this.timer);
      off();
      this.clear();
      this.canvas = null;
      this.ctx = null;
    };
  }

  setEnabled(on) {
    this.enabled = !!on;
    const host = Nexus.player?.art?.template?.$player;
    host?.classList.toggle('ambient-glow-active', this.enabled);
    document.documentElement.classList.toggle('nx-ambient', this.enabled);
    if (!this.enabled) this.clear();
  }

  tick() {
    if (!this.enabled || this.failed) return;
    if (document.hidden) return;

    const art = Nexus.player?.art;
    const video = art?.video;
    if (!video || video.paused || video.readyState < 2) return;

    const now = Date.now();
    if (now - this.lastPaint < 900) return;
    this.lastPaint = now;

    try {
      this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      const { data } = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;

      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        // Weight mid-tones: pure black and blown-out whites carry no colour.
        const weight = 1 - Math.abs(lum - 0.5) * 1.6;
        if (weight <= 0.05) continue;
        r += data[i] * weight;
        g += data[i + 1] * weight;
        b += data[i + 2] * weight;
        count += weight;
      }

      if (!count) return;

      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      // Lift saturation a touch so the glow reads as light, not mud.
      const avg = (r + g + b) / 3;
      const boost = 1.45;
      r = Math.min(255, Math.round(avg + (r - avg) * boost));
      g = Math.min(255, Math.round(avg + (g - avg) * boost));
      b = Math.min(255, Math.round(avg + (b - avg) * boost));

      this.paint(r, g, b);
    } catch (error) {
      // Tainted canvas (CORS) — stop trying, keep the theme accent instead.
      this.failed = true;
      console.info('[Nexus] ambient sampling unavailable for this stream');
    }
  }

  paint(r, g, b) {
    const root = document.documentElement;
    root.style.setProperty('--nx-ambient', `rgb(${r}, ${g}, ${b})`);
    root.style.setProperty('--nx-ambient-soft', `rgba(${r}, ${g}, ${b}, .28)`);
    root.style.setProperty('--nx-ambient-faint', `rgba(${r}, ${g}, ${b}, .1)`);
  }

  clear() {
    const root = document.documentElement;
    root.style.removeProperty('--nx-ambient');
    root.style.removeProperty('--nx-ambient-soft');
    root.style.removeProperty('--nx-ambient-faint');
  }
}

const ambient = new AmbientEngine();

Nexus.defineFeature({
  id: 'ambient-engine',
  name: 'Soft glow',
  icon: 'sun',
  category: 'Player',
  order: 30,
  description: 'A gentle glow around the video that matches the colours on screen.',
  tags: ['glow', 'picture'],
  commands: [
    {
      id: 'toggle',
      title: 'Soft glow',
      group: 'Appearance',
      icon: 'sun',
      run: () => {
        const on = !store.get('player.ambient', false);
        store.set('player.ambient', on);
        ambient.setEnabled(on);
        toast(on ? 'Soft glow on' : 'Soft glow off', on ? 'success' : 'info', 1400);
      }
    }
  ],
  mount() {
    return ambient.mount();
  }
});

export default ambient;
