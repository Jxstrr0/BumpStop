/**
 * Weight and balance (Kelbo picked it, 27 November 2026): where the spares
 * kit and the tools ride on the truck, and how much fuel goes in the tank.
 *
 * Everything here is measured from the test mule's centre of mass, the
 * point the whole truck balances on (`cgToFront` in `src/data/ride.ts`):
 * x forward, y to the left, in metres.
 *
 * The stock load is the spares kit and the tools in the middle, right over
 * that point, and a full tank. That's what every truck carried before this
 * feature, so a truck with the stock load drives exactly as it did. Moving
 * things forward or back shifts weight between the axles (one end sits
 * lower and has less bump travel left); moving them to one side makes the
 * truck lean, so one side bottoms first. Weight hung far from the middle
 * also makes the body slower to start nodding or rolling, and slower to stop.
 *
 * Fuel is the one that changes the weight: less fuel is a lighter truck,
 * which is a touch quicker on fast ground and kinder on the ice, but on a
 * long stage it has to stop to fill up (`FUEL_STOP`).
 */
import type { ClassId } from './classes'

/** Where a load can ride: three rows (front, middle, rear) by three columns (left, centre, right). */
export type SpotRow = 'front' | 'mid' | 'rear'
export type SpotCol = 'left' | 'centre' | 'right'
export type SpotId = `${SpotRow}-${SpotCol}`

export const SPOT_ROWS: readonly SpotRow[] = ['front', 'mid', 'rear']
export const SPOT_COLS: readonly SpotCol[] = ['left', 'centre', 'right']
export const SPOT_IDS: readonly SpotId[] = SPOT_ROWS.flatMap((r) => SPOT_COLS.map((c) => `${r}-${c}` as SpotId))

/** The two things the player moves around. */
export type LoadItem = 'spares' | 'tools'
export const LOAD_ITEMS: readonly LoadItem[] = ['spares', 'tools']

/** Fuel steps: a quarter of a tank up to full. */
export const FUEL_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1]

/** The load on a build. Missing on a build means the stock load (`STOCK_LOAD`). */
export interface TruckLoad {
  spares: SpotId
  tools: SpotId
  /** Share of a full tank (one of `FUEL_STEPS`). */
  fuel: number
}

export const STOCK_LOAD: Readonly<TruckLoad> = { spares: 'mid-centre', tools: 'mid-centre', fuel: 1 }

export interface ClassLoad {
  /** How far forward of the centre of mass each row sits (m): the front bumper, behind the cab, the rear carrier. */
  rowX: Readonly<Record<SpotRow, number>>
  /** How far left of the centre line each column sits (m). */
  colY: Readonly<Record<SpotCol, number>>
  /** Tools, a bottle jack and the shovel: always carried, part of the base weight (kg). The recovery kit is a part of its own. */
  tools: number
  /** Fuel in a full tank (kg), part of the base weight. */
  fuelFull: number
  /** Where the tank sits (m), fixed by the class's chassis. */
  tankX: number
  tankY: number
  /** How far a full tank goes on a raid stage (km). Every stage fits in a full tank. */
  rangeKm: number
}

export const CLASS_LOAD: Readonly<Record<ClassId, ClassLoad>> = {
  // A pickup: 120 litres of petrol in a tank on the right, just ahead of the rear axle.
  light4x4: {
    rowX: { front: 1.6, mid: 0, rear: -2.2 },
    colY: { left: 0.6, centre: 0, right: -0.6 },
    tools: 40,
    fuelFull: 90,
    tankX: -1.0,
    tankY: -0.45,
    rangeKm: 360,
  },
  // A cab-over: a 400-litre diesel saddle tank on the left of the frame, under the cab's back.
  heavy: {
    rowX: { front: 2.5, mid: 0, rear: -3.1 },
    colY: { left: 0.85, centre: 0, right: -0.85 },
    tools: 150,
    fuelFull: 340,
    tankX: 0.4,
    tankY: 0.8,
    rangeKm: 640,
  },
  // A side-by-side: a small tank under the passenger seat, on the right.
  sxs: {
    rowX: { front: 1.3, mid: 0, rear: -1.5 },
    colY: { left: 0.5, centre: 0, right: -0.5 },
    tools: 20,
    fuelFull: 28,
    tankX: 0.1,
    tankY: -0.3,
    rangeKm: 240,
  },
}

/** A stop to fill up on a stage the tank won't last, at a fuel point along the way (s). */
export const FUEL_STOP = 120

/**
 * How the balance reads on the screen: front share of the weight within
 * this much of the stock truck's is "even"; past `heavy` the chip goes amber.
 * A lean (or nose up or down) under `levelDeg` degrees reads as level.
 */
export const BALANCE_READ = {
  /** Shift in the front axle's share of the weight (0 to 1) that's still called even. */
  even: 0.01,
  /** Shift that turns the chip amber. */
  heavy: 0.04,
  /** Degrees of lean or nod that still read as level. */
  levelDeg: 0.1,
  /** Degrees that turn the chip amber. */
  warmDeg: 0.6,
} as const

/** A corner that leans down never has less than this bump (or droop) travel left in the ride model (m). */
export const LEAN = {
  minTravel: 0.005,
} as const
