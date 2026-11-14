/**
 * Manifest validation — hand-written, no schema library, so the bundle stays
 * small and the error messages can name the exact field.
 */
import type { Capability, ExtensionManifest, Permission } from '../types';

const ID = /^[a-z0-9](?:[a-z0-9._-]{1,80})$/i;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const KNOWN_CAPABILITIES: Capability[] = [
  'ui.pages', 'ui.navigation', 'ui.panels', 'ui.playerActions', 'ui.contextMenu',
  'ui.widgets', 'ui.themes', 'player.hooks', 'subtitle.processors',
  'media.processors', 'audio.processors', 'video.processors', 'network',
];

export const KNOWN_PERMISSIONS: Permission[] = [
  'ui.register', 'player.read', 'player.control', 'subtitle.read', 'subtitle.write',
  'storage.local', 'storage.files', 'network.fetch', 'download.save', 'worker.spawn',
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: ExtensionManifest;
}

/** Reject paths that could escape the extension folder or fetch remote code. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 300) return false;
  if (/^[a-z]+:/i.test(path)) return false;          // absolute URL
  if (path.startsWith('/')) return false;            // repo-root absolute
  if (path.split('/').includes('..')) return false;  // traversal
  if (path.includes('\\')) return false;
  return /^\.?\/?[A-Za-z0-9._\-/]+$/.test(path);
}

const ALLOWED_EXT = /\.(js|mjs|css|json|wasm|png|jpe?g|svg|webp|gif|txt|md|vtt|srt|woff2?)$/i;

export function validateManifest(input: unknown, options: { hostVersion?: string } = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (message: string) => errors.push(message);

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['manifest.json must be a JSON object'], warnings };
  }
  const m = input as Record<string, unknown>;

  if (m.manifestVersion !== 1) fail('manifestVersion must be 1');
  if (typeof m.id !== 'string' || !ID.test(m.id)) fail('id must be a reverse-domain style string (e.g. com.you.extension)');
  if (typeof m.name !== 'string' || m.name.trim().length < 1 || m.name.length > 60) fail('name must be 1–60 characters');
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) fail('version must be semver, e.g. 1.0.0');

  const entry = m.entry as { main?: unknown; type?: unknown } | undefined;
  if (!entry || typeof entry.main !== 'string') fail('entry.main is required');
  else if (!isSafeRelativePath(entry.main)) fail('entry.main must be a relative path inside the extension');
  else if (!/\.(js|mjs)$/i.test(entry.main)) fail('entry.main must be a .js or .mjs file');
  if (entry && entry.type && entry.type !== 'module' && entry.type !== 'classic') fail('entry.type must be "module" or "classic"');

  const files = (m.files ?? {}) as Record<string, unknown>;
  const fileGroups = ['scripts', 'styles', 'workers', 'wasm', 'assets'] as const;
  for (const group of fileGroups) {
    const list = files[group];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      fail(`files.${group} must be an array`);
      continue;
    }
    for (const file of list) {
      if (typeof file !== 'string' || !isSafeRelativePath(file)) {
        fail(`files.${group} contains an invalid path: ${String(file)}`);
        continue;
      }
      if (!ALLOWED_EXT.test(file)) fail(`files.${group} contains an unsupported file type: ${file}`);
    }
  }

  const capabilities = Array.isArray(m.capabilities) ? m.capabilities : [];
  for (const capability of capabilities) {
    if (!KNOWN_CAPABILITIES.includes(capability as Capability)) warnings.push(`unknown capability: ${String(capability)}`);
  }

  const permissions = Array.isArray(m.permissions) ? m.permissions : [];
  for (const permission of permissions) {
    if (!KNOWN_PERMISSIONS.includes(permission as Permission)) fail(`unknown permission: ${String(permission)}`);
  }

  // A capability without its permission is a bug in the extension.
  if (capabilities.includes('ui.pages') || capabilities.includes('ui.navigation')) {
    if (!permissions.includes('ui.register')) fail('capability ui.pages/ui.navigation requires the ui.register permission');
  }
  if (capabilities.includes('network') && !permissions.includes('network.fetch')) {
    fail('capability network requires the network.fetch permission');
  }

  const compatibility = (m.compatibility ?? {}) as Record<string, unknown>;
  if (compatibility.api && typeof compatibility.api === 'string' && !compatibility.api.startsWith('^1') && compatibility.api !== '1') {
    warnings.push(`declares API ${compatibility.api}; this build implements 1.x`);
  }
  if (compatibility.omniplayer && options.hostVersion) {
    const wanted = String(compatibility.omniplayer).replace(/[^0-9.]/g, '');
    if (wanted && compareVersions(options.hostVersion, wanted) < 0) {
      warnings.push(`requires OmniPlayer ${compatibility.omniplayer}, this build is ${options.hostVersion}`);
    }
  }

  if (!errors.length) {
    return { ok: true, errors, warnings, manifest: m as unknown as ExtensionManifest };
  }
  return { ok: false, errors, warnings };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
