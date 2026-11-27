/**
 * Night stages (Kelbo, 27 November 2026). Every tuning number for driving in
 * the dark lives here; `src/sim/night.ts` and the raid sim use them.
 *
 * Some raid stages run into the night (`RaidStage.dark`, the share of the
 * stage where it gets dark). The Polar Night Raid gets darker every day, and
 * each winter raid has one stage that finishes in the dark. Summer raids
 * run under the midnight sun, so they have none.
 *
 * In the dark two things change, both from the lamps on the truck: the
 * truck's own headlamps, plus a light bar and spot lamps if it has them
 * (`LightPart` in `src/data/parts.ts`). The beam is the longest reach and the
 * widest spread of everything fitted.
 *
 * 1. **The driver only goes as fast as the lamps let them stop.** At speed
 *    `v` the truck needs `v × reaction + v² ÷ (2 × braking)` metres to stop,
 *    where braking is the ground's grip times gravity times `brakeShare`.
 *    The driver keeps that inside the beam's reach. On slippery ground the
 *    truck takes longer to stop, so the lamps matter most on ice. Push
 *    drives past the lamps a little (the pace call scales this speed too);
 *    Conserve keeps some in hand.
 * 2. **Hidden ruts.** By day the driver sees washouts and cross-ruts in time
 *    and goes round them or slows. At night only the ones in the beam show
 *    up: a share `spread` of them (the rest are off to the sides or round
 *    the corner), and fewer still if the truck is going faster than it can
 *    stop in the beam. Every rut the driver doesn't see is hit at full
 *    speed: the ride sim gets it as a real dip in the road (`RUT_SHAPE`), so
 *    the hit, the heat and the wear come out of the physics like any bump.
 *
 * The lamps draw power from the engine at night (`LightPart.draw`), and
 * they weigh something all the time. The rivals have decent lamps of their
 * era: the dark doesn't slow them, but they get into a little more trouble.
 */
import type { GroundId } from './ground'

/** The truck's own headlamps, on high beam: every truck has these. */
export const HEADLAMPS = {
  /** m */
  reach: 60,
  /** Share of the road and the corners they light. */
  spread: 0.35,
}

export const NIGHT = {
  /** Seconds from the beam showing something to the brakes going on. */
  reaction: 1,
  /** Share of the ground's grip the driver uses to brake on a loose surface without locking up. */
  brakeShare: 0.6,
  /** The air cools by this much once it's dark (K). */
  airK: -4,
  /** The rivals' chance of trouble, times this, scaled by how much of the stage is in the dark. */
  rivalRisk: 1.3,
}

/**
 * Washouts and cross-ruts per km on each ground. By day the driver goes
 * round them; in the dark the ones outside the beam are hit (see the top).
 */
export const RUTS_PER_KM: Readonly<Record<GroundId, number>> = {
  graded: 1.2,
  washboard: 1,
  rough: 2.5,
  whoops: 1.5,
  rocks: 1.5,
  jumps: 1.5,
  // Frozen ruts and drifts on the winter roads; old pressure cracks on the lake ice.
  iceHeaves: 1.5,
  ice: 0.5,
  snow: 1.5,
}

/**
 * What an unseen rut is in the ride sim: a washout across one wheel track
 * (or both), steep-sided with a flat bottom, long enough that at speed the
 * wheel drops right in and slams into the far edge. (A short dip a tire just
 * skips over, so these are a couple of metres long.)
 */
export const RUT_SHAPE = {
  /** m */
  depth: [0.1, 0.22] as const,
  /** m, edge to edge */
  length: [1.5, 3.2] as const,
  /** How steep the sides are: 1 is a smooth bowl; more is a flatter bottom and steeper edges. */
  edge: 1.8,
  /** Chance it crosses both tracks; otherwise one, either side. */
  bothTracks: 0.4,
}
