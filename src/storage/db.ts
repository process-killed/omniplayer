/**
 * Minimal IndexedDB wrapper with a localStorage fallback.
 *
 * Every call is defensive: private-mode Safari and some embedded webviews
 * refuse IndexedDB, and the player must keep working in that case.
 */

const DB_NAME = 'omniplay';
const DB_VERSION = 1;

export const STORES = ['history', 'bookmarks', 'playlists', 'urls', 'kv', 'thumbs'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };
    const timer = window.setTimeout(fail, 4000);
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        }
      };
      request.onsuccess = () => {
        window.clearTimeout(timer);
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () => {
        window.clearTimeout(timer);
        fail();
      };
      request.onblocked = fail;
    } catch {
      window.clearTimeout(timer);
      fail();
    }
  });
  return dbPromise;
}

/* --------------------------------------------------------- memory fallback */

type Row = Record<string, unknown> & { id: string };
const memory = new Map<string, Map<string, Row>>();

function memStore(name: StoreName): Map<string, Row> {
  let store = memory.get(name);
  if (!store) {
    store = new Map();
    memory.set(name, store);
    // Best-effort persistence so history survives a reload even without IDB.
    try {
      const raw = localStorage.getItem(`omniplay:${name}`);
      if (raw) {
        for (const row of JSON.parse(raw) as Row[]) store.set(row.id, row);
      }
    } catch {
      /* ignore */
    }
  }
  return store;
}

function persistMemory(name: StoreName): void {
  try {
    localStorage.setItem(`omniplay:${name}`, JSON.stringify(Array.from(memStore(name).values()).slice(0, 400)));
  } catch {
    /* quota — ignore */
  }
}

/* --------------------------------------------------------------- public API */

export async function dbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  if (!db) return Array.from(memStore(store).values()) as T[];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function dbGet<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDB();
  if (!db) return memStore(store).get(id) as T | undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function dbPut<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  const db = await openDB();
  if (!db) {
    memStore(store).set(value.id, value as Row);
    persistMemory(store);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function dbDelete(store: StoreName, id: string): Promise<void> {
  const db = await openDB();
  if (!db) {
    memStore(store).delete(id);
    persistMemory(store);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await openDB();
  if (!db) {
    memStore(store).clear();
    persistMemory(store);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function dbClearAll(): Promise<void> {
  for (const store of STORES) await dbClear(store);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

export function isPersistentStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
