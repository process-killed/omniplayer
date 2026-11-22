/**
 * Ways a file can arrive from outside the app.
 *
 * Three platforms, three mechanisms — and they are genuinely different, so this
 * module keeps them separate and states plainly where each one does not exist:
 *
 *  - **Android (Chrome) / Windows (Chrome, Edge):** the installed PWA declares
 *    `file_handlers`, so the OS offers "Open with OmniPlay" and the files arrive
 *    through `launchQueue`.
 *  - **Android share sheet:** `share_target` posts files to the service worker,
 *    which parks them and redirects here.
 *  - **iOS:** no file association and no share target. The supported routes are
 *    the file picker and drag-and-drop — there is nothing to fake.
 *
 * Desktop drag-and-drop works everywhere and needs no permissions.
 */
import type { Session } from './session';
import type { Router } from './router';
import { toast } from '../ui/dom';

interface LaunchParams {
  files?: FileSystemFileHandle[] | File[];
}

const SHARE_CACHE = 'omniplay-share';
const SHARE_KEY = './__shared-files';

/** True when this browser exposes the File System Access launch queue. */
export function supportsFileHandlers(): boolean {
  return typeof window !== 'undefined' && 'launchQueue' in window;
}

async function filesFromHandles(handles: unknown[]): Promise<File[]> {
  const files: File[] = [];
  for (const handle of handles) {
    if (handle instanceof File) {
      files.push(handle);
      continue;
    }
    const candidate = handle as { getFile?: () => Promise<File> };
    if (typeof candidate.getFile === 'function') {
      try {
        files.push(await candidate.getFile());
      } catch {
        /* permission denied — skip this one */
      }
    }
  }
  return files;
}

/**
 * Handle "Open with OmniPlay" from the OS. Called once at startup; the consumer
 * stays registered so a second file opening reuses the running window.
 */
export function installLaunchQueue(session: Session, router: Router): void {
  const queue = (window as unknown as { launchQueue?: { setConsumer: (fn: (params: LaunchParams) => void) => void } })
    .launchQueue;
  if (!queue) return;

  queue.setConsumer((params) => {
    void (async () => {
      const handles = params.files ?? [];
      if (!handles.length) return;
      const files = await filesFromHandles(handles as unknown[]);
      if (!files.length) {
        toast('That file could not be opened — permission was denied.', 'warn');
        return;
      }
      router.navigate('player');
      await session.openFiles(files);
    })();
  });
}

/**
 * Receive files the OS shared to the app.
 *
 * The service worker stores them under a cache key and redirects to `/?shared=1`,
 * so this only has to read them back, then clean up.
 */
export async function consumeSharedFiles(session: Session, router: Router): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(SHARE_KEY);
    if (!response) return false;
    await cache.delete(SHARE_KEY);

    const files = await filesFromMultipart(response);
    if (!files.length) {
      toast('Nothing playable was shared.', 'warn');
      return false;
    }
    router.navigate('player');
    await session.openFiles(files);
    return true;
  } catch {
    return false;
  }
}

/** Parse the multipart body the share target posted. */
async function filesFromMultipart(response: Response): Promise<File[]> {
  const form = await response.formData().catch(() => null);
  if (form) {
    const files: File[] = [];
    form.forEach((value) => {
      if (value instanceof File && value.size > 0) files.push(value);
    });
    if (files.length) return files;
  }
  // Fall back to a single stored blob, which is how the worker stores one file.
  const blob = await response.blob().catch(() => null);
  if (!blob || !blob.size) return [];
  return [new File([blob], 'shared-media', { type: blob.type })];
}

/** Drag a video onto the window — the desktop equivalent of "open with". */
export function installDropZone(session: Session, router: Router): () => void {
  let depth = 0;
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = '<div class="drop-overlay__card"><b>Drop to play</b><span>Video, audio or subtitle files</span></div>';
  document.body.append(overlay);

  const show = () => overlay.classList.add('is-visible');
  const hide = () => overlay.classList.remove('is-visible');

  const onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    depth += 1;
    show();
  };
  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) hide();
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth = 0;
    hide();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    router.navigate('player');
    void session.openFiles(files);
  };

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);

  return () => {
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('drop', onDrop);
    overlay.remove();
  };
}

/** Platform capabilities, for the settings page to show honestly. */
export function platformReport(): {
  platform: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';
  fileHandlers: boolean;
  shareTarget: boolean;
  standalone: boolean;
} {
  const ua = navigator.userAgent;
  const platform = /Android/i.test(ua)
    ? 'android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'ios'
      : /Windows/i.test(ua)
        ? 'windows'
        : /Mac OS X/i.test(ua)
          ? 'macos'
          : /Linux/i.test(ua)
            ? 'linux'
            : 'other';

  return {
    platform,
    fileHandlers: supportsFileHandlers(),
    // The share target is a manifest + service worker feature; iOS Safari has neither.
    shareTarget: platform === 'android' || platform === 'windows' || platform === 'linux',
    standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true,
  };
}
