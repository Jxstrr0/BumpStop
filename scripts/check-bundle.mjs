#!/usr/bin/env node
// Adapted from Mainline scripts/check-bundle.mjs (25 November 2026)
/**
 * First-load guard. Runs after `vite build` (npm's postbuild) and fails the
 * build when dist/ grows past a 15 MiB first-load budget (the same as
 * Mainline's). For now the whole of dist/ loads up front, so the check
 * simply adds up every file. When the truck models (plan PR 5) and sounds
 * (plan PR 6) arrive and load on demand, add their folders to ON_DEMAND so
 * only the first screen's files count.
 * Sizes are on disk, uncompressed (GitHub Pages gzips JS and CSS).
 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const DIST = 'dist'
const LIMIT_MIB = 15
const LIMIT = LIMIT_MIB * 1024 * 1024

/** Folders that load on demand, not on the first screen. */
const ON_DEMAND = new Set([
  // The Blender truck kit (plan PR 5): loaded when a 3D view first opens.
  path.join(DIST, 'models'),
])

async function walk(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (ON_DEMAND.has(p)) continue
    total += entry.isDirectory() ? await walk(p) : (await stat(p)).size
  }
  return total
}

const total = await walk(DIST)
const mib = (total / 1024 / 1024).toFixed(2)
if (total > LIMIT) {
  console.error(`check-bundle: dist is ${mib} MiB, over the ${LIMIT_MIB} MiB first-load budget.`)
  process.exit(1)
}
console.log(`check-bundle: dist is ${mib} MiB (budget ${LIMIT_MIB} MiB).`)
