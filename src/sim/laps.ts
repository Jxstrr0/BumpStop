/**
 * Lap runs (plan PR 2): drive a test loop faster and faster until something
 * breaks, with heat and wear carried from lap to lap. The balance bot uses
 * this to check every class; the rigs in plan PR 4 build on it.
 *
 * Every step runs in full detail (no sampling), because a break needs the
 * exact moment and its trace.
 */
import type { Rig } from '../data/rigs'
import type { RideSetup } from '../data/ride'
import type { WearSetup } from '../data/wear'
import { buildProfile, type Profile } from './ground'
import { emptyStats, restingState, rideParams, type RideState } from './ride'
import { Rng } from './rng'
import { breakTrace, type BreakTrace } from './trace'
import { damageOf, driveSectionWithWear, newWearRun, type BreakEvent, type DamageSnapshot, type WearState } from './wear'

export interface LapSummary {
  /** 1 for the first lap. */
  lap: number
  /** The lap's speed (m/s); each piece runs at this times its pace. */
  speed: number
  /** Hottest each damper got this lap (K). */
  peakTemp: number[]
  /** Bottom-outs this lap, all corners. */
  bottomOuts: number
  /** Damage at the end of the lap (or at the break). */
  damage: DamageSnapshot
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
}

export interface LapOptions {
  /** Outside air (K). */
  airTemp: number
  /** Keep a trace for the break (default true). */
  trace?: boolean
}

/** The loop's road, built once: the same every lap. */
export function rigRoad(rig: Rig, setup: RideSetup, seed: number): Profile[] {
  const root = new Rng(seed)
  const wheelbase = setup.cgToFront + setup.cgToRear
  return rig.pieces.map((piece, i) => buildProfile(piece.ground, piece.length + wheelbase, root.fork(`piece-${i}`)))
}

export function runLaps(setup: RideSetup, wear: WearSetup, rig: Rig, seed: number, opts: LapOptions): LapRun {
  const p = rideParams(setup)
  const s: RideState = restingState(opts.airTemp)
  const run = newWearRun(wear, p, opts.trace !== false)
  const w = run.w
  const road = rigRoad(rig, setup, seed)
  const laps: LapSummary[] = []

  for (let lap = 1; lap <= rig.maxLaps && !w.broken; lap++) {
    const lapSpeed = rig.startSpeed + (lap - 1) * rig.speedStep
    const stats = emptyStats()
    for (let k = 0; k < rig.pieces.length && !w.broken; k++) {
      driveSectionWithWear(s, p, run, road[k] as Profile, lapSpeed * rig.pieces[k]!.pace, stats)
    }
    const peakTemp = stats.peakTemp.map((t, i) => Math.max(t, s.oilTemp[i] as number))
    const bottomOuts = stats.bottomOuts.reduce((a, b) => a + b, 0)
    laps.push({ lap, speed: lapSpeed, peakTemp, bottomOuts, damage: damageOf(w) })
  }

  const broken = w.broken
  return {
    laps,
    broken,
    brokenLap: broken ? laps.length : 0,
    trace: broken && run.rec ? breakTrace(run.rec, broken) : null,
    wear: w,
  }
}
