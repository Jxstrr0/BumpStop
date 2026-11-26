/**
 * Numbers for the help's damper lessons (plan PR 11): one corner of a light
 * 4x4, cut down to two weights on springs (a "quarter car"), and the roads
 * each lesson drives it over. The lessons are a teaching toy: they never
 * touch the game's results. The real truck is the seven-part model in
 * `src/sim/ride.ts`; these numbers are close to its light 4x4 test mule
 * (`TEST_MULES.light4x4.front` in `src/data/ride.ts`) so the toy feels the same.
 *
 * SI units: kg, m, s, N.
 */

/** One corner of the truck. */
export const QUARTER_CAR = {
  /** The body's share of the truck's weight on this corner (kg). */
  bodyMass: 420,
  /** Wheel, tire, hub and half the arms (kg). */
  wheelMass: 75,
  /** Spring stiffness at the wheel (N/m). */
  springRate: 32000,
  /** The tire as a spring (N/m). It can only push, never pull: off the ground it's nothing. */
  tireRate: 280000,
  /** Compression damping as the factory sets it (N·s/m): slows the wheel going up. */
  compression: 2600,
  /** Rebound damping as the factory sets it (N·s/m): slows the wheel coming back down. */
  rebound: 4200,
  /**
   * Above this travel speed (m/s) the damper's valves open up ("blow off"),
   * so a sharp hit isn't met with a wall: each extra m/s adds only
   * `highShare` of the low-speed damping. Like the real dampers' knee.
   */
  knee: 0.15,
  highShare: 0.35,
  /** How far the wheel can rise before metal meets metal (m). */
  bumpTravel: 0.17,
  /** How far it can drop before the limit strap (m). */
  droopTravel: 0.13,
  /** The bump stop takes the last part of the bump travel (m). */
  bumpStopLength: 0.05,
  /** The bump stop gets stiffer the more it's squashed: force = rate × squash² (N/m²). */
  bumpStopRate: 2_400_000,
  /** The hard limit and the limit strap, as very stiff springs (N/m). */
  hardRate: 4_000_000,
  /** Damping in the hard limit, so a bottom-out doesn't ring forever (N·s/m). */
  hardDamping: 8000,
  gravity: 9.81,
} as const

/** The toy's own time step: 1,000 a second, so stiff bump stops stay steady. */
export const LESSON_STEP = 1 / 1000

/** A run of identical bumps along the road. */
export interface LessonRoad {
  /** Road speed (m/s). */
  speed: number
  /** Flat road before the first bump (m). */
  lead: number
  /** Each bump's length (m) and height (m). */
  length: number
  height: number
  /** How many bumps, and the gap between their starts (m). */
  count: number
  pitch: number
  /** How long the lesson's clip lasts (s). */
  seconds: number
}

/**
 * Each lesson's road:
 * - `oneBump`: a single 10 cm bump at 30 km/h, to watch the body settle.
 * - `washboard`: 4 cm ripples every 0.8 m at 40 km/h, where too much
 *   rebound packs the wheel up into its travel.
 * - `bigHit`: a whoop at 55 km/h, big enough to find the bump stop.
 */
export const LESSON_ROADS = {
  oneBump: { speed: 30 / 3.6, lead: 2, length: 1.2, height: 0.1, count: 1, pitch: 0, seconds: 3 },
  washboard: { speed: 40 / 3.6, lead: 2, length: 0.8, height: 0.04, count: 30, pitch: 0.8, seconds: 2.5 },
  bigHit: { speed: 55 / 3.6, lead: 2, height: 0.18, count: 1, pitch: 0, seconds: 2, length: 3 },
} as const satisfies Record<string, LessonRoad>

export type LessonRoadId = keyof typeof LESSON_ROADS

/**
 * The lesson sliders, as steps from the factory setting. Each step multiplies
 * (or, for spring rate, scales) the setting; step 0 is as the factory set it.
 */
export const LESSON_DIALS = {
  /** Lesson 1: both compression and rebound, from none at all to far too much. */
  damping: { min: -4, max: 4, factors: [0, 0.15, 0.35, 0.6, 1, 1.6, 2.5, 3.6, 5] },
  /** Lesson 2: rebound only. */
  rebound: { min: -4, max: 4, factors: [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2.2, 3.2, 4.5] },
  /** Lesson 4: spring rate. */
  spring: { min: -3, max: 3, factors: [0.55, 0.7, 0.85, 1, 1.2, 1.45, 1.75] },
  /** Lesson 4: bump stop length (m) for each step. */
  bumpStop: { min: -2, max: 2, lengths: [0.02, 0.035, 0.05, 0.065, 0.08] },
} as const

/** Lesson 3's chart: the oil temperatures it spans (°C). */
export const OIL_CHART = { fromC: -30, toC: 190, stepC: 2 } as const
