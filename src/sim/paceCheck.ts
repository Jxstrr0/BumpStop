/**
 * The pace check (playtest, 26 November 2026): for each kind of ground and
 * each pace call, drive a long stretch with the raid's own ride sim and
 * report how hot the dampers settle and how fast the worst part wears. The
 * raid morning shows it for the day's ground; the rig reports show it for
 * the ground each rig stands for. Numbers in `src/data/paceCheck.ts`.
 *
 * It's the same physics as a stage (`runStage`, sampled), on its own seeded
 * road, with fresh parts (wear already on the truck is the bivouac's
 * business), starting with the oil at air temperature. So it's a fair
 * guide, not a promise: a real stage strings pieces together, so the oil
 * can start warm, and the weather can turn.
 */
import { PACE_SPEED, PACES, RAID, STEADY_KMH, type DriverId, type PaceId, type RaidGround } from '../data/raids'
import { PACE_CHECK } from '../data/paceCheck'
import type { FailureKind } from '../data/wear'
import type { BuiltTruck } from './build'
import { groundSpeed, powerFactor, studFactor } from './raid'
import { hashString } from './rng'
import { runStage } from './stage'
import { fromCelsius } from './units'
import { newWearState, worstDamage } from './wear'

/** Normal, Warm or Over the limit: the trace rule's three words. */
export type CheckBand = 'cool' | 'warm' | 'hot'

export interface GroundCheck {
  ground: RaidGround
  pace: PaceId
  /** Speed driven (m/s). */
  speed: number
  /** Hottest any damper got (K), and its band against that damper's warm and red lines. */
  oil: number
  oilBand: CheckBand
  /** The worst part's wear over 10 km (share of its life; 1 or more means it breaks inside 10 km). */
  wear10: number
  wearBand: CheckBand
  /** What let go on the stretch, if anything: 'fade' when the dampers cooked. */
  broke: FailureKind | null
}

/** One pace call's verdict over all the ground checked: the worst oil and the worst wear, and where. */
export interface PaceVerdict {
  pace: PaceId
  worstOil: GroundCheck
  worstWear: GroundCheck
  /** The worse of the two bands: what colour and word the line gets. */
  band: CheckBand
}

const RANK: Record<CheckBand, number> = { cool: 0, warm: 1, hot: 2 }
const worse = (a: CheckBand, b: CheckBand): CheckBand => (RANK[a] >= RANK[b] ? a : b)

/** The speed an average driver (no quicker or harder than par) takes this ground at: `groundSpeed` without the driver (m/s). */
function averageSpeed(truck: BuiltTruck, ground: RaidGround, pace: PaceId): number {
  const v = (STEADY_KMH[truck.build.cls][ground] / 3.6) * PACE_SPEED[pace] * studFactor(truck, ground)
  return RAID.fastGround.includes(ground) ? v * powerFactor(truck) : v
}

/** One ground at one pace call. `driver` null is an average driver (the shop's check). */
export function checkGround(truck: BuiltTruck, driver: DriverId | null, ground: RaidGround, pace: PaceId, airC: number): GroundCheck {
  const speed = driver ? groundSpeed(truck, driver, ground, pace) : averageSpeed(truck, ground, pace)
  const air = fromCelsius(airC)
  const res = runStage(
    truck.ride,
    { airTemp: air, segments: [{ ground, length: PACE_CHECK.length, speed }] },
    hashString(`${PACE_CHECK.seed}:${ground}`),
    'sampled',
    truck.wear,
    { wear: newWearState() },
  )
  let oil = air
  let band: CheckBand = 'cool'
  for (let i = 0; i < 4; i++) {
    const t = res.peakTemp[i] as number
    const d = (i < 2 ? truck.ride.front : truck.ride.rear).damper
    const b: CheckBand = t >= d.redLine ? 'hot' : t >= d.warmFrom ? 'warm' : 'cool'
    oil = Math.max(oil, t)
    band = worse(band, b)
  }
  const broke = res.wear?.broken?.kind ?? null
  if (broke === 'fade') band = 'hot'
  const driven = Math.max(1, res.distance)
  // A break means the part's life ran out inside the stretch.
  const wear10 = broke && broke !== 'fade' ? Math.max(1, 10000 / driven) : (worstDamage(res.wear!.state) * 10000) / driven
  const wearBand: CheckBand = wear10 >= PACE_CHECK.wearHot ? 'hot' : wear10 >= PACE_CHECK.wearWarm ? 'warm' : 'cool'
  return { ground, pace, speed, oil, oilBand: band, wear10, wearBand, broke }
}

/** The ground of a list worth checking: each kind once, in order, without the smooth fast stuff. */
export function groundsToCheck(grounds: readonly RaidGround[]): RaidGround[] {
  return [...new Set(grounds)].filter((g) => !PACE_CHECK.skip.includes(g))
}

/**
 * Every pace call over some ground. `grounds` should already be
 * `groundsToCheck`ed; with none left, the verdicts are null.
 */
export function paceCheck(truck: BuiltTruck, driver: DriverId | null, grounds: readonly RaidGround[], airC: number): PaceVerdict[] | null {
  if (!grounds.length) return null
  return PACES.map((pace) => verdict(pace, grounds.map((g) => checkGround(truck, driver, g, pace, airC))))
}

/** The verdict for one pace call from its ground checks. */
export function verdict(pace: PaceId, checks: readonly GroundCheck[]): PaceVerdict {
  // The hottest by band first (a faded damper counts as over the limit whatever the number), then by temperature.
  const worstOil = checks.reduce((a, b) => (RANK[b.oilBand] > RANK[a.oilBand] || (b.oilBand === a.oilBand && b.oil > a.oil) ? b : a))
  const worstWear = checks.reduce((a, b) => (b.wear10 > a.wear10 ? b : a))
  return { pace, worstOil, worstWear, band: worse(worstOil.oilBand, worstWear.wearBand) }
}
