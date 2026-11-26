/**
 * Ghost trucks in the garage (see `src/sim/ghost.ts`): where they're kept
 * and how a stored or pasted one is checked before the game trusts it.
 *
 * They live in the save's `ghosts` record beside the rigs' last-run lines,
 * under their own keys, so the save format doesn't change:
 *
 *   best:<class>:<rig>     your best run on that loop
 *   friend:<class>:<rig>   a ghost pasted from a friend's code
 *
 * A career keeps its own best runs and last-run lines, filed under
 * `career<seed>:` in front of the key (Kelbo's playtest, 26 November 2026),
 * so free play's runs don't turn up in it. Friends' ghosts are shared.
 *
 * Pure: no DOM, no storage.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { SHOP_RIGS, type RigId } from '../data/rigs'
import type { FailureKind } from '../data/wear'
import type { GhostRun } from '../sim/ghost'
import { readBuild } from './save'

export type GhostSource = 'best' | 'friend'

export const GHOST_SOURCES: readonly GhostSource[] = ['best', 'friend']

/** The two loops a ghost can drive (the shaker has nothing to race). */
export const GHOST_RIGS: readonly RigId[] = SHOP_RIGS.filter((r): r is RigId => r !== 'shaker')

const FAILURES: readonly FailureKind[] = ['fade', 'bottoming', 'mount', 'axle', 'tire', 'frame']
const CLASS_IDS = CLASSES.map((c) => c.id)

export function ghostKey(source: GhostSource, cls: ClassId, rig: RigId): string {
  return `${source}:${cls}:${rig}`
}

const SCOPE = /^(career-?\d+):/

/** Where a career files its own ghosts and last-run lines; '' (free play) with no career. */
export function careerScope(seed: number | null | undefined): string {
  return seed === null || seed === undefined ? '' : `career${seed}`
}

/** A key filed under a scope ('' leaves it as it is). */
export function scoped(scope: string, key: string): string {
  return scope ? `${scope}:${key}` : key
}

/** The scope a stored key is filed under: '' for free play. */
export function scopeOf(key: string): string {
  return SCOPE.exec(key)?.[1] ?? ''
}

/** The key without its scope. */
export function unscoped(key: string): string {
  return key.replace(SCOPE, '')
}

/** Is this key one of ours (so the shop's last-run lines leave it alone)? */
export function isGhostKey(key: string): boolean {
  return GHOST_SOURCES.some((s) => unscoped(key).startsWith(`${s}:`))
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A stored or pasted ghost, or null if anything about it doesn't check out. */
export function readGhostRun(raw: unknown): GhostRun | null {
  if (!isObj(raw)) return null
  const cls = raw.cls as ClassId
  const rig = raw.rig as RigId
  if (!CLASS_IDS.includes(cls) || !GHOST_RIGS.includes(rig)) return null
  if (!finite(raw.distance) || raw.distance < 0 || !finite(raw.lastSpeed) || raw.lastSpeed < 0) return null
  if (!finite(raw.laps) || !Number.isInteger(raw.laps) || raw.laps < 0) return null
  if (!finite(raw.corner) || !Number.isInteger(raw.corner) || raw.corner < -1 || raw.corner > 3) return null
  const broken = raw.broken
  if (broken !== null && !FAILURES.includes(broken as FailureKind)) return null
  try {
    const build = readBuild(raw.build, cls)
    return { cls, rig, build, distance: raw.distance, laps: raw.laps, broken: broken as FailureKind | null, corner: raw.corner, lastSpeed: raw.lastSpeed }
  } catch {
    return null
  }
}
