/**
 * The parts (plan PR 3): every part a player can bolt on, for all three
 * classes. `src/sim/build.ts` turns a build (one part per slot, plus the
 * settings in `src/data/kit.ts`) into the numbers the ride sim and the wear
 * model drive.
 *
 * How to read a part:
 * - `mass` and `cost` are listed per class: kilograms for the whole truck
 *   (all four corners), and antlers. A part only exists in the classes it
 *   lists, so a heavy-truck-only part has just a `heavy` number.
 * - `year` is the first year it can be bought (the career runs 1985 to 2025).
 * - The other numbers are multipliers on the class's test mule
 *   (`src/data/ride.ts` and `src/data/wear.ts`), so 1 means "the same as the
 *   mule". Each class's stock build (`src/data/kit.ts`) uses parts that are
 *   all 1, which is why it drives like the mule the balance bot was tuned on.
 *
 * No part makers are named yet: names wait on Kelbo's OK (`docs/NAMES.md`).
 */
import type { ClassId } from './classes'
import type { StringKey } from './strings'

/** The part slots, in the order the build screen shows them. */
export type SlotId =
  | 'frame'
  | 'frontSusp'
  | 'rearSusp'
  | 'dampers'
  | 'bumpStops'
  | 'antiRoll'
  | 'axles'
  | 'wheels'
  | 'tires'
  | 'protection'
  | 'engine'
  | 'spares'

/** The era the game covers: the first and last year a build can be set to. */
export const FIRST_YEAR = 1985
export const LAST_YEAR = 2025

export const SLOTS: readonly SlotId[] = [
  'frame',
  'frontSusp',
  'rearSusp',
  'dampers',
  'bumpStops',
  'antiRoll',
  'axles',
  'wheels',
  'tires',
  'protection',
  'engine',
  'spares',
]

/** One number per class; a missing class means the part doesn't come in that size. */
export type PerClass = Readonly<Partial<Record<ClassId, number>>>

interface PartCommon {
  id: string
  name: StringKey
  /** One line on what it trades. */
  text: StringKey
  /** First year it can be bought. */
  year: number
  /** Kilograms, whole truck. */
  mass: PerClass
  /** Antlers. */
  cost: PerClass
}

export interface FramePart extends PartCommon {
  slot: 'frame'
  /** Fatigue strength of all three frame zones. */
  strength: number
}

export interface SuspensionPart extends PartCommon {
  slot: 'frontSusp' | 'rearSusp'
  /** Total wheel travel, top to bottom (the class's `travel` times this). */
  travel: number
  /** Weight that moves with the wheel. */
  unsprung: number
  /** Joint to wheel distance: longer arms bend the axle or CV joint less for the same travel. */
  arm: number
  /** How far the axle or CV joint can bend before it binds. */
  maxAngle: number
  /** Strength of the shock and spring mounts. */
  mount: number
}

export interface DamperPart extends PartCommon {
  slot: 'dampers'
  /** Oil and body that soak up heat: bigger takes longer to cook. */
  heat: number
  /** Outside area that sheds heat. */
  cool: number
  /** Kelvin added to the temperatures where the oil foams, turns warm and goes over the limit. */
  tempLimit: number
  /** Clicks each way from the middle on each adjuster (0 = no adjuster, set at the factory). */
  clicks: { compLow: number; compHigh: number; rebound: number }
}

export interface BumpStopPart extends PartCommon {
  slot: 'bumpStops'
  /** Stiffness at first touch. */
  rate: number
  /** How many times stiffer it is when fully squashed (the mule's is 8). */
  progression: number
  /** What the shock and bump stop cup can take when the wheel bottoms out. */
  strength: number
}

export interface AntiRollPart extends PartCommon {
  slot: 'antiRoll'
  rate: number
  /** Has a stiffness setting. */
  adjustable: boolean
}

export interface AxlePart extends PartCommon {
  slot: 'axles'
  /** Torque it takes. */
  strength: number
  unsprung: number
}

export interface WheelPart extends PartCommon {
  slot: 'wheels'
  unsprung: number
  /** Clamps the tire to the rim, so it can run lower pressure without coming off. */
  beadlock: boolean
}

export interface TirePart extends PartCommon {
  slot: 'tires'
  /** Stiffness of the casing itself, at the same pressure. */
  stiffness: number
  /** How far it squashes before the sidewall folds and the rim pinches it: a tougher casing. */
  casing: number
  unsprung: number
  /** Studs for winter (plan PR 10): more grip on ice and snow, nothing on gravel. */
  studded: boolean
}

/** Guards against rock hits; they start to count in the raids (plan PR 7). */
export interface ProtectionPart extends PartCommon {
  slot: 'protection'
}

export interface EnginePart extends PartCommon {
  slot: 'engine'
  /** Peak power (W), shown on screen; the pace it allows arrives with the raids. */
  power: number
  /** Torque at the wheels, which sets how hard a spinning wheel lands. */
  torque: number
}

/** The spares a truck can carry for roadside fixes and the bivouac (plan PR 7). */
export type SpareId = 'tire' | 'shock' | 'cv'
export const SPARE_IDS: readonly SpareId[] = ['tire', 'shock', 'cv']

/** Spares carried for roadside fixes and the bivouac (plan PR 7): weight now, repairs later. */
export interface SparesPart extends PartCommon {
  slot: 'spares'
  /** How many of each spare the kit holds. */
  carries: Readonly<Record<SpareId, number>>
}

export type Part =
  | FramePart
  | SuspensionPart
  | DamperPart
  | BumpStopPart
  | AntiRollPart
  | AxlePart
  | WheelPart
  | TirePart
  | ProtectionPart
  | EnginePart
  | SparesPart

/** The part type that fits a slot. */
export type PartIn<S extends SlotId> = Extract<Part, { slot: S }> | (S extends 'rearSusp' | 'frontSusp' ? SuspensionPart : never)

const kW = 1000

export const PARTS: readonly Part[] = [
  // ── Frame ──
  { slot: 'frame', id: 'ladder', name: 'part.ladder', text: 'part.ladderText', year: 1985,
    mass: { light4x4: 180, heavy: 900 }, cost: { light4x4: 3000, heavy: 9000 }, strength: 1 },
  { slot: 'frame', id: 'boxedLadder', name: 'part.boxedLadder', text: 'part.boxedLadderText', year: 1985,
    mass: { light4x4: 230, heavy: 1150 }, cost: { light4x4: 6500, heavy: 18000 }, strength: 1.5 },
  { slot: 'frame', id: 'spaceframe', name: 'part.spaceframe', text: 'part.spaceframeText', year: 1993,
    mass: { light4x4: 150 }, cost: { light4x4: 16000 }, strength: 1.3 },
  { slot: 'frame', id: 'tubeFrame', name: 'part.tubeFrame', text: 'part.tubeFrameText', year: 1985,
    mass: { sxs: 70 }, cost: { sxs: 2500 }, strength: 1 },
  { slot: 'frame', id: 'gussetedTube', name: 'part.gussetedTube', text: 'part.gussetedTubeText', year: 1985,
    mass: { sxs: 85 }, cost: { sxs: 4500 }, strength: 1.5 },
  { slot: 'frame', id: 'chromolyTube', name: 'part.chromolyTube', text: 'part.chromolyTubeText', year: 1996,
    mass: { sxs: 60 }, cost: { sxs: 9000 }, strength: 1.35 },

  // ── Front suspension ──
  { slot: 'frontSusp', id: 'solidAxleCoil', name: 'part.solidAxleCoil', text: 'part.solidAxleCoilText', year: 1985,
    mass: { light4x4: 85 }, cost: { light4x4: 4000 }, travel: 1, unsprung: 1, arm: 1, maxAngle: 1, mount: 1 },
  { slot: 'frontSusp', id: 'solidAxleLeaf', name: 'part.solidAxleLeaf', text: 'part.solidAxleLeafText', year: 1985,
    mass: { light4x4: 95 }, cost: { light4x4: 2500 }, travel: 0.85, unsprung: 1.1, arm: 1, maxAngle: 1, mount: 1.25 },
  { slot: 'frontSusp', id: 'wishbone', name: 'part.wishbone', text: 'part.wishboneText', year: 1992,
    mass: { light4x4: 80 }, cost: { light4x4: 11000 }, travel: 1.15, unsprung: 0.75, arm: 0.9, maxAngle: 0.95, mount: 1 },
  { slot: 'frontSusp', id: 'beamLeaf', name: 'part.beamLeaf', text: 'part.beamLeafText', year: 1985,
    mass: { heavy: 420 }, cost: { heavy: 8000 }, travel: 1, unsprung: 1, arm: 1, maxAngle: 1, mount: 1 },
  { slot: 'frontSusp', id: 'beamCoil', name: 'part.beamCoil', text: 'part.beamCoilText', year: 1990,
    mass: { heavy: 400 }, cost: { heavy: 16000 }, travel: 1.15, unsprung: 0.95, arm: 1, maxAngle: 1, mount: 0.9 },
  { slot: 'frontSusp', id: 'sxsWishbone', name: 'part.wishbone', text: 'part.sxsWishboneText', year: 1985,
    mass: { sxs: 30 }, cost: { sxs: 2000 }, travel: 1, unsprung: 1, arm: 1, maxAngle: 1, mount: 1 },
  { slot: 'frontSusp', id: 'longArms', name: 'part.longArms', text: 'part.longArmsText', year: 2004,
    mass: { sxs: 34 }, cost: { sxs: 5500 }, travel: 1.2, unsprung: 1.05, arm: 1.15, maxAngle: 1, mount: 1 },

  // ── Rear suspension ──
  { slot: 'rearSusp', id: 'coilLink', name: 'part.coilLink', text: 'part.coilLinkText', year: 1985,
    mass: { light4x4: 80 }, cost: { light4x4: 4000 }, travel: 1, unsprung: 1, arm: 1, maxAngle: 1, mount: 1 },
  { slot: 'rearSusp', id: 'leafAxle', name: 'part.leafAxle', text: 'part.leafAxleText', year: 1985,
    mass: { light4x4: 90 }, cost: { light4x4: 2000 }, travel: 0.85, unsprung: 1.1, arm: 1, maxAngle: 1, mount: 1.25 },
  { slot: 'rearSusp', id: 'trailingArm', name: 'part.trailingArm', text: 'part.trailingArmText', year: 1995,
    mass: { light4x4: 78 }, cost: { light4x4: 9000 }, travel: 1.2, unsprung: 0.8, arm: 0.85, maxAngle: 1, mount: 1 },
  { slot: 'rearSusp', id: 'rearBeamLeaf', name: 'part.beamLeaf', text: 'part.beamLeafText', year: 1985,
    mass: { heavy: 450 }, cost: { heavy: 8000 }, travel: 1, unsprung: 1, arm: 1, maxAngle: 1, mount: 1 },
  { slot: 'rearSusp', id: 'rearBeamCoil', name: 'part.beamCoil', text: 'part.beamCoilText', year: 1990,
    mass: { heavy: 430 }, cost: { heavy: 16000 }, travel: 1.15, unsprung: 0.95, arm: 1, maxAngle: 1, mount: 0.9 },
  { slot: 'rearSusp', id: 'sxsTrailing', name: 'part.sxsTrailing', text: 'part.sxsTrailingText', year: 1985,
    mass: { sxs: 30 }, cost: { sxs: 2000 }, travel: 1, unsprung: 1, arm: 1, maxAngle: 1, mount: 1 },
  { slot: 'rearSusp', id: 'longTrailing', name: 'part.longTrailing', text: 'part.longTrailingText', year: 2006,
    mass: { sxs: 35 }, cost: { sxs: 6000 }, travel: 1.2, unsprung: 1.05, arm: 1.15, maxAngle: 1, mount: 1 },

  // ── Dampers (all four corners) ──
  { slot: 'dampers', id: 'twinTube', name: 'part.twinTube', text: 'part.twinTubeText', year: 1985,
    mass: { light4x4: 10, heavy: 50, sxs: 6 }, cost: { light4x4: 800, heavy: 3000, sxs: 600 },
    heat: 0.7, cool: 0.85, tempLimit: -15, clicks: { compLow: 0, compHigh: 0, rebound: 0 } },
  { slot: 'dampers', id: 'monotube', name: 'part.monotube', text: 'part.monotubeText', year: 1985,
    mass: { light4x4: 12, heavy: 60, sxs: 7 }, cost: { light4x4: 2000, heavy: 6000, sxs: 1400 },
    heat: 1, cool: 1, tempLimit: 0, clicks: { compLow: 0, compHigh: 0, rebound: 4 } },
  { slot: 'dampers', id: 'remoteReservoir', name: 'part.remoteReservoir', text: 'part.remoteReservoirText', year: 1990,
    mass: { light4x4: 18, heavy: 90, sxs: 10 }, cost: { light4x4: 5500, heavy: 16000, sxs: 4000 },
    heat: 1.6, cool: 1.25, tempLimit: 10, clicks: { compLow: 3, compHigh: 0, rebound: 3 } },
  // A real bypass shock also damps by position (soft mid-stroke, firm near the end); that arrives with the rigs' tuning.
  { slot: 'dampers', id: 'bypass', name: 'part.bypass', text: 'part.bypassText', year: 1996,
    mass: { light4x4: 26, heavy: 130, sxs: 15 }, cost: { light4x4: 9500, heavy: 28000, sxs: 7000 },
    heat: 2.2, cool: 1.5, tempLimit: 10, clicks: { compLow: 4, compHigh: 4, rebound: 4 } },
  { slot: 'dampers', id: 'internalBypass', name: 'part.internalBypass', text: 'part.internalBypassText', year: 2008,
    mass: { light4x4: 20, heavy: 100, sxs: 11 }, cost: { light4x4: 11000, heavy: 32000, sxs: 8000 },
    heat: 1.8, cool: 1.35, tempLimit: 15, clicks: { compLow: 4, compHigh: 4, rebound: 4 } },
  { slot: 'dampers', id: 'electronic', name: 'part.electronic', text: 'part.electronicText', year: 2016,
    mass: { light4x4: 22, heavy: 110, sxs: 12 }, cost: { light4x4: 18000, heavy: 50000, sxs: 13000 },
    heat: 1.9, cool: 1.4, tempLimit: 20, clicks: { compLow: 4, compHigh: 4, rebound: 4 } },

  // ── Bump stops ──
  { slot: 'bumpStops', id: 'rubber', name: 'part.rubber', text: 'part.rubberText', year: 1985,
    mass: { light4x4: 2, heavy: 10, sxs: 1 }, cost: { light4x4: 200, heavy: 800, sxs: 150 }, rate: 1, progression: 8, strength: 1 },
  { slot: 'bumpStops', id: 'urethane', name: 'part.urethane', text: 'part.urethaneText', year: 1985,
    mass: { light4x4: 2, heavy: 10, sxs: 1 }, cost: { light4x4: 600, heavy: 2000, sxs: 400 }, rate: 1.2, progression: 10, strength: 1.2 },
  { slot: 'bumpStops', id: 'hydraulic', name: 'part.hydraulic', text: 'part.hydraulicText', year: 2003,
    mass: { light4x4: 8, heavy: 40, sxs: 4 }, cost: { light4x4: 4500, heavy: 14000, sxs: 3000 }, rate: 1.5, progression: 5, strength: 1.8 },

  // ── Anti-roll bars ──
  { slot: 'antiRoll', id: 'noBars', name: 'part.noBars', text: 'part.noBarsText', year: 1985,
    mass: { light4x4: 0, heavy: 0, sxs: 0 }, cost: { light4x4: 0, heavy: 0, sxs: 0 }, rate: 0, adjustable: false },
  { slot: 'antiRoll', id: 'fixedBars', name: 'part.fixedBars', text: 'part.fixedBarsText', year: 1985,
    mass: { light4x4: 12, heavy: 60, sxs: 5 }, cost: { light4x4: 600, heavy: 2000, sxs: 400 }, rate: 1, adjustable: false },
  { slot: 'antiRoll', id: 'adjustableBars', name: 'part.adjustableBars', text: 'part.adjustableBarsText', year: 1990,
    mass: { light4x4: 14, heavy: 70, sxs: 6 }, cost: { light4x4: 1800, heavy: 5000, sxs: 1200 }, rate: 1, adjustable: true },

  // ── Axles and CV joints ──
  { slot: 'axles', id: 'standardAxles', name: 'part.standardAxles', text: 'part.standardAxlesText', year: 1985,
    mass: { light4x4: 60, heavy: 300, sxs: 20 }, cost: { light4x4: 1500, heavy: 6000, sxs: 900 }, strength: 1, unsprung: 1 },
  { slot: 'axles', id: 'heavyDutyAxles', name: 'part.heavyDutyAxles', text: 'part.heavyDutyAxlesText', year: 1985,
    mass: { light4x4: 80, heavy: 400, sxs: 28 }, cost: { light4x4: 4000, heavy: 14000, sxs: 2500 }, strength: 1.5, unsprung: 1.08 },
  { slot: 'axles', id: 'chromolyAxles', name: 'part.chromolyAxles', text: 'part.chromolyAxlesText', year: 1998,
    mass: { light4x4: 55, heavy: 280, sxs: 18 }, cost: { light4x4: 9000, heavy: 30000, sxs: 5500 }, strength: 1.6, unsprung: 0.97 },

  // ── Wheels ──
  { slot: 'wheels', id: 'steelWheels', name: 'part.steelWheels', text: 'part.steelWheelsText', year: 1985,
    mass: { light4x4: 72, heavy: 240, sxs: 36 }, cost: { light4x4: 600, heavy: 2400, sxs: 400 }, unsprung: 1, beadlock: false },
  { slot: 'wheels', id: 'alloyWheels', name: 'part.alloyWheels', text: 'part.alloyWheelsText', year: 1988,
    mass: { light4x4: 50, heavy: 170, sxs: 26 }, cost: { light4x4: 2200, heavy: 7000, sxs: 1500 }, unsprung: 0.92, beadlock: false },
  { slot: 'wheels', id: 'beadlocks', name: 'part.beadlocks', text: 'part.beadlocksText', year: 1985,
    mass: { light4x4: 84, heavy: 280, sxs: 42 }, cost: { light4x4: 3200, heavy: 10000, sxs: 2200 }, unsprung: 1.04, beadlock: true },

  // ── Tires ──
  { slot: 'tires', id: 'allTerrain', name: 'part.allTerrain', text: 'part.allTerrainText', year: 1985,
    mass: { light4x4: 80, heavy: 400, sxs: 36 }, cost: { light4x4: 1200, heavy: 6000, sxs: 800 }, stiffness: 0.95, casing: 0.85, unsprung: 0.98, studded: false },
  { slot: 'tires', id: 'rallyTires', name: 'part.rallyTires', text: 'part.rallyTiresText', year: 1985,
    mass: { light4x4: 88, heavy: 440, sxs: 40 }, cost: { light4x4: 2400, heavy: 12000, sxs: 1600 }, stiffness: 1, casing: 1, unsprung: 1, studded: false },
  { slot: 'tires', id: 'heavyPly', name: 'part.heavyPly', text: 'part.heavyPlyText', year: 1985,
    mass: { light4x4: 100, heavy: 500, sxs: 46 }, cost: { light4x4: 3600, heavy: 18000, sxs: 2400 }, stiffness: 1.15, casing: 1.25, unsprung: 1.05, studded: false },
  // Studded for winter: the same casings with tungsten studs, a little heavier and dearer (plan PR 10).
  { slot: 'tires', id: 'studdedRally', name: 'part.studdedRally', text: 'part.studdedRallyText', year: 1985,
    mass: { light4x4: 92, heavy: 460, sxs: 42 }, cost: { light4x4: 3400, heavy: 16000, sxs: 2200 }, stiffness: 1, casing: 1, unsprung: 1.03, studded: true },
  { slot: 'tires', id: 'studdedPly', name: 'part.studdedPly', text: 'part.studdedPlyText', year: 1985,
    mass: { light4x4: 104, heavy: 520, sxs: 48 }, cost: { light4x4: 4600, heavy: 22000, sxs: 3000 }, stiffness: 1.15, casing: 1.25, unsprung: 1.08, studded: true },

  // ── Protection ──
  { slot: 'protection', id: 'noGuards', name: 'part.noGuards', text: 'part.noGuardsText', year: 1985,
    mass: { light4x4: 0, heavy: 0, sxs: 0 }, cost: { light4x4: 0, heavy: 0, sxs: 0 } },
  { slot: 'protection', id: 'skidPlates', name: 'part.skidPlates', text: 'part.skidPlatesText', year: 1985,
    mass: { light4x4: 25, heavy: 120, sxs: 10 }, cost: { light4x4: 800, heavy: 3000, sxs: 500 } },
  { slot: 'protection', id: 'fullArmour', name: 'part.fullArmour', text: 'part.fullArmourText', year: 1985,
    mass: { light4x4: 60, heavy: 280, sxs: 22 }, cost: { light4x4: 2500, heavy: 9000, sxs: 1500 } },

  // ── Engine ──
  { slot: 'engine', id: 'petrolSix', name: 'part.petrolSix', text: 'part.petrolSixText', year: 1985,
    mass: { light4x4: 220 }, cost: { light4x4: 6000 }, power: 110 * kW, torque: 1 },
  { slot: 'engine', id: 'dieselFour', name: 'part.dieselFour', text: 'part.dieselFourText', year: 1985,
    mass: { light4x4: 240 }, cost: { light4x4: 5000 }, power: 85 * kW, torque: 0.95 },
  { slot: 'engine', id: 'petrolV8', name: 'part.petrolV8', text: 'part.petrolV8Text', year: 1985,
    mass: { light4x4: 260 }, cost: { light4x4: 9000 }, power: 170 * kW, torque: 1.3 },
  { slot: 'engine', id: 'turboDiesel', name: 'part.turboDiesel', text: 'part.turboDieselText', year: 1994,
    mass: { light4x4: 250 }, cost: { light4x4: 12000 }, power: 140 * kW, torque: 1.25 },
  { slot: 'engine', id: 'dieselSix', name: 'part.dieselSix', text: 'part.dieselSixText', year: 1985,
    mass: { heavy: 950 }, cost: { heavy: 30000 }, power: 300 * kW, torque: 1 },
  { slot: 'engine', id: 'turboDieselSix', name: 'part.turboDieselSix', text: 'part.turboDieselSixText', year: 1990,
    mass: { heavy: 1000 }, cost: { heavy: 50000 }, power: 420 * kW, torque: 1.2 },
  { slot: 'engine', id: 'dieselV8', name: 'part.dieselV8', text: 'part.dieselV8Text', year: 1985,
    mass: { heavy: 1150 }, cost: { heavy: 55000 }, power: 450 * kW, torque: 1.3 },
  { slot: 'engine', id: 'twin', name: 'part.twin', text: 'part.twinText', year: 1985,
    mass: { sxs: 55 }, cost: { sxs: 2500 }, power: 45 * kW, torque: 1 },
  { slot: 'engine', id: 'triple', name: 'part.triple', text: 'part.tripleText', year: 1995,
    mass: { sxs: 60 }, cost: { sxs: 4000 }, power: 75 * kW, torque: 1.15 },
  { slot: 'engine', id: 'turboTwin', name: 'part.turboTwin', text: 'part.turboTwinText', year: 2008,
    mass: { sxs: 62 }, cost: { sxs: 6000 }, power: 125 * kW, torque: 1.4 },

  // ── Spares carried ──
  { slot: 'spares', id: 'noSpares', name: 'part.noSpares', text: 'part.noSparesText', year: 1985,
    mass: { light4x4: 0, heavy: 0, sxs: 0 }, cost: { light4x4: 0, heavy: 0, sxs: 0 },
    carries: { tire: 0, shock: 0, cv: 0 } },
  { slot: 'spares', id: 'lightKit', name: 'part.lightKit', text: 'part.lightKitText', year: 1985,
    mass: { light4x4: 45, heavy: 200, sxs: 25 }, cost: { light4x4: 2000, heavy: 8000, sxs: 1200 },
    carries: { tire: 1, shock: 1, cv: 1 } },
  { slot: 'spares', id: 'fullKit', name: 'part.fullKit', text: 'part.fullKitText', year: 1985,
    mass: { light4x4: 110, heavy: 500, sxs: 60 }, cost: { light4x4: 5000, heavy: 20000, sxs: 3000 },
    carries: { tire: 2, shock: 2, cv: 2 } },
]
