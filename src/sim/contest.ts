/**
 * One-day events (`src/data/contests.ts`): the sums behind them.
 *
 * Your truck runs the event's course through the full ride sim, exactly like
 * a rig on the test track (`laps.ts`): the course is turned into a one-lap
 * rig whose pieces carry the speed the driver takes each one at. So a break
 * on the hill climb is the same break the torture loop would show, with the
 * same trace and the same fix.
 *
 * The rivals are quick seeded estimates, like a raid's (`rivals.ts`): the
 * same event always gives them the same runs, so a second go is fair.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { HILL_CLIMB, type Contest } from '../data/contests'
import { STEADY_KMH, type DriverId, type PaceId, type Rival } from '../data/raids'
import type { Rig } from '../data/rigs'
import type { BuiltTruck } from './build'
import { detPow } from './det'
import type { LapRun } from './laps'
import { groundSpeed, lineFactor, powerRatio } from './raid'
import { hashString, Rng } from './rng'
import type { BreakEvent } from './wear'

const KMH = 1 / 3.6

/** Every entry in a class drives the same course: the event's seed, one road per class. */
export function courseSeed(contest: Contest, cls: ClassId): number {
  return contest.seed * 10 + CLASSES.findIndex((c) => c.id === cls) + 1
}

/** The course's whole length (m). */
export function courseLength(contest: Contest): number {
  return contest.course.reduce((sum, p) => sum + p.length, 0)
}

// ── The hill climb ──

/** How much of its usual speed this truck keeps going uphill (a share, from power-to-weight). */
export function climbFactor(truck: BuiltTruck): number {
  const k = HILL_CLIMB.climbShare * detPow(powerRatio(truck), HILL_CLIMB.powerExponent)
  return Math.min(HILL_CLIMB.climbLimits[1], Math.max(HILL_CLIMB.climbLimits[0], k))
}

/** The speed the driver takes each piece of the course at, on this pace call (m/s). */
export function courseSpeeds(contest: Contest, truck: BuiltTruck, driver: DriverId, pace: PaceId): number[] {
  const k = climbFactor(truck) * HILL_CLIMB.sprint
  return contest.course.map((p) => groundSpeed(truck, driver, p.ground, pace) * k)
}

/**
 * The course as a one-lap rig for `laps.ts`. The lap's speed is 1 m/s and
 * each piece's `pace` is its real speed, so each piece runs at its own speed.
 */
export function courseRig(contest: Contest, speeds: readonly number[]): Rig {
  return {
    id: `course:${contest.id}`,
    pieces: contest.course.map((p, i) => ({ ground: p.ground, length: p.length, pace: speeds[i] as number })),
    startSpeed: 1,
    speedStep: 0,
    maxLaps: 1,
  }
}

/** One of your runs, scored. */
export interface ContestRun {
  pace: PaceId
  /** Seconds to the top, or null if something broke on the way. */
  time: number | null
  /** What broke (the run stops there), or null. */
  broken: BreakEvent | null
  /** Bottom-outs on the way (each corner counts). */
  bottomOuts: number
  /** Seconds the bottom-outs cost. */
  lost: number
}

/** Score a finished run: the time the speeds give, plus the driver lifting after every bottom-out. */
export function scoreRun(contest: Contest, run: LapRun, speeds: readonly number[], driver: DriverId, pace: PaceId): ContestRun {
  const bottomOuts = run.laps.reduce((sum, lap) => sum + lap.bottomOuts, 0)
  const lost = bottomOuts * HILL_CLIMB.bottomOutCost
  if (run.broken) return { pace, time: null, broken: run.broken, bottomOuts, lost }
  const clean = contest.course.reduce((sum, p, i) => sum + (p.length / (speeds[i] as number)) * lineFactor(driver, p.ground), 0)
  return { pace, time: clean + lost, broken: null, bottomOuts, lost }
}

/** The course's par time: the stock truck at Steady with an average driver, sprinting uphill, no bottom-outs (s). */
export function coursePar(contest: Contest, cls: ClassId): number {
  return contest.course.reduce((sum, p) => sum + p.length / (STEADY_KMH[cls][p.ground] * KMH * HILL_CLIMB.climbShare * HILL_CLIMB.sprint), 0)
}

/** A rival's runs at an event: each run's time, or null where they didn't make the top. */
export interface RivalRuns {
  id: string
  runs: (number | null)[]
}

/** Every rival's runs at the event, the same every time for the same event and class. */
export function rivalRuns(contest: Contest, cls: ClassId, field: readonly Rival[]): RivalRuns[] {
  const par = coursePar(contest, cls)
  const seed = courseSeed(contest, cls)
  return field.map((rival) => {
    const runs: (number | null)[] = []
    for (let k = 0; k < contest.runs; k++) {
      const rng = new Rng(hashString(`${seed}:${rival.id}:${k}`))
      const clean = par * rival.pace * HILL_CLIMB.rivalPace * (1 + rival.spread * rng.range(-1, 1))
      const bottoms = Math.round(rng.range(0, rival.risk * HILL_CLIMB.rivalBottoms))
      runs.push(rng.chance(rival.risk * HILL_CLIMB.rivalRisk) ? null : clean + bottoms * HILL_CLIMB.bottomOutCost)
    }
    return { id: rival.id, runs }
  })
}

/** The best of some runs, or null if none of them made it. */
export function bestOf(runs: readonly (number | null)[]): number | null {
  let best: number | null = null
  for (const r of runs) if (r !== null && (best === null || r < best)) best = r
  return best
}

export interface ContestStanding {
  /** 'you' or the rival's id. */
  who: string
  /** Best time so far, or null if no run has made it yet. */
  best: number | null
}

/**
 * The standings after the first `runs` runs: the quickest best time first,
 * and anyone without a finished run at the bottom (you above rivals there).
 */
export function contestStandings(mine: readonly ContestRun[], rivals: readonly RivalRuns[], runs: number): ContestStanding[] {
  const rows: ContestStanding[] = [
    { who: 'you', best: bestOf(mine.slice(0, runs).map((r) => r.time)) },
    ...rivals.map((r) => ({ who: r.id, best: bestOf(r.runs.slice(0, runs)) })),
  ]
  return rows.sort((a, b) => (a.best === null ? (b.best === null ? 0 : 1) : b.best === null ? -1 : a.best - b.best))
}
