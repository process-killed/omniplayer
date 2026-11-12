import type { MediaSourceSpec } from '../types';
import type { Router } from './router';
import type { Store } from './store';
import { library } from '../storage/library';
import { extOf, isMediaFile, isSubtitleFile, mimeForExt } from '../media/formats';
import { toast } from '../ui/dom';
import { resolveLink } from '../sources/registry';

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

/**
 * Bridges UI actions (open file, paste URL) to the player route.
 * Also the place where local files become a play queue.
 */
export class Session {
  /** Subtitle files dropped alongside a video, picked up by the player page. */
  pendingSubtitles: File[] = [];

  constructor(
    private readonly store: Store,
    private readonly router: Router,
  ) {}

  specFromFile(file: File): MediaSourceSpec {
    const id = `file_${hashString(`${file.name}:${file.size}:${file.lastModified}`)}`;
    return {
      id,
      kind: 'file',
      name: file.name,
      file,
      size: file.size,
      mime: file.type || mimeForExt(extOf(file.name)),
      addedAt: Date.now(),
    };
  }

  /**
   * Turn any pasted link into a spec: a file, a manifest, a provider embed, or a
   * torrent. Provider links keep their own player; media links carry fallbacks.
   */
  specFromLink(input: string, name?: string): MediaSourceSpec {
    const resolved = resolveLink(input);
    const base = this.specFromUrl(resolved.sources[0] ?? input, name ?? resolved.title);
    if (resolved.provider) {
      base.provider = resolved.provider;
      base.name = resolved.title ?? `${resolved.provider.name} video`;
      base.id = `provider_${resolved.provider.name}_${hashString(resolved.provider.embedUrl)}`;
    }
    if (resolved.sources.length > 1) {
      base.sources = resolved.sources.slice(1);
    }
    return base;
  }

  specFromUrl(url: string, name?: string, headers?: Record<string, string>): MediaSourceSpec {
    const id = `url_${hashString(url)}`;
    let label = name;
    if (!label) {
      try {
        const parsed = new URL(url);
        // Signed URLs (S3/R2) often hide the real name in content-disposition.
        const disposition = parsed.searchParams.get('response-content-disposition') ?? '';
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
        const fromPath = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
        label = match ? decodeURIComponent(match[1]) : fromPath || parsed.hostname;
        if (!/\.\w{2,5}$/.test(label)) label = label || 'Network stream';
      } catch {
        label = 'Network stream';
      }
    }
    return {
      id,
      kind: 'url',
      name: label || 'Network stream',
      url,
      headers,
      addedAt: Date.now(),
    };
  }

  async openFiles(files: File[]): Promise<void> {
    const mediaFiles = files.filter((file) => isMediaFile(file.name, file.type));
    const subtitleFiles = files.filter((file) => isSubtitleFile(file.name));

    if (subtitleFiles.length) this.pendingSubtitles = [...this.pendingSubtitles, ...subtitleFiles];

    if (mediaFiles.length === 0) {
      if (subtitleFiles.length === 0) {
        toast('No playable media found in that selection.', 'warn');
      } else {
        toast('Subtitle files added — open a video to use them.', 'ok');
      }
      return;
    }

    const specs = mediaFiles.map((file) => this.specFromFile(file));
    const first = specs[0];
    const resume = library.getResume(first.id);
    if (resume && this.store.settings.rememberPosition && resume.position > this.store.settings.resumeThreshold) {
      first.startAt = resume.position;
    }
    this.store.setQueue(specs, 0);
    this.play(first);
    if (specs.length > 1) toast(`${specs.length} videos queued`, 'ok');
  }

  play(spec: MediaSourceSpec): void {
    const alreadyPlaying = this.router.current.name === 'player';
    this.store.setCurrent(spec);
    if (!alreadyPlaying) this.router.navigate('player');
  }

  async openUrl(rawUrl: string, options: { headers?: Record<string, string>; name?: string } = {}): Promise<void> {
    const spec = this.specFromLink(rawUrl.trim(), options.name);
    if (this.store.settings.saveUrlHistory) {
      void library.rememberUrl(rawUrl.trim(), spec.name);
    }
    const queue = [spec];
    this.store.setQueue(queue, 0);
    this.play(spec);
  }

  takePendingSubtitles(): File[] {
    const files = this.pendingSubtitles;
    this.pendingSubtitles = [];
    return files;
  }
}
