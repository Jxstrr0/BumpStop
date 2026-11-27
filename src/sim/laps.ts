/**
 * Lap runs (plan PR 2, made step-by-step in plan PR 4): drive a test loop
 * faster and faster until something breaks, with heat and wear carried from
 * lap to lap.
 *
 * A run can go all at once (`runLaps`, for the balance bot) or a few steps
 * at a time (`startLaps`, then `advanceLaps` as often as you like), so the
 * rigs can show it live. Both give exactly the same result: `runLaps` is
 * just `advanceLaps` with no limit.
 *
 * Every step runs in full detail (no sampling), because a break needs the
 * exact moment and its trace.
 */
import { RIG_HISTORY_STEP, type Rig, type RigPiece } from '../data/rigs'
import { SIM, type AxleSetup, type RideSetup } from '../data/ride'
import { FEEL } from '../data/sound'
import type { WearSetup } from '../data/wear'
import { buildProfile, stampTable, type Profile } from './ground'
import { finishLanding, newLandingWatch, watchLanding, type LandingScore, type LandingWatch } from './landing'
import { emptyStats, enterSection, restingState, rideParams, stepRide, type RideParams, type RideState, type RideStats } from './ride'
import { newPoseLog, notePose, type PoseLog } from './poses'
import { Rng } from './rng'
import { breakTrace, record, type BreakTrace } from './trace'
import { damageOf, newWearRun, stepWear, worstDamage, type BreakEvent, type DamageSnapshot, type WearRun, type WearState } from './wear'

const DT = 1 / SIM.stepsPerSecond

export interface LapSummary {
  /** 1 for the first lap. */
  lap: number
  /** The lap's speed (m/s); each piece runs at this times its pace. */
  speed: number
  /** Hottest each damper got this lap (K). */
  peakTemp: number[]
  /** Bottom-outs this lap, all corners. */
  bottomOuts: number
  /** Most each wheel rose from ride height this lap (m). */
  peakCompression: number[]
  /** Damage at the end of the lap (or at the break). */
  damage: DamageSnapshot
  /** Metres into the run at the end of the lap (or at the break). */
  endDistance: number
  /** The jump ramp: this lap's landing, scored (`landing.ts`). */
  landing?: LandingScore
}

/**
 * The run as a few numbers every `RIG_HISTORY_STEP` metres, for the live
 * trace and the ghost of the last run. Parallel lists, one entry per sample.
 */
export interface RunHistory {
  /** Metres into the run. */
  distance: number[]
  /** The lap it was on (1 = first). */
  lap: number[]
  /** The hottest damper's oil (K). */
  oil: number[]
  /** The most any wheel used of its bump travel since the last sample (1 = hit the hard limit). */
  travel: number[]
  /** The most worn part's damage (0 to 1). */
  wear: number[]
}

/**
 * What the truck felt since the sound last looked (plan PR 6): the hits and
 * the damper work, for the clatter, the strikes and the buzz. The sound
 * empties it every frame (`takeFeel`). Counting changes nothing in the run.
 */
export interface RunFeel {
  /** Sim seconds since it was last emptied. */
  time: number
  /** Heat all four dampers made (J). */
  work: number
  /** Tires hitting hard (a rock, a landing): how many, and the hardest, as tire force over the corner's resting load. */
  strikes: number
  strikePeak: number
  /** Metal-to-metal bottom-outs: how many, and the hardest, as the strut's push over the corner's resting load. */
  bottomOuts: number
  bottomPeak: number
}

export function emptyFeel(): RunFeel {
  return { time: 0, work: 0, strikes: 0, strikePeak: 0, bottomOuts: 0, bottomPeak: 0 }
}

export interface LapRun {
  laps: LapSummary[]
  /** What broke first, or null if the truck lasted every lap. */
  broken: BreakEvent | null
  /** The lap it broke on (1 = first), or 0. */
  brokenLap: number
  /** The last few seconds before the break, or null. */
  trace: BreakTrace | null
  wear: WearState
  history: RunHistory
  /** The jump ramp's landings, one a lap (empty on the other rigs). */
  landings: LandingScore[]
}

export interface LapOptions {
  /** Outside air (K). */
  airTemp: number
  /** Keep a trace for the break (default true). */
  trace?: boolean
  /** Keep the last this many seconds of poses for the 3D view (default 0: none). See `poses.ts`. */
  poses?: number
}

/** A lap run part-way through. Plain numbers and arrays; `advanceLaps` moves it on. */
export interface LapRunner {
  rig: Rig
  p: RideParams
  s: RideState
  run: WearRun
  road: Profile[]
  /** The lap being driven (1 = first) and its speed (m/s). */
  lap: number
  lapSpeed: number
  /** The piece of the loop being driven, the step it's on, and the steps it takes. */
  piece: number
  step: number
  steps: number
  /** Totals for the lap so far. */
  stats: RideStats
  laps: LapSummary[]
  history: RunHistory
  /** Metres into the run where the next history sample is due, and the biggest travel since the last. */
  nextSample: number
  travelPeak: number
  /** The lap's start, metres into the run. */
  lapStart: number
  /** True once something broke or the last lap is done. */
  done: boolean
  /** Hits since the sound last looked. */
  feel: RunFeel
  /** Each corner's resting tire load (N), whether its tire may count a new strike, and whether it was bottomed last step. */
  restLoad: number[]
  strikeArmed: boolean[]
  wasBottomed: boolean[]
  /** The last few seconds of poses for the 3D view, if asked for. Read only; never changes a result. */
  poses: PoseLog | null
  /** The jump ramp: the watch over this lap's jump (null off the jump's piece), and every landing scored so far. */
  landing: LandingWatch | null
  landings: LandingScore[]
}

/** The loop's road, built once: the same every lap. */
export function rigRoad(rig: Rig, setup: RideSetup, seed: number): Profile[] {
  const root = new Rng(seed)
  const wheelbase = setup.cgToFront + setup.cgToRear
  return rig.pieces.map((piece, i) => {
    const profile = buildProfile(piece.ground, piece.length + wheelbase, root.fork(`piece-${i}`))
    if (piece.table) stampTable(profile, piece.table)
    return profile
  })
}

/** One lap's length (m). */
export function lapLength(rig: Rig): number {
  return rig.pieces.reduce((sum, piece) => sum + piece.length, 0)
}

/** Steps to drive a whole piece at this speed, from the rear axle on its start to the front axle on its end. */
function stepsFor(p: RideParams, profile: Profile, speed: number): number {
  const usable = profile.length - p.setup.cgToFront - p.setup.cgToRear
  return speed > 0 ? Math.max(0, Math.floor(usable / (speed * DT))) : 0
}

/** Put the runner at the start of piece `k` of the current lap. */
function enterPiece(r: LapRunner, k: number): void {
  r.piece = k
  r.step = 0
  const profile = r.road[k] as Profile
  enterSection(r.s, r.p, profile)
  const piece = r.rig.pieces[k] as RigPiece
  r.steps = stepsFor(r.p, profile, r.lapSpeed * piece.pace)
  closeLanding(r)
  r.landing = piece.table ? newLandingWatch(piece.table, r.lap, r.lapSpeed * piece.pace, r.s) : null
}

/** Score the jump's landing if it's still being watched (the lap or the run ended part-way through). */
function closeLanding(r: LapRunner): void {
  if (!r.landing) return
  const score = finishLanding(r.landing, r.s.t)
  if (score) r.landings.push(score)
  r.landing = null
}

function startLap(r: LapRunner, lap: number): void {
  r.lap = lap
  r.lapSpeed = r.rig.startSpeed + (lap - 1) * r.rig.speedStep
  r.stats = emptyStats()
  r.lapStart = r.run.w.distance
  enterPiece(r, 0)
}

function endLap(r: LapRunner): void {
  closeLanding(r)
  const { s, stats, run } = r
  const peakTemp = stats.peakTemp.map((t, i) => Math.max(t, s.oilTemp[i] as number))
  const bottomOuts = stats.bottomOuts.reduce((a, b) => a + b, 0)
  r.laps.push({
    lap: r.lap,
    speed: r.lapSpeed,
    peakTemp,
    bottomOuts,
    peakCompression: stats.peakCompression.slice(),
    damage: damageOf(run.w),
    endDistance: run.w.distance,
    ...landingOf(r),
  })
}

function landingOf(r: LapRunner): { landing?: LandingScore } {
  const last = r.landings[r.landings.length - 1]
  return last && last.lap === r.lap ? { landing: last } : {}
}

function sample(r: LapRunner): void {
  const h = r.history
  let hottest = 0
  for (const t of r.s.oilTemp) if (t > hottest) hottest = t
  h.distance.push(r.run.w.distance)
  h.lap.push(r.lap)
  h.oil.push(hottest)
  h.travel.push(r.travelPeak)
  h.wear.push(worstDamage(r.run.w))
  r.travelPeak = 0
}

export function startLaps(setup: RideSetup, wear: WearSetup, rig: Rig, seed: number, opts: LapOptions): LapRunner {
  const p = rideParams(setup)
  const r: LapRunner = {
    rig,
    p,
    s: restingState(opts.airTemp),
    run: newWearRun(wear, p, opts.trace !== false),
    road: rigRoad(rig, setup, seed),
    lap: 0,
    lapSpeed: 0,
    piece: 0,
    step: 0,
    steps: 0,
    stats: emptyStats(),
    laps: [],
    history: { distance: [], lap: [], oil: [], travel: [], wear: [] },
    nextSample: 0,
    travelPeak: 0,
    lapStart: 0,
    done: rig.maxLaps < 1,
    feel: emptyFeel(),
    restLoad: p.axle.map((ax, i) => ax.tireRate * (p.staticTire[i] as number)),
    strikeArmed: [true, true, true, true],
    wasBottomed: [false, false, false, false],
    poses: opts.poses ? newPoseLog(opts.poses) : null,
    landing: null,
    landings: [],
  }
  if (!r.done) {
    startLap(r, 1)
    sample(r)
    r.nextSample = RIG_HISTORY_STEP
  }
  return r
}

/**
 * Drive up to `maxSteps` more steps (Infinity for the rest of the run).
 * Returns the steps taken; the run is over when `r.done` is true.
 */
export function advanceLaps(r: LapRunner, maxSteps: number): number {
  let taken = 0
  const { s, p, run, feel } = r
  const { w, wp, forces, readings, rec } = run
  // The dampers' heat so far this lap, so the feel can add what this call makes.
  let workMark = lapWork(r)
  while (!r.done && taken < maxSteps) {
    if (r.step >= r.steps) {
      // This piece is done: on to the next one, or the next lap.
      if (r.piece + 1 < r.road.length) {
        enterPiece(r, r.piece + 1)
      } else {
        endLap(r)
        feel.work += lapWork(r) - workMark
        workMark = 0
        if (r.lap >= r.rig.maxLaps) r.done = true
        else startLap(r, r.lap + 1)
      }
      continue
    }
    const profile = r.road[r.piece] as Profile
    const speed = r.lapSpeed * (r.rig.pieces[r.piece] as RigPiece).pace
    stepRide(s, p, profile, speed, r.stats, forces)
    stepWear(w, wp, s, p, forces, profile, speed, readings)
    if (r.landing) {
      const score = watchLanding(r.landing, s, p, forces, profile)
      if (score) {
        r.landings.push(score)
        r.landing = null
      }
    }
    if (rec) {
      record(rec, s.oilTemp, forces, readings, w)
      // If it broke between samples, keep the breaking step too.
      if (w.broken && rec.tick !== 0) record(rec, s.oilTemp, forces, readings, w, true)
    }
    r.step++
    taken++
    feel.time += DT
    // The 3D view's pose log: every few steps, and always the step that broke.
    if (r.poses) notePose(r.poses, s, r.piece, w.distance, speed, 0, w.broken !== null)
    for (let i = 0; i < 4; i++) {
      const use = (forces.compression[i] as number) / (p.axle[i] as AxleSetup).bumpTravel
      if (use > r.travelPeak) r.travelPeak = use
      feelCorner(r, i)
    }
    if (w.distance >= r.nextSample) {
      sample(r)
      r.nextSample += RIG_HISTORY_STEP
    }
    if (w.broken) {
      endLap(r)
      sample(r)
      r.done = true
    }
  }
  feel.work += lapWork(r) - workMark
  return taken
}

/** Heat the dampers have made this lap (J). */
function lapWork(r: LapRunner): number {
  const e = r.stats.damperEnergy
  return (e[0] as number) + (e[1] as number) + (e[2] as number) + (e[3] as number)
}

/** Count a corner's hits for the sound: a tire hitting hard, or the wheel bottoming out. */
function feelCorner(r: LapRunner, i: number): void {
  const feel = r.feel
  const forces = r.run.forces
  const rest = r.restLoad[i] as number
  const hit = (forces.tire[i] as number) / rest
  if (r.strikeArmed[i] && hit >= FEEL.strikeAt) {
    r.strikeArmed[i] = false
    feel.strikes++
  } else if (!r.strikeArmed[i] && hit < FEEL.strikeRearm) {
    r.strikeArmed[i] = true
  }
  if (!r.strikeArmed[i] && hit > feel.strikePeak) feel.strikePeak = hit
  const bottomed = r.s.bottomed[i] as boolean
  if (bottomed) {
    if (!r.wasBottomed[i]) feel.bottomOuts++
    const push = (forces.strut[i] as number) / rest
    if (push > feel.bottomPeak) feel.bottomPeak = push
  }
  r.wasBottomed[i] = bottomed
}

/** Hand over what the truck felt since last time, and start counting again. */
export function takeFeel(r: LapRunner): RunFeel {
  const out = r.feel
  r.feel = emptyFeel()
  return out
}

/** The run so far as a result: what broke, on which lap, and its trace. */
export function lapResult(r: LapRunner): LapRun {
  const broken = r.run.w.broken
  return {
    laps: r.laps,
    broken,
    brokenLap: broken ? r.laps.length : 0,
    trace: broken && r.run.rec ? breakTrace(r.run.rec, broken) : null,
    wear: r.run.w,
    history: r.history,
    landings: r.landings,
  }
}

/** Drive the whole run at once. */
export function runLaps(setup: RideSetup, wear: WearSetup, rig: Rig, seed: number, opts: LapOptions): LapRun {
  const r = startLaps(setup, wear, rig, seed, opts)
  advanceLaps(r, Infinity)
  return lapResult(r)
}
