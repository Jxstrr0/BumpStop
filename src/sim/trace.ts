/**
 * The break trace (plan PR 2): a rolling record of the last few seconds of
 * every channel, so when something lets go the report can show what led up
 * to it. It keeps `WEAR.traceSeconds` at `WEAR.traceRate` samples a second
 * and overwrites the oldest, so it costs the same however long the run.
 *
 * On a break, `breakTrace` cuts out the channels that failure's trace needs
 * (`FAILURES[kind]` in `src/data/failures.ts`), oldest first.
 */
import { CORNER_CHANNELS, FAILURES, FRAME_CHANNELS, type CornerChannel, type FrameChannel } from '../data/failures'
import { SIM } from '../data/ride'
import { WEAR } from '../data/wear'
import type { StepForces } from './ride'
import type { BreakEvent, WearReadings, WearState } from './wear'

export interface TraceRecorder {
  /** Samples kept. */
  size: number
  /** Ride steps between samples. */
  every: number
  /** Steps since the last sample. */
  tick: number
  /** Where the next sample goes. */
  head: number
  /** Samples held so far (up to `size`). */
  count: number
  t: Float64Array
  distance: Float64Array
  corner: Record<CornerChannel, Float64Array[]>
  frame: Record<FrameChannel, Float64Array>
}

export function newRecorder(): TraceRecorder {
  const size = Math.round(WEAR.traceRate * WEAR.traceSeconds)
  const corner = {} as Record<CornerChannel, Float64Array[]>
  for (const ch of CORNER_CHANNELS) corner[ch] = [0, 1, 2, 3].map(() => new Float64Array(size))
  const frame = {} as Record<FrameChannel, Float64Array>
  for (const ch of FRAME_CHANNELS) frame[ch] = new Float64Array(size)
  return {
    size,
    every: Math.max(1, Math.round(SIM.stepsPerSecond / WEAR.traceRate)),
    tick: 0,
    head: 0,
    count: 0,
    t: new Float64Array(size),
    distance: new Float64Array(size),
    corner,
    frame,
  }
}

/**
 * Note this step, if a sample is due (or always, with `now`). `oilTemp` is
 * the ride state's, per corner. The lap runs force one last sample on the
 * step something breaks, so the trace ends on the moment it let go, not up
 * to a hundredth of a second before.
 */
export function record(rec: TraceRecorder, oilTemp: readonly number[], f: StepForces, r: WearReadings, w: WearState, now = false): void {
  if (++rec.tick < rec.every && !now) return
  rec.tick = 0
  const k = rec.head
  rec.t[k] = w.t
  rec.distance[k] = w.distance
  const c = rec.corner
  for (let i = 0; i < 4; i++) {
    c.oilTemp[i]![k] = oilTemp[i]!
    c.travel[i]![k] = f.compression[i]!
    c.load[i]![k] = f.strut[i]!
    c.hardStop[i]![k] = f.hardStop[i]!
    c.tireSquash[i]![k] = f.tireSquash[i]!
    c.edge[i]![k] = r.edge[i]!
    c.jointAngle[i]![k] = r.jointAngle[i]!
    c.jointTorque[i]![k] = r.jointTorque[i]!
    c.strengthUse[i]![k] = r.strengthUse[i]!
    c.mountDamage[i]![k] = w.mount[i]!.damage
    c.axleDamage[i]![k] = w.axle[i]!.damage
    c.tireDamage[i]![k] = w.tire[i]!.damage
  }
  rec.frame.frameFront[k] = r.frameFront
  rec.frame.frameTwist[k] = r.frameTwist
  rec.frame.frameRear[k] = r.frameRear
  rec.frame.frameDamageFront[k] = w.frame[0]!.damage
  rec.frame.frameDamageCentre[k] = w.frame[1]!.damage
  rec.frame.frameDamageRear[k] = w.frame[2]!.damage
  rec.head = (k + 1) % rec.size
  if (rec.count < rec.size) rec.count++
}

/** The trace the report shows for one break: the last few seconds of its channels, oldest first. */
export interface BreakTrace {
  /** Seconds into the run, per sample. */
  t: number[]
  /** Metres into the run, per sample. */
  distance: number[]
  /** For a corner break, that corner's channels; for a frame crack, the frame's. */
  channels: Partial<Record<CornerChannel | FrameChannel, number[]>>
}

function unroll(rec: TraceRecorder, ring: Float64Array): number[] {
  const out: number[] = []
  const start = rec.count < rec.size ? 0 : rec.head
  for (let n = 0; n < rec.count; n++) out.push(ring[(start + n) % rec.size] as number)
  return out
}

export function breakTrace(rec: TraceRecorder, ev: BreakEvent): BreakTrace {
  const info = FAILURES[ev.kind]
  const channels: BreakTrace['channels'] = {}
  if (ev.corner >= 0) for (const ch of info.corner) channels[ch] = unroll(rec, rec.corner[ch][ev.corner] as Float64Array)
  for (const ch of info.frame) channels[ch] = unroll(rec, rec.frame[ch])
  return { t: unroll(rec, rec.t), distance: unroll(rec, rec.distance), channels }
}
