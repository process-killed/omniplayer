import type { AppErrorInfo, MediaSourceSpec, Settings } from '../types';
import { Emitter } from '../utils/emitter';
import { applyTheme, DEFAULT_SETTINGS, loadSettings, saveSettings } from '../storage/settings';

export interface StoreEvents {
  settings: { settings: Settings; changed: string[] };
  current: { media: MediaSourceSpec | null };
  error: { error: AppErrorInfo | null };
  queue: { queue: MediaSourceSpec[]; index: number };
  notice: { message: string; level?: 'info' | 'warn' };
}

/**
 * Application state: settings (persisted), the media currently loaded and the
 * play queue. Pages subscribe to what they need and re-render themselves.
 */
export class Store extends Emitter<StoreEvents> {
  settings: Settings;
  current: MediaSourceSpec | null = null;
  queue: MediaSourceSpec[] = [];
  queueIndex = -1;

  private saveTimer: number | null = null;

  constructor() {
    super();
    this.settings = loadSettings();
    applyTheme(this.settings);
  }

  updateSettings(patch: Partial<Settings>): void {
    const changed = Object.keys(patch);
    this.settings = { ...this.settings, ...patch };
    if (changed.includes('theme') || changed.includes('accent') || changed.includes('density')) {
      applyTheme(this.settings);
    }
    this.emit('settings', { settings: this.settings, changed });
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      saveSettings(this.settings);
      this.saveTimer = null;
    }, 180);
  }

  replaceSettings(settings: Settings): void {
    this.settings = settings;
    applyTheme(settings);
    saveSettings(settings);
    this.emit('settings', { settings, changed: Object.keys(settings) });
  }

  resetSettings(): void {
    this.replaceSettings({ ...DEFAULT_SETTINGS, keyboardBindings: { ...DEFAULT_SETTINGS.keyboardBindings } });
  }

  setCurrent(media: MediaSourceSpec | null): void {
    this.current = media;
    this.emit('current', { media });
  }

  setQueue(queue: MediaSourceSpec[], index = 0): void {
    this.queue = queue;
    this.queueIndex = index;
    this.emit('queue', { queue, index });
  }

  setQueueIndex(index: number): void {
    this.queueIndex = index;
    this.emit('queue', { queue: this.queue, index });
  }

  nextInQueue(): MediaSourceSpec | null {
    if (this.queue.length === 0) return null;
    const next = this.queueIndex + 1;
    if (next >= this.queue.length) {
      if (this.settings.loopMode === 'all') {
        this.queueIndex = 0;
        return this.queue[0];
      }
      return null;
    }
    this.queueIndex = next;
    return this.queue[next];
  }

  previousInQueue(): MediaSourceSpec | null {
    if (this.queue.length === 0) return null;
    const prev = this.queueIndex - 1;
    if (prev < 0) return this.queue[0] ?? null;
    this.queueIndex = prev;
    return this.queue[prev];
  }

  setError(error: AppErrorInfo | null): void {
    this.emit('error', { error });
  }

  notify(message: string, level: 'info' | 'warn' = 'info'): void {
    this.emit('notice', { message, level });
  }
}

export const store = new Store();
