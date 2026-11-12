import type { PageContext, PageInstance } from './types';
import { el, esc, toast } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { formatBytes } from '../../torrent/magnet';
import { formatTime } from '../../utils/format';
import { downloads } from '../../downloads/manager';
import { historyJson, rememberDirectory, storageInfo } from '../../downloads/store';

export function createDownloadsPage(_ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });
  const list = el('div', { class: 'dl-list' });
  const storageBar = el('div', { class: 'dl-storage' });
  const input = el('input', { class: 'input', type: 'url', placeholder: 'https://host/file.mp4', spellcheck: 'false' });

  const add = async () => {
    const url = input.value.trim();
    if (!url) {
      input.focus();
      return;
    }
    if (/\.(m3u8|mpd)(\?|$)/i.test(url)) {
      toast('A manifest is a stream, not a file — download its segments is not offered.', 'warn');
      return;
    }
    const job = await downloads.enqueue(url);
    if (!job) {
      toast('That link is already in the queue', 'warn');
      return;
    }
    input.value = '';
    toast('Added to the queue', 'ok');
  };

  const addButton = el('button', { class: 'btn btn--primary', type: 'button' });
  addButton.innerHTML = `${icon('download', 16)} Download`;
  addButton.addEventListener('click', () => void add());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void add();
  });

  const row = (job: ReturnType<typeof downloads.list>[number]) => {
    const item = el('div', { class: 'dl-item', 'data-state': job.state });
    const percent = job.size ? Math.min(100, Math.round((job.received / job.size) * 100)) : 0;
    item.innerHTML = `
      <div class="dl-item__head">
        <span class="dl-item__name" title="${esc(job.name)}">${esc(job.name)}</span>
        <span class="chip ${job.state === 'done' ? 'ok' : job.state === 'failed' ? 'err' : ''}">${esc(job.state)}</span>
      </div>
      <div class="dl-item__bar"><span style="width:${percent}%"></span></div>
      <div class="dl-item__meta">
        <span>${formatBytes(job.received)}${job.size ? ` / ${formatBytes(job.size)}` : ''}</span>
        <span>${job.size ? `${percent}%` : 'size unknown'}</span>
        ${job.speed > 0 ? `<span>${formatBytes(job.speed)}/s</span>` : ''}
        ${job.speed > 0 && job.size ? `<span>${formatTime((job.size - job.received) / job.speed)} left</span>` : ''}
        ${job.resumable ? '' : '<span class="chip">no resume</span>'}
      </div>
      ${job.error ? `<div class="dl-item__error">${esc(job.error)}</div>` : ''}`;

    const actions = el('div', { class: 'row', style: { marginTop: '8px' } });
    const act = (label: string, iconName: string, handler: () => void) => {
      const button = el('button', { class: 'btn btn--sm', type: 'button' });
      button.innerHTML = `${icon(iconName, 14)} ${esc(label)}`;
      button.addEventListener('click', handler);
      actions.append(button);
    };

    if (job.state === 'downloading' || job.state === 'queued') {
      act(job.resumable ? 'Pause' : 'Stop', 'pause', () => downloads.pause(job.id));
    }
    if (job.state === 'paused' || job.state === 'failed') {
      act('Resume', 'play', () => downloads.resume(job.id));
    }
    act('Remove', 'trash', () => void downloads.remove(job.id));
    item.append(actions);
    return item;
  };

  const render = (jobs: ReturnType<typeof downloads.list>) => {
    list.innerHTML = '';
    if (jobs.length === 0) {
      list.append(notice('Nothing queued yet. Paste a direct file link above, or use “Download” in the player.', 'info'));
      return;
    }
    jobs.forEach((job) => list.append(row(job)));
  };

  const control = (label: string, iconName: string, handler: () => void) => {
    const button = el('button', { class: 'btn btn--sm', type: 'button' });
    button.innerHTML = `${icon(iconName, 14)} ${esc(label)}`;
    button.addEventListener('click', handler);
    return button;
  };

  const settings = downloads.getSettings();
  const concurrency = el('select', { class: 'select' });
  [1, 2, 3, 4].forEach((value) => {
    const option = el('option', { value: String(value), text: `${value} at a time` });
    if (value === settings.concurrency) option.selected = true;
    concurrency.append(option);
  });
  concurrency.addEventListener('change', () => downloads.setSettings({ concurrency: Number(concurrency.value) }));

  const fsToggle = el('input', { type: 'checkbox' });
  fsToggle.checked = settings.useFileSystem;
  fsToggle.addEventListener('change', () => downloads.setSettings({ useFileSystem: fsToggle.checked }));

  root.append(
    pageHead('Downloads', 'Queue files, pause and resume with HTTP ranges, and keep them out of RAM.'),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [input, addButton]),
      notice(
        'Downloads go straight to the origin — never through your CORS proxy. Pause only works when the server supports Range requests; when it does not, the button stops the download and says so.',
        'info',
      ),
      el('div', { class: 'row', style: { marginTop: '12px' } }, [
        control('Pause all', 'pause', () => downloads.pauseAll()),
        control('Resume all', 'play', () => downloads.resumeAll()),
        control('Cancel all', 'trash', () => void downloads.cancelAll()),
        concurrency,
        el('label', { class: 'dl-inline' }, [fsToggle, el('span', { text: 'Save with the file picker' })]),
      ]),
      el('div', { class: 'row', style: { marginTop: '10px' } }, [
        control('Choose download folder', 'folderOpen', () => void pickDirectory()),
        control('Export history', 'download', () => void exportHistory()),
      ]),
      notice(
        'Very large files: without the file-system writer the finished chunks are joined in memory once, which can need as much RAM as the file itself. Use a Chromium browser or pick a download folder for multi-gigabyte files.',
        'warn',
      ),
      storageBar,
    ]),
    list,
  );

  void downloads.init().then(() => render(downloads.list()));
  const off = downloads.subscribe(render);

  const pickDirectory = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      toast('This browser cannot remember a folder — downloads will use the save picker or a Blob', 'warn');
      return;
    }
    try {
      const handle = await picker();
      await rememberDirectory(handle);
      toast(`Downloads will be saved in ${handle.name}`, 'ok');
    } catch {
      toast('Folder not chosen', 'warn');
    }
  };

  const exportHistory = async () => {
    const jobs = downloads.list();
    if (jobs.length === 0) {
      toast('No downloads to export yet', 'warn');
      return;
    }
    const blob = new Blob([historyJson(jobs)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'omniplay-downloads.json' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`Exported ${jobs.length} entries`, 'ok');
  };

  void storageInfo().then((info) => {
    storageBar.innerHTML = info
      ? `Browser storage: ${formatBytes(info.usage)} used of ${formatBytes(info.quota)}`
      : 'Browser storage: not reported by this browser';
  });

  return {
    el: root,
    destroy: () => off(),
  };
}
