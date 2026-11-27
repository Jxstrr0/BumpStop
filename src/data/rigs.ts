/**
 * The shop's rigs (plan PR 4; the two lap loops started in plan PR 2
 * for the balance bot).
 *
 * - **Shaker rig:** four posts shake the parked truck through a sweep of
 *   speeds, to show where the body and the wheels bounce most. No damage.
 * - **Washboard ladder:** a loop that gets 5 km/h faster every lap, to find
 *   the speed where the dampers fade.
 * - **Torture loop:** whoops, rocks and jumps, faster every lap, to find what
 *   breaks: bottoming, mounts, axles, tires, the frame.
 * - **Jump ramp** (v1.21, Kelbo picked it, 27 November 2026): one tabletop
 *   jump a lap, 5 km/h faster each time, with every landing scored: how
 *   level it came down, the bump stops, bottoming and bounces.
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
import type { ClassId } from './classes'
import type { GroundId } from './ground'

export type RigId = 'washboardLadder' | 'tortureLoop' | 'jumpRig'
/** The two lap loops the balance bot checks (the jump ramp scores landings instead). */
export type LoopRigId = Exclude<RigId, 'jumpRig'>

/**
 * Every rig in the shop, in the order the shop shows them. New rigs go on
 * the end: each rig's road seed comes from its place in this list.
 */
export type ShopRigId = 'shaker' | RigId
export const SHOP_RIGS: readonly ShopRigId[] = ['shaker', 'washboardLadder', 'tortureLoop', 'jumpRig']

/**
 * A built tabletop jump, laid on top of a piece's ground (metres along the
 * piece, heights in metres):
 *
 *     run-up | entry curve | straight face | flat top | landing slope | run-out
 *
 * The entry curve bends the road up from flat to the face's slope, so the
 * wheels aren't hit by a sudden edge; the straight face throws front and rear
 * up alike. Land on the slope and the truck comes down with the ground
 * falling away under it; too slow and it lands short on the flat top, too
 * fast and it flies past the slope onto the flat.
 */
export interface TableJump {
  /** Where the entry curve starts (m into the piece). */
  at: number
  /** Length of the entry curve (m). */
  entry: number
  /** The face's slope (rise over run). */
  slope: number
  /** Height of the lip and the flat top (m). */
  height: number
  /** Length of the flat top (m). */
  top: number
  /** Length of the landing slope, from the top back down to the ground (m). */
  landing: number
}

export interface RigPiece {
  ground: GroundId
  length: number
  /** Share of the lap speed driven here. */
  pace: number
  /** A built jump on this piece (the jump ramp). */
  table?: TableJump
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
  // The jump ramp: one tabletop a lap. The stock trucks land it best at
  // about 50 to 55 km/h; from 60 they fly past the slope and bottom out.
  jumpRig: {
    id: 'jumpRig',
    pieces: [{ ground: 'graded', length: 75, pace: 1, table: { at: 20, entry: 8, slope: 0.18, height: 1, top: 4, landing: 12 } }],
    startSpeed: 45 * KMH,
    speedStep: 5 * KMH,
    maxLaps: 6,
  },
}

/** Where a tabletop's lip, the end of its top and the foot of its landing are (m into the piece). */
export function tableMarks(j: TableJump): { lip: number; topEnd: number; landEnd: number } {
  const lip = j.at + j.entry + (j.height - (j.slope * j.entry) / 2) / j.slope
  return { lip, topEnd: lip + j.top, landEnd: lip + j.top + j.landing }
}

/**
 * How the jump ramp scores a landing (0 to 100). Each landing starts at 100
 * and loses points for what went wrong; the word comes from the total. Angles
 * in degrees, `g` the body's hardest jolt in g (1 g = standing still).
 */
export const LANDING = {
  /** How long after the wheels first touch the landing is watched (s): the bump stops, bottoming and bounces. */
  settle: 1.2,
  /** Only flights that start this close to the lip, or past it, count as the jump (m before the lip). */
  liftFrom: 1,
  /** Shorter flights (s) are a wheel skipping, not the truck leaving the ground. */
  minAir: 0.06,
  /** Coming down within this of the ground's own angle is level (degrees). */
  levelWithin: 4,
  /** Points lost per degree past that, nose or tail first. */
  perDegree: 1.5,
  /** Points lost for each end (front, rear) that reached its bump stops. */
  bumpStop: 4,
  /** Points lost for each corner that bottomed out (metal to metal), up to `bottomCap` corners. */
  bottom: 8,
  bottomCap: 3,
  /** Points lost for each bounce (all four wheels off the ground again). */
  bounce: 6,
  /** The body's jolt: points lost per g past `gFrom`, up to `gCap` points. */
  gFrom: 3,
  perG: 1.5,
  gCap: 15,
  /** Landing short on the flat top, or past the slope on the flat. */
  short: 8,
  flat: 8,
  /** The words: at least this many points. Below `firm` it's Hard. */
  clean: 80,
  firm: 50,
} as const
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
  /**
   * The report's verdict (Kelbo's playtest, 26 November 2026), for each
   * class: the body's and the wheels' biggest bounce (times the posts') turn
   * from calm to lively at the first number and too much at the second.
   * Stock trucks sit in the middle on both (about 4% under to 6% over their
   * own numbers); a few more clicks of rebound make calm, a few fewer too much.
   */
  verdict: {
    light4x4: { body: [1.58, 1.74], wheel: [2.06, 2.28] },
    heavy: { body: [1.55, 1.71], wheel: [2.22, 2.45] },
    sxs: { body: [1.52, 1.68], wheel: [1.98, 2.18] },
  } satisfies Record<ClassId, { body: readonly [number, number]; wheel: readonly [number, number] }>,
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
  /** The jump ramp's landing replay starts this long before take-off (s)... */
  landingBefore: 0.6,
  /** ...and its verdict stays on screen this long before the run carries on (real s). */
  landingHold: 1.4,
} as const

/** How the ghost truck looks on the 3D test track: a blue copy you can see through, drawn over everything like an X-ray. */
export const GHOST_LOOK = {
  /** Every colour on the ghost is pulled this far (0 to 1) towards this one. */
  tint: 0x4f9be8,
  mix: 0.85,
  /** How solid each surface is (0 invisible, 1 solid); where surfaces overlap it adds up. */
  opacity: 0.18,
} as const
