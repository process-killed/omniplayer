/**
 * Runtime resource pressure.
 *
 * A profile is a starting point; reality decides. Repeated dropped frames or
 * stalls step the budgets down, and they are only restored after playback has
 * been stable for a while. Hardware-decoded native playback that is already
 * performing well is never downgraded.
 */
import type { DeviceBudgets, ProfileId } from './deviceProfile';
import { budgetsFor } from './deviceProfile';

const ORDER: ProfileId[] = ['low', 'balanced', 'high'];

export interface PressureSample {
  droppedFrames: number;
  totalFrames: number;
  buffering: boolean;
  stalled: boolean;
  engineKind: string;
}

export class ResourceGovernor {
  private level: number;
  private stableSince = 0;
  private lastDropped = 0;
  private lastFrames = 0;
  private downgrades = 0;

  constructor(startProfile: ProfileId) {
    this.level = Math.max(0, ORDER.indexOf(startProfile === 'tv' ? 'high' : startProfile));
  }

  get profile(): ProfileId {
    return ORDER[this.level];
  }

  get budgets(): DeviceBudgets {
    return budgetsFor(this.profile);
  }

  /**
   * Feed a sample roughly once a second. Returns true when the profile changed
   * so the caller can re-apply budgets.
   */
  sample(input: PressureSample, now = Date.now()): boolean {
    const droppedDelta = input.droppedFrames - this.lastDropped;
    const frameDelta = input.totalFrames - this.lastFrames;
    this.lastDropped = input.droppedFrames;
    this.lastFrames = input.totalFrames;

    // Native hardware decoding that is keeping up must not be downgraded.
    const healthyNative = input.engineKind === 'native' && droppedDelta < 5 && !input.stalled;
    if (healthyNative) {
      this.stableSince = this.stableSince || now;
      return this.maybeUpgrade(now);
    }

    const dropRatio = frameDelta > 0 ? droppedDelta / frameDelta : 0;
    const struggling = dropRatio > 0.15 || input.stalled || (input.buffering && dropRatio > 0.05);

    if (struggling) {
      this.stableSince = 0;
      if (this.level > 0 && this.downgrades < 3) {
        this.level -= 1;
        this.downgrades += 1;
        return true;
      }
      return false;
    }

    this.stableSince = this.stableSince || now;
    return this.maybeUpgrade(now);
  }

  /** Restore a level only after two minutes of stable playback. */
  private maybeUpgrade(now: number): boolean {
    if (this.level >= ORDER.length - 1) return false;
    if (!this.stableSince || now - this.stableSince < 120_000) return false;
    this.level += 1;
    this.stableSince = now;
    this.downgrades = 0;
    return true;
  }
}
