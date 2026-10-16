// Vite plugin: writes dist/sw.js after each build. The worker precaches the whole
// app (index.html and every built asset) under a cache named for this build, so the
// installed app opens offline; a new build changes the file, which is how browsers
// notice an update.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const worker = (version, files) => `// Generated at build time. Do not edit.
const CACHE = 'takeoff-ai-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('takeoff-ai-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks the waiting worker to take over when the user chooses to update.
self.addEventListener('message', (event) => {
  if (event.data === 'update-now') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only the app itself is cached; the AI service (api/) always goes to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    // The app shell from this build's cache, so the page and its assets always match.
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`;

export function serviceWorker() {
  let outDir = 'dist';
  return {
    name: 'takeoff-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const assets = readdirSync(join(outDir, 'assets')).filter((f) => !f.endsWith('.map'));
      const files = ['./', './index.html', './manifest.webmanifest', './icon.svg', ...assets.map((f) => `./assets/${f}`)];
      writeFileSync(join(outDir, 'sw.js'), worker(Date.now().toString(36), files));
    },
  };
}
