import type { Settings } from '../types';

type Level = Settings['logLevel'];

const ORDER: Record<Level, number> = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

let current: Level = 'warn';

export function setLogLevel(level: Level): void {
  current = level;
}

function enabled(level: Level): boolean {
  return ORDER[level] <= ORDER[current] && current !== 'off';
}

/** Console logging that respects Settings → Advanced → Log level. */
export const log = {
  error: (...args: unknown[]) => {
    if (enabled('error')) console.error('[omniplay]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (enabled('warn')) console.warn('[omniplay]', ...args);
  },
  info: (...args: unknown[]) => {
    if (enabled('info')) console.info('[omniplay]', ...args);
  },
  debug: (...args: unknown[]) => {
    if (enabled('debug')) console.debug('[omniplay]', ...args);
  },
};
