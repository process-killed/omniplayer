// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { budgetsFor } from '../src/core/deviceProfile';
import { ResourceGovernor } from '../src/core/resourceGovernor';
import { DanmakuEngine } from '../src/danmaku/engine';

describe('low-memory budgets', () => {
  it('keeps decode and queues small enough for a weak phone', () => {
    const low = budgetsFor('low');
    expect(low.maxDecodeHeight).toBeLessThanOrEqual(480);
    expect(low.frameQueue).toBeLessThanOrEqual(2);
    expect(low.cacheMb).toBeLessThanOrEqual(16);
    expect(low.effects).toBe(false);
    expect(low.thumbnails).toBe(false);
    expect(low.danmakuPerSecond).toBeLessThanOrEqual(4);
  });

  it('still gives stronger devices headroom', () => {
    expect(budgetsFor('high').maxDecodeHeight).toBeGreaterThanOrEqual(2160);
    expect(budgetsFor('balanced').maxDecodeHeight).toBe(1080);
  });

  it('downgrades before a weak device starts dropping frames', () => {
    const governor = new ResourceGovernor('balanced');
    const changed = governor.sample(
      { droppedFrames: 30, totalFrames: 100, buffering: true, stalled: false, engineKind: 'webcodecs' },
      1000,
    );
    expect(changed).toBe(true);
    expect(governor.budgets.frameQueue).toBeLessThanOrEqual(3);
  });
});

describe('danmaku limits', () => {
  it('never exceeds the active-node cap', () => {
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 400 });
    const engine = new DanmakuEngine(host);
    engine.setActiveLimit(10);
    engine.setSettings({ enabled: true });
    engine.setItems(
      Array.from({ length: 200 }, (_, index) => ({
        time: index * 0.01,
        text: `c${index}`,
        color: '#fff',
        mode: 'scroll' as const,
        size: 25,
      })),
    );
    for (let t = 0; t < 3; t += 0.05) engine.tick(t);
    expect(host.querySelectorAll('.danmaku').length).toBeLessThanOrEqual(10);
    engine.destroy();
  });
});
