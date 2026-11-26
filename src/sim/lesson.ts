/**
 * The help's damper lessons (plan PR 11): a "quarter car", one corner of the
 * truck as two weights (the body and the wheel) joined by a spring, a damper
 * and a bump stop, with the tire as a spring underneath that can leave the
 * ground. It's a teaching toy: small enough to run a clip in a millisecond or
 * two as a slider moves, and it never feeds the game's results. The real
 * truck is the seven-part model in `ride.ts`.
 *
 * Signs: up is positive. Travel is how far the wheel has risen towards the
 * body from where it sits at rest (positive is compression, into the bump;
 * negative is droop).
 */
import { LESSON_STEP, QUARTER_CAR, type LessonRoad } from '../data/lessons'

/** What a lesson clip changes from the factory corner. */
export interface LessonSetup {
  /** Compression and rebound damping (N·s/m). */
  compression: number
  rebound: number
  springRate: number
  bumpStopLength: number
}

export function factorySetup(): LessonSetup {
  return {
    compression: QUARTER_CAR.compression,
    rebound: QUARTER_CAR.rebound,
    springRate: QUARTER_CAR.springRate,
    bumpStopLength: QUARTER_CAR.bumpStopLength,
  }
}

/** One clip, sampled every `sampleEvery` steps for the charts. */
export interface LessonClip {
  /** Time of each sample (s). */
  t: number[]
  /** The road under the tire (m). */
  road: number[]
  /** The body's height from rest (m). */
  body: number[]
  /** The wheel's height from rest (m). */
  wheel: number[]
  /** Wheel travel as a share of the bump travel: 1 is the hard limit, negative is droop. */
  travel: number[]
  /** The most bump travel used (share). */
  peakTravel: number
  /** Times the wheel hit the hard limit, metal to metal. */
  bottomOuts: number
  /** Share of the clip with the tire off the ground. */
  airShare: number
  /** Heat the damper made (J): every newton it pushed, over every metre it moved. */
  heat: number
  /** The biggest jolt the body felt (m/s²), less gravity. */
  peakJolt: number
}

/** The road's height under the tire at distance x along it (m): smooth bumps, flat between. */
export function roadHeight(road: LessonRoad, x: number): number {
  const along = x - road.lead
  if (along < 0) return 0
  const k = road.pitch > 0 ? Math.floor(along / road.pitch) : 0
  if (k >= road.count) return 0
  const u = (along - k * road.pitch) / road.length
  if (u < 0 || u > 1) return 0
  // A smooth hump: zero height and zero slope at both ends.
  const w = u * (1 - u)
  return 16 * road.height * w * w
}

/** The damper's push (N) for a travel speed (m/s; positive is compressing). */
function damperForce(speed: number, s: LessonSetup): number {
  const c = speed >= 0 ? s.compression : s.rebound
  const v = Math.abs(speed)
  const f = v <= QUARTER_CAR.knee ? c * v : c * QUARTER_CAR.knee + c * QUARTER_CAR.highShare * (v - QUARTER_CAR.knee)
  return speed >= 0 ? f : -f
}

/** Spring, bump stop, hard limit and limit strap together (N, pushing the body up and the wheel down). */
function travelForce(x: number, v: number, s: LessonSetup): number {
  const q = QUARTER_CAR
  let f = s.springRate * x
  const stopFrom = q.bumpTravel - s.bumpStopLength
  if (x > stopFrom) f += q.bumpStopRate * (x - stopFrom) * (x - stopFrom)
  if (x > q.bumpTravel) f += q.hardRate * (x - q.bumpTravel) + q.hardDamping * v
  if (x < -q.droopTravel) f += q.hardRate * (x + q.droopTravel)
  return f
}

/**
 * Drive one corner over a road. The step is fixed (`LESSON_STEP`), so the
 * same setup on the same road always draws the same clip.
 */
export function runLesson(road: LessonRoad, setup: LessonSetup, sampleEvery = 5): LessonClip {
  const q = QUARTER_CAR
  const dt = LESSON_STEP
  const steps = Math.round(road.seconds / dt)
  // At rest the spring already carries the body and the tire carries both, so
  // only the change from rest matters here, except that the tire can't pull.
  const tireRest = (q.bodyMass + q.wheelMass) * q.gravity
  let zb = 0
  let vb = 0
  let zw = 0
  let vw = 0
  const clip: LessonClip = { t: [], road: [], body: [], wheel: [], travel: [], peakTravel: 0, bottomOuts: 0, airShare: 0, heat: 0, peakJolt: 0 }
  let air = 0
  let wasHard = false
  for (let i = 0; i <= steps; i++) {
    const time = i * dt
    const r = roadHeight(road, road.speed * time)
    const x = zw - zb
    const v = vw - vb
    const suspension = travelForce(x, v, setup) + damperForce(v, setup)
    const tire = Math.max(0, tireRest + q.tireRate * (r - zw))
    if (tire === 0) air++
    const ab = suspension / q.bodyMass
    const aw = (tire - tireRest - suspension) / q.wheelMass
    if (i % sampleEvery === 0) {
      clip.t.push(time)
      clip.road.push(r)
      clip.body.push(zb)
      clip.wheel.push(zw)
      clip.travel.push(x / q.bumpTravel)
    }
    if (x / q.bumpTravel > clip.peakTravel) clip.peakTravel = x / q.bumpTravel
    const hard = x > q.bumpTravel
    if (hard && !wasHard) clip.bottomOuts++
    wasHard = hard
    if (Math.abs(ab) > clip.peakJolt) clip.peakJolt = Math.abs(ab)
    clip.heat += Math.abs(damperForce(v, setup) * v) * dt
    // Semi-implicit Euler: speeds first, then positions from the new speeds (steady for springs).
    vb += ab * dt
    vw += aw * dt
    zb += vb * dt
    zw += vw * dt
  }
  clip.airShare = air / (steps + 1)
  return clip
}
