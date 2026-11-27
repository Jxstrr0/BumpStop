/**
 * A short memory of how the truck moved, for the 3D views (plan PR 5).
 *
 * The rigs run the sim much faster than real time, so the 3D can't simply
 * show each step as it happens. Instead the sim jots down the truck's pose
 * (body bounce, pitch and roll, each wheel's height) 50 times a simulated
 * second into a small ring that keeps the last few seconds. The 3D view
 * plays clips out of it at true speed, like a TV feed cutting between
 * moments, and when something breaks it replays the last seconds in slow
 * motion.
 *
 * Writing the log only reads the sim's state; it never changes a result.
 * It's off unless asked for (the balance bot doesn't need it).
 */
import { SIM } from '../data/ride'
import type { RideState } from './ride'

/** Poses kept per simulated second: one every 10 steps of the 500 Hz sim. */
export const POSES_PER_SECOND = 50

export interface PoseLog {
  /** Sim steps between poses, and steps counted so far. */
  every: number
  tick: number
  /** How many poses the ring holds. */
  size: number
  /** Poses written so far (the newest is at (count − 1) mod size). */
  count: number
  /** Seconds into the run. */
  t: Float64Array
  /** Metres into the run. */
  distance: Float64Array
  /** Which piece of the loop, and the centre of mass's distance along that piece (m). */
  piece: Int32Array
  x: Float64Array
  /** Road speed (m/s). */
  speed: Float64Array
  /** The ground under all four wheels when it isn't a road, e.g. the shaker's posts (m). */
  ground: Float64Array
  z: Float64Array
  pitch: Float64Array
  roll: Float64Array
  /** Four per pose: front left, front right, rear left, rear right (m). */
  wheelZ: Float64Array
}

/** One pose read back out of the log. */
export interface Pose {
  t: number
  distance: number
  piece: number
  x: number
  speed: number
  ground: number
  z: number
  pitch: number
  roll: number
  wheelZ: [number, number, number, number]
}

export function newPoseLog(seconds: number): PoseLog {
  const size = Math.max(2, Math.ceil(seconds * POSES_PER_SECOND))
  return {
    every: Math.max(1, Math.round(SIM.stepsPerSecond / POSES_PER_SECOND)),
    tick: 0,
    size,
    count: 0,
    t: new Float64Array(size),
    distance: new Float64Array(size),
    piece: new Int32Array(size),
    x: new Float64Array(size),
    speed: new Float64Array(size),
    ground: new Float64Array(size),
    z: new Float64Array(size),
    pitch: new Float64Array(size),
    roll: new Float64Array(size),
    wheelZ: new Float64Array(size * 4),
  }
}

/** Write the truck's pose now. */
export function logPose(log: PoseLog, s: RideState, piece: number, distance: number, speed: number, ground = 0): void {
  const k = log.count % log.size
  log.t[k] = s.t
  log.distance[k] = distance
  log.piece[k] = piece
  log.x[k] = s.x
  log.speed[k] = speed
  log.ground[k] = ground
  log.z[k] = s.z
  log.pitch[k] = s.pitch
  log.roll[k] = s.roll
  for (let i = 0; i < 4; i++) log.wheelZ[k * 4 + i] = s.wheelZ[i] as number
  log.count++
}

/** Count one sim step, and write the pose if one is due (or `now` is true, e.g. the step that broke). */
export function notePose(log: PoseLog, s: RideState, piece: number, distance: number, speed: number, ground: number, now: boolean): void {
  log.tick++
  if (now || log.tick % log.every === 0) logPose(log, s, piece, distance, speed, ground)
}

/** How many poses are in the ring now. */
export function posesHeld(log: PoseLog): number {
  return Math.min(log.count, log.size)
}

/** The n-th pose counting back from the newest (0 = newest). */
export function poseAgo(log: PoseLog, n: number): Pose {
  const k = (((log.count - 1 - n) % log.size) + log.size) % log.size
  return {
    t: log.t[k] as number,
    distance: log.distance[k] as number,
    piece: log.piece[k] as number,
    x: log.x[k] as number,
    speed: log.speed[k] as number,
    ground: log.ground[k] as number,
    z: log.z[k] as number,
    pitch: log.pitch[k] as number,
    roll: log.roll[k] as number,
    wheelZ: [log.wheelZ[k * 4] as number, log.wheelZ[k * 4 + 1] as number, log.wheelZ[k * 4 + 2] as number, log.wheelZ[k * 4 + 3] as number],
  }
}

/** The last `seconds` of poses, oldest first (fewer if the log hasn't got that many yet). */
export function lastPoses(log: PoseLog, seconds: number): Pose[] {
  const n = Math.min(posesHeld(log), Math.ceil(seconds * POSES_PER_SECOND) + 1)
  const out: Pose[] = []
  for (let i = n - 1; i >= 0; i--) out.push(poseAgo(log, i))
  return out
}

/** Every pose newer than `after` (s into the run), oldest first: what's come in since a live view last looked. */
export function posesSince(log: PoseLog, after: number): Pose[] {
  const out: Pose[] = []
  const held = posesHeld(log)
  for (let i = 0; i < held; i++) {
    const p = poseAgo(log, i)
    if (p.t <= after) break
    out.push(p)
  }
  return out.reverse()
}
