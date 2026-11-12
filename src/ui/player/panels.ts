import type { Settings, TrackInfo } from '../../types';
import type { PlayerApi } from './api';
import { el, esc, toast } from '../dom';
import { icon } from '../icons';
import { EQ_FREQUENCIES, EQ_PRESETS } from '../../storage/settings';
import { codecLabel, formatTime, languageName } from '../../utils/format';
import { library } from '../../storage/library';
import { ASPECT_PRESETS, FILTER_PRESETS, DEFAULT_ADJUSTMENTS, type AspectMode, type VideoAdjustments } from '../../video/adjustments';
import { buildMimeType } from '../../core/engineSelector';

/* ------------------------------------------------------------------ helpers */

function label(text: string): HTMLElement {
  return el('div', { class: 'panel-label', text });
}

function section(title: string, children: Node[], hint?: string): HTMLElement {
  const node = el('div', { class: 'panel-section' });
  node.append(label(title));
  for (const child of children) node.append(child);
  if (hint) node.append(el('div', { class: 'p-note', text: hint }));
  return node;
}

function optionButton(text: string, active: boolean, onClick: () => void, sub?: string): HTMLElement {
  const button = el('button', { class: `p-opt${active ? ' is-active' : ''}`, type: 'button' });
  button.innerHTML = `<span>${esc(text)}</span>${sub ? `<span class="p-note" style="margin:0;font-size:10px">${esc(sub)}</span>` : ''}`;
  button.addEventListener('click', onClick);
  return button;
}

function sliderRow(
  title: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
  format?: (value: number) => string,
): HTMLElement {
  const row = el('div', { class: 'p-row' });
  row.innerHTML = `<span class="p-row__label">${esc(title)}</span>`;
  const input = el('input', { class: 'range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const valueLabel = el('span', { class: 'p-row__val', text: format ? format(value) : String(value) });
  const paint = () => {
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  };
  paint();
  input.addEventListener('input', () => {
    paint();
    valueLabel.textContent = format ? format(Number(input.value)) : String(input.value);
    onChange(Number(input.value));
  });
  row.append(input, valueLabel);
  return row;
}

function toggleRow(title: string, description: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const row = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked) });
  row.innerHTML = `<span class="switch__text"><span class="switch__title">${esc(title)}</span>${
    description ? `<span class="switch__desc">${esc(description)}</span>` : ''
  }</span><span class="switch__track"></span>`;
  row.addEventListener('click', () => {
    const next = row.getAttribute('aria-checked') !== 'true';
    row.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return row;
}

function trackItem(track: TrackInfo, active: boolean, onClick: () => void): HTMLElement {
  const item = el('button', { class: `track-item${active ? ' is-active' : ''}`, type: 'button' });
  const badge =
    track.kind === 'audio'
      ? track.channels === 1
        ? 'MONO'
        : track.channels === 2
          ? 'ST'
          : track.channels && track.channels > 2
            ? `${track.channels}.0`
            : 'AUD'
      : track.kind === 'subtitle'
        ? 'SUB'
        : 'VID';
  const meta: string[] = [];
  if (track.language && track.language !== track.label) meta.push(track.language);
  if (track.codec) meta.push(codecLabel(track.codec));
  if (track.channels) meta.push(`${track.channels} ch`);
  if (track.sampleRate) meta.push(`${Math.round(track.sampleRate / 1000)} kHz`);
  item.innerHTML = `
    <span class="track-item__badge">${badge}</span>
    <span class="track-item__body">
      <span class="track-item__title">${esc(track.label)}
        ${track.isDefault ? '<span class="pill pill--accent">Default</span>' : ''}
        ${track.isForced ? '<span class="pill">Forced</span>' : ''}
        ${track.isCommentary ? '<span class="pill">Commentary</span>' : ''}
      </span>
      <span class="track-item__meta">${esc(meta.join(' · ') || '—')}</span>
    </span>
    <span class="track-item__check">${icon('check', 16)}</span>`;
  item.addEventListener('click', onClick);
  return item;
}

/* ------------------------------------------------------------------- tracks */

export function buildTracksPanel(api: PlayerApi): HTMLElement {
  const container = el('div');
  const engine = api.pm.currentEngine;
  const tracks = api.pm.getTracks();
  const audio = tracks.filter((track) => track.kind === 'audio');
  const engineSubs = tracks.filter((track) => track.kind === 'subtitle');
  const qualities = api.pm.getQualities();
  const probe = api.pm.probe;

  if (!engine) {
    container.append(el('div', { class: 'p-note', text: 'No media is loaded.' }));
    return container;
  }

  // ---------------------------------------------------------------- audio
  const audioChildren: Node[] = [];
  const probeAudio = probe?.audioTracks ?? [];
  const languageKey = (value?: string) => (value ?? '').toLowerCase().split(/[-_]/)[0];
  const engineCanSwitch = !!engine.capabilities.audioTracks && engine.kind !== 'native';
  const corsBlocked = api.pm.isCorsBlocked;

  for (const track of audio) {
    audioChildren.push(
      trackItem(track, !!track.isDefault, () => {
        void api.pm
          .selectAudioTrack(track.id)
          .then(() => {
            api.notify(`Audio: ${track.label}`, 'ok');
            api.refreshPanel();
          })
          .catch((error: Error) => api.notify(error.message, 'err'));
      }),
    );
  }

  // Tracks the container has but this engine cannot reach (native <video> hides them).
  const missing = probeAudio.filter((containerTrack) => {
    const key = languageKey(containerTrack.languageCode);
    return !audio.some((track) => (key && languageKey(track.languageCode) === key) || track.index === containerTrack.index);
  });

  if (missing.length > 0) {
    audioChildren.push(
      el('div', {
        class: 'p-note',
        text: `${missing.length} more audio track${missing.length > 1 ? 's' : ''} in the container — pick one to reload with the engine that can switch.`,
      }),
    );
    for (const containerTrack of missing) {
      const row = el('button', { class: 'track-item track-item--pending', type: 'button' });
      const language = containerTrack.language ?? containerTrack.label;
      const meta = [
        containerTrack.languageCode,
        containerTrack.codec ? codecLabel(containerTrack.codec) : '',
        containerTrack.channels ? `${containerTrack.channels} ch` : '',
      ].filter(Boolean);
      row.innerHTML = `
        <span class="track-item__badge">${containerTrack.channels && containerTrack.channels > 2 ? `${containerTrack.channels}.0` : 'AUD'}</span>
        <span class="track-item__body">
          <span class="track-item__title">${esc(language)}<span class="pill">Not loaded</span></span>
          <span class="track-item__meta">${esc(meta.join(' · ') || 'Audio track')}</span>
        </span>
        <span class="track-item__check">${icon('refresh', 16)}</span>`;
      row.addEventListener('click', () => {
        if (corsBlocked) {
          api.notify('This host blocks the browser from reading the file, so track switching needs a download.', 'warn');
          return;
        }
        api.store.updateSettings({ preferredAudioLanguage: containerTrack.languageCode ?? '' });
        void api.reloadWithEngine('webcodecs', containerTrack.languageCode);
      });
      audioChildren.push(row);
    }
  }

  if (corsBlocked) {
    const warning = el('div', { class: 'p-warn' });
    warning.innerHTML = `${icon('alert', 14)}<span>This host does not allow the browser to read the file (CORS). The native element can play MP4/WebM but cannot expose or switch audio tracks. Download the file and open it locally for full multi-audio support.</span>`;
    audioChildren.push(warning);
  } else if (missing.length === 0 && audio.length > 1 && !engineCanSwitch) {
    audioChildren.push(
      el('div', {
        class: 'p-note',
        text: 'The current engine plays only the default track. Reload with WebCodecs to switch languages.',
      }),
    );
  } else if (missing.length === 0 && audio.length <= 1 && probeAudio.length <= 1) {
    audioChildren.push(
      el('div', {
        class: 'p-note',
        text: audio.length === 1 ? 'One audio track in this file.' : 'No separate audio tracks were found.',
      }),
    );
  }

  if (!corsBlocked && engine.kind === 'native' && probeAudio.length > 1) {
    audioChildren.push(
      optionButton(`Reload with WebCodecs to switch ${probeAudio.length} tracks`, false, () => {
        void api.reloadWithEngine('webcodecs');
      }),
    );
  }

  container.append(section('Audio tracks', audioChildren));

  // Subtitles
  const subChildren: Node[] = [];
  const activeSub = api.subtitles.active;
  subChildren.push(
    optionButton('Off', !activeSub, () => {
      api.subtitles.select(null);
      api.store.updateSettings({ subtitleEnabled: false });
      api.notify('Subtitles off');
      api.refreshPanel();
    }),
  );
  for (const track of engineSubs) {
    subChildren.push(
      optionButton(`${track.label}${track.language ? ` — ${languageName(track.language)}` : ''}`, false, () => {
        void api.pm
          .selectSubtitleTrack(track.id)
          .then(async () => {
            if (engine.extractSubtitleCues) {
              const cues = await engine.extractSubtitleCues(track.id).catch(() => []);
              if (cues.length) {
                api.subtitles.addEmbeddedCues(cues, track.label, `embedded_${track.id}`, track.language);
                api.notify(`Embedded subtitles: ${track.label}`, 'ok');
              } else {
                api.notify('The engine renders this subtitle track itself.', 'info');
              }
            } else {
              api.notify(`Subtitles: ${track.label}`, 'ok');
            }
            api.refreshPanel();
          })
          .catch((error: Error) => api.notify(error.message, 'err'));
      }),
    );
  }
  for (const track of api.subtitles.tracks) {
    subChildren.push(
      optionButton(`${track.label} (${track.format.toUpperCase()})`, activeSub?.id === track.id, () => {
        api.subtitles.select(track.id);
        api.store.updateSettings({ subtitleEnabled: true });
        api.refreshPanel();
      }),
    );
  }
  container.append(
    section('Subtitles', subChildren, engineSubs.length === 0 ? 'Embedded subtitle tracks appear here when the container exposes them; otherwise load a subtitle file.' : undefined),
  );

  // Quality
  if (qualities.length > 0) {
    const grid = el('div', { class: 'p-btn-grid' });
    const current = (api.pm.currentEngine as unknown as { activeLevel?: string }).activeLevel ?? 'auto';
    grid.append(optionButton('Auto', current === 'auto', () => api.pm.setQuality('auto')));
    for (const level of qualities) {
      grid.append(
        optionButton(level.label, current === level.id, () => api.pm.setQuality(level.id), level.bitrate ? `${Math.round(level.bitrate / 1000)}k` : undefined),
      );
    }
    container.append(section('Quality', [grid], 'Only levels that exist in the manifest are listed.'));
  }

  return container;
}

/* -------------------------------------------------------------------- audio */

export function buildAudioPanel(api: PlayerApi): HTMLElement {
  const container = el('div');
  const settings = api.store.settings;
  const graphActive = api.pm.audioGraphActive;

  if (!graphActive) {
    const warning = el('div', { class: 'p-warn' });
    warning.innerHTML = `${icon('alert', 14)}<span>Audio effects are unavailable for this source. Browsers only allow Web Audio processing on same-origin or CORS-enabled media — cross-origin files play through the native element instead.</span>`;
    container.append(warning);
  }

  const eqToggle = toggleRow('Equaliser', '10-band graphic EQ applied in the audio graph.', settings.eqEnabled, (value) => {
    api.store.updateSettings({ eqEnabled: value });
    api.refreshPanel();
  });
  container.append(section('Equaliser', [eqToggle]));

  const presets = el('div', { class: 'preset-grid' });
  for (const name of Object.keys(EQ_PRESETS)) {
    const chip = el('button', { class: `preset-chip${settings.eqPreset === name ? ' is-active' : ''}`, text: name, type: 'button' });
    chip.addEventListener('click', () => {
      api.store.updateSettings({ eqPreset: name, eqGains: [...EQ_PRESETS[name]], eqEnabled: name !== 'Flat' && name !== 'Normal' ? true : settings.eqEnabled });
      api.refreshPanel();
    });
    presets.append(chip);
  }
  container.append(section('Presets', [presets]));

  const eq = el('div', { class: 'eq' });
  EQ_FREQUENCIES.forEach((frequency, index) => {
    const band = el('div', { class: 'eq__band' });
    const slider = el('input', {
      class: 'eq__slider',
      type: 'range',
      min: '-12',
      max: '12',
      step: '1',
      value: String(settings.eqGains[index] ?? 0),
      'aria-label': `${frequency} Hz`,
    });
    const value = el('span', { class: 'eq__val', text: `${settings.eqGains[index] ?? 0}` });
    const freq = el('span', { class: 'eq__freq', text: frequency >= 1000 ? `${frequency / 1000}k` : String(frequency) });
    const paint = () => {
      slider.style.setProperty('--fill', `${((Number(slider.value) + 12) / 24) * 100}%`);
    };
    paint();
    slider.addEventListener('input', () => {
      const gains = [...api.store.settings.eqGains];
      gains[index] = Number(slider.value);
      value.textContent = String(slider.value);
      paint();
      api.store.updateSettings({ eqGains: gains, eqPreset: 'Custom', eqEnabled: true });
    });
    band.append(slider, value, freq);
    eq.append(band);
  });
  container.append(section('Bands', [eq], 'Adjusting a band switches the preset to Custom.'));

  container.append(
    section('Tone & loudness', [
      sliderRow('Bass', settings.bassBoost, -12, 12, 1, (value) => api.store.updateSettings({ bassBoost: value }), (value) => `${value > 0 ? '+' : ''}${value} dB`),
      sliderRow('Balance', settings.balance, -1, 1, 0.05, (value) => api.store.updateSettings({ balance: value }), (value) => (value === 0 ? 'Centre' : value < 0 ? `L ${Math.round(-value * 100)}%` : `R ${Math.round(value * 100)}%`)),
      sliderRow('Audio delay', settings.audioDelayMs, 0, 2000, 50, (value) => api.store.updateSettings({ audioDelayMs: value }), (value) => `${value} ms`),
      toggleRow('Mono downmix', 'Fold all channels into a single mono channel.', settings.mono, (value) => {
        api.store.updateSettings({ mono: value });
        api.refreshPanel();
      }),
      toggleRow('Volume normalisation', 'Gentle compression to even out quiet dialogue and loud effects.', settings.normalizeVolume, (value) => {
        api.store.updateSettings({ normalizeVolume: value });
        api.refreshPanel();
      }),
    ], 'Positive audio delay is supported; negative offsets would require delaying video, which browsers do not allow for native playback.'),
  );

  return container;
}

/* ---------------------------------------------------------------- subtitles */

export function buildSubtitlesPanel(api: PlayerApi): HTMLElement {
  const container = el('div');
  const settings = api.store.settings;
  const active = api.subtitles.active;

  const fileInput = el('input', { type: 'file', class: 'hidden', accept: '.srt,.vtt,.ass,.ssa,.ttml,.dfxp,.sup' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const track = await api.subtitles.loadFile(file);
      api.store.updateSettings({ subtitleEnabled: true });
      api.notify(`Loaded ${track.label} (${track.format.toUpperCase()})`, 'ok');
      api.refreshPanel();
    } catch (error) {
      api.notify((error as Error).message, 'err');
    }
  });

  const list = el('div');
  list.append(
    optionButton('Off', !active, () => {
      api.subtitles.select(null);
      api.store.updateSettings({ subtitleEnabled: false });
      api.refreshPanel();
    }),
  );
  for (const track of api.subtitles.tracks) {
    list.append(
      optionButton(`${track.label} — ${track.format.toUpperCase()}`, active?.id === track.id, () => {
        api.subtitles.select(track.id);
        api.store.updateSettings({ subtitleEnabled: true });
        api.refreshPanel();
      }),
    );
  }
  // External tracks carry a URL, so they can be saved as files.
  const downloadable = api.subtitles.tracks.filter((track) => 'url' in track && (track as { url?: string }).url);
  if (downloadable.length > 0) {
    const mediaName = api.store.current?.name;
    const row = el('div', { class: 'row', style: { marginTop: '8px' } });
    for (const track of downloadable) {
      const url = (track as { url?: string }).url!;
      const button = el('button', { class: 'btn btn--sm', type: 'button' });
      button.innerHTML = `${icon('download', 14)} ${esc(track.label)}`;
      button.addEventListener('click', () => void downloadSubtitle(url, mediaName, track.language));
      row.append(button);
    }
    if (downloadable.length > 1) {
      const all = el('button', { class: 'btn btn--sm btn--primary', type: 'button' });
      all.innerHTML = `${icon('download', 14)} Download all subtitles`;
      all.addEventListener('click', async () => {
        for (const track of downloadable) {
          await downloadSubtitle((track as { url?: string }).url!, mediaName, track.language);
        }
      });
      row.append(all);
    }
    list.append(row);
  }

  container.append(section('Tracks', [list, fileInput]));

  // Subtitle streams stored inside the container (MKV/WebM), extracted on demand.
  const embedded = api.embeddedTracks;
  if (embedded.length > 0) {
    const rows: Node[] = [];
    for (const track of embedded) {
      const loaded = api.isEmbeddedLoaded(track.number);
      const badge =
        track.format === 'pgs' ? 'PGS' : track.format === 'ass' ? 'ASS' : track.format === 'ssa' ? 'SSA' : 'SRT';
      const language = track.language ? languageName(track.language) : 'Unknown language';
      const title = track.name || language;
      const meta = [
        language,
        track.isDefault ? 'default' : '',
        track.isForced ? 'forced' : '',
        track.format === 'pgs' ? 'bitmap' : 'text',
      ].filter(Boolean);

      const row = el('button', {
        class: `track-item${loaded ? ' is-active' : ''}`,
        type: 'button',
      });
      row.innerHTML = `
        <span class="track-item__badge">${badge}</span>
        <span class="track-item__body">
          <span class="track-item__title">${esc(title)}${track.isDefault ? '<span class="pill">Default</span>' : ''}</span>
          <span class="track-item__meta">${esc(meta.join(' · '))}</span>
        </span>
        <span class="track-item__check">${icon(loaded ? 'check' : 'download', 16)}</span>`;
      row.addEventListener('click', () => {
        if (loaded) {
          const existing = api.subtitles.tracks.find((item) => item.label === title || item.language === track.language);
          if (existing) {
            api.subtitles.select(existing.id);
            api.store.updateSettings({ subtitleEnabled: true });
            api.refreshPanel();
            return;
          }
        }
        void api.loadEmbeddedSubtitle(track);
      });
      rows.push(row);
    }
    container.append(
      section(
        'Embedded in this file',
        [...rows, el('div', { class: 'p-note', text: 'Extracted from the container on demand — no re-download, no server.' })],
        'ASS/SSA keep their styling. PGS bitmap subtitles are decoded frame-by-frame.',
      ),
    );
  }

  const loadRow = el('div', { class: 'row' });
  const loadButton = el('button', { class: 'btn btn--sm', html: `${icon('upload', 15)} Load subtitle file` });
  loadButton.addEventListener('click', () => fileInput.click());
  loadRow.append(loadButton);
  if (active) {
    const removeButton = el('button', { class: 'btn btn--sm btn--danger', html: `${icon('trash', 15)} Remove` });
    removeButton.addEventListener('click', () => {
      api.subtitles.remove(active.id);
      api.refreshPanel();
    });
    loadRow.append(removeButton);
  }
  container.append(section('File', [loadRow], 'Supported: SRT, WebVTT, ASS, SSA, TTML/DFXP. ASS files keep their styling.'));

  if (active) {
    const offset = active.offsetMs;
    const syncRow = el('div', { class: 'p-btn-grid' });
    for (const delta of [-500, -100, -50, 50, 100, 500]) {
      syncRow.append(
        optionButton(`${delta > 0 ? '+' : ''}${delta} ms`, false, () => {
          api.subtitles.nudgeOffset(delta);
          api.notify(`Subtitle sync: ${api.subtitles.active?.offsetMs ?? 0} ms`);
          api.refreshPanel();
        }),
      );
    }
    container.append(
      section('Synchronisation', [
        el('div', { class: 'p-note', text: `Current offset: ${offset} ms`, style: { marginBottom: '8px' } }),
        syncRow,
        optionButton('Reset sync', false, () => {
          api.subtitles.setOffset(active.id, 0);
          api.refreshPanel();
        }),
      ], 'Sync is stored per track, so different subtitle files can each keep their own offset.'),
    );
  }

  container.append(
    section('Appearance', [
      sliderRow('Font size', settings.subtitleSize, 12, 64, 1, (value) => api.store.updateSettings({ subtitleSize: value }), (value) => `${value}px`),
      sliderRow('Weight', settings.subtitleWeight, 300, 900, 100, (value) => api.store.updateSettings({ subtitleWeight: value })),
      sliderRow('Vertical position', settings.subtitlePosition, 0, 45, 1, (value) => api.store.updateSettings({ subtitlePosition: value }), (value) => `${value}%`),
      sliderRow('Width', settings.subtitleWidth, 30, 100, 1, (value) => api.store.updateSettings({ subtitleWidth: value }), (value) => `${value}%`),
      sliderRow('Outline', settings.subtitleOutline, 0, 8, 0.5, (value) => api.store.updateSettings({ subtitleOutline: value }), (value) => `${value}px`),
      sliderRow('Shadow', settings.subtitleShadow, 0, 20, 1, (value) => api.store.updateSettings({ subtitleShadow: value }), (value) => `${value}px`),
      sliderRow('Opacity', settings.subtitleOpacity, 0.2, 1, 0.05, (value) => api.store.updateSettings({ subtitleOpacity: value }), (value) => `${Math.round(value * 100)}%`),
      sliderRow('Background', settings.subtitleBackground, 0, 0.9, 0.05, (value) => api.store.updateSettings({ subtitleBackground: value }), (value) => (value === 0 ? 'Off' : `${Math.round(value * 100)}%`)),
    ], 'Font family and colour are in Settings → Subtitles. ASS styling from the file always wins over these defaults.'),
  );

  return container;
}

/* -------------------------------------------------------------------- video */

export function buildVideoPanel(api: PlayerApi): HTMLElement {
  const container = el('div');
  const adj = api.adjustments;
  const settings = api.store.settings;

  const update = (patch: Partial<VideoAdjustments>) => api.setAdjustments({ ...api.adjustments, ...patch });

  const presetGrid = el('div', { class: 'preset-grid' });
  for (const preset of FILTER_PRESETS) {
    const chip = el('button', { class: 'preset-chip', text: preset.name, type: 'button' });
    chip.addEventListener('click', () => {
      api.setAdjustments({ ...DEFAULT_ADJUSTMENTS, zoom: api.adjustments.zoom, aspect: api.adjustments.aspect, ...preset.values });
      api.refreshPanel();
    });
    presetGrid.append(chip);
  }
  container.append(section('Looks', [presetGrid]));

  container.append(
    section('Picture', [
      sliderRow('Brightness', adj.brightness, 0.3, 2, 0.02, (value) => update({ brightness: value }), (value) => `${Math.round(value * 100)}%`),
      sliderRow('Contrast', adj.contrast, 0.3, 2, 0.02, (value) => update({ contrast: value }), (value) => `${Math.round(value * 100)}%`),
      sliderRow('Saturation', adj.saturation, 0, 2.5, 0.02, (value) => update({ saturation: value }), (value) => `${Math.round(value * 100)}%`),
      sliderRow('Hue', adj.hue, -180, 180, 1, (value) => update({ hue: value }), (value) => `${value}°`),
      sliderRow('Gamma', adj.gamma, 0.5, 2, 0.02, (value) => update({ gamma: value, brightness: value }), (value) => value.toFixed(2)),
      sliderRow('Sharpen', adj.sharpen, 0, 1, 0.1, (value) => update({ sharpen: value }), (value) => (value === 0 ? 'Off' : `${Math.round(value * 100)}%`)),
      sliderRow('Grayscale', adj.grayscale, 0, 1, 0.05, (value) => update({ grayscale: value })),
      sliderRow('Sepia', adj.sepia, 0, 1, 0.05, (value) => update({ sepia: value })),
      sliderRow('Invert', adj.invert, 0, 1, 0.05, (value) => update({ invert: value })),
      sliderRow('Blur', adj.blur, 0, 6, 0.2, (value) => update({ blur: value }), (value) => `${value}px`),
    ], 'Filters run on the GPU through CSS, so they cost almost nothing. Gamma is approximated with brightness.'),
  );

  const aspects = el('div', { class: 'p-btn-grid' });
  for (const preset of ASPECT_PRESETS) {
    aspects.append(
      optionButton(preset.label, adj.aspect === preset.id, () => {
        update({ aspect: preset.id as AspectMode });
        api.refreshPanel();
      }),
    );
  }
  container.append(section('Aspect ratio', [aspects]));

  const transforms = el('div', { class: 'p-btn-grid' });
  transforms.append(
    optionButton('Rotate 90°', false, () => update({ rotate: (adj.rotate + 90) % 360 })),
    optionButton('Rotate 180°', false, () => update({ rotate: (adj.rotate + 180) % 360 })),
    optionButton('Reset rotation', false, () => update({ rotate: 0 })),
    optionButton(`Mirror ${adj.flipH ? 'on' : 'off'}`, adj.flipH, () => update({ flipH: !adj.flipH })),
    optionButton(`Flip ${adj.flipV ? 'on' : 'off'}`, adj.flipV, () => update({ flipV: !adj.flipV })),
    optionButton('Reset position', false, () => update({ panX: 0, panY: 0, zoom: 1 })),
  );
  container.append(section('Transform', [transforms]));

  container.append(
    section('Zoom', [
      sliderRow('Zoom', adj.zoom, 0.5, 4, 0.05, (value) => update({ zoom: value }), (value) => `${Math.round(value * 100)}%`),
      sliderRow('Pan X', adj.panX, -50, 50, 1, (value) => update({ panX: value }), (value) => `${value}%`),
      sliderRow('Pan Y', adj.panY, -50, 50, 1, (value) => update({ panY: value }), (value) => `${value}%`),
    ]),
  );

  container.append(
    section('Reset', [
      optionButton('Reset all picture settings', false, () => {
        api.setAdjustments({ ...DEFAULT_ADJUSTMENTS });
        api.refreshPanel();
        api.notify('Picture settings reset', 'ok');
      }),
    ], `Preferences are saved with your settings (${settings.theme} theme).`),
  );

  return container;
}

/* ----------------------------------------------------------------- playback */

export function buildPlaybackPanel(api: PlayerApi): HTMLElement {
  const container = el('div');
  const settings = api.store.settings;
  const speedGrid = el('div', { class: 'p-btn-grid' });
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  for (const speed of speeds) {
    speedGrid.append(
      optionButton(`${speed}×`, Math.abs(api.rate - speed) < 0.01, () => {
        api.setRate(speed);
        api.refreshPanel();
      }),
    );
  }
  container.append(
    section('Speed', [
      speedGrid,
      sliderRow('Custom speed', api.rate, 0.25, 4, 0.05, (value) => api.setRate(value), (value) => `${value.toFixed(2)}×`),
    ], api.pm.currentEngine?.capabilities.pitchPreserved
      ? 'Pitch is preserved by the browser at every speed.'
      : 'The WebCodecs engine changes pitch with speed; the native engine preserves it.'),
  );

  const loopGrid = el('div', { class: 'p-btn-grid' });
  for (const mode of ['off', 'one', 'all'] as const) {
    loopGrid.append(
      optionButton(mode === 'off' ? 'No loop' : mode === 'one' ? 'Loop one' : 'Loop queue', settings.loopMode === mode, () => {
        api.store.updateSettings({ loopMode: mode });
        api.refreshPanel();
      }),
    );
  }
  loopGrid.append(
    optionButton(`Shuffle ${settings.shuffle ? 'on' : 'off'}`, settings.shuffle, () => {
      api.store.updateSettings({ shuffle: !settings.shuffle });
      api.refreshPanel();
    }),
  );
  container.append(section('Repeat', [loopGrid]));

  const abGrid = el('div', { class: 'p-btn-grid' });
  abGrid.append(
    optionButton(api.abLoop.a === null ? 'Set A' : `A: ${formatTime(api.abLoop.a)}`, api.abLoop.a !== null, () => {
      api.setAbLoop({ a: api.pm.currentTime, b: api.abLoop.b });
      api.refreshPanel();
    }),
    optionButton(api.abLoop.b === null ? 'Set B' : `B: ${formatTime(api.abLoop.b)}`, api.abLoop.b !== null, () => {
      api.setAbLoop({ a: api.abLoop.a, b: api.pm.currentTime });
      api.refreshPanel();
    }),
    optionButton('Clear A-B', false, () => {
      api.setAbLoop({ a: null, b: null });
      api.refreshPanel();
    }),
  );
  container.append(section('A-B repeat', [abGrid], 'Playback jumps back to A when it reaches B.'));

  const sleepGrid = el('div', { class: 'p-btn-grid' });
  for (const minutes of [15, 30, 45, 60, 90]) {
    sleepGrid.append(
      optionButton(`${minutes} min`, false, () => {
        api.setSleepTimer(minutes);
        api.refreshPanel();
      }),
    );
  }
  sleepGrid.append(
    optionButton('Cancel', false, () => {
      api.setSleepTimer(null);
      api.refreshPanel();
    }),
  );
  container.append(
    section(
      'Sleep timer',
      [sleepGrid, ...(api.sleepRemaining !== null ? [el('div', { class: 'p-note', text: `Pausing in ${formatTime(api.sleepRemaining)}` })] : [])],
      'Pauses playback after the chosen time. It only runs while this tab is open.',
    ),
  );

  if (api.chapters.length > 0) {
    const list = el('div', { class: 'media-list' });
    for (const chapter of api.chapters) {
      const row = el('button', { class: 'menu-item', type: 'button' });
      row.innerHTML = `<span style="width:52px;font-variant-numeric:tabular-nums;color:var(--txt-3)">${formatTime(chapter.start)}</span><span style="flex:1">${esc(chapter.title)}</span>`;
      row.addEventListener('click', () => {
        api.seek(chapter.start + 0.1);
        api.closePanel();
      });
      list.append(row);
    }
    container.append(section('Chapters', [list]));
  }

  const bookmarks = library.bookmarksFor(api.store.current?.id ?? '');
  const bookmarkList = el('div', { class: 'media-list' });
  if (bookmarks.length === 0) {
    bookmarkList.append(el('div', { class: 'p-note', text: 'No bookmarks for this video yet.' }));
  } else {
    for (const bookmark of bookmarks) {
      const row = el('button', { class: 'menu-item', type: 'button' });
      row.innerHTML = `<span style="width:52px;font-variant-numeric:tabular-nums;color:var(--txt-3)">${formatTime(bookmark.time)}</span><span style="flex:1">${esc(bookmark.label)}</span>`;
      row.addEventListener('click', () => {
        api.seek(bookmark.time);
        api.closePanel();
      });
      bookmarkList.append(row);
    }
  }
  const addBookmarkButton = el('button', { class: 'btn btn--sm', html: `${icon('bookmarkPlus', 15)} Bookmark this moment` });
  addBookmarkButton.addEventListener('click', () => {
    api.addBookmark(formatTime(api.pm.currentTime));
    api.refreshPanel();
  });
  container.append(section('Bookmarks', [bookmarkList, addBookmarkButton]));

  return container;
}

/* --------------------------------------------------------------------- info */

/**
 * Hardware decoding is "requested" by a setting and "verified" only when the
 * decoder actually reported hardware acceleration for the current track.
 */
export function hardwareDecodeStatus(api: PlayerApi): string {
  const engine = (api.pm as unknown as { currentEngine?: { hardwareActive?: boolean; hardwareHint?: string } }).currentEngine;
  const requested = api.store.settings.preferHardware;
  if (engine?.hardwareActive === true) return 'Hardware (verified)';
  if (requested && engine?.hardwareHint === 'prefer-hardware') return 'Hardware (requested, not confirmed)';
  if (!requested) return 'Software (hardware disabled in settings)';
  return 'Software';
}

export async function buildInfoPanel(api: PlayerApi): Promise<HTMLElement> {
  const container = el('div');
  const diagnostics = await api.pm.getDiagnostics();
  const rows: Array<[string, string]> = [
    ['Engine', diagnostics.engine],
    ['Fallback chain', diagnostics.engineChain.join(' → ') || '—'],
    ['Container', diagnostics.container ?? 'Unknown'],
    ['Video codec', codecLabel(diagnostics.videoCodec)],
    ['Audio codec', codecLabel(diagnostics.audioCodec)],
    ['Resolution', diagnostics.width && diagnostics.height ? `${diagnostics.width} × ${diagnostics.height}` : '—'],
    ['Frame rate', diagnostics.frameRate ? `${diagnostics.frameRate.toFixed(2)} fps` : '—'],
    ['Bitrate', diagnostics.bitrate ? `${Math.round(diagnostics.bitrate / 1000)} kbps` : '—'],
    ['Decoder path', diagnostics.decoderPath ?? '—'],
    ['Hardware decoding', hardwareDecodeStatus(api)],
    ['Hardware acceleration', diagnostics.hardwareAcceleration ?? 'Unknown'],
    ['Dropped frames', diagnostics.droppedFrames !== undefined ? `${diagnostics.droppedFrames} / ${diagnostics.totalFrames ?? 0}` : 'Not measurable'],
    ['Buffer ahead', diagnostics.bufferHealth !== undefined ? `${diagnostics.bufferHealth}s` : '—'],
    ['Source', diagnostics.url ?? 'Local file'],
  ];
  const dl = el('dl', { class: 'kv' });
  for (const [key, value] of rows) {
    dl.append(el('dt', { text: key }), el('dd', { text: String(value) }));
  }
  container.append(section('Playback', [dl]));

  const probe = api.pm.probe;
  if (probe?.notes?.length) {
    const notes = el('div', { class: 'p-note', style: { whiteSpace: 'pre-wrap', lineHeight: '1.6' } });
    notes.textContent = probe.notes.join('\n');
    container.append(section('Inspection notes', [notes]));
  }

  const actions = el('div', { class: 'row' });
  const copyButton = el('button', { class: 'btn btn--sm', html: `${icon('copy', 15)} Copy report` });
  copyButton.addEventListener('click', async () => {
    const report = JSON.stringify({ ...diagnostics, mime: buildMimeType(probe), userAgent: navigator.userAgent }, null, 2);
    try {
      await navigator.clipboard.writeText(report);
      toast('Diagnostics copied', 'ok');
    } catch {
      toast('Clipboard blocked — use Diagnostics page instead.', 'warn');
    }
  });
  actions.append(copyButton);
  container.append(section('Report', [actions]));

  return container;
}

/** Queue an external subtitle file in the download manager. */
async function downloadSubtitle(url: string, mediaName: string | undefined, language: string | undefined): Promise<void> {
  const { downloads } = await import('../../downloads/manager');
  const { subtitleFileName, isDownloadableSubtitle } = await import('../../downloads/naming');
  if (!isDownloadableSubtitle(url)) {
    toast('Bitmap subtitles (PGS/.sup) are images, not text — there is no file to save.', 'warn');
    return;
  }
  const job = await downloads.enqueue(url, { name: subtitleFileName(mediaName, language, url), kind: 'subtitle' });
  toast(job ? 'Subtitle added to Downloads' : 'That subtitle is already queued', job ? 'ok' : 'warn');
}

export function buildDanmakuPanel(api: PlayerApi): HTMLElement {
  const container = el('div');
  const settings = api.store.settings;

  const toggle = el('button', {
    class: `switch${settings.danmakuEnabled ? ' is-on' : ''}`,
    type: 'button',
    role: 'switch',
    'aria-checked': String(settings.danmakuEnabled),
  });
  toggle.innerHTML = '<span class="switch__thumb"></span>';
  toggle.addEventListener('click', () => {
    const next = !api.store.settings.danmakuEnabled;
    api.store.updateSettings({ danmakuEnabled: next });
    api.notify(next ? 'Danmaku on' : 'Danmaku off', 'info');
    api.refreshPanel();
  });

  const counter = el('div', { class: 'p-note', text: `${api.danmakuCount} comments loaded` });

  const composer = el('input', { class: 'input', type: 'text', placeholder: 'Say something at this moment…', maxlength: '120' });
  const send = el('button', { class: 'btn btn--sm btn--primary', type: 'button' });
  send.innerHTML = `${icon('message', 15)} Send`;
  const submit = () => {
    const value = composer.value.trim();
    if (!value) {
      composer.focus();
      return;
    }
    if (api.addDanmaku(value)) {
      composer.value = '';
      api.notify('Comment added', 'ok');
      api.refreshPanel();
    }
  };
  send.addEventListener('click', submit);
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.stopPropagation();
      submit();
    }
  });

  const fileInput = el('input', { type: 'file', class: 'hidden', accept: '.xml,.json,.txt' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const text = await file.text();
    const count = api.importDanmaku(text, file.name);
    api.notify(count ? `Loaded ${count} comments` : 'No comments found in that file', count ? 'ok' : 'warn');
    api.refreshPanel();
  });
  const importButton = el('button', { class: 'btn btn--sm', type: 'button' });
  importButton.innerHTML = `${icon('upload', 15)} Load .xml / .json`;
  importButton.addEventListener('click', () => fileInput.click());

  const clearButton = el('button', { class: 'btn btn--sm', type: 'button' });
  clearButton.innerHTML = `${icon('trash', 15)} Clear`;
  clearButton.addEventListener('click', () => {
    api.clearDanmaku();
    api.refreshPanel();
  });

  container.append(
    section('Danmaku', [
      el('div', { class: 'p-row' }, [
        el('span', { class: 'p-row__label', text: 'Bullet comments' }),
        toggle,
      ]),
      el('div', { class: 'row' }, [importButton, clearButton, fileInput]),
      counter,
      el('div', { class: 'p-note', text: 'Bilibili XML and ArtPlayer JSON are supported. Comments you add are kept for this session.' }),
    ]),
    section('Send a comment', [el('div', { class: 'row' }, [composer, send])]),
    section('Appearance', [
      sliderRow('Opacity', Math.round(settings.danmakuOpacity * 100), 20, 100, 5, (value) => {
        api.store.updateSettings({ danmakuOpacity: value / 100 });
      }, (value) => `${value}%`),
      sliderRow('Size', Math.round(settings.danmakuFontScale * 100), 60, 180, 5, (value) => {
        api.store.updateSettings({ danmakuFontScale: value / 100 });
      }, (value) => `${value}%`),
      sliderRow('Speed', Math.round(settings.danmakuSpeed * 100), 50, 200, 10, (value) => {
        api.store.updateSettings({ danmakuSpeed: value / 100 });
      }, (value) => `${value}%`),
      sliderRow('Screen area', Math.round(settings.danmakuArea * 100), 20, 100, 5, (value) => {
        api.store.updateSettings({ danmakuArea: value / 100 });
      }, (value) => `${value}%`),
    ]),
  );

  return container;
}

export function panelTitle(kind: string): string {
  switch (kind) {
    case 'tracks':
      return 'Tracks & quality';
    case 'audio':
      return 'Audio & equaliser';
    case 'subtitles':
      return 'Subtitles';
    case 'danmaku':
      return 'Danmaku';
    case 'video':
      return 'Picture';
    case 'playback':
      return 'Playback';
    case 'info':
      return 'Playback info';
    default:
      return 'Options';
  }
}

export function buildPanelBody(api: PlayerApi, kind: string): HTMLElement | Promise<HTMLElement> {
  switch (kind) {
    case 'tracks':
      return buildTracksPanel(api);
    case 'audio':
      return buildAudioPanel(api);
    case 'subtitles':
      return buildSubtitlesPanel(api);
    case 'danmaku':
      return buildDanmakuPanel(api);
    case 'video':
      return buildVideoPanel(api);
    case 'playback':
      return buildPlaybackPanel(api);
    case 'info':
      return buildInfoPanel(api);
    default:
      return el('div');
  }
}

export function currentSettings(api: PlayerApi): Settings {
  return api.store.settings;
}
