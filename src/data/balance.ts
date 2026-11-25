/**
 * The balance bot's builds and targets (plan PR 2). The bot runs in CI on
 * every pull request (`tests/balance.test.ts`) and checks, for every class:
 *
 * 1. The test mule lasts a few laps on each rig before something lets go,
 *    and breaks inside the class's speed window (not on the first lap, and
 *    not never).
 * 2. Each of the six failures can happen: a build with one weak spot breaks
 *    there first.
 * 3. The fix the report would suggest works: the same build with that fix
 *    goes faster before it breaks, or doesn't break that way.
 *
 * Until the parts arrive (plan PR 3), a "build" is the test mule with a few
 * numbers scaled. Every scale multiplies the mule's own number.
 */
import type { ClassId } from './classes'
import type { RigId } from './rigs'
import type { FailureKind } from './wear'

/** Multipliers on the test mule, front and rear alike. Missing = 1. */
export interface Tweak {
  springRate?: number
  /** Every damping number (compression and rebound, low and high speed). */
  damping?: number
  /** Damper heat capacity: oil volume. */
  damperSize?: number
  bumpStopLength?: number
  droopTravel?: number
  tireRate?: number
  /** What the shock and bump stop cup can take when bottoming. */
  shockStrength?: number
  mountStrength?: number
  axleStrength?: number
  /** Where the tire starts to fold and where it pinches: a tougher or weaker casing. */
  casing?: number
  frameStrength?: number
}

export interface BotBuild {
  id: string
  rig: RigId
  tweak: Tweak
  /** What should break first. */
  expect: FailureKind
  /** The report's fix for it, applied on top of `tweak`. */
  fix: Tweak
  /** A stronger or milder weak spot for one class, used instead of `tweak` there. */
  classTweak?: Partial<Record<ClassId, Tweak>>
}

/** One weak spot per failure, the same idea for every class. */
export const BOT_BUILDS: readonly BotBuild[] = [
  { id: 'small dampers', rig: 'washboardLadder', tweak: { damperSize: 0.6 }, expect: 'fade', fix: { damperSize: 1.6 } },
  { id: 'short bump stops', rig: 'tortureLoop', tweak: { bumpStopLength: 0.35 }, expect: 'bottoming', fix: { bumpStopLength: 2.6 },
    // Slamming a heavy truck's hard stop that hard cuts its tires first; a milder cut still finds the bottoming.
    classTweak: { heavy: { bumpStopLength: 0.55 } } },
  { id: 'weak mounts', rig: 'tortureLoop', tweak: { mountStrength: 0.6 }, expect: 'mount', fix: { mountStrength: 1.5 } },
  { id: 'long droop', rig: 'tortureLoop', tweak: { droopTravel: 1.8 }, expect: 'axle', fix: { droopTravel: 0.6 } },
  { id: 'low pressure', rig: 'tortureLoop', tweak: { tireRate: 0.5 }, expect: 'tire', fix: { tireRate: 1.8 },
    // Truck tires are tough: it takes a lot less air to cut one.
    classTweak: { heavy: { tireRate: 0.35 } } },
  { id: 'soft frame', rig: 'tortureLoop', tweak: { frameStrength: 0.6 }, expect: 'frame', fix: { frameStrength: 1.5 } },
]

/** Lap speeds (km/h) where each class's test mule should first break, per rig. */
export const MULE_WINDOWS: Readonly<Record<ClassId, Record<RigId, readonly [number, number]>>> = {
  light4x4: { washboardLadder: [50, 110], tortureLoop: [45, 80] },
  heavy: { washboardLadder: [50, 110], tortureLoop: [40, 75] },
  sxs: { washboardLadder: [40, 80], tortureLoop: [40, 80] },
}

/** The seeds the bot drives on, so one lucky road can't pass the checks. */
export const BOT_SEEDS: readonly number[] = [11, 12]

/** Air temperature for the bot's runs (°C). */
export const BOT_AIR_C = 20
