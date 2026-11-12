/**
 * Persistence for downloads: job metadata in IndexedDB, chunks as separate
 * records so memory stays flat, and a small history table.
 */
import type { DownloadJob } from './types';

const DB = 'omniplay-downloads';
const JOBS = 'jobs';
const CHUNKS = 'chunks';
const HISTORY = 'history';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
      if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  const result = await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export const downloadStore = {
  async saveJob(job: DownloadJob): Promise<void> {
    await tx(JOBS, 'readwrite', (store) => store.put(job));
  },
  async jobs(): Promise<DownloadJob[]> {
    const all = await tx<DownloadJob[]>(JOBS, 'readonly', (store) => store.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async removeJob(id: string): Promise<void> {
    await tx(JOBS, 'readwrite', (store) => store.delete(id));
    await this.clearChunks(id);
  },
  async clearChunks(id: string): Promise<void> {
    const keys = await tx<IDBValidKey[]>(CHUNKS, 'readonly', (store) => store.getAllKeys());
    await Promise.all(
      keys
        .filter((key) => String(key).startsWith(`${id}:`))
        .map((key) => tx(CHUNKS, 'readwrite', (store) => store.delete(key))),
    );
  },
  async putChunk(id: string, index: number, bytes: Uint8Array): Promise<void> {
    await tx(CHUNKS, 'readwrite', (store) => store.put(bytes, `${id}:${String(index).padStart(6, '0')}`));
  },
  async chunks(id: string): Promise<Blob[]> {
    const keys = await tx<IDBValidKey[]>(CHUNKS, 'readonly', (store) => store.getAllKeys());
    const mine = keys.filter((key) => String(key).startsWith(`${id}:`)).sort();
    const out: Blob[] = [];
    for (const key of mine) {
      const value = await tx<Uint8Array>(CHUNKS, 'readonly', (store) => store.get(key));
      if (value) out.push(new Blob([value.slice().buffer as ArrayBuffer]));
    }
    return out;
  },
  async history(): Promise<DownloadJob[]> {
    return tx<DownloadJob[]>(HISTORY, 'readonly', (store) => store.getAll());
  },
  async addHistory(job: DownloadJob): Promise<void> {
    await tx(HISTORY, 'readwrite', (store) => store.put(job));
  },
  async clearHistory(): Promise<void> {
    await tx(HISTORY, 'readwrite', (store) => store.clear());
  },
};

const DIR_KEY = 'download-directory';

/** Remember the chosen download directory (File System Access). */
export async function rememberDirectory(handle: FileSystemDirectoryHandle | null): Promise<void> {
  await tx(JOBS, 'readwrite', (store) => (handle ? store.put(handle, DIR_KEY) : store.delete(DIR_KEY)) as IDBRequest<unknown>);
}

export async function rememberedDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const value = await tx<FileSystemDirectoryHandle | undefined>(JOBS, 'readonly', (store) => store.get(DIR_KEY));
    return value ?? null;
  } catch {
    return null;
  }
}

/** History as a JSON string, for the export button. */
export function historyJson(jobs: DownloadJob[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: jobs.length,
      downloads: jobs.map((job) => ({
        name: job.name,
        url: job.url,
        state: job.state,
        size: job.size,
        received: job.received,
        resumable: job.resumable,
        error: job.error ?? null,
        createdAt: job.createdAt,
      })),
    },
    null,
    2,
  );
}

/** Storage quota, when the browser reports it. */
export async function storageInfo(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
