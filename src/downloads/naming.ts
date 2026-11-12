/**
 * Filenames for downloads.
 *
 * The origin's own name wins when it is usable; otherwise we build one from the
 * media name plus the language, which is what makes a folder of subtitles
 * readable months later.
 */

const SUBTITLE_EXT = ['srt', 'vtt', 'ass', 'ssa', 'ttml', 'dfxp', 'sbv', 'sub', 'idx', 'txt'];

/** Strip characters that break file systems, collapse whitespace, cap length. */
export function sanitizeName(input: string, fallback = 'download'): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

export function extensionOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const match = /\.([a-z0-9]{1,5})$/i.exec(path);
    return match ? match[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * Is this a subtitle file we can save as text? Bitmap formats (.sup, .idx/.sub
 * pairs) are not text and are rejected — saving them as .srt would be a lie.
 */
export function isDownloadableSubtitle(url: string): boolean {
  const ext = extensionOf(url);
  if (ext === 'sup') return false;
  return SUBTITLE_EXT.includes(ext) || /subtitle|\.srt|\.vtt|\.ass/i.test(url);
}

/** `Show S01E01 · Hindi.srt` from the media name, language and URL. */
export function subtitleFileName(mediaName: string | undefined, language: string | undefined, url: string): string {
  const ext = SUBTITLE_EXT.includes(extensionOf(url)) ? extensionOf(url) : 'srt';
  const base = sanitizeName((mediaName ?? 'subtitle').replace(/\.[a-z0-9]{1,5}$/i, ''), 'subtitle');
  const lang = language ? sanitizeName(language, '') : '';
  return `${base}${lang ? ` · ${lang}` : ''}.${ext}`;
}

/** Keep the origin's filename when it has a sane extension, else build one. */
export function preferOriginalName(original: string | undefined, fallback: string): string {
  if (original) {
    const clean = sanitizeName(original);
    if (/\.[a-z0-9]{1,5}$/i.test(clean)) return clean;
  }
  return fallback;
}
