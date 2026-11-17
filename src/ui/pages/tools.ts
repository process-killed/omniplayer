import type { PageContext, PageInstance } from './types';
import { el, esc, toast, downloadFile } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { PRESETS, limitsForDevice, presetById, runFfmpegJob, isFfmpegLoaded, unloadFfmpeg, type FfmpegPresetId } from '../../media/ffmpeg';
import { formatBytes } from '../../torrent/magnet';
import { deviceReport } from '../../core/deviceProfile';

/**
 * Media tools — on-device conversion with FFmpeg.wasm.
 *
 * The 30 MB core is fetched only when a job starts, so this page costs nothing
 * until it is used, and the worker is terminated as soon as the job ends.
 */
export function createToolsPage(ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });
  const status = el('div', { class: 'tools-status' });
  const logHost = el('pre', { class: 'tools-log hidden' });

  let file: File | null = null;
  let presetId: FfmpegPresetId = 'remux-mp4';
  let controller: AbortController | null = null;

  const profile = deviceReport().profile;
  const limits = limitsForDevice(0, profile);

  /* --------------------------------------------------------------- file pick */

  const fileLabel = el('div', { class: 'tools-file', text: 'No file selected' });
  const pick = el('input', { type: 'file', class: 'hidden', accept: 'video/*,audio/*,.mkv,.avi,.mov,.ts,.flv,.m4v' });
  const pickButton = el('button', { class: 'btn btn--primary btn--sm', type: 'button' });
  pickButton.innerHTML = `${icon('folderOpen', 15)} Choose file`;
  pickButton.addEventListener('click', () => pick.click());
  pick.addEventListener('change', () => {
    file = pick.files?.[0] ?? null;
    if (!file) return;
    fileLabel.textContent = `${file.name} · ${formatBytes(file.size)}`;
    refresh();
  });

  const current = ctx.store.current;
  if (current?.url) {
    const useCurrent = el('button', { class: 'btn btn--sm', type: 'button' });
    useCurrent.innerHTML = `${icon('link', 15)} Use the file now playing`;
    useCurrent.addEventListener('click', async () => {
      if (!current.url) return;
      useCurrent.disabled = true;
      useCurrent.textContent = 'Fetching…';
      try {
        const response = await fetch(current.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        file = new File([blob], current.name || 'media', { type: blob.type });
        fileLabel.textContent = `${file.name} · ${formatBytes(file.size)}`;
        refresh();
      } catch (error) {
        toast(`Could not read the current source: ${(error as Error).message}`, 'warn');
      } finally {
        useCurrent.disabled = false;
        useCurrent.innerHTML = `${icon('link', 15)} Use the file now playing`;
      }
    });
    root.append(useCurrent);
  }

  /* ---------------------------------------------------------------- presets */

  const presetGrid = el('div', { class: 'tools-presets' });
  for (const preset of PRESETS) {
    const button = el('button', { class: 'tools-preset', type: 'button', 'data-id': preset.id });
    const disabled = !preset.copyOnly && !limits.allowHeavy;
    button.innerHTML = `
      <b>${esc(preset.label)}</b>
      <span>${esc(preset.description)}</span>
      <em class="chip ${preset.weight === 'heavy' ? 'warn' : ''}">${preset.weight === 'light' ? 'fast' : preset.weight}</em>`;
    if (disabled) {
      button.disabled = true;
      button.classList.add('is-disabled');
    }
    button.addEventListener('click', () => {
      presetId = preset.id as FfmpegPresetId;
      presetGrid.querySelectorAll('.tools-preset').forEach((node) => node.classList.remove('is-active'));
      button.classList.add('is-active');
      refresh();
    });
    presetGrid.append(button);
  }
  presetGrid.querySelector('.tools-preset')?.classList.add('is-active');

  /* ------------------------------------------------------------------- run */

  const runButton = el('button', { class: 'btn btn--primary', type: 'button' });
  runButton.innerHTML = `${icon('play', 16)} Start`;
  const cancelButton = el('button', { class: 'btn', type: 'button', disabled: true });
  cancelButton.innerHTML = `${icon('x', 16)} Cancel`;
  const bar = el('div', { class: 'tools-bar' }, [el('div', { class: 'tools-bar__fill' })]);
  const percent = el('span', { class: 'muted', text: '' });

  const refresh = () => {
    const preset = presetById(presetId);
    if (!preset) return;
    const tooBig = !!file && file.size > limits.maxInputBytes;
    runButton.disabled = !file || tooBig || controller !== null;
    status.innerHTML = !file
      ? 'Choose a file to begin.'
      : tooBig
        ? `This file is larger than the ${formatBytes(limits.maxInputBytes)} limit for this device.`
        : `${preset.label} → ${file.name.replace(/\.[^.]+$/, '')}.${preset.extension}`;
  };

  runButton.addEventListener('click', async () => {
    const preset = presetById(presetId);
    if (!file || !preset) return;
    controller = new AbortController();
    runButton.disabled = true;
    cancelButton.disabled = false;
    logHost.classList.remove('hidden');
    logHost.textContent = '';
    bar.classList.add('is-active');
    const appendLog = (line: string) => {
      logHost.textContent += `${line}\n`;
      logHost.scrollTop = logHost.scrollHeight;
    };
    try {
      const result = await runFfmpegJob({
        file,
        preset,
        signal: controller.signal,
        onLog: appendLog,
        onProgress: (ratio, seconds) => {
          (bar.firstElementChild as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;
          percent.textContent = `${Math.round(ratio * 100)}% · ${seconds.toFixed(0)}s processed`;
        },
      });
      percent.textContent = `Done in ${result.seconds.toFixed(1)}s`;
      downloadFile(result.name, result.blob);
      toast(`${result.name} is ready`, 'ok');
    } catch (error) {
      const message = (error as Error).message;
      if (controller.signal.aborted) toast('Cancelled — the worker was stopped', 'info');
      else toast(message, 'warn');
      appendLog(`error: ${message}`);
    } finally {
      controller = null;
      cancelButton.disabled = true;
      bar.classList.remove('is-active');
      refresh();
    }
  });

  cancelButton.addEventListener('click', () => {
    controller?.abort();
    unloadFfmpeg();
  });

  root.append(
    pageHead(
      'Media tools',
      'Convert, remux, compress and extract — all on your device with FFmpeg.wasm. Nothing is uploaded.',
      [pickButton],
    ),
    el('div', { class: 'card' }, [
      pick,
      fileLabel,
      notice(
        limits.allowHeavy
          ? 'The FFmpeg core (~30 MB) downloads on first use and is cached afterwards. The worker is stopped when the job ends, so nothing stays in memory.'
          : 'This device reports low memory, so only stream-copy jobs are offered — they never decode video and are safe here. Re-encoding is disabled.',
        limits.allowHeavy ? 'info' : 'warn',
      ),
      presetGrid,
      status,
      el('div', { class: 'row', style: { marginTop: '14px' } }, [runButton, cancelButton, percent]),
      bar,
      logHost,
    ]),
  );

  refresh();

  return {
    el: root,
    destroy: () => {
      controller?.abort();
      if (isFfmpegLoaded()) unloadFfmpeg();
    },
  };
}
