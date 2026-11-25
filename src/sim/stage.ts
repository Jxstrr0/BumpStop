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
 * Mode 'full' drives every metre instead; the tests check the two agree.
 */
import { GROUND, type GroundId } from '../data/ground'
import { LONG_STAGE, type RideSetup } from '../data/ride'
import { detExp, detPow } from './det'
import { buildProfile } from './ground'
import { CORNERS, coolingRate, dampingMultiplier, driveSection, restingState, rideParams } from './ride'
import { Rng } from './rng'

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
}

export type StageMode = 'sampled' | 'full'

export function runStage(setup: RideSetup, spec: StageSpec, seed: number, mode: StageMode = 'sampled'): StageResult {
  const p = rideParams(setup)
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
  }
  for (let i = 0; i < CORNERS; i++) out.minDamping[i] = dampingMultiplier(s.oilTemp[i] as number, p.damper[i]!)

  let chunkIndex = 0
  for (const seg of spec.segments) {
    if (!(seg.length > 0) || !(seg.speed > 0)) continue
    if (!GROUND[seg.ground]) throw new RangeError(`Unknown ground: ${seg.ground}`)
    const chunks = Math.ceil(seg.length / LONG_STAGE.chunkLength)
    const chunkLen = seg.length / chunks

    for (let c = 0; c < chunks; c++, chunkIndex++) {
      const rng = root.fork(`chunk-${chunkIndex}`)
      // Full mode drives the whole chunk; sampled mode drives the first bit of it.
      const driveLen = mode === 'full' ? chunkLen : Math.min(chunkLen, GROUND[seg.ground].sampleLength)
      const profile = buildProfile(seg.ground, driveLen + wheelbase, rng)
      const sampleStart = s.oilTemp.slice()
      const { stats } = driveSection(s, p, profile, { speed: seg.speed })
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
      if (rest > 0 && stats.time > 0) {
        const restTime = rest / seg.speed
        const scale = rest / stats.distance
        const pieceTime = restTime / LONG_STAGE.restSteps
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
          }
          s.oilTemp[i] = temp
          out.damperEnergy[i] = (out.damperEnergy[i] as number) + heatMade
          out.bottomOuts[i] = (out.bottomOuts[i] as number) + (stats.bottomOuts[i] as number) * scale
          out.minDamping[i] = Math.min(out.minDamping[i] as number, dampingMultiplier(out.peakTemp[i] as number, dm))
        }
        out.airTime += stats.airTime * scale
        out.time += restTime
        out.distance += rest
      }
      out.checkpoints.push({ distance: out.distance, oilTemp: s.oilTemp.slice() })
    }
  }
  out.endTemp = s.oilTemp.slice()
  return out
}
