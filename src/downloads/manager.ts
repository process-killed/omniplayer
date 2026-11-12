/**
 * Download queue: concurrency, pause/resume, retries, duplicate detection and
 * the choice between streaming to disk (File System Access) and assembling in
 * IndexedDB.
 */
import { CHUNK_SIZE, DEFAULT_DOWNLOAD_SETTINGS, type DownloadJob, type DownloadSettings } from './types';
import { probe, runDownload, type Sink } from './engine';
import { downloadStore, rememberedDirectory } from './store';

type Listener = (jobs: DownloadJob[]) => void;

export class DownloadManager {
  private jobs = new Map<string, DownloadJob>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();
  private settings: DownloadSettings = { ...DEFAULT_DOWNLOAD_SETTINGS };
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      for (const job of await downloadStore.jobs()) {
        // Anything interrupted by a reload becomes paused, never "downloading".
        if (job.state === 'downloading') job.state = 'paused';
        this.jobs.set(job.id, job);
      }
    } catch {
      /* private mode */
    }
    this.emit();
  }

  setSettings(next: Partial<DownloadSettings>): void {
    this.settings = { ...this.settings, ...next };
    this.pump();
  }

  getSettings(): DownloadSettings {
    return { ...this.settings };
  }

  list(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => this.listeners.delete(listener);
  }

  find(url: string): DownloadJob | undefined {
    return this.list().find((job) => job.url === url);
  }

  /** Add a URL to the queue. Returns null when it is already there. */
  async enqueue(url: string, options: { name?: string; kind?: DownloadJob['kind'] } = {}): Promise<DownloadJob | null> {
    const existing = this.find(url);
    if (existing && existing.state !== 'cancelled' && existing.state !== 'failed') return null;

    const info = await probe(url).catch(() => null);
    const job: DownloadJob = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url,
      name: options.name ?? info?.name ?? 'download',
      size: info?.size ?? null,
      received: 0,
      state: 'queued',
      resumable: info?.resumable ?? false,
      checksum: info?.checksum ?? null,
      speed: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      kind: options.kind ?? 'file',
    };
    this.jobs.set(job.id, job);
    await this.persist(job);
    this.emit();
    this.pump();
    return job;
  }

  pause(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.state !== 'downloading') return;
    this.controllers.get(id)?.abort();
    job.state = 'paused';
    job.speed = 0;
    void this.persist(job);
    this.emit();
  }

  resume(id: string): void {
    const job = this.jobs.get(id);
    if (!job || (job.state !== 'paused' && job.state !== 'failed')) return;
    job.state = 'queued';
    job.error = undefined;
    void this.persist(job);
    this.emit();
    this.pump();
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.controllers.get(id)?.abort();
    job.state = 'cancelled';
    job.speed = 0;
    await downloadStore.clearChunks(id);
    job.received = 0;
    await this.persist(job);
    await downloadStore.addHistory(job);
    this.emit();
  }

  pauseAll(): void {
    for (const job of this.list()) if (job.state === 'downloading') this.pause(job.id);
  }

  resumeAll(): void {
    for (const job of this.list()) if (job.state === 'paused') this.resume(job.id);
  }

  async cancelAll(): Promise<void> {
    for (const job of this.list()) {
      if (['queued', 'downloading', 'paused', 'failed'].includes(job.state)) await this.cancel(job.id);
    }
  }

  async remove(id: string): Promise<void> {
    this.jobs.delete(id);
    await downloadStore.removeJob(id);
    this.emit();
  }

  private pump(): void {
    const active = this.list().filter((job) => job.state === 'downloading').length;
    if (active >= this.settings.concurrency) return;
    const next = this.list().find((job) => job.state === 'queued');
    if (next) void this.start(next);
  }

  private async start(job: DownloadJob): Promise<void> {
    if (job.state === 'downloading') return;
    job.state = 'downloading';
    this.emit();
    await this.persist(job);

    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    try {
      // Sink creation can be cancelled (save dialog) or fail — inside the try,
      // so the job never stays stuck in "downloading" and the queue keeps going.
      const sink = await this.createSink(job);

      const received = await runDownload({
        job,
        sink,
        signal: controller.signal,
        retries: this.settings.retries,
        onProgress: (bytes, speed) => {
          job.received = bytes;
          job.speed = speed;
          job.updatedAt = Date.now();
          this.emit();
        },
      });
      job.received = received;
      job.state = 'done';
      job.speed = 0;
      job.size = job.size ?? received;
      await this.persist(job);
      await downloadStore.addHistory(job);
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      // A cancelled save dialog is not a failure: put the job back in the queue
      // so the user can retry without it looking broken.
      job.state = aborted ? 'paused' : 'failed';
      job.speed = 0;
      job.error = aborted ? 'Cancelled — the file was not saved' : (error as Error).message;
      if (!aborted) await downloadStore.addHistory(job);
    } finally {
      this.controllers.delete(job.id);
      this.emit();
      this.pump();
    }
  }

  /**
   * Stream to disk when the browser allows it, otherwise keep chunks in
   * IndexedDB and assemble a Blob at the end.
   */
  private async createSink(job: DownloadJob): Promise<Sink> {
    const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> })
      .showSaveFilePicker;

    if (this.settings.useFileSystem) {
      // A remembered directory skips the picker entirely.
      const directory = await rememberedDirectory().catch(() => null);
      if (directory) {
        try {
          const granted = await (directory as unknown as {
            queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
            requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
          }).queryPermission({ mode: 'readwrite' });
          const allowed =
            granted === 'granted' ||
            (await (directory as unknown as { requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState> })
              .requestPermission({ mode: 'readwrite' })) === 'granted';
          if (allowed) {
            const fileHandle = await directory.getFileHandle(job.name, { create: true });
            const writable = await (fileHandle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
            return {
              async write(chunk) {
                await writable.write(chunk as unknown as BufferSource);
              },
              async close() {
                await writable.close();
              },
              async abort() {
                await writable.abort().catch(() => undefined);
              },
            };
          }
        } catch {
          /* fall through to the picker */
        }
      }
    }

    if (this.settings.useFileSystem && picker) {
      try {
        const handle = await picker({
          suggestedName: job.name,
          types: [{ description: 'Media', accept: { 'application/octet-stream': [`.${job.name.split('.').pop() ?? 'bin'}`] } }],
        });
        const writable = await (handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
        return {
          async write(chunk) {
            await writable.write(chunk as unknown as BufferSource);
          },
          async close() {
            await writable.close();
          },
          async abort() {
            await writable.abort().catch(() => undefined);
          },
        };
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error; // user cancelled the picker
        /* fall through to the IndexedDB sink */
      }
    }

    // On a low-memory device the final Blob needs RAM equal to the file, so
    // refuse very large jobs instead of crashing the tab.
    const lowMemory = this.settings.useFileSystem === false || !('showSaveFilePicker' in window);
    if (lowMemory && job.size !== null && job.size > 512 * 1024 * 1024) {
      throw new Error(
        'This file is too large to assemble in memory on this device. Use a Chromium browser with the file-system writer, or download it directly.',
      );
    }

    let index = 0;
    const pending: Uint8Array[] = [];
    return {
      async write(chunk) {
        pending.push(chunk);
        if (pending.length >= 4) {
          const joined = new Uint8Array(pending.reduce((total, part) => total + part.byteLength, 0));
          let offset = 0;
          for (const part of pending) {
            joined.set(part, offset);
            offset += part.byteLength;
          }
          pending.length = 0;
          await downloadStore.putChunk(job.id, index++, joined);
        }
      },
      async close() {
        if (pending.length > 0) {
          const joined = new Uint8Array(pending.reduce((total, part) => total + part.byteLength, 0));
          let offset = 0;
          for (const part of pending) {
            joined.set(part, offset);
            offset += part.byteLength;
          }
          pending.length = 0;
          await downloadStore.putChunk(job.id, index++, joined);
        }
        const parts = await downloadStore.chunks(job.id);
        const blob = new Blob(parts, { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = job.name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        await downloadStore.clearChunks(job.id);
      },
      async abort() {
        pending.length = 0;
      },
    };
  }

  private async persist(job: DownloadJob): Promise<void> {
    try {
      await downloadStore.saveJob(job);
    } catch {
      /* storage full or private mode */
    }
  }

  private emit(): void {
    const list = this.list();
    this.listeners.forEach((listener) => listener(list));
  }
}

export const downloads = new DownloadManager();
export { CHUNK_SIZE };
