/**
 * The truck's condition over a raid (bivouac breakdowns, after 1.2): the
 * slow wear that never stops the truck by itself but changes how it rides
 * the next day. Kept per axle (front, rear), because that's how the crew
 * services it: both shocks, both springs, both sets of bushings.
 *
 * - **Shock oil** tires with heat. Every joule a damper turns into heat
 *   breaks the oil down a little, and oil run hot breaks down faster. Tired
 *   oil damps less and foams sooner, so the shock fades at a lower
 *   temperature: the fade still comes out of the heat physics, the oil just
 *   gives up earlier.
 * - **Springs sag** with bottom-outs and rough kilometres. A sagged spring
 *   sits lower, so there's less travel left before the bump stop, and it's
 *   a little softer.
 * - **Bushings crack** on harsh ground and hard hits. Cracked rubber lets
 *   the mounts knock metal on metal, so the mounts fatigue faster.
 *
 * Every number here was set from a sweep of the stock trucks over the
 * summer and winter raids (`docs/BIVOUAC.md`): about a fifth to a third
 * tired on the hotter axle after a Steady day, so a crew that skips a
 * service for two nights feels it on the third.
 */

/** The three kinds of slow wear the bivouac can put right. */
export type CondPart = 'oil' | 'bushing' | 'spring'

export const COND_PARTS: readonly CondPart[] = ['oil', 'bushing', 'spring']

export const CONDITION = {
  oil: {
    /** Each kelvin of heat a damper's work puts into its oil (heat ÷ heat capacity) tires the oil this much. */
    perKelvin: 0.0004,
    /** Oil run hot tires faster: up to this many times as fast once it reaches the red line (from the warm line). */
    hotBoost: 2,
    /** Fully tired oil damps this share less. */
    damping: 0.3,
    /** Fully tired oil foams and fades this many kelvin sooner. */
    redDrop: 18,
  },
  spring: {
    /** Each bottom-out on the axle (both corners) sags its springs this much. */
    perBottomOut: 0.002,
    /** Each kilometre of harsh ground (`RAID.harshGround`) sags them this much. */
    perHarshKm: 0.004,
    /**
     * A fully sagged spring has lost this share of its bump travel (it moves
     * to droop). A tired spring gets shorter, not softer: its stiffness comes
     * from the wire and the coils, which don't change, so only the ride height
     * drops (balance and physics check, 28 November 2026).
     */
    travel: 0.3,
  },
  bushing: {
    /** Each kilometre of harsh ground wears the axle's bushings this much. */
    perHarshKm: 0.005,
    /** Each bottom-out on the axle cracks them this much more. */
    perBottomOut: 0.0015,
    /** Fully cracked bushings leave the mounts this share weaker (their breaking and endurance loads). */
    mount: 0.15,
  },
  /** A new or rebuilt shock on one corner: the axle's oil is left this share as tired (the other shock is still old). */
  oneShock: 0.5,
  /**
   * Harsh kilometres age the springs and bushings this many times as fast at
   * each pace call (playtest, 26 November 2026: "Push is always right").
   * Bottom-outs and the oil's heat already follow the speed through the
   * physics; this is the pounding in between. So Push gains time today and
   * leaves the crew more to put right tonight, and on a long raid it adds up.
   */
  paceLoad: { conserve: 0.6, steady: 1, push: 1.7 },
} as const

/**
 * Money the crew can spend on parts at the bivouacs of one free-play raid,
 * for a light 4x4 (times `CLASS_MONEY`). Career raids spend the garage's own
 * money instead.
 */
export const FREE_PLAY_PARTS_MONEY = 1500
