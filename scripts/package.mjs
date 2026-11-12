/**
 * Packages the project into a distributable zip:
 *   omniplay-universal-player.zip
 *     omniplay/            full source, docs, tests, scripts, lockfile
 *     omniplay/dist/       ready-to-serve production build
 *
 * Usage: npm run zip
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const STAGE = join(ROOT, 'packaging', 'omniplay');
const OUT = join(ROOT, 'packaging', 'omniplay-universal-player.zip');

const EXCLUDE = new Set(['node_modules', '.git', 'shots', 'smoke-tmp', 'packaging', 'dist']);

async function copyTree(from, to, filter) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (filter(entry)) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target, filter);
    else if (entry.isFile()) await cp(source, target);
  }
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('No dist/ build found. Run "npm run build" first.');
    process.exit(1);
  }
  await rm(join(ROOT, 'packaging'), { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  await copyTree(ROOT, STAGE, (entry) => EXCLUDE.has(entry.name) || entry.name.endsWith('.log') || entry.name === '.DS_Store');
  // Ship the production build as well, so the zip is immediately usable.
  await cp(join(ROOT, 'dist'), join(STAGE, 'dist'), { recursive: true });

  execFileSync('zip', ['-r', '-q', '-9', OUT, 'omniplay'], { cwd: join(ROOT, 'packaging') });

  const info = await stat(OUT);
  const files = execFileSync('unzip', ['-l', OUT]).toString().trim().split('\n').slice(-1)[0];
  console.log(`created ${OUT} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(files.trim());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
