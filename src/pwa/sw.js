/*
 * Bump Stop's offline worker (plan PR 12). The build (vite.config.ts,
 * bumpStopServiceWorker) puts this file at dist/sw.js with two lines in
 * front: the cache name for this build and the list of files to keep.
 *
 * - Install: fetch every file in the list into this build's cache.
 * - Wait: a new version waits until the player taps Reload on the
 *   "new version" bar (src/pwa/register.ts), so a run or a raid in progress
 *   never swaps files under itself.
 * - Activate: delete this game's old caches. Only names that start
 *   `bumpstop-` are touched; other Longlight games can share the origin.
 * - Fetch: the page itself and every built file come from the cache, so the
 *   game opens with no signal. The full-detail truck models are added to
 *   the cache as the game loads them. Anything else goes to the network
 *   untouched.
 *
 * Adapted from Laminar src/pwa/sw.js (26 November 2026).
 */
const CACHE = self.__BUMPSTOP_CACHE__
const FILES = self.__BUMPSTOP_FILES__
const PREFIX = 'bumpstop-'
// Match by address only. Servers add `Vary: Origin`, and the page's module
// scripts send an Origin header the install fetch didn't, so a strict match
// would miss every script and the game wouldn't open offline.
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so the files match this build.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  // Only this game's own files; anything else (the visit counter) goes to the network untouched.
  if (!req.url.startsWith(self.registration.scope)) return
  if (req.headers.has('range')) return

  if (req.mode === 'navigate') {
    // Any page in the game is index.html (?nosw, ?tier= and the rest are read by the game).
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match('index.html', MATCH))
        .then((hit) => hit || fetch(req)),
    )
    return
  }

  // The full-detail truck models aren't in the install list (a phone on the
  // Lite tier never needs them): keep each one the first time it's loaded.
  const keep = /\/models\/truck-[a-z0-9]+\.glb\.gz$/.test(new URL(req.url).pathname)
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, MATCH).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (keep && res.ok) cache.put(req, res.clone()).catch(() => {})
            return res
          }),
      ),
    ),
  )
})
