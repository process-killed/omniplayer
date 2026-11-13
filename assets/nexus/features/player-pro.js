/**
 * =============================================================================
 * NEXUS · PLAYER — clean, familiar player settings for ArtPlayer
 * =============================================================================
 * Attaches a light HUD, one simple settings panel (speed, subtitles, timer,
 * repeat, picture, quality, more), touch gestures, screenshots, picture-in-
 * picture, mini player and an optional stats panel.
 *
 * It never replaces the ArtPlayer engine — it decorates the live instance,
 * so every existing control, hotkey and recovery path keeps working.
 *
 * Public surface (used by player/player.js):
 *   window.Nexus.playerHud.attach(engine, art, meta)
 *   window.Nexus.playerHud.detach(engine)
 * =============================================================================
 */

import {
  Nexus,
  store,
  toast,
  icon,
  el,
  clamp,
  fmtTime,
  fmtBytes,
  debounce,
  registerHotkey
} from '../core.js';

const ASPECTS = ['default', '16:9', '4:3', 'fill', 'cover'];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SUB_COLORS = [
  { id: 'amber', hex: '#ffb703' },
  { id: 'white', hex: '#ffffff' },
  { id: 'cyan', hex: '#7ef0ff' },
  { id: 'lime', hex: '#b8ff5c' },
  { id: 'pink', hex: '#ff9ecb' }
];

function h(tag, attrs, html) {
  return el(tag, attrs, html);
}

/* --------------------------------------------------------------------------
 * Small UI atoms
 * ------------------------------------------------------------------------ */

function row(label, control, hint = '') {
  const node = h('div', { class: 'nxp-row' });
  node.appendChild(
    h('div', { class: 'nxp-row__label' }, `<span>${label}</span>${hint ? `<em>${hint}</em>` : ''}`)
  );
  node.appendChild(control);
  return node;
}

function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'nxp-seg', role: 'group' });
  for (const option of options) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: `nxp-seg__btn${String(option.value) === String(value) ? ' is-on' : ''}`,
        title: option.title || option.label
      },
      option.label
    );
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.nxp-seg__btn').forEach((node) => node.classList.remove('is-on'));
      btn.classList.add('is-on');
      onChange(option.value);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function slider({ min, max, step, value, onInput, format }) {
  const wrap = h('div', { class: 'nxp-slider' });
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    'aria-label': 'value'
  });
  const out = h('span', { class: 'nxp-slider__value' }, format ? format(value) : String(value));

  const paint = () => {
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--nxp-fill', `${clamp(pct, 0, 100)}%`);
    out.textContent = format ? format(Number(input.value)) : input.value;
  };

  input.addEventListener('input', () => {
    paint();
    onInput(Number(input.value));
  });

  paint();
  wrap.append(input, out);
  return wrap;
}

function toggleRow(label, value, onChange, hint) {
  const btn = h('button', {
    type: 'button',
    class: `nxp-switch${value ? ' is-on' : ''}`,
    role: 'switch',
    'aria-checked': String(!!value)
  }, '<span class="nxp-switch__dot"></span>');

  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('is-on');
    btn.classList.toggle('is-on', next);
    btn.setAttribute('aria-checked', String(next));
    onChange(next);
  });

  return row(label, btn, hint);
}

function sectionTitle(label) {
  return h('div', { class: 'nxp-section-title' }, label);
}

/* --------------------------------------------------------------------------
 * ProHud
 * ------------------------------------------------------------------------ */

class ProHud {
  constructor(engine, art, meta = {}) {
    this.engine = engine;
    this.art = art;
    this.meta = meta;
    this.root = null;
    this.sheet = null;
    this.disposers = [];
    this.interval = null;
    this.ab = { a: null, b: null };
    this.sleepAt = 0;
    this.zen = false;
    this.telemetry = { samples: [], fps: 0, dropped: 0, bitrate: 0 };
    this.lastBytes = 0;
    this.lastBytesAt = 0;
    this.subPrefs = {
      size: Number(store.get('player.subtitleScale', 100)) || 100,
      color: store.get('player.subColor', '#ffb703'),
      bg: Number(store.get('player.subBg', 55)),
      delay: 0
    };
    this.videoFx = { brightness: 100, contrast: 100, saturation: 100, zoom: 1 };
    this.aspect = 'default';
    this._longPressTimer = null;
    this._gesture = null;
    this._pinch = null;
    this._rateBeforeHold = null;
  }

  /* ---------------------------------------------------------------- build */

  attach() {
    const host = this.art?.template?.$player || this.art?.template?.$container;
    if (!host) return false;
    if (host.querySelector('[data-nxp]')) return true;

    this.host = host;
    host.classList.add('nxp-host');

    this.root = h('div', { class: 'nxp', 'data-nxp': 'overlay' });
    this.root.innerHTML = `
      <div class="nxp-top">
        <div class="nxp-top__right">
          <span class="nxp-chip" data-nxp-quality>HD</span>
        </div>
      </div>

      <div class="nxp-hint" data-nxp-hint>
        <span class="nxp-hint__icon"></span>
        <span class="nxp-hint__text"></span>
      </div>

      <div class="nxp-ripple nxp-ripple--back" data-nxp-ripple-back>${icon('skip-back', 26)}</div>
      <div class="nxp-ripple nxp-ripple--fwd" data-nxp-ripple-fwd>${icon('skip-forward', 26)}</div>

      <div class="nxp-badges">
        <span class="nxp-badge" data-nxp-speed hidden></span>
        <span class="nxp-badge nxp-badge--loop" data-nxp-loop hidden></span>
        <span class="nxp-badge nxp-badge--sleep" data-nxp-sleep hidden></span>
      </div>
    `;

    host.appendChild(this.root);

    this.buildSheet();
    this.buildControls();
    this.bindGestures();
    this.bindPlayerEvents();
    this.bindHotkeys();
    this.applySubtitleStyle();
    this.startTick();

    Nexus.player = { art: this.art, engine: this.engine, hud: this };
    Nexus.emit('player:attached', Nexus.player);
    return true;
  }

  buildControls() {
    const art = this.art;
    if (!art?.controls?.add) return;

    const add = (name, position, html, tooltip, click, index) => {
      try {
        art.controls.add({ name, position, html, tooltip, click, index });
      } catch (error) {
        console.debug('[Nexus] control add failed', name, error);
      }
    };

    add(
      'nxpSpeed',
      'right',
      `<span class="nxp-ctrl nxp-ctrl--speed" data-nxp-speed-btn>1×</span>`,
      'Playback speed',
      () => this.openSheet(),
      2
    );

    add(
      'nxpDeck',
      'right',
      `<span class="nxp-ctrl">${icon('sliders', 18)}</span>`,
      'Settings',
      () => this.toggleSheet(),
      3
    );

    add(
      'nxpStats',
      'right',
      `<span class="nxp-ctrl">${icon('activity', 18)}</span>`,
      'Stats for nerds',
      () => this.toggleStats(),
      4
    );

    add(
      'nxpShot',
      'right',
      `<span class="nxp-ctrl">${icon('camera', 18)}</span>`,
      'Screenshot (S)',
      () => this.screenshot(),
      5
    );

    this.speedBtn = this.host.querySelector('[data-nxp-speed-btn]');
    this.syncSpeedChip();
  }

  /* ---------------------------------------------------------------- sheet */

  buildSheet() {
    const sheet = h('div', {
      class: 'nxp-sheet',
      'data-nxp': 'sheet',
      role: 'dialog',
      'aria-label': 'Player settings'
    });

    sheet.innerHTML = `
      <div class="nxp-sheet__head">
        <span class="nxp-sheet__title">Settings</span>
        <button class="nxp-sheet__close" type="button" aria-label="Close settings">${icon('x', 18)}</button>
      </div>
      <div class="nxp-sheet__body"></div>
    `;

    sheet.querySelector('.nxp-sheet__close').addEventListener('click', () => this.closeSheet());

    this.host.appendChild(sheet);
    this.sheet = sheet;
    this.sheetBody = sheet.querySelector('.nxp-sheet__body');
    this.renderAll();

    this.onDocPointer = (event) => {
      if (!sheet.classList.contains('is-open')) return;
      if (event.target.closest('.nxp-sheet, .art-control-nxpDeck')) return;
      this.closeSheet();
    };
    document.addEventListener('pointerdown', this.onDocPointer, true);
    this.disposers.push(() =>
      document.removeEventListener('pointerdown', this.onDocPointer, true)
    );
  }

  openSheet() {
    if (!this.sheet) return;
    this.renderAll();
    this.sheet.classList.add('is-open');
    this.sheet.setAttribute('aria-hidden', 'false');
    Nexus.emit('player:sheet', { open: true });
  }

  closeSheet() {
    this.sheet?.classList.remove('is-open');
    this.sheet?.setAttribute('aria-hidden', 'true');
  }

  toggleSheet() {
    if (!this.sheet) return;
    if (this.sheet.classList.contains('is-open')) this.closeSheet();
    else this.openSheet();
  }

  /** Rebuild the whole panel. One list, no tabs — nothing to learn. */
  renderAll() {
    const body = this.sheetBody;
    if (!body) return;
    const scroll = body.scrollTop;
    body.replaceChildren();

    this.sectionSpeed(body);
    this.sectionCaptions(body);
    this.sectionTiming(body);
    this.sectionPicture(body);
    this.sectionQuality(body);
    this.sectionMore(body);

    body.scrollTop = scroll;
  }

  renderTab() {
    this.renderAll();
  }

  sectionSpeed(body) {
    const art = this.art;
    const current = Number(art.playbackRate) || 1;

    body.appendChild(sectionTitle('Playback speed'));
    body.appendChild(
      segmented(
        SPEEDS.map((rate) => ({ label: `${rate}×`, value: rate })),
        current,
        (rate) => {
          this.setRate(rate);
          this.renderAll();
        }
      )
    );

    body.appendChild(
      row(
        'Custom',
        slider({
          min: 0.25,
          max: 3,
          step: 0.05,
          value: current,
          onInput: (value) => this.setRate(value),
          format: (value) => `${value.toFixed(2)}×`
        })
      )
    );

    body.appendChild(
      toggleRow(
        'Keep voices natural',
        store.get('player.keepPitch', true),
        (on) => {
          store.set('player.keepPitch', on);
          try {
            art.video.preservesPitch = on;
            art.video.mozPreservesPitch = on;
            art.video.webkitPreservesPitch = on;
          } catch {
            /* older engines */
          }
        }
      )
    );
  }

  sectionCaptions(body) {
    body.appendChild(sectionTitle('Subtitles'));

    body.appendChild(
      row(
        'Size',
        slider({
          min: 70,
          max: 200,
          step: 5,
          value: this.subPrefs.size,
          onInput: (value) => {
            this.subPrefs.size = value;
            store.set('player.subtitleScale', value);
            this.applySubtitleStyle();
          },
          format: (value) => `${value}%`
        })
      )
    );

    const swatchRow = h('div', { class: 'nxp-row' });
    swatchRow.appendChild(h('div', { class: 'nxp-row__label' }, '<span>Colour</span>'));
    const swatches = h('div', { class: 'nxp-swatches' });
    for (const color of SUB_COLORS) {
      const dot = h('button', {
        type: 'button',
        class: `nxp-swatch${this.subPrefs.color === color.hex ? ' is-on' : ''}`,
        style: { background: color.hex },
        title: color.id,
        'aria-label': color.id
      });
      dot.addEventListener('click', () => {
        this.subPrefs.color = color.hex;
        store.set('player.subColor', color.hex);
        this.applySubtitleStyle();
        this.renderAll();
      });
      swatches.appendChild(dot);
    }
    swatchRow.appendChild(swatches);
    body.appendChild(swatchRow);

    body.appendChild(
      row(
        'Background',
        slider({
          min: 0,
          max: 90,
          step: 5,
          value: this.subPrefs.bg,
          onInput: (value) => {
            this.subPrefs.bg = value;
            store.set('player.subBg', value);
            this.applySubtitleStyle();
          },
          format: (value) => `${value}%`
        })
      )
    );

    body.appendChild(
      row(
        'Sync',
        slider({
          min: -5,
          max: 5,
          step: 0.1,
          value: this.subPrefs.delay,
          onInput: (value) => {
            this.subPrefs.delay = value;
            this.applySubtitleDelay(value);
          },
          format: (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}s`
        }),
        'Delay in seconds'
      )
    );
  }

  sectionTiming(body) {
    body.appendChild(sectionTitle('Sleep timer'));
    body.appendChild(
      segmented(
        [
          { label: 'Off', value: 0 },
          { label: '15 min', value: 15 },
          { label: '30 min', value: 30 },
          { label: '45 min', value: 45 },
          { label: '1 hour', value: 60 }
        ],
        this.sleepAt ? Math.round((this.sleepAt - Date.now()) / 60000) : 0,
        (minutes) => {
          this.setSleep(minutes);
          this.renderAll();
        }
      )
    );

    body.appendChild(sectionTitle('Repeat a section'));
    const loopRow = h('div', { class: 'nxp-btnrow' });
    const aBtn = h('button', { class: 'nxp-btn', type: 'button' }, 'Mark start');
    const bBtn = h('button', { class: 'nxp-btn', type: 'button' }, 'Mark end');
    const cBtn = h('button', { class: 'nxp-btn nxp-btn--ghost', type: 'button' }, 'Turn off');

    aBtn.textContent = this.ab.a == null ? 'Mark start' : `Start ${fmtTime(this.ab.a)}`;
    bBtn.textContent = this.ab.b == null ? 'Mark end' : `End ${fmtTime(this.ab.b)}`;
    aBtn.classList.toggle('is-on', this.ab.a != null);
    bBtn.classList.toggle('is-on', this.ab.b != null);

    aBtn.addEventListener('click', () => {
      this.ab.a = Number(this.art.currentTime) || 0;
      if (this.ab.b != null && this.ab.b <= this.ab.a) this.ab.b = null;
      this.syncLoopBadge();
      this.renderAll();
      toast(`Start set at ${fmtTime(this.ab.a)}`, 'success');
    });

    bBtn.addEventListener('click', () => {
      const time = Number(this.art.currentTime) || 0;
      if (this.ab.a != null && time <= this.ab.a) {
        toast('Pick a point after the start', 'error');
        return;
      }
      this.ab.b = time;
      this.syncLoopBadge();
      this.renderAll();
      toast(`Looping ${fmtTime(this.ab.a || 0)} – ${fmtTime(time)}`, 'success');
    });

    cBtn.addEventListener('click', () => {
      this.ab = { a: null, b: null };
      this.syncLoopBadge();
      this.renderAll();
    });

    loopRow.append(aBtn, bBtn, cBtn);
    body.appendChild(loopRow);

    body.appendChild(
      toggleRow(
        'Play next episode automatically',
        store.get('player.autoplayNext', true),
        (on) => store.set('player.autoplayNext', on)
      )
    );

    body.appendChild(
      toggleRow(
        'Skip openings automatically',
        Boolean(this.engine.autoSkipEnabled),
        (on) => {
          this.engine.autoSkipEnabled = on;
          try {
            store.set('player.skipIntro', on);
          } catch {
            /* noop */
          }
        }
      )
    );
  }

  sectionPicture(body) {
    body.appendChild(sectionTitle('Picture'));
    body.appendChild(
      segmented(
        [
          { label: 'Fit', value: 'default' },
          { label: 'Stretch', value: 'fill' },
          { label: 'Crop', value: 'cover' },
          { label: '16:9', value: '16:9' },
          { label: '4:3', value: '4:3' }
        ],
        this.aspect,
        (value) => this.setAspect(value)
      )
    );

    const fx = [
      ['brightness', 'Brightness', 50, 150],
      ['contrast', 'Contrast', 50, 150],
      ['saturation', 'Colour', 0, 200]
    ];

    for (const [key, label, min, max] of fx) {
      body.appendChild(
        row(
          label,
          slider({
            min,
            max,
            step: 1,
            value: this.videoFx[key],
            onInput: (value) => {
              this.videoFx[key] = value;
              this.applyVideoFx();
            },
            format: (value) => `${value}%`
          })
        )
      );
    }

    body.appendChild(
      row(
        'Zoom',
        slider({
          min: 100,
          max: 200,
          step: 5,
          value: this.videoFx.zoom * 100,
          onInput: (value) => {
            this.videoFx.zoom = value / 100;
            this.applyVideoFx();
          },
          format: (value) => `${value}%`
        })
      )
    );

    const reset = h('button', { class: 'nxp-btn nxp-btn--ghost', type: 'button' }, 'Reset picture');
    reset.addEventListener('click', () => {
      this.videoFx = { brightness: 100, contrast: 100, saturation: 100, zoom: 1 };
      this.aspect = 'default';
      this.applyVideoFx();
      this.setAspect('default');
      this.renderAll();
    });
    body.appendChild(reset);

    body.appendChild(
      toggleRow(
        'Soft glow around the video',
        Boolean(this.engine.ambientEnabled),
        (on) => {
          this.engine.ambientEnabled = on;
          try {
            store.set('player.ambient', on);
          } catch {
            /* noop */
          }
          this.host.classList.toggle('ambient-glow-active', on);
          Nexus.emit('ambient:toggle', on);
        }
      )
    );
  }

  sectionQuality(body) {
    const levels = this.qualityLevels();
    if (levels.length < 2) return;

    body.appendChild(sectionTitle('Quality'));
    body.appendChild(
      segmented(
        levels.map((level) => ({ label: level.label, value: level.value })),
        levels.find((level) => level.active)?.value ?? -1,
        (value) => this.setLevel(value)
      )
    );
  }

  sectionMore(body) {
    body.appendChild(sectionTitle('More'));
    const actions = h('div', { class: 'nxp-btnrow nxp-btnrow--wrap' });

    const mk = (label, glyph, fn) => {
      const btn = h('button', { class: 'nxp-btn', type: 'button' }, `${icon(glyph, 14)} ${label}`);
      btn.addEventListener('click', fn);
      return btn;
    };

    actions.append(
      mk('Save frame', 'camera', () => this.screenshot()),
      mk('Picture-in-picture', 'pip', () => this.pip()),
      mk('Mini player', 'minimize', () => this.miniPlayer()),
      mk('Full screen', 'maximize', () => {
        try {
          this.art.fullscreen = !this.art.fullscreen;
        } catch {
          /* noop */
        }
      }),
      mk('Stats for nerds', 'activity', () => this.toggleStats()),
      mk('Copy details', 'copy', () => this.copyDiagnostics())
    );

    body.appendChild(actions);
    body.appendChild(
      h('p', { class: 'nxp-note' }, 'Tip: double-tap the video to skip 10 seconds.')
    );
  }

  /* ------------------------------------------------------------ behaviours */

  setRate(rate) {
    const value = clamp(Number(rate) || 1, 0.25, 3);
    try {
      this.art.playbackRate = value;
    } catch {
      /* noop */
    }
    if (store.get('player.rememberSpeed', true)) store.set('player.defaultRate', value);
    this.syncSpeedChip();
  }

  syncSpeedChip() {
    const rate = Number(this.art?.playbackRate) || 1;
    const label = `${Number(rate.toFixed(2))}×`;
    if (this.speedBtn) this.speedBtn.textContent = label;
    const badge = this.root?.querySelector('[data-nxp-speed]');
    if (badge) {
      badge.hidden = Math.abs(rate - 1) < 0.01;
      badge.textContent = `${label} SPEED`;
    }
  }

  setAspect(value) {
    const video = this.art.video;
    if (!video) return;
    this.aspect = value;
    try {
      if (value === 'default') {
        this.art.aspectRatio = '';
        video.style.objectFit = 'contain';
        video.style.transform = `scale(${this.videoFx.zoom})`;
      } else if (value === 'fill') {
        video.style.objectFit = 'fill';
      } else if (value === 'cover') {
        video.style.objectFit = 'cover';
      } else {
        this.art.aspectRatio = value;
      }
      toast(`Framing: ${value === 'default' ? 'Fit' : value}`, 'info', 1400);
    } catch (error) {
      console.debug('[Nexus] aspect', error);
    }
  }

  applyVideoFx() {
    const video = this.art.video;
    if (!video) return;
    const { brightness, contrast, saturation, zoom } = this.videoFx;
    video.style.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    video.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
    video.style.transformOrigin = 'center center';
    video.style.willChange = zoom === 1 ? '' : 'transform';
  }

  applySubtitleStyle() {
    let style = document.getElementById('nxpSubtitleStyle');
    if (!style) {
      style = h('style', { id: 'nxpSubtitleStyle' });
      document.head.appendChild(style);
    }
    const { size, color, bg } = this.subPrefs;
    const px = Math.round((size / 100) * 22);
    style.textContent = `
      .art-video-player .art-subtitle,
      .art-video-player .art-subtitle span,
      .art-video-player video::cue {
        font-size: ${px}px !important;
        color: ${color} !important;
        background-color: rgba(3, 5, 10, ${(bg / 100).toFixed(2)}) !important;
        text-shadow: 0 2px 6px rgba(0,0,0,.9) !important;
        border-radius: 6px;
        padding: 1px 6px;
      }
      .art-video-player .art-subtitle { bottom: 78px !important; }
    `;
  }

  applySubtitleDelay(seconds) {
    const video = this.art.video;
    const track = video?.textTracks?.[0];
    if (!track?.cues) return;
    try {
      for (const cue of track.cues) {
        if (cue.__nxpShifted === undefined) {
          cue.__nxpBase = { start: cue.startTime, end: cue.endTime };
          cue.__nxpShifted = true;
        }
        const base = cue.__nxpBase;
        cue.startTime = Math.max(0, base.start + seconds);
        cue.endTime = Math.max(0.1, base.end + seconds);
      }
    } catch (error) {
      console.debug('[Nexus] subtitle delay', error);
      toast('This caption track cannot be re-timed', 'error');
    }
  }

  setSleep(minutes) {
    clearTimeout(this._sleepTimer);
    const value = Number(minutes) || 0;
    const badge = this.root?.querySelector('[data-nxp-sleep]');

    if (!value) {
      this.sleepAt = 0;
      if (badge) badge.hidden = true;
      toast('Sleep timer off', 'info', 1200);
      return;
    }

    this.sleepAt = Date.now() + value * 60000;
    if (badge) {
      badge.hidden = false;
      badge.textContent = `SLEEP ${value}m`;
    }

    this._sleepTimer = setTimeout(() => this.fadeOut(), value * 60000);
    toast(`Sleeping in ${value} minutes`, 'success');
  }

  fadeOut() {
    const video = this.art.video;
    if (!video) return;
    const start = video.volume;
    const began = performance.now();
    const step = () => {
      const progress = clamp((performance.now() - began) / 2600, 0, 1);
      video.volume = start * (1 - progress);
      if (progress < 1) requestAnimationFrame(step);
      else {
        this.art.pause();
        video.volume = start;
        toast('Sleep timer finished', 'info');
        this.setSleep(0);
      }
    };
    requestAnimationFrame(step);
  }

  toggleStats() {
    this.setStats(!this.statsOpen);
  }

  setStats(on) {
    this.statsOpen = !!on;
    if (on) this.mountStats();
    else this.statsPanel?.classList.remove('is-on');
    Nexus.emit('player:stats', { open: !!on });
  }

  mountStats() {
    if (this.statsPanel?.isConnected) {
      this.statsPanel.classList.add('is-on');
      return;
    }

    const panel = h('div', { class: 'nxp-stats is-on', 'data-nxp': 'stats' });
    panel.innerHTML = `
      <div class="nxp-stats__head">
        <span class="nxp-stats__dot"></span>
        <span>LIVE TELEMETRY</span>
        <button class="nxp-stats__close" type="button" aria-label="Hide">${icon('x', 13)}</button>
      </div>
      <canvas class="nxp-stats__graph" width="320" height="52"></canvas>
      <div class="nxp-stats__grid"></div>
    `;
    panel.querySelector('.nxp-stats__close').addEventListener('click', () => this.setStats(false));
    this.host.appendChild(panel);
    this.statsPanel = panel;
    this.statsGrid = panel.querySelector('.nxp-stats__grid');
    this.statsCanvas = panel.querySelector('canvas');
    this.statsCtx = this.statsCanvas.getContext('2d');
  }

  refreshStats() {
    if (!this.statsPanel?.classList.contains('is-on')) return;
    const video = this.art.video;
    if (!video) return;

    let buffer = 0;
    try {
      const ranges = video.buffered;
      for (let i = 0; i < ranges.length; i++) {
        if (video.currentTime >= ranges.start(i) && video.currentTime <= ranges.end(i)) {
          buffer = Math.max(0, ranges.end(i) - video.currentTime);
        }
      }
    } catch {
      /* noop */
    }

    let dropped = 0;
    let fps = 0;
    try {
      const quality = video.getVideoPlaybackQuality?.();
      if (quality) {
        dropped = quality.droppedVideoFrames;
        const total = quality.totalVideoFrames || 0;
        fps = Math.round((total - (this._lastTotalFrames || 0)) / 1);
        this._lastTotalFrames = total;
      }
    } catch {
      /* noop */
    }

    const level = this.currentLevel();
    const bitrate = level?.bitrate || this.telemetry.bitrate || 0;

    this.telemetry.samples.push(buffer);
    if (this.telemetry.samples.length > 60) this.telemetry.samples.shift();

    const rows = [
      ['Resolution', `${video.videoWidth || 0}×${video.videoHeight || 0}`],
      ['Rendition', level?.height ? `${level.height}p` : 'native'],
      ['Bitrate', bitrate ? `${(bitrate / 1e6).toFixed(2)} Mbps` : '—'],
      ['Buffer', `${buffer.toFixed(1)}s`],
      ['FPS', fps ? `${fps}` : '—'],
      ['Dropped', String(dropped)],
      ['Engine', this.engine.hls ? 'hls.js' : 'native'],
      ['Rate', `${(Number(this.art.playbackRate) || 1).toFixed(2)}×`]
    ];

    if (this.statsGrid) {
      this.statsGrid.innerHTML = rows
        .map(
          ([key, value]) =>
            `<div class="nxp-stats__cell"><span>${key}</span><strong>${value}</strong></div>`
        )
        .join('');
    }

    this.drawGraph();
  }

  drawGraph() {
    const ctx = this.statsCtx;
    if (!ctx) return;
    const { width, height } = this.statsCanvas;
    ctx.clearRect(0, 0, width, height);

    const samples = this.telemetry.samples;
    if (samples.length < 2) return;

    const max = Math.max(8, ...samples);
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--nx-accent')
      .trim() || '#00e5ff';

    ctx.beginPath();
    samples.forEach((value, index) => {
      const x = (index / (samples.length - 1)) * width;
      const y = height - (value / max) * (height - 8) - 2;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `${accent}55`);
    gradient.addColorStop(1, `${accent}00`);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  qualityLevels() {
    const hls = this.engine.hls;
    if (!hls?.levels?.length) return [];
    const out = [{ label: 'Auto', value: -1, active: hls.autoLevelEnabled }];
    hls.levels.forEach((level, index) => {
      out.push({
        label: level.height ? `${level.height}p` : `${Math.round((level.bitrate || 0) / 1000)}k`,
        value: index,
        active: !hls.autoLevelEnabled && hls.currentLevel === index
      });
    });
    return out;
  }

  currentLevel() {
    const hls = this.engine.hls;
    if (!hls?.levels?.length) return null;
    const index = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
    return hls.levels[index] || null;
  }

  setLevel(index) {
    const hls = this.engine.hls;
    if (!hls) return;
    try {
      hls.currentLevel = Number(index);
      toast(Number(index) < 0 ? 'Quality: Auto' : `Quality locked`, 'success', 1400);
      this.updateChips();
    } catch (error) {
      console.debug('[Nexus] level', error);
    }
  }

  screenshot() {
    const video = this.art.video;
    if (!video) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.href = url;
      link.download = `aniframe-${this.meta.anilistId || 'frame'}-ep${this.meta.episode || 1}-${stamp}.png`;
      link.click();
      toast('Frame saved', 'success');
    } catch {
      toast('This stream blocks frame capture (CORS)', 'error', 3000);
    }
  }

  async pip() {
    const video = this.art.video;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video?.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else {
        toast('Picture-in-Picture is not supported here', 'error');
      }
    } catch {
      toast('Picture-in-Picture was blocked', 'error');
    }
  }

  miniPlayer() {
    const shell = document.getElementById('embedContainer');
    if (!shell) return;
    const on = shell.classList.toggle('nx-mini');
    toast(on ? 'Mini player on' : 'Mini player off', 'info', 1400);
    Nexus.emit('player:mini', { on });
  }

  toggleZen() {
    this.zen = !this.zen;
    document.body.classList.toggle('nx-zen', this.zen);
    toast(this.zen ? 'Focus mode on — press Esc to exit' : 'Focus mode off', 'info', 1500);
  }

  copyDiagnostics() {
    const video = this.art.video;
    const info = {
      nexus: Nexus.version,
      engine: this.engine.hls ? 'hls.js' : 'native',
      url: String(this.art.url || '').slice(0, 200),
      resolution: `${video?.videoWidth || 0}x${video?.videoHeight || 0}`,
      duration: video?.duration,
      rate: this.art.playbackRate,
      levels: this.qualityLevels().length,
      ua: navigator.userAgent
    };
    const text = JSON.stringify(info, null, 2);
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast('Diagnostics copied', 'success'))
      .catch(() => {
        console.info('[Nexus diagnostics]', info);
        toast('Diagnostics logged to console', 'info');
      });
  }

  /* -------------------------------------------------------------- gestures */

  bindGestures() {
    if (!store.get('player.gestures', true)) return;
    const surface = this.art.video?.parentElement || this.host;
    if (!surface) return;

    const ignore = (target) =>
      Boolean(
        target?.closest?.(
          '.art-controls,.art-progress,.art-settings,.art-contextmenus,.art-layer button,' +
          '.nxp-sheet,.nxp-stats,button,input,select,textarea,a'
        )
      );

    const hint = this.root.querySelector('[data-nxp-hint]');
    const hintIcon = hint.querySelector('.nxp-hint__icon');
    const hintText = hint.querySelector('.nxp-hint__text');
    let hintTimer = null;

    const showHint = (glyph, text) => {
      hintIcon.innerHTML = glyph ? icon(glyph, 22) : '';
      hintText.textContent = text;
      hint.classList.add('is-on');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.classList.remove('is-on'), 900);
    };

    const onDown = (event) => {
      if (ignore(event.target)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      this._gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        startTime: this.art.currentTime,
        startVolume: this.art.volume,
        startBrightness: this.videoFx.brightness,
        axis: null,
        moved: false,
        longPress: null
      };

      if (event.pointerType === 'touch') {
        this._gesture.longPress = setTimeout(() => {
          if (!this._gesture || this._gesture.moved) return;
          this._rateBeforeHold = Number(this.art.playbackRate) || 1;
          try {
            this.art.playbackRate = Math.min(2, this._rateBeforeHold * 2);
          } catch {
            /* noop */
          }
          showHint('zap', '2× boost');
        }, 520);
      }
    };

    const onMove = (event) => {
      const gesture = this._gesture;
      if (!gesture || gesture.id !== event.pointerId) return;

      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) > 12) {
        gesture.moved = true;
        clearTimeout(gesture.longPress);
      }
      if (!gesture.moved) return;

      if (!gesture.axis) {
        gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }

      const rect = surface.getBoundingClientRect();

      if (gesture.axis === 'x') {
        const perPixel = (this.art.duration || 1440) / Math.max(240, rect.width);
        const target = clamp(gesture.startTime + dx * perPixel, 0, this.art.duration || 0);
        showHint(dx > 0 ? 'skip-forward' : 'skip-back', `${fmtTime(target)} / ${fmtTime(this.art.duration || 0)}`);
        gesture.pendingSeek = target;
      } else {
        const right = gesture.startX - rect.left > rect.width / 2;
        const delta = -dy / Math.max(160, rect.height);
        if (right) {
          const volume = clamp(gesture.startVolume + delta, 0, 1);
          this.art.volume = volume;
          showHint(volume === 0 ? 'mute' : 'volume', `${Math.round(volume * 100)}%`);
        } else {
          const brightness = clamp(gesture.startBrightness + delta * 100, 40, 160);
          this.videoFx.brightness = brightness;
          this.applyVideoFx();
          showHint('brightness', `${Math.round(brightness)}%`);
        }
      }
    };

    const onUp = (event) => {
      const gesture = this._gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      clearTimeout(gesture.longPress);

      if (gesture.pendingSeek != null && gesture.axis === 'x') {
        try {
          this.art.currentTime = gesture.pendingSeek;
        } catch {
          /* noop */
        }
      }

      if (this._rateBeforeHold != null) {
        try {
          this.art.playbackRate = this._rateBeforeHold;
        } catch {
          /* noop */
        }
        this._rateBeforeHold = null;
        this.syncSpeedChip();
      }

      if (!gesture.moved && event.pointerType === 'mouse') {
        const rect = surface.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
        if (ratio > 0.62) this.pulseRipple('fwd');
        else if (ratio < 0.38) this.pulseRipple('back');
      }

      this._gesture = null;
    };

    surface.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });

    const onDouble = (event) => {
      if (ignore(event.target)) return;
      const rect = surface.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
      if (ratio > 0.62) this.pulseRipple('fwd');
      else if (ratio < 0.38) this.pulseRipple('back');
    };
    surface.addEventListener('dblclick', onDouble);

    const onPinchStart = (event) => {
      if (event.touches?.length !== 2) return;
      const [a, b] = event.touches;
      this._pinch = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom: this.videoFx.zoom
      };
    };
    const onPinchMove = (event) => {
      if (!this._pinch || event.touches?.length !== 2) return;
      const [a, b] = event.touches;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const scale = clamp(this._pinch.zoom * (distance / this._pinch.distance), 1, 2.4);
      this.videoFx.zoom = scale;
      this.applyVideoFx();
      showHint('search', `${Math.round(scale * 100)}%`);
      event.preventDefault();
    };
    const onPinchEnd = () => {
      this._pinch = null;
    };

    surface.addEventListener('touchstart', onPinchStart, { passive: true });
    surface.addEventListener('touchmove', onPinchMove, { passive: false });
    surface.addEventListener('touchend', onPinchEnd, { passive: true });

    this.disposers.push(() => {
      surface.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      surface.removeEventListener('dblclick', onDouble);
      surface.removeEventListener('touchstart', onPinchStart);
      surface.removeEventListener('touchmove', onPinchMove);
      surface.removeEventListener('touchend', onPinchEnd);
    });
  }

  pulseRipple(side) {
    const node = this.root?.querySelector(
      side === 'fwd' ? '[data-nxp-ripple-fwd]' : '[data-nxp-ripple-back]'
    );
    if (!node) return;
    node.classList.remove('is-on');
    void node.offsetWidth;
    node.classList.add('is-on');
  }

  /* ---------------------------------------------------------------- events */

  bindPlayerEvents() {
    const art = this.art;
    const on = (event, fn) => {
      try {
        art.on(event, fn);
      } catch {
        /* noop */
      }
    };

    on('video:timeupdate', () => {
      const { a, b } = this.ab;
      if (a != null && b != null) {
        const time = Number(art.currentTime) || 0;
        if (time >= b - 0.05 || time < a - 0.4) {
          try {
            art.currentTime = a;
          } catch {
            /* noop */
          }
        }
      }
    });

    on('play', () => this.syncSpeedChip());
    on('video:ratechange', () => this.syncSpeedChip());

    this.zenExit = (event) => {
      if (event.key === 'Escape' && this.zen) {
        this.zen = false;
        document.body.classList.remove('nx-zen');
      }
    };
    document.addEventListener('keydown', this.zenExit);
    this.disposers.push(() => document.removeEventListener('keydown', this.zenExit));

    this.drawChapters();
  }

  bindHotkeys() {
    const live = () => Nexus.player?.art === this.art;

    const map = [
      ['s', () => live() && this.screenshot(), 'Screenshot', 'Player'],
      ['b', () => live() && this.toggleAB(), 'A-B loop', 'Player'],
      ['i', () => live() && this.toggleStats(), 'Stats for nerds', 'Player'],
      ['z', () => live() && this.toggleZen(), 'Focus mode', 'Player'],
      ['shift+d', () => live() && this.toggleSheet(), 'Player settings', 'Player'],
      ['shift+s', () => live() && this.setSleep(30), 'Sleep timer 30m', 'Player']
    ];

    for (const [combo, run, label, group] of map) {
      const off = registerHotkey(combo, () => run(), { label, group, scope: 'player' });
      this.disposers.push(off);
    }
  }

  syncLoopBadge() {
    const badge = this.root?.querySelector('[data-nxp-loop]');
    if (!badge) return;
    const on = this.ab.a != null && this.ab.b != null;
    badge.hidden = !on;
    badge.textContent = on ? `${fmtTime(this.ab.a)} – ${fmtTime(this.ab.b)}` : '';
  }

  toggleAB() {
    if (this.ab.a == null) {
      this.ab.a = Number(this.art.currentTime) || 0;
      toast(`Start set at ${fmtTime(this.ab.a)}`, 'success', 1400);
    } else if (this.ab.b == null) {
      this.ab.b = Math.max(Number(this.art.currentTime) || 0, this.ab.a + 0.5);
      toast('Repeating this section', 'success', 1400);
    } else {
      this.ab = { a: null, b: null };
      toast('Repeat turned off', 'info', 1200);
    }
    this.syncLoopBadge();
  }

  /* ------------------------------------------------------------- chapters */

  drawChapters() {
    const bar = this.art?.template?.$progress || this.host.querySelector('.art-progress');
    if (!bar) return;
    bar.querySelector('.nxp-chapters')?.remove();

    const rail = h('div', { class: 'nxp-chapters', 'aria-hidden': 'true' });
    bar.appendChild(rail);

    const paint = () => {
      const duration = Number(this.art.duration) || 0;
      if (!duration) return;
      rail.replaceChildren();
      const intervals = Array.isArray(this.engine.skipIntervals) ? this.engine.skipIntervals : [];
      for (const interval of intervals) {
        const start = clamp(interval.startTime / duration, 0, 1) * 100;
        const width = clamp(((interval.endTime - interval.startTime) / duration) * 100, 0.4, 100);
        const seg = h('span', {
          class: `nxp-chapters__seg nxp-chapters__seg--${interval.type?.startsWith('op') ? 'op' : interval.type?.startsWith('ed') ? 'ed' : 'misc'}`,
          style: { left: `${start}%`, width: `${width}%` },
          title: interval.type?.toUpperCase() || ''
        });
        rail.appendChild(seg);
      }
      if (this.ab.a != null) {
        rail.appendChild(
          h('span', {
            class: 'nxp-chapters__mark',
            style: { left: `${clamp((this.ab.a / duration) * 100, 0, 100)}%` }
          })
        );
      }
      if (this.ab.b != null) {
        rail.appendChild(
          h('span', {
            class: 'nxp-chapters__mark nxp-chapters__mark--b',
            style: { left: `${clamp((this.ab.b / duration) * 100, 0, 100)}%` }
          })
        );
      }
    };

    paint();
    this._paintChapters = paint;
  }

  /* ------------------------------------------------------------------ tick */

  startTick() {
    this.interval = setInterval(() => {
      this.updateChips();
      this.refreshStats();
      this.syncSpeedChip();

      if (this.sleepAt) {
        const badge = this.root?.querySelector('[data-nxp-sleep]');
        const left = Math.max(0, this.sleepAt - Date.now());
        if (badge) badge.textContent = `SLEEP ${Math.ceil(left / 60000)}m`;
      }

      if (this._paintChapters && Math.random() < 0.2) this._paintChapters();
    }, 1000);
  }

  updateChips() {
    const level = this.currentLevel();
    const q = this.root?.querySelector('[data-nxp-quality]');
    if (!q) return;

    const video = this.art.video;
    const height = level?.height || video?.videoHeight || 0;

    q.textContent = height ? `${height}p` : 'HD';
    q.classList.toggle('is-hd', height >= 720);
  }

  /* --------------------------------------------------------------- teardown */

  destroy() {
    clearInterval(this.interval);
    clearTimeout(this._sleepTimer);
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* noop */
      }
    }
    this.sheet?.remove();
    this.statsPanel?.remove();
    this.root?.remove();
    this.host?.classList.remove('nxp-host', 'ambient-glow-active');
    document.body.classList.remove('nx-zen');
    document.getElementById('nxpSubtitleStyle')?.remove();
    this.art?.video?.style.removeProperty('filter');
    this.art?.video?.style.removeProperty('transform');
    if (Nexus.player?.hud === this) Nexus.player = null;
    Nexus.emit('player:detached');
  }
}

/* --------------------------------------------------------------------------
 * Public attachment surface
 * ------------------------------------------------------------------------ */

const instances = new WeakMap();

export const playerHud = {
  attach(engine, art, meta = {}) {
    try {
      this.detach(engine);
      const hud = new ProHud(engine, art, meta);
      if (!hud.attach()) return null;
      instances.set(engine, hud);
      return hud;
    } catch (error) {
      console.warn('[Nexus] player HUD failed to attach', error);
      return null;
    }
  },

  detach(engine) {
    const hud = instances.get(engine);
    if (hud) {
      try {
        hud.destroy();
      } catch (error) {
        console.debug('[Nexus] HUD teardown', error);
      }
      instances.delete(engine);
    }
  },

  current() {
    return Nexus.player?.hud || null;
  }
};

/* --------------------------------------------------------------------------
 * Feature registration — appears in the Nexus Lab automatically
 * ------------------------------------------------------------------------ */

Nexus.defineFeature({
  id: 'player-pro',
  name: 'Player settings',
  icon: 'film',
  category: 'Player',
  order: 10,
  description:
    'Clean player settings panel: speed, subtitles, sleep timer, repeat, picture, quality, screenshots and picture-in-picture.',
  tags: ['player', 'settings', 'subtitles', 'speed'],
  hotkeys: [
    { combo: 'shift+d', label: 'Open player settings' },
    { combo: 's', label: 'Save current frame' },
    { combo: 'b', label: 'Repeat a section' },
    { combo: 'z', label: 'Focus mode' }
  ],
  mount() {
    Nexus.playerHud = playerHud;
    return () => {
      // Toggling the module off must also strip the HUD from a live stream.
      const engine = Nexus.player?.engine;
      if (engine) playerHud.detach(engine);
      if (Nexus.playerHud === playerHud) Nexus.playerHud = null;
    };
  }
});

export default playerHud;
