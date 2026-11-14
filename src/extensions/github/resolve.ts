/**
 * GitHub source resolution.
 *
 * Only github.com and raw.githubusercontent.com are accepted. Everything is
 * pinned to an immutable commit SHA before a single file is downloaded, so an
 * extension cannot silently change under the user's feet.
 */

export interface GitHubSource {
  owner: string;
  repo: string;
  /** Branch or tag, when known from the URL. */
  ref: string;
  /** Repository path to the manifest's directory ('' for the repo root). */
  basePath: string;
  /** True when the user pasted a raw manifest URL. */
  rawManifest: boolean;
  manifestPath: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** Parse any of the accepted GitHub URL shapes. Returns null when invalid. */
export function parseGitHubSource(input: string): GitHubSource | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.toLowerCase();

  // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
  // The ref may itself be "refs/heads/main" or "refs/tags/v1", which GitHub
  // emits in its own copy-link button — handle both shapes.
  if (host === 'raw.githubusercontent.com') {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 4) return null;
    const [owner, repo, ...tail] = parts;
    let ref: string;
    let rest: string[];
    if (tail[0] === 'refs' && (tail[1] === 'heads' || tail[1] === 'tags') && tail.length >= 4) {
      ref = tail[2];
      rest = tail.slice(3);
    } else {
      ref = tail[0];
      rest = tail.slice(1);
    }
    if (!OWNER.test(owner) || !REPO.test(repo)) return null;
    const manifestPath = rest.join('/');
    if (!manifestPath.endsWith('manifest.json')) return null;
    return {
      owner,
      repo,
      ref,
      basePath: manifestPath.replace(/\/?manifest\.json$/, ''),
      rawManifest: true,
      manifestPath,
    };
  }

  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return null;
  const [owner, repoRaw] = parts;
  const repo = repoRaw.replace(/\.git$/, '');
  if (!OWNER.test(owner) || !REPO.test(repo)) return null;

  // /owner/repo            → default branch, root manifest
  // /owner/repo/tree/ref   → branch, root manifest
  // /owner/repo/blob/ref/path/manifest.json
  let ref = '';
  let basePath = '';
  let manifestPath = 'manifest.json';

  if (parts[2] === 'tree' && parts[3]) {
    ref = parts[3];
    basePath = parts.slice(4).join('/');
    manifestPath = basePath ? `${basePath}/manifest.json` : 'manifest.json';
  } else if (parts[2] === 'blob' && parts[3]) {
    ref = parts[3];
    const path = parts.slice(4).join('/');
    if (!path.endsWith('manifest.json')) return null;
    basePath = path.replace(/\/?manifest\.json$/, '');
    manifestPath = path;
  }

  return { owner, repo, ref, basePath, rawManifest: false, manifestPath };
}

export function repoUrl(source: { owner: string; repo: string }): string {
  return `https://github.com/${source.owner}/${source.repo}`;
}

/** Normalised, comparable extension source key. */
export function sourceKey(source: GitHubSource): string {
  return `${source.owner}/${source.repo}/${source.basePath}`;
}

/**
 * Resolve a branch/tag to an immutable commit SHA using the public GitHub API.
 * Falls back to the ref as-is when the API is rate-limited, and the caller
 * treats that as "unpinned" so the UI can warn.
 */
export async function resolveCommit(owner: string, repo: string, ref: string): Promise<{ commit: string; pinned: boolean }> {
  const target = ref || 'HEAD';
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(target)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.ok) {
      const data = (await response.json()) as { sha?: string };
      if (data.sha) return { commit: data.sha, pinned: true };
    }
  } catch {
    /* offline or blocked — fall through */
  }
  return { commit: ref || 'main', pinned: false };
}

/** Raw URL for one file at an exact commit. */
export function rawFileUrl(owner: string, repo: string, commit: string, path: string): string {
  const clean = path.replace(/^\.?\//, '');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${clean}`;
}
