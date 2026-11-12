import type { PageContext, PageInstance } from './types';
import { el, esc, openModal, toast, downloadFile } from '../dom';
import { icon } from '../icons';
import { notice, pageHead, rangeControl, selectControl, settingRow, switchRow } from '../components';
import { deviceReport } from '../../core/deviceProfile';
import { ACCENT_CHOICES, DEFAULT_KEYBINDINGS, EQ_PRESETS, exportSettings, importSettings, KEY_ACTION_LABELS } from '../../storage/settings';
import { library } from '../../storage/library';
import { dbClearAll, storageEstimate } from '../../storage/db';
import { formatBytes } from '../../utils/format';
import { pwa } from '../../app/pwa';
import { isValidProxyTemplate } from '../../core/net';
import type { Settings } from '../../types';

type SectionId =
  | 'app'
  | 'general'
  | 'playback'
  | 'audio'
  | 'subtitles'
  | 'gestures'
  | 'network'
  | 'torrents'
  | 'performance'
  | 'decoder'
  | 'appearance'
  | 'privacy'
  | 'keyboard'
  | 'advanced';

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'app', label: 'App & install' },
  { id: 'playback', label: 'Playback' },
  { id: 'audio', label: 'Audio' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'gestures', label: 'Gestures' },
  { id: 'network', label: 'Network' },
  { id: 'torrents', label: 'Torrents' },
  { id: 'performance', label: 'Performance' },
  { id: 'decoder', label: 'Decoder' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'advanced', label: 'Advanced' },
];

const LANGUAGES = [
  ['', 'No preference'],
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['ml', 'Malayalam'],
  ['kn', 'Kannada'],
  ['bn', 'Bengali'],
  ['mr', 'Marathi'],
  ['gu', 'Gujarati'],
  ['pa', 'Punjabi'],
  ['ur', 'Urdu'],
  ['ar', 'Arabic'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['zh', 'Chinese'],
  ['th', 'Thai'],
  ['vi', 'Vietnamese'],
  ['id', 'Indonesian'],
];

export function createSettingsPage(ctx: PageContext): PageInstance {
  const { store, router } = ctx;
  const root = el('div', { class: 'page' });
  let active: SectionId = (ctx.router.current.params.section as SectionId) || 'general';
  if (!SECTIONS.some((section) => section.id === active)) active = 'general';

  const nav = el('div', { class: 'settings-nav' });
  const panel = el('div', { class: 'settings-panel' });
  const layout = el('div', { class: 'settings-layout' }, [nav, panel]);

  root.append(
    pageHead('Settings', 'Everything here is stored on this device. Changes apply immediately and survive reloads.', [
      el('button', { class: 'btn btn--sm', html: `${icon('refresh', 15)} Reset`, onclick: () => resetAll() }),
    ]),
    layout,
  );

  const s = () => store.settings;
  const update = (patch: Partial<Settings>) => store.updateSettings(patch);

  const resetAll = () => {
    openModal({
      title: 'Reset all settings?',
      description: 'Playback preferences return to defaults. History, bookmarks and playlists are kept.',
      confirmLabel: 'Reset settings',
      danger: true,
      onConfirm: () => {
        store.resetSettings();
        toast('Settings reset to defaults', 'ok');
        render();
      },
    });
  };

  const renderNav = () => {
    nav.innerHTML = '';
    for (const section of SECTIONS) {
      const button = el('button', { text: section.label, type: 'button' });
      if (section.id === active) button.classList.add('is-active');
      button.addEventListener('click', () => {
        active = section.id;
        router.navigate('settings', { section: section.id }, true);
        render();
      });
      nav.append(button);
    }
  };

  const sectionCard = (title: string, description: string, rows: Node[]): HTMLElement => {
    const card = el('div', { class: 'card' });
    card.innerHTML = `<div class="card__title">${esc(title)}</div><div class="card__desc">${esc(description)}</div>`;
    const body = el('div', { style: { marginTop: '10px' } });
    rows.forEach((row) => body.append(row));
    card.append(body);
    return card;
  };

  const renderPanel = () => {
    panel.innerHTML = '';
    const settings = s();

    switch (active) {
      case 'general': {
        const themes = el('div', { class: 'row' });
        for (const [value, label] of [['dark', 'Dark'], ['light', 'Light'], ['amoled', 'AMOLED black']] as const) {
          const button = el('button', { class: `btn btn--sm${settings.theme === value ? ' btn--primary' : ''}`, text: label });
          button.addEventListener('click', () => {
            update({ theme: value });
            render();
          });
          themes.append(button);
        }
        const accents = el('div', { class: 'row' });
        for (const color of ACCENT_CHOICES) {
          const swatch = el('button', {
            'aria-label': `Accent ${color}`,
            style: {
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: color,
              border: settings.accent === color ? '2px solid #fff' : '2px solid transparent',
              boxShadow: '0 2px 10px rgba(0,0,0,.4)',
              flex: 'none',
            },
          });
          swatch.addEventListener('click', () => {
            update({ accent: color });
            render();
          });
          accents.append(swatch);
        }

        panel.append(
          sectionCard('Appearance', 'Themes and accent colour.', [
            settingRow('Theme', 'AMOLED black saves power on OLED screens.', themes),
            settingRow('Accent colour', 'Used for highlights, controls and the playhead.', accents),
            settingRow('Density', 'Compact fits more rows on screen.', selectControl(settings.density, [
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ], (value) => update({ density: value as Settings['density'] }))),
          ]),
          sectionCard('Start-up behaviour', 'What happens when media opens.', [
            switchRow('Autoplay', 'Start playing as soon as the first frame is ready.', settings.autoPlay, (value) => update({ autoPlay: value })),
            switchRow('Start muted', 'Useful on mobile where autoplay with sound is blocked.', settings.startMuted, (value) => update({ startMuted: value })),
            switchRow('Remember playback position', 'Resume where you stopped, per file.', settings.rememberPosition, (value) => update({ rememberPosition: value })),
            settingRow('Resume threshold', 'Ignore saved positions shorter than this.', rangeControl(settings.resumeThreshold, 0, 120, 5, (value) => update({ resumeThreshold: value }))),
          ]),
          sectionCard('Language', 'Track preferences, applied when a file has several tracks.', [
            settingRow('Preferred audio language', 'Applied automatically when a file has multiple tracks.', selectControl(settings.preferredAudioLanguage, LANGUAGES.map(([value, label]) => ({ value, label })), (value) => update({ preferredAudioLanguage: value }))),
            settingRow('Fallback audio language', 'Used when the preferred language is missing.', selectControl(settings.fallbackAudioLanguage, LANGUAGES.map(([value, label]) => ({ value, label })), (value) => update({ fallbackAudioLanguage: value }))),
            switchRow('Prefer the original track', 'When a language preference also matches another track, keep the file’s default/original track instead.', settings.preferOriginalAudio, (value) => update({ preferOriginalAudio: value })),
          ]),
        );
        break;
      }

      case 'app': {
        const standalone = pwa.isStandalone;
        const stateLabel =
          standalone
            ? 'Installed — running as an app'
            : pwa.state === 'installable'
              ? 'Ready to install'
              : pwa.state === 'ios-manual'
                ? 'Install from Safari’s Share menu'
                : 'This browser does not offer installation';

        const installButton = el('button', {
          class: 'btn btn--primary btn--sm',
          html: `${icon('download', 15)} ${standalone ? 'Open as app' : 'Install OmniPlay'}`,
        });
        installButton.addEventListener('click', () => {
          if (standalone) {
            toast('Already running as an installed app.', 'ok');
            return;
          }
          // Delegate to the shell's install flow so iOS and Chrome share one path.
          document.querySelector<HTMLElement>('#install-app')?.click();
          if (!document.querySelector('#install-app:not(.hidden)')) {
            toast(
              pwa.isIOS
                ? 'On iOS: Share → Add to Home Screen.'
                : 'Installation is unavailable here. Use Chrome or Edge, over https.',
              'info',
            );
          }
        });

        const updateButton = el('button', { class: 'btn btn--sm', html: `${icon('refresh', 15)} Check for updates` });
        updateButton.addEventListener('click', async () => {
          const found = await pwa.checkForUpdate();
          if (found) {
            toast('Update found — applying…', 'ok');
            void pwa.applyUpdate();
          } else {
            toast('You are on the latest version.', 'ok');
          }
        });

        const persistButton = el('button', { class: 'btn btn--sm', html: `${icon('database', 15)} Protect local data` });
        persistButton.addEventListener('click', async () => {
          const ok = await pwa.requestPersistentStorage();
          toast(ok ? 'Storage is now persistent — the browser will not evict it.' : 'The browser declined persistent storage.', ok ? 'ok' : 'warn');
        });

        panel.append(
          sectionCard('Install as an app', 'Runs in its own window, works offline, and appears in your app list.', [
            el('div', { class: 'install-status' }, [
              el('span', { class: `chip ${standalone ? 'chip--ok' : pwa.state === 'installable' ? 'chip--accent' : ''}`, text: stateLabel }),
            ]),
            settingRow('Install', standalone ? 'Already installed on this device.' : 'Adds OmniPlay to your home screen or app menu.', installButton),
            settingRow('Offline mode', 'The app shell and all code are cached after the first visit.', el('span', { class: 'chip chip--ok', text: navigator.onLine ? 'Online · cached' : 'Offline · cached' })),
            settingRow('Persistent storage', 'Ask the browser not to evict your history and settings.', persistButton),
          ]),
          sectionCard('Updates', 'A new build is downloaded in the background; you choose when to reload.', [
            settingRow('Version', 'OmniPlay 1.24.0', updateButton),
            el('div', { class: 'notice notice--info', html: `${icon('info', 16)}<span>When an update is ready you get a “Reload” prompt — playback is never interrupted by a forced refresh.</span>` }),
          ]),
          sectionCard('Platform notes', 'What installation means on each platform.', [
            el('div', { class: 'stack', style: { gap: '10px' } }, [
              el('div', { class: 'p-note', text: 'Chrome / Edge (desktop & Android): install from the address bar or the button above. Opens in a standalone window with the media keys working.' }),
              el('div', { class: 'p-note', text: 'Safari on iOS / iPadOS: Share → Add to Home Screen. There is no install API, so the app shows the exact steps.' }),
              el('div', { class: 'p-note', text: 'Firefox desktop: installation is not offered; the app still works and caches itself for offline use.' }),
              el('div', { class: 'p-note', text: 'Local files cannot be reopened after a reload on any platform — that is a browser security rule, not an app limitation.' }),
            ]),
          ]),
        );
        break;
      }

      case 'playback': {
        panel.append(
          sectionCard('Speed & seeking', 'Defaults for every new file.', [
            settingRow('Default speed', 'You can still change it in the player.', selectControl(String(settings.defaultRate), [0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}×` })), (value) => update({ defaultRate: Number(value) }))),
            switchRow('Preserve audio pitch', 'Keeps voices natural when speeding up or slowing down (native engine).', settings.pitchPreserved, (value) => update({ pitchPreserved: value })),
            settingRow('Small seek step', 'Arrow keys and the seek buttons.', selectControl(String(settings.seekStep), [5, 10, 15, 30].map((value) => ({ value: String(value), label: `${value} seconds` })), (value) => update({ seekStep: Number(value) }))),
            settingRow('Large seek step', 'Shift+Arrow uses this step.', selectControl(String(settings.seekStepLarge), [15, 30, 60, 120].map((value) => ({ value: String(value), label: `${value} seconds` })), (value) => update({ seekStepLarge: Number(value) }))),
          ]),
          sectionCard('Queue', 'Behaviour when a video ends.', [
            switchRow('Auto-play next item', 'Continue with the next item in the queue.', settings.autoNext, (value) => update({ autoNext: value })),
            settingRow('Repeat', 'Loop the current item, the whole queue, or nothing.', selectControl(settings.loopMode, [
              { value: 'off', label: 'Off' },
              { value: 'one', label: 'Repeat one' },
              { value: 'all', label: 'Repeat queue' },
            ], (value) => update({ loopMode: value as Settings['loopMode'] }))),
            switchRow('Shuffle queue', 'Random order for the next items.', settings.shuffle, (value) => update({ shuffle: value })),
          ]),
          sectionCard('Skip', 'Quick-skip buttons for intros and outros.', [
            settingRow('Skip intro length', 'Seconds jumped by the “skip intro” action.', rangeControl(settings.skipIntroSeconds, 10, 300, 5, (value) => update({ skipIntroSeconds: value }))),
            settingRow('Skip outro threshold', 'Show the next-item prompt this many seconds before the end.', rangeControl(settings.skipOutroSeconds, 5, 120, 5, (value) => update({ skipOutroSeconds: value }))),
            switchRow('Frame stepping on pause', 'Use “.” and “,” to step frames while paused.', settings.frameStepOnPause, (value) => update({ frameStepOnPause: value })),
          ]),
        );
        break;
      }

      case 'audio': {
        const presetRow = el('div', { class: 'row' });
        for (const name of Object.keys(EQ_PRESETS)) {
          const button = el('button', { class: `btn btn--sm${settings.eqPreset === name ? ' btn--primary' : ''}`, text: name });
          button.addEventListener('click', () => {
            update({ eqPreset: name, eqGains: [...EQ_PRESETS[name]], eqEnabled: name !== 'Normal' });
            render();
          });
          presetRow.append(button);
        }
        panel.append(
          sectionCard('Equaliser', 'Ten bands, applied in the audio graph.', [
            switchRow('Enable equaliser', 'Effects need same-origin or CORS-enabled media.', settings.eqEnabled, (value) => update({ eqEnabled: value })),
            settingRow('Preset', 'Pick a starting point, then fine-tune in the player.', presetRow),
            ...EQ_FREQUENCY_ROWS(settings, update),
          ]),
          sectionCard('Tone', 'Global audio shaping.', [
            settingRow('Bass boost', 'Low-shelf gain at 120 Hz.', rangeControl(settings.bassBoost, -12, 12, 1, (value) => update({ bassBoost: value }))),
            settingRow('Balance', 'Left/right pan.', rangeControl(settings.balance, -1, 1, 0.05, (value) => update({ balance: value }))),
            switchRow('Mono downmix', 'Collapse everything to a single channel.', settings.mono, (value) => update({ mono: value })),
            switchRow('Volume normalisation', 'Gentle compression for uneven soundtracks.', settings.normalizeVolume, (value) => update({ normalizeVolume: value })),
            settingRow('Audio delay', 'Shift audio later to fix sync drift.', rangeControl(settings.audioDelayMs, 0, 2000, 50, (value) => update({ audioDelayMs: value }))),
          ]),
        );
        break;
      }

      case 'subtitles': {
        panel.append(
          sectionCard('Defaults', 'Applied to every subtitle track you load.', [
            switchRow('Subtitles enabled', 'Turn rendering on or off.', settings.subtitleEnabled, (value) => update({ subtitleEnabled: value })),
            switchRow('Auto-select preferred language', 'Choose the matching track when a file has several.', settings.autoLoadSubtitles, (value) => update({ autoLoadSubtitles: value })),
            settingRow('Preferred subtitle language', 'Used when embedded tracks exist.', selectControl(settings.preferredSubtitleLanguage, LANGUAGES.map(([value, label]) => ({ value, label })), (value) => update({ preferredSubtitleLanguage: value }))),
            settingRow('Default delay', 'Shift new subtitle tracks by this amount.', rangeControl(settings.subtitleDelayMs, -5000, 5000, 50, (value) => update({ subtitleDelayMs: value }))),
          ]),
          sectionCard('Style', 'ASS/SSA files keep their own styling; these values apply to SRT, VTT and TTML.', [
            settingRow('Font family', 'Any font installed on your device.', selectControl(settings.subtitleFont, ['Inter', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Georgia', 'Trebuchet MS', 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Tamil'].map((value) => ({ value, label: value })), (value) => update({ subtitleFont: value }))),
            settingRow('Font size', 'Scales with the player size.', rangeControl(settings.subtitleSize, 12, 64, 1, (value) => update({ subtitleSize: value }))),
            settingRow('Weight', 'Text thickness.', rangeControl(settings.subtitleWeight, 300, 900, 100, (value) => update({ subtitleWeight: value }))),
            settingRow('Colour', 'Primary subtitle colour.', colorControl(settings.subtitleColor, (value) => update({ subtitleColor: value }))),
            settingRow('Outline', 'Dark border for readability.', rangeControl(settings.subtitleOutline, 0, 8, 0.5, (value) => update({ subtitleOutline: value }))),
            settingRow('Shadow', 'Soft drop shadow.', rangeControl(settings.subtitleShadow, 0, 20, 1, (value) => update({ subtitleShadow: value }))),
            settingRow('Opacity', 'Text transparency.', rangeControl(settings.subtitleOpacity, 0.2, 1, 0.05, (value) => update({ subtitleOpacity: value }))),
            settingRow('Background', 'Translucent box behind the text.', rangeControl(settings.subtitleBackground, 0, 0.9, 0.05, (value) => update({ subtitleBackground: value }))),
            settingRow('Vertical position', 'Distance from the bottom.', rangeControl(settings.subtitlePosition, 0, 45, 1, (value) => update({ subtitlePosition: value }))),
            settingRow('Width', 'Maximum line width.', rangeControl(settings.subtitleWidth, 30, 100, 1, (value) => update({ subtitleWidth: value }))),
          ]),
        );
        break;
      }

      case 'gestures': {
        panel.append(
          sectionCard('Touch gestures', 'Designed for phones and tablets; ignored on desktop mice.', [
            switchRow('Enable gestures', 'Master switch for the gesture layer.', settings.gesturesEnabled, (value) => update({ gesturesEnabled: value })),
            switchRow('Double-tap seek', 'Left/right zones skip, centre toggles play.', settings.doubleTapSeek, (value) => update({ doubleTapSeek: value })),
            settingRow('Double-tap step', 'Seconds skipped per double tap.', selectControl(String(settings.doubleTapSeekSeconds), [5, 10, 15, 30].map((value) => ({ value: String(value), label: `${value} seconds` })), (value) => update({ doubleTapSeekSeconds: Number(value) }))),
            switchRow('Horizontal swipe to seek', 'Scrub across the width of the video.', settings.swipeSeek, (value) => update({ swipeSeek: value })),
            settingRow('Swipe sensitivity', 'How far a full-width swipe moves.', rangeControl(settings.swipeSeekSensitivity, 0.3, 3, 0.1, (value) => update({ swipeSeekSensitivity: value }))),
            settingRow('Vertical swipe', 'Right side is always volume when both are enabled.', selectControl(settings.verticalSwipe, [
              { value: 'volume-brightness', label: 'Volume (right) & brightness (left)' },
              { value: 'volume', label: 'Volume only' },
              { value: 'off', label: 'Off' },
            ], (value) => update({ verticalSwipe: value as Settings['verticalSwipe'] }))),
            switchRow('Pinch to zoom', 'Two-finger pinch scales the picture.', settings.pinchZoom, (value) => update({ pinchZoom: value })),
            settingRow('Long-press speed', 'Temporary speed while holding the screen.', selectControl(String(settings.longPressSpeed), [1.5, 2, 2.5, 3].map((value) => ({ value: String(value), label: `${value}×` })), (value) => update({ longPressSpeed: Number(value) }))),
          ]),
          sectionCard('Brightness note', 'Browsers cannot change the device’s display brightness.', [
            el('div', { class: 'notice notice--info', html: `${icon('info', 16)}<span>Vertical swipe on the left adjusts a video brightness filter. It dims the picture inside the player — it does not change your screen brightness.</span>` }),
          ]),
        );
        break;
      }

      case 'performance': {
        const detected = deviceReport();
        const select = el('select', { class: 'select' }) as HTMLSelectElement;
        for (const [value, label] of [
          ['auto', `Auto (detected: ${detected.profile})`],
          ['low', 'Low memory'],
          ['balanced', 'Balanced'],
          ['high', 'High performance'],
          ['tv', 'TV / big screen'],
        ] as Array<[string, string]>) {
          const option = el('option', { value, text: label });
          if (settings.deviceProfile === value) option.selected = true;
          select.append(option);
        }
        select.addEventListener('change', () => {
          store.updateSettings({ deviceProfile: select.value as typeof settings.deviceProfile });
          void import('../../core/deviceProfile').then((mod) => {
            const profile = select.value === 'auto' ? mod.deviceReport().profile : (select.value as never);
            mod.applyProfileToDocument(profile);
          });
          toast('Device profile applied', 'ok');
        });
        panel.append(
          sectionCard('Device profile', 'Decode resolution, frame queues and effects follow this.', [
            settingRow('Profile', detected.reasons.join(' · '), select),
            notice(
              `Detected: ${detected.memoryGb ?? 'unknown'} GB memory, ${detected.cores ?? 'unknown'} cores, ${detected.mobile ? 'mobile' : 'desktop'}. Unknown values get the conservative profile on purpose.`,
              'info',
            ),
          ]),
        );
        break;
      }

      case 'torrents': {
        const gatewayInput = el('input', {
          class: 'input',
          type: 'url',
          placeholder: 'https://webtor.example/{magnet}',
          value: settings.torrentGateway,
          spellcheck: 'false',
        });
        gatewayInput.addEventListener('change', () => {
          store.updateSettings({ torrentGateway: gatewayInput.value.trim() });
          toast(gatewayInput.value.trim() ? 'Torrent gateway saved' : 'Gateway cleared — WebTorrent only', 'ok');
        });
        const providerSelect = el('select', { class: 'select' }) as HTMLSelectElement;
        for (const [value, label] of [
          ['auto', 'Auto — my gateway, else webtor.io'],
          ['webtor', 'webtor.io (third party)'],
          ['gateway', 'My gateway only'],
          ['webtorrent', 'In-page WebTorrent only'],
        ] as Array<[string, string]>) {
          const option = el('option', { value, text: label });
          if (settings.torrentProvider === value) option.selected = true;
          providerSelect.append(option);
        }
        providerSelect.addEventListener('change', () => {
          store.updateSettings({ torrentProvider: providerSelect.value as never });
          toast('Torrent provider updated', 'ok');
        });

        panel.append(
          sectionCard('Torrent provider', 'How a magnet link is turned into playable video.', [
            settingRow('Provider', 'webtor.io streams any magnet through their servers; your own gateway keeps the traffic yours.', providerSelect),
          ]),
          sectionCard('Torrent gateway', 'Browsers cannot reach classic TCP swarms. A gateway fetches the torrent server-side and serves the file over HTTP.', [
            settingRow('Gateway URL', 'Use {magnet} or {hash} as the placeholder. Leave empty for WebTorrent only.', gatewayInput),
            notice(
              'Without a gateway, only swarms with WebRTC peers or a web seed (ws=) can stream. Most public magnets do not have either.',
              'info',
            ),
          ]),
          sectionCard('How playback works', 'Two engines, one button.', [
            el('p', { class: 'p-note', text: 'WebTorrent runs in the page and downloads the file before playing it — good for small files and well-seeded WebRTC swarms. A gateway is instant because it supports HTTP range requests, so the player can seek straight away.' }),
          ]),
        );
        break;
      }

      case 'network': {
        const proxyInput = el('input', {
          class: 'input',
          type: 'url',
          placeholder: 'https://my-worker.dev/?url={url}',
          value: settings.corsProxy,
          spellcheck: 'false',
        });
        proxyInput.addEventListener('change', () => {
          const value = proxyInput.value.trim();
          if (!isValidProxyTemplate(value)) {
            toast('Use an http(s) URL, ideally ending with “/” or containing “{url}”.', 'warn');
            return;
          }
          store.updateSettings({ corsProxy: value });
          toast(value ? 'CORS proxy saved — reload the link to use it.' : 'CORS proxy cleared.', 'ok');
        });
        panel.append(
          sectionCard('CORS proxy', 'For hosts that block browser access — signed buckets, download gateways.', [
            settingRow(
              'Proxy URL',
              'Requests are rewritten to this template; {url} is replaced with the encoded target. Leave empty to connect directly.',
              proxyInput,
            ),
            el('div', {
              class: 'notice notice--info',
              html: `${icon('shield', 16)}<span>The proxy can see the links you play — use one you control or trust. Your proxy must answer OPTIONS (a Range header triggers a preflight) and forward Range/Content-Range. The player tries ?url=, ?u= and path-style automatically. HLS and DASH (MPD, init and media segments) are proxied.</span>`,
            }),
            el('div', {
              class: 'p-note',
              text: 'Minimal Cloudflare Worker: read ?url=, fetch it with the incoming Range header, and return the body with Access-Control-Allow-Origin: * and Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges.',
            }),
          ]),
          sectionCard('Requests', 'Applies to HLS, DASH and direct links.', [
            settingRow('Timeout', 'Give up after this long.', selectControl(String(settings.requestTimeout), [5, 10, 20, 30, 60].map((value) => ({ value: String(value), label: `${value} seconds` })), (value) => update({ requestTimeout: Number(value) }))),
            settingRow('Retries', 'Attempts for failed manifests and segments.', selectControl(String(settings.retryCount), [0, 1, 2, 3, 5].map((value) => ({ value: String(value), label: String(value) })), (value) => update({ retryCount: Number(value) }))),
            settingRow('Buffer ahead', 'Seconds of stream to keep ready.', selectControl(String(settings.bufferAhead), [10, 20, 30, 60, 90].map((value) => ({ value: String(value), label: `${value} seconds` })), (value) => update({ bufferAhead: Number(value) }))),
            switchRow('Low-latency live', 'Prefer a shorter live delay when the stream allows it.', settings.lowLatencyLive, (value) => update({ lowLatencyLive: value })),
          ]),
          sectionCard('Custom headers', 'Optional “Name: value” lines, one per line. Forbidden headers are ignored by the browser.', [
            headerEditor(settings.customHeaders, (value) => update({ customHeaders: value })),
          ]),
        );
        break;
      }

      case 'performance': {
        panel.append(
          sectionCard('Memory', 'Keep playback smooth on phones with 3 GB of RAM.', [
            settingRow('Low-memory mode', 'Auto follows the device’s reported memory.', selectControl(settings.lowMemoryMode, [
              { value: 'auto', label: 'Auto' },
              { value: 'on', label: 'Always on' },
              { value: 'off', label: 'Off' },
            ], (value) => update({ lowMemoryMode: value as Settings['lowMemoryMode'] }))),
            settingRow('Maximum buffer', 'Cap on buffered media in megabytes.', rangeControl(settings.maxBufferMb, 64, 1024, 32, (value) => update({ maxBufferMb: value }))),
          ]),
          sectionCard('Timeline previews', 'Small frames shown when hovering the timeline.', [
            switchRow('Enable previews', 'Decodes a few low-resolution frames, never the whole file.', settings.thumbnailPreviews, (value) => update({ thumbnailPreviews: value })),
            settingRow('Preview quality', 'More frames means a smoother scrub preview.', selectControl(settings.thumbnailQuality, [
              { value: 'low', label: 'Low (8 frames)' },
              { value: 'medium', label: 'Medium (12 frames)' },
              { value: 'high', label: 'High (20 frames)' },
            ], (value) => update({ thumbnailQuality: value as Settings['thumbnailQuality'] }))),
          ]),
        );
        break;
      }

      case 'decoder': {
        panel.append(
          sectionCard('Engine selection', 'The player always prefers hardware decoding when the browser offers it.', [
            settingRow('Engine preference', 'Auto is recommended. Overrides apply to the next file you open.', selectControl(settings.enginePreference, [
              { value: 'auto', label: 'Auto (recommended)' },
              { value: 'native', label: 'Native first' },
              { value: 'webcodecs', label: 'WebCodecs first' },
            ], (value) => update({ enginePreference: value as Settings['enginePreference'] }))),
            switchRow('Allow WebCodecs', 'Software decoding for MKV, AVI and unusual codecs.', settings.allowWebCodecs, (value) => update({ allowWebCodecs: value })),
            switchRow('Prefer hardware acceleration', 'Ask the browser for hardware decoding where available.', settings.preferHardware, (value) => update({ preferHardware: value })),
          ]),
          sectionCard('Why some files still fail', 'A browser has fewer decoders than VLC.', [
            el('div', { class: 'notice notice--warn', html: `${icon('alert', 16)}<span>Codecs such as DTS, TrueHD, VC-1, RMVB and ProRes often have no browser decoder at all. In that case OmniPlay reports the exact codec and suggests re-encoding instead of pretending to play.</span>` }),
          ]),
        );
        break;
      }

      case 'appearance': {
        panel.append(
          sectionCard('Player chrome', 'How the controls behave while watching.', [
            settingRow('Auto-hide delay', 'How long controls stay visible during playback.', rangeControl(settings.playerChromeDelay, 800, 8000, 200, (value) => update({ playerChromeDelay: value }))),
            switchRow('Show diagnostics overlay', 'Small engine/codec badge over the video.', settings.showDiagnosticsOverlay, (value) => update({ showDiagnosticsOverlay: value })),
            switchRow('Reduce motion', 'Minimise interface animations.', settings.reduceMotion, (value) => update({ reduceMotion: value })),
          ]),
          sectionCard('Colour', 'Theme and accent live in General.', [
            settingRow('Accent preview', 'Click a swatch to change it instantly.', (() => {
              const row = el('div', { class: 'row' });
              for (const color of ACCENT_CHOICES) {
                const swatch = el('button', { 'aria-label': color, style: { width: '34px', height: '34px', borderRadius: '50%', background: color, border: settings.accent === color ? '2px solid #fff' : '2px solid transparent', flex: 'none' } });
                swatch.addEventListener('click', () => {
                  update({ accent: color });
                  render();
                });
                row.append(swatch);
              }
              return row;
            })()),
          ]),
        );
        break;
      }

      case 'privacy': {
        const storageRow = el('div', { class: 'card__desc', text: 'Checking storage…' });
        void storageEstimate().then((estimate) => {
          storageRow.textContent = estimate
            ? `Using ${formatBytes(estimate.usage)} of about ${formatBytes(estimate.quota)} available to this site.`
            : 'This browser does not expose a storage estimate.';
        });

        const exportButton = el('button', { class: 'btn btn--sm', html: `${icon('download', 15)} Export settings` });
        exportButton.addEventListener('click', () => {
          downloadFile('omniplay-settings.json', exportSettings(store.settings));
          toast('Settings exported', 'ok');
        });
        const importInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
        importInput.addEventListener('change', async () => {
          const file = importInput.files?.[0];
          importInput.value = '';
          if (!file) return;
          try {
            const { settings: imported, count } = importSettings(await file.text());
            store.replaceSettings(imported);
            toast(`Imported ${count} settings`, 'ok');
            render();
          } catch (error) {
            toast(`Import failed: ${(error as Error).message}`, 'err');
          }
        });
        const importButton = el('button', { class: 'btn btn--sm', html: `${icon('upload', 15)} Import settings` });
        importButton.addEventListener('click', () => importInput.click());

        panel.append(
          sectionCard('What is stored', 'Everything stays in this browser.', [
            el('div', { class: 'notice notice--ok', html: `${icon('shield', 16)}<span>OmniPlay has no backend. History, bookmarks, playlists and settings are written to IndexedDB/localStorage on this device. No media, URLs or viewing data is transmitted anywhere.</span>` }),
            storageRow,
            switchRow('Save watch history', 'Store progress and recently played items.', settings.saveHistory, (value) => update({ saveHistory: value })),
            switchRow('Remember pasted links', 'Keep a local list of recent direct URLs.', settings.saveUrlHistory, (value) => update({ saveUrlHistory: value })),
            switchRow('Remember volume', 'Restore your last volume when opening media.', settings.persistVolume, (value) => update({ persistVolume: value })),
          ]),
          sectionCard('Clear data', 'Irreversible, and only affects this browser.', [
            settingRow('History', 'Remove every history entry.', actionButton('Clear', () => { void library.clearHistory(); toast('History cleared', 'ok'); }, true)),
            settingRow('Bookmarks', 'Remove every saved moment.', actionButton('Clear', () => { void library.clearBookmarks(); toast('Bookmarks cleared', 'ok'); }, true)),
            settingRow('Recent links', 'Remove the pasted-URL list.', actionButton('Clear', () => { void library.clearUrls(); toast('Recent links cleared', 'ok'); }, true)),
            settingRow('Everything', 'History, bookmarks, playlists, thumbnails and settings.', actionButton('Wipe all local data', () => {
              openModal({
                title: 'Wipe all local data?',
                description: 'This removes history, bookmarks, playlists, cached thumbnails and settings from this browser.',
                confirmLabel: 'Wipe everything',
                danger: true,
                onConfirm: async () => {
                  await dbClearAll();
                  store.resetSettings();
                  toast('All local data cleared', 'ok');
                  render();
                },
              });
            }, true)),
          ]),
          sectionCard('Backup', 'Move your preferences between browsers.', [
            settingRow('Settings file', 'JSON export and import.', el('div', { class: 'row' }, [exportButton, importButton, importInput])),
          ]),
        );
        break;
      }

      case 'keyboard': {
        const list = el('div');
        for (const [action, label] of Object.entries(KEY_ACTION_LABELS)) {
          const key = settings.keyboardBindings[action] ?? DEFAULT_KEYBINDINGS[action] ?? '';
          const button = el('button', { class: 'btn btn--sm', text: key || 'Unset', style: { minWidth: '86px', fontFamily: 'var(--font-mono)' } });
          button.addEventListener('click', () => {
            button.textContent = 'Press a key…';
            const capture = (event: KeyboardEvent) => {
              event.preventDefault();
              event.stopPropagation();
              window.removeEventListener('keydown', capture, true);
              if (event.key === 'Escape') {
                render();
                return;
              }
              const binding = event.key === ' ' ? 'Space' : event.key;
              update({ keyboardBindings: { ...s().keyboardBindings, [action]: binding } });
              render();
            };
            window.addEventListener('keydown', capture, true);
          });
          list.append(settingRow(label, '', button));
        }
        panel.append(
          sectionCard('Keyboard shortcuts', 'Click a binding, then press the new key. Escape cancels.', [
            switchRow('Enable keyboard control', 'Shortcuts never fire while typing in a field.', settings.keyboardEnabled, (value) => update({ keyboardEnabled: value })),
            list,
            el('div', { class: 'row', style: { marginTop: '10px' } }, [
              el('button', {
                class: 'btn btn--sm',
                text: 'Restore defaults',
                onclick: () => {
                  update({ keyboardBindings: { ...DEFAULT_KEYBINDINGS } });
                  render();
                },
              }),
            ]),
          ]),
        );
        break;
      }

      case 'advanced': {
        panel.append(
          sectionCard('Diagnostics', 'For troubleshooting playback problems.', [
            settingRow('Log level', 'Console output from engines and the player.', selectControl(settings.logLevel, [
              { value: 'off', label: 'Off' },
              { value: 'error', label: 'Errors' },
              { value: 'warn', label: 'Warnings' },
              { value: 'info', label: 'Info' },
              { value: 'debug', label: 'Debug' },
            ], (value) => update({ logLevel: value as Settings['logLevel'] }))),
            settingRow('Diagnostics page', 'Capability report, codec matrix and last playback.', actionButton('Open diagnostics', () => router.navigate('diagnostics'))),
          ]),
          sectionCard('Reset', 'Return the player to its default configuration.', [
            settingRow('All settings', 'History and bookmarks are kept.', actionButton('Reset to defaults', resetAll, true)),
          ]),
          sectionCard('Build', 'Version information.', [
            el('div', { class: 'code-block', text: 'OmniPlay 1.24.0\nEngines: native · hls.js · dash.js · WebCodecs (mediabunny)\nSubtitles: SRT · VTT · ASS/SSA · TTML' }),
          ]),
        );
        break;
      }
    }
  };

  const render = () => {
    renderNav();
    renderPanel();
  };

  render();

  // Controls keep their own state; re-rendering on every keystroke would steal
  // focus and scroll position, so the panel only re-renders on explicit actions.
  return {
    el: root,
    onParams: (params) => {
      const next = (params.section as SectionId) || 'general';
      if (!SECTIONS.some((section) => section.id === next) || next === active) return;
      active = next;
      render();
    },
  };
}

function actionButton(text: string, onClick: () => void, danger = false): HTMLElement {
  const button = el('button', { class: `btn btn--sm${danger ? ' btn--danger' : ''}`, text });
  button.addEventListener('click', onClick);
  return button;
}

function colorControl(value: string, onChange: (value: string) => void): HTMLElement {
  const input = el('input', { type: 'color', value, style: { width: '42px', height: '30px', borderRadius: '8px', border: '1px solid var(--line)', background: 'transparent' } });
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

function headerEditor(value: string, onChange: (value: string) => void): HTMLElement {
  const area = el('textarea', { class: 'input', placeholder: 'Referer: https://example.com', spellcheck: 'false' });
  area.value = value;
  area.addEventListener('change', () => onChange(area.value));
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Headers' }),
    area,
    el('span', { class: 'field__hint', text: 'One per line. User-Agent, Origin, Referer and Cookie are controlled by the browser and cannot be set from JavaScript.' }),
  ]);
}

function EQ_FREQUENCY_ROWS(settings: Settings, update: (patch: Partial<Settings>) => void): Node[] {
  return [
    settingRow(
      'Custom curve',
      'Drag each band from −12 dB to +12 dB. Saving here updates the equaliser immediately.',
      (() => {
        const wrap = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-end', height: '64px' } });
        [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].forEach((frequency, index) => {
          const column = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } });
          const input = el('input', {
            type: 'range',
            min: '-12',
            max: '12',
            step: '1',
            value: String(settings.eqGains[index] ?? 0),
            style: { writingMode: 'vertical-lr', direction: 'rtl', height: '46px', width: '18px' },
            'aria-label': `${frequency} Hz`,
          });
          input.addEventListener('input', () => {
            const gains = [...settings.eqGains];
            gains[index] = Number(input.value);
            update({ eqGains: gains, eqPreset: 'Custom', eqEnabled: true });
          });
          column.append(input, el('span', { style: { fontSize: '9px', color: 'var(--txt-3)' }, text: frequency >= 1000 ? `${frequency / 1000}k` : String(frequency) }));
          wrap.append(column);
        });
        return wrap;
      })(),
    ),
  ];
}
