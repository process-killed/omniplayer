import { el, esc } from './dom';
import { icon } from './icons';

export function pageHead(title: string, subtitle?: string, actions?: Node[]): HTMLElement {
  const head = el('div', { class: 'page-head' }, [
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('h1', { text: title }),
      subtitle ? el('p', { text: subtitle, style: { marginTop: '6px' } }) : null,
    ]),
  ]);
  if (actions?.length) head.append(el('div', { class: 'row' }, actions));
  return head;
}

export function emptyState(options: {
  iconName?: string;
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
}): HTMLElement {
  const node = el('div', { class: 'empty' });
  node.innerHTML = `${icon(options.iconName ?? 'film', 30)}<h3>${esc(options.title)}</h3>${
    options.text ? `<p>${esc(options.text)}</p>` : ''
  }`;
  if (options.actionLabel && options.onAction) {
    const button = el('button', { class: 'btn btn--primary btn--sm', text: options.actionLabel });
    button.addEventListener('click', options.onAction);
    node.append(button);
  }
  return node;
}

export function switchRow(
  title: string,
  description: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const row = el('button', {
    class: 'switch',
    type: 'button',
    role: 'switch',
    'aria-checked': String(checked),
  });
  row.innerHTML = `<span class="switch__text"><span class="switch__title">${esc(title)}</span>${
    description ? `<span class="switch__desc">${esc(description)}</span>` : ''
  }</span><span class="switch__track"></span>`;
  row.addEventListener('click', () => {
    const next = row.getAttribute('aria-checked') !== 'true';
    row.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return row;
}

export function settingRow(title: string, description: string, control: Node): HTMLElement {
  const row = el('div', { class: 'setting-row' });
  row.innerHTML = `<div class="setting-row__body"><div class="setting-row__title">${esc(title)}</div>${
    description ? `<div class="setting-row__desc">${esc(description)}</div>` : ''
  }</div>`;
  row.append(el('div', { class: 'setting-row__control' }, [control]));
  return row;
}

export function selectControl(
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = el('select', { class: 'select' });
  for (const option of options) {
    const node = el('option', { value: option.value, text: option.label });
    if (option.value === value) node.selected = true;
    select.append(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function rangeControl(
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLInputElement {
  const input = el('input', {
    class: 'range',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });
  const paint = () => {
    const percent = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${percent}%`);
  };
  paint();
  input.addEventListener('input', () => {
    paint();
    onInput(Number(input.value));
  });
  return input;
}

export function textField(
  label: string,
  value: string,
  placeholder: string,
  onInput: (value: string) => void,
  type = 'text',
): HTMLElement {
  const input = el('input', { class: 'input', type, placeholder, value });
  input.addEventListener('input', () => onInput(input.value));
  return el('label', { class: 'field' }, [el('span', { class: 'field__label', text: label }), input]);
}

export interface MediaRowOptions {
  title: string;
  meta: string;
  poster?: string;
  progress?: number;
  onClick?: () => void;
  actions?: Array<{ iconName: string; label: string; onClick: () => void; danger?: boolean }>;
  badge?: string;
}

export function mediaRow(options: MediaRowOptions): HTMLElement {
  const row = el('div', { class: 'media-row', role: 'button', tabindex: '0' });
  const thumb = el('div', { class: 'media-row__thumb' });
  if (options.poster) {
    const img = el('img', { src: options.poster, alt: '', loading: 'lazy' });
    thumb.append(img);
  } else {
    thumb.innerHTML = icon('film', 20);
  }

  const body = el('div', { class: 'media-row__body' });
  body.innerHTML = `<div class="media-row__title">${esc(options.title)}</div>
    <div class="media-row__meta">${options.meta}</div>`;
  if (options.progress !== undefined && options.progress > 0) {
    const bar = el('div', { class: 'media-row__progress' });
    bar.innerHTML = `<i style="width:${Math.min(100, Math.max(0, options.progress))}%"></i>`;
    body.append(bar);
  }

  const actions = el('div', { class: 'media-row__actions' });
  for (const action of options.actions ?? []) {
    const button = el('button', {
      class: 'icon-btn',
      'aria-label': action.label,
      title: action.label,
      html: icon(action.iconName, 16),
    });
    if (action.danger) button.style.color = 'var(--err)';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      action.onClick();
    });
    actions.append(button);
  }

  row.append(thumb, body);
  if (options.badge) {
    const badge = el('span', { class: 'chip chip--accent', text: options.badge, style: { flex: 'none' } });
    row.append(badge);
  }
  row.append(actions);

  if (options.onClick) {
    row.addEventListener('click', options.onClick);
    row.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') {
        event.preventDefault();
        options.onClick?.();
      }
    });
  }
  return row;
}

export function chip(text: string, kind: 'ok' | 'warn' | 'err' | 'accent' | '' = ''): HTMLElement {
  return el('span', { class: `chip${kind ? ` chip--${kind}` : ''}`, text });
}

export function notice(text: string, kind: 'info' | 'warn' | 'err' | 'ok' = 'info'): HTMLElement {
  const node = el('div', { class: `notice notice--${kind}` });
  node.innerHTML = `${icon(kind === 'err' ? 'alertCircle' : kind === 'warn' ? 'alert' : kind === 'ok' ? 'checkCircle' : 'info', 16)}<span>${esc(
    text,
  )}</span>`;
  return node;
}

export function kvList(rows: Array<[string, string]>): HTMLElement {
  const dl = el('dl', { class: 'kv' });
  for (const [key, value] of rows) {
    dl.append(el('dt', { text: key }), el('dd', { text: value }));
  }
  return dl;
}
