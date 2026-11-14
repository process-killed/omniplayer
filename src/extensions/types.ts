/**
 * Public extension contracts.
 *
 * Everything an extension can touch is described here. The runtime never hands
 * an extension a live application object — only these shapes, over a message
 * bridge, so an extension cannot reach the DOM, storage or other extensions.
 */

export type Capability =
  | 'ui.pages'
  | 'ui.navigation'
  | 'ui.panels'
  | 'ui.playerActions'
  | 'ui.contextMenu'
  | 'ui.widgets'
  | 'ui.themes'
  | 'player.hooks'
  | 'subtitle.processors'
  | 'media.processors'
  | 'audio.processors'
  | 'video.processors'
  | 'network';

export type Permission =
  | 'ui.register'
  | 'player.read'
  | 'player.control'
  | 'subtitle.read'
  | 'subtitle.write'
  | 'storage.local'
  | 'storage.files'
  | 'network.fetch'
  | 'download.save'
  | 'worker.spawn';

export interface ManifestAuthor {
  name: string;
  github?: string;
}

export interface ManifestRepository {
  type: 'github';
  url: string;
}

export interface ManifestEntry {
  main: string;
  type?: 'module' | 'classic';
}

export interface ManifestFiles {
  scripts?: string[];
  styles?: string[];
  workers?: string[];
  wasm?: string[];
  assets?: string[];
}

export interface ManifestCompatibility {
  omniplayer?: string;
  api?: string;
}

export interface ManifestContribution {
  id: string;
  title?: string;
  icon?: string;
  route?: string;
  command?: string;
  [key: string]: unknown;
}

export interface ManifestContributions {
  navigation?: ManifestContribution[];
  pages?: ManifestContribution[];
  playerActions?: ManifestContribution[];
  panels?: ManifestContribution[];
  themes?: ManifestContribution[];
  settings?: ManifestContribution[];
  contextMenu?: ManifestContribution[];
  shortcuts?: Array<{ id: string; keys: string; title?: string }>;
}

export interface ManifestSetting {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  title: string;
  description?: string;
  default?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface ManifestRuntime {
  environment?: 'worker' | 'main' | 'sandbox';
  timeout?: number;
  maxMemoryMB?: number;
  network?: 'deny-by-default' | 'allow-listed';
}

/** The on-disk manifest.json format (manifestVersion 1). */
export interface ExtensionManifest {
  $schema?: string;
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  author?: ManifestAuthor;
  repository?: ManifestRepository;
  license?: string;
  homepage?: string;
  category?: string[];
  tags?: string[];
  compatibility?: ManifestCompatibility;
  entry: ManifestEntry;
  files?: ManifestFiles;
  capabilities?: Capability[];
  permissions?: Permission[];
  contributions?: ManifestContributions;
  settings?: ManifestSetting[];
  runtime?: ManifestRuntime;
  lifecycle?: { activate?: boolean; deactivate?: boolean };
  /** Optional integrity map: repo path → sha256 hex. */
  integrity?: Record<string, string>;
}

export type ExtensionState = 'installed' | 'enabled' | 'disabled' | 'error';

export interface InstalledExtension {
  id: string;
  manifest: ExtensionManifest;
  /** Immutable commit the files were fetched from. */
  commit: string;
  owner: string;
  repo: string;
  branch: string;
  /** Repository path prefix, e.g. "extensions/foo". */
  basePath: string;
  installedAt: number;
  updatedAt: number;
  state: ExtensionState;
  granted: Permission[];
  lastError?: string;
}

export interface ExtensionFile {
  id: string;
  path: string;
  mime: string;
  blob: Blob;
}

/** Messages the sandboxed extension frame may send to the host. */
export type ExtensionRequest =
  | { type: 'ready' }
  | { type: 'log'; level: 'info' | 'warn' | 'error' | 'debug'; message: string }
  | { type: 'ui.registerNavigation'; item: { id: string; title: string; icon?: string } }
  | { type: 'ui.registerPage'; page: { id: string; title: string; html?: string } }
  | { type: 'storage.get'; key: string }
  | { type: 'storage.set'; key: string; value: unknown }
  | { type: 'storage.delete'; key: string }
  | { type: 'player.getState' }
  | { type: 'player.command'; command: 'play' | 'pause' | 'seek'; value?: number }
  | { type: 'notify'; message: string; kind?: 'info' | 'warn' | 'err' | 'ok' };

export type HostResponse =
  | { type: 'ack'; requestId?: number; result?: unknown }
  | { type: 'error'; requestId?: number; message: string };
