/**
 * Underside hits (Kelbo, 27 November 2026): rocks that reach the bottom of
 * the truck on rough ground, the guards that take them, and the oil pan,
 * diff and fuel tank that get dented when they don't. Numbers and the
 * reasoning: `src/data/underside.ts`.
 *
 * The chance of a strike follows things the player sets or sees: the ground,
 * the pace call, the ride height (springs and preload, and how far the
 * springs have sagged) and every hard bottom-out the ride sim counted. Where
 * each strike lands and whether the guards take it is the seeded dice, like
 * the rival teams' trouble.
 *
 * Pure maths on plain numbers, so a raid in progress can be saved.
 */
import { KITS } from '../data/kit'
import type { PaceId, RaidGround } from '../data/raids'
import { UNDER_PARTS, UNDERSIDE, type UnderPart } from '../data/underside'
import type { ClassId } from '../data/classes'
import { buildTruck, partIn, type BuiltTruck } from './build'
import { detExp, detPow } from './det'
import type { Rng } from './rng'

/** How damaged each part under the truck is, 0 (fine) to 1 (holed). */
export type Underside = Record<UnderPart, number>

export function newUnderside(): Underside {
  return { sump: 0, diff: 0, tank: 0 }
}

const cap = (x: number) => (x > 1 ? 1 : x < 0 ? 0 : x)

/** The stock truck's average bump travel per class (m), worked out once. */
const STOCK_BUMP = new Map<ClassId, number>()

function stockBump(cls: ClassId): number {
  let v = STOCK_BUMP.get(cls)
  if (v === undefined) {
    const t = buildTruck(KITS[cls].stock)
    v = (t.ride.front.bumpTravel + t.ride.rear.bumpTravel) / 2
    STOCK_BUMP.set(cls, v)
  }
  return v
}

/**
 * How much more often rocks reach a truck that sits this low (1 at the
 * stock ride height). Uses the truck as it stands, so sagged springs count.
 */
export function heightFactor(truck: BuiltTruck): number {
  const bump = (truck.ride.front.bumpTravel + truck.ride.rear.bumpTravel) / 2
  if (!(bump > 0)) return UNDERSIDE.heightLimits[1]
  const k = detPow(stockBump(truck.build.cls) / bump, UNDERSIDE.heightPower)
  return Math.min(UNDERSIDE.heightLimits[1], Math.max(UNDERSIDE.heightLimits[0], k))
}

/** Share of strikes the truck's protection takes (0 with no guards). */
export function guardShare(truck: BuiltTruck): number {
  return UNDERSIDE.guards[partIn(truck.build, 'protection').id] ?? 0
}

/** Rocks per km reaching the underside on this ground at this pace, before the guards and without bottoming. */
export function strikeRate(truck: BuiltTruck, ground: RaidGround, pace: PaceId): number {
  return (UNDERSIDE.perKm[ground] ?? 0) * UNDERSIDE.pace[pace] * heightFactor(truck)
}

/** Strikes expected over a stretch: its kilometres plus its bottom-outs (before the guards). */
export function expectedStrikes(truck: BuiltTruck, ground: RaidGround, pace: PaceId, metres: number, bottomOuts = 0): number {
  const rate = UNDERSIDE.perKm[ground] ?? 0
  return strikeRate(truck, ground, pace) * (metres / 1000) + rate * bottomOuts * UNDERSIDE.perBottomOut
}

/** A count from a Poisson spread with this average (Knuth's way: fine for the small averages here). */
function poisson(rng: Rng, mean: number): number {
  if (!(mean > 0)) return 0
  const floor = detExp(-mean)
  let k = 0
  let p = rng.next()
  while (p > floor && k < 50) {
    k++
    p *= rng.next()
  }
  return k
}

/** One rock under the truck: where (m along the stretch), and the part it dented, or null if the guards took it. */
export interface Strike {
  at: number
  part: UnderPart | null
  /** Damage it did to the part (0 if the guards took it). */
  damage: number
}

function pickPart(rng: Rng): UnderPart {
  let r = rng.next()
  for (const part of UNDER_PARTS) {
    r -= UNDERSIDE.partShare[part]
    if (r < 0) return part
  }
  return UNDER_PARTS[UNDER_PARTS.length - 1] as UnderPart
}

/** The strikes on one driven stretch, in order along it. */
export function rollStrikes(rng: Rng, truck: BuiltTruck, ground: RaidGround, pace: PaceId, metres: number, bottomOuts: number): Strike[] {
  const n = poisson(rng, expectedStrikes(truck, ground, pace, metres, bottomOuts))
  const guard = guardShare(truck)
  const out: Strike[] = []
  for (let k = 0; k < n; k++) {
    const at = rng.next() * metres
    const taken = rng.next() < guard
    const part = taken ? null : pickPart(rng)
    const damage = part ? rng.range(UNDERSIDE.hitDamage[0], UNDERSIDE.hitDamage[1]) : 0
    out.push({ at, part, damage })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Hours to patch a part at the roadside, before the class and the driver: longer if it was already damaged. */
export function patchHours(part: UnderPart, before: number): number {
  return UNDERSIDE.patchHours[part] * (1 + cap(before) * UNDERSIDE.patchWorse)
}

/** Seconds lost per km to topping up leaks with the underside like this. */
export function leakPerKm(u: Underside): number {
  return UNDER_PARTS.reduce((sum, part) => sum + cap(u[part]) * UNDERSIDE.leakPerKm[part], 0)
}

/**
 * The underside hits that get past the guards, expected over a stage at one
 * pace call for every leg, no bottoming (for the morning and the entry screen).
 */
export function stageOutlook(truck: BuiltTruck, segments: readonly { ground: RaidGround; km: number }[], pace: PaceId): number {
  const pass = 1 - guardShare(truck)
  return segments.reduce((sum, s) => sum + expectedStrikes(truck, s.ground, pace, s.km * 1000), 0) * pass
}

/** True if the ground ever sends rocks at the underside. */
export function rockyGround(ground: RaidGround): boolean {
  return (UNDERSIDE.perKm[ground] ?? 0) > 0
}
