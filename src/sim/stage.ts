/**
 * Long stages (plan PR 1). A 300 km stage at 500 steps a second would be
 * millions of steps, too slow for a phone. So the stage is cut into chunks
 * of at most `LONG_STAGE.chunkLength`, and each chunk:
 *
 * 1. drives a short sample section (the ground's `sampleLength`) in full detail,
 *    starting from the oil temperatures the last chunk ended on;
 * 2. measures how much heat each damper made per second on that ground;
 * 3. works out the rest of the chunk with the exact answer for a heater in a
 *    draught: the oil heads towards air + heat ÷ cooling, getting a fixed
 *    share closer every second. As the oil heats and damps less it also makes
 *    a little less heat (`LONG_STAGE.heatFollowsDamping`). Counts (like
 *    bottoming) scale with distance.
 *
 * With a wear setup (plan PR 2), the samples also add up wear in full detail,
 * and the damage each part took in the sample scales with distance over the
 * rest of the chunk, like the counts. A part whose damage reaches 1 in a
 * worked-out stretch breaks there, marked `estimated` (it has no trace),
 * and so does a damper whose worked-out oil goes over its red line. The
 * stage stops at the first break.
 *
 * Mode 'full' drives every metre instead; the tests check the two agree.
 *
 * For raids (plan PR 7) a stage can start from wear carried over from the
 * day before (`StageOptions.wear`), keeps a trace of the hottest oil and the
 * worst damage along the way (`StageResult.trace`), and can hand each
 * full-detail sample to a clip recorder for the 3D highlight
 * (`StageOptions.clips`, see `highlight.ts`). Recording only watches: it
 * never changes a result.
 */
import { GROUND, type GroundId } from '../data/ground'
import { LONG_STAGE, type RideSetup } from '../data/ride'
import type { GroundMod } from '../data/weather'
import { FRAME_ZONES, type FailureKind, type WearSetup } from '../data/wear'
import { detExp, detPow } from './det'
import { buildProfile } from './ground'
import { CORNERS, coolingRate, dampingMultiplier, driveSection, restingState, rideParams, type RideStats } from './ride'
import type { Profile } from './ground'
import type { PoseLog } from './poses'
import { Rng } from './rng'
import { damageOf, driveSectionWithWear, newWearRun, worstDamage, type BreakEvent, type DamageSnapshot, type Fatigue, type WearRun, type WearState } from './wear'

export interface StageSegment {
  ground: GroundId
  /** m */
  length: number
  /** m/s */
  speed: number
  /** Weather's change to the ground (a raid stage after the weather turns), or none. */
  mod?: GroundMod
}

export interface StageSpec {
  segments: readonly StageSegment[]
  /** Outside air (K). */
  airTemp: number
  /** Oil temperature at the start (K): one for all four dampers, or one each. Defaults to the air. */
  oilTemp?: number | readonly number[]
}

/**
 * Something that records full-detail samples for the 3D highlight
 * (`highlight.ts`). `start` is asked before each sample is driven and returns
 * a pose log to fill, or null to skip it; `end` gets the road it drove.
 */
export interface ClipSink {
  start(info: { chunk: number; ground: GroundId; speed: number; distance: number; seconds: number }): PoseLog | null
  end(log: PoseLog, profile: Profile, broken: BreakEvent | null): void
}

export interface StageOptions {
  /** Wear carried over (a raid's earlier stages). Copied; the original is never changed. */
  wear?: WearState
  clips?: ClipSink
}

/** The stage as a line: the hottest oil and the most worn part, every so often along the way. */
export interface StageTrace {
  /** Metres from the start. */
  distance: number[]
  /** The hottest damper's oil (K). */
  oil: number[]
  /** The most worn part's damage (0 to 1). */
  wear: number[]
}

export interface StageCheckpoint {
  /** Distance from the start (m). */
  distance: number
  oilTemp: number[]
}

export interface StageResult {
  distance: number
  /** s */
  time: number
  /** Heat each damper made (J). */
  damperEnergy: number[]
  peakTemp: number[]
  endTemp: number[]
  /** Lowest damping multiplier per damper (below 1 = fade). */
  minDamping: number[]
  /** Bottom-outs per corner (an estimate scaled from the samples in 'sampled' mode). */
  bottomOuts: number[]
  /** Seconds with all four wheels in the air (scaled likewise). */
  airTime: number
  /** Oil temperatures at the end of each chunk. */
  checkpoints: StageCheckpoint[]
  /** How many 1/500 s steps actually ran in full detail. */
  stepsSimulated: number
  /** Wear, if the stage was run with a wear setup. */
  wear: StageWear | null
  trace: StageTrace
}

export interface StageWear {
  damage: DamageSnapshot
  /** What broke first (the stage stops there), or null. */
  broken: BreakEvent | null
  /** The whole wear state at the end, to carry on from (plain numbers). */
  state: WearState
}

/** A copy of carried-over wear, ready to start a new stretch: same damage, nothing broken, clock at zero. */
function carriedWear(w: WearState): WearState {
  const copy = structuredClone(w)
  copy.broken = null
  copy.overRed = [0, 0, 0, 0]
  copy.t = 0
  copy.distance = 0
  return copy
}

/** The wear model's fatigue counts that scale over a worked-out stretch, with the failure each one means. */
function wearParts(run: WearRun): { kind: FailureKind; list: Fatigue[] }[] {
  return [
    { kind: 'bottoming', list: run.w.bottoming },
    { kind: 'mount', list: run.w.mount },
    { kind: 'axle', list: run.w.axle },
    { kind: 'tire', list: run.w.tire },
    { kind: 'frame', list: run.w.frame },
  ]
}

function damages(run: WearRun): number[] {
  return wearParts(run).flatMap((part) => part.list.map((f) => f.damage))
}

export type StageMode = 'sampled' | 'full'

export function runStage(
  setup: RideSetup,
  spec: StageSpec,
  seed: number,
  mode: StageMode = 'sampled',
  wear?: WearSetup,
  opts: StageOptions = {},
): StageResult {
  const p = rideParams(setup)
  // No trace on long stages: a raid's break is shown from the stage highlight (plan PR 7).
  const run = wear ? newWearRun(wear, p, false) : null
  if (run && opts.wear) run.w = carriedWear(opts.wear)
  const s = restingState(spec.airTemp)
  const oil = spec.oilTemp ?? spec.airTemp
  for (let i = 0; i < CORNERS; i++) s.oilTemp[i] = typeof oil === 'number' ? oil : (oil[i] ?? spec.airTemp)
  const root = new Rng(seed)
  const wheelbase = setup.cgToFront + setup.cgToRear

  const out: StageResult = {
    distance: 0,
    time: 0,
    damperEnergy: [0, 0, 0, 0],
    peakTemp: s.oilTemp.slice(),
    endTemp: s.oilTemp.slice(),
    minDamping: [1, 1, 1, 1],
    bottomOuts: [0, 0, 0, 0],
    airTime: 0,
    checkpoints: [],
    stepsSimulated: 0,
    wear: null,
    trace: { distance: [], oil: [], wear: [] },
  }
  for (let i = 0; i < CORNERS; i++) out.minDamping[i] = dampingMultiplier(s.oilTemp[i] as number, p.damper[i]!)
  const note = (distance: number, oil: number) => {
    out.trace.distance.push(distance)
    out.trace.oil.push(oil)
    out.trace.wear.push(run ? worstDamage(run.w) : 0)
  }
  note(0, Math.max(...s.oilTemp))

  let chunkIndex = 0
  for (const seg of spec.segments) {
    if (run?.w.broken) break
    if (!(seg.length > 0) || !(seg.speed > 0)) continue
    if (!GROUND[seg.ground]) throw new RangeError(`Unknown ground: ${seg.ground}`)
    const chunks = Math.ceil(seg.length / LONG_STAGE.chunkLength)
    const chunkLen = seg.length / chunks

    for (let c = 0; c < chunks && !run?.w.broken; c++, chunkIndex++) {
      const rng = root.fork(`chunk-${chunkIndex}`)
      // Full mode drives the whole chunk; sampled mode drives the first bit of it.
      const driveLen = mode === 'full' ? chunkLen : Math.min(chunkLen, GROUND[seg.ground].sampleLength)
      const profile = buildProfile(seg.ground, driveLen + wheelbase, rng, seg.mod)
      const sampleStart = s.oilTemp.slice()
      const damageBefore = run ? damages(run) : []
      let stats: RideStats
      if (run) {
        const log = opts.clips?.start({ chunk: chunkIndex, ground: seg.ground, speed: seg.speed, distance: out.distance, seconds: driveLen / seg.speed }) ?? null
        stats = driveSectionWithWear(s, p, run, profile, seg.speed, undefined, log)
        if (log) opts.clips!.end(log, profile, run.w.broken)
        for (let i = 0; i < CORNERS; i++) if (stats.minDamping[i] === Infinity) stats.minDamping[i] = 1
      } else {
        stats = driveSection(s, p, profile, { speed: seg.speed }).stats
      }
      out.stepsSimulated += stats.steps
      out.time += stats.time
      out.distance += stats.distance
      out.airTime += stats.airTime
      for (let i = 0; i < CORNERS; i++) {
        out.damperEnergy[i] = (out.damperEnergy[i] as number) + (stats.damperEnergy[i] as number)
        out.bottomOuts[i] = (out.bottomOuts[i] as number) + (stats.bottomOuts[i] as number)
        out.peakTemp[i] = Math.max(out.peakTemp[i] as number, stats.peakTemp[i] as number, s.oilTemp[i] as number)
        out.minDamping[i] = Math.min(out.minDamping[i] as number, stats.minDamping[i] as number)
      }
      note(out.distance, Math.max(...stats.peakTemp, ...s.oilTemp))

      // The rest of the chunk, worked out rather than driven.
      const rest = chunkLen - stats.distance
      if (rest > 0 && stats.time > 0 && !run?.w.broken) {
        const restTime = rest / seg.speed
        const scale = rest / stats.distance
        const pieceTime = restTime / LONG_STAGE.restSteps
        let fadeAt: FadeAt | null = null
        // The hottest oil at the end of each piece, for the trace.
        const hottest = new Array<number>(LONG_STAGE.restSteps).fill(0)
        for (let i = 0; i < CORNERS; i++) {
          const dm = p.damper[i]!
          const cool = coolingRate(dm, seg.speed) // W/K
          const sampleHeat = (stats.damperEnergy[i] as number) / stats.time // W, the sample's average
          // How hard the damper was damping, on average, during the sample.
          const sampleDamping = dampingMultiplier(((sampleStart[i] as number) + (s.oilTemp[i] as number)) / 2, dm)
          const decay = detExp((-cool * pieceTime) / dm.heatCapacity)
          let temp = s.oilTemp[i] as number
          let heatMade = 0
          for (let k = 0; k < LONG_STAGE.restSteps; k++) {
            const heat =
              sampleHeat * detPow(dampingMultiplier(temp, dm) / sampleDamping, LONG_STAGE.heatFollowsDamping)
            // A heater in a draught: the oil heads for air + heat ÷ cooling, a fixed share closer each second.
            const settle = s.airTemp + heat / cool
            temp = settle + (temp - settle) * decay
            heatMade += heat * pieceTime
            out.peakTemp[i] = Math.max(out.peakTemp[i] as number, temp)
            if (temp > (hottest[k] as number)) hottest[k] = temp
            // A worked-out stretch over the red line is far longer than the fade hold: the damper fades there.
            if (run && temp > dm.redLine && (!fadeAt || k < fadeAt.piece)) {
              fadeAt = { corner: i, piece: k, temp, limit: dm.redLine }
            }
          }
          s.oilTemp[i] = temp
          out.damperEnergy[i] = (out.damperEnergy[i] as number) + heatMade
          out.bottomOuts[i] = (out.bottomOuts[i] as number) + (stats.bottomOuts[i] as number) * scale
          out.minDamping[i] = Math.min(out.minDamping[i] as number, dampingMultiplier(out.peakTemp[i] as number, dm))
        }
        out.airTime += stats.airTime * scale
        // With wear, the stretch may end early at a break: `share` is how much of it was driven.
        const worstBefore = run ? worstDamage(run.w) : 0
        const startDistance = out.distance
        const share = run ? scaleWear(run, damageBefore, scale, rest, restTime, seg.speed, fadeAt) : 1
        out.time += restTime * share
        out.distance += rest * share
        // Trace points along the worked-out stretch: the oil piece by piece, the wear growing evenly.
        const after = run ? worstDamage(run.w) : 0
        const pieces = Math.max(1, Math.ceil(share * LONG_STAGE.restSteps))
        for (let k = 0; k < pieces; k++) {
          const u = Math.min(share, (k + 1) / LONG_STAGE.restSteps) / share
          out.trace.distance.push(startDistance + rest * share * u)
          out.trace.oil.push(hottest[k] as number)
          out.trace.wear.push(worstBefore + (after - worstBefore) * u)
        }
      }
      out.checkpoints.push({ distance: out.distance, oilTemp: s.oilTemp.slice() })
    }
  }
  out.endTemp = s.oilTemp.slice()
  if (run) out.wear = { damage: damageOf(run.w), broken: run.w.broken, state: run.w }
  return out
}

interface FadeAt {
  corner: number
  /** Which piece of the worked-out stretch (0 to restSteps - 1) it went over in. */
  piece: number
  temp: number
  limit: number
}

/**
 * Wear over a worked-out stretch: each part takes `scale` times the damage
 * it took in the sample. The first part to reach 1 (or a damper over its red
 * line) breaks part-way along, at the share of the stretch where it got there.
 * Returns that share (1 if nothing broke).
 */
function scaleWear(
  run: WearRun,
  before: number[],
  scale: number,
  rest: number,
  restTime: number,
  speed: number,
  fadeAt: FadeAt | null,
): number {
  const w = run.w
  const parts = wearParts(run)
  // Find the first thing to break along the stretch, as a share of it (0 to 1).
  let share = 1
  let kind: FailureKind | null = null
  let corner = -1
  let zone = -1
  if (fadeAt) {
    share = (fadeAt.piece + 1) / LONG_STAGE.restSteps
    kind = 'fade'
    corner = fadeAt.corner
  }
  let n = 0
  for (const part of parts) {
    for (let idx = 0; idx < part.list.length; idx++) {
      const f = part.list[idx] as Fatigue
      const added = (f.damage - (before[n++] as number)) * scale
      if (added > 0 && f.damage + added >= 1 && (1 - f.damage) / added < share) {
        share = (1 - f.damage) / added
        kind = part.kind
        corner = part.kind === 'frame' ? -1 : idx
        zone = part.kind === 'frame' ? idx : -1
      }
    }
  }
  // Add the damage up to that point.
  n = 0
  for (const part of parts) {
    for (const f of part.list) {
      const added = (f.damage - (before[n++] as number)) * scale * share
      if (added > 0) f.damage = Math.min(1, f.damage + added)
    }
  }
  w.t += restTime * share
  w.distance += rest * share
  if (kind) {
    const fade = kind === 'fade' && fadeAt !== null
    w.broken = {
      kind,
      corner,
      zone: zone >= 0 ? (FRAME_ZONES[zone] ?? null) : null,
      t: w.t,
      distance: w.distance,
      speed,
      value: fade ? fadeAt.temp : 1,
      limit: fade ? fadeAt.limit : 1,
      fatigue: !fade,
      estimated: true,
    }
  }
  return share
}
