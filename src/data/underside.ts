/**
 * Underside hits (Kelbo, 27 November 2026): on rough ground a rock now and
 * then hits the bottom of the truck. Skid plates take most of them, full
 * armour nearly all; a hit that gets through dents the oil pan, the diff or
 * the fuel tank. The crew stops to patch it (time on the stage), a damaged
 * part leaks and needs topping up until it's fixed (more time), and the
 * bivouac can weld or seal it for money and hours.
 *
 * So the guards' weight is a real choice: carry them on rocky raids, leave
 * them off on the fast, smooth ones.
 *
 * How many rocks reach the underside (`src/sim/underside.ts`):
 *
 *   strikes = rate(ground) × (km × pace × ride height + bottom-outs × perBottomOut)
 *
 * - **Ground:** rocks most, then rough ground and whoops; graded roads,
 *   washboard, ice and snow none.
 * - **Pace:** Push hits more rocks, Conserve picks a line round them.
 * - **Ride height:** the truck's bump travel against its class's stock
 *   truck's (lower springs, sagged springs or too little preload sit lower).
 * - **Bottoming out:** every hard bottom-out in the ride sim slams the belly
 *   down, so a truck that bottoms gets hit far more often.
 *
 * Each strike is then taken by the guards (a share by protection part) or
 * gets through to one of the three parts. Numbers were set from a sweep of
 * the stock trucks over every raid (`docs/UNDERSIDE.md`).
 *
 * The sim imports nothing but data, like every table here.
 */
import type { RaidGround, PaceId } from './raids'

/** The three things under the truck a rock can damage. */
export type UnderPart = 'sump' | 'diff' | 'tank'

export const UNDER_PARTS: readonly UnderPart[] = ['sump', 'diff', 'tank']

export const UNDERSIDE = {
  /** Rocks that reach the underside per km at Steady, at the stock ride height, before the guards. */
  perKm: { rocks: 0.06, rough: 0.012, whoops: 0.015, jumps: 0.008, iceHeaves: 0.004 } as Readonly<Partial<Record<RaidGround, number>>>,
  /** Each hard bottom-out counts as this many km of the ground it happened on: the belly slams down onto it. */
  perBottomOut: 2,
  /** Strikes at each pace call, as a share of Steady's. */
  pace: { conserve: 0.6, steady: 1, push: 1.7 } as Readonly<Record<PaceId, number>>,
  /**
   * Ride height: strikes times (stock bump travel ÷ this truck's) to this
   * power, kept inside `heightLimits`. Soft springs with no preload sit about
   * 40% lower and get hit about twice as often.
   */
  heightPower: 1.5,
  heightLimits: [0.6, 2.5] as readonly [number, number],
  /** Share of strikes each protection part takes for you. Unknown parts count as none. */
  guards: { noGuards: 0, skidPlates: 0.65, fullArmour: 0.93 } as Readonly<Record<string, number>>,
  /** Which part a strike that gets through hits (shares that add up to 1). */
  partShare: { sump: 0.4, diff: 0.35, tank: 0.25 } as Readonly<Record<UnderPart, number>>,
  /** Damage each hit does to its part (0 to 1), somewhere in this range. */
  hitDamage: [0.35, 0.6] as readonly [number, number],
  /** Hours at the roadside to patch each part (times `CLASS_WORK` and the driver's fix time). */
  patchHours: { sump: 0.2, diff: 0.25, tank: 0.15 } as Readonly<Record<UnderPart, number>>,
  /** A part that was already damaged takes longer to patch: times (1 + damage × this). */
  patchWorse: 1,
  /**
   * A damaged part leaks: the crew stops to top up oil or fuel. Seconds lost
   * per km for a part with damage 1 (half as much at 0.5).
   */
  leakPerKm: { sump: 2, diff: 1.5, tank: 1.5 } as Readonly<Record<UnderPart, number>>,
} as const
