import type { PageContext, PageInstance } from './types';
import { el, esc, toast } from '../dom';
import { icon } from '../icons';
import { pageHead } from '../components';
import { isSubtitleFile } from '../../media/formats';
import { foldersSupported, pickFolder, savedFolders, scanFolder, ensurePermission } from '../../storage/folder';

const SUPPORTED = [
  ['MP4', 'H.264 · HEVC · AV1'],
  ['MKV', 'H.264 · HEVC · AV1 · VP9'],
  ['WebM', 'VP8 · VP9 · AV1'],
  ['MOV', 'H.264 · ProRes*'],
  ['AVI', 'MPEG-4 · MJPEG*'],
  ['TS / M2TS', 'H.264 · HEVC'],
  ['FLV', 'H.264 · AAC*'],
  ['OGV', 'Theora · Vorbis'],
  ['MP3 / FLAC / WAV', 'Audio'],
  ['M3U8 / MPD', 'HLS · DASH'],
];

export function createOpenPage(ctx: PageContext): PageInstance {
  const { session } = ctx;
  const root = el('div', { class: 'page' });

  /* ---------------------------------------------------------- folder library */

  const folderButton = el('button', { class: 'btn btn--sm', type: 'button' });
  folderButton.innerHTML = `${icon('folderOpen', 15)} Open a folder`;
  folderButton.addEventListener('click', () => void openFolder());

  const folderList = el('div', { class: 'folder-list' });

  const openFolder = async () => {
    if (!foldersSupported()) {
      toast('Folder access needs Chrome, Edge or Opera — other browsers only allow single files.', 'warn');
      return;
    }
    try {
      const picked = await pickFolder();
      if (!picked) return;
      await playFromFolder(picked.handle);
      void renderFolders();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast('Could not open that folder', 'warn');
    }
  };

  const playFromFolder = async (handle: FileSystemDirectoryHandle) => {
    if (!(await ensurePermission(handle))) {
      toast('Permission for that folder was denied', 'warn');
      return;
    }
    toast(`Scanning ${handle.name}…`, 'info');
    const entries = await scanFolder(handle);
    if (entries.length === 0) {
      toast('No media files found in that folder', 'warn');
      return;
    }
    await session.openFiles(entries.map((entry) => entry.file));
    toast(`Queued ${entries.length} files from ${handle.name}`, 'ok');
  };

  const renderFolders = async () => {
    folderList.innerHTML = '';
    const folders = await savedFolders();
    if (folders.length === 0) return;
    const title = el('div', { class: 'section-title' });
    title.innerHTML = `<h2>Folders</h2><span class="muted">${folders.length}</span>`;
    folderList.append(title);
    for (const folder of folders) {
      const row = el('div', { class: 'media-row', role: 'button', tabindex: '0' });
      row.innerHTML = `
        <div class="media-row__thumb">${icon('folderOpen', 18)}</div>
        <div class="media-row__body">
          <div class="media-row__title">${folder.name}</div>
          <div class="media-row__meta"><span>Rescan and queue everything inside</span></div>
        </div>`;
      row.addEventListener('click', () => void playFromFolder(folder.handle));
      folderList.append(row);
    }
  };

  const folderCard = el('div', { class: 'card', style: { marginTop: '16px' } });
  folderCard.innerHTML = `<div class="card__title">${icon('folderOpen', 16)} Folder library</div>
    <div class="card__desc">Pick a folder once — OmniPlay remembers it and can queue every media file inside. Chrome, Edge and Opera only; the browser asks for permission again after a restart.</div>`;
  folderCard.append(folderList);
  void renderFolders();

  root.append(
    pageHead('Open media', 'Files are read directly from your device. Nothing is uploaded, and the browser never gains permanent access.', [
      folderButton,
    ]),
  );

  const mediaInput = el('input', {
    type: 'file',
    class: 'hidden',
    multiple: true,
    accept: 'video/*,audio/*,.mkv,.avi,.mov,.flv,.ts,.m2ts,.mts,.m4v,.3gp,.wmv,.vob,.ogv,.webm,.mp4,.m3u8',
  });
  const subtitleInput = el('input', { type: 'file', class: 'hidden', multiple: true, accept: '.srt,.vtt,.ass,.ssa,.ttml,.dfxp,.sub' });
  const folderInput = el('input', { type: 'file', class: 'hidden', webkitdirectory: 'true', multiple: true });
  root.append(mediaInput, subtitleInput, folderInput);

  const dropzone = el('div', { class: 'dropzone', role: 'button', tabindex: '0' });
  dropzone.innerHTML = `
    <div class="dropzone__icon">${icon('upload', 26)}</div>
    <h3>Drop videos here</h3>
    <p>or click to browse. Multiple files become a play queue; subtitle files are attached automatically.</p>
    <div class="row" style="margin-top:10px;justify-content:center">
      <button class="btn btn--primary" id="pick-files">${icon('folderOpen', 16)} Choose files</button>
      <button class="btn" id="pick-folder">${icon('folder', 16)} Choose folder</button>
      <button class="btn" id="pick-subs">${icon('subtitles', 16)} Add subtitles</button>
    </div>
  `;
  root.append(dropzone);

  dropzone.querySelector('#pick-files')?.addEventListener('click', (event) => {
    event.stopPropagation();
    mediaInput.click();
  });
  dropzone.querySelector('#pick-folder')?.addEventListener('click', (event) => {
    event.stopPropagation();
    folderInput.click();
  });
  dropzone.querySelector('#pick-subs')?.addEventListener('click', (event) => {
    event.stopPropagation();
    subtitleInput.click();
  });
  dropzone.addEventListener('click', () => mediaInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      mediaInput.click();
    }
  });

  mediaInput.addEventListener('change', () => {
    const files = Array.from(mediaInput.files ?? []);
    mediaInput.value = '';
    if (files.length) void session.openFiles(files);
  });
  subtitleInput.addEventListener('change', () => {
    const files = Array.from(subtitleInput.files ?? []);
    subtitleInput.value = '';
    if (files.length) {
      session.pendingSubtitles = [...session.pendingSubtitles, ...files];
      toast(`${files.length} subtitle file${files.length > 1 ? 's' : ''} ready — open a video to use them.`, 'ok');
    }
  });
  folderInput.addEventListener('change', () => {
    const files = Array.from(folderInput.files ?? []).filter((file) => !isSubtitleFile(file.name));
    folderInput.value = '';
    if (files.length) void session.openFiles(files);
  });

  const over = (event: DragEvent) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  };
  const leave = () => dropzone.classList.remove('is-over');
  dropzone.addEventListener('dragover', over);
  dropzone.addEventListener('dragleave', leave);
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    leave();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void session.openFiles(files);
  });
  // Dropping anywhere on the page also works.
  const pageDrop = (event: DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void session.openFiles(files);
  };
  const pageOver = (event: DragEvent) => event.preventDefault();
  window.addEventListener('dragover', pageOver);
  window.addEventListener('drop', pageDrop);

  const info = el('div', { class: 'grid grid--2', style: { marginTop: '22px' } });
  const formats = el('div', { class: 'card' });
  formats.innerHTML = `<div class="card__title">${icon('layers', 16)} Formats</div>
    <div class="card__desc">Support depends on your browser and device. “*” marks formats that usually need the WebCodecs engine.</div>
    <div class="row" style="margin-top:14px;gap:8px">${SUPPORTED.map(
      ([name, codecs]) => `<span class="chip" title="${esc(codecs)}">${esc(name)}</span>`,
    ).join('')}</div>`;

  const limits = el('div', { class: 'card' });
  limits.innerHTML = `<div class="card__title">${icon('info', 16)} Browser reality check</div>
    <div class="card__desc">
      A browser is not VLC. Some codecs (DTS, TrueHD, VC-1, RMVB) have no browser decoder at all, and DRM-protected
      media can only be played by the service that owns it. OmniPlay tells you exactly which of those applies instead
      of failing silently.
    </div>
    <div class="row" style="margin-top:14px">
      <span class="chip chip--ok">No uploads</span>
      <span class="chip chip--ok">No account</span>
      <span class="chip chip--ok">No tracking</span>
    </div>`;

  info.append(formats, limits);
  root.append(info);

  root.append(folderCard);

  return {
    el: root,
    destroy: () => {
      window.removeEventListener('dragover', pageOver);
      window.removeEventListener('drop', pageDrop);
    },
  };
}
