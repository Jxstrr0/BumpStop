/**
 * Stage highlights (plan PR 7): short clips of a raid stage for the 3D view.
 *
 * A long stage drives a full-detail sample of each 5 km chunk and works out
 * the rest (`stage.ts`). Every sample is the real sim, so the highlight is
 * made of them: the recorder keeps a pose log while each sample is driven,
 * then cuts out its busiest few seconds (where the wheels worked hardest),
 * or, if something broke in the sample, the last seconds before the break.
 *
 * Each clip keeps just the bit of road under it, with room behind and ahead
 * for the camera, so a whole stage of clips stays small on a phone.
 *
 * The recorder only reads the sim; it never changes a result.
 */
import type { GroundId } from '../data/ground'
import { lastPoses, newPoseLog, type Pose, type PoseLog } from './poses'
import type { Profile } from './ground'
import type { ClipSink } from './stage'
import type { BreakEvent } from './wear'

/** How the clips are cut. Only the show: changing these never changes a result. */
export const CLIP = {
  /** A clip is this long (s of sim time)... */
  seconds: 5,
  /** ...or this long when it ends on a break: the slow-motion replay. */
  breakSeconds: 3.5,
  /** Road kept behind the clip's first pose and ahead of its last (m): the 3D view needs 30 and 60, plus a wheelbase. */
  behind: 40,
  ahead: 75,
} as const

export interface Clip {
  /** Metres from the start of the stage. */
  at: number
  /** The leg it was on (0 to 2). */
  leg: number
  ground: GroundId
  /** m/s */
  speed: number
  /** The road under the clip; the poses' `x` is measured along it. */
  road: Profile
  poses: Pose[]
  /** What broke at the end of the clip, or null. */
  broken: BreakEvent | null
}

/** A copy of part of a road, from `from` to `to` metres along it. */
function cutRoad(p: Profile, from: number, to: number): Profile {
  const a = Math.max(0, Math.floor(from / p.step))
  const b = Math.min(p.left.length, Math.ceil(to / p.step) + 1)
  return { ground: p.ground, step: p.step, length: (b - 1 - a) * p.step, left: p.left.slice(a, b), right: p.right.slice(a, b) }
}

/** How hard the wheels and body worked between two poses. */
function activity(a: Pose, b: Pose): number {
  let sum = Math.abs(b.z - a.z)
  for (let i = 0; i < 4; i++) sum += Math.abs((b.wheelZ[i] as number) - (a.wheelZ[i] as number))
  return sum
}

/** The clip's poses, picked from a whole sample, or null if the sample was too short to show. */
export function pickClip(poses: readonly Pose[], roadLength: number, broken: boolean): Pose[] | null {
  if (poses.length < 2) return null
  const first = poses[0]!
  const span = poses[poses.length - 1]!.t - first.t
  if (broken) {
    // The last seconds before the break, as far back as the road allows.
    const from = poses[poses.length - 1]!.t - CLIP.breakSeconds
    const out = poses.filter((p) => p.t >= from && p.x >= CLIP.behind)
    return out.length >= 2 ? out : null
  }
  if (span < CLIP.seconds) return null
  // Score every window of `seconds` that has room for the road around it, and keep the busiest.
  const okStart = (p: Pose) => p.x >= CLIP.behind
  const okEnd = (p: Pose) => p.x + CLIP.ahead <= roadLength
  let best = -1
  let bestScore = -1
  let j = 0
  let score = 0
  for (let i = 0; i < poses.length; i++) {
    if (i > 0) score -= activity(poses[i - 1]!, poses[i]!)
    while (j + 1 < poses.length && poses[j + 1]!.t - poses[i]!.t <= CLIP.seconds) {
      score += activity(poses[j]!, poses[j + 1]!)
      j++
    }
    if (poses[j]!.t - poses[i]!.t < CLIP.seconds * 0.95) break
    if (okStart(poses[i]!) && okEnd(poses[j]!) && score > bestScore) {
      best = i
      bestScore = score
    }
  }
  if (best < 0) return null
  const out: Pose[] = []
  for (let k = best; k < poses.length && poses[k]!.t - poses[best]!.t <= CLIP.seconds; k++) out.push(poses[k]!)
  return out
}

/**
 * A clip recorder for one call of `runStage`: every sample it drives becomes
 * a clip in `out`. `offset` is how far into the stage the call starts (m).
 */
export function clipRecorder(out: Clip[], leg: number, offset: number): ClipSink {
  let at = 0
  let ground: GroundId = 'graded'
  let speed = 0
  return {
    start(info) {
      at = offset + info.distance
      ground = info.ground
      speed = info.speed
      // Room for the whole sample: the clip is picked from it afterwards.
      return newPoseLog(info.seconds + 1)
    },
    end(log: PoseLog, profile: Profile, broken: BreakEvent | null) {
      const all = lastPoses(log, Infinity)
      const poses = pickClip(all, profile.length, broken !== null)
      if (!poses) return
      const from = poses[0]!.x - CLIP.behind
      const to = poses[poses.length - 1]!.x + CLIP.ahead
      const road = cutRoad(profile, from, to)
      const shift = Math.max(0, Math.floor(from / profile.step)) * profile.step
      const first = poses[0]!.distance
      out.push({
        at: at + (first - (all[0]?.distance ?? first)),
        leg,
        ground,
        speed,
        road,
        poses: poses.map((p) => ({ ...p, x: p.x - shift, piece: 0 })),
        broken,
      })
    },
  }
}

/**
 * The clips to show for one leg: every clip that ends on a break, and others
 * spread evenly along the leg, `max` in all (more if there were more breaks).
 */
export function legHighlights(clips: readonly Clip[], leg: number, max: number): Clip[] {
  const mine = clips.filter((c) => c.leg === leg)
  const breaks = mine.filter((c) => c.broken)
  const others = mine.filter((c) => !c.broken)
  const room = Math.max(0, max - breaks.length)
  const picked: Clip[] = [...breaks]
  if (others.length <= room) picked.push(...others)
  else for (let k = 0; k < room; k++) picked.push(others[Math.floor(((k + 0.5) * others.length) / room)] as Clip)
  return picked.sort((a, b) => a.at - b.at)
}
