import { defineConfig, type Plugin } from 'vite';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Emits `sw.js` after the bundle is written, with the real hashed asset list
 * baked in. That is what makes the app open offline — no stale guesses, no
 * runtime discovery of filenames that changed.
 */
function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';

  return {
    name: 'omniplay-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const buildId = Date.now().toString(36);
      // Read what actually landed on disk: Vite emits the CSS asset after the
      // bundle hook, so scanning the filesystem is the only reliable source.
      const collect = async (dir: string, prefix: string): Promise<string[]> => {
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          const files: string[] = [];
          for (const entry of entries) {
            if (entry.isDirectory()) {
              files.push(...(await collect(join(dir, entry.name), `${prefix}${entry.name}/`)));
            } else if (/\.(js|css|png|svg|webmanifest|ico|txt|woff2?)$/.test(entry.name)) {
              files.push(`${prefix}${entry.name}`);
            }
          }
          return files;
        } catch {
          return [];
        }
      };
      const assets = (await collect(outDir, './')).filter((file) => !file.endsWith('sw.js'));
      const precache = Array.from(new Set(['./', './index.html', ...assets]));

      const source = `/* OmniPlay service worker — generated ${new Date().toISOString()} */
const VERSION = 'omniplay-${buildId}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      // Cache what we can; a single 404 must not break installation.
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      // First install activates immediately; updates wait for the user.
      if (!self.registration.active) await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;

  // Navigations: network first so a new build is picked up, cache as fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('./index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) || (await caches.match('./')) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response.clone())).catch(() => undefined);
          })
          .catch(() => undefined);
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok && ['script', 'style', 'image', 'font'].includes(request.destination)) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => Response.error());
    }),
  );
});
`;
      await writeFile(join(outDir, 'sw.js'), source, 'utf8');
      console.log(`\n  sw.js precached ${precache.length} files (build ${buildId})\n`);
    },
  };
}

export default defineConfig({
  // Absolute base: SPA deep links (/#/embed) and Cloudflare Pages sub-paths
  // resolve assets correctly, and a relative './' base breaks them.
  base: '/',
  plugins: [serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Heavy streaming + demuxing libraries are only fetched when an engine
        // actually needs them, so they must stay in their own chunks.
        manualChunks(id) {
          if (id.includes('node_modules/hls.js')) return 'engine-hls';
          if (id.includes('node_modules/dashjs')) return 'engine-dash';
          if (id.includes('node_modules/mediabunny')) return 'engine-webcodecs';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
});
