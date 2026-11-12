import type { Settings } from '../types';
import { isTypingTarget } from '../ui/dom';

export type KeyboardAction =
  | 'playPause'
  | 'seekForward'
  | 'seekBackward'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'fullscreen'
  | 'pip'
  | 'subtitles'
  | 'audioTrack'
  | 'speedUp'
  | 'speedDown'
  | 'next'
  | 'previous'
  | 'frameForward'
  | 'frameBackward'
  | 'addBookmark'
  | 'abLoop'
  | 'diagnostics'
  | 'screenshot'
  | 'escape';

export type KeyboardHandlers = Partial<Record<KeyboardAction, () => void>>;

function normalize(key: string): string {
  if (key === ' ') return 'space';
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

/**
 * Desktop keyboard control. Bindings are stored in settings, so users can
 * remap any action. Typing in an input never triggers playback shortcuts.
 */
export class KeyboardManager {
  private attached = false;

  constructor(
    private readonly handlers: KeyboardHandlers,
    private readonly getSettings: () => Settings,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const settings = this.getSettings();
    if (!settings.keyboardEnabled) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;

    const key = normalize(event.key);
    const bindings = settings.keyboardBindings ?? {};
    let action: KeyboardAction | null = null;
    for (const [name, binding] of Object.entries(bindings)) {
      const normalizedBinding = normalize(binding.trim());
      if (normalizedBinding === key || (normalizedBinding === 'space' && key === 'space')) {
        action = name as KeyboardAction;
        break;
      }
    }
    if (!action && key === 'escape') action = 'escape';
    if (!action) return;

    const handler = this.handlers[action];
    if (!handler) return;
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
}
