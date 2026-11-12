/**
 * Which engine errors are worth abandoning an engine for.
 *
 * Engines report everything through one channel. Treating a transient network
 * blip as fatal makes the player thrash between engines; treating a real
 * decoder/manifest failure as recoverable leaves the user on a dead stream.
 */

export interface DashErrorLike {
  error?: unknown;
  message?: unknown;
  [key: string]: unknown;
}

const RECOVERABLE = /(network|timeout|xhr|abort|429|5\d\d|retry|buffer.*(empty|stalled))/i;
const FATAL = /(manifest|mpd|parse|decod|codec|not supported|unsupported|drm|key|segment.*(missing|404)|403|401)/i;

/** Fatal unless it clearly looks like a recoverable network hiccup. */
export function isFatalDashError(event: DashErrorLike, detail = ''): boolean {
  const code = String((event as { error?: { code?: unknown } }).error?.code ?? (event as { code?: unknown }).code ?? '');
  const text = `${code} ${detail} ${String(event.message ?? '')} ${String((event as { error?: unknown }).error ?? '')}`;
  if (/^\s*(1\d\d|2\d\d)\s*$/.test(code)) return false; // dash.js informational codes
  if (RECOVERABLE.test(text)) return false;
  if (FATAL.test(text)) return true;
  // Unknown errors escalate: a dead stream is worse than a fallback attempt.
  return true;
}
