import type { MediaSourceSpec, ProbeInfo, TrackInfo } from '../types';
import { codecLabel, languageName } from '../utils/format';
import { detectContainer } from '../media/formats';

/**
 * Deep media inspection.
 *
 * Byte sniffing (fast, always available) identifies the container; mediabunny
 * then demuxes headers to list real tracks, codecs, languages and duration.
 * Nothing is decoded and nothing is uploaded.
 */

const PROBE_TIMEOUT = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function readHead(spec: MediaSourceSpec, playbackUrl: string, bytes = 4096): Promise<Uint8Array | null> {
  try {
    if (spec.file) {
      const slice = spec.file.slice(0, bytes);
      return new Uint8Array(await slice.arrayBuffer());
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(playbackUrl, {
        headers: { ...(spec.headers ?? {}), Range: `bytes=0-${bytes - 1}` },
        signal: controller.signal,
        credentials: 'omit',
      });
      if (!response.ok && response.status !== 206) return null;
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer.slice(0, bytes));
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function trackFromMb(track: {
  id: number;
  number: number;
  name: string | null;
  languageCode: string;
  codec: string | null;
  disposition: Record<string, boolean>;
}, kind: 'video' | 'audio'): TrackInfo {
  const language = track.languageCode && track.languageCode !== 'und' ? track.languageCode : undefined;
  return {
    id: `${kind}-${track.id}`,
    kind,
    index: track.number - 1,
    label: track.name?.trim() || languageName(language) || `${kind === 'video' ? 'Video' : 'Audio'} ${track.number}`,
    language: languageName(language),
    languageCode: language,
    codec: track.codec ?? undefined,
    isDefault: track.disposition?.default ?? track.number === 1,
    isForced: track.disposition?.forced ?? false,
    isCommentary: track.disposition?.commentary ?? false,
    isHearingImpaired: track.disposition?.hearingImpaired ?? false,
  };
}

export async function probeMedia(spec: MediaSourceSpec, playbackUrl: string, notes: string[] = []): Promise<ProbeInfo | null> {
  const head = await readHead(spec, playbackUrl, 8192);
  const guess = head ? detectContainer(head) : null;
  if (guess) notes.push(`Container signature: ${guess.label}${guess.detail ? ` (brand ${guess.detail})` : ''}`);

  let mb: typeof import('mediabunny') | null = null;
  try {
    mb = await import('mediabunny');
  } catch (error) {
    notes.push(`Demuxer unavailable: ${(error as Error).message}`);
  }

  if (mb) {
    let input: InstanceType<typeof mb.Input> | null = null;
    try {
      const source = spec.file
        ? new mb.BlobSource(spec.file)
        : new mb.UrlSource(playbackUrl, {
            requestInit: spec.headers ? { headers: spec.headers } : undefined,
          });
      input = new mb.Input({ formats: mb.ALL_FORMATS, source });

      const [videoTracks, audioTracks] = await withTimeout(
        Promise.all([input.getVideoTracks(), input.getAudioTracks()]),
        PROBE_TIMEOUT,
        'Media inspection',
      );

      const video: TrackInfo[] = [];
      for (const track of videoTracks) {
        const info = trackFromMb(track as never, 'video');
        try {
          info.width = await track.getDisplayWidth();
          info.height = await track.getDisplayHeight();
          info.codec = (await track.getCodec()) ?? info.codec;
        } catch {
          /* keep partial info */
        }
        video.push(info);
      }

      const audio: TrackInfo[] = [];
      for (const track of audioTracks) {
        const info = trackFromMb(track as never, 'audio');
        try {
          info.channels = await track.getNumberOfChannels();
          info.sampleRate = await track.getSampleRate();
          info.codec = (await track.getCodec()) ?? info.codec;
        } catch {
          /* keep partial info */
        }
        audio.push(info);
      }

      let duration: number | undefined;
      try {
        const meta = await withTimeout(input.getDurationFromMetadata(), 6000, 'Duration read');
        duration = meta ?? undefined;
      } catch {
        duration = undefined;
      }

      const primaryVideo = video[0];
      const primaryAudio = audio[0];
      const bitrate =
        spec.size && duration && duration > 1 ? Math.round((spec.size * 8) / duration) : undefined;

      const probe: ProbeInfo = {
        container: guess?.id ?? (await safeMimeContainer(input)),
        containerLabel: guess?.label ?? 'Detected by demuxer',
        videoCodec: primaryVideo?.codec,
        audioCodec: primaryAudio?.codec,
        width: primaryVideo?.width,
        height: primaryVideo?.height,
        duration,
        bitrate,
        videoTracks: video,
        audioTracks: audio,
        subtitleTracks: [],
        chapters: [],
        method: 'mediabunny',
        notes,
      };
      if (video.length === 0 && audio.length === 0) {
        notes.push('Demuxer found no playable tracks.');
        return null;
      }
      notes.push(
        `Tracks: ${video.length} video, ${audio.length} audio` +
          (video[0]?.codec ? ` · video codec ${codecLabel(video[0].codec)}` : '') +
          (audio[0]?.codec ? ` · audio codec ${codecLabel(audio[0].codec)}` : ''),
      );
      return probe;
    } catch (error) {
      notes.push(`Demuxer could not read this file: ${(error as Error).message}`);
    } finally {
      try {
        input?.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  if (!guess) return null;
  return {
    container: guess.id,
    containerLabel: guess.label,
    videoTracks: [],
    audioTracks: [],
    subtitleTracks: [],
    chapters: [],
    method: 'bytes',
    notes,
  };
}

async function safeMimeContainer(input: InstanceType<typeof import('mediabunny').Input>): Promise<string | undefined> {
  try {
    const mime = await input.getMimeType();
    return mime.split('/')[1]?.split(';')[0];
  } catch {
    return undefined;
  }
}
