/**
 * webtor.io as a third-party torrent player.
 *
 * webtor.io downloads the torrent on their servers and streams the file over
 * HTTPS with range support, so any magnet plays — including on devices where
 * in-page WebTorrent would have to hold the whole file in RAM.
 *
 * Trade-off worth stating plainly: the torrent is fetched by their service, not
 * yours, so their servers see the swarm traffic. That is why this is an opt-in
 * provider rather than the default when a gateway of your own is configured.
 */

const WEBTOR_ORIGIN = 'https://webtor.io';

/** Embed URL used inside the player frame. */
export function webtorEmbedUrl(magnet: string): string {
  const params = new URLSearchParams();
  params.set('magnet', magnet);
  params.set('autoPlay', 'true');
  params.set('showVideo', 'true');
  return `${WEBTOR_ORIGIN}/#/show?${params.toString()}`;
}

/** Plain link, for the "open in a new tab" escape hatch. */
export function webtorWebUrl(magnet: string): string {
  return `${WEBTOR_ORIGIN}/#/show?magnet=${encodeURIComponent(magnet)}`;
}

export function isWebtorUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('webtor.io');
  } catch {
    return false;
  }
}
