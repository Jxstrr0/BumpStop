/**
 * Raids (plan PR 7): the stages, the pace calls, the hired drivers, the
 * roadside fixes, the bivouac jobs and the rival entries. Every tuning
 * number for a raid lives here; `src/sim/raid.ts` and `src/sim/rivals.ts`
 * use them.
 *
 * How a stage is driven (see `docs/RAIDS.md`):
 *
 * - Each piece of ground has a **Steady speed** for each class (km/h): about
 *   as fast as the class's stock truck can go there all day without cooking
 *   its dampers or wearing out its parts too fast. These were measured with
 *   the ride sim on 10 km of each ground (PR 7's sweep, in the docs).
 * - The **pace call** scales every speed: Conserve is slower and kinder,
 *   Push is faster and heats everything. The driver's traits scale it again.
 * - The ride sim then drives the stage at those speeds (`src/sim/stage.ts`),
 *   so heat and wear come out of the physics, never a dice roll. Rival
 *   teams are the one exception: they're quick estimates (`rivals.ts`).
 *
 * Names: Kelbo picked the raids' names on 26 November 2026 (Cold Start 300
 * to The Whole Damn Country, `docs/NAMES.md`). The ids here stay the old
 * working names (`summerSprint`, `longOne`...) so saves keep working; the
 * names players see live only in `src/data/strings.ts` (`raid.*.name`).
 */
import type { ClassId } from './classes'
import type { CondPart } from './condition'
import type { GroundId } from './ground'
import type { SpareId } from './parts'
import type { StringKey } from './strings'
import type { UnderPart } from './underside'
import type { FailureKind } from './wear'

// ── Pace calls ──

export type PaceId = 'conserve' | 'steady' | 'push'
export const PACES: readonly PaceId[] = ['conserve', 'steady', 'push']

/** Each pace call scales every speed on the stage by this. */
export const PACE_SPEED: Readonly<Record<PaceId, number>> = { conserve: 0.88, steady: 1, push: 1.12 }

/** Ground a raid stage can be made of: summer ground, and winter ground for winter raids (plan PR 10). */
export type RaidGround = GroundId

/**
 * Steady speeds (km/h), for an average driver in the class's stock truck.
 * Washboard is driven fast on purpose: slow over washboard is where the
 * wheels hop and the dampers cook (`docs/RIDE-SIM.md`), so drivers skim it.
 *
 * On ice and snow (plan PR 10) the grip sets the speed, not the dampers:
 * these are on plain tires, with 10% in hand at the tightest corner, and
 * studs go faster (`CORNERS` in `src/data/winter.ts`). The heavy truck is
 * slowest on ice: it takes the longest to stop. Frost heaves are set like
 * summer ground, just under where the stock trucks start to take damage
 * at Push on studs (the PR 10 sweep, `docs/WINTER.md`).
 */
export const STEADY_KMH: Readonly<Record<ClassId, Record<RaidGround, number>>> = {
  light4x4: { graded: 85, washboard: 68, rough: 44, whoops: 27, rocks: 30, jumps: 48, iceHeaves: 58, ice: 50, snow: 62 },
  heavy: { graded: 75, washboard: 62, rough: 42, whoops: 25, rocks: 48, jumps: 44, iceHeaves: 50, ice: 40, snow: 55 },
  sxs: { graded: 78, washboard: 64, rough: 34, whoops: 24, rocks: 26, jumps: 35, iceHeaves: 48, ice: 48, snow: 58 },
}

export const RAID = {
  /** The two checkpoints, as shares of the stage's length: the pace can change at each. */
  checkpoints: [1 / 3, 2 / 3],
  /**
   * The engine sets the pace on the fast ground: speed there follows the
   * truck's power-to-weight against the stock truck's, to this power, and
   * stays inside `powerLimits`.
   */
  powerExponent: 0.15,
  powerLimits: [0.94, 1.08],
  fastGround: ['graded', 'washboard'] as readonly RaidGround[],
  /** Ground that's hard on the truck: a hard driver goes this much faster here, a smooth one this much slower. */
  harshGround: ['rough', 'whoops', 'rocks', 'jumps', 'iceHeaves'] as readonly RaidGround[],
  hardSpeed: 0.06,
  /** After a roadside stop the driver eases off one pace call for the rest of the leg, at most this many times. */
  easeSteps: 2,
  /** A leg with this many stops ends early: the crew limps to the checkpoint at walking pace. */
  maxStopsPerLeg: 4,
  /** Limping to the checkpoint: this share of the Steady speed. */
  limpShare: 0.35,
  /**
   * The stage closes at this many times its par time (Steady, average driver,
   * no stops). A truck still out then is towed in: closing time plus a penalty.
   */
  closeAfter: 2,
  latePenalty: 2 * 3600,
  /** Mechanic hours each night at the bivouac. */
  bivouacHours: 8,
  /** A part needs a look at the bivouac once it's this worn. */
  jobFrom: 0.05,
  /** A damper that faded is left to cool to its warm line, and never for less than this (s). */
  coolMin: 10 * 60,
  /** On a rest day (`Raid.restAfter`) the crew has a whole day, not a night: this many times the hours. */
  restDayHours: 2,
} as const

/** Jobs on a heavy truck take longer, on a side-by-side less (roadside fixes and the bivouac alike). */
export const CLASS_WORK: Readonly<Record<ClassId, number>> = { light4x4: 1, heavy: 1.5, sxs: 0.8 }

// ── Hired drivers ──

export type DriverId = 'veteran' | 'charger' | 'gravelAce' | 'mechanic'
export const DRIVER_IDS: readonly DriverId[] = ['veteran', 'charger', 'gravelAce', 'mechanic']

export interface Driver {
  id: DriverId
  /** Shown by their trade for now: drivers get names once Kelbo picks them (`docs/NAMES.md`). */
  name: StringKey
  text: StringKey
  /** Quick or steady: every speed times this. */
  speed: number
  /** Smooth (-1) to hard on the kit (+1): faster through harsh ground, so it heats and wears more. */
  hardness: number
  /** Ground they read well: same speed and same hits, but better lines save time there. */
  skill: readonly RaidGround[]
  /** Time on that ground times this. */
  skillTime: number
  /** Roadside fixes take this long (share of the usual). */
  fixTime: number
  /**
   * The people who do this job (Kelbo, 26 November 2026): each career hires
   * one of them (`driverName` in `src/sim/career.ts`); free play has the first.
   */
  pool: readonly StringKey[]
}

export const DRIVERS: Readonly<Record<DriverId, Driver>> = {
  veteran: { id: 'veteran', name: 'driver.veteran', text: 'driver.veteranText',
    speed: 0.97, hardness: -1, skill: ['rocks', 'ice'], skillTime: 0.9, fixTime: 1,
    pool: ['driverName.arne', 'driverName.bud', 'driverName.oldMac', 'driverName.gus'] },
  charger: { id: 'charger', name: 'driver.charger', text: 'driver.chargerText',
    speed: 1.03, hardness: 1, skill: ['whoops', 'jumps'], skillTime: 0.93, fixTime: 1,
    pool: ['driverName.dee', 'driverName.rory', 'driverName.kit', 'driverName.nell'] },
  gravelAce: { id: 'gravelAce', name: 'driver.gravelAce', text: 'driver.gravelAceText',
    speed: 1.01, hardness: 0, skill: ['graded', 'washboard', 'rough', 'snow'], skillTime: 0.98, fixTime: 1,
    pool: ['driverName.sami', 'driverName.benny', 'driverName.ida', 'driverName.lou'] },
  mechanic: { id: 'mechanic', name: 'driver.mechanic', text: 'driver.mechanicText',
    speed: 0.99, hardness: -0.5, skill: [], skillTime: 1, fixTime: 0.7,
    pool: ['driverName.ozzie', 'driverName.hank', 'driverName.fran', 'driverName.doc'] },
}

// ── Roadside fixes ──

/** What the crew can do when something breaks on a stage (fade aside: a faded damper is left to cool). */
export interface RoadsideFix {
  /** The spare that fixes it properly, or null if there's no spare for it. */
  spare: SpareId | null
  /** Hours with the spare: the part is as good as new. */
  withSpare: number
  /** Hours for a bodge without one. */
  bodge: number
  /** How worn the bodged part is afterwards (0 to 1): it'll go again sooner. */
  bodgeWear: number
}

export const ROADSIDE: Readonly<Record<Exclude<FailureKind, 'fade'>, RoadsideFix>> = {
  // A wheel swap with the spare takes 10 minutes on a light 4x4 (Kelbo, 28 November 2026: it was 24, slower than a
  // real amateur crew); 15 on a heavy truck, 8 on a side-by-side (CLASS_WORK).
  tire: { spare: 'tire', withSpare: 10 / 60, bodge: 1.2, bodgeWear: 0.6 },
  bottoming: { spare: 'shock', withSpare: 0.9, bodge: 1.5, bodgeWear: 0.7 },
  axle: { spare: 'cv', withSpare: 1, bodge: 2, bodgeWear: 0.8 },
  mount: { spare: null, withSpare: 0, bodge: 1.2, bodgeWear: 0.6 },
  frame: { spare: null, withSpare: 0, bodge: 1.5, bodgeWear: 0.7 },
}

// ── The bivouac ──

/** The part a job works on, by its fatigue count in the wear model. */
export type JobPart = 'tire' | 'bottoming' | 'axle' | 'mount' | 'frame'

export type JobKind =
  | 'newTire' | 'patchTire' | 'newShock' | 'rebuildShock' | 'newCv' | 'weldMount' | 'weldFrame'
  | 'freshOil' | 'newBushings' | 'resetSprings' | 'newSprings'
  | 'weldSump' | 'sealDiff' | 'patchTank'

export interface JobSpec {
  /**
   * A part by its fatigue count (per corner, or frame zone), a kind of slow
   * wear (per axle, `src/data/condition.ts`), or a part under the truck
   * (`src/data/underside.ts`).
   */
  part: JobPart | CondPart | UnderPart
  /** Mechanic hours (times `CLASS_WORK`). */
  hours: number
  /** The spare it uses, or null. */
  spare: SpareId | null
  /**
   * Money for the parts and oil, for a light 4x4 (cr., times `CLASS_MONEY`).
   * Jobs that fit a spare cost nothing more here: the spare is already paid for.
   */
  cost: number
  /** Damage left afterwards, as a share of the damage now: 0 is a new part. */
  keep: number
  name: StringKey
}

/**
 * Every job, in the order the bivouac lists them for a part. Four of them
 * (bivouac breakdowns, after 1.2) work on a whole axle: both shocks' oil,
 * both sets of bushings, both springs. The last three (underside hits, after
 * 1.13) put right a dented oil pan, diff or fuel tank, which stops it leaking.
 */
export const JOBS: Readonly<Record<JobKind, JobSpec>> = {
  newTire: { part: 'tire', hours: 0.5, spare: 'tire', cost: 0, keep: 0, name: 'job.newTire' },
  patchTire: { part: 'tire', hours: 0.75, spare: null, cost: 25, keep: 0.5, name: 'job.patchTire' },
  newShock: { part: 'bottoming', hours: 1.5, spare: 'shock', cost: 0, keep: 0, name: 'job.newShock' },
  rebuildShock: { part: 'bottoming', hours: 1.25, spare: null, cost: 150, keep: 0.5, name: 'job.rebuildShock' },
  newCv: { part: 'axle', hours: 1.5, spare: 'cv', cost: 0, keep: 0, name: 'job.newCv' },
  weldMount: { part: 'mount', hours: 2, spare: null, cost: 40, keep: 0.3, name: 'job.weldMount' },
  weldFrame: { part: 'frame', hours: 3, spare: null, cost: 80, keep: 0.4, name: 'job.weldFrame' },
  freshOil: { part: 'oil', hours: 1, spare: null, cost: 120, keep: 0, name: 'job.freshOil' },
  newBushings: { part: 'bushing', hours: 1.5, spare: null, cost: 180, keep: 0, name: 'job.newBushings' },
  resetSprings: { part: 'spring', hours: 0.5, spare: null, cost: 0, keep: 0.5, name: 'job.resetSprings' },
  newSprings: { part: 'spring', hours: 2, spare: null, cost: 450, keep: 0, name: 'job.newSprings' },
  weldSump: { part: 'sump', hours: 1, spare: null, cost: 140, keep: 0, name: 'job.weldSump' },
  sealDiff: { part: 'diff', hours: 1.25, spare: null, cost: 220, keep: 0, name: 'job.sealDiff' },
  patchTank: { part: 'tank', hours: 0.75, spare: null, cost: 110, keep: 0, name: 'job.patchTank' },
}

export const JOB_KINDS = Object.keys(JOBS) as JobKind[]

// ── Raids ──

export type RaidId = 'summerSprint' | 'summerRaid' | 'midsummerSprint' | 'nationalRaid' | 'autumnRaid' | 'longOne' | 'winterSprint' | 'winterRaid'
export const RAID_IDS: readonly RaidId[] = ['summerSprint', 'summerRaid', 'midsummerSprint', 'nationalRaid', 'autumnRaid', 'longOne', 'winterSprint', 'winterRaid']
/** The raids the free-play raid panel offers; the rest come with the career's calendar (plan PR 9). */
export const FREE_RAID_IDS: readonly RaidId[] = ['summerSprint', 'summerRaid', 'winterSprint', 'winterRaid']

export type Season = 'summer' | 'winter'

export interface RaidSegment {
  ground: RaidGround
  km: number
}

export interface RaidStage {
  /** A few words on what the stage is like (not a place name). */
  tag: StringKey
  /** Air temperature (°C). */
  airC: number
  segments: readonly RaidSegment[]
  /**
   * The lake ice under every ice-road stretch of the stage (plan PR 10):
   * its thickness at the thinnest place (cm) and the speed of the wave
   * under it (km/h). See `src/data/winter.ts`.
   */
  ice?: { cm: number; waveKmh: number }
  /**
   * Night stages (Kelbo, 27 November 2026): where it gets dark, as a share
   * of the stage (0 is dark from the start). Missing means it finishes in
   * daylight. See `src/data/night.ts`.
   */
  dark?: number
}

export interface Raid {
  id: RaidId
  /** The name players see (see the top of this file). */
  name: StringKey
  text: StringKey
  season: Season
  /** Every entry drives the same roads, so a second go shows what a change did. */
  seed: number
  stages: readonly RaidStage[]
  /**
   * A rest day after this many stages (plan PR 13): the Long One's halfway
   * day in the bivouac, with `RAID.restDayHours` times the crew's hours.
   */
  restAfter?: number
}

/** Shorthand for writing stages: [ground, km] pairs. */
const route = (...pairs: [RaidGround, number][]): RaidSegment[] => pairs.map(([ground, km]) => ({ ground, km }))

/**
 * Stages the career's longer raids share (plan PR 9). Each raid drives them
 * on its own seed, so the same kind of stage is a different road each time.
 */
const LONG_STAGES = {
  logging: { tag: 'stage.loggingRoads', airC: 17, segments: route(
    ['graded', 24], ['washboard', 10], ['graded', 20], ['rough', 8], ['graded', 22], ['jumps', 5],
    ['graded', 18], ['washboard', 8], ['rough', 5], ['graded', 20]) },
  eskers: { tag: 'stage.eskers', airC: 21, segments: route(
    ['graded', 18], ['washboard', 14], ['jumps', 6], ['graded', 16], ['rough', 10], ['washboard', 12],
    ['graded', 22], ['jumps', 5], ['rough', 8], ['graded', 24], ['washboard', 10], ['graded', 15]) },
  rock: { tag: 'stage.rockCountry', airC: 24, segments: route(
    ['graded', 20], ['rocks', 5], ['graded', 15], ['rough', 10], ['rocks', 4], ['washboard', 10],
    ['graded', 22], ['whoops', 4], ['graded', 15], ['rocks', 5], ['rough', 8], ['graded', 22]) },
  haul: { tag: 'stage.haulRoads', airC: 28, segments: route(
    ['graded', 26], ['rough', 12], ['washboard', 10], ['graded', 20], ['rough', 10], ['rocks', 4],
    ['graded', 24], ['washboard', 12], ['rough', 8], ['graded', 24], ['jumps', 4], ['graded', 16]) },
  burn: { tag: 'stage.oldBurn', airC: 23, segments: route(
    ['graded', 20], ['whoops', 5], ['rough', 8], ['graded', 18], ['jumps', 6], ['washboard', 10],
    ['graded', 16], ['whoops', 4], ['rocks', 4], ['graded', 20], ['rough', 8], ['jumps', 4], ['graded', 17]) },
  mines: { tag: 'stage.minesRoad', airC: 20, segments: route(
    ['graded', 24], ['rocks', 4], ['graded', 20], ['rough', 12], ['rocks', 3], ['graded', 25],
    ['washboard', 8], ['rocks', 3], ['graded', 22], ['rough', 6], ['graded', 15]) },
  fast: { tag: 'stage.longGravel', airC: 19, segments: route(
    ['graded', 34], ['washboard', 12], ['graded', 30], ['rough', 6], ['graded', 28], ['washboard', 10],
    ['graded', 32], ['jumps', 3], ['graded', 25]) },
} as const satisfies Record<string, RaidStage>

export const RAIDS: Readonly<Record<RaidId, Raid>> = {
  summerSprint: {
    id: 'summerSprint',
    name: 'raid.summerSprint.name',
    text: 'raid.summerSprint.text',
    season: 'summer',
    seed: 7101,
    stages: [
      { tag: 'stage.loggingRoads', airC: 18, segments: route(
        ['graded', 18], ['washboard', 8], ['graded', 14], ['rough', 6], ['graded', 16],
        ['jumps', 4], ['graded', 14], ['washboard', 6], ['rough', 4], ['graded', 10]) },
      { tag: 'stage.rockCountry', airC: 22, segments: route(
        ['graded', 14], ['rocks', 4], ['graded', 10], ['rough', 8], ['washboard', 6], ['rocks', 4],
        ['graded', 18], ['whoops', 3], ['graded', 14], ['rocks', 3], ['graded', 16]) },
      { tag: 'stage.oldBurn', airC: 25, segments: route(
        ['graded', 16], ['whoops', 4], ['rough', 6], ['graded', 14], ['jumps', 6], ['washboard', 8],
        ['graded', 12], ['whoops', 3], ['rough', 6], ['graded', 15], ['jumps', 3], ['graded', 7]) },
    ],
  },
  summerRaid: {
    id: 'summerRaid',
    name: 'raid.summerRaid.name',
    text: 'raid.summerRaid.text',
    season: 'summer',
    seed: 7201,
    stages: [
      { tag: 'stage.loggingRoads', airC: 17, segments: route(
        ['graded', 24], ['washboard', 10], ['graded', 20], ['rough', 8], ['graded', 22], ['jumps', 5],
        ['graded', 18], ['washboard', 8], ['rough', 5], ['graded', 20]) },
      { tag: 'stage.eskers', airC: 21, segments: route(
        ['graded', 18], ['washboard', 14], ['jumps', 6], ['graded', 16], ['rough', 10], ['washboard', 12],
        ['graded', 22], ['jumps', 5], ['rough', 8], ['graded', 24], ['washboard', 10], ['graded', 15]) },
      { tag: 'stage.rockCountry', airC: 24, segments: route(
        ['graded', 20], ['rocks', 5], ['graded', 15], ['rough', 10], ['rocks', 4], ['washboard', 10],
        ['graded', 22], ['whoops', 4], ['graded', 15], ['rocks', 5], ['rough', 8], ['graded', 22]) },
      { tag: 'stage.haulRoads', airC: 28, segments: route(
        ['graded', 26], ['rough', 12], ['washboard', 10], ['graded', 20], ['rough', 10], ['rocks', 4],
        ['graded', 24], ['washboard', 12], ['rough', 8], ['graded', 24], ['jumps', 4], ['graded', 16]) },
      { tag: 'stage.oldBurn', airC: 23, segments: route(
        ['graded', 20], ['whoops', 5], ['rough', 8], ['graded', 18], ['jumps', 6], ['washboard', 10],
        ['graded', 16], ['whoops', 4], ['rocks', 4], ['graded', 20], ['rough', 8], ['jumps', 4], ['graded', 17]) },
    ],
  },
  // The career's calendar adds these (plan PR 9). Winter raids come with plan PR 10.
  midsummerSprint: {
    id: 'midsummerSprint',
    name: 'raid.midsummerSprint.name',
    text: 'raid.midsummerSprint.text',
    season: 'summer',
    seed: 7301,
    stages: [
      { tag: 'stage.eskers', airC: 24, segments: route(
        ['graded', 14], ['washboard', 10], ['jumps', 5], ['graded', 16], ['rough', 6], ['washboard', 8],
        ['graded', 18], ['jumps', 4], ['graded', 12]) },
      { tag: 'stage.longGravel', airC: 26, segments: route(
        ['graded', 24], ['washboard', 10], ['graded', 20], ['rough', 5], ['graded', 22], ['washboard', 8], ['graded', 14]) },
      { tag: 'stage.minesRoad', airC: 23, segments: route(
        ['graded', 16], ['rocks', 4], ['graded', 14], ['rough', 8], ['rocks', 3], ['graded', 18], ['whoops', 3], ['graded', 16]) },
    ],
  },
  nationalRaid: {
    id: 'nationalRaid',
    name: 'raid.nationalRaid.name',
    text: 'raid.nationalRaid.text',
    season: 'summer',
    seed: 7401,
    stages: [LONG_STAGES.fast, LONG_STAGES.logging, LONG_STAGES.eskers, LONG_STAGES.rock, LONG_STAGES.mines, LONG_STAGES.haul, LONG_STAGES.burn],
  },
  autumnRaid: {
    id: 'autumnRaid',
    name: 'raid.autumnRaid.name',
    text: 'raid.autumnRaid.text',
    season: 'summer',
    seed: 7501,
    // As the nights draw in: each day gets dark earlier, and the last runs all night (night stages, after 1.20).
    stages: [
      { ...LONG_STAGES.logging, airC: 14, dark: 0.75 },
      { ...LONG_STAGES.burn, airC: 15, dark: 0.6 },
      { ...LONG_STAGES.mines, airC: 13, dark: 0.45 },
      { ...LONG_STAGES.eskers, airC: 14, dark: 0.3 },
      { ...LONG_STAGES.rock, airC: 12, dark: 0 },
    ],
  },
  longOne: {
    id: 'longOne',
    name: 'raid.longOne.name',
    text: 'raid.longOne.text',
    season: 'summer',
    seed: 7601,
    stages: [
      LONG_STAGES.fast, LONG_STAGES.logging, LONG_STAGES.eskers, LONG_STAGES.burn, LONG_STAGES.rock,
      LONG_STAGES.haul, LONG_STAGES.mines, LONG_STAGES.fast, LONG_STAGES.eskers, LONG_STAGES.rock,
      LONG_STAGES.burn, LONG_STAGES.mines, LONG_STAGES.haul, LONG_STAGES.logging,
    ],
    // Fourteen stages and a rest day at halfway: two weeks across the country.
    restAfter: 7,
  },

  // ── Winter (plan PR 10) ──
  // The thinnest ice is early in the winter (the Sprint); the Raid runs later, on thicker ice but longer lakes.
  winterSprint: {
    id: 'winterSprint',
    name: 'raid.winterSprint.name',
    text: 'raid.winterSprint.text',
    season: 'winter',
    seed: 8101,
    stages: [
      { tag: 'stage.iceRoads', airC: -24, ice: { cm: 44, waveKmh: 60 }, segments: route(
        ['snow', 10], ['ice', 18], ['snow', 8], ['iceHeaves', 4], ['ice', 22], ['snow', 10], ['ice', 14], ['snow', 6]) },
      { tag: 'stage.frostHeaves', airC: -18, segments: route(
        ['snow', 14], ['iceHeaves', 6], ['snow', 10], ['rocks', 3], ['iceHeaves', 5], ['snow', 14],
        ['iceHeaves', 6], ['rocks', 2], ['snow', 14], ['iceHeaves', 4], ['snow', 10]) },
      // The short winter day runs out halfway across the big lake.
      { tag: 'stage.bigLake', airC: -28, ice: { cm: 46, waveKmh: 45 }, dark: 0.5, segments: route(
        ['snow', 8], ['ice', 30], ['iceHeaves', 4], ['ice', 26], ['snow', 10], ['ice', 12], ['snow', 6]) },
    ],
  },
  winterRaid: {
    id: 'winterRaid',
    name: 'raid.winterRaid.name',
    text: 'raid.winterRaid.text',
    season: 'winter',
    seed: 8201,
    stages: [
      { tag: 'stage.iceRoads', airC: -20, ice: { cm: 55, waveKmh: 55 }, segments: route(
        ['snow', 15], ['ice', 30], ['snow', 12], ['iceHeaves', 6], ['ice', 35], ['snow', 15], ['ice', 25], ['snow', 12]) },
      { tag: 'stage.frostHeaves', airC: -15, segments: route(
        ['snow', 20], ['iceHeaves', 8], ['snow', 18], ['rocks', 4], ['iceHeaves', 8], ['snow', 25], ['iceHeaves', 8],
        ['rough', 6], ['snow', 20], ['iceHeaves', 6], ['snow', 17]) },
      { tag: 'stage.bigLake', airC: -30, ice: { cm: 45, waveKmh: 55 }, segments: route(
        ['snow', 10], ['ice', 45], ['iceHeaves', 5], ['ice', 40], ['snow', 12], ['ice', 30], ['snow', 13]) },
      { tag: 'stage.tundra', airC: -22, ice: { cm: 65, waveKmh: 50 }, dark: 0.4, segments: route(
        ['snow', 25], ['rough', 8], ['snow', 20], ['iceHeaves', 10], ['rocks', 4], ['snow', 25], ['iceHeaves', 8],
        ['snow', 22], ['ice', 20], ['snow', 18]) },
    ],
  },
}

// ── Rivals ──

/** Ways a rival can lose time on a stage, for the results' notes. */
export type RivalTrouble = Exclude<FailureKind, 'frame'> | 'stuck' | 'lost'

export interface Rival {
  id: string
  /** The team (working names, `docs/NAMES.md`), or "Privateer". */
  team: StringKey
  /** Their race number. */
  number: number
  cls: ClassId
  /** Their stage time on a clean run, as a share of par (below 1 is quicker than a Steady average driver). */
  pace: number
  /** How much a clean run can wander from that, either way (share). */
  spread: number
  /** Chance of trouble on a stage of 100 km with an average share of harsh ground. */
  risk: number
  /** Hours lost to trouble: the least and the most. */
  delay: readonly [number, number]
  /** What usually goes wrong for them. */
  trouble: readonly RivalTrouble[]
  habit: StringKey
}

/** A stage with this share of harsh ground is "average" for the rivals' risk. */
export const RIVAL_HARSH_AVERAGE = 0.3

/** Ice and snow count as this much harsh ground for the rivals' risk: snowbanks and ice (plan PR 10). */
export const RIVAL_WINTER_WEIGHT = 0.3

export const RIVALS: readonly Rival[] = [
  // Light 4x4
  { id: 'brannigan7', team: 'team.brannigan', number: 7, cls: 'light4x4', pace: 0.9, spread: 0.03, risk: 0.4,
    delay: [0.4, 1.6], trouble: ['axle', 'tire', 'bottoming'], habit: 'habit.brannigan' },
  { id: 'highbank11', team: 'team.highbank', number: 11, cls: 'light4x4', pace: 0.93, spread: 0.02, risk: 0.18,
    delay: [0.3, 1.2], trouble: ['fade', 'mount', 'lost'], habit: 'habit.highbank' },
  { id: 'privateer31', team: 'team.privateer', number: 31, cls: 'light4x4', pace: 1.03, spread: 0.04, risk: 0.25,
    delay: [0.3, 1.5], trouble: ['tire', 'stuck', 'fade'], habit: 'habit.privateer' },
  { id: 'privateer47', team: 'team.privateer', number: 47, cls: 'light4x4', pace: 1.08, spread: 0.05, risk: 0.3,
    delay: [0.4, 2], trouble: ['tire', 'axle', 'lost'], habit: 'habit.privateer' },
  // Heavy truck
  { id: 'hardpan501', team: 'team.hardpan', number: 501, cls: 'heavy', pace: 0.95, spread: 0.015, risk: 0.08,
    delay: [0.3, 1], trouble: ['tire', 'stuck'], habit: 'habit.hardpan' },
  { id: 'highbank505', team: 'team.highbank', number: 505, cls: 'heavy', pace: 0.91, spread: 0.02, risk: 0.22,
    delay: [0.5, 1.8], trouble: ['axle', 'fade', 'mount'], habit: 'habit.highbank' },
  { id: 'privateer512', team: 'team.privateer', number: 512, cls: 'heavy', pace: 1.05, spread: 0.04, risk: 0.25,
    delay: [0.5, 2], trouble: ['tire', 'axle', 'stuck'], habit: 'habit.privateer' },
  // Side-by-side
  { id: 'jackrabbit301', team: 'team.jackrabbit', number: 301, cls: 'sxs', pace: 0.89, spread: 0.03, risk: 0.42,
    delay: [0.3, 1.3], trouble: ['fade', 'fade', 'bottoming'], habit: 'habit.jackrabbit' },
  { id: 'highbank305', team: 'team.highbank', number: 305, cls: 'sxs', pace: 0.93, spread: 0.02, risk: 0.18,
    delay: [0.3, 1.2], trouble: ['fade', 'mount', 'lost'], habit: 'habit.highbank' },
  { id: 'privateer318', team: 'team.privateer', number: 318, cls: 'sxs', pace: 1.03, spread: 0.04, risk: 0.25,
    delay: [0.3, 1.4], trouble: ['tire', 'stuck', 'axle'], habit: 'habit.privateer' },
  { id: 'privateer322', team: 'team.privateer', number: 322, cls: 'sxs', pace: 1.07, spread: 0.05, risk: 0.3,
    delay: [0.3, 1.8], trouble: ['tire', 'fade', 'lost'], habit: 'habit.privateer' },
]

