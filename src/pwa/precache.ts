/**
 * What the offline copy keeps (plan PR 12). Pure, so the build step and the
 * tests share it. The build (`bumpStopServiceWorker` in vite.config.ts)
 * lists every file in dist/, keeps the ones below, and names the cache after
 * a hash of their contents, so a new deploy gets a fresh cache and the old
 * one goes.
 *
 * Every cache this game makes starts `bumpstop-` (checked free in studio
 * section 5), and the worker only ever deletes caches with that prefix:
 * other Longlight games may share the origin (jxstrr0.github.io), and their
 * offline copies are theirs.
 *
 * Adapted from Laminar src/pwa/precache.ts (26 November 2026).
 */

/** Every cache name starts with this. */
export const CACHE_PREFIX = 'bumpstop-'

/** The cache for one build: `bumpstop-` plus the first 10 characters of its hash. */
export function cacheName(hash: string): string {
  return `${CACHE_PREFIX}${hash.slice(0, 10)}`
}

/**
 * The files to fetch when the worker installs, from every path in dist/
 * (forward slashes, relative). Everything the game needs is small (the three
 * zipped trucks are about 600 KB together), so it all goes in up front,
 * models included: a truck you've never looked at still shows with no
 * signal. Left out: the worker itself, the CNAME file, source maps and the
 * older `.woff` fonts (every phone that runs the game reads `.woff2`).
 */
export function precacheList(paths: readonly string[]): string[] {
  return paths
    .filter((p) => p !== 'sw.js' && p !== 'CNAME')
    .filter((p) => !p.endsWith('.map') && !p.endsWith('.woff'))
    .slice()
    .sort()
}

/** Old caches to delete when a new worker takes over: ours only, never another game's. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== current)
}
