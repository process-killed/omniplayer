import type { PageContext, PageInstance } from './types';
import { el, esc, toast, downloadFile } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { parseSubtitle } from '../../subtitles/parser';
import { formatTime } from '../../utils/format';
import {
  applyDrift,
  applyOffset,
  diagnose,
  repair,
  summarise,
  toSrt,
  toVtt,
  type SubtitleIssue,
} from '../../subtitles/doctor';
import type { Cue } from '../../types';

/**
 * OmniSubtitle Doctor — a workspace, not a settings panel.
 *
 * Scan a subtitle, see exactly what is wrong and where, repair the safe issues
 * in one click, correct sync by offset or drift, and export SRT/VTT. Everything
 * runs on the device; nothing is uploaded.
 */
export function createSubtitleDoctorPage(ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });

  let cues: Cue[] = [];
  let working: Cue[] = cues;
  let issues: SubtitleIssue[] = [];
  let sourceName = 'subtitles';
  let offset = 0;
  let drift = 0;

  const issueHost = el('div', { class: 'sd-issues' });
  const summaryHost = el('div', { class: 'sd-summary' });
  const previewHost = el('div', { class: 'sd-preview' });
  const syncLabel = el('span', { class: 'sd-sync-label', text: 'No offset' });

  const loadFromText = (text: string, name: string) => {
    const parsed = parseSubtitle(text, name);
    cues = parsed.cues ?? [];
    working = cues.map((cue) => ({ ...cue }));
    sourceName = name.replace(/\.[^.]+$/, '');
    offset = 0;
    drift = 0;
    scan();
    toast(`${cues.length} cues loaded`, 'ok');
  };

  /* ------------------------------------------------------------------- scan */

  const scan = () => {
    // Media duration comes from the player when one is open; optional.
    const mediaDuration = (ctx.store as unknown as { duration?: number }).duration ?? undefined;
    issues = diagnose(working, { mediaDuration });
    renderSummary();
    renderIssues();
    renderPreview();
  };

  const renderSummary = () => {
    const summary = summarise(issues);
    summaryHost.innerHTML = `
      <div class="sd-stat"><b>${summary.errors}</b><span>errors</span></div>
      <div class="sd-stat"><b>${summary.warnings}</b><span>warnings</span></div>
      <div class="sd-stat"><b>${summary.infos}</b><span>notes</span></div>
      <div class="sd-stat"><b>${summary.fixable}</b><span>auto-fixable</span></div>`;
    summaryHost.classList.toggle('is-clean', summary.total === 0);
    if (!cues.length) {
      summaryHost.innerHTML = '<p class="muted">Load a subtitle to begin.</p>';
    }
  };

  const renderIssues = () => {
    issueHost.innerHTML = '';
    if (!cues.length) return;
    if (!issues.length) {
      issueHost.append(notice('No problems found. This subtitle is clean.', 'ok'));
      return;
    }
    for (const issue of issues.slice(0, 200)) {
      const row = el('div', { class: `sd-issue sd-issue--${issue.severity}` });
      row.innerHTML = `
        <div class="sd-issue__time">${formatTime(issue.start)}</div>
        <div class="sd-issue__body">
          <b>${esc(issue.title)}</b>
          <span>${esc(issue.detail)}</span>
        </div>
        ${issue.fixable ? `<button class="btn btn--sm" data-fix="${esc(issue.id)}" type="button">Fix</button>` : '<span class="chip">review</span>'}`;
      row.querySelector('[data-fix]')?.addEventListener('click', () => fixOne(issue));
      // Jump to the moment in the player, when a player is running.
      row.querySelector('.sd-issue__time')?.addEventListener('click', () => {
        const seek = (ctx.store as unknown as { seek?: (time: number) => void }).seek;
        if (seek) seek(issue.start);
        else toast(`Cue starts at ${formatTime(issue.start)}`, 'info');
      });
      issueHost.append(row);
    }
  };

  const fixOne = (issue: SubtitleIssue) => {
    const result = repair(working, [issue]);
    if (!result.applied.length) {
      toast('That one needs a human decision', 'warn');
      return;
    }
    working = result.cues;
    scan();
  };

  const renderPreview = () => {
    if (!working.length) {
      previewHost.innerHTML = '';
      return;
    }
    const sample = working
      .filter((cue) => cue.text.trim())
      .slice(0, 4)
      .map(
        (cue) => `<div class="sd-line">
          <span class="sd-line__t">${formatTime(cue.start)} → ${formatTime(cue.end)}</span>
          <span class="sd-line__x">${esc(cue.text.replace(/\n/g, ' / '))}</span>
        </div>`,
      )
      .join('');
    previewHost.innerHTML = sample;
  };

  /* ------------------------------------------------------------------- load */

  const filePicker = el('input', { type: 'file', class: 'hidden', accept: '.srt,.vtt,.ass,.ssa,.ttml,.xml,.txt' });
  filePicker.addEventListener('change', async () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    loadFromText(await file.text(), file.name);
  });

  const openButton = el('button', { class: 'btn btn--primary btn--sm', type: 'button' });
  openButton.innerHTML = `${icon('folderOpen', 15)} Open subtitle`;
  openButton.addEventListener('click', () => filePicker.click());

  const useCurrentButton = el('button', { class: 'btn btn--sm', type: 'button' });
  useCurrentButton.innerHTML = `${icon('subtitles', 15)} Use the playing subtitle`;
  useCurrentButton.addEventListener('click', () => {
    const active = (ctx.store as unknown as { subtitleCues?: () => Cue[] | null }).subtitleCues?.();
    if (!active?.length) {
      toast('No subtitle is loaded in the player — open a file instead', 'warn');
      return;
    }
    cues = active.map((cue) => ({ ...cue }));
    working = cues.map((cue) => ({ ...cue }));
    sourceName = 'current-subtitle';
    scan();
  });

  /* ------------------------------------------------------------------- sync */

  const syncRow = el('div', { class: 'sd-sync' });
  const buildSync = () => {
    const make = (label: string, value: number, step: number, onInput: (value: number) => void) => {
      const wrap = el('label', { class: 'sd-sync__field' });
      wrap.innerHTML = `<span>${label}</span>`;
      const input = el('input', {
        type: 'range',
        min: String(-Math.abs(step) * 20),
        max: String(Math.abs(step) * 20),
        step: '0.05',
        value: String(value),
      });
      const out = el('b', { text: `${value > 0 ? '+' : ''}${value.toFixed(2)}s` });
      input.addEventListener('input', () => {
        const next = Number(input.value);
        out.textContent = `${next > 0 ? '+' : ''}${next.toFixed(2)}s`;
        onInput(next);
      });
      wrap.append(input, out);
      return wrap;
    };

    syncRow.innerHTML = '';
    syncRow.append(
      make('Offset', offset, 1, (value) => {
        offset = value;
        rebuildSync();
      }),
      make('Drift by the end', drift, 1, (value) => {
        drift = value;
        rebuildSync();
      }),
    );
    syncLabel.textContent =
      offset === 0 && drift === 0 ? 'No offset' : `Offset ${offset > 0 ? '+' : ''}${offset.toFixed(2)}s${drift ? `, drift ${drift > 0 ? '+' : ''}${drift.toFixed(2)}s` : ''}`;
  };

  const rebuildSync = () => {
    const base = repair(cues, diagnose(cues)).cues;
    working = drift ? applyDrift(base, offset, drift) : applyOffset(base, offset);
    buildSync();
    scan();
  };

  /* ----------------------------------------------------------------- actions */

  const actions = el('div', { class: 'row', style: { marginTop: '12px', flexWrap: 'wrap' } });
  const action = (label: string, iconName: string, handler: () => void) => {
    const button = el('button', { class: 'btn btn--sm', type: 'button' });
    button.innerHTML = `${icon(iconName, 15)} ${esc(label)}`;
    button.addEventListener('click', handler);
    actions.append(button);
  };

  action('Fix all safe issues', 'wand', () => {
    const result = repair(cues, diagnose(cues));
    if (!result.applied.length) {
      toast('Nothing safe to repair', 'info');
      return;
    }
    working = result.cues;
    scan();
    toast(`${result.applied.length} issues repaired${result.skipped.length ? `, ${result.skipped.length} need review` : ''}`, 'ok');
  });
  action('Rescan', 'refresh', scan);
  action('Export SRT', 'download', () => downloadFile(`${sourceName}.fixed.srt`, toSrt(working), 'text/plain'));
  action('Export VTT', 'download', () => downloadFile(`${sourceName}.fixed.vtt`, toVtt(working), 'text/vtt'));

  root.append(
    pageHead(
      'Subtitle Doctor',
      'Find and repair subtitle problems — overlaps, bad timing, unreadable speed — then export. Everything runs on your device.',
      [openButton, useCurrentButton],
    ),
    filePicker,
    el('div', { class: 'card' }, [
      summaryHost,
      notice(
        'Automatic repair is conservative: it never invents dialogue, never deletes a cue that has text, and never moves a cue past its neighbour. Anything that needs a decision is left for you.',
        'info',
      ),
      el('h3', { class: 'dev-h3', text: 'Synchronisation' }),
      syncLabel,
      syncRow,
      actions,
    ]),
    el('div', { class: 'card' }, [el('div', { class: 'card__title' }, [el('span', { text: 'Issues' })]), issueHost]),
    el('div', { class: 'card' }, [el('div', { class: 'card__title' }, [el('span', { text: 'Preview' })]), previewHost]),
  );

  buildSync();
  renderSummary();

  return { el: root };
}
