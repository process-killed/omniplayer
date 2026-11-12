import { describe, expect, it } from 'vitest';
import { isWebtorUrl, webtorWebUrl } from '../src/torrent/webtor';

const MAGNET = 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=Test';

describe('webtor.io provider', () => {
  it('builds a shareable url', () => {
    expect(webtorWebUrl(MAGNET)).toContain(encodeURIComponent(MAGNET));
  });

  it('recognises webtor hosts', () => {
    expect(isWebtorUrl('https://webtor.io/#/show')).toBe(true);
    expect(isWebtorUrl('https://cdn.example/x.mp4')).toBe(false);
    expect(isWebtorUrl('not a url')).toBe(false);
  });
});
