/**
 * Extension persistence in IndexedDB.
 *
 * Two stores: `extensions` (metadata) and `extension-files` (the downloaded
 * code, keyed by "<id>:<commit>:<path>"). Files live in Blob form and are only
 * turned into object URLs while an extension is running.
 */

const DB_NAME = 'omniplay-extensions';
const DB_VERSION = 1;
const META = 'extensions';
const FILES = 'extension-files';
const KV = 'extension-kv';

export interface StoredFile {
  key: string;
  id: string;
  commit: string;
  path: string;
  mime: string;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = fn(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const extensionStore = {
  async all<T>(): Promise<T[]> {
    return run<T[]>(META, 'readonly', (store) => store.getAll());
  },
  async get<T>(id: string): Promise<T | undefined> {
    return run<T | undefined>(META, 'readonly', (store) => store.get(id));
  },
  async put(record: { id: string }): Promise<void> {
    await run(META, 'readwrite', (store) => store.put(record));
  },
  async remove(id: string): Promise<void> {
    await run(META, 'readwrite', (store) => store.delete(id));
    const keys = await run<IDBValidKey[]>(FILES, 'readonly', (store) => store.getAllKeys());
    for (const key of keys) {
      if (String(key).startsWith(`${id}:`)) {
        await run(FILES, 'readwrite', (store) => store.delete(key));
      }
    }
  },

  async putFile(file: StoredFile): Promise<void> {
    await run(FILES, 'readwrite', (store) => store.put(file));
  },
  async filesFor(id: string, commit: string): Promise<StoredFile[]> {
    const all = await run<StoredFile[]>(FILES, 'readonly', (store) => store.getAll());
    return all.filter((file) => file.id === id && file.commit === commit);
  },

  /** Per-extension key/value storage, namespaced by id. */
  async kvGet(id: string, key: string): Promise<unknown> {
    return run(KV, 'readonly', (store) => store.get(`${id}:${key}`));
  },
  async kvSet(id: string, key: string, value: unknown): Promise<void> {
    await run(KV, 'readwrite', (store) => store.put(value, `${id}:${key}`));
  },
  async kvDelete(id: string, key: string): Promise<void> {
    await run(KV, 'readwrite', (store) => store.delete(`${id}:${key}`));
  },
  async kvClear(id: string): Promise<void> {
    const keys = await run<IDBValidKey[]>(KV, 'readonly', (store) => store.getAllKeys());
    for (const key of keys) {
      if (String(key).startsWith(`${id}:`)) await run(KV, 'readwrite', (store) => store.delete(key));
    }
  },
};
