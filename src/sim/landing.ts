/**
 * The jump ramp's landing score (v1.22, Kelbo picked it, 27 November 2026).
 *
 * The lap runner hands every step on the jump's piece to `watchLanding`,
 * which only reads the sim: it never changes a result. It watches for the
 * truck leaving the lip, times the flight, and when the wheels come back
 * down it notes where (short on the flat top, on the landing slope, or past
 * it on the flat), which end touched first and how far the nose was from
 * the ground's own angle. For a moment after that (`LANDING.settle`) it
 * watches each end's bump stops, every bottom-out, the body's hardest jolt
 * and any bounce. Then it scores the landing out of 100 (`LANDING` in
 * `src/data/rigs.ts`) and keeps marks for the slow-motion replay: when
 * each thing happened, and where.
 *
 * Angles: pitch is positive nose up (as in the ride model), so a nose dive
 * is a negative angle against the ground.
 */
import { LANDING, tableMarks, type TableJump } from '../data/rigs'
import { SIM, type AxleSetup } from '../data/ride'
import { PI, detAtan2 } from './det'
import { heightAt, type Profile } from './ground'
import type { RideParams, RideState, StepForces } from './ride'

const DT = 1 / SIM.stepsPerSecond
const G = SIM.gravity
const DEG = 180 / PI

/** Where the wheels came down. 'none': the truck never left the ground (too slow to fly). */
export type LandingSpot = 'short' | 'slope' | 'flat' | 'none'
/** Which end touched first. */
export type FirstDown = 'front' | 'rear' | 'level'
export type LandingGrade = 'clean' | 'firm' | 'hard'

/**
 * A moment in the landing for the replay, in seconds into the run.
 * `corner` is 0 to 3 for a corner, or -1 for the whole truck; for a bump
 * stop it's the first corner on that end to reach it.
 */
export interface LandingMark {
  t: number
  kind: 'takeoff' | 'touch' | 'bumpStop' | 'bottom' | 'bounce'
  corner: number
}

export interface LandingScore {
  /** The lap (jump) number, 1 for the first, and its speed (m/s). */
  lap: number
  speed: number
  spot: LandingSpot
  first: FirstDown
  /** Seconds in the air (all four wheels off), and metres flown (take-off to touch-down). */
  air: number
  flown: number
  /** The body's angle against the ground at touch-down (degrees, negative = nose down). */
  angle: number
  /** Whether the front and the rear reached their bump stops. */
  bumpStops: [boolean, boolean]
  /** Bottom-outs per corner. */
  bottoms: [number, number, number, number]
  /** Times all four wheels left the ground again after landing. */
  bounces: number
  /** The body's hardest jolt (g). */
  peakG: number
  /** The most any wheel used of its bump travel (1 = the hard limit). */
  travel: number
  /** Out of 100, and its word. */
  score: number
  grade: LandingGrade
  /** Seconds into the run: take-off (or where it would have been), touch-down, and the end of the watch. */
  from: number
  touch: number
  to: number
  marks: LandingMark[]
}

/** The watch over one jump, reset at the start of each lap. Plain numbers, like the rest of the sim. */
export interface LandingWatch {
  jump: TableJump
  lip: number
  topEnd: number
  landEnd: number
  phase: 'before' | 'air' | 'landed' | 'done'
  lap: number
  speed: number
  /** Steps in a row with all four wheels off, before take-off counts. */
  offSteps: number
  takeoffT: number
  takeoffX: number
  air: number
  touchT: number
  touchX: number
  spot: LandingSpot
  first: FirstDown
  angle: number
  bumpStops: [boolean, boolean]
  bottoms: [number, number, number, number]
  wasBottomed: boolean[]
  bounces: number
  /** Whether the wheels are all off since landing, and for how many steps. */
  bounceSteps: number
  peakG: number
  travel: number
  lastVz: number
  marks: LandingMark[]
}

export function newLandingWatch(jump: TableJump, lap: number, speed: number, s: RideState): LandingWatch {
  const m = tableMarks(jump)
  return {
    jump,
    lip: m.lip,
    topEnd: m.topEnd,
    landEnd: m.landEnd,
    phase: 'before',
    lap,
    speed,
    offSteps: 0,
    takeoffT: 0,
    takeoffX: 0,
    air: 0,
    touchT: 0,
    touchX: 0,
    spot: 'none',
    first: 'level',
    angle: 0,
    bumpStops: [false, false],
    bottoms: [0, 0, 0, 0],
    wasBottomed: s.bottomed.slice(),
    bounces: 0,
    bounceSteps: 0,
    peakG: 0,
    travel: 0,
    lastVz: s.vz,
    marks: [],
  }
}

/** The ground's angle under the truck at CG position `x` (radians, positive = rising ahead). */
function groundAngle(profile: Profile, p: RideParams, x: number): number {
  const front = heightAt(profile.left, profile.step, x + p.setup.cgToFront)
  const rear = heightAt(profile.left, profile.step, x - p.setup.cgToRear)
  return detAtan2(front - rear, p.setup.cgToFront + p.setup.cgToRear)
}

/**
 * Look at one step on the jump's piece (after `stepRide` has moved the
 * truck). Returns a score once the landing has been watched long enough,
 * otherwise null.
 */
export function watchLanding(w: LandingWatch, s: RideState, p: RideParams, f: StepForces, profile: Profile): LandingScore | null {
  if (w.phase === 'done') return null
  const front = s.x + p.setup.cgToFront
  const rear = s.x - p.setup.cgToRear
  const frontDown = (f.tire[0] as number) > 0 || (f.tire[1] as number) > 0
  const rearDown = (f.tire[2] as number) > 0 || (f.tire[3] as number) > 0
  const allOff = !frontDown && !rearDown

  if (w.phase === 'before') {
    if (allOff && front > w.lip - LANDING.liftFrom) {
      if (w.offSteps === 0) {
        w.takeoffT = s.t
        w.takeoffX = s.x
      }
      w.offSteps++
      if (w.offSteps * DT >= LANDING.minAir) {
        w.phase = 'air'
        w.air = w.offSteps * DT
        w.marks.push({ t: w.takeoffT, kind: 'takeoff', corner: -1 })
      }
    } else {
      w.offSteps = 0
      // Too slow to fly: the rear wheels rolled down off the top. Watch it settle on the slope.
      if (rear > w.topEnd) touchDown(w, s, p, profile, frontDown, rearDown, 'none')
    }
    w.lastVz = s.vz
    return null
  }

  if (w.phase === 'air') {
    if (allOff) {
      w.air += DT
      w.lastVz = s.vz
      return null
    }
    // Where the end that touched first is: short on the top, on the slope, or past it on the flat.
    const at = frontDown && !rearDown ? front : rearDown && !frontDown ? rear : s.x
    touchDown(w, s, p, profile, frontDown, rearDown, at < w.topEnd ? 'short' : at > w.landEnd ? 'flat' : 'slope')
  }

  // Landed: the bump stops, bottom-outs, bounces and the body's jolt.
  for (let i = 0; i < 4; i++) {
    const c = f.compression[i] as number
    const ax = p.axle[i] as AxleSetup
    const end = i < 2 ? 0 : 1
    if (c > (p.bumpStopStart[i] as number) && !w.bumpStops[end]) {
      w.bumpStops[end] = true
      w.marks.push({ t: s.t, kind: 'bumpStop', corner: i })
    }
    const use = c / ax.bumpTravel
    if (use > w.travel) w.travel = use
    const bottomed = s.bottomed[i] as boolean
    if (bottomed && !w.wasBottomed[i]) {
      w.bottoms[i] = (w.bottoms[i] as number) + 1
      w.marks.push({ t: s.t, kind: 'bottom', corner: i })
    }
    w.wasBottomed[i] = bottomed
  }
  const g = Math.abs((s.vz - w.lastVz) / DT) / G
  w.lastVz = s.vz
  if (g > w.peakG) w.peakG = g
  if (allOff) {
    w.bounceSteps++
    if (w.bounceSteps * DT >= LANDING.minAir && w.bounceSteps * DT < LANDING.minAir + DT) {
      w.bounces++
      w.marks.push({ t: s.t, kind: 'bounce', corner: -1 })
    }
  } else {
    w.bounceSteps = 0
  }
  return s.t - w.touchT >= LANDING.settle ? finishLanding(w, s.t) : null
}

function touchDown(w: LandingWatch, s: RideState, p: RideParams, profile: Profile, frontDown: boolean, rearDown: boolean, spot: LandingSpot): void {
  w.phase = 'landed'
  w.spot = spot
  w.touchT = s.t
  w.touchX = s.x
  if (spot === 'none') {
    w.takeoffT = s.t
    w.takeoffX = s.x
  }
  w.first = frontDown && !rearDown ? 'front' : rearDown && !frontDown ? 'rear' : 'level'
  w.angle = (s.pitch - groundAngle(profile, p, s.x)) * DEG
  w.marks.push({ t: s.t, kind: 'touch', corner: w.first === 'front' ? 0 : w.first === 'rear' ? 2 : -1 })
}

/**
 * Score the landing as it stands. The lap runner also calls this when the
 * truck breaks (or the lap ends) part-way through the watch. Returns null if
 * the truck hadn't reached the jump yet.
 */
export function finishLanding(w: LandingWatch, now: number): LandingScore | null {
  if (w.phase === 'before') return null
  if (w.phase === 'done') return null
  if (w.phase === 'air') {
    // It broke in the air (rare): count it as a landing that never came.
    w.touchT = now
  }
  w.phase = 'done'
  const L = LANDING
  const bottomCorners = w.bottoms.filter((n) => n > 0).length
  let score = 100
  score -= Math.max(0, Math.abs(w.angle) - L.levelWithin) * L.perDegree
  score -= (Number(w.bumpStops[0]) + Number(w.bumpStops[1])) * L.bumpStop
  score -= Math.min(bottomCorners, L.bottomCap) * L.bottom
  score -= w.bounces * L.bounce
  score -= Math.min(L.gCap, Math.max(0, w.peakG - L.gFrom) * L.perG)
  if (w.spot === 'short') score -= L.short
  if (w.spot === 'flat') score -= L.flat
  score = Math.round(Math.max(0, Math.min(100, score)))
  return {
    lap: w.lap,
    speed: w.speed,
    spot: w.spot,
    first: w.first,
    air: w.spot === 'none' ? 0 : w.air,
    flown: w.spot === 'none' ? 0 : w.touchX - w.takeoffX,
    angle: w.angle,
    bumpStops: [w.bumpStops[0], w.bumpStops[1]],
    bottoms: [w.bottoms[0], w.bottoms[1], w.bottoms[2], w.bottoms[3]],
    bounces: w.bounces,
    peakG: w.peakG,
    travel: w.travel,
    score,
    grade: score >= L.clean ? 'clean' : score >= L.firm ? 'firm' : 'hard',
    from: w.takeoffT,
    touch: w.touchT,
    to: now,
    marks: w.marks,
  }
}
