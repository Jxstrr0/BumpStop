/**
 * Weight and balance (Kelbo picked it, 27 November 2026): what the load on
 * a build (`src/data/load.ts`) does to the body the springs hold up.
 *
 * Each thing that moves (the spares kit, the tools, the fuel) is a weight
 * at a spot. Against the stock load, a build's load:
 *
 * - adds or takes away weight (only the fuel can: a part-full tank),
 * - moves the centre of mass forward or back, left or right, and
 * - changes how hard the body is to start nodding (pitch) or rolling, by
 *   how far each weight sits from the centre (a spare on the tail is a long
 *   lever, so the nose bobs slower and settles slower).
 *
 * `src/sim/build.ts` puts this into the ride setup; the ride model
 * (`src/sim/ride.ts`) works out what each corner carries from it.
 */
import type { ClassId } from '../data/classes'
import { CLASS_LOAD, FUEL_STEPS, SPOT_IDS, STOCK_LOAD, type LoadItem, type SpotId, type TruckLoad } from '../data/load'

/** What a load does to the body, against the stock load. */
export interface LoadShift {
  /** Weight added (+) or taken away (−) (kg). */
  dMass: number
  /** How far the centre of mass moves forward (m) and to the left (m). */
  dx: number
  dy: number
  /** Extra resistance to nodding and to rolling about the new centre (kg·m²; below 0 is less). */
  dPitch: number
  dRoll: number
}

export const NO_SHIFT: Readonly<LoadShift> = { dMass: 0, dx: 0, dy: 0, dPitch: 0, dRoll: 0 }

/** A spot's place on the truck (m forward and left of the centre of mass). */
export function spotPlace(cls: ClassId, spot: SpotId): { x: number; y: number } {
  const c = CLASS_LOAD[cls]
  const [row, col] = spot.split('-') as [keyof typeof c.rowX, keyof typeof c.colY]
  return { x: c.rowX[row], y: c.colY[col] }
}

/** The fuel share snapped to the nearest step. */
export function snapFuel(v: number): number {
  let best = FUEL_STEPS[FUEL_STEPS.length - 1] as number
  for (const s of FUEL_STEPS) if (Math.abs(s - v) < Math.abs(best - v)) best = s
  return best
}

function tidySpot(v: unknown, fallback: SpotId): SpotId {
  return typeof v === 'string' && (SPOT_IDS as readonly string[]).includes(v) ? (v as SpotId) : fallback
}

/** A load with every value valid: unknown spots go back to stock, fuel onto its steps. */
export function tidyLoad(raw: Partial<Record<keyof TruckLoad, unknown>>): TruckLoad {
  const fuel = typeof raw.fuel === 'number' && Number.isFinite(raw.fuel) ? snapFuel(raw.fuel) : STOCK_LOAD.fuel
  return { spares: tidySpot(raw.spares, STOCK_LOAD.spares), tools: tidySpot(raw.tools, STOCK_LOAD.tools), fuel }
}

/** True if this is the stock load (or no load at all). */
export function isStockLoad(load: TruckLoad | undefined): boolean {
  return !load || (load.spares === STOCK_LOAD.spares && load.tools === STOCK_LOAD.tools && load.fuel === STOCK_LOAD.fuel)
}

/** Fuel in the tank (kg). */
export function fuelMass(cls: ClassId, fuel: number): number {
  return CLASS_LOAD[cls].fuelFull * fuel
}

/** How far this much fuel goes (km). */
export function fuelRangeKm(cls: ClassId, fuel: number): number {
  return CLASS_LOAD[cls].rangeKm * fuel
}

/**
 * Fuel stops on a stage of `metres`: one each time the tank runs out before
 * the finish (filled back to the same level each time). A stage the tank
 * just lasts needs none.
 */
export function fuelStops(cls: ClassId, fuel: number, metres: number): number {
  const range = fuelRangeKm(cls, fuel) * 1000
  if (range <= 0) return 0
  return Math.max(0, Math.ceil(metres / range - 1e-9) - 1)
}

/**
 * The weights that move, now and in the stock load: each with its mass (kg)
 * and place. `sparesMass` is the build's spares kit (0 with no spares).
 */
export function loadWeights(cls: ClassId, load: TruckLoad, sparesMass: number): { item: LoadItem | 'fuel'; m: number; x: number; y: number; m0: number; x0: number; y0: number }[] {
  const c = CLASS_LOAD[cls]
  const at = (spot: SpotId) => spotPlace(cls, spot)
  const sNow = at(load.spares)
  const s0 = at(STOCK_LOAD.spares)
  const tNow = at(load.tools)
  const t0 = at(STOCK_LOAD.tools)
  return [
    { item: 'spares', m: sparesMass, x: sNow.x, y: sNow.y, m0: sparesMass, x0: s0.x, y0: s0.y },
    { item: 'tools', m: c.tools, x: tNow.x, y: tNow.y, m0: c.tools, x0: t0.x, y0: t0.y },
    { item: 'fuel', m: fuelMass(cls, load.fuel), x: c.tankX, y: c.tankY, m0: fuelMass(cls, STOCK_LOAD.fuel), x0: c.tankX, y0: c.tankY },
  ]
}

/**
 * What the load does to a body of `sprungMass` (kg, with the stock load on
 * board, its centre of mass at 0, 0). The weights are points, which is close
 * enough for a spare wheel or a tool box.
 */
export function loadShift(cls: ClassId, load: TruckLoad | undefined, sparesMass: number, sprungMass: number): LoadShift {
  if (isStockLoad(load)) return { ...NO_SHIFT }
  let dMass = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  for (const w of loadWeights(cls, load as TruckLoad, sparesMass)) {
    dMass += w.m - w.m0
    sx += w.m * w.x - w.m0 * w.x0
    sy += w.m * w.y - w.m0 * w.y0
    sxx += w.m * w.x * w.x - w.m0 * w.x0 * w.x0
    syy += w.m * w.y * w.y - w.m0 * w.y0 * w.y0
  }
  const mass = sprungMass + dMass
  const dx = sx / mass
  const dy = sy / mass
  // About the old centre the inertia grows by m·d² for each weight; about the new centre take back mass·shift².
  return { dMass, dx, dy, dPitch: sxx - mass * dx * dx, dRoll: syy - mass * dy * dy }
}
