// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, exportSettings, importSettings, loadSettings } from '../src/storage/settings';
import { clamp, formatBytes, formatTime, formatTimePrecise, languageName, pct, uid } from '../src/utils/format';

describe('time formatting', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(-4)).toBe('0:00');
  });

  it('formats with tenths', () => {
    expect(formatTimePrecise(62.34)).toBe('1:02.3');
    expect(formatTimePrecise(-1.5)).toBe('-0:01.5');
  });
});

describe('size formatting', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
    expect(formatBytes(undefined)).toBe('—');
  });
});

describe('language names', () => {
  it('maps ISO codes to readable names', () => {
    expect(languageName('jpn')).toBe('Japanese');
    expect(languageName('hi-IN')).toBe('Hindi');
    expect(languageName('und')).toBe('Unknown');
    expect(languageName(undefined)).toBeUndefined();
  });
});

describe('math helpers', () => {
  it('clamps and computes percentages', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(pct(30, 120)).toBe(25);
    expect(pct(30, 0)).toBe(0);
  });

  it('creates unique ids', () => {
    const a = uid('bm');
    const b = uid('bm');
    expect(a).not.toBe(b);
    expect(a.startsWith('bm_')).toBe(true);
  });
});

describe('settings', () => {
  it('has sane defaults', () => {
    expect(DEFAULT_SETTINGS.eqGains).toHaveLength(10);
    expect(DEFAULT_SETTINGS.seekStep).toBe(10);
    expect(DEFAULT_SETTINGS.enginePreference).toBe('auto');
    expect(Object.keys(DEFAULT_SETTINGS.keyboardBindings).length).toBeGreaterThan(10);
  });

  it('round-trips through export and import', () => {
    const custom = { ...DEFAULT_SETTINGS, theme: 'amoled' as const, subtitleSize: 34, eqGains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
    const json = exportSettings(custom);
    const { settings, count } = importSettings(json);
    expect(count).toBeGreaterThan(10);
    expect(settings.theme).toBe('amoled');
    expect(settings.subtitleSize).toBe(34);
    expect(settings.eqGains[9]).toBe(10);
  });

  it('rejects garbage without throwing on partial files', () => {
    const { settings } = importSettings(JSON.stringify({ settings: { theme: 'light', seekStep: '15' } }));
    expect(settings.theme).toBe('light');
    expect(settings.seekStep).toBe(15);
    expect(settings.volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('throws when no settings object is present', () => {
    expect(() => importSettings('"hello"')).toThrow();
  });

  it('loads defaults when storage is empty', () => {
    localStorage.clear();
    const loaded = loadSettings();
    expect(loaded.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('ignores corrupted storage', () => {
    localStorage.setItem('omniplay:settings:v1', '{not json');
    expect(loadSettings().theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
