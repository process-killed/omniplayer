/**
 * =============================================================================
 * NEXUS · PLAYBACK GUARDIAN
 * =============================================================================
 * A watchdog around the media element:
 *   • a simple loading spinner while the video buffers
 *   • stall detection → gentle retry → full reload
 *   • short, plain-language messages so the viewer always knows what happened
 * =============================================================================
 */

import { Nexus, el, icon, toast, store, fmtTime } from '../core.js';

class Guardian {
  constructor() {
    this.veil = null;
    this.watch = null;
    this.lastTime = 0;
    this.stalledFor = 0;
    this.recoveries = 0;
    this.bandwidth = 0;
    this.bytes = 0;
    this.lastBytesAt = 0;
  }

  mount() {
    const offAttach = Nexus.on('player:attached', () => this.attach());
    const offDetach = Nexus.on('player:detached', () => this.detach());

    if (Nexus.player?.art) this.attach();

    this.watch = setInterval(() => this.check(), 1000);

    return () => {
      offAttach();
      offDetach();
      clearInterval(this.watch);
      this.detach();
    };
  }

  attach() {
    const art = Nexus.player?.art;
    const video = art?.video || document.querySelector('#artplayerContainer video');
    if (!video || this.video === video) return;

    this.detach();
    this.video = video;
    this.host =
      art?.template?.$player ||
      document.getElementById('artplayerContainer');
    this.lastTime = video.currentTime;
    this.recoveries = 0;

    this.buildVeil();

    this.onWaiting = () => this.showVeil('Buffering');
    this.onPlaying = () => this.hideVeil();
    this.onSeeking = () => this.showVeil('Seeking');
    this.onSeeked = () => this.hideVeil();
    this.onError = () => {
      this.hideVeil();
      toast('This stream stopped working. Try another source.', 'error', 2600);
    };

    video.addEventListener('waiting', this.onWaiting);
    video.addEventListener('playing', this.onPlaying);
    video.addEventListener('seeking', this.onSeeking);
    video.addEventListener('seeked', this.onSeeked);
    video.addEventListener('error', this.onError);

    this.measure();
  }

  detach() {
    const video = this.video;
    if (video) {
      video.removeEventListener('waiting', this.onWaiting);
      video.removeEventListener('playing', this.onPlaying);
      video.removeEventListener('seeking', this.onSeeking);
      video.removeEventListener('seeked', this.onSeeked);
      video.removeEventListener('error', this.onError);
    }
    this.hideVeil();
    this.veil?.remove();
    this.veil = null;
    this.video = null;
    this.stalledFor = 0;
  }

  buildVeil() {
    if (!this.host || this.veil) return;
    const veil = el('div', { class: 'nx-guard-veil', 'aria-hidden': 'true' });
    veil.innerHTML = `
      <div class="nx-guard-veil__core">
        <span class="nx-guard-veil__ring"></span>
        <span class="nx-guard-veil__ring nx-guard-veil__ring--b"></span>
        <span class="nx-guard-veil__ring nx-guard-veil__ring--c"></span>
      </div>
      <div class="nx-guard-veil__label"><span data-label>Buffering</span><em data-meta>0 kb/s</em></div>
    `;
    this.host.appendChild(veil);
    this.veil = veil;
    this.veilLabel = veil.querySelector('[data-label]');
    this.veilMeta = veil.querySelector('[data-meta]');
  }

  showVeil(label) {
    if (!this.veil) this.buildVeil();
    if (!this.veil) return;
    if (this.veilLabel) this.veilLabel.textContent = label || 'Buffering';
    this.veil.classList.add('is-on');
  }

  hideVeil() {
    this.veil?.classList.remove('is-on');
  }

  measure() {
    // MediaSource exposes a bandwidth estimate on hls.js; fall back to a
    // buffer-depth heuristic for native playback.
    const engine = Nexus.player?.engine;
    const hls = engine?.hls;
    if (hls?.bandwidthEstimate) this.bandwidth = hls.bandwidthEstimate;
  }

  check() {
    // Self-healing attach: works even if the Nexus HUD is disabled or the
    // player was mounted before this module booted.
    if (!this.video) {
      const found = document.querySelector('#artplayerContainer video');
      if (found) this.attach();
    }

    const video = this.video;
    if (!video) return;

    this.measure();

    if (this.veil?.classList.contains('is-on') && this.veilMeta) {
      const rate = this.bandwidth ? `${(this.bandwidth / 1000).toFixed(0)} kb/s` : 'sampling…';
      this.veilMeta.textContent = rate;
    }

    const advanced = Math.abs(video.currentTime - this.lastTime) > 0.12;
    this.lastTime = video.currentTime;

    if (!video.paused && video.readyState < 3 && !advanced) {
      this.stalledFor += 1;
    } else {
      this.stalledFor = 0;
    }

    if (this.stalledFor === 6) this.softRecover();
    if (this.stalledFor >= 12) this.hardRecover();
  }

  softRecover() {
    const art = Nexus.player?.art;
    if (!art) return;
    try {
      const target = art.currentTime;
      art.currentTime = Math.max(0, target + 0.4);
      toast('Reconnecting…', 'info', 1600);
    } catch {
      /* noop */
    }
  }

  hardRecover() {
    const engine = Nexus.player?.engine;
    const video = this.video;
    if (!video) return;

    this.recoveries += 1;
    this.stalledFor = 0;

    try {
      if (engine?.hls) {
        engine.hls.startLoad();
        engine.hls.recoverMediaError?.();
        toast('Reconnecting to the stream…', 'info', 2200);
      } else {
        const time = video.currentTime;
        const src = video.src;
        if (src) {
          video.load();
          video.currentTime = time;
          video.play().catch(() => {});
        }
      }
    } catch {
      /* noop */
    }

    if (this.recoveries === 3) {
      toast('This source keeps stopping. Try another server.', 'error', 4000);
    }
  }
}

const guardian = new Guardian();

Nexus.defineFeature({
  id: 'playback-guardian',
  name: 'Loading and retry',
  icon: 'activity',
  category: 'Player',
  order: 20,
  description: 'Shows a simple loading spinner and quietly retries when a stream stalls.',
  tags: ['loading', 'retry'],
  mount() {
    return guardian.mount();
  }
});

export default guardian;
