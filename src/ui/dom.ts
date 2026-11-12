/** DOM helpers: element factory, toasts, modals, popovers. */

import { icon } from './icons';

export type Attrs = Record<string, unknown>;

/** Escape untrusted text before putting it into an innerHTML template. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string | null | undefined> | string = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value as Record<string, string>);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  const list = typeof children === 'string' ? [children] : children;
  for (const child of list) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/* ------------------------------------------------------------------ toasts */

type ToastKind = 'ok' | 'err' | 'warn' | 'info';

function toastHost(): HTMLElement {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) {
    host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

export function toast(message: string, kind: ToastKind = 'info', ms = 3200): void {
  const host = toastHost();
  const iconName = kind === 'ok' ? 'checkCircle' : kind === 'err' ? 'alertCircle' : kind === 'warn' ? 'alert' : 'info';
  const node = el('div', { class: `toast toast--${kind}`, html: `${icon(iconName, 15)}<span>${esc(message)}</span>` });
  host.append(node);
  while (host.children.length > 3) host.firstElementChild?.remove();
  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 220);
  }, ms);
}

/** Toast with a single action button (used for “new version ready”). */
export function toastAction(message: string, actionLabel: string, onAction: () => void, ms = 14000): void {
  const host = toastHost();
  const node = el('div', { class: 'toast toast--action' });
  node.innerHTML = `${icon('refresh', 15)}<span>${esc(message)}</span>`;
  const button = el('button', { class: 'toast__action', type: 'button', text: actionLabel });
  button.addEventListener('click', () => {
    onAction();
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 220);
  });
  node.append(button);
  host.append(node);
  while (host.children.length > 3) host.firstElementChild?.remove();
  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 220);
  }, ms);
}

/* ------------------------------------------------------------------ modals */

export interface ModalOptions {
  title: string;
  description?: string;
  body?: Node | string;
  confirmLabel?: string;
  cancelLabel?: string | null;
  danger?: boolean;
  onConfirm?: () => boolean | void | Promise<boolean | void>;
}

export function openModal(options: ModalOptions): { close: () => void; root: HTMLElement } {
  const backdrop = el('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' });
  const modal = el('div', { class: 'modal' });
  const head = el('div', { class: 'modal__head' }, [
    el('div', {}, [
      el('h2', { text: options.title }),
      options.description ? el('p', { text: options.description }) : null,
    ]),
    el('button', { class: 'icon-btn', 'aria-label': 'Close', html: icon('x', 18) }),
  ]);
  const body = el('div', { class: 'modal__body' });
  if (typeof options.body === 'string') body.innerHTML = options.body;
  else if (options.body) body.append(options.body);

  const foot = el('div', { class: 'modal__foot' });
  if (options.cancelLabel !== null) {
    foot.append(
      el('button', { class: 'btn btn--ghost', text: options.cancelLabel ?? 'Cancel' }),
    );
  }
  const confirmBtn = el('button', {
    class: `btn ${options.danger ? 'btn--danger' : 'btn--primary'}`,
    text: options.confirmLabel ?? 'Confirm',
  });
  foot.append(confirmBtn);

  modal.append(head, body, foot);
  backdrop.append(modal);
  document.body.append(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter' && (event.target as HTMLElement)?.tagName !== 'TEXTAREA') {
      event.preventDefault();
      void confirm();
    }
  };
  const confirm = async () => {
    if (options.onConfirm) {
      const result = await options.onConfirm();
      if (result === false) return;
    }
    close();
  };

  head.querySelector('.icon-btn')?.addEventListener('click', close);
  foot.querySelector('.btn--ghost')?.addEventListener('click', close);
  confirmBtn.addEventListener('click', () => void confirm());
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);

  window.setTimeout(() => {
    const focusable = modal.querySelector<HTMLElement>('input, textarea, select, .btn--primary');
    focusable?.focus();
  }, 30);

  return { close, root: modal };
}

export function confirmDialog(
  title: string,
  description: string,
  confirmLabel = 'Confirm',
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    let decided = false;
    const modal = openModal({
      title,
      description,
      confirmLabel,
      danger,
      onConfirm: () => {
        decided = true;
        resolve(true);
      },
    });
    // Resolve false when closed without confirming.
    const observer = new MutationObserver(() => {
      if (!document.body.contains(modal.root.closest('.modal-backdrop')!)) {
        observer.disconnect();
        if (!decided) resolve(false);
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

/* ---------------------------------------------------------------- popovers */

let activePopover: { node: HTMLElement; cleanup: () => void } | null = null;

export function closePopover(): void {
  activePopover?.cleanup();
  activePopover = null;
}

export function showPopover(
  anchor: HTMLElement,
  content: Node | string,
  options: { align?: 'start' | 'end' | 'center'; width?: number; onClose?: () => void } = {},
): HTMLElement {
  closePopover();
  const pop = el('div', { class: 'popover', role: 'menu' });
  if (typeof content === 'string') pop.innerHTML = content;
  else pop.append(content);
  document.body.append(pop);

  const rect = anchor.getBoundingClientRect();
  const width = options.width ?? pop.offsetWidth;
  const align = options.align ?? 'start';
  let left = align === 'end' ? rect.right - width : align === 'center' ? rect.left + rect.width / 2 - width / 2 : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.bottom + 8;
  const height = pop.offsetHeight;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 8);
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  if (options.width) pop.style.width = `${options.width}px`;

  const onDocDown = (event: MouseEvent) => {
    if (!pop.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const onScroll = (event: Event) => {
    if (pop.contains(event.target as Node)) return;
    close();
  };
  function close() {
    pop.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    options.onClose?.();
    if (activePopover?.node === pop) activePopover = null;
  }
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  activePopover = { node: pop, cleanup: close };
  return pop;
}

export function menuItem(
  label: string,
  opts: {
    iconName?: string;
    selected?: boolean;
    sub?: string;
    badge?: string;
    onClick?: () => void;
    danger?: boolean;
  } = {},
): HTMLElement {
  const node = el('button', {
    class: `menu-item${opts.selected ? ' is-selected' : ''}`,
    type: 'button',
    role: 'menuitem',
  });
  if (opts.danger) node.style.color = 'var(--err)';
  node.innerHTML = `
    ${opts.iconName ? icon(opts.iconName, 16) : ''}
    <span style="flex:1;min-width:0">
      <span style="display:block">${esc(label)}</span>
      ${opts.sub ? `<span class="menu-item__sub">${esc(opts.sub)}</span>` : ''}
    </span>
    ${opts.badge ? `<span class="chip" style="height:20px;font-size:10px;padding:0 6px">${esc(opts.badge)}</span>` : ''}
    <span class="menu-item__check">${icon('check', 15)}</span>
  `;
  node.addEventListener('click', () => {
    opts.onClick?.();
    closePopover();
  });
  return node;
}

export function menuTitle(text: string): HTMLElement {
  return el('div', { class: 'menu-title', text });
}

export function menuSep(): HTMLElement {
  return el('div', { class: 'menu-sep' });
}

/* ------------------------------------------------------------------- misc */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = el('textarea', { style: { position: 'fixed', opacity: '0' } });
      area.value = text;
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}
