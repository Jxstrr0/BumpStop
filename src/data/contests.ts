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
 * - **Jump contest** (`judged`): one tabletop jump an attempt, at the speed
 *   you call. The judges score the landing (the jump ramp's own scoring)
 *   and the crowd pays for distance, so faster flies further and lands
 *   harder. Three attempts; the best one counts.
 * - **Short course** (`timed` too, over laps): a few laps of a gravel pit,
 *   whoops and jumps, against the clock. The laps add up the heat, so a
 *   pace that's quickest for two laps can cook the dampers by the last. Each event is a course made of pieces, the
 * same pieces the shop's rigs use, so the run goes through the same ride
 * sim, the same 3D view and the same wear as the test track.
 *
 * Every number for the events lives here; `src/sim/contest.ts` does the
 * sums. Lengths in metres, speeds in m/s, times in seconds.
 */
import type { ClassId } from './classes'
import type { GroundId } from './ground'
import type { Season } from './raids'
import type { TableJump } from './rigs'
import type { StringKey } from './strings'

export type ContestId = 'hillClimb' | 'speedTrial' | 'jumpOff' | 'shortCourse'
/** How an event is scored: `timed` is the quickest run, `topSpeed` the fastest clean pass, `judged` the most points. */
export type ContestKind = 'timed' | 'topSpeed' | 'judged'

/** How a timed event is driven and how the rivals go at it. */
export interface Timed {
  /**
   * A one-day event is a sprint: the driver goes this much harder than on a
   * raid stage at the same pace call, because there's no tomorrow to save
   * the truck for. Push is where things start to bottom out and break.
   */
  sprint: number
  /** Uphill all the way: power-to-weight sets how much speed it keeps (`HILL_CLIMB`). */
  climb: boolean
  /** Laps of the course a run takes. */
  laps: number
  /** Rivals go at their raid `pace` times this, against the course's par... */
  rivalPace: number
  /** ...and their `risk` times this is the chance they don't finish a run. */
  rivalRisk: number
}

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
  /** A built jump on this piece (the jump contest). */
  table?: TableJump
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
  /** How a timed event is driven (`timed` only). */
  timed?: Timed
  /** A speed trial's passes (`topSpeed` only). */
  passes?: Passes
  /** The approach speeds a jump contest lets you call (km/h, `judged` only). */
  speeds?: readonly number[]
}

/** The events, in the order the screen lists them. New ones go on the end. */
export const CONTEST_IDS: readonly ContestId[] = ['hillClimb', 'speedTrial', 'jumpOff', 'shortCourse']

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
    timed: { sprint: 1.3, climb: true, laps: 1, rivalPace: 0.92, rivalRisk: 0.25 },
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
  // The fall fair at Sawbuck: one big tabletop in front of the grandstand.
  jumpOff: {
    id: 'jumpOff',
    kind: 'judged',
    name: 'contest.jumpOff.name',
    text: 'contest.jumpOff.text',
    season: 'summer',
    airC: 15,
    seed: 8301,
    // The jump ramp's own tabletop (`RIGS.jumpRig`), so what you learn on the test track works here.
    course: [{ ground: 'graded', length: 200, table: { at: 90, entry: 8, slope: 0.18, height: 1, top: 4, landing: 12 } }],
    runs: 3,
    speeds: [46, 50, 54, 58, 62, 66],
  },
  // Laps of a gravel pit outside Sawbuck: whoops, jumps and churned-up gravel, round and round.
  shortCourse: {
    id: 'shortCourse',
    kind: 'timed',
    name: 'contest.shortCourse.name',
    text: 'contest.shortCourse.text',
    season: 'summer',
    airC: 27,
    seed: 8401,
    course: [
      { ground: 'graded', length: 140 },
      { ground: 'whoops', length: 160 },
      { ground: 'jumps', length: 150 },
      { ground: 'rough', length: 180 },
      { ground: 'graded', length: 110 },
      { ground: 'whoops', length: 130 },
      { ground: 'jumps', length: 120 },
      { ground: 'rough', length: 110 },
    ],
    runs: 2,
    timed: { sprint: 1.1, climb: false, laps: 6, rivalPace: 1.02, rivalRisk: 0.3 },
  },
}

/**
 * The timed events. On the hill climb, going uphill takes speed off
 * everywhere; how much depends on power-to-weight, and far more than on a
 * raid (where it only counts on the fast ground), because every metre is a
 * climb. The bottom-out cost and the rivals' bottom-outs count on any timed
 * event.
 */
export const HILL_CLIMB = {
  /** The stock truck climbs at this share of its usual Steady speed on each ground. */
  climbShare: 0.86,
  /** Power-to-weight against the stock truck's, to this power, sets how much better (or worse) it climbs... */
  powerExponent: 0.4,
  /** ...inside these limits (shares of the usual speed). */
  climbLimits: [0.76, 0.98] as const,
  /** The driver lifts after each bottom-out (each corner counts): this many seconds lost. */
  bottomOutCost: 1,
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

/**
 * The jump contest. A jump's points are its landing score (out of 100, the
 * jump ramp's `LANDING` rules) plus `perMetre` for every metre flown. A
 * stock truck does best a notch or two under the speed where it starts to
 * fly past the landing slope.
 */
export const JUMP_OFF = {
  /** Points for each metre flown, take-off to touch-down. */
  perMetre: 4,
  /**
   * The stock truck's best jump in each class, picking its best speed
   * (points; `tests/contests.test.ts` checks it still is).
   */
  stockBest: { light4x4: 112, heavy: 121, sxs: 108 } as Readonly<Record<ClassId, number>>,
  /** A rival's jump: the stock best plus this many points for each 0.01 their raid `pace` is under 1... */
  pointsPerPace: 0.6,
  /** ...wandering by up to this many points either way, from their `spread`... */
  wander: 120,
  /** ...and their `risk` times this is the chance of a botched landing, worth `botched` of the points. */
  rivalRisk: 0.3,
  botched: 0.5,
} as const

// ── The events in the career ──

/** One running of an event in the career's year: a round of its series. */
export interface Round {
  contest: ContestId
  /** Day of the year (1 is the first of January). */
  day: number
}

/**
 * Each event runs three rounds a year, a small series, in the summer gaps
 * between the raids (the raids end on days 81, 165 and 195; the next start
 * on 158, 186 and 244). In day order. The Jump-Off's last round is the fall
 * fair itself, in late August.
 */
export const ROUNDS: readonly Round[] = [
  { contest: 'hillClimb', day: 121 },
  { contest: 'shortCourse', day: 128 },
  { contest: 'speedTrial', day: 135 },
  { contest: 'hillClimb', day: 142 },
  { contest: 'shortCourse', day: 149 },
  { contest: 'speedTrial', day: 172 },
  { contest: 'jumpOff', day: 179 },
  { contest: 'hillClimb', day: 201 },
  { contest: 'shortCourse', day: 208 },
  { contest: 'jumpOff', day: 215 },
  { contest: 'speedTrial', day: 222 },
  { contest: 'jumpOff', day: 236 },
]

/**
 * Money, reputation and series points for the events in the career. Money
 * is for a light 4x4 and scales by class like a raid's (`CLASS_MONEY`). A
 * one-day event pays less than a raid, and costs less: no bivouacs, no
 * week of wear, only what breaks.
 */
export const EVENT_CAREER = {
  /** Entry fee. */
  entryFee: 400,
  /** Prize money by place, first to third. */
  prizes: [4000, 2500, 1500] as readonly number[],
  /** A timed event's driver is paid this share of their fee for a regional raid. The others are driven by the crew. */
  driverShare: 0.25,
  /** Putting right a part that broke on a run, at the usual repair share (crew and tools make it cheaper, like a raid's repairs). */
  breakRepair: 1500,
  /** Reputation for a podium and a win. */
  rep: { podium: 1, win: 2 },
  /** Series points by place, first to sixth. */
  points: [10, 6, 4, 3, 2, 1] as readonly number[],
  /** Winning a series, at the end of the year: money (times `CLASS_MONEY`) and reputation. */
  champion: { money: 8000, rep: 3 },
} as const
