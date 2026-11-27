/**
 * Getting stuck, and the recovery kit (Kelbo picked it, 27 November 2026).
 *
 * Out on a stage a truck can get stuck with nothing broken:
 *
 * - **Bogged:** the wheels dig in and the truck sits on its belly. Soft snow
 *   does it in winter, and the softened gravel after a thaw in summer. A
 *   heavy truck sinks deeper than a light one, and lower tire pressure
 *   spreads the weight on a bigger footprint, so it floats (airing down,
 *   the oldest trick there is).
 * - **Hung up:** high-centred on a rock or the lip of a hole, wheels in the
 *   air. Rocky ground does it most, and a truck that rides low (soft
 *   springs, no preload, sagged springs) hangs up far more often.
 *
 * Each time it happens the crew sees how badly: a **depth** from 0 (barely)
 * to 1 (properly stuck). Every truck carries a shovel, which digs out the
 * shallow ones. The recovery kit (part slot `recovery`, `src/data/parts.ts`)
 * reaches deeper and works faster:
 *
 * - **Traction boards** (steel sand ladders from 1985, nylon boards from
 *   2005) go under the wheels for grip. Best when bogged; some use when
 *   hung up.
 * - **A high-lift jack** lifts a corner to stack rocks or a board under it.
 *   Best when hung up. It also makes every roadside wheel, shock and CV
 *   swap a little quicker (`jackFix`).
 * - **A winch** (steel cable from 1985, synthetic rope from 2005) pulls the
 *   truck out of anything, quickest of all, but it's the heaviest.
 *
 * A stuck truck the kit can't reach waits for the **sweep truck**, which
 * tows it out: the stage is lost (towed in after closing, like a truck that
 * runs out of time), and it reaches the bivouac so late that the crew loses
 * `sweepHours` of work that night.
 *
 * The kit's weight is the price: every kilogram counts in the ride, the
 * power-to-weight, the ice, and how deep the truck sinks when it bogs.
 *
 * How often (per km, at Steady, on the class's stock truck at its stock
 * tire pressure):
 *
 *   bogs     = bogPerKm(ground, weather) × pace × class × weight² × pressure
 *   hang-ups = hangPerKm(ground) × pace × class × ride height
 *
 * Set from a sweep of the stock trucks over every raid: without a kit, a
 * stuck truck is towed about one time in two; a rocky summer raid or a
 * winter raid tows a truck with no kit out of about one stage in twelve.
 *
 * The sim imports nothing but data, like every table here.
 */
import type { ClassId } from './classes'
import type { GroundId } from './ground'
import type { PaceId } from './raids'
import type { WeatherId } from './weather'

/** The two ways to get stuck. */
export type StuckKind = 'bogged' | 'hungUp'
export const STUCK_KINDS: readonly StuckKind[] = ['bogged', 'hungUp']

/** What gets a truck out: the shovel every truck carries, or a piece of the kit. */
export type RecoveryTool = 'shovel' | 'boards' | 'jack' | 'winch'
export const RECOVERY_TOOLS: readonly RecoveryTool[] = ['shovel', 'boards', 'jack', 'winch']

export const RECOVERY = {
  /** Bogs per km at Steady on clear-weather ground. */
  bogPerKm: { snow: 0.0012 } as Readonly<Partial<Record<GroundId, number>>>,
  /** Extra bogs per km on ground the weather has changed, once it turns (a thaw's soft gravel; a whiteout's drifts). */
  weatherBog: {
    thaw: { graded: 0.0018, washboard: 0.0018, rough: 0.005, whoops: 0.005, jumps: 0.005 },
    whiteout: { snow: 0.0012 },
    dust: {},
  } as Readonly<Record<WeatherId, Readonly<Partial<Record<GroundId, number>>>>>,
  /** Hang-ups per km at Steady. */
  hangPerKm: { rocks: 0.008, whoops: 0.003, jumps: 0.002, iceHeaves: 0.002 } as Readonly<Partial<Record<GroundId, number>>>,
  /** Getting stuck at each pace call, as a share of Steady's: Push drives into it, Conserve looks first. */
  pace: { conserve: 0.6, steady: 1, push: 1.5 } as Readonly<Record<PaceId, number>>,
  /** How deep it gets at each pace call (times the depth). */
  paceDepth: { conserve: 0.85, steady: 1, push: 1.2 } as Readonly<Record<PaceId, number>>,
  /** By class: the heavy truck sinks more and hangs up less (big tires, high frame); the side-by-side floats. */
  classBog: { light4x4: 1, heavy: 1.4, sxs: 0.7 } as Readonly<Record<ClassId, number>>,
  classHang: { light4x4: 1, heavy: 0.7, sxs: 1 } as Readonly<Record<ClassId, number>>,
  /**
   * Weight: bogs times (truck's mass ÷ the stock truck's) to this power, and
   * the depth times the plain ratio, both kept inside `weightLimits`.
   */
  weightPower: 2,
  weightLimits: [0.6, 2] as readonly [number, number],
  /**
   * Tire pressure: bogs times (average pressure ÷ the stock pressure) to this
   * power, kept inside `pressureLimits`. Aired down 30% bogs about a fifth
   * less; pumped up hard bogs more.
   */
  pressurePower: 0.7,
  pressureLimits: [0.6, 1.5] as readonly [number, number],
  /**
   * The depth (0 to 1) of each time it gets stuck: a roll from 0 to 1 to
   * this power (so most are shallow), times the pace, weight and ride-height
   * factors, capped at 1.
   */
  depthPower: 1.5,
  /** How deep each tool can reach, by the way it's stuck. The winch reaches anything. */
  reach: {
    shovel: { bogged: 0.35, hungUp: 0.35 },
    boards: { bogged: 0.75, hungUp: 0.5 },
    jack: { bogged: 0.55, hungUp: 0.8 },
    winch: { bogged: 1, hungUp: 1 },
  } as Readonly<Record<RecoveryTool, Readonly<Record<StuckKind, number>>>>,
  /**
   * Minutes to get out with each tool, for a light 4x4 and an average crew,
   * at depth 0.5: times (`timeBase` + depth) ÷ (`timeBase` + 0.5), the
   * class's work and the driver's fix time.
   */
  minutes: { shovel: 40, boards: 22, jack: 20, winch: 12 } as Readonly<Record<RecoveryTool, number>>,
  timeBase: 0.6,
  /** Nylon boards are lighter to place and grip better: their time times this. A rope winch spools faster: likewise. */
  nylonBoards: 0.75,
  ropeWinch: 0.8,
  /**
   * The snowbank after a slide (`CORNERS.digOut` with the shovel): this long
   * with the kit instead (s, before class and driver, like the shovel's).
   */
  snowbank: { boards: 12 * 60, jack: 15 * 60, winch: 8 * 60 } as Readonly<Record<Exclude<RecoveryTool, 'shovel'>, number>>,
  /**
   * How much of a winch kit's weight is the winch itself, on the front
   * bumper (kg, by class); the boards and jack ride on the rear carrier
   * (weight and balance, `src/sim/load.ts`).
   */
  winchMass: {
    cable: { light4x4: 38, heavy: 125, sxs: 18 },
    rope: { light4x4: 24, heavy: 90, sxs: 12 },
  } as Readonly<Record<'cable' | 'rope', Readonly<Partial<Record<ClassId, number>>>>>,
  /** A high-lift jack makes roadside tire, shock and CV swaps (spare or bodge) take this share of the time. */
  jackFix: 0.85,
  /** Towed out by the sweep truck: the crew gets this many hours less at that night's bivouac (never fewer than `minHours`). */
  sweepHours: 3,
  minHours: 2,
  /** A part that would have broken past the place the truck stuck is left this worn instead (it never got there). */
  unbroken: 0.95,
} as const
