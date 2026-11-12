/**
 * Folder library via the File System Access API (Chromium only).
 *
 * A picked folder is remembered by its handle in IndexedDB; the browser may
 * require a re-grant on the next visit, which we ask for explicitly rather than
 * failing silently. Files are streamed from the handle — nothing is uploaded and
 * nothing is copied into memory.
 */

const DB_NAME = 'omniplay-folders';
const STORE = 'handles';

export interface FolderEntry {
  name: string;
  file: File;
}

export interface SavedFolder {
  id: string;
  name: string;
}

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbAll(): Promise<Array<[string, FileSystemDirectoryHandle]>> {
  const db = await openDb();
  const rows = await new Promise<Array<[string, FileSystemDirectoryHandle]>>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keys = store.getAllKeys();
    const values = store.getAll();
    tx.oncomplete = () => {
      const out: Array<[string, FileSystemDirectoryHandle]> = [];
      (keys.result as IDBValidKey[]).forEach((key, index) => {
        out.push([String(key), values.result[index] as FileSystemDirectoryHandle]);
      });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return rows;
}

export function foldersSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

const MEDIA_RE = /\.(mp4|m4v|mkv|webm|mov|avi|flv|ts|m2ts|mpg|mpeg|wmv|ogv|3gp|mp3|m4a|aac|flac|opus|ogg|wav)$/i;

/** Recursively collect media files (depth-limited so a huge tree cannot hang). */
export async function scanFolder(handle: FileSystemDirectoryHandle, depth = 2): Promise<FolderEntry[]> {
  const out: FolderEntry[] = [];
  const walk = async (dir: DirHandle, level: number): Promise<void> => {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        if (!MEDIA_RE.test(entry.name)) continue;
        try {
          out.push({ name: entry.name, file: await (entry as FileSystemFileHandle).getFile() });
        } catch {
          /* file disappeared or permission revoked */
        }
      } else if (level < depth) {
        await walk(entry as DirHandle, level + 1);
      }
    }
  };
  await walk(handle as DirHandle, 0);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Ask the user for a folder and remember it. */
export async function pickFolder(): Promise<{ id: string; handle: FileSystemDirectoryHandle } | null> {
  if (!foldersSupported()) return null;
  const picker = (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const handle = await picker();
  const id = `folder_${handle.name}_${Date.now()}`;
  try {
    await idbPut(id, handle);
  } catch {
    /* private mode: the folder still works for this session */
  }
  return { id, handle };
}

export async function savedFolders(): Promise<Array<SavedFolder & { handle: FileSystemDirectoryHandle }>> {
  try {
    const rows = await idbAll();
    return rows.map(([id, handle]) => ({ id, name: handle.name, handle }));
  } catch {
    return [];
  }
}

/** Re-request permission for a remembered folder (needed after a reload). */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const target = handle as unknown as {
    queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
    requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
  };
  try {
    if ((await target.queryPermission({ mode: 'read' })) === 'granted') return true;
    return (await target.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}
