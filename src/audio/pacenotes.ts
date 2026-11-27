/**
 * What the radio co-driver calls for each clip of a stage highlight (Kelbo
 * picked it, 27 November 2026). Pure, so the tests can check it.
 *
 * A raid stage's highlight is a run of 5-second clips, each one real road
 * the sim drove (`src/sim/highlight.ts`). As a clip starts, the co-driver
 * reads the road ahead of the truck in that clip:
 *
 * - **Something to hit** (a whoop, a rock, a jump, a frost heave): he names
 *   the first one ahead, with "Caution" if the biggest one there is big, and
 *   how far it is ("Caution. Big jump. 50."). This is the clip's real road,
 *   so the jump he calls is the jump the truck flies off a moment later.
 * - **Nothing in particular**: he names the ground, but only when it's
 *   changed since his last call ("Washboard.", "Flat out."), so a long
 *   stretch of washboard isn't called every five seconds.
 *
 * The thresholds are in `RADIO_SPOT` (`src/data/radio.ts`).
 */
import type { GroundId } from '../data/ground'
import { GROUND_LINE, RADIO, RADIO_DISTANCES, RADIO_SPOT, type RadioLine } from '../data/radio'
import type { Profile } from '../sim/ground'

/** Something to hit, found in the road ahead. */
export interface Spotted {
  /** Metres ahead of the truck. */
  ahead: number
  /** Highest minus lowest point of the biggest one in the stretch (m). */
  size: number
  /** A crack edge facing the truck (frost heaves only). */
  stepUp: boolean
}

/** The distance line nearest to `m` metres, or null if it's too close to bother saying. */
export function distanceLine(m: number): RadioLine | null {
  if (!(m >= RADIO.minDistance)) return null
  let best = RADIO_DISTANCES[0]!
  for (const d of RADIO_DISTANCES) if (Math.abs(d.m - m) < Math.abs(best.m - m)) best = d
  return best.line
}

/** Highest minus lowest point of one track between two sample indexes (inclusive). */
function spread(track: Float64Array, a: number, b: number): number {
  let lo = Infinity
  let hi = -Infinity
  for (let i = a; i <= b; i++) {
    const h = track[i] as number
    if (h < lo) lo = h
    if (h > hi) hi = h
  }
  return hi - lo
}

/**
 * The first thing to hit on `road` between `from` and `to` metres along it,
 * looking `window` metres at a time down both wheel tracks, or null if
 * there's nothing over `min`. Its size is the biggest one found from there
 * to `to`, so a set of whoops is called by its tallest.
 */
export function spotAhead(
  road: Profile, ground: GroundId, from: number, to: number,
): Spotted | null {
  const spot = RADIO_SPOT[ground]
  if (!spot) return null
  const n = road.left.length
  const w = Math.max(1, Math.round(spot.window / road.step))
  const i0 = Math.max(0, Math.floor(from / road.step))
  const i1 = Math.min(n - 1, Math.ceil(to / road.step))
  let first = -1
  let size = 0
  // Step half a window at a time: fine enough to catch a 20 cm rock, quick on a phone.
  const stride = Math.max(1, Math.floor(w / 2))
  for (let i = i0; i + 1 <= i1; i += stride) {
    const b = Math.min(n - 1, i + w)
    const s = Math.max(spread(road.left, i, b), spread(road.right, i, b))
    if (s >= spot.min) {
      if (first < 0) first = i
      size = Math.max(size, s)
    }
  }
  if (first < 0) return null
  let stepUp = false
  if (spot.stepUp !== undefined) {
    // A crack edge facing the truck is a sudden rise from one sample to the next.
    for (let i = first; i < i1 && !stepUp; i++) {
      if ((road.left[i + 1] as number) - (road.left[i] as number) >= spot.stepUp) stepUp = true
      if ((road.right[i + 1] as number) - (road.right[i] as number) >= spot.stepUp) stepUp = true
    }
  }
  // The feature starts where its window starts; its top is somewhere in the window, so call it from the middle.
  const at = (first + Math.min(w, i1 - first) / 2) * road.step
  return { ahead: Math.max(0, at - from), size, stepUp }
}

/** The part of a clip the co-driver needs: its ground, its road, and where the truck goes along it. */
export interface ClipRoad {
  ground: GroundId
  road: Profile
  /** Where the truck is along `road` at the clip's first and last moments (m). */
  from: number
  to: number
}

/** A call for one clip: the lines to say, in order, and the ground he's now called. */
export interface ClipCall {
  lines: RadioLine[]
  ground: GroundId
}

/**
 * The co-driver's call as a clip starts, or null if there's nothing worth
 * saying. `lastGround` is the ground he last called (null at the start of a
 * stage), so a stretch of the same ground isn't called over and over.
 */
export function clipCall(clip: ClipRoad, lastGround: GroundId | null): ClipCall | null {
  // Start just past the truck's middle: anything nearer is already under the front wheels.
  const spotted = spotAhead(clip.road, clip.ground, clip.from + RADIO.skipNear, clip.to + RADIO.lookPast)
  if (spotted) {
    const spot = RADIO_SPOT[clip.ground]!
    const line = spotted.stepUp ? 'heaveStep' : spotted.size >= spot.big ? spot.bigLine : spot.line
    const far = distanceLine(spotted.ahead + RADIO.skipNear)
    return { lines: far ? [line, far] : [line], ground: clip.ground }
  }
  if (clip.ground === lastGround) return null
  return { lines: [GROUND_LINE[clip.ground]], ground: clip.ground }
}
