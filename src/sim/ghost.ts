/**
 * Ghost trucks (Kelbo asked, 26 November 2026): your best run on each test
 * loop, kept so you can race it, and shared with a friend as a short code.
 *
 * A ghost doesn't store a recording. The sim is fully deterministic (seeded
 * roads, no clocks, its own maths in `det.ts`), so the same build on the
 * same rig always drives exactly the same run, on any phone. A ghost is
 * just the build plus what happened (how far it got, what broke), and the
 * shop drives it again, step for step beside your truck, to show it in 3D.
 * That's why a ghost code is only a few hundred letters.
 *
 * On the loops every truck drives the same speeds (the rig sets them, lap
 * by lap), so a ghost race is about lasting: whoever keeps going longer
 * wins. Pure: no DOM, no storage.
 */
import type { ClassId } from '../data/classes'
import type { TruckBuild } from '../data/kit'
import type { RigId } from '../data/rigs'
import type { FailureKind } from '../data/wear'
import type { LapRun } from './laps'

/** Closer than this (m) counts as level: two trucks that both lasted every lap end at the same place. */
const LEVEL_GAP = 1

export interface GhostRun {
  cls: ClassId
  rig: RigId
  /** The truck as it was built for the run. */
  build: TruckBuild
  /** Metres it drove before it broke or the last lap ended. */
  distance: number
  /** Laps it started: the lap it broke on, or every lap. */
  laps: number
  /** What broke, or null if it lasted every lap. */
  broken: FailureKind | null
  /** The corner that broke (0 front left … 3 rear right), or -1 for the frame or nothing. */
  corner: number
  /** The speed of its last lap (m/s). */
  lastSpeed: number
}

/** A finished run on a loop, as a ghost. */
export function ghostFromRun(cls: ClassId, rig: RigId, build: TruckBuild, run: LapRun): GhostRun {
  const last = run.laps[run.laps.length - 1]
  return {
    cls,
    rig,
    build: structuredClone(build),
    distance: last?.endDistance ?? 0,
    laps: run.laps.length,
    broken: run.broken?.kind ?? null,
    corner: run.broken?.corner ?? -1,
    lastSpeed: last?.speed ?? 0,
  }
}

/** Is this run a new best? Only if it went further than the best so far (a tie keeps the old one). */
export function isNewBest(run: GhostRun, best: GhostRun | null): boolean {
  if (!best || best.cls !== run.cls || best.rig !== run.rig) return true
  return run.distance > best.distance + LEVEL_GAP
}

export type RaceOutcome = 'ahead' | 'behind' | 'level'

export interface RaceResult {
  outcome: RaceOutcome
  /** How much further the winner went (m); 0 when level. */
  gap: number
}

/** Your run against the ghost's: who lasted longer, and by how much. */
export function raceResult(mine: { distance: number }, ghost: { distance: number }): RaceResult {
  const gap = mine.distance - ghost.distance
  if (Math.abs(gap) <= LEVEL_GAP) return { outcome: 'level', gap: 0 }
  return { outcome: gap > 0 ? 'ahead' : 'behind', gap: Math.abs(gap) }
}
