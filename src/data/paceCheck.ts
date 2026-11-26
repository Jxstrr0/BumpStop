/**
 * The pace check (playtest, 26 November 2026: "Push is always right, and the
 * rigs don't predict the raids"). Before a stage, and under the shop's
 * washboard ladder and torture loop, the ride sim drives a long stretch of
 * each kind of ground at Conserve, Steady and Push, the same way a raid does
 * (`runStage`, sampled), and says how hot the dampers settle and how fast
 * the worst part wears. So the pace call can be read off the truck, and the
 * rigs say what they mean on a raid. Numbers only: `src/sim/paceCheck.ts`.
 */
import type { RaidGround } from './raids'

export const PACE_CHECK = {
  /** How long a stretch of each ground it drives (m): a typical raid piece of one ground, and one sample of the long-stage maths, so it stays quick on a phone. */
  length: 5000,
  /** The roads it drives: the same every time, so a change to the truck is all that changes the answer. */
  seed: 4242,
  /** Air for the shop's check (°C): a mild summer stage. */
  shopAirC: 20,
  /** The raid ground each rig stands for, on the rig's report. */
  rigGround: {
    washboardLadder: ['washboard', 'rough'],
    tortureLoop: ['whoops', 'rocks', 'jumps'],
  } as Readonly<Record<'washboardLadder' | 'tortureLoop', readonly RaidGround[]>>,
  /** Ground with nothing on it to heat a damper or wear a part is left out: the fast smooth stuff. */
  skip: ['graded', 'ice'] as readonly RaidGround[],
  /**
   * Worst part's wear over 10 km, as a share of its life, from which the
   * check calls it Warm and Over the limit. A raid stage has 10 to 25 km of
   * a rough ground and a raid five to fourteen stages, so 3% per 10 km adds
   * up to a worn part by the end and 10% to a break inside a few days.
   */
  wearWarm: 0.03,
  wearHot: 0.1,
} as const
