import type { Settings } from '../types';
import { clamp } from '../utils/format';

export type TapZone = 'left' | 'center' | 'right';

export interface GestureCallbacks {
  onTap(): void;
  onDoubleTap(zone: TapZone): void;
  onSeekPreview(target: number, delta: number): void;
  onSeekCommit(target: number): void;
  onVolumeDelta(delta: number): void;
  onBrightnessDelta(delta: number): void;
  onZoomChange(zoom: number): void;
  onLongPressStart(): void;
  onLongPressEnd(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getZoom(): number;
}

interface PointerState {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTime: number;
}

/**
 * MX Player-style touch gestures: double-tap zones, horizontal scrub,
 * vertical volume/brightness, long-press speed boost and pinch zoom.
 * Every gesture is individually configurable and never blocks the controls.
 */
export class GestureManager {
  private pointers = new Map<number, PointerState>();
  private mode: 'none' | 'seek' | 'volume' | 'brightness' | 'zoom' = 'none';
  private longPressTimer: number | null = null;
  private tapTimer: number | null = null;
  private lastTapAt = 0;
  private seekBase = 0;
  private seekTarget = 0;
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;
  private longPressing = false;
  private attached = false;

  constructor(
    private readonly layer: HTMLElement,
    private readonly callbacks: GestureCallbacks,
    private readonly getSettings: () => Settings,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.layer.addEventListener('pointerdown', this.onPointerDown);
    this.layer.addEventListener('pointermove', this.onPointerMove);
    this.layer.addEventListener('pointerup', this.onPointerUp);
    this.layer.addEventListener('pointercancel', this.onPointerCancel);
    this.layer.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.layer.removeEventListener('pointerdown', this.onPointerDown);
    this.layer.removeEventListener('pointermove', this.onPointerMove);
    this.layer.removeEventListener('pointerup', this.onPointerUp);
    this.layer.removeEventListener('pointercancel', this.onPointerCancel);
    this.layer.removeEventListener('contextmenu', this.onContextMenu);
    this.clearTimers();
  }

  private onContextMenu = (event: Event) => {
    event.preventDefault();
  };

  private clearTimers(): void {
    if (this.longPressTimer) window.clearTimeout(this.longPressTimer);
    if (this.tapTimer) window.clearTimeout(this.tapTimer);
    this.longPressTimer = null;
    this.tapTimer = null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    const settings = this.getSettings();
    if (!settings.gesturesEnabled) return;
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      startTime: performance.now(),
    });
    try {
      this.layer.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    if (this.pointers.size === 2 && settings.pinchZoom) {
      this.mode = 'zoom';
      this.pinchStartDistance = this.pointerDistance();
      this.pinchStartZoom = this.callbacks.getZoom();
      this.cancelLongPress();
      return;
    }

    this.longPressTimer = window.setTimeout(() => {
      this.longPressing = true;
      this.callbacks.onLongPressStart();
    }, 520);
  };

  private pointerDistance(): number {
    const list = Array.from(this.pointers.values());
    if (list.length < 2) return 0;
    return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
  }

  private onPointerMove = (event: PointerEvent): void => {
    const state = this.pointers.get(event.pointerId);
    if (!state) return;
    state.x = event.clientX;
    state.y = event.clientY;
    const settings = this.getSettings();
    if (!settings.gesturesEnabled) return;

    if (this.mode === 'zoom') {
      const distance = this.pointerDistance();
      if (this.pinchStartDistance > 0) {
        const zoom = clamp(this.pinchStartZoom * (distance / this.pinchStartDistance), 1, 4);
        this.callbacks.onZoomChange(zoom);
      }
      return;
    }

    const dx = state.x - state.startX;
    const dy = state.y - state.startY;
    if (this.mode === 'none') {
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      this.cancelLongPress();
      const rect = this.layer.getBoundingClientRect();
      if (Math.abs(dx) > Math.abs(dy)) {
        if (!settings.swipeSeek) return;
        this.mode = 'seek';
        this.seekBase = this.callbacks.getCurrentTime();
        this.seekTarget = this.seekBase;
      } else if (settings.verticalSwipe === 'off') {
        return;
      } else if (settings.verticalSwipe === 'volume') {
        this.mode = 'volume';
      } else {
        this.mode = state.startX - rect.left > rect.width / 2 ? 'volume' : 'brightness';
      }
    }

    const rect = this.layer.getBoundingClientRect();
    if (this.mode === 'seek') {
      const duration = this.callbacks.getDuration();
      if (!Number.isFinite(duration) || duration <= 0) return;
      const span = Math.max(1, rect.width);
      const delta = (dx / span) * 90 * settings.swipeSeekSensitivity;
      this.seekTarget = clamp(this.seekBase + delta, 0, Math.max(0, duration - 0.2));
      this.callbacks.onSeekPreview(this.seekTarget, this.seekTarget - this.seekBase);
      return;
    }
    if (this.mode === 'volume') {
      const delta = -dy / Math.max(1, rect.height);
      this.callbacks.onVolumeDelta(delta);
      state.startY = state.y;
      return;
    }
    if (this.mode === 'brightness') {
      const delta = -dy / Math.max(1, rect.height);
      this.callbacks.onBrightnessDelta(delta);
      state.startY = state.y;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const state = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.cancelLongPress();

    if (this.longPressing) {
      this.longPressing = false;
      this.callbacks.onLongPressEnd();
      this.mode = 'none';
      return;
    }

    if (this.mode === 'seek') {
      this.callbacks.onSeekCommit(this.seekTarget);
      this.mode = 'none';
      return;
    }
    if (this.mode !== 'none') {
      this.mode = 'none';
      return;
    }
    if (!state) return;

    const settings = this.getSettings();
    if (!settings.gesturesEnabled) return;
    const moved = Math.hypot(state.x - state.startX, state.y - state.startY);
    if (moved > 12) return;
    const held = performance.now() - state.startTime;

    const now = performance.now();
    if (now - this.lastTapAt < 300) {
      // Second tap of a double-tap.
      if (this.tapTimer) {
        window.clearTimeout(this.tapTimer);
        this.tapTimer = null;
      }
      this.lastTapAt = 0;
      const rect = this.layer.getBoundingClientRect();
      const relative = (state.x - rect.left) / Math.max(1, rect.width);
      const zone: TapZone = relative < 0.35 ? 'left' : relative > 0.65 ? 'right' : 'center';
      this.callbacks.onDoubleTap(zone);
      return;
    }
    this.lastTapAt = now;
    if (held > 400) return;
    this.tapTimer = window.setTimeout(() => {
      this.tapTimer = null;
      this.callbacks.onTap();
    }, 240);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.cancelLongPress();
    if (this.mode === 'seek') this.callbacks.onSeekCommit(this.seekTarget);
    this.mode = 'none';
  };

  private cancelLongPress(): void {
    if (this.longPressTimer) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  destroy(): void {
    this.detach();
    this.pointers.clear();
  }
}
