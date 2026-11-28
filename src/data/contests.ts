/**
 * One-day events (Kelbo picked them, 28 November 2026): short contests that
 * each test a different side of a suspension, the way Prairie Engine Works
 * has drag, pull, salt flats and the rest. A raid asks whether the truck
 * lasts a week; these ask one sharper question each.
 *
 * - **Hill climb** (`timed`): one short run up rough ground against the
 *   clock, twice, and the better run counts. Brave and stiff wins; every
 *   bottom-out costs time, and a break ends the run short of the top.
 * - **Speed trial** (`topSpeed`): a measured mile, driven again and again
 *   with no rest, 5 km/h faster each pass, until the dampers fade (or
 *   something breaks). The fastest clean pass counts. It asks one thing:
 *   how well the dampers shed heat.
 *
 * More kinds join this table in their own PRs (the jump contest, the short
 * course). Each event is a course made of pieces, the
 * same pieces the shop's rigs use, so the run goes through the same ride
 * sim, the same 3D view and the same wear as the test track.
 *
 * Every number for the events lives here; `src/sim/contest.ts` does the
 * sums. Lengths in metres, speeds in m/s, times in seconds.
 */
import type { ClassId } from './classes'
import type { GroundId } from './ground'
import type { Season } from './raids'
import type { StringKey } from './strings'

export type ContestId = 'hillClimb' | 'speedTrial'
/** How an event is scored: `timed` is the quickest run, `topSpeed` the fastest clean pass. */
export type ContestKind = 'timed' | 'topSpeed'

/** A speed trial's passes: the first one's speed, how much faster each next one is, and how many at most. */
export interface Passes {
  startKmh: number
  stepKmh: number
  most: number
}

/** One stretch of an event's course. */
export interface CoursePiece {
  ground: GroundId
  length: number
}

export interface Contest {
  id: ContestId
  kind: ContestKind
  /** The name players see, and a line on what it is. */
  name: StringKey
  text: StringKey
  season: Season
  /** Outside air (°C). */
  airC: number
  /** The course's road seed: every entry drives the same course, so a second run shows what a change did. */
  seed: number
  course: readonly CoursePiece[]
  /** Runs each entry gets; the best one counts. */
  runs: number
  /** A speed trial's passes (`topSpeed` only). */
  passes?: Passes
}

/** The events, in the order the screen lists them. New ones go on the end. */
export const CONTEST_IDS: readonly ContestId[] = ['hillClimb', 'speedTrial']

export const CONTESTS: Readonly<Record<ContestId, Contest>> = {
  // Up the old mine tailings at Gritstone: rough, rocky and short.
  hillClimb: {
    id: 'hillClimb',
    kind: 'timed',
    name: 'contest.hillClimb.name',
    text: 'contest.hillClimb.text',
    season: 'summer',
    airC: 21,
    seed: 8101,
    course: [
      { ground: 'graded', length: 120 },
      { ground: 'rough', length: 200 },
      { ground: 'rocks', length: 150 },
      { ground: 'whoops', length: 160 },
      { ground: 'jumps', length: 200 },
      { ground: 'rough', length: 160 },
      { ground: 'rocks', length: 140 },
      { ground: 'whoops', length: 140 },
      { ground: 'jumps', length: 160 },
      { ground: 'rocks', length: 100 },
      { ground: 'rough', length: 150 },
      { ground: 'graded', length: 120 },
    ],
    runs: 2,
  },
  // A measured mile of washboard and rough gravel, round and round, faster every pass.
  speedTrial: {
    id: 'speedTrial',
    kind: 'topSpeed',
    name: 'contest.speedTrial.name',
    text: 'contest.speedTrial.text',
    season: 'summer',
    airC: 24,
    seed: 8201,
    // Washboard alone hardly heats dampers at speed (`docs/RIDE-SIM.md`), so most of the mile is rough gravel, like the washboard ladder.
    course: [
      { ground: 'washboard', length: 600 },
      { ground: 'rough', length: 1000 },
    ],
    runs: 2,
    passes: { startKmh: 50, stepKmh: 5, most: 20 },
  },
}

/**
 * The hill climb. Going uphill takes speed off everywhere; how much depends
 * on power-to-weight, and far more than on a raid (where it only counts on
 * the fast ground), because every metre here is a climb.
 */
export const HILL_CLIMB = {
  /**
   * A hill climb is a sprint: the driver goes this much harder than on a
   * raid stage at the same pace call, because there's no tomorrow to save
   * the truck for. Push is where things start to bottom out and break.
   */
  sprint: 1.3,
  /** The stock truck climbs at this share of its usual Steady speed on each ground. */
  climbShare: 0.86,
  /** Power-to-weight against the stock truck's, to this power, sets how much better (or worse) it climbs... */
  powerExponent: 0.4,
  /** ...inside these limits (shares of the usual speed). */
  climbLimits: [0.76, 0.98] as const,
  /** The driver lifts after each bottom-out (each corner counts): this many seconds lost. */
  bottomOutCost: 1,
  /**
   * Rivals go up at their raid `pace` times this, against the course's par:
   * a hill climb is where the quick teams push, so the stock truck needs a
   * good driver on Push (or a better truck) to beat the best of them.
   */
  rivalPace: 0.92,
  /** A rival's chance of not making the top on a run: their `risk` times this. */
  rivalRisk: 0.25,
  /** Rivals bottom out too: up to their `risk` times this many times a run. */
  rivalBottoms: 12,
} as const

/**
 * The speed trial. Your truck's passes come from the ride sim; the rivals'
 * from these numbers.
 */
export const SPEED_TRIAL = {
  /**
   * The stock truck's fastest clean pass in each class on this mile (km/h),
   * from the ride sim (`tests/contests.test.ts` checks it still is). The
   * side-by-side's small dampers cook early.
   */
  stockTop: { light4x4: 90, heavy: 80, sxs: 60 } as Readonly<Record<ClassId, number>>,
  /** A rival's top pass: the stock one plus this many km/h for each 0.01 their raid `pace` is under 1 (quicker teams run better dampers)... */
  kmhPerPace: 1.2,
  /** ...wandering by up to this many passes either way, from their `spread`... */
  wander: 25,
  /** ...and their `risk` times this is the chance a run ends a pass early with something broken. */
  rivalRisk: 0.5,
} as const
