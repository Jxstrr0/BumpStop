/**
 * One-day events (`src/data/contests.ts`): the sums behind them.
 *
 * Your truck runs the event's course through the full ride sim, exactly like
 * a rig on the test track (`laps.ts`). The hill climb's course becomes a
 * one-lap rig whose pieces carry the speed the driver takes each one at; the
 * speed trial's is a loop driven faster every pass, like the washboard
 * ladder. So a break here is the same break the test track would show, with
 * the same trace and the same fix.
 *
 * The rivals are quick seeded estimates, like a raid's (`rivals.ts`): the
 * same event always gives them the same runs, so a second go is fair.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { HILL_CLIMB, JUMP_OFF, SPEED_TRIAL, type Contest, type ContestKind } from '../data/contests'
import { STEADY_KMH, type DriverId, type PaceId, type Rival } from '../data/raids'
import type { Rig } from '../data/rigs'
import type { BuiltTruck } from './build'
import { detPow } from './det'
import type { LandingScore } from './landing'
import type { LapRun } from './laps'
import { pushHarder } from './grudges'
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
  const timed = contest.timed!
  const k = (timed.climb ? climbFactor(truck) : 1) * timed.sprint
  return contest.course.map((p) => groundSpeed(truck, driver, p.ground, pace) * k)
}

/**
 * The course as a rig for `laps.ts`, one lap for each of the event's laps.
 * The lap's speed is 1 m/s and each piece's `pace` is its real speed, so
 * each piece runs at its own speed.
 */
export function courseRig(contest: Contest, speeds: readonly number[]): Rig {
  return {
    id: `course:${contest.id}`,
    pieces: contest.course.map((p, i) => ({ ground: p.ground, length: p.length, pace: speeds[i] as number })),
    startSpeed: 1,
    speedStep: 0,
    maxLaps: contest.timed?.laps ?? 1,
  }
}

/** One of your runs, scored. */
export interface ContestRun {
  pace: PaceId
  /**
   * The run's score, or null for none: seconds to the top on a hill climb
   * (null if something broke on the way), the fastest clean pass on a speed
   * trial (km/h; null if the first pass didn't come clean).
   */
  score: number | null
  /** What broke (the run stops there), or null. On a speed trial this is usually the fade that ended it. */
  broken: BreakEvent | null
  /** Bottom-outs on the way (each corner counts). */
  bottomOuts: number
  /** Seconds the bottom-outs cost. */
  lost: number
  /** A jump contest: the speed called (km/h), the landing as judged, and the points for distance. */
  kmh?: number
  landing?: LandingScore
  air?: number
}

/** Score a finished run: the time the speeds give, plus the driver lifting after every bottom-out. */
export function scoreRun(contest: Contest, run: LapRun, speeds: readonly number[], driver: DriverId, pace: PaceId): ContestRun {
  const bottomOuts = run.laps.reduce((sum, lap) => sum + lap.bottomOuts, 0)
  const lost = bottomOuts * HILL_CLIMB.bottomOutCost
  if (run.broken) return { pace, score: null, broken: run.broken, bottomOuts, lost }
  const lap = contest.course.reduce((sum, p, i) => sum + (p.length / (speeds[i] as number)) * lineFactor(driver, p.ground), 0)
  return { pace, score: lap * (contest.timed?.laps ?? 1) + lost, broken: null, bottomOuts, lost }
}

// ── The speed trial ──

/** The speed of pass `n` (1 for the first), in km/h. */
export function passKmh(contest: Contest, n: number): number {
  const p = contest.passes!
  return p.startKmh + (n - 1) * p.stepKmh
}

/** The mile as a loop for `laps.ts`: each pass is a lap, faster each time. */
export function passRig(contest: Contest): Rig {
  const p = contest.passes!
  return {
    id: `course:${contest.id}`,
    pieces: contest.course.map((c) => ({ ground: c.ground, length: c.length, pace: 1 })),
    startSpeed: p.startKmh * KMH,
    speedStep: p.stepKmh * KMH,
    maxLaps: p.most,
  }
}

/** Score a speed trial run: the fastest pass that came clean (the one something broke on doesn't count). */
export function scorePasses(contest: Contest, run: LapRun): ContestRun {
  const clean = run.broken ? run.laps.length - 1 : run.laps.length
  const bottomOuts = run.laps.reduce((sum, lap) => sum + lap.bottomOuts, 0)
  return { pace: 'steady', score: clean > 0 ? passKmh(contest, clean) : null, broken: run.broken, bottomOuts, lost: 0 }
}

// ── The jump contest ──

/** One attempt as a one-lap rig: the run-up, the tabletop and the run-out, at the speed called. */
export function jumpRig(contest: Contest, kmh: number): Rig {
  return {
    id: `course:${contest.id}`,
    pieces: contest.course.map((c) => ({ ground: c.ground, length: c.length, pace: 1, ...(c.table ? { table: c.table } : {}) })),
    startSpeed: kmh * KMH,
    speedStep: 0,
    maxLaps: 1,
  }
}

/** Score an attempt: the landing's points plus the crowd's for distance. Nothing if it broke or never jumped. */
export function scoreJump(run: LapRun, kmh: number): ContestRun {
  const landing = run.landings[0]
  const bottomOuts = run.laps.reduce((sum, lap) => sum + lap.bottomOuts, 0)
  const base = { pace: 'steady' as const, broken: run.broken, bottomOuts, lost: 0, kmh }
  if (run.broken || !landing || landing.spot === 'none') return { ...base, score: null, ...(landing ? { landing } : {}) }
  const air = Math.round(landing.flown * JUMP_OFF.perMetre)
  return { ...base, score: landing.score + air, landing, air }
}

// ── Any kind ──

/** The course as the rig the ride sim drives, for this kind of event (`kmh` is a jump contest's called speed). */
export function eventRig(contest: Contest, truck: BuiltTruck, driver: DriverId, pace: PaceId, kmh = 0): { rig: Rig; speeds: number[] } {
  if (contest.kind === 'topSpeed') return { rig: passRig(contest), speeds: [] }
  if (contest.kind === 'judged') return { rig: jumpRig(contest, kmh), speeds: [] }
  const speeds = courseSpeeds(contest, truck, driver, pace)
  return { rig: courseRig(contest, speeds), speeds }
}

/** Score a finished run, for this kind of event. */
export function scoreEvent(contest: Contest, run: LapRun, speeds: readonly number[], driver: DriverId, pace: PaceId, kmh = 0): ContestRun {
  if (contest.kind === 'topSpeed') return scorePasses(contest, run)
  if (contest.kind === 'judged') return scoreJump(run, kmh)
  return scoreRun(contest, run, speeds, driver, pace)
}

/** True if score `a` beats score `b` in this kind of event: quicker on a hill climb, more on the others. */
export function beats(kind: ContestKind, a: number, b: number): boolean {
  return kind === 'timed' ? a < b : a > b
}

/** The course's par time: the stock truck at Steady with an average driver, sprinting (uphill on a climb), every lap, no bottom-outs (s). */
export function coursePar(contest: Contest, cls: ClassId): number {
  const timed = contest.timed!
  const k = (timed.climb ? HILL_CLIMB.climbShare : 1) * timed.sprint
  return contest.course.reduce((sum, p) => sum + p.length / (STEADY_KMH[cls][p.ground] * KMH * k), 0) * timed.laps
}

/** A rival's runs at an event: each run's time, or null where they didn't make the top. */
export interface RivalRuns {
  id: string
  runs: (number | null)[]
}

/**
 * Every rival's runs at the event, the same every time for the same event
 * and class. `salt` makes each running different (the career's rounds);
 * free play leaves it out.
 */
export function rivalRuns(contest: Contest, cls: ClassId, angry: readonly Rival[], salt = ''): RivalRuns[] {
  // A driver with a grudge against you drives harder: quicker, more trouble (`grudges.ts`).
  const field = angry.map(pushHarder)
  if (contest.kind === 'topSpeed') return rivalPasses(contest, cls, field, salt)
  if (contest.kind === 'judged') return rivalJumps(contest, cls, field, salt)
  const par = coursePar(contest, cls)
  const seed = courseSeed(contest, cls)
  return field.map((rival) => {
    const runs: (number | null)[] = []
    for (let k = 0; k < contest.runs; k++) {
      const rng = new Rng(hashString(`${seed}:${rival.id}:${k}${salt}`))
      const timed = contest.timed!
      const clean = par * rival.pace * timed.rivalPace * (1 + rival.spread * rng.range(-1, 1))
      const bottoms = Math.round(rng.range(0, rival.risk * HILL_CLIMB.rivalBottoms * timed.laps))
      runs.push(rng.chance(rival.risk * timed.rivalRisk) ? null : clean + bottoms * HILL_CLIMB.bottomOutCost)
    }
    return { id: rival.id, runs }
  })
}

/**
 * A speed trial's rivals: the stock truck's top pass, better for the quicker
 * teams, wandering a little, and now and then a pass short with a break.
 */
function rivalPasses(contest: Contest, cls: ClassId, field: readonly Rival[], salt: string): RivalRuns[] {
  const p = contest.passes!
  const seed = courseSeed(contest, cls)
  const top = passKmh(contest, p.most)
  return field.map((rival) => {
    const runs: (number | null)[] = []
    for (let k = 0; k < contest.runs; k++) {
      const rng = new Rng(hashString(`${seed}:${rival.id}:${k}${salt}`))
      const aim = SPEED_TRIAL.stockTop[cls] + SPEED_TRIAL.kmhPerPace * (1 - rival.pace) * 100 + SPEED_TRIAL.wander * rival.spread * rng.range(-1, 1)
      let kmh = Math.min(top, p.startKmh + Math.floor((aim - p.startKmh) / p.stepKmh) * p.stepKmh)
      if (rng.chance(rival.risk * SPEED_TRIAL.rivalRisk)) kmh -= p.stepKmh
      runs.push(kmh >= p.startKmh ? kmh : null)
    }
    return { id: rival.id, runs }
  })
}

/** A jump contest's rivals: the stock best, more for the quicker teams, wandering, and now and then botched. */
function rivalJumps(contest: Contest, cls: ClassId, field: readonly Rival[], salt: string): RivalRuns[] {
  const seed = courseSeed(contest, cls)
  return field.map((rival) => {
    const runs: (number | null)[] = []
    for (let k = 0; k < contest.runs; k++) {
      const rng = new Rng(hashString(`${seed}:${rival.id}:${k}${salt}`))
      let points = JUMP_OFF.stockBest[cls] + JUMP_OFF.pointsPerPace * (1 - rival.pace) * 100 + JUMP_OFF.wander * rival.spread * rng.range(-1, 1)
      if (rng.chance(rival.risk * JUMP_OFF.rivalRisk)) points *= JUMP_OFF.botched
      runs.push(Math.round(points))
    }
    return { id: rival.id, runs }
  })
}

/** The best of some runs in this kind of event, or null if none of them scored. */
export function bestOf(runs: readonly (number | null)[], kind: ContestKind = 'timed'): number | null {
  let best: number | null = null
  for (const r of runs) if (r !== null && (best === null || beats(kind, r, best))) best = r
  return best
}

export interface ContestStanding {
  /** 'you' or the rival's id. */
  who: string
  /** Best score so far, or null if no run has scored yet. */
  best: number | null
}

/**
 * The standings after the first `runs` runs: the best score first, and
 * anyone without a score at the bottom (you above rivals there). Ties keep
 * you first.
 */
export function contestStandings(kind: ContestKind, mine: readonly Pick<ContestRun, 'score'>[], rivals: readonly RivalRuns[], runs: number): ContestStanding[] {
  const rows: ContestStanding[] = [
    { who: 'you', best: bestOf(mine.slice(0, runs).map((r) => r.score), kind) },
    ...rivals.map((r) => ({ who: r.id, best: bestOf(r.runs.slice(0, runs), kind) })),
  ]
  const order = (a: ContestStanding, b: ContestStanding): number => {
    if (a.best === null || b.best === null) return a.best === null ? (b.best === null ? 0 : 1) : -1
    return beats(kind, a.best, b.best) ? -1 : beats(kind, b.best, a.best) ? 1 : 0
  }
  return rows.sort(order)
}
