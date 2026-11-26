/**
 * The shop's three rigs (plan PR 4; the two lap loops started in plan PR 2
 * for the balance bot).
 *
 * - **Shaker rig:** four posts shake the parked truck through a sweep of
 *   speeds, to show where the body and the wheels bounce most. No damage.
 * - **Washboard ladder:** a loop that gets 5 km/h faster every lap, to find
 *   the speed where the dampers fade.
 * - **Torture loop:** whoops, rocks and jumps, faster every lap, to find what
 *   breaks: bottoming, mounts, axles, tires, the frame.
 *
 * Each lap of a loop drives the same road (the loop doesn't change), at the
 * lap's speed times each piece's `pace`: slower through the rocks, flat out
 * on the graded bits. Heat and wear carry over from lap to lap. Speeds in
 * m/s, lengths in metres.
 *
 * The washboard ladder is mostly rough gravel on purpose: washboard alone
 * heats dampers most at 20 to 40 km/h and hardly at all above that (see
 * `docs/RIDE-SIM.md`), so a loop of pure washboard wouldn't get hotter as it
 * got faster. It used to have whoops for the heat, but the light 4x4 and the
 * heavy truck bottomed out on them before their dampers faded; rough gravel
 * heats them without anything big enough to bottom on (`docs/WEAR.md`).
 */
import type { GroundId } from './ground'

export type RigId = 'washboardLadder' | 'tortureLoop'

/** Every rig in the shop, in the order the shop shows them. */
export type ShopRigId = 'shaker' | RigId
export const SHOP_RIGS: readonly ShopRigId[] = ['shaker', 'washboardLadder', 'tortureLoop']

export interface RigPiece {
  ground: GroundId
  length: number
  /** Share of the lap speed driven here. */
  pace: number
}

export interface Rig {
  id: RigId
  pieces: readonly RigPiece[]
  /** First lap's speed (m/s). */
  startSpeed: number
  /** Added every lap (m/s). 5 km/h ≈ 1.39 m/s. */
  speedStep: number
  /** The run stops here if nothing has broken. */
  maxLaps: number
}

const KMH = 1 / 3.6

export const RIGS: Readonly<Record<RigId, Rig>> = {
  // Fade finder: a bit of washboard, then rough gravel, 5 km/h faster each lap.
  washboardLadder: {
    id: 'washboardLadder',
    pieces: [
      { ground: 'washboard', length: 600, pace: 1 },
      { ground: 'rough', length: 1200, pace: 1 },
    ],
    startSpeed: 40 * KMH,
    speedStep: 5 * KMH,
    maxLaps: 16,
  },
  // Breaker: whoops, a rock garden and a jump.
  tortureLoop: {
    id: 'tortureLoop',
    pieces: [
      { ground: 'whoops', length: 400, pace: 0.9 },
      { ground: 'rocks', length: 250, pace: 0.6 },
      { ground: 'graded', length: 150, pace: 1 },
      { ground: 'jumps', length: 350, pace: 1 },
    ],
    startSpeed: 30 * KMH,
    speedStep: 5 * KMH,
    maxLaps: 16,
  },
}

/**
 * The shaker rig: all four posts move up and down together (a sine wave),
 * stepping from slow to fast. At each step it waits for the truck to settle
 * into the beat, then measures how far the body and each wheel move.
 */
export const SHAKER = {
  /** How far each post moves up and down from the middle (m). */
  amplitude: 0.01,
  /** The sweep, slowest to fastest shake (Hz, bounces a second). */
  minFreq: 0.6,
  maxFreq: 18,
  /** Steps in the sweep, spaced evenly on a log scale. */
  points: 28,
  /** Settle for this many beats, and at least this long, before measuring. */
  settleCycles: 4,
  settleMin: 1.5,
  /** Beats measured at each step. */
  measureCycles: 3,
  /**
   * Crest to crest of typical washboard (m), the middle of the washboard
   * recipe's range: a shake of f Hz feels like washboard at f × this m/s.
   */
  washboardWavelength: 0.8,
  /** The wheels follow the posts at slow beats anyway, so wheel hop is looked for above this (Hz). */
  wheelFrom: 3,
} as const

/** The run's history for the live trace and the ghost: one sample every this many metres. */
export const RIG_HISTORY_STEP = 20

/** How the rigs play on screen (not the sim: these only set the pace of the show). */
export const RIG_VIEW = {
  /** Real seconds each lap takes at normal speed. */
  secondsPerLap: 4,
  /** "Fast" plays this many times quicker. */
  fastFactor: 4,
  /** Real seconds the shaker's sweep takes. */
  shakerSeconds: 10,
  /** The break replays at this share of real speed. */
  slowMotion: 0.4,
  /** "Skip to the end" works this long per frame (ms), so the page keeps drawing. */
  skipBudgetMs: 24,
} as const

/**
 * How the 3D view plays the rigs (plan PR 5; only the show, not the sim).
 * The sim keeps its last few seconds of poses (`src/sim/poses.ts`); the view
 * plays clips of it at true speed, then the break again in slow motion.
 */
export const VIEW_3D = {
  /** Seconds of poses the sim keeps: enough for the slow-motion replay. */
  poseSeconds: 4,
  /** Each live clip is this long (s of sim time), played at true speed. */
  clipSeconds: 2.5,
  /** The break replay shows this many seconds before the break... */
  replaySeconds: 3,
  /** ...at this share of real speed. */
  slowMotion: 0.3,
  /** The shaker is slowed so no beat looks faster than this many a second (Hz). */
  shakerShownHz: 2.5,
} as const

/** How the ghost truck looks on the 3D test track: a blue copy you can see through, drawn over everything like an X-ray. */
export const GHOST_LOOK = {
  /** Every colour on the ghost is pulled this far (0 to 1) towards this one. */
  tint: 0x4f9be8,
  mix: 0.85,
  /** How solid each surface is (0 invisible, 1 solid); where surfaces overlap it adds up. */
  opacity: 0.18,
} as const
