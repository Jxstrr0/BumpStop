/**
 * Getting stuck, and getting out (Kelbo picked the recovery kit, 27 November
 * 2026). The numbers and the reasoning: `src/data/recovery.ts`.
 *
 * The chance of getting stuck follows things the player sets or sees: the
 * ground and the weather on it, the pace call, the truck's weight (the kit's
 * own weight too), its tire pressure and its ride height. How deep each time
 * is comes from the seeded dice, like the rocks under the truck. Whether the
 * crew gets out, and how fast, comes from the kit: the deepest it can reach,
 * and the quickest tool that reaches that deep.
 *
 * Pure maths on plain numbers, so a raid in progress can be saved.
 */
import type { ClassId } from '../data/classes'
import { KITS } from '../data/kit'
import type { PaceId, RaidGround } from '../data/raids'
import { RECOVERY, STUCK_KINDS, type RecoveryTool, type StuckKind } from '../data/recovery'
import type { WeatherId } from '../data/weather'
import { CORNERS } from '../data/winter'
import { buildTruck, partIn, type BuiltTruck } from './build'
import { detPow } from './det'
import type { Rng } from './rng'
import { heightFactor, poisson } from './underside'

const clamp = (v: number, [lo, hi]: readonly [number, number]) => (v < lo ? lo : v > hi ? hi : v)

/** The stock truck's mass and average tire pressure per class, worked out once. */
const STOCK = new Map<ClassId, { mass: number; pressure: number }>()

function stock(cls: ClassId): { mass: number; pressure: number } {
  let v = STOCK.get(cls)
  if (!v) {
    const b = KITS[cls].stock
    v = { mass: buildTruck(b).mass, pressure: (b.front.tirePressure + b.rear.tirePressure) / 2 }
    STOCK.set(cls, v)
  }
  return v
}

/** The truck's mass against its class's stock truck's (1 for the stock truck). */
export function weightRatio(truck: BuiltTruck): number {
  return truck.mass / stock(truck.build.cls).mass
}

/** How much more often this truck bogs for its weight (1 at the stock weight). */
export function weightFactor(truck: BuiltTruck): number {
  return clamp(detPow(weightRatio(truck), RECOVERY.weightPower), RECOVERY.weightLimits)
}

/** How much more often this truck bogs for its tire pressure (below 1 aired down). */
export function pressureFactor(truck: BuiltTruck): number {
  const b = truck.build
  const ratio = (b.front.tirePressure + b.rear.tirePressure) / 2 / stock(b.cls).pressure
  return clamp(detPow(ratio, RECOVERY.pressurePower), RECOVERY.pressureLimits)
}

/** Bogs per km on this ground at this pace, in this weather once it has turned (null for clear). */
export function bogRate(truck: BuiltTruck, ground: RaidGround, pace: PaceId, weather: WeatherId | null = null): number {
  const base = (RECOVERY.bogPerKm[ground] ?? 0) + (weather ? RECOVERY.weatherBog[weather][ground] ?? 0 : 0)
  if (!(base > 0)) return 0
  return base * RECOVERY.pace[pace] * RECOVERY.classBog[truck.build.cls] * weightFactor(truck) * pressureFactor(truck)
}

/** Hang-ups per km on this ground at this pace. */
export function hangRate(truck: BuiltTruck, ground: RaidGround, pace: PaceId): number {
  const base = RECOVERY.hangPerKm[ground] ?? 0
  if (!(base > 0)) return 0
  return base * RECOVERY.pace[pace] * RECOVERY.classHang[truck.build.cls] * heightFactor(truck)
}

/** What depth scales by for this truck: weight sinks a bog deeper, riding low hangs up harder. */
function depthScale(truck: BuiltTruck, kind: StuckKind, pace: PaceId): number {
  const own = kind === 'bogged'
    ? clamp(weightRatio(truck), RECOVERY.weightLimits)
    : detPow(heightFactor(truck), 0.5)
  return RECOVERY.paceDepth[pace] * own
}

/** One time stuck: where along the stretch (m), which way, and how deep (0 to 1). */
export interface Stuck {
  at: number
  kind: StuckKind
  depth: number
}

/** The times the truck gets stuck on one driven stretch, in order along it. */
export function rollStuck(
  rng: Rng, truck: BuiltTruck, ground: RaidGround, pace: PaceId, metres: number, weather: WeatherId | null = null,
): Stuck[] {
  const km = metres / 1000
  const out: Stuck[] = []
  for (const kind of STUCK_KINDS) {
    const rate = kind === 'bogged' ? bogRate(truck, ground, pace, weather) : hangRate(truck, ground, pace)
    const n = poisson(rng, rate * km)
    for (let k = 0; k < n; k++) {
      const at = rng.next() * metres
      const depth = Math.min(1, detPow(rng.next(), RECOVERY.depthPower) * depthScale(truck, kind, pace))
      out.push({ at, kind, depth })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** The tools the truck has: the shovel always, then whatever the kit holds. */
export function kitTools(truck: BuiltTruck): RecoveryTool[] {
  const kit = partIn(truck.build, 'recovery')
  const out: RecoveryTool[] = ['shovel']
  if (kit.boards !== 'none') out.push('boards')
  if (kit.jack) out.push('jack')
  if (kit.winch !== 'none') out.push('winch')
  return out
}

/** True if the truck carries anything besides the shovel. */
export function hasKit(truck: BuiltTruck): boolean {
  return kitTools(truck).length > 1
}

/** The deepest this truck's kit can get it out from, stuck this way (0 to 1). */
export function kitReach(truck: BuiltTruck, kind: StuckKind): number {
  return Math.max(...kitTools(truck).map((tool) => RECOVERY.reach[tool][kind]))
}

/** A tool's minutes for this truck's kit at depth 0.5 (nylon boards and rope winches are quicker). */
function toolMinutes(truck: BuiltTruck, tool: RecoveryTool): number {
  const kit = partIn(truck.build, 'recovery')
  let m = RECOVERY.minutes[tool]
  if (tool === 'boards' && kit.boards === 'nylon') m *= RECOVERY.nylonBoards
  if (tool === 'winch' && kit.winch === 'rope') m *= RECOVERY.ropeWinch
  return m
}

/**
 * How the crew gets out from this deep: the quickest tool that reaches, and
 * its time in hours before the class's work and the driver's fix time. Null
 * means nothing on the truck reaches: wait for the sweep truck.
 */
export function recovery(truck: BuiltTruck, kind: StuckKind, depth: number): { tool: RecoveryTool; hours: number } | null {
  let best: { tool: RecoveryTool; hours: number } | null = null
  for (const tool of kitTools(truck)) {
    if (depth > RECOVERY.reach[tool][kind]) continue
    const hours = (toolMinutes(truck, tool) / 60) * (RECOVERY.timeBase + depth) / (RECOVERY.timeBase + 0.5)
    if (!best || hours < best.hours) best = { tool, hours }
  }
  return best
}

/** Out of the snowbank after a slide: the quickest tool, and the seconds it takes (the shovel is `CORNERS.digOut`). */
export function snowbankRecovery(truck: BuiltTruck): { tool: RecoveryTool; seconds: number } {
  let best: { tool: RecoveryTool; seconds: number } = { tool: 'shovel', seconds: CORNERS.digOut }
  for (const tool of kitTools(truck)) {
    if (tool === 'shovel') continue
    const seconds = RECOVERY.snowbank[tool] * (toolMinutes(truck, tool) / RECOVERY.minutes[tool])
    if (seconds < best.seconds) best = { tool, seconds }
  }
  return best
}

/** Roadside tire, shock and CV swaps take this share of the usual time (less with a high-lift jack). */
export function jackFactor(truck: BuiltTruck): number {
  return partIn(truck.build, 'recovery').jack ? RECOVERY.jackFix : 1
}

/** Share of the times stuck this way that the kit can't reach (so the sweep truck tows), for the shallowest-first spread. */
export function towShare(truck: BuiltTruck, kind: StuckKind, pace: PaceId): number {
  // depth = u^p × scale ≤ reach  ⇔  u ≤ (reach ÷ scale)^(1/p)
  const reach = kitReach(truck, kind)
  if (reach >= 1) return 0
  const scale = depthScale(truck, kind, pace)
  const ok = Math.min(1, detPow(reach / scale, 1 / RECOVERY.depthPower))
  return 1 - ok
}

/** What getting stuck looks like over some ground at one pace call: times expected, and the times the sweep truck tows. */
export interface StuckOutlook {
  stuck: number
  tows: number
}

/**
 * The outlook over a stage or a whole raid at one pace call for every leg,
 * clear weather (for the morning and the entry screen).
 */
export function stuckOutlook(truck: BuiltTruck, segments: readonly { ground: RaidGround; km: number }[], pace: PaceId): StuckOutlook {
  let stuck = 0
  let tows = 0
  const bogTow = towShare(truck, 'bogged', pace)
  const hangTow = towShare(truck, 'hungUp', pace)
  for (const s of segments) {
    const bogs = bogRate(truck, s.ground, pace) * s.km
    const hangs = hangRate(truck, s.ground, pace) * s.km
    stuck += bogs + hangs
    tows += bogs * bogTow + hangs * hangTow
  }
  return { stuck, tows }
}
