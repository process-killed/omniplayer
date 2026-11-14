/**
 * ExtensionManager — install, validate, store, activate and remove extensions.
 *
 * The manager is the only module that talks to GitHub, IndexedDB and the
 * sandbox. Everything it exposes is plain data so the UI never touches runtime
 * objects.
 */
import type { ExtensionManifest, InstalledExtension, Permission } from '../types';
import { parseGitHubSource, rawFileUrl, resolveCommit, type GitHubSource } from '../github/resolve';
import { validateManifest } from '../manifest/validate';
import { extensionStore } from '../storage/store';
import { createSandbox, type ActiveSandbox } from '../runtime/sandbox';

export interface InstallPreview {
  source: GitHubSource;
  manifest: ExtensionManifest;
  commit: string;
  pinned: boolean;
  files: string[];
  warnings: string[];
  existing?: InstalledExtension;
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  extension?: InstalledExtension;
}

type Listener = (extensions: InstalledExtension[]) => void;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function mimeFor(path: string): string {
  if (/\.js$/i.test(path)) return 'text/javascript';
  if (/\.mjs$/i.test(path)) return 'text/javascript';
  if (/\.css$/i.test(path)) return 'text/css';
  if (/\.json$/i.test(path)) return 'application/json';
  if (/\.wasm$/i.test(path)) return 'application/wasm';
  if (/\.svg$/i.test(path)) return 'image/svg+xml';
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'application/octet-stream';
}

export class ExtensionManager {
  private installed = new Map<string, InstalledExtension>();
  private sandboxes = new Map<string, ActiveSandbox>();
  private listeners = new Set<Listener>();
  private logs: Array<{ id: string; level: string; message: string; at: number }> = [];
  /** Pages an extension registered at runtime: id → pages. */
  private pages = new Map<string, Array<{ id: string; title: string; html?: string }>>();
  private loaded = false;
  private hooks: {
    getPlayerState?: () => unknown;
    command?: (command: 'play' | 'pause' | 'seek', value?: number) => void;
    notify?: (message: string, kind?: string) => void;
    addNavigation?: (extensionId: string, item: { id: string; title: string; icon?: string }) => void;
  } = {};

  setHooks(hooks: NonNullable<ExtensionManager['hooks']>): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const records = await extensionStore.all<InstalledExtension>();
      for (const record of records) {
        this.installed.set(record.id, record);
      }
    } catch {
      /* private mode */
    }
    this.emit();
    // Restore extensions the user had enabled — the approval happened at install.
    for (const record of this.installed.values()) {
      if (record.state === 'enabled') void this.activate(record.id);
    }
  }

  list(): InstalledExtension[] {
    return [...this.installed.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => this.listeners.delete(listener);
  }

  /** Namespaced storage access for host-rendered extension pages. */
  kvGet(id: string, key: string): Promise<unknown> {
    return extensionStore.kvGet(id, key);
  }

  kvSet(id: string, key: string, value: unknown): Promise<void> {
    return extensionStore.kvSet(id, key, value);
  }

  /** Pages registered by an extension during its current activation. */
  pagesFor(id: string): Array<{ id: string; title: string; html?: string }> {
    return this.pages.get(id) ?? [];
  }

  /** Every page across active extensions, for the host router. */
  allPages(): Array<{ extensionId: string; id: string; title: string; html?: string }> {
    const out: Array<{ extensionId: string; id: string; title: string; html?: string }> = [];
    this.pages.forEach((pages, extensionId) => {
      pages.forEach((page) => out.push({ extensionId, ...page }));
    });
    return out;
  }

  logsFor(id: string): Array<{ level: string; message: string; at: number }> {
    return this.logs.filter((entry) => entry.id === id).slice(-200);
  }

  /** Step 1 of installation: fetch + validate the manifest, pin the commit. */
  async preview(input: string): Promise<{ ok: boolean; error?: string; preview?: InstallPreview }> {
    const source = parseGitHubSource(input);
    if (!source) {
      return { ok: false, error: 'Only github.com or raw.githubusercontent.com extension URLs are supported.' };
    }

    const { commit, pinned } = await resolveCommit(source.owner, source.repo, source.ref);
    const url = rawFileUrl(source.owner, source.repo, commit, source.manifestPath);

    let raw: string;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        return { ok: false, error: `manifest.json not found at ${source.manifestPath} (HTTP ${response.status})` };
      }
      raw = await response.text();
    } catch {
      return { ok: false, error: 'Could not reach GitHub. Check your connection and the repository URL.' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'manifest.json is not valid JSON.' };
    }

    const result = validateManifest(parsed, { hostVersion: '1.24.0' });
    if (!result.ok || !result.manifest) {
      return { ok: false, error: result.errors.join(' · ') };
    }

    const manifest = result.manifest;
    const files = [
      manifest.entry.main,
      ...(manifest.files?.scripts ?? []),
      ...(manifest.files?.styles ?? []),
      ...(manifest.files?.workers ?? []),
      ...(manifest.files?.wasm ?? []),
      ...(manifest.files?.assets ?? []),
      manifest.icon ?? '',
    ].filter(Boolean);

    const warnings = [...result.warnings];
    if (!pinned) warnings.push('GitHub API did not return a commit SHA — files are pinned to the branch name only.');

    return {
      ok: true,
      preview: {
        source,
        manifest,
        commit,
        pinned,
        files: Array.from(new Set(files)),
        warnings,
        existing: this.installed.get(manifest.id),
      },
    };
  }

  /** Step 2: download every declared file from the pinned commit and store it. */
  async install(preview: InstallPreview, granted: Permission[]): Promise<InstallResult> {
    const { source, manifest, commit } = preview;
    let total = 0;

    try {
      for (const path of preview.files) {
        const response = await fetch(rawFileUrl(source.owner, source.repo, commit, path), { cache: 'no-store' });
        if (!response.ok) {
          const hint =
            response.status === 404
              ? ` — the file is missing at commit ${commit.slice(0, 7)}. Check the exact path and letter case in manifest.json, and that you pushed the file to the branch you installed from.`
              : '';
          return { ok: false, error: `Could not download ${path} (HTTP ${response.status})${hint}` };
        }
        const blob = await response.blob();
        if (blob.size > MAX_FILE_BYTES) return { ok: false, error: `${path} is larger than 4 MB` };
        total += blob.size;
        if (total > MAX_TOTAL_BYTES) return { ok: false, error: 'Extension exceeds the 16 MB total limit' };

        await extensionStore.putFile({
          key: `${manifest.id}:${commit}:${path}`,
          id: manifest.id,
          commit,
          path,
          mime: mimeFor(path),
          blob,
        });
      }
    } catch {
      return { ok: false, error: 'Download failed part-way through. Nothing was installed.' };
    }

    const now = Date.now();
    const record: InstalledExtension = {
      id: manifest.id,
      manifest,
      commit,
      owner: source.owner,
      repo: source.repo,
      branch: source.ref || 'default',
      basePath: source.basePath,
      installedAt: preview.existing?.installedAt ?? now,
      updatedAt: now,
      state: 'installed',
      granted,
    };

    this.installed.set(record.id, record);
    await extensionStore.put(record as unknown as { id: string });
    this.emit();
    return { ok: true, extension: record };
  }

  async uninstall(id: string): Promise<void> {
    await this.deactivate(id);
    this.installed.delete(id);
    await extensionStore.remove(id);
    this.emit();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.installed.get(id);
    if (!record) return;
    if (enabled) await this.activate(id);
    else await this.deactivate(id);
  }

  /** Start the sandbox and let the extension register its contributions. */
  async activate(id: string): Promise<void> {
    const record = this.installed.get(id);
    if (!record || this.sandboxes.has(id)) return;

    const files = await extensionStore.filesFor(id, record.commit);
    const entry = files.find((file) => file.path.replace(/^\.\//, '') === record.manifest.entry.main.replace(/^\.\//, ''));
    if (!entry) {
      record.state = 'error';
      record.lastError = 'entry file is missing from storage';
      await extensionStore.put(record as unknown as { id: string });
      this.emit();
      return;
    }

    const code = await entry.blob.text();
    const sandbox = createSandbox(record, code, {
      onLog: (level, message) => {
        this.logs.push({ id, level, message, at: Date.now() });
        if (this.logs.length > 500) this.logs.splice(0, 200);
      },
      onNavigation: (item) => this.hooks.addNavigation?.(id, item),
      onPage: (page) => {
        const list = this.pages.get(id) ?? [];
        const next = list.filter((entry) => entry.id !== page.id);
        next.push({ id: page.id, title: page.title, html: page.html });
        this.pages.set(id, next);
        this.logs.push({ id, level: 'info', message: `page registered: ${page.title}`, at: Date.now() });
        this.emit();
      },
      onNotify: (message, kind) => this.hooks.notify?.(message, kind),
      getPlayerState: () => this.hooks.getPlayerState?.() ?? null,
      command: (command, value) => this.hooks.command?.(command, value),
      storageGet: (key) => extensionStore.kvGet(id, key),
      storageSet: (key, value) => extensionStore.kvSet(id, key, value),
      storageDelete: (key) => extensionStore.kvDelete(id, key),
    });

    this.sandboxes.set(id, sandbox);
    record.state = 'enabled';
    record.lastError = undefined;
    await extensionStore.put(record as unknown as { id: string });
    this.emit();
  }

  async deactivate(id: string): Promise<void> {
    const sandbox = this.sandboxes.get(id);
    if (sandbox) {
      sandbox.destroy();
      this.sandboxes.delete(id);
    }
    const record = this.installed.get(id);
    if (record && record.state === 'enabled') {
      record.state = 'installed';
      await extensionStore.put(record as unknown as { id: string });
      this.emit();
    }
  }

  /** Check GitHub for a newer commit without downloading anything. */
  async checkUpdate(id: string): Promise<{ available: boolean; commit?: string; error?: string }> {
    const record = this.installed.get(id);
    if (!record) return { available: false, error: 'not installed' };
    const { commit, pinned } = await resolveCommit(record.owner, record.repo, record.branch === 'default' ? '' : record.branch);
    if (!pinned) return { available: false, error: 'GitHub did not return a commit SHA' };
    return { available: commit !== record.commit, commit };
  }

  /** Listen for page registrations across all active extensions. */
  subscribePages(listener: (pages: Array<{ extensionId: string; id: string; title: string }>) => void): () => void {
    const wrapped = () => listener(this.allPages().map(({ extensionId, id, title }) => ({ extensionId, id, title })));
    this.pageListeners.add(wrapped);
    wrapped();
    return () => this.pageListeners.delete(wrapped);
  }

  private pageListeners = new Set<() => void>();

  private emit(): void {
    this.pageListeners.forEach((listener) => listener());
    const list = this.list();
    this.listeners.forEach((listener) => listener(list));
  }
}

export const extensionManager = new ExtensionManager();
