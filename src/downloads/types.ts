export type JobState = 'queued' | 'downloading' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface DownloadJob {
  id: string;
  url: string;
  name: string;
  /** Total bytes, or null when the server never said. */
  size: number | null;
  received: number;
  state: JobState;
  /** False when the origin refuses Range requests — pause is then impossible. */
  resumable: boolean;
  /** Content checksums offered by the origin, when present. */
  checksum: { algo: string; value: string } | null;
  speed: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** Set when the job reached "done", used for the history view. */
  finishedAt?: number;
  kind: 'file' | 'audio' | 'subtitle' | 'playlist';
}

export interface DownloadSettings {
  concurrency: number;
  retries: number;
  /** Where finished files go: the file system picker when available. */
  useFileSystem: boolean;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  concurrency: 2,
  retries: 3,
  useFileSystem: true,
};

export const CHUNK_SIZE = 4 * 1024 * 1024;
