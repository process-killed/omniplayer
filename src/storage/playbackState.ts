/**
 * Smart resume: the exact position *plus* the audio track, subtitle track and
 * playback speed, so coming back feels like never having left.
 */
export interface PlaybackState {
  position: number;
  duration: number;
  audioTrackId?: string;
  subtitleTrackId?: string | null;
  rate?: number;
  updatedAt: number;
}

const KEY = 'omniplay:playback-state:v1';

function all(): Record<string, PlaybackState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, PlaybackState>;
  } catch {
    return {};
  }
}

export function savePlaybackState(mediaId: string, state: PlaybackState): void {
  const map = all();
  map[mediaId] = state;
  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 60);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* private mode */
  }
}

export function loadPlaybackState(mediaId: string): PlaybackState | null {
  return all()[mediaId] ?? null;
}

export function clearPlaybackState(mediaId?: string): void {
  if (!mediaId) {
    localStorage.removeItem(KEY);
    return;
  }
  const map = all();
  delete map[mediaId];
  localStorage.setItem(KEY, JSON.stringify(map));
}
