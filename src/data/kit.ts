/**
 * What each class's build is made of (plan PR 3): the parts in each slot,
 * the settings a player tunes, their ranges, and the stock build.
 *
 * Settings live on the build, front and rear apart, in SI units like the
 * rest of the sim (N/m, m, Pa). The screen shows N/mm, mm and kPa.
 *
 * How the ride height works (the balance bot asked for this, `docs/WEAR.md`):
 * the suspension has a fixed total travel, from full droop (shock fully out)
 * to the hard limit. The truck's weight squashes the spring part of the way
 * in; that is the **sag**. Wheel travel left for bumps is the total minus the
 * sag, and the droop below ride height is the sag. So a softer spring sits
 * lower, with less travel up to the bump stop. Spring **preload** squashes
 * the spring before it's fitted, which takes some of the sag away and lifts
 * the truck. A **limit strap** stops the wheel dropping further than its
 * length, which cuts the droop (and the joint angle) without lifting the
 * truck.
 */
import type { ClassId } from './classes'
import type { TruckLoad } from './load'
import type { SlotId } from './parts'

export interface AxleSettings {
  /** Spring wheel rate (N/m). */
  springRate: number
  /** Spring preload (m of spring squashed before fitting): lifts the truck. */
  preload: number
  /** Damper adjuster clicks from the middle: + is firmer, - softer, 0 as the factory set it. */
  compLow: number
  compHigh: number
  rebound: number
  /** Bump stop length (m). */
  bumpStop: number
  /** Limit strap: the most the wheel may drop below ride height (m). Longer than the sag means slack. */
  droopLimit: number
  /** Tire pressure (Pa, above the air outside). */
  tirePressure: number
  /** Adjustable anti-roll bar position from the middle: + is stiffer. Ignored on fixed bars. */
  antiRoll: number
}

export interface TruckBuild {
  cls: ClassId
  /** The part id in each slot (`src/data/parts.ts`). */
  parts: Record<SlotId, string>
  front: AxleSettings
  rear: AxleSettings
  /**
   * Where the spares and tools ride, and the fuel (weight and balance,
   * `src/data/load.ts`). Missing means the stock load, so builds saved
   * before it read the same.
   */
  load?: TruckLoad
}

/** A setting's range on the build screen. */
export interface Range {
  min: number
  max: number
  step: number
}

export interface ClassKit {
  /** Body, cab, cage, seats, crew of two and fuel: everything that isn't a part (kg). */
  baseMass: number
  /** Money for the shop's test builds until the career brings real money (plan PR 9) (cr.). */
  budget: number
  /** Total wheel travel with the class's reference suspension, full droop to hard limit (m). */
  travel: number
  /** Where the axle or CV joint runs straight, measured up from full droop (m), for the reference suspension. */
  straightFromDroop: number
  /** The pressure the test mule's tire stiffness was measured at (Pa). */
  refPressure: number
  ranges: {
    springRate: Range
    preload: Range
    bumpStop: Range
    droopLimit: Range
    tirePressure: Range
  }
  /** Lowest tire pressure on beadlock wheels (Pa). */
  beadlockMinPressure: number
  stock: TruckBuild
}

/** Fixed numbers for how parts and settings turn into a truck. */
export const TUNE = {
  /** Each damper click changes that adjuster's damping by this share (compounding). */
  clickStep: 0.07,
  /** Each anti-roll bar position changes its stiffness by this share of the middle. */
  antiRollStep: 0.25,
  /** Positions each way from the middle on an adjustable bar. */
  antiRollPositions: 2,
  /** Share of a tire's stiffness that comes from its casing; the rest comes from the air, so it follows the pressure. */
  casingShare: 0.25,
  /** Ride height never leaves less than this much droop or bump travel (m). */
  minDroop: 0.02,
  minBump: 0.03,
  /** A bump stop always leaves this much travel before it touches (m). */
  bumpStopRoom: 0.01,
} as const

const mm = 0.001
const kPa = 1000
/** A stock axle: dampers in the middle, bar in the middle, limit strap let all the way out (slack). */
function axle(springRate: number, preload: number, bumpStop: number, tirePressure: number, slackStrap: number): AxleSettings {
  return { springRate, preload, compLow: 0, compHigh: 0, rebound: 0, bumpStop, droopLimit: slackStrap, tirePressure, antiRoll: 0 }
}

/**
 * The stock builds use parts that are all "1" (`src/data/parts.ts`), with the
 * mule's spring rates and bump stops, and preload picked so the ride height
 * lands where the mule's was. So they drive like the test mules.
 */
export const KITS: Readonly<Record<ClassId, ClassKit>> = {
  light4x4: {
    baseMass: 1114,
    budget: 40000,
    travel: 0.3,
    straightFromDroop: 0.17,
    refPressure: 180 * kPa,
    ranges: {
      springRate: { min: 20000, max: 50000, step: 1000 },
      preload: { min: 0, max: 40 * mm, step: 1 * mm },
      bumpStop: { min: 30 * mm, max: 100 * mm, step: 5 * mm },
      droopLimit: { min: 40 * mm, max: 200 * mm, step: 5 * mm },
      tirePressure: { min: 100 * kPa, max: 300 * kPa, step: 5 * kPa },
    },
    beadlockMinPressure: 60 * kPa,
    stock: {
      cls: 'light4x4',
      parts: {
        frame: 'ladder', frontSusp: 'solidAxleCoil', rearSusp: 'coilLink', dampers: 'monotube', bumpStops: 'rubber',
        antiRoll: 'fixedBars', axles: 'standardAxles', wheels: 'steelWheels', tires: 'rallyTires',
        protection: 'skidPlates', engine: 'petrolSix', lightBar: 'noLightBar', spots: 'noSpots', spares: 'noSpares',
      },
      front: axle(32000, 5 * mm, 60 * mm, 180 * kPa, 200 * mm),
      rear: axle(30000, 0, 60 * mm, 180 * kPa, 200 * mm),
    },
  },
  heavy: {
    baseMass: 5250,
    budget: 140000,
    travel: 0.28,
    straightFromDroop: 0.16,
    refPressure: 350 * kPa,
    ranges: {
      springRate: { min: 80000, max: 220000, step: 5000 },
      preload: { min: 0, max: 50 * mm, step: 1 * mm },
      bumpStop: { min: 30 * mm, max: 120 * mm, step: 5 * mm },
      droopLimit: { min: 40 * mm, max: 200 * mm, step: 5 * mm },
      tirePressure: { min: 200 * kPa, max: 500 * kPa, step: 10 * kPa },
    },
    beadlockMinPressure: 140 * kPa,
    stock: {
      cls: 'heavy',
      parts: {
        frame: 'ladder', frontSusp: 'beamLeaf', rearSusp: 'rearBeamLeaf', dampers: 'monotube', bumpStops: 'rubber',
        antiRoll: 'fixedBars', axles: 'standardAxles', wheels: 'steelWheels', tires: 'rallyTires',
        protection: 'skidPlates', engine: 'dieselSix', lightBar: 'noLightBar', spots: 'noSpots', spares: 'noSpares',
      },
      front: axle(130000, 16 * mm, 60 * mm, 350 * kPa, 200 * mm),
      rear: axle(140000, 20 * mm, 60 * mm, 350 * kPa, 200 * mm),
    },
  },
  sxs: {
    baseMass: 696,
    budget: 22000,
    // About a third of it is sag, as on a real side-by-side, which leaves 29 cm of bump travel.
    travel: 0.45,
    straightFromDroop: 0.25,
    refPressure: 100 * kPa,
    ranges: {
      springRate: { min: 8000, max: 22000, step: 500 },
      preload: { min: 0, max: 40 * mm, step: 1 * mm },
      bumpStop: { min: 30 * mm, max: 120 * mm, step: 5 * mm },
      droopLimit: { min: 40 * mm, max: 300 * mm, step: 5 * mm },
      tirePressure: { min: 60 * kPa, max: 170 * kPa, step: 5 * kPa },
    },
    beadlockMinPressure: 35 * kPa,
    stock: {
      cls: 'sxs',
      parts: {
        frame: 'tubeFrame', frontSusp: 'sxsWishbone', rearSusp: 'sxsTrailing', dampers: 'monotube', bumpStops: 'rubber',
        antiRoll: 'fixedBars', axles: 'standardAxles', wheels: 'steelWheels', tires: 'rallyTires',
        protection: 'skidPlates', engine: 'twin', lightBar: 'noLightBar', spots: 'noSpots', spares: 'noSpares',
      },
      front: axle(13000, 0, 70 * mm, 100 * kPa, 300 * mm),
      rear: axle(12500, 0, 70 * mm, 100 * kPa, 300 * mm),
    },
  },
}
