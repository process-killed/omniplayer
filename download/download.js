/**
 * =============================================================================
 * AnimeEdge Next-Gen Modular Download Engine (/download/download.js - v4.0 Robust)
 * =============================================================================
 * Key Features:
 *  - 100% Guaranteed Encrypted Token Delivery (?data= string, never plain links)
 *  - Native Web Crypto AES-GCM (128-bit) with dynamic PBKDF2 salt derivation
 *  - Self-Healing Base64 chunking to prevent browser call stack overflow
 *  - Automatic Format Detection: .m3u8, .mp4, .mkv, .webm, magnet/torrent
 *  - Tamper & Expiry Shield (15-minute validity window)
 *  - Adaptive UI Binding for Desktop Buttons and Mobile Bottom Action Dock
 *  - Anti-Popup Blocker Fallback (window.open -> direct location redirection)
 * =============================================================================
 */

import { showPlayerToast } from '/script.js';

export class DownloadEngine {
  constructor() {
    this.targetBloggerUrl = 'https://nexalogz.blogspot.com/2026/10/Aniframe-links.html';

    // Must match the secret defined in the Blogger resolver script
    this._passphrase = 'AnimeEdgeSecureVibe2026Key';

    // Only block sandboxed embed origins that cannot output extractable media
    this.unsupportedEmbedSignatures = [
      'flixcloud',
      'vidmoly',
      'megaplay',
      'upns.pro',
      '4anime',
      'rubystm',
      'abyssplayer'
    ];
  }

  /* -------------------------------------------------------------------------
   * 1. Smart Stream Extraction & Downloadability Analyzer
   * ------------------------------------------------------------------------- */

  /**
   * Resolves the underlying raw stream URL, magnet URI, or torrent hash.
   * @param {Object} stream
   * @returns {string}
   */
  extractStreamLink(stream) {
    if (!stream) return '';

    if (typeof stream.url === 'string' && stream.url.trim()) {
      return stream.url.trim();
    }
    if (typeof stream.originalUrl === 'string' && stream.originalUrl.trim()) {
      return stream.originalUrl.trim();
    }
    if (typeof stream.magnetUri === 'string' && stream.magnetUri.trim()) {
      return stream.magnetUri.trim();
    }
    if (typeof stream.infoHash === 'string' && stream.infoHash.trim()) {
      return `magnet:?xt=urn:btih:${stream.infoHash.trim()}`;
    }

    return '';
  }

  /**
   * Evaluates if a given stream payload can be parsed and dispatched.
   * @param {Object} stream
   * @returns {boolean}
   */
  isStreamDownloadable(stream) {
    if (!stream) return false;

    const link = this.extractStreamLink(stream);
    if (!link) return false;

    const lower = link.toLowerCase();

    // 1. Torrents and Magnets
    if (link.startsWith('magnet:') || stream.isTorrent || Boolean(stream.infoHash)) {
      return true;
    }

    // 2. Direct Video Containers & HLS Playlists
    if (
      lower.includes('.m3u8') ||
      lower.includes('.mp4') ||
      lower.includes('.mkv') ||
      lower.includes('.webm') ||
      lower.includes('hls-proxy') ||
      lower.includes('proxy_m3u8') ||
      lower.includes('drive.google.com') ||
      lower.includes('googleusercontent.com') ||
      lower.includes('pixeldrain')
    ) {
      return true;
    }

    // 3. Sandboxed Embeds
    if (stream.isEmbed || stream.type === 'embed') {
      return false;
    }

    if (this.unsupportedEmbedSignatures.some((sig) => lower.includes(sig))) {
      return false;
    }

    return link.startsWith('http://') || link.startsWith('https://');
  }

  /**
   * Synchronizes UI button states across both Desktop Header and Mobile Dock.
   * @param {Object} stream
   */
  updateButtonState(stream) {
    const downloadBtns = document.querySelectorAll(
      '#btnDownloadStream, #btnMobileDownload, .btn-download-trigger, .btn-download-mobile'
    );
    const isAvailable = this.isStreamDownloadable(stream);

    downloadBtns.forEach((btn) => {
      if (!isAvailable) {
        btn.classList.add('disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('title', 'Direct download unavailable for this stream source.');
        btn.style.opacity = '0.4';
        btn.style.pointerEvents = 'none';
      } else {
        btn.classList.remove('disabled');
        btn.removeAttribute('aria-disabled');
        btn.setAttribute('title', 'Download Current Episode');
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }
    });
  }

  /* -------------------------------------------------------------------------
   * 2. Hardened Web Crypto (AES-GCM + PBKDF2)
   * ------------------------------------------------------------------------- */

  /**
   * Derives an AES-GCM 128-bit key using PBKDF2 with dynamic salt.
   * @param {Uint8Array} saltUint8
   */
  async _deriveKey(saltUint8) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(this._passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltUint8,
        iterations: 10000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt']
    );
  }

  /**
   * Encrypts plain text into a URL-safe Base64 token.
   * Token Schema: Salt (8B) + IV (12B) + Ciphertext + Auth Tag (16B)
   * @param {string} plainText
   * @returns {Promise<string|null>}
   */
  async encryptPayload(plainText) {
    try {
      const enc = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(8));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await this._deriveKey(salt);

      const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(plainText)
      );

      // Concatenate Salt (8) + IV (12) + Ciphertext/Tag
      const combined = new Uint8Array(salt.length + iv.length + cipherBuffer.byteLength);
      combined.set(salt, 0);
      combined.set(iv, salt.length);
      combined.set(new Uint8Array(cipherBuffer), salt.length + iv.length);

      // Chunked conversion to prevent maximum call stack size exceeded on large payloads
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < combined.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, combined.subarray(i, i + chunkSize));
      }

      // Output URL-Safe Base64 (RFC 4648 §5)
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    } catch (err) {
      console.error('[DownloadEngine/EncryptionError]', err);
      return null;
    }
  }

  /* -------------------------------------------------------------------------
   * 3. Download Trigger & Dispatch Workflow
   * ------------------------------------------------------------------------- */

  /**
   * Encrypts the stream data and triggers safe navigation to Blogger.
   */
  async startDownload({ stream, anilistId, episode, animeTitle, serverName = '' }) {
    const downloadTarget = this.extractStreamLink(stream);

    if (!downloadTarget || !this.isStreamDownloadable(stream)) {
      showPlayerToast(
        'Selected server cannot be downloaded directly. Switch to Server 1 or Server 2.',
        'error',
        3000
      );
      return;
    }

    const downloadBtns = document.querySelectorAll(
      '#btnDownloadStream, #btnMobileDownload, .btn-download-trigger, .btn-download-mobile'
    );
    downloadBtns.forEach((btn) => btn.classList.add('is-encrypting'));

    showPlayerToast('🔒 Encrypting download token...', 'info', 1200);

    // Format detection
    let detectedFormat = 'mp4';
    if (downloadTarget.startsWith('magnet:') || stream.isTorrent) {
      detectedFormat = 'torrent';
    } else if (downloadTarget.includes('.m3u8') || downloadTarget.includes('hls')) {
      detectedFormat = 'hls';
    }

    const payload = JSON.stringify({
      id: anilistId || 0,
      title: animeTitle || 'Anime Episode',
      ep: episode || 1,
      quality: (stream.quality || 'HD').toUpperCase(),
      format: detectedFormat,
      size: stream.size?.humanReadable || 'Direct Media',
      seeders: stream.seeders || null,
      server: serverName || stream.addon || 'AnimeEdge High-Speed Mirror',
      link: downloadTarget,
      exp: Date.now() + 15 * 60 * 1000, // Valid for 15 minutes
      created: Date.now()
    });

    // Await encryption before building the redirect URL
    const encryptedToken = await this.encryptPayload(payload);
    downloadBtns.forEach((btn) => btn.classList.remove('is-encrypting'));

    // Guard: Prevent exposing the raw stream link
    if (!encryptedToken || typeof encryptedToken !== 'string') {
      showPlayerToast('Encryption protocol failed. Download aborted.', 'error', 2500);
      return;
    }

    // Build the query parameter with the encrypted token
    const destinationUrl = `${this.targetBloggerUrl}?data=${encodeURIComponent(encryptedToken)}`;

    // Anti-Popup Blocker Strategy: Try window.open first, fallback to direct window.location
    try {
      const openedWindow = window.open(destinationUrl, '_blank', 'noopener,noreferrer');
      if (!openedWindow || openedWindow.closed || typeof openedWindow.closed === 'undefined') {
        window.location.href = destinationUrl;
      }
    } catch {
      window.location.href = destinationUrl;
    }
  }
}

export const Downloader = new DownloadEngine();
