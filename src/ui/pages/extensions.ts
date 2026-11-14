import type { PageContext, PageInstance } from './types';
import { el, esc, toast } from '../dom';
import { icon } from '../icons';
import { notice, pageHead } from '../components';
import { extensionManager, type InstallPreview } from '../../extensions/core/manager';
import type { InstalledExtension, Permission } from '../../extensions/types';

const PERMISSION_COPY: Record<string, string> = {
  'ui.register': 'Add items to the app interface',
  'player.read': 'Read the current player state',
  'player.control': 'Play, pause and seek',
  'subtitle.read': 'Read subtitle tracks',
  'subtitle.write': 'Modify subtitle tracks',
  'storage.local': 'Keep its own settings on this device',
  'storage.files': 'Store files on this device',
  'network.fetch': 'Make network requests to declared hosts',
  'download.save': 'Save files to your device',
  'worker.spawn': 'Run background workers',
};

export function createExtensionsPage(_ctx: PageContext): PageInstance {
  const root = el('div', { class: 'page' });
  const listHost = el('div', { class: 'ext-list' });
  const modalHost = el('div');

  const addButton = el('button', { class: 'btn btn--primary btn--sm', type: 'button' });
  addButton.innerHTML = `${icon('plus', 15)} Add extension`;
  addButton.addEventListener('click', () => openInstall());

  const card = (extension: InstalledExtension) => {
    const node = el('div', { class: 'card ext-card' });
    const enabled = extension.state === 'enabled';
    node.innerHTML = `
      <div class="ext-card__head">
        <div class="ext-card__icon">${icon('package', 20)}</div>
        <div class="ext-card__title">
          <b>${esc(extension.manifest.name)}</b>
          <span class="muted">v${esc(extension.manifest.version)}${extension.manifest.author?.name ? ` · ${esc(extension.manifest.author.name)}` : ''}</span>
        </div>
        <span class="chip ${enabled ? 'ok' : ''}">${enabled ? 'enabled' : extension.state}</span>
      </div>
      <p class="ext-card__desc">${esc(extension.manifest.description ?? 'No description provided.')}</p>
      <div class="ext-card__meta">
        <span>${esc(extension.owner)}/${esc(extension.repo)}</span>
        <span>${esc(extension.commit.slice(0, 7))}</span>
        <span>${extension.granted.length} permission${extension.granted.length === 1 ? '' : 's'}</span>
      </div>
      ${extension.lastError ? `<div class="ext-card__error">${esc(extension.lastError)}</div>` : ''}
    `;

    const actions = el('div', { class: 'row', style: { marginTop: '10px' } });
    const action = (label: string, iconName: string, handler: () => void, danger = false) => {
      const button = el('button', { class: `btn btn--sm${danger ? ' btn--danger' : ''}`, type: 'button' });
      button.innerHTML = `${icon(iconName, 14)} ${esc(label)}`;
      button.addEventListener('click', handler);
      actions.append(button);
    };

    action(enabled ? 'Disable' : 'Enable', enabled ? 'pause' : 'play', () => {
      void extensionManager.setEnabled(extension.id, !enabled).then(() => {
        toast(enabled ? 'Extension disabled' : 'Extension enabled', 'ok');
      });
    });
    action('Check update', 'refresh', async () => {
      const result = await extensionManager.checkUpdate(extension.id);
      if (result.error) toast(result.error, 'warn');
      else if (result.available) toast(`Update available: ${result.commit?.slice(0, 7)} — install again to review`, 'info');
      else toast('Already up to date', 'ok');
    });
    action('Uninstall', 'trash', () => {
      void extensionManager.uninstall(extension.id).then(() => toast('Extension removed', 'ok'));
    }, true);

    node.append(actions);
    return node;
  };

  const render = (extensions: InstalledExtension[]) => {
    listHost.innerHTML = '';
    if (extensions.length === 0) {
      listHost.append(
        notice('No extensions installed. Extensions are plain GitHub repositories — nothing runs on a server, everything happens in your browser.', 'info'),
      );
      return;
    }
    extensions.forEach((extension) => listHost.append(card(extension)));
  };

  /* ------------------------------------------------------------- install modal */

  const openInstall = () => {
    modalHost.innerHTML = '';
    const modal = el('div', { class: 'ext-modal' });
    modal.innerHTML = `
      <div class="ext-modal__card">
        <h2>Add extension from GitHub</h2>
        <p class="muted">Paste a repository URL, a folder URL, or a raw manifest.json URL.</p>
        <input class="input" id="ext-url" type="url" spellcheck="false"
          placeholder="https://github.com/you/extension" />
        <div class="ext-modal__body" id="ext-body"></div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn--primary" id="ext-review" type="button">Review</button>
          <button class="btn" id="ext-cancel" type="button">Cancel</button>
        </div>
      </div>`;
    modalHost.append(modal);

    const input = modal.querySelector<HTMLInputElement>('#ext-url')!;
    const body = modal.querySelector<HTMLElement>('#ext-body')!;
    const review = modal.querySelector<HTMLButtonElement>('#ext-review')!;
    const cancel = modal.querySelector<HTMLButtonElement>('#ext-cancel')!;

    cancel.addEventListener('click', () => {
      modalHost.innerHTML = '';
    });

    let preview: InstallPreview | null = null;

    review.addEventListener('click', async () => {
      if (preview) {
        // Second press = confirm install with the permissions the user saw.
        const granted = Array.from(body.querySelectorAll<HTMLInputElement>('input[data-perm]:checked')).map(
          (box) => box.dataset.perm as Permission,
        );
        const result = await extensionManager.install(preview, granted);
        if (!result.ok) {
          body.innerHTML = `<div class="ext-error">${esc(result.error ?? 'Install failed')}</div>`;
          return;
        }
        modalHost.innerHTML = '';
        toast('Extension installed — enable it when you are ready', 'ok');
        return;
      }

      review.disabled = true;
      body.innerHTML = '<p class="muted">Checking the repository…</p>';
      const result = await extensionManager.preview(input.value);
      review.disabled = false;

      if (!result.ok || !result.preview) {
        body.innerHTML = `<div class="ext-error">${esc(result.error ?? 'Could not read that manifest')}</div>`;
        return;
      }

      preview = result.preview;
      const manifest = preview.manifest;
      const permissions = manifest.permissions ?? [];
      body.innerHTML = `
        <div class="ext-review">
          <b>${esc(manifest.name)}</b> <span class="muted">v${esc(manifest.version)}</span>
          <p class="muted">${esc(manifest.description ?? '')}</p>
          <div class="ext-card__meta">
            <span>${esc(preview.source.owner)}/${esc(preview.source.repo)}</span>
            <span>commit ${esc(preview.commit.slice(0, 7))}</span>
            <span>${preview.files.length} files</span>
          </div>
          ${preview.warnings.map((warning) => `<div class="ext-warn">${esc(warning)}</div>`).join('')}
          <h3>Permissions requested</h3>
          ${
            permissions.length
              ? permissions
                  .map(
                    (permission) => `<label class="ext-perm">
                      <input type="checkbox" data-perm="${esc(permission)}" checked />
                      <span><b>${esc(permission)}</b><em>${esc(PERMISSION_COPY[permission] ?? '')}</em></span>
                    </label>`,
                  )
                  .join('')
              : '<p class="muted">This extension asks for no permissions.</p>'
          }
        </div>`;
      review.textContent = 'Install';
    });

    input.focus();
  };

  root.append(
    pageHead(
      'Extensions',
      'Install community extensions straight from GitHub. Everything runs sandboxed on your device — nothing is uploaded and no server is involved.',
      [addButton],
    ),
    listHost,
    modalHost,
  );

  void extensionManager.init().then(() => render(extensionManager.list()));
  const off = extensionManager.subscribe(render);

  return { el: root, destroy: () => off() };
}
