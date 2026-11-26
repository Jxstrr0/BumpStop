/**
 * The shaker rig (plan PR 4): four posts under the parked truck's wheels
 * move up and down together, slow at first and faster step by step. At each
 * step the truck settles into the beat, then the rig measures how far the
 * body and each wheel move, compared with the posts.
 *
 * Two things stand out on every truck:
 * - **Body bounce:** a slow beat (about 1 to 2 a second) where the body rides
 *   up and down on its springs more than the posts move.
 * - **Wheel hop:** a fast beat (about 8 to 15 a second) where the wheels
 *   bounce between the tire and the spring. On washboard that's the speed
 *   where the wheels skip and the dampers work hardest.
 *
 * No damage, no wear: it's a quick look. The posts are a flat road that
 * moves up and down under the parked truck, so the ride model itself is
 * the same one the loops drive.
 */
import { SHAKER } from '../data/rigs'
import { SIM, type RideSetup } from '../data/ride'
import { PI, detPow, detSin } from './det'
import type { Profile } from './ground'
import { newPoseLog, notePose, type PoseLog } from './poses'
import { emptyStats, enterSection, restingState, rideParams, stepRide, type RideParams, type RideState, type RideStats } from './ride'

const DT = 1 / SIM.stepsPerSecond

/** What the rig measured at one beat. Movements are compared with the posts': 1 = moves as much as the posts. */
export interface ShakerPoint {
  /** Beats a second (Hz). */
  freq: number
  /** The body over the front and the rear axle. */
  body: [number, number]
  /** The front and the rear wheels (the bigger of each pair). */
  wheel: [number, number]
}

export interface ShakerRunner {
  p: RideParams
  s: RideState
  stats: RideStats
  /** The posts: a tiny flat road whose height is set every step. */
  posts: Profile
  freqs: number[]
  /** The beat being measured, and how long the rig has shaken at it (s). */
  index: number
  time: number
  /** Where the posts are in their beat (radians), carried across steps so the shake never jumps. */
  phase: number
  /** Lowest and highest heights seen while measuring: body front, body rear, then the four wheels. */
  lo: number[]
  hi: number[]
  points: ShakerPoint[]
  done: boolean
  /** The last few seconds of poses for the 3D view, if asked for (the posts' height as `ground`). */
  poses: PoseLog | null
}

/** The beats the rig steps through, evenly spaced on a log scale. */
export function shakerFreqs(): number[] {
  const n = SHAKER.points
  const ratio = SHAKER.maxFreq / SHAKER.minFreq
  return Array.from({ length: n }, (_, k) => SHAKER.minFreq * detPow(ratio, n > 1 ? k / (n - 1) : 0))
}

function settleTime(freq: number): number {
  return Math.max(SHAKER.settleCycles / freq, SHAKER.settleMin)
}

function measureTime(freq: number): number {
  return SHAKER.measureCycles / freq
}

function resetMeasure(r: ShakerRunner): void {
  r.lo = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity]
  r.hi = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity]
}

/** `poseSeconds`: keep that many seconds of poses for the 3D view (0 = none). */
export function startShaker(setup: RideSetup, airTemp: number, poseSeconds = 0): ShakerRunner {
  const p = rideParams(setup)
  // Long enough for both axles plus a bit; one sample a metre is plenty, since it's flat.
  const length = Math.ceil(setup.cgToFront + setup.cgToRear + 4)
  const posts: Profile = {
    ground: 'graded',
    step: 1,
    length,
    left: new Float64Array(length + 1),
    right: new Float64Array(length + 1),
  }
  const s = restingState(airTemp)
  enterSection(s, p, posts)
  const r: ShakerRunner = {
    p,
    s,
    stats: emptyStats(),
    posts,
    freqs: shakerFreqs(),
    index: 0,
    time: 0,
    phase: 0,
    lo: [],
    hi: [],
    points: [],
    done: false,
    poses: poseSeconds > 0 ? newPoseLog(poseSeconds) : null,
  }
  resetMeasure(r)
  return r
}

/** Shake for up to `maxSteps` more steps (Infinity for the whole sweep). Returns the steps taken. */
export function advanceShaker(r: ShakerRunner, maxSteps: number): number {
  let taken = 0
  const { s, p, posts } = r
  const a = p.setup.cgToFront
  const b = p.setup.cgToRear
  while (!r.done && taken < maxSteps) {
    const freq = r.freqs[r.index] as number
    r.phase += 2 * PI * freq * DT
    if (r.phase > 2 * PI) r.phase -= 2 * PI
    posts.left.fill(SHAKER.amplitude * detSin(r.phase))
    posts.right.set(posts.left)
    stepRide(s, p, posts, 0, r.stats)
    r.time += DT
    taken++
    if (r.poses) notePose(r.poses, s, 0, 0, 0, posts.left[0] as number, false)

    const settle = settleTime(freq)
    if (r.time > settle) {
      const heights = [s.z + a * s.pitch, s.z - b * s.pitch, ...s.wheelZ]
      for (let k = 0; k < 6; k++) {
        const h = heights[k] as number
        if (h < (r.lo[k] as number)) r.lo[k] = h
        if (h > (r.hi[k] as number)) r.hi[k] = h
      }
    }
    if (r.time >= settle + measureTime(freq)) {
      const move = (k: number) => ((r.hi[k] as number) - (r.lo[k] as number)) / 2 / SHAKER.amplitude
      r.points.push({
        freq,
        body: [move(0), move(1)],
        wheel: [Math.max(move(2), move(3)), Math.max(move(4), move(5))],
      })
      r.index++
      r.time = 0
      resetMeasure(r)
      if (r.index >= r.freqs.length) r.done = true
    }
  }
  return taken
}

/** Steps the whole sweep takes, so the screen can show how far along it is. */
export function shakerSteps(r: ShakerRunner): number {
  return r.freqs.reduce((sum, f) => sum + Math.ceil((settleTime(f) + measureTime(f)) / DT), 0)
}

/** The liveliest beat for the body and for the wheels, and which end it was at. */
export interface ShakerPeak {
  freq: number
  /** How many times the posts' movement. */
  gain: number
  end: 'front' | 'rear'
}

export interface ShakerPeaks {
  body: ShakerPeak
  wheel: ShakerPeak
}

/**
 * Where the body and the wheels move most. The wheels follow the posts at
 * slow beats anyway, so their peak is only looked for above `SHAKER.wheelFrom`.
 */
export function shakerPeaks(points: readonly ShakerPoint[]): ShakerPeaks | null {
  if (points.length === 0) return null
  const best = (pick: (pt: ShakerPoint) => [number, number], from: number): ShakerPeak => {
    let peak: ShakerPeak = { freq: 0, gain: -1, end: 'front' }
    for (const pt of points) {
      if (pt.freq < from) continue
      const [f, r] = pick(pt)
      if (f > peak.gain) peak = { freq: pt.freq, gain: f, end: 'front' }
      if (r > peak.gain) peak = { freq: pt.freq, gain: r, end: 'rear' }
    }
    return peak
  }
  const wheelFrom = points.some((pt) => pt.freq >= SHAKER.wheelFrom) ? SHAKER.wheelFrom : 0
  return { body: best((pt) => pt.body, 0), wheel: best((pt) => pt.wheel, wheelFrom) }
}

/** A beat (Hz) as the road speed (m/s) that gives the same beat on typical washboard. */
export function washboardSpeed(freq: number): number {
  return freq * SHAKER.washboardWavelength
}

/** The whole sweep at once (for tests). */
export function runShaker(setup: RideSetup, airTemp: number): ShakerPoint[] {
  const r = startShaker(setup, airTemp)
  advanceShaker(r, Infinity)
  return r.points
}
