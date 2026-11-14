import { describe, expect, it } from 'vitest';
import { parseGitHubSource, rawFileUrl, sourceKey } from '../src/extensions/github/resolve';
import { isSafeRelativePath, validateManifest } from '../src/extensions/manifest/validate';

const base = {
  manifestVersion: 1,
  id: 'com.example.hello',
  name: 'Hello',
  version: '1.0.0',
  entry: { main: './src/index.js', type: 'module' },
  permissions: ['ui.register'],
  capabilities: ['ui.pages'],
};

describe('github source parsing', () => {
  it('accepts repository, tree and raw manifest urls', () => {
    expect(parseGitHubSource('https://github.com/me/ext')).toMatchObject({ owner: 'me', repo: 'ext', basePath: '', manifestPath: 'manifest.json' });
    expect(parseGitHubSource('https://github.com/me/ext/tree/dev')).toMatchObject({ owner: 'me', repo: 'ext', ref: 'dev' });
    expect(parseGitHubSource('https://github.com/me/ext/tree/main/packages/foo')).toMatchObject({ basePath: 'packages/foo', manifestPath: 'packages/foo/manifest.json' });
    expect(
      parseGitHubSource('https://raw.githubusercontent.com/me/ext/main/manifest.json'),
    ).toMatchObject({ owner: 'me', repo: 'ext', ref: 'main', rawManifest: true });
  });

  it('understands refs/heads and refs/tags raw urls', () => {
    const heads = parseGitHubSource('https://raw.githubusercontent.com/me/ext/refs/heads/main/manifest.json');
    expect(heads).toMatchObject({ owner: 'me', repo: 'ext', ref: 'main', basePath: '', manifestPath: 'manifest.json' });
    const tags = parseGitHubSource('https://raw.githubusercontent.com/me/ext/refs/tags/v1/manifest.json');
    expect(tags).toMatchObject({ ref: 'v1' });
    const nested = parseGitHubSource('https://raw.githubusercontent.com/me/ext/refs/heads/main/packages/ui/manifest.json');
    expect(nested).toMatchObject({ basePath: 'packages/ui', manifestPath: 'packages/ui/manifest.json' });
  });

  it('rejects anything that is not GitHub', () => {
    expect(parseGitHubSource('https://evil.example.com/me/ext')).toBeNull();
    expect(parseGitHubSource('https://cdn.jsdelivr.net/npm/pkg')).toBeNull();
    expect(parseGitHubSource('not a url')).toBeNull();
    expect(parseGitHubSource('https://github.com/me')).toBeNull();
  });

  it('builds commit-pinned raw urls', () => {
    expect(rawFileUrl('me', 'ext', 'abc123', './src/index.js')).toBe('https://raw.githubusercontent.com/me/ext/abc123/src/index.js');
    expect(sourceKey({ owner: 'me', repo: 'ext', basePath: 'pkg' } as never)).toBe('me/ext/pkg');
  });
});

describe('manifest validation', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validateManifest(base);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects unsafe or remote paths', () => {
    expect(validateManifest({ ...base, entry: { main: '../../etc/passwd' } }).ok).toBe(false);
    expect(validateManifest({ ...base, entry: { main: 'https://evil.example/x.js' } }).ok).toBe(false);
    expect(validateManifest({ ...base, files: { scripts: ['./src/../../x.js'] } }).ok).toBe(false);
    expect(isSafeRelativePath('./src/index.js')).toBe(true);
    expect(isSafeRelativePath('/abs/path.js')).toBe(false);
  });

  it('rejects unknown permissions and missing capability permissions', () => {
    expect(validateManifest({ ...base, permissions: ['root.everything'] }).ok).toBe(false);
    expect(validateManifest({ ...base, permissions: [], capabilities: ['ui.pages'] }).ok).toBe(false);
  });

  it('requires semver, id shape and a js entry', () => {
    expect(validateManifest({ ...base, version: '1.0' }).ok).toBe(false);
    expect(validateManifest({ ...base, id: 'x' }).ok).toBe(false);
    expect(validateManifest({ ...base, entry: { main: './src/index.css' } }).ok).toBe(false);
    expect(validateManifest({ ...base, manifestVersion: 2 }).ok).toBe(false);
  });

  it('warns instead of failing on compatibility', () => {
    const result = validateManifest({ ...base, compatibility: { omniplayer: '>=99.0.0' } }, { hostVersion: '1.24.0' });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('requires OmniPlayer');
  });
});
