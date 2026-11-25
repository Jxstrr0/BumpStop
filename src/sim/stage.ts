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
 */
import { GROUND, type GroundId } from '../data/ground'
import { LONG_STAGE, type RideSetup } from '../data/ride'
import { FRAME_ZONES, type FailureKind, type WearSetup } from '../data/wear'
import { detExp, detPow } from './det'
import { buildProfile } from './ground'
import { CORNERS, coolingRate, dampingMultiplier, driveSection, restingState, rideParams, type RideStats } from './ride'
import { Rng } from './rng'
import { damageOf, driveSectionWithWear, newWearRun, type BreakEvent, type DamageSnapshot, type Fatigue, type WearRun } from './wear'

export interface StageSegment {
  ground: GroundId
  /** m */
  length: number
  /** m/s */
  speed: number
}

export interface StageSpec {
  segments: readonly StageSegment[]
  /** Outside air (K). */
  airTemp: number
  /** Oil temperature at the start (K); defaults to the air. */
  oilTemp?: number
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
}

export interface StageWear {
  damage: DamageSnapshot
  /** What broke first (the stage stops there), or null. */
  broken: BreakEvent | null
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
): StageResult {
  const p = rideParams(setup)
  // No trace on long stages: a raid's break is shown from the stage highlight (plan PR 7).
  const run = wear ? newWearRun(wear, p, false) : null
  const s = restingState(spec.airTemp, spec.oilTemp)
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
  }
  for (let i = 0; i < CORNERS; i++) out.minDamping[i] = dampingMultiplier(s.oilTemp[i] as number, p.damper[i]!)

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
      const profile = buildProfile(seg.ground, driveLen + wheelbase, rng)
      const sampleStart = s.oilTemp.slice()
      const damageBefore = run ? damages(run) : []
      let stats: RideStats
      if (run) {
        stats = driveSectionWithWear(s, p, run, profile, seg.speed)
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

      // The rest of the chunk, worked out rather than driven.
      const rest = chunkLen - stats.distance
      if (rest > 0 && stats.time > 0 && !run?.w.broken) {
        const restTime = rest / seg.speed
        const scale = rest / stats.distance
        const pieceTime = restTime / LONG_STAGE.restSteps
        let fadeAt: FadeAt | null = null
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
        const share = run ? scaleWear(run, damageBefore, scale, rest, restTime, seg.speed, fadeAt) : 1
        out.time += restTime * share
        out.distance += rest * share
      }
      out.checkpoints.push({ distance: out.distance, oilTemp: s.oilTemp.slice() })
    }
  }
  out.endTemp = s.oilTemp.slice()
  if (run) out.wear = { damage: damageOf(run.w), broken: run.w.broken }
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
