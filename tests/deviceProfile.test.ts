import { describe, expect, it } from 'vitest';
import { budgetsFor, pickProfile, type DeviceSignals } from '../src/core/deviceProfile';
import { ResourceGovernor } from '../src/core/resourceGovernor';

const base: DeviceSignals = {
  memoryGb: null, cores: null, mobile: false, tv: false,
  webCodecs: true, mse: true, saveData: false, effectiveType: null,
};

describe('device profiles', () => {
  it('prefers TV for TV user agents', () => {
    expect(pickProfile({ ...base, tv: true, memoryGb: 8 }).profile).toBe('tv');
  });

  it('goes low for data-saver or 2G', () => {
    expect(pickProfile({ ...base, saveData: true }).profile).toBe('low');
    expect(pickProfile({ ...base, effectiveType: '2g' }).profile).toBe('low');
  });

  it('stays conservative when memory is unknown', () => {
    expect(pickProfile({ ...base, mobile: true }).profile).toBe('low');
    expect(pickProfile({ ...base, cores: 16 }).profile).toBe('balanced');
    expect(pickProfile({ ...base, cores: 2 }).profile).toBe('low');
  });

  it('scales with reported memory', () => {
    expect(pickProfile({ ...base, memoryGb: 2 }).profile).toBe('low');
    expect(pickProfile({ ...base, memoryGb: 4 }).profile).toBe('balanced');
    expect(pickProfile({ ...base, memoryGb: 8, cores: 8 }).profile).toBe('high');
    expect(pickProfile({ ...base, memoryGb: 8, mobile: true }).profile).toBe('balanced');
  });

  it('exposes matching budgets', () => {
    expect(budgetsFor('low').frameQueue).toBeLessThan(budgetsFor('high').frameQueue);
    expect(budgetsFor('low').maxDecodeHeight).toBeLessThanOrEqual(720);
    expect(budgetsFor('low').effects).toBe(false);
    expect(budgetsFor('balanced').maxDecodeHeight).toBe(1080);
  });
});

describe('resource governor', () => {
  it('steps down on heavy dropped frames', () => {
    const governor = new ResourceGovernor('high');
    const changed = governor.sample({ droppedFrames: 40, totalFrames: 100, buffering: false, stalled: false, engineKind: 'webcodecs' }, 1000);
    expect(changed).toBe(true);
    expect(governor.profile).toBe('balanced');
  });

  it('steps down on stalls, up to three times', () => {
    const governor = new ResourceGovernor('high');
    governor.sample({ droppedFrames: 0, totalFrames: 0, buffering: false, stalled: true, engineKind: 'webcodecs' }, 1);
    governor.sample({ droppedFrames: 0, totalFrames: 0, buffering: false, stalled: true, engineKind: 'webcodecs' }, 2);
    governor.sample({ droppedFrames: 0, totalFrames: 0, buffering: false, stalled: true, engineKind: 'webcodecs' }, 3);
    expect(governor.profile).toBe('low');
  });

  it('never downgrades healthy native playback', () => {
    const governor = new ResourceGovernor('high');
    const changed = governor.sample({ droppedFrames: 2, totalFrames: 300, buffering: false, stalled: false, engineKind: 'native' }, 1000);
    expect(changed).toBe(false);
    expect(governor.profile).toBe('high');
  });

  it('restores a level only after two stable minutes', () => {
    const governor = new ResourceGovernor('balanced');
    governor.sample({ droppedFrames: 0, totalFrames: 300, buffering: false, stalled: false, engineKind: 'webcodecs' }, 1000);
    expect(governor.sample({ droppedFrames: 0, totalFrames: 600, buffering: false, stalled: false, engineKind: 'webcodecs' }, 60_000)).toBe(false);
    expect(governor.sample({ droppedFrames: 0, totalFrames: 900, buffering: false, stalled: false, engineKind: 'webcodecs' }, 200_000)).toBe(true);
    expect(governor.profile).toBe('high');
  });
});
