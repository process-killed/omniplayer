import type { AppErrorInfo, Chapter, EngineKind, MediaSourceSpec, TrackInfo } from '../../types';
import type { PageContext, PageInstance } from '../pages/types';
import { el, esc, toast, copyText, isTypingTarget, showPopover, closePopover } from '../dom';
import { icon } from '../icons';
import { PlaybackManager } from '../../core/playbackManager';
import { SubtitleManager } from '../../subtitles/subtitleManager';
import {
  blobSource,
  extractMatroskaSubtitles,
  scanMatroskaTracks,
  urlSource,
  type MkvSubtitleTrack,
} from '../../subtitles/matroska';
import { parseSubtitle } from '../../subtitles/parser';
import { DEFAULT_KEYBINDINGS, KEY_ACTION_LABELS } from '../../storage/settings';
import { DanmakuEngine, parseDanmaku, randomDanmakuColor } from '../../danmaku/engine';
import { rankSources, recordAttempt, rememberSource, preferredSource } from '../../core/sourceHealth';
import { loadPlaybackState, savePlaybackState } from '../../storage/playbackState';
import { ResourceGovernor } from '../../core/resourceGovernor';
import { budgetsFor, deviceReport } from '../../core/deviceProfile';
import { GestureManager } from '../../gestures/gestures';
import { KeyboardManager, type KeyboardHandlers } from '../../gestures/keyboard';
import { audioProcessor } from '../../audio/audioProcessor';
import { applyAdjustments, applyAspect, DEFAULT_ADJUSTMENTS, type VideoAdjustments } from '../../video/adjustments';
import { library } from '../../storage/library';
import { thumbnails, type StoryboardFrame } from '../../media/thumbnails';
import { formatTime, clamp, codecLabel, languageName } from '../../utils/format';
import { buildPanelBody, panelTitle } from './panels';
import type { AbLoop, PanelKind, PlayerApi } from './api';
import type { EmbedOptions } from '../../app/embed';
import { AppError, toAppError } from '../../core/errors';
import { detectCapabilities } from '../../core/capabilities';
import { proxiedUrl } from '../../core/net';
import { log } from '../../utils/log';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export interface PlayerPageOptions {
  mode?: 'app' | 'embed';
  embed?: EmbedOptions;
}

export function createPlayerPage(ctx: PageContext, options: PlayerPageOptions = {}): PageInstance {
  return new PlayerPage(ctx, options);
}

class PlayerPage implements PageInstance, PlayerApi {
  readonly el: HTMLElement;
  readonly pm: PlaybackManager;
  readonly subtitles: SubtitleManager;
  readonly store: PageContext['store'];

  private readonly ctx: PageContext;
  private readonly stage: HTMLElement;
  private readonly mediaWrap: HTMLElement;
  private readonly subsLayer: HTMLElement;
  private readonly assLayer: HTMLElement;
  private readonly gestureLayer: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly panelHost: HTMLElement;
  private readonly tl: HTMLElement;
  private readonly tlPlayed: HTMLElement;
  private readonly tlBuffered: HTMLElement;
  private readonly tlHandle: HTMLElement;
  private readonly tlChapters: HTMLElement;
  private readonly tlAb: HTMLElement;
  private readonly tlHover: HTMLElement;
  private readonly tlHoverImg: HTMLImageElement;
  private readonly tlHoverLabel: HTMLElement;
  private readonly timeCurrent: HTMLElement;
  private readonly timeDuration: HTMLElement;
  private readonly timeChapter: HTMLElement;
  private readonly liveBadge: HTMLElement;
  private readonly playButton: HTMLElement;
  private readonly titleNode: HTMLElement;
  private readonly subtitleNode: HTMLElement;
  private readonly speedButton: HTMLElement;
  private readonly qualityButton: HTMLElement;
  private readonly hudCenter: HTMLElement;
  private readonly hudLeft: HTMLElement;
  private readonly hudRight: HTMLElement;
  private readonly seekPreview: HTMLElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly centerPlay: HTMLElement;
  private readonly moreButton: HTMLElement;
  private readonly sleepChip: HTMLElement;
  private embeddedTracksValue: MkvSubtitleTrack[] = [];
  private embeddedBusy = false;
  private degradedNoticeShown = false;
  private embeddedLoaded = new Set<number>();
  private readonly gestures: GestureManager;
  private readonly keyboard: KeyboardManager;

  private unsubs: Array<() => void> = [];
  private rafId = 0;
  private chromeTimer = 0;
  private hudTimer = 0;
  private sleepTimerId = 0;
  private sleepEndsAt: number | null = null;
  private storyboard: StoryboardFrame[] = [];
  private storyboardToken = 0;
  private media: MediaSourceSpec | null = null;
  private adjustmentsValue: VideoAdjustments = { ...DEFAULT_ADJUSTMENTS };
  private brightnessValue = 1;
  private rateValue = 1;
  private abLoopValue: AbLoop = { a: null, b: null };
  private chaptersValue: Chapter[] = [];
  private lastVolume = 1;
  private mutedValue = false;
  private longPressRate: number | null = null;
  private panelKind: PanelKind | null = null;
  private panelBody: HTMLElement | null = null;
  private destroyed = false;
  private endedHandled = false;
  private wakeLock: WakeLockSentinel | null = null;
  private lastHistorySave = 0;
  private lastUiUpdate = 0;
  private draggedTimeline = false;

  private readonly danmaku: DanmakuEngine;
  private readonly options: PlayerPageOptions;
  private embedLoop = false;
  private embedPosterShown = false;
  private statsTimer = 0;
  private statsVisible = false;
  private shortcutsNode: HTMLElement | null = null;
  private lockNode: HTMLElement | null = null;

  constructor(ctx: PageContext, options: PlayerPageOptions = {}) {
    this.ctx = ctx;
    this.options = options;
    this.store = ctx.store;
    // Built here, not as a field initializer: field initializers run before
    // `this.store` exists.
    const storedProfile = this.store.settings.deviceProfile;
    this.governor = new ResourceGovernor(storedProfile === 'auto' ? deviceReport().profile : storedProfile);
    this.pm = new PlaybackManager(() => this.store.settings);
    this.el = el('div', { class: 'player', 'data-chrome': 'visible', tabindex: '-1' });
    this.el.innerHTML = TEMPLATE;
    document.body.classList.add('is-playing');

    const q = <T extends HTMLElement>(selector: string): T => {
      const node = this.el.querySelector<T>(selector);
      if (!node) throw new Error(`Missing player element: ${selector}`);
      return node;
    };

    this.stage = q('.player__stage');
    this.mediaWrap = q('.player__media');
    this.subsLayer = q('.subs-layer');
    this.assLayer = q('.ass-layer');
    this.gestureLayer = q('.gesture-layer');
    this.loading = q('.player__loading');
    this.errorBox = q('.player__error');
    this.panelHost = q('.panel-host');
    this.tl = q('.tl');
    this.tlPlayed = q('.tl__played');
    this.tlBuffered = q('.tl__buffered');
    this.tlHandle = q('.tl__handle');
    this.tlChapters = q('.tl__chapters');
    this.tlAb = q('.tl__ab');
    this.tlHover = q('.tl__hover');
    this.tlHoverImg = q('.tl__hover img');
    this.tlHoverLabel = q('.tl__hover span');
    this.timeCurrent = q('.time-row b');
    this.timeDuration = q('.time-row .duration');
    this.timeChapter = q('.time-row .chapter');
    this.liveBadge = q('.time-row .live-badge');
    this.liveBadge.addEventListener('click', (event) => {
      event.stopPropagation();
      const edge = this.pm.duration;
      if (Number.isFinite(edge) && edge > 0) {
        this.pm.seek(edge);
        this.showHud(this.hudCenter, 'activity', 'At live edge');
      }
    });
    this.playButton = q('#btn-play');
    this.titleNode = q('.pbar__title h1');
    this.subtitleNode = q('.pbar__title p');
    this.speedButton = q('#btn-speed');
    this.qualityButton = q('#btn-quality');
    this.hudCenter = q('#hud-center');
    this.hudLeft = q('#hud-left');
    this.hudRight = q('#hud-right');
    this.seekPreview = q('.seek-preview');
    this.volumeInput = q('#volume-range');
    this.sleepChip = q('.sleep-chip');
    this.centerPlay = q('#center-play');
    this.moreButton = q('#btn-more');

    this.subtitles = new SubtitleManager(this.subsLayer, this.assLayer, this.el.querySelector<HTMLCanvasElement>('.subs-canvas'));
    this.subtitles.setProxyResolver((url) => proxiedUrl(url, this.store.settings));
    this.danmaku = new DanmakuEngine(q('.danmaku-host'));
    thumbnails.setSettingsProvider(() => this.store.settings);
    this.subtitles.setSettings(this.store.settings);
    this.pm.attachContainer(this.mediaWrap);

    this.gestures = new GestureManager(
      this.gestureLayer,
      {
        onTap: () => this.toggleChrome(),
        onDoubleTap: (zone) => this.handleDoubleTap(zone),
        onSeekPreview: (target, delta) => this.showSeekPreview(target, delta),
        onSeekCommit: (target) => {
          this.hideSeekPreview();
          this.pm.seek(target);
        },
        onVolumeDelta: (delta) => this.changeVolume(delta),
        onBrightnessDelta: (delta) => this.changeBrightness(delta),
        onZoomChange: (zoom) => this.setAdjustments({ ...this.adjustmentsValue, zoom }),
        onLongPressStart: () => this.startLongPress(),
        onLongPressEnd: () => this.endLongPress(),
        getCurrentTime: () => this.pm.currentTime,
        getDuration: () => this.pm.duration,
        getZoom: () => this.adjustmentsValue.zoom,
      },
      () => this.store.settings,
    );

    this.keyboard = new KeyboardManager(this.keyboardHandlers(), () => this.store.settings);

    this.applyEmbedMode();
    this.el.addEventListener('keydown', (event) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault();
        this.showShortcuts();
      } else if (event.key.toLowerCase() === 'd' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        this.toggleDanmaku();
      }
    });

    this.stage.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openContextMenu(event.clientX, event.clientY);
    });

    this.wireControls();
    this.applyPlatformCapabilities();
    this.wirePlaybackEvents();
    this.setupBridge();
    this.setupMediaSession();
    this.watchConnection();
    this.wireStoreEvents();
    this.gestures.attach();
    this.keyboard.attach();
    this.startLoop();
    this.showChrome();

    const pending = ctx.session.takePendingSubtitles();
    void this.loadCurrent(pending);
  }

  /* ------------------------------------------------------------------ load */

  private async loadCurrent(pendingSubtitles: File[] = [], options: { ignoreCorsBlock?: boolean } = {}): Promise<void> {
    this.degradedNoticeShown = false;
    this.danmaku.clear();
    this.applyDanmakuSettings();
    this.mutedValue = this.store.settings.muted;
    this.brightnessValue = clamp(this.brightnessValue, 0.2, 2);
    const media = this.store.current;
    if (!media) {
      this.ctx.router.navigate('home');
      return;
    }
    if (media.provider) {
      this.showProvider(media.provider);
      return;
    }
    this.hideProvider();

    if (media.url && /^magnet:\?/i.test(media.url)) {
      const resolved = await this.resolveTorrent(media.url);
      if (!resolved) return;
      media.url = resolved.url;
      media.name = resolved.name;
    }

    this.media = media;
    this.endedHandled = false;
    this.lastHistorySave = 0;
    this.chaptersValue = [];
    this.abLoopValue = { a: null, b: null };
    this.storyboard = [];
    this.storyboardToken++;
    this.updateTitle();
    this.subtitles.clearAll();
    this.setLoading(true, 'Preparing playback…');
    this.hideError();

    // Mirror order comes from measured health, and the last working mirror wins.
    if (media.sources?.length) {
      const preferred = preferredSource(media.id);
      const pool = [media.url!, ...media.sources].filter(Boolean);
      const ranked = rankSources(pool);
      const winner = preferred && pool.includes(preferred) ? preferred : ranked[0];
      media.url = winner;
      media.sources = ranked.filter((url) => url !== winner);
    }

    const embed = this.isEmbed ? this.options.embed : null;
    const resume = this.isEmbed ? null : library.getResume(media.id);
    const startAt =
      embed?.start ||
      media.startAt ||
      (this.store.settings.rememberPosition && resume && resume.position > this.store.settings.resumeThreshold && !resume.completed
        ? resume.position
        : 0);

    const startedAt = performance.now();
    try {
      await this.pm.open(media, {
        startAt,
        // Embeds usually want to start on their own; muted autoplay is the only
        // combination browsers allow without a gesture.
        autoplay: embed ? embed.autoplay || embed.muted : this.store.settings.autoPlay,
        startMuted: embed ? embed.muted : undefined,
        ignoreCorsBlock: options.ignoreCorsBlock,
      });

      if (media.url) {
        recordAttempt(media.url, { ok: true, startupMs: performance.now() - startedAt });
        rememberSource(media.id, media.url);
      }

      if (embed?.muted) {
        this.mutedValue = true;
        this.pm.setMuted(true);
        this.updateVolumeUi();
        this.showHud(this.hudCenter, 'volumeMute', 'Muted');
      }
      if (!this.isEmbed) {
        const state = loadPlaybackState(media.id);
        if (state) {
          if (state.rate && state.rate !== 1) this.pm.setRate(state.rate);
          if (state.audioTrackId) {
            const track = this.pm.getTracks().find((entry) => entry.id === state.audioTrackId);
            if (track) void this.pm.selectAudioTrack(track.id).catch(() => undefined);
          }
          if (state.subtitleTrackId) {
            const track = this.pm.getTracks().find((entry) => entry.id === state.subtitleTrackId);
            if (track) void this.pm.selectSubtitleTrack(track.id).catch(() => undefined);
          }
        }
      }

      if (embed?.audioLang || embed?.subLang || embed?.quality) {
        const tracks = this.pm.getTracks();
        const pick = (kind: 'audio' | 'subtitle', lang: string) =>
          tracks.find((track) => track.kind === kind && (track.language ?? '').toLowerCase().startsWith(lang.toLowerCase()));
        const audio = embed.audioLang ? pick('audio', embed.audioLang) : undefined;
        if (audio) void this.pm.selectAudioTrack(audio.id).catch(() => undefined);
        const subs = embed.subLang ? pick('subtitle', embed.subLang) : undefined;
        if (subs) void this.pm.selectSubtitleTrack(subs.id).catch(() => undefined);
        if (embed.quality) this.pm.setQuality(embed.quality);
      }

      if (embed?.subtitle) {
        void this.subtitles
          .loadUrl(embed.subtitle)
          .then(() => {
            this.store.updateSettings({ subtitleEnabled: true });
            this.subtitles.setSettings(this.store.settings);
            this.refreshPanel();
          })
          .catch(() => toast('Embedded subtitle file could not be loaded.', 'warn'));
      }
      this.setLoading(false);
      this.applyAudioSettings();
      this.applyPicture();
      this.requestWakeLock();
      this.generateStoryboard();
      if (this.pm.pendingNotices.length) {
        this.pm.pendingNotices.forEach((notice) => toast(notice, 'info'));
      }
    } catch (error) {
      this.setLoading(false);
      this.showError(toAppError(error));
      return;
    }

    for (const file of pendingSubtitles) {
      try {
        const track = await this.subtitles.loadFile(file);
        toast(`Subtitle loaded: ${track.label}`, 'ok');
      } catch (error) {
        toast((error as Error).message, 'err');
      }
    }

    if (this.store.settings.autoLoadSubtitles) this.autoSelectSubtitle();
    this.refreshPanel();
  }

  private autoSelectSubtitle(): void {
    const preferred = this.store.settings.preferredSubtitleLanguage;
    if (!preferred) return;
    const track = this.subtitles.tracks.find((item) => item.language?.toLowerCase().startsWith(preferred.toLowerCase()));
    if (track) this.subtitles.select(track.id);
  }

  private updateTitle(): void {
    const media = this.media;
    if (!media) return;
    this.titleNode.textContent = media.name;
    const probe = this.pm.probe;
    const bits: string[] = [];
    if (probe?.containerLabel) bits.push(probe.containerLabel);
    if (probe?.videoCodec) bits.push(codecLabel(probe.videoCodec));
    if (probe?.audioCodec) bits.push(codecLabel(probe.audioCodec));
    if (probe?.width && probe?.height) bits.push(`${probe.width}×${probe.height}`);
    this.subtitleNode.textContent = bits.join(' · ') || (media.kind === 'url' ? 'Network stream' : 'Local file');
  }

  /* ----------------------------------------------------------------- wiring */

  private wireControls(): void {
    const on = (selector: string, handler: () => void) => {
      this.el.querySelector(selector)?.addEventListener('click', (event) => {
        event.stopPropagation();
        handler();
      });
    };

    on('#btn-back', () => this.exit());
    on('#btn-play', () => void this.togglePlay());
    on('#btn-back10', () => this.pm.seekBy(-this.store.settings.seekStep));
    on('#btn-fwd10', () => this.pm.seekBy(this.store.settings.seekStep));
    on('#btn-prev', () => this.playQueue(-1));
    on('#btn-next', () => this.playQueue(1));
    on('#btn-mute', () => {
      if (window.matchMedia('(hover: none)').matches) this.openVolumePopover(this.el.querySelector('#btn-mute'));
      else this.toggleMute();
    });
    on('#btn-tracks', () => this.openPanel('tracks'));
    on('#btn-audio', () => this.openPanel('audio'));
    on('#btn-subs', () => this.openPanel('subtitles'));
    on('#btn-danmaku', () => this.toggleDanmaku());
    on('#btn-video', () => this.openPanel('video'));
    on('#btn-playback', () => this.openPanel('playback'));
    on('#btn-info', () => this.openPanel('info'));
    on('#btn-pip', () => void this.togglePip());
    on('#btn-fullscreen', () => void this.toggleFullscreen());
    on('#btn-bookmark', () => this.addBookmark(formatTime(this.pm.currentTime)));
    on('#btn-more', () => this.openMoreMenu());
    on('#btn-speed', () => this.openSpeedMenu());
    on('#btn-quality', () => this.openQualityMenu());
    on('#btn-sleep', () => this.openSleepMenu());
    on('#btn-shot', () => void this.screenshot());
    on('#center-play', () => void this.togglePlay());
    on('#btn-brightness', () => this.openBrightnessPopover(this.el.querySelector('#btn-brightness')));
    on('#btn-loop', () => this.cycleLoop());
    on('#skip-chip', () => {
      const chip = this.el.querySelector<HTMLElement>('#skip-chip');
      if (chip?.dataset.action === 'next') this.playQueue(1);
      else this.pm.seekBy(this.store.settings.skipIntroSeconds);
    });

    this.speedButton.addEventListener('click', () => this.openSpeedMenu());
    this.qualityButton.addEventListener('click', () => this.openQualityMenu());

    this.volumeInput.addEventListener('input', () => {
      const value = Number(this.volumeInput.value) / 100;
      this.pm.setMuted(false);
      this.pm.setVolume(value);
      this.lastVolume = value;
      this.persistVolume(value);
      this.updateVolumeUi();
    });

    // Timeline interactions
    this.tl.addEventListener('pointerdown', (event) => {
      if (!this.pm.currentEngine) return;
      event.preventDefault();
      this.draggedTimeline = true;
      this.tl.classList.add('is-dragging');
      try {
        this.tl.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      this.seekFromPointer(event);
      this.showChrome();
    });
    this.tl.addEventListener('pointermove', (event) => {
      this.updateHover(event);
      if (this.draggedTimeline) this.seekFromPointer(event);
    });
    this.tl.addEventListener('pointerup', (event) => {
      this.draggedTimeline = false;
      this.tl.classList.remove('is-dragging');
      try {
        this.tl.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });
    this.tl.addEventListener('pointerleave', () => this.tlHover.classList.remove('is-visible'));
    this.tl.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'ArrowLeft') {
        event.preventDefault();
        this.pm.seekBy(-this.store.settings.seekStep);
      } else if (key === 'ArrowRight') {
        event.preventDefault();
        this.pm.seekBy(this.store.settings.seekStep);
      }
    });

    // Keep chrome visible while interacting with bars.
    for (const selector of ['.pbar--top', '.pbar--bottom']) {
      this.el.querySelector(selector)?.addEventListener('pointermove', () => this.showChrome(true));
    }

    this.el.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') this.showChrome();
    });
    this.el.addEventListener('keydown', (event) => {
      if (isTypingTarget(event.target)) return;
      this.showChrome();
    });

    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
  }

  /** Hide controls the platform cannot honour, instead of letting them fail. */
  private applyPlatformCapabilities(): void {
    const canFullscreen = !!(
      this.el.requestFullscreen ||
      (this.el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen
    );
    const fullscreenButton = this.el.querySelector<HTMLElement>('#btn-fullscreen');
    if (!canFullscreen) {
      fullscreenButton?.classList.add('hidden');
    }
    if (!document.pictureInPictureEnabled) {
      this.el.querySelector('#btn-pip')?.classList.add('hidden');
    }
    const loop = this.store.settings.loopMode;
    const loopButton = this.el.querySelector<HTMLElement>('#btn-loop');
    if (loopButton) {
      loopButton.innerHTML = icon(loop === 'one' ? 'repeatOne' : 'repeat', 20);
      loopButton.classList.toggle('is-on', loop !== 'off');
    }
  }

  private onFullscreenChange = (): void => {
    const full = !!document.fullscreenElement;
    const button = this.el.querySelector('#btn-fullscreen');
    if (button) button.innerHTML = icon(full ? 'minimize' : 'maximize', 20);
  };

  private wirePlaybackEvents(): void {
    this.unsubs.push(
      this.pm.on('engine', ({ kind }) => {
        this.applyPicture();
        this.applyAudioSettings();
        this.el.dataset.engine = kind;
        this.updateEngineBadge();
        const pipButton = this.el.querySelector<HTMLElement>('#btn-pip');
        if (pipButton) {
          const canPip = !!this.pm.currentEngine?.video;
          pipButton.classList.toggle('hidden', !canPip);
        }
      }),
      this.pm.on('state', ({ paused }) => {
        if (!paused) this.hideEmbedPoster();
        if (!paused && this.pm.isDegradedNative && !this.degradedNoticeShown) {
          this.degradedNoticeShown = true;
          toast('Limited mode: the host blocks byte access, so audio-track switching and embedded subtitles are unavailable. Add a CORS proxy to unlock them.', 'warn', 9000);
        }
      }),
      this.pm.on('state', ({ paused, ended, buffering }) => {
        this.updateMediaSessionState();
        const live = this.el.querySelector('#a11y-status');
        if (live) live.textContent = paused ? 'Paused' : buffering ? 'Buffering' : ended ? 'Finished' : 'Playing';
        this.el.classList.toggle('is-paused', paused);
        this.playButton.innerHTML = icon(paused ? 'play' : 'pause', 24);
        this.playButton.setAttribute('aria-label', paused ? 'Play' : 'Pause');
        this.centerPlay.innerHTML = icon(paused ? 'play' : 'pause', 34);
        this.centerPlay.setAttribute('aria-label', paused ? 'Play' : 'Pause');
        this.el.classList.toggle('is-buffering', buffering && !paused);
        this.setLoading(false);
        if (paused) this.releaseWakeLock();
        else this.requestWakeLock();
        if (ended) this.handleEnded();
        else this.endedHandled = false;
      }),
      this.pm.on('meta', ({ live }) => {
        this.liveBadge.classList.toggle('hidden', !live);
        if (live) {
          // Distance from the live edge, the number every live UI shows.
          const behind = Math.max(0, this.pm.duration - this.pm.currentTime);
          this.liveBadge.textContent = behind > 3 ? `LIVE −${Math.round(behind)}s` : 'LIVE';
          this.liveBadge.title = behind > 3 ? 'Click to jump to the live edge' : 'Live';
        }
        this.updateTitle();
        this.updateTimeUi();
      }),
      this.pm.on('probe', () => {
        this.updateTitle();
        this.refreshPanel();
        this.generateStoryboard();
        void this.scanEmbeddedSubtitles();
      }),
      this.pm.on('tracks', ({ tracks }) => {
        this.updateTrackButtons(tracks);
        this.refreshPanel();
      }),
      this.pm.on('quality', () => this.updateQualityButton()),
      this.pm.on('error', ({ error, fatal }) => {
        if (!fatal) {
          toast(error.message, 'warn');
          return;
        }
        const failedUrl = this.store.current?.url;
        if (failedUrl) recordAttempt(failedUrl, { ok: false });
        // A configured mirror is worth one attempt before showing the error.
        if (this.tryFallbackSource()) return;
        this.showError(error);
      }),
      this.pm.on('notice', ({ message, level }) => toast(message, level === 'warn' ? 'warn' : 'info')),
      this.pm.on('seeked', () => this.updateTimeUi()),
      this.pm.on('chapters', ({ chapters }) => {
        this.chaptersValue = chapters;
        this.renderChapters();
      }),
      this.pm.on('time', () => this.maybeSaveHistory()),
    );
  }

  private wireStoreEvents(): void {
    this.unsubs.push(
      this.store.on('settings', ({ changed }) => {
        if (changed.includes('subtitleSize') || changed.includes('subtitleColor') || changed.includes('subtitleFont') || changed.some((key) => key.startsWith('subtitle'))) {
          this.subtitles.setSettings(this.store.settings);
        }
        if (changed.includes('eqGains') || changed.includes('eqEnabled') || changed.includes('bassBoost') || changed.includes('balance') || changed.includes('mono') || changed.includes('normalizeVolume') || changed.includes('audioDelayMs')) {
          this.applyAudioSettings();
        }
        if (changed.includes('loopMode')) {
          const loopButton = this.el.querySelector<HTMLElement>('#btn-loop');
          if (loopButton) {
            const mode = this.store.settings.loopMode;
            loopButton.innerHTML = icon(mode === 'one' ? 'repeatOne' : 'repeat', 20);
            loopButton.classList.toggle('is-on', mode !== 'off');
          }
        }
        if (changed.includes('keyboardBindings') || changed.includes('keyboardEnabled')) {
          this.keyboard.detach();
          this.keyboard.attach();
        }
      }),
      this.store.on('current', ({ media }) => {
        if (!media || media.id === this.media?.id) return;
        void this.loadCurrent();
      }),
    );
  }

  /* ------------------------------------------------------------------ loop */

  private startLoop(): void {
    const tick = () => {
      if (this.destroyed) return;
      this.rafId = requestAnimationFrame(tick);
      const duration = this.pm.duration;
      const current = this.pm.currentTime;
      this.subtitles.tick(current);
      this.danmaku.tick(current);
      this.watchForStall(current);
      this.samplePressure(current);
      const embed = this.isEmbed ? this.options.embed : null;
      if (embed?.end && current >= embed.end) {
        this.pm.pause();
        this.pm.seek(embed.end);
        this.handleEnded();
      }
      this.updateTimeline(current, duration);
      const now = performance.now();
      if (now - this.lastUiUpdate > 180) {
        this.lastUiUpdate = now;
        this.updateTimeUi(current, duration);
        this.updateSkipChip(current, duration);
      }

      if (this.abLoopValue.a !== null && this.abLoopValue.b !== null && current >= this.abLoopValue.b) {
        this.pm.seek(this.abLoopValue.a);
      }

      if (this.sleepEndsAt) {
        const remaining = Math.max(0, (this.sleepEndsAt - Date.now()) / 1000);
        this.sleepChip.textContent = `Sleep ${formatTime(remaining)}`;
        if (remaining <= 0) {
          this.pm.pause();
          this.setSleepTimer(null);
          toast('Sleep timer finished — playback paused', 'info');
        }
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private updateEngineBadge(): void {
    const badge = this.el.querySelector<HTMLElement>('#engine-badge');
    if (!badge) return;
    const kind = this.pm.currentEngine?.kind ?? '';
    const label = kind === 'webcodecs' ? 'WebCodecs' : kind === 'hls' ? 'HLS' : kind === 'dash' ? 'DASH' : kind === 'native' ? 'Native' : '';
    const probe = this.pm.probe;
    const degraded = this.pm.isDegradedNative;
    badge.classList.toggle('badge-soft--warn', degraded);
    badge.title = degraded
      ? 'The host blocks byte access, so the browser is playing this file opaquely. Track switching and embedded subtitles need CORS or a proxy.'
      : '';
    if (degraded) {
      badge.textContent = `${label} · CORS`;
    } else if (this.store.settings.showDiagnosticsOverlay && probe) {
      badge.textContent = [label, probe.videoCodec, probe.audioCodec].filter(Boolean).join(' · ');
    } else {
      badge.textContent = label;
    }
  }

  private updateSkipChip(current: number, duration: number): void {
    const chip = this.el.querySelector<HTMLElement>('#skip-chip');
    if (!chip) return;
    const settings = this.store.settings;
    const introWindow =
      duration > settings.skipIntroSeconds + 30 &&
      current > 1 &&
      current < settings.skipIntroSeconds &&
      this.chaptersValue.length === 0;
    const outroWindow = duration > 0 && duration - current < settings.skipOutroSeconds && this.store.queue.length > 1;
    if (introWindow) {
      chip.classList.remove('hidden');
      chip.dataset.action = 'intro';
      chip.textContent = `Skip intro → ${settings.skipIntroSeconds}s`;
    } else if (outroWindow) {
      chip.classList.remove('hidden');
      chip.dataset.action = 'next';
      chip.textContent = 'Next video →';
    } else {
      chip.classList.add('hidden');
    }
  }

  private updateTimeline(current: number, duration: number): void {
    if (this.draggedTimeline) return;
    const percent = duration > 0 && Number.isFinite(duration) ? clamp((current / duration) * 100, 0, 100) : 0;
    this.tlPlayed.style.width = `${percent}%`;
    this.tlHandle.style.left = `${percent}%`;
    const ranges = this.pm.currentEngine?.buffered ?? [];
    if (ranges.length && duration > 0) {
      const end = ranges.reduce((max, [, rangeEnd]) => Math.max(max, rangeEnd), 0);
      this.tlBuffered.style.width = `${clamp((end / duration) * 100, 0, 100)}%`;
    } else {
      this.tlBuffered.style.width = '0%';
    }
    if (this.abLoopValue.a !== null && this.abLoopValue.b !== null && duration > 0) {
      const a = (this.abLoopValue.a / duration) * 100;
      const b = (this.abLoopValue.b / duration) * 100;
      this.tlAb.style.display = 'block';
      this.tlAb.style.left = `${a}%`;
      this.tlAb.style.width = `${Math.max(0.5, b - a)}%`;
    } else {
      this.tlAb.style.display = 'none';
    }
    this.tl.setAttribute('aria-valuenow', String(Math.round(percent)));
  }

  private updateTimeUi(current = this.pm.currentTime, duration = this.pm.duration): void {
    this.timeCurrent.textContent = formatTime(current);
    this.timeDuration.textContent = this.pm.live ? 'LIVE' : formatTime(duration);
    const chapter = this.chapterAt(current);
    this.timeChapter.textContent = chapter ? chapter.title : '';
  }

  private chapterAt(time: number): Chapter | undefined {
    return this.chaptersValue.find((chapter) => time >= chapter.start && time < chapter.end);
  }

  /* -------------------------------------------------------------- controls */

  private async togglePlay(): Promise<void> {
    try {
      await this.pm.toggle();
    } catch (error) {
      toast((error as Error).message, 'warn');
    }
    this.showChrome();
  }

  private toggleMute(): void {
    const muted = !this.mutedValue;
    this.mutedValue = muted;
    if (muted) {
      this.lastVolume = Number(this.volumeInput.value) / 100 || 1;
      this.pm.setMuted(true);
      this.volumeInput.value = '0';
    } else {
      this.pm.setMuted(false);
      this.pm.setVolume(this.lastVolume || 1);
      this.volumeInput.value = String(Math.round((this.lastVolume || 1) * 100));
    }
    this.updateVolumeUi();
    this.showHud(this.hudCenter, muted ? 'volumeMute' : 'volume', muted ? 'Muted' : `${Math.round((this.lastVolume || 1) * 100)}%`);
  }

  private changeVolume(delta: number): void {
    const current = Number(this.volumeInput.value) / 100;
    const next = clamp(current + delta, 0, 1);
    this.mutedValue = false;
    this.pm.setMuted(false);
    this.pm.setVolume(next);
    this.volumeInput.value = String(Math.round(next * 100));
    this.persistVolume(next);
    this.updateVolumeUi();
    this.showHud(this.hudRight, next === 0 ? 'volumeMute' : 'volume', `${Math.round(next * 100)}%`, next);
  }

  private changeBrightness(delta: number): void {
    this.brightnessValue = clamp(this.brightnessValue + delta, 0.2, 2);
    this.applyPicture();
    this.showHud(this.hudLeft, 'sun', `${Math.round(this.brightnessValue * 100)}%`, (this.brightnessValue - 0.2) / 1.8);
  }

  private updateVolumeUi(): void {
    const muted = this.mutedValue;
    const value = Number(this.volumeInput.value);
    const button = this.el.querySelector('#btn-mute');
    if (button) button.innerHTML = icon(muted || value === 0 ? 'volumeMute' : value < 45 ? 'volumeLow' : 'volume', 20);
  }

  private persistVolume(value: number): void {
    this.store.updateSettings({ volume: value, muted: value === 0, persistVolume: this.store.settings.persistVolume });
  }

  private handleDoubleTap(zone: 'left' | 'center' | 'right'): void {
    const settings = this.store.settings;
    if (zone === 'center' || !settings.doubleTapSeek) {
      void this.togglePlay();
      return;
    }
    const step = settings.doubleTapSeekSeconds;
    const delta = zone === 'left' ? -step : step;
    this.pm.seekBy(delta);
    this.ripple(zone);
    this.showHud(this.hudCenter, zone === 'left' ? 'seekBack' : 'seekForward', `${zone === 'left' ? '−' : '+'}${step}s`);
  }

  private startLongPress(): void {
    if (this.longPressRate !== null) return;
    this.longPressRate = this.rateValue;
    this.pm.setRate(this.store.settings.longPressSpeed);
    this.showHud(this.hudCenter, 'forward', `${this.store.settings.longPressSpeed}× speed`);
  }

  private endLongPress(): void {
    if (this.longPressRate === null) return;
    this.pm.setRate(this.longPressRate);
    this.longPressRate = null;
    this.hideHud(this.hudCenter);
  }

  private showSeekPreview(target: number, delta: number): void {
    this.seekPreview.classList.add('is-visible');
    this.seekPreview.innerHTML = `${formatTime(target)}<small>${delta >= 0 ? '+' : '−'}${formatTime(Math.abs(delta))}</small>`;
  }

  private hideSeekPreview(): void {
    this.seekPreview.classList.remove('is-visible');
  }

  private showHud(host: HTMLElement, iconName: string, text: string, fill?: number): void {
    host.innerHTML = `${icon(iconName, 22)}<span>${esc(text)}</span>${fill !== undefined ? `<span class="hud__bar"><i style="width:${clamp(fill * 100, 0, 100)}%"></i></span>` : ''}`;
    host.classList.add('is-visible');
    if (this.hudTimer) window.clearTimeout(this.hudTimer);
    this.hudTimer = window.setTimeout(() => {
      host.classList.remove('is-visible');
    }, 900);
  }

  private hideHud(host: HTMLElement): void {
    host.classList.remove('is-visible');
  }

  /* ----------------------------------------------------------------- chrome */

  private showChrome(keepVisible = false): void {
    this.el.dataset.chrome = 'visible';
    if (this.chromeTimer) window.clearTimeout(this.chromeTimer);
    if (keepVisible) return;
    const delay = Math.max(800, this.store.settings.playerChromeDelay);
    this.chromeTimer = window.setTimeout(() => {
      if (!this.pm.paused && !this.panelKind) this.el.dataset.chrome = 'hidden';
    }, delay);
  }

  private toggleChrome(): void {
    if (this.el.dataset.chrome === 'hidden') this.showChrome();
    else {
      this.el.dataset.chrome = 'hidden';
      if (this.chromeTimer) window.clearTimeout(this.chromeTimer);
    }
  }

  /* ------------------------------------------------------------------ menus */

  private openSpeedMenu(): void {
    const menu = el('div');
    menu.append(el('div', { class: 'menu-title', text: 'Playback speed' }));
    for (const speed of SPEEDS) {
      const item = el('button', { class: `menu-item${Math.abs(this.rateValue - speed) < 0.01 ? ' is-selected' : ''}`, type: 'button' });
      item.innerHTML = `<span style="flex:1">${speed}×</span><span class="menu-item__check">${icon('check', 15)}</span>`;
      item.addEventListener('click', () => {
        this.setRate(speed);
        this.showHud(this.hudCenter, 'forward', `${speed}×`);
        closePopover();
      });
      menu.append(item);
    }
    menu.append(el('div', { class: 'menu-sep' }));
    const custom = el('button', { class: 'menu-item', type: 'button' });
    custom.innerHTML = `${icon('sliders', 16)}<span>Custom speed…</span>`;
    custom.addEventListener('click', () => {
      this.openPanel('playback');
    });
    menu.append(custom);
    this.showMenu(this.speedButton, menu);
  }

  private openQualityMenu(): void {
    const qualities = this.pm.getQualities();
    if (qualities.length === 0) {
      toast('This source has a single quality level.', 'info');
      return;
    }
    const menu = el('div');
    menu.append(el('div', { class: 'menu-title', text: 'Quality' }));
    const auto = el('button', { class: 'menu-item', type: 'button' });
    auto.innerHTML = `${icon('activity', 16)}<span style="flex:1">Auto (adaptive)</span>`;
    auto.addEventListener('click', () => {
      this.pm.setQuality('auto');
      closePopover();
    });
    menu.append(auto);
    for (const level of qualities) {
      const item = el('button', { class: 'menu-item', type: 'button' });
      item.innerHTML = `<span style="flex:1">${esc(level.label)}</span><span class="menu-item__sub">${level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : ''}</span>`;
      item.addEventListener('click', () => {
        this.pm.setQuality(level.id);
        closePopover();
      });
      menu.append(item);
    }
    this.showMenu(this.qualityButton, menu);
  }

  private openSleepMenu(): void {
    const menu = el('div');
    menu.append(el('div', { class: 'menu-title', text: 'Sleep timer' }));
    for (const minutes of [15, 30, 45, 60, 90]) {
      const item = el('button', { class: 'menu-item', type: 'button' });
      item.innerHTML = `${icon('timer', 16)}<span>${minutes} minutes</span>`;
      item.addEventListener('click', () => {
        this.setSleepTimer(minutes);
        toast(`Sleep timer: ${minutes} min`, 'ok');
        closePopover();
      });
      menu.append(item);
    }
    if (this.sleepEndsAt) {
      menu.append(el('div', { class: 'menu-sep' }));
      const cancel = el('button', { class: 'menu-item', type: 'button' });
      cancel.innerHTML = `${icon('x', 16)}<span>Cancel timer</span>`;
      cancel.addEventListener('click', () => {
        this.setSleepTimer(null);
        closePopover();
      });
      menu.append(cancel);
    }
    this.showMenu(this.el.querySelector('#btn-sleep') ?? this.speedButton, menu);
  }

  /**
   * The overflow control. On phones it becomes a thumb-friendly action sheet
   * with every control that does not fit in the bar; on desktop a menu.
   */
  private openMoreMenu(): void {
    const isCompact = window.matchMedia('(max-width: 900px)').matches || window.matchMedia('(hover: none)').matches;
    if (isCompact) {
      this.openActionSheet();
      return;
    }
    const menu = el('div');
    menu.append(el('div', { class: 'menu-title', text: 'Playback' }));
    const entries: Array<[string, string, () => void]> = [
      ['playback', 'Playback & speed', () => this.openPanel('playback')],
      ['video', 'Picture & aspect', () => this.openPanel('video')],
      ['audio', 'Audio & equaliser', () => this.openPanel('audio')],
      ['subtitles', 'Subtitles', () => this.openPanel('subtitles')],
      ['message', 'Danmaku', () => this.openPanel('danmaku')],
      ['download', 'Download', () => void this.downloadCurrent()],
      ['layers', 'Tracks & quality', () => this.openPanel('tracks')],
      ['activity', 'Stats for nerds', () => this.toggleStats()],
      ['lock', 'Lock screen', () => this.setLocked(true)],
      ['keyboard', 'Keyboard shortcuts', () => this.showShortcuts()],
      ['info', 'Playback info', () => this.openPanel('info')],
      ['bookmarkPlus', 'Bookmark this moment', () => this.addBookmark(formatTime(this.pm.currentTime))],
      ['scan', 'Save frame as PNG', () => void this.screenshot()],
      ['timer', 'Sleep timer', () => this.openSleepMenu()],
      ['settings', 'Player settings', () => this.ctx.router.navigate('settings', { section: 'playback' })],
    ];
    for (const [iconName, text, handler] of entries) {
      const item = el('button', { class: 'menu-item', type: 'button' });
      item.innerHTML = `${icon(iconName, 16)}<span>${esc(text)}</span>`;
      item.addEventListener('click', handler);
      menu.append(item);
    }
    menu.append(el('div', { class: 'menu-sep' }));
    const fullscreen = el('button', { class: 'menu-item', type: 'button' });
    fullscreen.innerHTML = `${icon('maximize', 16)}<span>Toggle fullscreen</span>`;
    fullscreen.addEventListener('click', () => void this.toggleFullscreen());
    menu.append(fullscreen);
    this.showMenu(this.moreButton, menu);
  }

  private openActionSheet(): void {
    this.showChrome(true);
    const existing = this.el.querySelector('.sheet, .sheet-scrim');
    if (existing) {
      this.el.querySelectorAll('.sheet, .sheet-scrim').forEach((node) => node.remove());
      return;
    }
    const scrim = el('div', { class: 'sheet-scrim' });
    const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Player controls' });
    const grid = el('div', { class: 'sheet__grid' });

    const actions: Array<{ action: string; label: string; iconName: string; on?: boolean; handler: () => void }> = [
      { action: 'tracks', label: 'Tracks', iconName: 'layers', handler: () => this.openPanel('tracks') },
      { action: 'audio', label: 'Audio', iconName: 'audio', handler: () => this.openPanel('audio') },
      { action: 'subtitles', label: 'Subtitles', iconName: 'subtitles', on: !!this.subtitles.active, handler: () => this.openPanel('subtitles') },
      { action: 'danmaku', label: 'Danmaku', iconName: 'message', on: this.store.settings.danmakuEnabled, handler: () => this.toggleDanmaku() },
      { action: 'stats', label: 'Stats', iconName: 'activity', on: this.statsVisible, handler: () => this.toggleStats() },
      { action: 'lock', label: 'Lock', iconName: 'lock', handler: () => this.setLocked(true) },
      { action: 'shortcuts', label: 'Keys', iconName: 'keyboard', handler: () => this.showShortcuts() },
      { action: 'picture', label: 'Picture', iconName: 'sliders', handler: () => this.openPanel('video') },
      { action: 'playback', label: 'Playback', iconName: 'gauge', handler: () => this.openPanel('playback') },
      { action: 'speed', label: `${this.rateValue}×`, iconName: 'forward', handler: () => this.openSpeedMenu() },
      { action: 'brightness', label: 'Brightness', iconName: 'sun', handler: () => this.openBrightnessPopover(null) },
      { action: 'volume', label: 'Volume', iconName: this.mutedValue ? 'volumeMute' : 'volume', handler: () => this.openVolumePopover(null) },
      { action: 'loop', label: 'Repeat', iconName: this.store.settings.loopMode === 'one' ? 'repeatOne' : 'repeat', on: this.store.settings.loopMode !== 'off', handler: () => this.cycleLoop() },
      { action: 'bookmark', label: 'Bookmark', iconName: 'bookmarkPlus', handler: () => this.addBookmark(formatTime(this.pm.currentTime)) },
      { action: 'shot', label: 'Screenshot', iconName: 'scan', handler: () => void this.screenshot() },
      { action: 'info', label: 'Info', iconName: 'info', handler: () => this.openPanel('info') },
      { action: 'sleep', label: 'Sleep', iconName: 'timer', on: this.sleepEndsAt !== null, handler: () => this.openSleepMenu() },
      { action: 'pip', label: 'PiP', iconName: 'pip', handler: () => void this.togglePip() },
      { action: 'fullscreen', label: 'Fullscreen', iconName: 'maximize', handler: () => void this.toggleFullscreen() },
      { action: 'settings', label: 'Settings', iconName: 'settings', handler: () => this.ctx.router.navigate('settings', { section: 'playback' }) },
    ];

    for (const action of actions) {
      const item = el('button', {
        class: `sheet__item${action.on ? ' is-on' : ''}`,
        type: 'button',
        dataset: { action: action.action },
      });
      item.innerHTML = `${icon(action.iconName, 21)}<span>${esc(action.label)}</span>`;
      item.addEventListener('click', () => {
        this.closeSheet();
        action.handler();
      });
      grid.append(item);
    }

    sheet.append(grid);
    this.el.append(scrim, sheet);
    scrim.addEventListener('click', () => this.closeSheet());
  }

  private closeSheet(): void {
    this.el.querySelectorAll('.sheet, .sheet-scrim').forEach((node) => node.remove());
  }

  /** Close sheets and popovers first, so Escape never exits the video by accident. */
  private closeTransient(): boolean {
    const transient = this.el.querySelectorAll('.sheet, .sheet-scrim, .p-pop');
    if (this.shortcutsNode) {
      this.shortcutsNode.remove();
      this.shortcutsNode = null;
      return true;
    }
    if (this.contextNode) {
      this.closeContextMenu();
      return true;
    }
    if (transient.length === 0) return false;
    transient.forEach((node) => node.remove());
    return true;
  }

  private openBrightnessPopover(anchor: HTMLElement | null): void {
    const pop = el('div', { class: 'p-pop' });
    const title = el('div', { class: 'p-pop__title', text: 'Brightness' });
    const value = el('span', { class: 'p-pop__value', text: `${Math.round(this.brightnessValue * 100)}%` });
    const input = el('input', { class: 'range', type: 'range', min: '20', max: '200', step: '1', value: String(Math.round(this.brightnessValue * 100)) });
    const row = el('div', { class: 'p-pop__row' }, [el('span', { html: icon('sun', 16) }), input, value]);
    const reset = el('button', { class: 'p-opt', type: 'button', text: 'Reset to 100%', style: { width: '100%', marginTop: '10px' } });
    const apply = (percent: number) => {
      this.brightnessValue = clamp(percent / 100, 0.2, 2);
      this.applyPicture();
      value.textContent = `${Math.round(this.brightnessValue * 100)}%`;
      input.value = String(Math.round(this.brightnessValue * 100));
    };
    input.addEventListener('input', () => apply(Number(input.value)));
    reset.addEventListener('click', () => apply(100));
    pop.append(title, row, reset);

    if (anchor) {
      pop.style.position = 'absolute';
      pop.style.bottom = 'calc(100% + 10px)';
      pop.style.left = '50%';
      anchor.parentElement?.style.setProperty('position', 'relative');
      anchor.parentElement?.append(pop);
      const close = (event: PointerEvent) => {
        if (pop.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
        pop.remove();
        document.removeEventListener('pointerdown', close, true);
      };
      document.addEventListener('pointerdown', close, true);
    } else {
      this.el.append(pop);
      pop.style.position = 'fixed';
      pop.style.left = '50%';
      pop.style.bottom = '110px';
      pop.style.transform = 'translateX(-50%)';
      const scrim = el('div', { class: 'sheet-scrim', style: { zIndex: '44' } });
      scrim.addEventListener('click', () => {
        pop.remove();
        scrim.remove();
      });
      this.el.append(scrim);
      pop.addEventListener('click', (event) => event.stopPropagation());
      window.setTimeout(() => {
        const close = (event: Event) => {
          if (pop.contains(event.target as Node)) return;
          pop.remove();
          scrim.remove();
        };
        document.addEventListener('pointerdown', close, { once: true, capture: true });
      }, 0);
    }
  }

  private openVolumePopover(anchor: HTMLElement | null): void {
    const pop = el('div', { class: 'p-pop' });
    const value = el('span', { class: 'p-pop__value', text: `${Math.round(Number(this.volumeInput.value))}%` });
    const title = el('div', { class: 'p-pop__title' });
    title.innerHTML = `<span>Volume</span>`;
    title.append(value);
    const input = el('input', { class: 'range', type: 'range', min: '0', max: '100', step: '1', value: this.volumeInput.value });
    const row = el('div', { class: 'p-pop__row' }, [el('span', { html: icon('volume', 16) }), input]);
    const mute = el('button', { class: 'p-opt', type: 'button', text: this.mutedValue ? 'Unmute' : 'Mute', style: { width: '100%', marginTop: '10px' } });
    input.addEventListener('input', () => {
      const percent = Number(input.value);
      this.mutedValue = percent === 0;
      this.pm.setMuted(false);
      this.pm.setVolume(percent / 100);
      this.volumeInput.value = String(percent);
      this.lastVolume = percent / 100;
      this.persistVolume(percent / 100);
      this.updateVolumeUi();
      value.textContent = `${percent}%`;
      mute.textContent = this.mutedValue ? 'Unmute' : 'Mute';
    });
    mute.addEventListener('click', () => {
      this.toggleMute();
      input.value = String(Math.round((this.mutedValue ? 0 : this.lastVolume) * 100));
      value.textContent = `${Math.round(Number(input.value))}%`;
      mute.textContent = this.mutedValue ? 'Unmute' : 'Mute';
    });
    pop.append(title, row, mute);

    if (anchor) {
      const host = anchor.parentElement as HTMLElement;
      host.style.position = 'relative';
      pop.style.position = 'absolute';
      pop.style.bottom = 'calc(100% + 10px)';
      pop.style.left = '50%';
      host.append(pop);
      const close = (event: PointerEvent) => {
        if (pop.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
        pop.remove();
        document.removeEventListener('pointerdown', close, true);
      };
      document.addEventListener('pointerdown', close, true);
    } else {
      pop.style.position = 'fixed';
      pop.style.left = '50%';
      pop.style.bottom = '110px';
      pop.style.transform = 'translateX(-50%)';
      const scrim = el('div', { class: 'sheet-scrim', style: { zIndex: '44' } });
      scrim.addEventListener('click', () => {
        pop.remove();
        scrim.remove();
      });
      this.el.append(scrim, pop);
    }
  }

  private cycleLoop(): void {
    const order: Array<'off' | 'one' | 'all'> = ['off', 'one', 'all'];
    const next = order[(order.indexOf(this.store.settings.loopMode) + 1) % order.length];
    this.store.updateSettings({ loopMode: next });
    const button = this.el.querySelector('#btn-loop');
    if (button) {
      button.innerHTML = icon(next === 'one' ? 'repeatOne' : 'repeat', 20);
      button.classList.toggle('is-on', next !== 'off');
    }
    this.showHud(this.hudCenter, next === 'one' ? 'repeatOne' : 'repeat', next === 'off' ? 'Repeat off' : next === 'one' ? 'Repeat one' : 'Repeat queue');
  }

  private ripple(zone: 'left' | 'center' | 'right'): void {
    if (zone === 'center') return;
    const node = el('div', { class: `ripple ripple--${zone}` });
    this.stage.append(node);
    window.setTimeout(() => node.remove(), 650);
  }

  private showMenu(anchor: HTMLElement, content: HTMLElement): void {
    this.showChrome(true);
    showPopover(anchor, content, { align: 'end' });
  }

  /* ----------------------------------------------------------------- panels */

  openPanel(kind: PanelKind): void {
    if (this.panelKind === kind) {
      this.closePanel();
      return;
    }
    this.closePanel();
    this.panelKind = kind;
    this.showChrome(true);
    const scrim = el('div', { class: 'panel-scrim' });
    scrim.addEventListener('click', () => this.closePanel());
    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': panelTitle(kind) });
    const head = el('div', { class: 'panel__head' });
    head.innerHTML = `<h2>${esc(panelTitle(kind))}</h2>`;
    const close = el('button', { class: 'icon-btn', 'aria-label': 'Close panel', html: icon('x', 18) });
    close.addEventListener('click', () => this.closePanel());
    head.append(close);

    const tabs = el('div', { class: 'panel-tabs' });
    const tabDefs: Array<[PanelKind, string]> = [
      ['tracks', 'Tracks'],
      ['audio', 'Audio'],
      ['subtitles', 'Subtitles'],
      ['danmaku', 'Danmaku'],
      ['video', 'Picture'],
      ['playback', 'Playback'],
      ['info', 'Info'],
    ];
    for (const [id, labelText] of tabDefs) {
      const tab = el('button', { class: `panel-tab${id === kind ? ' is-active' : ''}`, type: 'button', text: labelText });
      tab.addEventListener('click', () => this.openPanel(id));
      tabs.append(tab);
    }

    const body = el('div', { class: 'panel__body' });
    panel.append(head, tabs, body);
    this.panelHost.append(scrim, panel);
    this.panelBody = body;
    this.renderPanelBody(kind, body);
  }

  private renderPanelBody(kind: PanelKind, host: HTMLElement): void {
    host.innerHTML = '';
    const result = buildPanelBody(this, kind);
    if (result instanceof Promise) {
      host.append(el('div', { class: 'p-note', text: 'Collecting diagnostics…' }));
      void result.then((node) => {
        if (this.panelKind !== kind) return;
        host.innerHTML = '';
        host.append(node);
      });
    } else {
      host.append(result);
    }
  }

  refreshPanel(): void {
    if (!this.panelKind || !this.panelBody) return;
    const scroll = this.panelBody.scrollTop;
    this.renderPanelBody(this.panelKind, this.panelBody);
    window.setTimeout(() => {
      if (this.panelBody) this.panelBody.scrollTop = scroll;
    }, 0);
  }

  closePanel(): void {
    this.panelHost.innerHTML = '';
    this.panelKind = null;
    this.panelBody = null;
    this.showChrome();
  }

  /* ------------------------------------------------------------------- misc */

  setAdjustments(next: VideoAdjustments): void {
    this.adjustmentsValue = next;
    this.applyPicture();
  }

  setRate(rate: number): void {
    this.rateValue = rate;
    this.pm.setRate(rate);
    this.speedButton.textContent = `${rate}×`;
    this.speedButton.classList.toggle('is-on', Math.abs(rate - 1) > 0.01);
  }

  setBrightness(value: number): void {
    this.brightnessValue = clamp(value, 0.2, 2);
    this.applyPicture();
  }

  setAbLoop(next: AbLoop): void {
    this.abLoopValue = next;
    if (next.a !== null && next.b !== null && next.b <= next.a) {
      toast('B must come after A — swap the markers.', 'warn');
    }
  }

  setSleepTimer(minutes: number | null): void {
    if (this.sleepTimerId) window.clearTimeout(this.sleepTimerId);
    this.sleepTimerId = 0;
    if (minutes === null) {
      this.sleepEndsAt = null;
      this.sleepChip.classList.add('hidden');
      return;
    }
    this.sleepEndsAt = Date.now() + minutes * 60_000;
    this.sleepChip.classList.remove('hidden');
    this.sleepTimerId = window.setTimeout(() => {
      this.pm.pause();
      this.setSleepTimer(null);
      toast('Sleep timer finished — playback paused', 'info');
    }, minutes * 60_000);
  }

  private get isEmbed(): boolean {
    return this.options.mode === 'embed';
  }

  /** Strip the app chrome an embed does not need, and apply its options. */
  private toggleDanmaku(): void {
    const next = !this.store.settings.danmakuEnabled;
    this.store.updateSettings({ danmakuEnabled: next });
    this.applyDanmakuSettings();
    this.showHud(this.hudCenter, 'message', next ? 'Danmaku on' : 'Danmaku off');
    if (next && this.danmaku.count === 0) this.openPanel('danmaku');
  }

  /* ------------------------------------------------------------- stats overlay */

  toggleStats(force?: boolean): void {
    this.statsVisible = force ?? !this.statsVisible;
    const node = this.el.querySelector<HTMLElement>('#stats-overlay');
    if (!node) return;
    node.classList.toggle('hidden', !this.statsVisible);
    window.clearInterval(this.statsTimer);
    if (this.statsVisible) {
      this.updateStats();
      this.statsTimer = window.setInterval(() => this.updateStats(), 700);
    }
  }

  private updateStats(): void {
    const node = this.el.querySelector<HTMLElement>('#stats-overlay');
    if (!node || !this.statsVisible) return;
    const engine = this.pm.currentEngine;
    const video = engine?.video ?? null;
    const canvas = engine?.canvas ?? null;
    const width = video?.videoWidth || canvas?.width || 0;
    const height = video?.videoHeight || canvas?.height || 0;
    const quality = video?.getVideoPlaybackQuality?.();
    const buffered = this.pm.bufferedRanges;
    const ahead = buffered.reduce((best, range) => {
      const distance = range[1] - this.pm.currentTime;
      return distance > 0 && distance > best ? distance : best;
    }, 0);
    const level = this.pm.getQualities().find((entry) => entry.id === this.pm.activeQuality);
    const probe = this.pm.probe;
    const elapsed = Math.max(1, this.pm.currentTime);
    const fps = quality && quality.totalVideoFrames > 0 ? quality.totalVideoFrames / elapsed : 0;

    const lines = [
      `engine   ${engine?.kind ?? '—'}`,
      `picture  ${width ? `${width}×${height}` : '—'}${level?.height ? ` · ${level.height}p` : ''}`,
      `codec    ${probe?.videoCodec ?? '—'} / ${probe?.audioCodec ?? '—'}`,
      `buffer   ${ahead.toFixed(1)} s`,
      `dropped  ${quality?.droppedVideoFrames ?? 0}${fps ? ` · ~${fps.toFixed(0)} fps` : ''}`,
      `rate     ${this.rateValue.toFixed(2)}×`,
      `state    ${this.pm.paused ? 'paused' : this.pm.buffering ? 'buffering' : 'playing'}`,
    ];
    node.textContent = lines.join('\n');
  }

  /* ------------------------------------------------------------- context menu */

  private openContextMenu(x: number, y: number): void {
    this.closeContextMenu();
    const menu = el('div', { class: 'ctx-menu', role: 'menu' });
    const entries: Array<[string, string, () => void, string?]> = [
      [this.pm.paused ? 'Play' : 'Pause', this.pm.paused ? 'play' : 'pause', () => this.togglePlay(), 'Space'],
      ['Screenshot', 'scan', () => void this.screenshot(), 'S'],
      ['Download this file', 'download', () => void this.downloadCurrent(), ''],
      ['Copy link at this time', 'copy', () => void this.copyShareLink(), ''],
      ['Danmaku', 'message', () => this.toggleDanmaku(), 'D'],
      ['Stats for nerds', 'activity', () => this.toggleStats(), 'I'],
      ['Picture settings', 'sliders', () => this.openPanel('video'), ''],
      ['Keyboard shortcuts', 'keyboard', () => this.showShortcuts(), '?'],
      ['Lock screen', 'lock', () => this.setLocked(true), ''],
      ['Fullscreen', 'maximize', () => void this.toggleFullscreen(), 'F'],
    ];
    for (const [label, iconName, action, key] of entries) {
      const item = el('button', { class: 'ctx-item', type: 'button', role: 'menuitem' });
      item.innerHTML = `${icon(iconName, 15)}<span>${esc(label)}</span>${key ? `<span class="ctx-item__key">${esc(key)}</span>` : ''}`;
      item.addEventListener('click', () => {
        this.closeContextMenu();
        action();
      });
      menu.append(item);
    }
    menu.style.left = `${Math.min(x, window.innerWidth - 230)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 320)}px`;
    this.el.append(menu);
    this.contextNode = menu;
    const dismiss = (event: Event) => {
      if (menu.contains(event.target as Node)) return;
      this.closeContextMenu();
    };
    window.setTimeout(() => {
      window.addEventListener('pointerdown', dismiss, { once: true });
      window.addEventListener('keydown', dismiss, { once: true });
    }, 0);
  }

  private contextNode: HTMLElement | null = null;

  private closeContextMenu(): void {
    this.contextNode?.remove();
    this.contextNode = null;
  }

  /* ------------------------------------------------------------- shortcuts */

  showShortcuts(): void {
    if (this.shortcutsNode) {
      this.shortcutsNode.remove();
      this.shortcutsNode = null;
      return;
    }
    const overlay = el('div', { class: 'shortcuts', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' });
    const rows = Object.entries(KEY_ACTION_LABELS)
      .map(([action, label]) => {
        const binding = this.store.settings.keyboardBindings[action] ?? DEFAULT_KEYBINDINGS[action] ?? '';
        return `<span>${esc(label)}</span><kbd>${esc(binding || '—')}</kbd>`;
      })
      .join('');
    overlay.innerHTML = `<div class="shortcuts__card"><h2>Keyboard shortcuts</h2><div class="shortcuts__grid">${rows}</div></div>`;
    overlay.addEventListener('click', () => this.showShortcuts());
    this.el.append(overlay);
    this.shortcutsNode = overlay;
  }

  /* ------------------------------------------------------------- lock */

  private setLocked(locked: boolean): void {
    this.el.classList.toggle('is-locked', locked);
    this.lockNode?.remove();
    this.lockNode = null;
    if (!locked) return;
    const badge = el('button', { class: 'lock-badge', type: 'button', 'aria-label': 'Unlock controls' });
    badge.innerHTML = `${icon('lock', 14)}<span>Tap to unlock</span>`;
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setLocked(false);
    });
    this.stage.append(badge);
    this.lockNode = badge;
    this.showHud(this.hudCenter, 'lock', 'Locked');
  }

  /* ------------------------------------------------------------- providers */

  /** Sites that must play through their own embed (YouTube, Vimeo, …). */
  private showProvider(provider: { name: string; embedUrl: string; reason?: string }): void {
    this.hideProvider();
    this.setLoading(false);
    this.el.classList.add('is-provider');
    const frame = el('iframe', {
      class: 'provider-frame',
      src: provider.embedUrl,
      allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
      allowfullscreen: '',
      referrerpolicy: 'no-referrer',
      title: `${provider.name} player`,
    });
    this.mediaWrap.append(frame);
    this.titleNode.textContent = this.store.current?.name ?? `${provider.name} video`;
    this.subtitleNode.textContent = `${provider.name} · ${provider.reason ?? 'official embed'}`;
    document.title = this.titleNode.textContent;
  }

  private hideProvider(): void {
    this.el.classList.remove('is-provider');
    this.el.querySelector('.provider-frame')?.remove();
  }

  /* --------------------------------------------------------------- torrents */

  /** Turn a magnet into something the engines can open, with visible progress. */
  private async resolveTorrent(magnet: string): Promise<{ url: string; name: string } | null> {
    const { TorrentSession, gatewayUrl } = await import('../../torrent/engine');
    const { parseMagnet } = await import('../../torrent/magnet');
    const info = parseMagnet(magnet);
    const gateway = gatewayUrl(magnet, this.store.settings.torrentGateway);
    if (gateway) return { url: gateway, name: info?.name ?? 'Torrent' };

    this.setLoading(true, 'Connecting to the swarm…');
    const session = new TorrentSession();
    try {
      const files = await session.add(magnet);
      const target = files.find((file) => file.playable);
      if (!target) {
        this.showError(new AppError('unsupported-container', {
          message: 'No playable media in this torrent',
          detail: 'The torrent loaded but none of its files are audio or video.',
        }));
        return null;
      }
      this.setLoading(true, `Downloading ${target.name}…`);
      const url = await session.download(target.index, (stats) => {
        this.setLoading(
          true,
          `Downloading ${target.name} — ${Math.round(stats.progress * 100)}% · ${stats.peers} peers`,
        );
      });
      return { url, name: target.name };
    } catch (error) {
      this.showError(
        new AppError('network', {
          message: 'Could not reach the torrent swarm',
          detail: (error as Error).message,
          suggestions: [
            'Add a torrent gateway in Settings → Torrents — it plays any magnet.',
            'Or use a magnet that carries a web seed (ws=).',
          ],
        }),
      );
      return null;
    } finally {
      // The blob URL stays valid after the session is torn down.
      session.destroy();
    }
  }

  /* ---------------------------------------------------------- media session */

  /** Lock-screen and hardware-key controls where the browser supports them. */
  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const media = this.store.current;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: media?.name ?? 'OmniPlay',
        artist: 'OmniPlay',
        album: media?.kind === 'file' ? 'Local media' : 'Network stream',
        artwork: media?.poster ? [{ src: media.poster, sizes: '512x512' }] : [],
      });
    } catch {
      /* MediaMetadata may be unsupported even when mediaSession exists */
    }
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => void this.pm.play()],
      ['pause', () => this.pm.pause()],
      ['seekbackward', () => this.pm.seek(Math.max(0, this.pm.currentTime - 10))],
      ['seekforward', () => this.pm.seek(this.pm.currentTime + 10)],
      ['seekto', (details) => {
        if (typeof details.seekTime === 'number') this.pm.seek(details.seekTime);
      }],
    ];
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* action not supported */
      }
    }
  }

  private updateMediaSessionState(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = this.pm.paused ? 'paused' : 'playing';
  }

  /* --------------------------------------------------------- embed bridge */

  /**
   * postMessage bridge so a host page can drive the player and react to it.
   * Only messages from the parent frame are accepted.
   */
  private setupBridge(): void {
    if (window.self === window.top) return;
    const parent = window.parent;
    const send = (payload: Record<string, unknown>) => {
      try {
        parent.postMessage({ omniplay: 'event', ...payload }, '*');
      } catch {
        /* host went away */
      }
    };

    this.bridgeHandler = (event: MessageEvent) => {
      if (event.source !== parent) return;
      const allowed = this.options.embed?.origins ?? [];
      if (allowed.length > 0 && !allowed.includes(event.origin)) return;
      const data = event.data as { omniplay?: string; value?: unknown; src?: unknown; start?: unknown } | null;
      if (!data || typeof data.omniplay !== 'string') return;

      switch (data.omniplay) {
        case 'play':
          void this.pm.play();
          break;
        case 'pause':
          this.pm.pause();
          break;
        case 'toggle':
          this.togglePlay();
          break;
        case 'seek':
          this.pm.seek(Number(data.value) || 0);
          break;
        case 'volume':
          this.pm.setVolume(Math.min(1, Math.max(0, Number(data.value) || 0)));
          break;
        case 'muted':
          this.pm.setMuted(Boolean(data.value));
          break;
        case 'rate':
          this.pm.setRate(Math.min(4, Math.max(0.25, Number(data.value) || 1)));
          break;
        case 'load':
          if (typeof data.src === 'string') {
            this.store.setCurrent(this.ctx.session.specFromUrl(data.src, undefined));
            void this.loadCurrent();
            if (Number(data.start) > 0) this.pm.seek(Number(data.start));
          }
          break;
        case 'subtitle':
          if (typeof data.src === 'string') void this.subtitles.loadUrl(data.src);
          break;
        case 'quality':
          this.pm.setQuality(String(data.value ?? 'auto'));
          break;
        case 'audio': {
          // Accept a track id or an index into the audio tracks.
          const tracks = this.pm.getTracks().filter((track) => track.kind === 'audio');
          const raw = String(data.value ?? '');
          const match = tracks.find((track) => track.id === raw) ?? tracks[Number(raw)];
          if (match) void this.pm.selectAudioTrack(match.id);
          break;
        }
        case 'danmaku':
          this.store.updateSettings({ danmakuEnabled: Boolean(data.value) });
          this.applyDanmakuSettings();
          break;
        case 'fullscreen':
          void this.toggleFullscreen();
          break;
        case 'getState':
          send({
            type: 'state-reply',
            currentTime: this.pm.currentTime,
            duration: this.pm.duration,
            paused: this.pm.paused,
            volume: this.pm.volumeValue,
            muted: this.mutedValue,
            rate: this.pm.rateValue,
            engine: this.pm.currentEngine?.kind ?? null,
          });
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', this.bridgeHandler);

    this.pm.on('state', ({ paused, buffering, ended }) => {
      send({ type: 'state', paused, buffering: !!buffering, ended: !!ended });
    });
    this.pm.on('time', ({ currentTime, duration }) => {
      const now = performance.now();
      if (now - this.bridgeLastTime < 500) return;
      this.bridgeLastTime = now;
      send({ type: 'timeupdate', currentTime, duration });
    });
    this.pm.on('error', ({ error }) => {
      send({ type: 'error', code: error.code, message: error.message });
    });
    this.pm.on('tracks', ({ tracks }) => {
      send({
        type: 'tracks',
        audio: tracks.filter((track) => track.kind === 'audio').map((track) => ({ id: track.id, label: track.label, language: track.language })),
        subtitles: tracks.filter((track) => track.kind === 'subtitle').map((track) => ({ id: track.id, label: track.label, language: track.language })),
        qualities: this.pm.getQualities().map((level) => ({ id: level.id, label: level.label })),
      });
    });
    send({ type: 'ready', duration: this.pm.duration, embedded: true });
  }

  private bridgeLastTime = 0;
  private bridgeHandler: ((event: MessageEvent) => void) | null = null;
  private lastProgress = { at: 0, time: -1, recoveries: 0 };
  private governor!: ResourceGovernor;
  private governorAt = 0;

  private applyDanmakuSettings(): void {
    const settings = this.store.settings;
    const danmakuBudget = budgetsFor(this.store.settings.deviceProfile === 'auto' ? deviceReport().profile : this.store.settings.deviceProfile);
    this.danmaku.setRateCap(danmakuBudget.danmakuPerSecond);
    this.danmaku.setSettings({
      enabled: settings.danmakuEnabled,
      opacity: settings.danmakuOpacity,
      fontScale: settings.danmakuFontScale,
      speed: settings.danmakuSpeed,
      area: settings.danmakuArea,
    });
    const button = this.el.querySelector('#btn-danmaku');
    button?.classList.toggle('is-on', settings.danmakuEnabled);
    button?.setAttribute('aria-pressed', String(settings.danmakuEnabled));
  }

  /* ------------------------------------------------------------- danmaku API */

  get danmakuCount(): number {
    return this.danmaku.count;
  }

  addDanmaku(text: string): boolean {
    const value = text.trim();
    if (!value) return false;
    this.danmaku.add({
      time: Math.max(0, this.pm.currentTime),
      text: value.slice(0, 120),
      color: randomDanmakuColor(),
      mode: 'scroll',
      size: 25,
    });
    return true;
  }

  importDanmaku(text: string, fileName?: string): number {
    const items = parseDanmaku(text);
    if (items.length === 0) return 0;
    this.danmaku.setItems(items);
    // Do not move the playhead behind the user's back; just say so.
    const last = items[items.length - 1];
    if (this.pm.currentTime > last.time) {
      toast(`Loaded ${items.length} comments — rewind to see them`, 'info');
    }
    if (!this.store.settings.danmakuEnabled) this.store.updateSettings({ danmakuEnabled: true });
    this.applyDanmakuSettings();
    log.info('danmaku loaded', { fileName, count: items.length });
    return items.length;
  }

  clearDanmaku(): void {
    this.danmaku.setItems([]);
    this.applyDanmakuSettings();
  }

  private applyEmbedMode(): void {
    const embed = this.options.embed;
    if (!this.isEmbed || !embed) return;

    this.el.classList.add('is-embed');
    this.embedLoop = embed.loop;
    this.el.querySelector('#btn-back')?.classList.add('hidden');

    if (embed.accent && /^#[0-9a-f]{3,8}$/i.test(embed.accent)) {
      this.el.style.setProperty('--accent', embed.accent);
      this.el.style.setProperty('--accent-strong', embed.accent);
    }

    if (embed.poster) {
      const poster = el('img', { class: 'player__poster', src: embed.poster, alt: '' });
      poster.addEventListener('error', () => poster.remove());
      this.stage.append(poster);
      this.embedPosterShown = true;
    }

    if (!embed.pip) this.el.querySelector('#btn-pip')?.classList.add('hidden');
    if (!embed.keyboard) this.keyboard.detach();
    if (embed.aspect) {
      this.adjustmentsValue = { ...this.adjustmentsValue, aspect: embed.aspect as never };
      const inner = this.mediaWrap.firstElementChild as HTMLElement | null;
      if (inner) applyAspect(this.stage, inner, this.adjustmentsValue.aspect);
    }

    if (!embed.controls) {
      this.el.dataset.chrome = 'hidden';
      this.el.classList.add('no-chrome');
      this.el.querySelectorAll('.pbar').forEach((node) => node.classList.add('hidden'));
    }
  }

  private hideEmbedPoster(): void {
    if (!this.embedPosterShown) return;
    this.embedPosterShown = false;
    this.el.querySelector('.player__poster')?.remove();
  }

  /** List subtitle tracks stored inside the container (MKV/WebM). */
  private async scanEmbeddedSubtitles(): Promise<void> {
    this.embeddedTracksValue = [];
    this.embeddedLoaded.clear();
    const media = this.store.current;
    if (!media) return;
    const candidates = [media.name ?? '', media.url ?? ''].map((value) => value.toLowerCase());
    const isMatroska = candidates.some((value) => /\.(mkv|mka|webm)(\?|#|$)/.test(value));
    if (!isMatroska) return;
    if (!media.file && (media.corsBlocked || this.pm.isCorsBlocked)) return;

    try {
      const source = this.matroskaSource(media);
      if (!source) return;
      const tracks = await scanMatroskaTracks(source);
      this.embeddedTracksValue = tracks.filter((track) => track.format !== 'unknown');
      if (this.embeddedTracksValue.length > 0) {
        log.info(
          'embedded subtitles',
          this.embeddedTracksValue.map((track) => `${track.format}:${track.language ?? 'und'}`).join(', '),
        );
        this.refreshPanel();
      }
    } catch (error) {
      log.warn('embedded subtitle scan failed', error);
    }
  }

  private matroskaSource(media: MediaSourceSpec) {
    if (media.file) return blobSource(media.file);
    if (media.url && !media.corsBlocked) {
      return urlSource(proxiedUrl(media.url, this.store.settings), media.headers, media.size ?? Number.POSITIVE_INFINITY);
    }
    return null;
  }

  /** Extract one embedded track and hand it to the subtitle manager. */
  async loadEmbeddedSubtitle(track: MkvSubtitleTrack): Promise<void> {
    if (this.embeddedBusy) {
      toast('Already extracting a subtitle track…', 'info');
      return;
    }
    const media = this.store.current;
    const source = media ? this.matroskaSource(media) : null;
    if (!media || !source) {
      toast('This source cannot be read (CORS).', 'warn');
      return;
    }

    const label =
      track.name ||
      (track.language ? languageName(track.language) : `Subtitle ${track.number}`) +
        (track.isForced ? ' (forced)' : '');
    this.embeddedBusy = true;
    this.showHud(this.hudCenter, 'subtitles', 'Extracting…');

    try {
      let lastPaint = 0;
      const result = await extractMatroskaSubtitles(source, track, (fraction) => {
        const now = performance.now();
        if (now - lastPaint < 220) return;
        lastPaint = now;
        this.showHud(this.hudCenter, 'subtitles', `${Math.round(fraction * 100)}%`);
      });

      const id = `mkv_${media.id}_${track.number}`;
      if (result.kind === 'pgs') {
        const added = this.subtitles.addImageCues(result.cues, label, id, track.language);
        if (!added) throw new AppError('subtitle-failed', { message: 'No bitmap subtitles were found in this track.' });
      } else {
        const doc = parseSubtitle(result.text, `${label}.${track.format === 'ass' || track.format === 'ssa' ? 'ass' : 'srt'}`);
        this.subtitles.addDocument(doc, label, { id, language: track.language, source: 'embedded' });
      }

      this.embeddedLoaded.add(track.number);
      this.store.updateSettings({ subtitleEnabled: true });
      this.subtitles.setSettings(this.store.settings);
      toast(`Subtitles ready: ${label}`, 'ok');
      this.showHud(this.hudCenter, 'subtitles', 'Ready');
      this.refreshPanel();
    } catch (error) {
      log.warn('embedded subtitle extraction failed', error);
      toast((error as Error).message || 'Could not extract that subtitle track.', 'err');
    } finally {
      this.embeddedBusy = false;
    }
  }

  get embeddedTracks(): MkvSubtitleTrack[] {
    return this.embeddedTracksValue;
  }

  isEmbeddedLoaded(trackNumber: number): boolean {
    return this.embeddedLoaded.has(trackNumber);
  }

  async reloadWithEngine(engine: EngineKind, audioLanguage?: string): Promise<void> {
    try {
      await this.pm.reloadWith({ engine, audioLanguage });
      this.applyAudioSettings();
      this.applyPicture();
      this.updateEngineBadge();
      this.refreshPanel();
    } catch (error) {
      this.showError(toAppError(error));
    }
  }

  addBookmark(label: string): void {
    const media = this.media;
    if (!media) return;
    const time = this.pm.currentTime;
    void library
      .addBookmark({
        mediaId: media.id,
        mediaName: media.name,
        url: media.url,
        kind: media.kind,
        time,
        label: label || formatTime(time),
      })
      .then(() => {
        toast(`Bookmarked at ${formatTime(time)}`, 'ok');
        this.refreshPanel();
      });
  }

  notify(message: string, kind: 'ok' | 'warn' | 'err' | 'info' = 'info'): void {
    toast(message, kind);
  }

  seek(time: number): void {
    this.pm.seek(time);
  }

  get chapters(): Chapter[] {
    return this.chaptersValue;
  }

  get abLoop(): AbLoop {
    return this.abLoopValue;
  }

  get adjustments(): VideoAdjustments {
    return this.adjustmentsValue;
  }

  get brightness(): number {
    return this.brightnessValue;
  }

  get rate(): number {
    return this.rateValue;
  }

  get sleepRemaining(): number | null {
    return this.sleepEndsAt ? Math.max(0, (this.sleepEndsAt - Date.now()) / 1000) : null;
  }

  private applyPicture(): void {
    const inner = this.pm.currentEngine?.canvas ?? this.pm.currentEngine?.video ?? null;
    const effective: VideoAdjustments = {
      ...this.adjustmentsValue,
      brightness: clamp(this.adjustmentsValue.brightness * this.brightnessValue, 0.05, 4),
    };
    applyAdjustments(this.mediaWrap, effective);
    if (inner) applyAspect(this.stage, inner, this.adjustmentsValue.aspect);
  }

  private applyAudioSettings(): void {
    const settings = this.store.settings;
    audioProcessor.setEqGains(settings.eqGains, settings.eqEnabled);
    audioProcessor.setBassBoost(settings.bassBoost);
    audioProcessor.setBalance(settings.balance);
    audioProcessor.setMono(settings.mono);
    audioProcessor.setNormalize(settings.normalizeVolume);
    audioProcessor.setDelayMs(settings.audioDelayMs);
    if (this.pm.currentEngine) {
      this.pm.setVolume(settings.persistVolume ? settings.volume : this.pm.volumeValue);
      this.volumeInput.value = String(Math.round(this.pm.volumeValue * 100));
      this.updateVolumeUi();
    }
  }

  private renderChapters(): void {
    this.tlChapters.innerHTML = '';
    const duration = this.pm.duration;
    if (!duration || !Number.isFinite(duration)) return;
    for (const chapter of this.chaptersValue) {
      const marker = el('div', { class: 'tl__chapter', title: chapter.title });
      marker.style.left = `${(chapter.start / duration) * 100}%`;
      this.tlChapters.append(marker);
    }
  }

  private async generateStoryboard(): Promise<void> {
    const media = this.media;
    if (!media || !this.store.settings.thumbnailPreviews) return;
    const token = ++this.storyboardToken;
    const duration = this.pm.duration;
    if (!duration || !Number.isFinite(duration) || duration < 10) return;
    const count = this.store.settings.thumbnailQuality === 'high' ? 20 : this.store.settings.thumbnailQuality === 'low' ? 8 : 12;
    const frames = await thumbnails.getStoryboard(media, duration, count);
    if (token !== this.storyboardToken) return;
    this.storyboard = frames;
  }

  private updateHover(event: PointerEvent): void {
    const rect = this.tl.getBoundingClientRect();
    const duration = this.pm.duration;
    if (!duration || !Number.isFinite(duration)) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const time = ratio * duration;
    this.tlHover.classList.add('is-visible');
    const left = clamp(event.clientX - rect.left, 90, rect.width - 90);
    this.tlHover.style.left = `${left}px`;
    const chapter = this.chapterAt(time);
    this.tlHoverLabel.innerHTML = `${formatTime(time)}${chapter ? ` · <span class="tl__tooltip-chapter">${esc(chapter.title)}</span>` : ''}`;
    if (this.storyboard.length) {
      const frame = this.storyboard.reduce((best, item) => (Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best), this.storyboard[0]);
      this.tlHoverImg.src = frame.dataUrl;
      this.tlHoverImg.style.display = 'block';
    } else {
      this.tlHoverImg.style.display = 'none';
    }
  }

  private seekFromPointer(event: PointerEvent): void {
    const rect = this.tl.getBoundingClientRect();
    const duration = this.pm.duration;
    if (!duration || !Number.isFinite(duration)) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    this.pm.seek(ratio * duration);
    this.tlPlayed.style.width = `${ratio * 100}%`;
    this.tlHandle.style.left = `${ratio * 100}%`;
  }

  private updateTrackButtons(tracks: TrackInfo[]): void {
    const hasAudio = tracks.filter((track) => track.kind === 'audio').length > 1;
    const hasSubs = tracks.some((track) => track.kind === 'subtitle') || this.subtitles.tracks.length > 0;
    this.el.querySelector('#btn-audio')?.classList.toggle('is-on', hasAudio);
    this.el.querySelector('#btn-subs')?.classList.toggle('is-on', hasSubs && !!this.subtitles.active);
  }

  private updateQualityButton(): void {
    const qualities = this.pm.getQualities();
    this.qualityButton.classList.toggle('hidden', qualities.length === 0);
    // PiP/cast need a real <video>; the canvas engine cannot offer them.
    const pipButton = this.el.querySelector<HTMLElement>('#btn-pip');
    if (pipButton) {
      const canvasOnly = !this.pm.currentEngine?.video && !!this.pm.captureCanvas();
      pipButton.classList.toggle('hidden', canvasOnly);
      pipButton.title = canvasOnly ? 'Picture-in-Picture needs the native engine' : 'Picture-in-Picture';
    }
  }

  private handleEnded(): void {
    if (this.endedHandled) return;
    this.endedHandled = true;
    if (this.isEmbed) {
      const next = this.options.embed?.next;
      if (next) {
        const spec = this.ctx.session.specFromLink(next);
        this.store.setCurrent(spec);
        void this.loadCurrent();
        return;
      }
      if (this.embedLoop) {
        this.pm.seek(0);
        void this.pm.play();
      } else {
        this.showChrome();
      }
      return;
    }
    this.saveHistory(true);
    const settings = this.store.settings;
    if (settings.loopMode === 'one') {
      this.pm.seek(0);
      void this.pm.play();
      return;
    }
    if (settings.autoNext) {
      const next = this.store.nextInQueue();
      if (next) {
        this.ctx.session.play(next);
        return;
      }
    }
    this.showChrome();
  }

  private playQueue(direction: 1 | -1): void {
    const next = direction === 1 ? this.store.nextInQueue() : this.store.previousInQueue();
    if (!next) {
      toast(direction === 1 ? 'End of queue' : 'Start of queue', 'info');
      return;
    }
    this.ctx.session.play(next);
  }

  /* ------------------------------------------------------------- persistence */

  private maybeSaveHistory(): void {
    if (this.isEmbed) return;
    const now = performance.now();
    if (now - this.lastHistorySave < 5000) return;
    this.lastHistorySave = now;
    this.saveHistory(false);
  }

  private persistSmartResume(): void {
    const media = this.store.current;
    if (!media || this.isEmbed) return;
    const tracks = this.pm.getTracks();
    savePlaybackState(media.id, {
      position: this.pm.currentTime,
      duration: this.pm.duration,
      audioTrackId: tracks.find((track) => track.kind === 'audio' && track.isDefault)?.id,
      subtitleTrackId: this.subtitles.active?.id ?? null,
      rate: this.pm.rateValue,
      updatedAt: Date.now(),
    });
  }

  private saveHistory(completed: boolean): void {
    this.persistSmartResume();
    if (this.isEmbed) return;
    const media = this.media;
    if (!media || !this.store.settings.saveHistory) return;
    const duration = this.pm.duration;
    const position = this.pm.currentTime;
    if (!Number.isFinite(position) || position < 1) return;
    void library.recordProgress({
      id: media.id,
      name: media.name,
      kind: media.kind,
      url: media.url,
      size: media.size,
      mime: media.mime,
      duration: Number.isFinite(duration) ? duration : 0,
      position,
      completed: completed || (Number.isFinite(duration) && duration > 0 && position / duration > 0.97),
      engine: this.pm.currentEngine?.kind,
      container: this.pm.probe?.container,
    });
  }

  /* --------------------------------------------------------------- system */

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.el.requestFullscreen();
    } catch {
      toast('Fullscreen was blocked by the browser.', 'warn');
    }
  }

  private async togglePip(): Promise<void> {
    const video = this.pm.currentEngine?.video;
    if (!video) {
      toast('Picture-in-Picture needs the native video engine. This source is drawn on a canvas.', 'warn');
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (error) {
      toast(`Picture-in-Picture failed: ${(error as Error).message}`, 'warn');
    }
  }

  private async requestWakeLock(): Promise<void> {
    const caps = detectCapabilities();
    if (!caps.wakeLock || this.wakeLock) return;
    // An iframe without allow="screen-wake-lock" would log a policy violation.
    const policy = (document as Document & { featurePolicy?: { allowsFeature(name: string): boolean } }).featurePolicy;
    if (window.self !== window.top && policy && !policy.allowsFeature('screen-wake-lock')) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      /* wake lock is optional */
    }
  }

  private releaseWakeLock(): void {
    if (!this.wakeLock) return;
    void this.wakeLock.release().catch(() => undefined);
    this.wakeLock = null;
  }

  /** Queue the current media (or its subtitle file) in the download manager. */
  private async downloadCurrent(kind: 'file' | 'subtitle' = 'file'): Promise<void> {
    const media = this.store.current;
    const url = media?.url;
    if (!url || !/^https?:/i.test(url)) {
      toast('Only network sources can be queued — local files are already on your device', 'warn');
      return;
    }
    if (/\.(m3u8|mpd)(\?|$)/i.test(url)) {
      toast('A manifest is a stream, not a single file — nothing to download', 'warn');
      return;
    }
    const { downloads } = await import('../../downloads/manager');
    const job = await downloads.enqueue(url, { name: media?.name, kind });
    toast(job ? 'Added to Downloads' : 'Already in the queue', job ? 'ok' : 'warn');
  }

  /** Copy a deep link to the current moment (or the embed URL in embed mode). */
  private async copyShareLink(): Promise<void> {
    const media = this.store.current;
    const seconds = Math.max(0, Math.floor(this.pm.currentTime));
    const base = `${window.location.origin}${window.location.pathname}`;
    const link = media?.url
      ? `${base}#/embed?src=${encodeURIComponent(media.url)}&start=${seconds}`
      : `${base}#/player?t=${seconds}`;
    const ok = await copyText(link);
    toast(ok ? `Link copied at ${formatTime(seconds)}` : 'Clipboard blocked', ok ? 'ok' : 'warn');
  }

  private async screenshot(): Promise<void> {
    const canvas = this.pm.captureCanvas();
    const name = `${(this.media?.name ?? 'frame').replace(/\.[^.]+$/, '')}_${Math.round(this.pm.currentTime)}s.png`;

    // toBlob avoids a multi-megabyte base64 string on 4K frames.
    if (canvas?.toBlob) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = el('a', { href: url, download: name });
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast('Frame saved', 'ok');
        return;
      }
    }

    const data = await this.pm.captureFrame();
    if (!data) {
      toast('This frame cannot be captured (cross-origin video or unsupported engine).', 'warn');
      return;
    }
    const link = el('a', { href: data, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    toast('Frame saved', 'ok');
  }

  private setLoading(visible: boolean, text = 'Loading…'): void {
    this.loading.classList.toggle('is-visible', visible);
    const label = this.loading.querySelector('p');
    if (label) label.textContent = text;
  }

  /** Feed the governor once a second and re-apply budgets when it changes. */
  private samplePressure(_current: number): void {
    const now = performance.now();
    if (now - this.governorAt < 1000) return;
    this.governorAt = now;
    const video = this.pm.currentEngine?.video ?? null;
    const quality = video?.getVideoPlaybackQuality?.();
    const changed = this.governor.sample({
      droppedFrames: quality?.droppedVideoFrames ?? 0,
      totalFrames: quality?.totalVideoFrames ?? 0,
      buffering: this.pm.buffering,
      stalled: false,
      engineKind: this.pm.currentEngine?.kind ?? 'native',
    });
    if (!changed) return;
    document.documentElement.dataset.profile = this.governor.profile;
    this.pm.applyBudgets(this.governor.budgets);
    toast(`Lowered to the ${this.governor.profile} profile to keep playback smooth`, 'info');
  }

  /**
   * Playback recovery: if the clock stops advancing while we believe we are
   * playing, nudge the pipeline, and after two failed nudges try a mirror.
   */
  private watchForStall(current: number): void {
    if (this.pm.paused || this.isEmbed) {
      this.lastProgress = { at: performance.now(), time: current, recoveries: 0 };
      return;
    }
    const now = performance.now();
    if (Math.abs(current - this.lastProgress.time) > 0.25) {
      this.lastProgress = { at: now, time: current, recoveries: this.lastProgress.recoveries };
      return;
    }
    if (now - this.lastProgress.at < 8000) return;

    this.lastProgress.at = now;
    this.lastProgress.recoveries += 1;
    if (this.lastProgress.recoveries <= 2) {
      toast('Playback stalled — recovering…', 'warn');
      this.pm.seek(current + 0.4);
      void this.pm.play();
      return;
    }
    if (this.tryFallbackSource()) return;
    toast('Playback stalled and no other source is available', 'err');
  }

  /** Recover after the network drops and comes back. */
  private readonly connectionHandlers: Array<[string, () => void]> = [];

  private watchConnection(): void {
    const onOffline = () => {
      this.wasPlayingBeforeOffline = !this.pm.paused;
      if (this.wasPlayingBeforeOffline) this.pm.pause();
      toast('You are offline — playback paused', 'warn');
    };
    const onOnline = () => {
      if (!this.wasPlayingBeforeOffline) return;
      this.wasPlayingBeforeOffline = false;
      const position = this.pm.currentTime;
      toast('Back online — resuming', 'ok');
      void this.loadCurrent().then(() => {
        if (position > 0) this.pm.seek(position);
        void this.pm.play();
      });
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    this.connectionHandlers.push(['offline', onOffline], ['online', onOnline]);
  }

  private wasPlayingBeforeOffline = false;

  /** Try the next configured mirror, keeping the position. */
  private tryFallbackSource(): boolean {
    const media = this.store.current;
    if (!media?.sources?.length) return false;
    const [next, ...rest] = media.sources;
    const position = this.pm.currentTime;
    media.url = next;
    media.sources = rest;
    toast('Primary source failed — trying a mirror', 'warn');
    void this.loadCurrent().then(() => {
      if (position > 0) this.pm.seek(position);
    });
    return true;
  }

  private showError(error: AppError | AppErrorInfo): void {
    const info = error instanceof AppError ? error.toInfo() : error;
    const diagnosticsButton = el('button', { class: 'btn btn--sm', html: `${icon('activity', 15)} Diagnostics` });
    diagnosticsButton.addEventListener('click', () => this.ctx.router.navigate('diagnostics'));

    const copyButton = el('button', { class: 'btn btn--sm', html: `${icon('copy', 15)} Copy details` });
    copyButton.addEventListener('click', async () => {
      const ok = await copyText(JSON.stringify(info, null, 2));
      toast(ok ? 'Error details copied' : 'Clipboard blocked', ok ? 'ok' : 'warn');
    });

    const corsBlocked = info.code === 'cors-required' || info.code === 'cors';
    const retryButton = el('button', {
      class: `btn btn--sm${corsBlocked ? '' : ' btn--primary'}`,
      html: `${icon('refresh', 15)} Retry`,
    });
    retryButton.addEventListener('click', () => {
      this.hideError();
      void this.loadCurrent();
    });

    const otherButton = el('button', {
      class: `btn btn--sm${corsBlocked ? ' btn--primary' : ''}`,
      html: `${icon('layers', 15)} ${corsBlocked ? 'Try native playback' : 'Try another engine'}`,
    });
    otherButton.addEventListener('click', () => {
      this.hideError();
      if (corsBlocked) {
        toast('Trying native playback — this works for MP4/WebM, not MKV.', 'info');
        void this.loadCurrent([], { ignoreCorsBlock: true });
        return;
      }
      const current = this.store.settings.enginePreference;
      const next = current === 'webcodecs' ? 'native' : 'webcodecs';
      this.store.updateSettings({ enginePreference: next });
      toast(`Engine preference: ${next}`, 'info');
      void this.loadCurrent();
    });

    // Host-blocked sources get actionable extras: a ready-made CORS policy and
    // a download escape hatch (fetch cannot be used, but a navigation can).
    const corsActions: Node[] = [];
    if (corsBlocked) {
      const snippet = JSON.stringify(
        [
          {
            AllowedOrigins: [location.origin],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type'],
            MaxAgeSeconds: 3600,
          },
        ],
        null,
        2,
      );
      if (this.store.settings.corsProxy.trim()) {
        const bypass = el('button', { class: 'btn btn--sm', html: `${icon('refresh', 15)} Retry without proxy` });
        bypass.addEventListener('click', () => {
          this.store.updateSettings({ corsProxy: '' });
          void this.loadCurrent([], { ignoreCorsBlock: true });
        });
        corsActions.push(bypass);
      }

      const proxyButton = el('button', { class: 'btn btn--sm', html: `${icon('link', 15)} Use a proxy` });
      proxyButton.addEventListener('click', () => {
        this.ctx.router.navigate('settings', { section: 'network' });
      });
      corsActions.push(proxyButton);

      const corsButton = el('button', { class: 'btn btn--sm', html: `${icon('copy', 15)} Copy CORS config` });
      corsButton.addEventListener('click', async () => {
        const ok = await copyText(snippet);
        toast(ok ? 'CORS policy copied — paste it into your bucket settings.' : 'Clipboard blocked', ok ? 'ok' : 'warn');
      });
      corsActions.push(corsButton);

      const url = this.media?.url;
      if (url) {
        const downloadButton = el('button', { class: 'btn btn--sm', html: `${icon('download', 15)} Download file` });
        downloadButton.addEventListener('click', () => {
          window.open(url, '_blank', 'noopener');
          toast('Downloading in a new tab — then use “Open media”.', 'info');
        });
        corsActions.push(downloadButton);
      }
    }

    const card = el('div', { class: 'error-card' });
    card.innerHTML = `
      <div class="error-card__icon">${icon('alert', 22)}</div>
      <h2>${esc(info.title)}</h2>
      <p>${esc(info.message)}</p>
      ${info.detail ? `<p class="mono text-xs" style="margin-top:10px;color:var(--txt-3);word-break:break-word">${esc(info.detail)}</p>` : ''}
      ${info.suggestions.length ? `<ul>${info.suggestions.map((suggestion) => `<li>${esc(suggestion)}</li>`).join('')}</ul>` : ''}
    `;
    const actions = el('div', { class: 'error-card__actions' }, [
      otherButton,
      ...corsActions,
      retryButton,
      diagnosticsButton,
      copyButton,
    ]);
    card.append(actions);
    this.errorBox.innerHTML = '';
    this.errorBox.append(card);
    this.errorBox.classList.add('is-visible');
    this.showChrome(true);
    this.setLoading(false);
  }

  private hideError(): void {
    this.errorBox.classList.remove('is-visible');
    this.errorBox.innerHTML = '';
  }

  private exit(): void {
    this.saveHistory(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    this.ctx.router.navigate('home');
  }

  private shiftHeld = false;
  private readonly onShift = (event: KeyboardEvent) => {
    this.shiftHeld = event.shiftKey;
  };

  private keyboardHandlers(): KeyboardHandlers {
    window.addEventListener('keydown', this.onShift);
    window.addEventListener('keyup', this.onShift);
    return {
      playPause: () => void this.togglePlay(),
      seekForward: () => this.pm.seekBy(this.store.settings.seekStepLarge && this.shiftHeld ? this.store.settings.seekStepLarge : this.store.settings.seekStep),
      seekBackward: () => this.pm.seekBy(-(this.shiftHeld ? this.store.settings.seekStepLarge : this.store.settings.seekStep)),
      volumeUp: () => this.changeVolume(0.05),
      volumeDown: () => this.changeVolume(-0.05),
      mute: () => this.toggleMute(),
      fullscreen: () => {
        const canFullscreen = !!(this.el.requestFullscreen || (this.el as HTMLElement & { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen);
        if (!canFullscreen) {
          toast('This browser cannot make a page fullscreen. On iPhone, use “Add to Home Screen” for a full-screen player.', 'info');
          return;
        }
        void this.toggleFullscreen();
      },
      pip: () => void this.togglePip(),
      subtitles: () => {
        if (this.subtitles.active) {
          this.subtitles.select(null);
          toast('Subtitles off');
        } else if (this.subtitles.tracks.length) {
          this.subtitles.select(this.subtitles.tracks[0].id);
          toast('Subtitles on');
        } else {
          this.openPanel('subtitles');
        }
      },
      audioTrack: () => this.openPanel('tracks'),
      speedUp: () => {
        const index = SPEEDS.findIndex((speed) => speed > this.rateValue + 0.01);
        this.setRate(index === -1 ? SPEEDS[SPEEDS.length - 1] : SPEEDS[index]);
      },
      speedDown: () => {
        const index = [...SPEEDS].reverse().findIndex((speed) => speed < this.rateValue - 0.01);
        this.setRate(index === -1 ? SPEEDS[0] : [...SPEEDS].reverse()[index]);
      },
      next: () => this.playQueue(1),
      previous: () => this.playQueue(-1),
      frameForward: () => {
        if (this.store.settings.frameStepOnPause && !this.pm.paused) {
          this.pm.pause();
        }
        void this.pm.stepFrame(1);
      },
      frameBackward: () => {
        if (this.store.settings.frameStepOnPause && !this.pm.paused) {
          this.pm.pause();
        }
        void this.pm.stepFrame(-1);
      },
      addBookmark: () => this.addBookmark(formatTime(this.pm.currentTime)),
      abLoop: () => {
        if (this.abLoopValue.a === null) this.setAbLoop({ a: this.pm.currentTime, b: null });
        else if (this.abLoopValue.b === null) this.setAbLoop({ a: this.abLoopValue.a, b: this.pm.currentTime });
        else this.setAbLoop({ a: null, b: null });
        toast(this.abLoopValue.a === null ? 'A-B cleared' : this.abLoopValue.b === null ? 'A set' : 'A-B loop set', 'ok');
      },
      diagnostics: () => this.toggleStats(),
      screenshot: () => void this.screenshot(),
      escape: () => {
        if (this.closeTransient()) return;
        if (this.panelKind) this.closePanel();
        else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else this.exit();
      },
    };
  }

  /* ---------------------------------------------------------------- destroy */

  destroy(): void {
    this.destroyed = true;
    this.saveHistory(false);
    cancelAnimationFrame(this.rafId);
    if (this.chromeTimer) window.clearTimeout(this.chromeTimer);
    if (this.hudTimer) window.clearTimeout(this.hudTimer);
    if (this.sleepTimerId) window.clearTimeout(this.sleepTimerId);
    this.releaseWakeLock();
    window.removeEventListener('keydown', this.onShift);
    window.removeEventListener('keyup', this.onShift);
    this.gestures.destroy();
    this.keyboard.detach();
    this.subtitles.destroy();
    this.danmaku.destroy();
    // Lifecycle hygiene: without this, closed players keep reacting to network
    // events and embed messages, and the stats timer keeps ticking.
    window.clearInterval(this.statsTimer);
    this.statsTimer = 0;
    for (const [type, handler] of this.connectionHandlers) window.removeEventListener(type, handler);
    this.connectionHandlers.length = 0;
    if (this.bridgeHandler) {
      window.removeEventListener('message', this.bridgeHandler);
      this.bridgeHandler = null;
    }
    this.shortcutsNode?.remove();
    this.shortcutsNode = null;
    this.closeContextMenu();
    this.lockNode?.remove();
    this.lockNode = null;
    this.pm.destroy();
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.unsubs = [];
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    document.body.classList.remove('is-playing');
    this.el.remove();
  }
}

const TEMPLATE = `
  <div class="player__stage">
    <div class="player__media"></div>
    <div class="danmaku-host"></div>
    <div class="subs-layer"></div>
    <div class="ass-layer"></div>
    <canvas class="subs-canvas" aria-hidden="true"></canvas>
    <div class="gesture-layer" aria-hidden="true"></div>

    <div class="player__center">
      <button class="center-play" id="center-play" aria-label="Play" title="Play / pause">${icon('play', 34)}</button>
    </div>
    <div class="player__spinner" aria-hidden="true"></div>
    <div class="stats-overlay hidden" id="stats-overlay" aria-live="off"></div>
    <div class="sr-only" id="a11y-status" role="status" aria-live="polite"></div>

    <div class="hud hud--center" id="hud-center"></div>
    <div class="hud hud--left" id="hud-left"></div>
    <div class="hud hud--right" id="hud-right"></div>
    <div class="seek-preview"></div>

    <div class="player__loading is-visible">
      <div class="loading-card">
        <div class="loading-ring"></div>
        <p>Preparing playback…</p>
      </div>
    </div>

    <div class="player__error"></div>
  </div>

  <div class="pbar pbar--top">
    <button class="pbtn" id="btn-back" aria-label="Back" title="Back to library">${icon('chevronLeft', 22)}</button>
    <div class="pbar__title"><h1></h1><p></p></div>
    <div class="pbar__actions">
      <span class="chip sleep-chip hidden" style="background:rgba(255,255,255,.12);color:#fff;border-color:transparent"></span>
      <button class="pbtn" id="btn-tracks" data-collapse="1" aria-label="Tracks and quality" title="Tracks & quality">${icon('layers', 20)}</button>
      <button class="pbtn" id="btn-audio" data-collapse="1" aria-label="Audio settings" title="Audio & equaliser">${icon('audio', 20)}</button>
      <button class="pbtn" id="btn-danmaku" aria-label="Danmaku" aria-pressed="false" title="Danmaku (D)">${icon('message', 20)}</button>
      <button class="pbtn" id="btn-subs" aria-label="Subtitles" title="Subtitles">${icon('subtitles', 20)}</button>
      <button class="pbtn" id="btn-bookmark" data-collapse="1" aria-label="Add bookmark" title="Bookmark (K)">${icon('bookmarkPlus', 20)}</button>
      <button class="pbtn" id="btn-more" aria-label="More options" title="More">${icon('more', 20)}</button>
    </div>
  </div>

  <div class="pbar pbar--bottom">
    <div class="time-row">
      <b>0:00</b>
      <span class="muted">/</span>
      <span class="duration">0:00</span>
      <span class="live-badge chip chip--err hidden" style="height:20px;font-size:10px">LIVE</span>
      <span class="chapter truncate"></span>
      <span class="spacer"></span>
      <button class="chip chip--accent hidden" id="skip-chip" style="height:24px;font-size:11px"></button>
      <span class="badge-soft" id="engine-badge"></span>
    </div>
    <div class="tl" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="tl__rail">
        <div class="tl__buffered"></div>
        <div class="tl__played"></div>
        <div class="tl__chapters"></div>
        <div class="tl__ab" style="display:none"></div>
        <div class="tl__handle"></div>
      </div>
      <div class="tl__hover"><img alt="" style="display:none" /><span>0:00</span></div>
    </div>
    <div class="controls">
      <div class="controls__group">
        <button class="pbtn" id="btn-prev" aria-label="Previous" title="Previous (B)">${icon('prev', 18)}</button>
        <button class="pbtn pbtn--lg" id="btn-back10" aria-label="Seek back" title="Back 10s (←)">${icon('seekBack', 22)}</button>
        <button class="pbtn pbtn--play" id="btn-play" aria-label="Play">${icon('play', 24)}</button>
        <button class="pbtn pbtn--lg" id="btn-fwd10" aria-label="Seek forward" title="Forward 10s (→)">${icon('seekForward', 22)}</button>
        <button class="pbtn" id="btn-next" aria-label="Next" title="Next (N)">${icon('next', 18)}</button>
      </div>
      <div class="controls__center">
        <div class="vol-wrap" id="vol-wrap">
          <button class="pbtn" id="btn-mute" aria-label="Mute" title="Mute (M)">${icon('volume', 20)}</button>
          <div class="vol"><input class="range" id="volume-range" type="range" min="0" max="100" step="1" value="100" aria-label="Volume" /></div>
        </div>
        <button class="pbtn" id="btn-brightness" aria-label="Brightness" title="Brightness">${icon('sun', 20)}</button>
        <button class="pbtn" id="btn-loop" aria-label="Repeat mode" title="Repeat">${icon('repeat', 20)}</button>
      </div>
      <div class="controls__right">
        <button class="rate-btn" id="btn-speed" title="Playback speed">1×</button>
        <button class="pbtn hidden" id="btn-quality" aria-label="Quality" title="Quality">${icon('activity', 20)}</button>
        <button class="pbtn" id="btn-video" data-collapse="1" aria-label="Picture settings" title="Picture & aspect">${icon('sliders', 20)}</button>
        <button class="pbtn" id="btn-playback" data-collapse="1" aria-label="Playback options" title="Playback options">${icon('gauge', 20)}</button>
        <button class="pbtn" id="btn-info" data-collapse="1" aria-label="Playback info" title="Playback info (I)">${icon('info', 20)}</button>
        <button class="pbtn" id="btn-shot" data-collapse="1" aria-label="Screenshot" title="Save frame (S)">${icon('scan', 20)}</button>
        <button class="pbtn" id="btn-pip" data-collapse="1" aria-label="Picture in picture" title="Picture-in-Picture (P)">${icon('pip', 20)}</button>
        <button class="pbtn" id="btn-fullscreen" aria-label="Fullscreen" title="Fullscreen (F)">${icon('maximize', 20)}</button>
      </div>
    </div>
  </div>
  <div class="panel-host"></div>
`;
