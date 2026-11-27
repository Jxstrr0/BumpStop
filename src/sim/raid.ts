/**
 * The raid (plan PR 7): a few days of long stages, where damage carries over
 * from one day to the next.
 *
 * A raid day:
 *
 * 1. **Morning:** the roadbook for the stage, and the truck's settings can
 *    change (the parts are locked once the raid starts).
 * 2. **The stage**, in three legs split by two checkpoints. The player picks
 *    the pace call for each leg: Conserve, Steady or Push. Each leg is
 *    driven by the ride sim (`runStage`), piece of ground by piece, starting
 *    from the oil and the wear the truck already has.
 * 3. **Breakdowns stop the truck.** The crew fixes it at the roadside: with a
 *    spare it's as good as new; without one it's a bodge that will go again
 *    sooner. A faded damper is left to cool, for as long as the physics says.
 *    After a stop the driver eases off one pace call for the rest of the leg.
 * 4. **The bivouac:** a set number of mechanic hours, the spares left and
 *    the money for parts. The player picks jobs; what's left worn carries
 *    into tomorrow. Besides the parts that break, the truck tires slowly
 *    (bivouac breakdowns, `condition.ts`): shock oil cooks, springs sag and
 *    bushings crack, and each makes the next day's truck a little worse.
 * 5. **Results:** stage time, place in class and overall, against the
 *    rivals (`rivals.ts`).
 *
 * Winter raids (plan PR 10) run on ice, snow and frost heaves in the cold.
 * Studded tires go faster on that ground. On an ice-road stretch the truck
 * drives to the thinnest place, and if the ice can't hold it at that speed
 * it cracks: the crew backs off and takes the shore track (`ICE_ROAD`).
 *
 * Underside hits (Kelbo, 27 November 2026): on rough ground rocks reach
 * the bottom of the truck, more often at Push, riding low or bottoming out.
 * The guards take most of them; one that gets through dents the oil pan,
 * the diff or the fuel tank, which the crew patches at the roadside, and a
 * dented part leaks until the bivouac fixes it (`underside.ts`).
 *
 * Fuel (weight and balance, 27 November 2026): the crew fills the tank to
 * the build's fuel level each morning. Less fuel is a lighter truck, but a
 * stage longer than the tank's range has a stop to fill up (`FUEL_STOP`),
 * where the dampers get a couple of minutes to cool.
 *
 * Weather (Kelbo, 26 November 2026): some stages have a thaw, a whiteout or
 * a dust storm in the forecast, which comes in partway through or holds off
 * (`weather.ts`). From where it turns, the ground it changes is driven
 * slower and rougher, in a different air, and in a whiteout the tightest
 * corner comes up unseen. The rivals slow down by the same amount.
 *
 * Everything in `RaidState` is plain numbers and strings, so saves (plan PR
 * 8) can keep a raid in progress. A `StageRun` (a stage being driven) is
 * not saved: a stage is short, so a reload starts it again.
 */
import type { ClassId } from '../data/classes'
import { GROUND, WINTER_GROUND } from '../data/ground'
import { KITS } from '../data/kit'
import { SPARE_IDS, type SpareId } from '../data/parts'
import {
  CLASS_WORK, DRIVERS, RIVAL_WINTER_WEIGHT, JOB_KINDS, JOBS, PACE_SPEED, PACES, RAID, RAIDS, ROADSIDE, STEADY_KMH,
  type DriverId, type JobKind, type JobPart, type PaceId, type Raid, type RaidGround, type RaidId, type RaidStage, type Rival,
} from '../data/raids'
import type { TruckBuild } from '../data/kit'
import { WEATHER } from '../data/weather'
import { CORNERS, ICE_ROAD, type IceSheet } from '../data/winter'
import { CLASS_MONEY } from '../data/career'
import { CONDITION, FREE_PLAY_PARTS_MONEY, type CondPart } from '../data/condition'
import { FUEL_STOP } from '../data/load'
import { buildTruck, partIn, type BuiltTruck } from './build'
import { fuelRangeKm } from './load'
import { axleOf, newCondition, tireCondition, wornTruck, type Condition } from './condition'
import { detExp, detLog, detPow } from './det'
import { clipRecorder, type Clip } from './highlight'
import { iceReading, type IceBand } from './ice'
import { rivalsIn, rivalStages, type RivalStage } from './rivals'
import { hashString, Rng } from './rng'
import { runStage } from './stage'
import { fromCelsius } from './units'
import { newFatigue, newWearState, worstDamage, type BreakEvent, type Fatigue, type WearState } from './wear'
import { leakPerKm, newUnderside, patchHours, rollStrikes, type Underside } from './underside'
import { UNDER_PARTS, UNDERSIDE, type UnderPart } from '../data/underside'
import { groundMod, stageWeather, weatherOn, weatherShare, weatherSpeed, type StageWeather } from './weather'

/** What the player entered: the truck (parts locked for the raid) and the driver. */
export interface RaidEntry {
  raid: RaidId
  build: TruckBuild
  driver: DriverId
  /**
   * Career raids only (plan PR 9): the roads' seed for this year's running,
   * the rivals entered (with the trucks they have this year), and the
   * mechanic hours at each bivouac (the shop's crew). Free-play raids leave
   * them out and use the raid's own seed, the usual rivals and `RAID.bivouacHours`.
   */
  seed?: number
  field?: Rival[]
  hours?: number
  /**
   * Money for parts at the bivouacs (cr.): a career raid has the garage's
   * money after the fees; free play leaves it out and gets `partsBudget`'s
   * allowance.
   */
  budget?: number
  /**
   * Career raids with the garage's late tools (Kelbo asked, 26 November
   * 2026): spares the parts truck brings on top of what the truck carries,
   * and how fast the shock oil tires and the springs sag (1, or left out, is
   * as usual). See `UPGRADES` in `src/data/career.ts`.
   */
  extraSpares?: Record<SpareId, number>
  oilWear?: number
  springSag?: number
}

/** A stop on a stage: what broke, where, and what the crew did. */
export interface Stop {
  leg: number
  /** Metres from the start of the stage. */
  at: number
  /**
   * What broke, or 'ice' when the ice cracked under the truck, or 'slide'
   * when it slid into a snowbank, or the part a rock dented under the truck.
   */
  kind: BreakEvent['kind'] | 'ice' | 'slide' | UnderPart
  /** The corner (0 to 3), or -1 for the frame. */
  corner: number
  zone: BreakEvent['zone']
  /** Seconds lost. */
  lost: number
  /** Fitted a spare, bodged it, let the dampers cool, backed off cracking ice onto the shore track, dug it out, or patched the underside. */
  fix: 'spare' | 'bodge' | 'cool' | 'shore' | 'dig' | 'patch'
  /** True if the long-stage maths worked out the break rather than the sim driving that moment. */
  estimated: boolean
}

/** The ice booming and creaking under the truck at the thinnest place of a stretch: close, but it held. */
export interface IceNote {
  leg: number
  /** Which piece of ground in the leg. */
  seg: number
  /** Metres from the start of the stage. */
  at: number
  /** The load against what the ice holds there (0.85 to 1). */
  use: number
}

/** One stage, done. */
export interface StageRecord {
  /** Stage time (s), stops and any penalty included. */
  time: number
  paces: PaceId[]
  stops: Stop[]
  /** Towed in after the stage closed. */
  late: boolean
  /** True if a leg ended limping after too many stops. */
  limped: boolean
  rivals: RivalStage[]
  /** Where the ice creaked (winter; missing in saves from before PR 10). */
  iceNotes?: IceNote[]
  /** The day's weather: the forecast and whether it came (null for a clear day; missing in older saves). */
  weather?: StageWeather | null
  /** Rocks the guards took for you (missing in saves from before underside hits). */
  guardHits?: number
  /** Seconds lost topping up leaks from a dented oil pan, diff or fuel tank (in `time` already; missing likewise). */
  leak?: number
  /** Stops to fill up with fuel, and the seconds they took (in `time` already; missing in saves from before fuel). */
  fuelStops?: number
  fuel?: number
}

export type RaidPhase = 'morning' | 'bivouac' | 'done'

export interface RaidState {
  entry: RaidEntry
  /** The stage up next (0 for the first); equals the stage count once it's over. */
  stage: number
  phase: RaidPhase
  /** Wear carried from stage to stage. */
  wear: WearState
  /** Spares left on the truck. */
  spares: Record<SpareId, number>
  results: StageRecord[]
  /** Shock oil, springs and bushings, per axle (bivouac breakdowns; a raid saved before them starts fresh). */
  cond: Condition
  /** Money spent on parts at the bivouacs so far (cr.). */
  spent: number
  /** Dents in the oil pan, diff and fuel tank (underside hits; a raid saved before them starts with none). */
  under: Underside
}

/** A leg of a stage: its ground, in metres. */
export interface Leg {
  segments: { ground: RaidGround; length: number }[]
  /** Metres from the start of the stage. */
  from: number
  to: number
  /** Steady, average driver, no stops (s). */
  par: number
}

export type StageStatus = 'driving' | 'checkpoint' | 'finished'

/** A stage being driven. Not saved. */
export interface StageRun {
  stage: number
  spec: RaidStage
  /** The truck as it stands, with its tired oil, sag and bushings worked in (`wornTruck`). */
  truck: BuiltTruck
  /** The same truck fresh, to work the condition in again after a new shock at the roadside. */
  base: BuiltTruck
  /** The condition, tiring as the stage goes on. */
  cond: Condition
  airTemp: number
  legs: Leg[]
  /** The leg being driven (0 to 2), the piece of ground in it, and metres done on that piece. */
  leg: number
  seg: number
  segDone: number
  /** Restarts on this piece after a stop, for its road seed. */
  restarts: number
  /** On the shore track after the ice cracked on this piece. */
  shore: boolean
  iceNotes: IceNote[]
  /** Pace call for each leg so far. */
  paces: PaceId[]
  /** Pace calls eased off after stops on this leg, and stops on this leg. */
  eased: number
  legStops: number
  limped: boolean
  /** Metres from the start of the stage, and seconds on the clock. */
  at: number
  time: number
  oil: number[]
  wear: WearState
  spares: Record<SpareId, number>
  stops: Stop[]
  /** The stage so far as a line: hottest oil (K) and most worn part (0 to 1) by distance (m). */
  trace: { distance: number[]; oil: number[]; wear: number[] }
  /** Full-detail moments for the 3D highlight. */
  clips: Clip[]
  rivals: RivalStage[]
  status: StageStatus
  late: boolean
  /** The day's weather (null for a clear day). */
  weather: StageWeather | null
  /** Dents under the truck, growing as rocks get through. */
  under: Underside
  /** Rocks the guards took, and seconds lost to leaks so far. */
  guardHits: number
  leak: number
  /** Fuel stops so far and the seconds they took, and where the next one comes (m from the start; Infinity for none). */
  fuelStops: number
  fuel: number
  nextFuel: number
}

// ── Speeds and times ──

const KMH = 1 / 3.6

/** The stock truck's power-to-weight for a class (W/kg). */
function stockPowerToWeight(cls: ClassId): number {
  const stock = buildTruck(KITS[cls].stock)
  return stock.power / stock.runMass
}

/** Speed on fast ground follows power-to-weight. */
export function powerFactor(truck: BuiltTruck): number {
  const ratio = truck.power / truck.runMass / stockPowerToWeight(truck.build.cls)
  const k = detPow(ratio, RAID.powerExponent)
  return Math.min(RAID.powerLimits[1], Math.max(RAID.powerLimits[0], k))
}

/** How much more grip the truck's tires have here than plain tires (1 on summer ground or without studs). */
function gripRatio(truck: BuiltTruck, ground: RaidGround): number {
  const g = GROUND[ground]
  return truck.wear.front.tire.studded ? g.studGrip / g.grip : 1
}

/** Studded tires grip harder on winter ground, so the driver goes a little faster there (1 elsewhere). */
export function studFactor(truck: BuiltTruck, ground: RaidGround): number {
  return detPow(gripRatio(truck, ground), CORNERS.studSpeed)
}

/** The fastest the truck can take the tightest corner on this winter ground (m/s), or Infinity on summer ground. */
export function cornerSpeed(truck: BuiltTruck, ground: RaidGround): number {
  if (!WINTER_GROUND.includes(ground)) return Infinity
  return STEADY_KMH[truck.build.cls][ground] * KMH * CORNERS.margin * detPow(gripRatio(truck, ground), CORNERS.gripPower)
}

/** The speed the driver takes a piece of ground at, on this pace call (m/s). */
export function groundSpeed(truck: BuiltTruck, driver: DriverId, ground: RaidGround, pace: PaceId, power = powerFactor(truck)): number {
  const d = DRIVERS[driver]
  let v = STEADY_KMH[truck.build.cls][ground] * KMH * PACE_SPEED[pace] * d.speed * studFactor(truck, ground)
  if (RAID.harshGround.includes(ground)) v *= 1 + RAID.hardSpeed * d.hardness
  if (RAID.fastGround.includes(ground)) v *= power
  return v
}

/** Better lines save time on the driver's good ground without changing the hits. */
function lineFactor(driver: DriverId, ground: RaidGround): number {
  const d = DRIVERS[driver]
  return d.skill.includes(ground) ? d.skillTime : 1
}

/** The pace call after easing off `steps` times. */
export function easedPace(pace: PaceId, steps: number): PaceId {
  return PACES[Math.max(0, PACES.indexOf(pace) - steps)] as PaceId
}

/** Par time for some ground: Steady, average driver, stock engine, no stops (s). */
export function parTime(cls: ClassId, segments: readonly { ground: RaidGround; length: number }[]): number {
  return segments.reduce((sum, s) => sum + s.length / (STEADY_KMH[cls][s.ground] * KMH), 0)
}

/** A stage cut into its three legs at the checkpoints (to the nearest kilometre). */
export function stageLegs(cls: ClassId, stage: RaidStage): Leg[] {
  const total = stage.segments.reduce((sum, s) => sum + s.km, 0) * 1000
  const cuts = [...RAID.checkpoints.map((share) => Math.round((total * share) / 1000) * 1000), total]
  const legs: Leg[] = []
  let from = 0
  for (const to of cuts) {
    const segments: Leg['segments'] = []
    let pos = 0
    for (const s of stage.segments) {
      const a = Math.max(pos, from)
      const b = Math.min(pos + s.km * 1000, to)
      if (b > a) segments.push({ ground: s.ground, length: b - a })
      pos += s.km * 1000
    }
    legs.push({ segments, from, to, par: parTime(cls, segments) })
    from = to
  }
  return legs
}

/**
 * Share of a stage on ground that makes trouble for the rivals (0 to 1):
 * the harsh ground, and in winter the ice and snow too (snowbanks).
 */
export function harshShare(stage: RaidStage): number {
  const total = stage.segments.reduce((sum, s) => sum + s.km, 0)
  const weight = (g: RaidGround) => (RAID.harshGround.includes(g) ? 1 : WINTER_GROUND.includes(g) ? RIVAL_WINTER_WEIGHT : 0)
  const harsh = stage.segments.reduce((sum, s) => sum + s.km * weight(s.ground), 0)
  return total > 0 ? harsh / total : 0
}

export function stageKm(stage: RaidStage): number {
  return stage.segments.reduce((sum, s) => sum + s.km, 0)
}

/** The stage's lake ice in SI units, or null if it has no ice road. */
export function iceSheet(stage: RaidStage): IceSheet | null {
  return stage.ice ? { thickness: stage.ice.cm / 100, waveSpeed: stage.ice.waveKmh * KMH } : null
}

/** How the ice reads for this truck and driver at a pace call, before any stop eases it off; null without ice. */
export function iceAtPace(stage: RaidStage, truck: BuiltTruck, driver: DriverId, pace: PaceId): { use: number; band: IceBand } | null {
  const sheet = iceSheet(stage)
  if (!sheet) return null
  return iceReading(truck.runMass, groundSpeed(truck, driver, 'ice', pace), sheet)
}

/** The weather for a stage of this raid: the morning's forecast, and whether it comes (null for a clear day). */
export function raidWeather(state: RaidState, stage = state.stage): StageWeather | null {
  const raid = raidOf(state)
  const spec = raid.stages[stage]
  return spec ? stageWeather(raidSeed(state), stage, spec, raid.season, stageKm(spec)) : null
}

/**
 * The legs' par times in the day's weather: the ground it changes, past the
 * turn, takes as much longer as the weather slows the driver. It sets the
 * closing time and the rivals' pace, so the weather slows everyone alike.
 */
export function weatherLegs(cls: ClassId, legs: readonly Leg[], w: StageWeather | null): Leg[] {
  if (!w?.comes) return legs.slice()
  return legs.map((leg) => {
    let at = leg.from
    let par = 0
    for (const s of leg.segments) {
      const clear = s.length / (STEADY_KMH[cls][s.ground] * KMH)
      const slow = 1 / weatherSpeed(w.kind, cls, s.ground)
      par += clear * (1 + weatherShare(w, at, s.length) * (slow - 1))
      at += s.length
    }
    return { ...leg, par }
  })
}

// ── Entering ──

export function raidOf(state: RaidState): Raid {
  return RAIDS[state.entry.raid]
}

/** The roads' seed for this running of the raid. */
export function raidSeed(state: RaidState): number {
  return state.entry.seed ?? raidOf(state).seed
}

/** Is tonight the raid's rest day (plan PR 13)? Only the Long One has one, at halfway. */
export function isRestDay(state: RaidState): boolean {
  return state.phase === 'bivouac' && state.stage === raidOf(state).restAfter
}

/** Mechanic hours at this bivouac: a rest day gives the crew a whole day. */
export function bivouacHours(state: RaidState): number {
  return (state.entry.hours ?? RAID.bivouacHours) * (isRestDay(state) ? RAID.restDayHours : 1)
}

/** Money for parts over the whole raid (cr.). */
export function partsBudget(state: RaidState): number {
  return state.entry.budget ?? FREE_PLAY_PARTS_MONEY * CLASS_MONEY[state.entry.build.cls]
}

/** Money left for parts tonight (cr.). */
export function partsMoney(state: RaidState): number {
  return Math.max(0, partsBudget(state) - state.spent)
}

/** Who else is entered in the player's class. */
export function raidField(state: RaidState): readonly Rival[] {
  return state.entry.field ?? rivalsIn(state.entry.build.cls)
}

/** Career raids pass `extra`: the year's seed, the field, the crew's hours and the money for parts (see `RaidEntry`). */
export function enterRaid(
  raid: RaidId, build: TruckBuild, driver: DriverId,
  extra?: Pick<RaidEntry, 'seed' | 'field' | 'hours' | 'budget' | 'extraSpares' | 'oilWear' | 'springSag'>,
): RaidState {
  const b = structuredClone(build)
  const carries = partIn(b, 'spares').carries
  const entry: RaidEntry = { raid, build: b, driver }
  if (extra?.seed !== undefined) entry.seed = extra.seed
  if (extra?.field) entry.field = structuredClone(extra.field)
  if (extra?.hours !== undefined) entry.hours = extra.hours
  if (extra?.budget !== undefined) entry.budget = Math.max(0, extra.budget)
  if (extra?.extraSpares && SPARE_IDS.some((id) => extra.extraSpares![id] > 0)) entry.extraSpares = { ...extra.extraSpares }
  if (extra?.oilWear !== undefined && extra.oilWear !== 1) entry.oilWear = extra.oilWear
  if (extra?.springSag !== undefined && extra.springSag !== 1) entry.springSag = extra.springSag
  const more = entry.extraSpares
  return {
    entry,
    stage: 0,
    phase: 'morning',
    wear: newWearState(),
    spares: { tire: carries.tire + (more?.tire ?? 0), shock: carries.shock + (more?.shock ?? 0), cv: carries.cv + (more?.cv ?? 0) },
    results: [],
    cond: newCondition(),
    spent: 0,
    under: newUnderside(),
  }
}

/**
 * The truck for this morning: the raid's parts, with the settings from
 * `settings` if it's the same class (the player may retune between stages).
 */
export function raidTruck(state: RaidState, settings?: TruckBuild): BuiltTruck {
  const b = state.entry.build
  const s = settings && settings.cls === b.cls ? settings : b
  // The load (spares, tools, fuel) is a setting too: it can change each morning.
  return buildTruck({ cls: b.cls, parts: b.parts, front: s.front, rear: s.rear, ...(s.load ? { load: s.load } : {}) })
}

// ── Driving a stage ──

/**
 * Start the morning's stage. `truck` is the truck as built (`raidTruck`);
 * the condition the raid has left it in is worked in here.
 */
export function startStage(state: RaidState, fresh: BuiltTruck, pace: PaceId): StageRun {
  if (state.phase !== 'morning') throw new Error(`Can't start a stage at ${state.phase}`)
  const cond = structuredClone(state.cond)
  const truck = wornTruck(fresh, cond)
  const raid = raidOf(state)
  const spec = raid.stages[state.stage]
  if (!spec) throw new RangeError(`No stage ${state.stage}`)
  const cls = truck.build.cls
  const weather = raidWeather(state)
  const legs = weatherLegs(cls, stageLegs(cls, spec), weather)
  const airTemp = fromCelsius(spec.airC)
  // The rivals get into more trouble the more of the stage the weather covers.
  const covered = weather?.comes ? 1 - weather.at / (stageKm(spec) * 1000) : 0
  const harsh = harshShare(spec) * (1 + covered * ((weather ? WEATHER[weather.kind].rivalRisk : 1) - 1))
  return {
    stage: state.stage,
    spec,
    truck,
    base: fresh,
    cond,
    airTemp,
    legs,
    leg: 0,
    seg: 0,
    segDone: 0,
    restarts: 0,
    shore: false,
    iceNotes: [],
    paces: [pace],
    eased: 0,
    legStops: 0,
    limped: false,
    at: 0,
    time: 0,
    oil: [airTemp, airTemp, airTemp, airTemp],
    wear: structuredClone(state.wear),
    spares: { ...state.spares },
    stops: [],
    trace: { distance: [0], oil: [airTemp], wear: [worstDamage(state.wear)] },
    clips: [],
    rivals: rivalStages(cls, legs.map((l) => l.par), stageKm(spec), harsh, raidSeed(state) * 100 + state.stage, raidField(state), raid.season === 'winter'),
    status: 'driving',
    late: false,
    weather,
    under: { ...state.under },
    guardHits: 0,
    leak: 0,
    fuelStops: 0,
    fuel: 0,
    nextFuel: firstFuelStop(truck, stageKm(spec) * 1000),
  }
}

/** Where the first fuel stop comes on a stage of `metres` (m), or Infinity if the tank lasts. */
function firstFuelStop(truck: BuiltTruck, metres: number): number {
  const range = fuelRangeKm(truck.build.cls, truck.load.fuel) * 1000
  return range > 0 && range < metres ? range : Infinity
}

/** Fill up wherever the tank has run out by now: a stop at a fuel point, where the dampers cool a little. */
function refuel(run: StageRun): void {
  const metres = stageKm(run.spec) * 1000
  const range = fuelRangeKm(run.truck.build.cls, run.truck.load.fuel) * 1000
  while (run.at >= run.nextFuel - 1) {
    coolFor(run, FUEL_STOP)
    run.time += FUEL_STOP
    run.fuel += FUEL_STOP
    run.fuelStops++
    const next = run.nextFuel + range
    run.nextFuel = next < metres ? next : Infinity
  }
}

/** The pace call the driver is on now, after any easing off. */
export function currentPace(run: StageRun): PaceId {
  return easedPace(run.paces[run.leg] as PaceId, run.eased)
}

/** The stage's closing time (s). */
export function closingTime(run: StageRun): number {
  return run.legs.reduce((sum, l) => sum + l.par, 0) * RAID.closeAfter
}

/**
 * Drive the next piece of ground (or the rest of it, after a stop). Call it
 * until `run.status` isn't 'driving'. Each call is one `runStage`: well
 * under a second, so the screen can show progress between calls.
 */
export function advanceStage(state: RaidState, run: StageRun): void {
  if (run.status !== 'driving') return
  const leg = run.legs[run.leg] as Leg
  const seg = leg.segments[run.seg]
  if (!seg) {
    endLeg(run)
    return
  }
  const remaining = seg.length - run.segDone
  const driver = state.entry.driver
  if (run.legStops >= RAID.maxStopsPerLeg) {
    // Too many stops: limp to the checkpoint, gently, with no more trouble.
    limp(run, seg.ground, remaining)
  } else {
    // Winter: does the ice hold at its thinnest place, and does the truck make the tightest corner?
    // If not, drive only as far as the first of them.
    let ground = seg.ground
    if (ground === 'ice' && run.shore) ground = ICE_ROAD.shoreGround
    // Weather: once it has turned, this ground may be slower and rougher. If it turns partway along, drive up to there first.
    const w = run.weather
    const wet = weatherOn(w, run.at)
    let length = remaining
    if (w?.comes && !wet && w.at < run.at + remaining) length = w.at - run.at
    const speed = groundSpeed(run.truck, driver, ground, currentPace(run)) * (wet ? weatherSpeed(w!.kind, run.truck.build.cls, ground) : 1)
    const blind = wet ? WEATHER[w!.kind].corner : 1
    let hazard: 'ice' | 'slide' | null = null
    const sheet = iceSheet(run.spec)
    if (ground === 'ice' && sheet) {
      const reading = iceReading(run.truck.runMass, speed, sheet)
      const thin = placeOn(state, run, 'ice', ICE_ROAD.thinFrom, ICE_ROAD.thinTo) * seg.length
      if (reading.band === 'cracks' && run.segDone < thin) {
        if (thin - run.segDone <= length) {
          length = thin - run.segDone
          hazard = 'ice'
        }
      } else if (reading.band === 'creaking' && run.segDone <= thin && thin - run.segDone <= length && !run.iceNotes.some((n) => n.leg === run.leg && n.seg === run.seg)) {
        run.iceNotes.push({ leg: run.leg, seg: run.seg, at: run.at + (thin - run.segDone), use: reading.use })
      }
    }
    if (speed > cornerSpeed(run.truck, ground) * blind) {
      const corner = placeOn(state, run, 'corner', CORNERS.from, CORNERS.to) * seg.length
      if (run.segDone < corner && corner - run.segDone < length) {
        length = corner - run.segDone
        hazard = 'slide'
      }
    }
    // In the weather the road past the turn is a new stretch, so it gets its own seed.
    const key = `${raidSeed(state)}:${run.stage}:${run.leg}:${run.seg}:${run.restarts}${wet ? ':w' : ''}`
    const seed = hashString(key)
    const mod = wet ? groundMod(w!.kind, ground) : undefined
    const res = runStage(
      run.truck.ride,
      { airTemp: airNow(run), oilTemp: run.oil, segments: [{ ground, length, speed, ...(mod ? { mod } : {}) }] },
      seed,
      'sampled',
      run.truck.wear,
      { wear: run.wear, clips: clipRecorder(run.clips, run.leg, run.at) },
    )
    const driven = Math.min(length, res.distance)
    for (let k = 1; k < res.trace.distance.length; k++) {
      run.trace.distance.push(run.at + (res.trace.distance[k] as number))
      run.trace.oil.push(res.trace.oil[k] as number)
      run.trace.wear.push(res.trace.wear[k] as number)
    }
    run.oil = res.endTemp.slice()
    run.wear = res.wear!.state
    // The slow wear: oil cooked by this piece's heat, springs and bushings by its hits and harsh kilometres.
    tireCondition(run.cond, run.truck, {
      damperEnergy: res.damperEnergy, peakTemp: res.peakTemp, bottomOuts: res.bottomOuts,
      distance: driven, harsh: RAID.harshGround.includes(ground), pace: currentPace(run),
      oilWear: state.entry.oilWear, springSag: state.entry.springSag,
    })
    // Rocks under the truck along this stretch, before any break at its end (the stops stay in order).
    undersideHits(state, run, ground, driven, res.bottomOuts, key)
    // The shore track is longer than the ice road it stands in for.
    run.time += (driven / speed) * lineFactor(driver, ground) * (ground !== seg.ground ? ICE_ROAD.shoreLength : 1)
    run.at += driven
    run.segDone += driven
    refuel(run)
    const broken = res.wear!.broken
    if (hazard && !broken && driven >= length - 1) {
      if (hazard === 'ice') iceCracks(run)
      else slideOff(run)
      run.restarts++
    } else if (broken && run.segDone < seg.length - 1) {
      roadsideFix(state, run, broken)
      run.restarts++
    } else if (broken) {
      // It let go on the last metre of the piece: fix it, then carry on to the next.
      roadsideFix(state, run, broken)
    }
    run.wear.broken = null
  }
  if (run.segDone >= seg.length - 1) {
    run.seg++
    run.segDone = 0
    run.restarts = 0
    run.shore = false
  }
  if (run.time > closingTime(run)) {
    run.late = true
    run.status = 'finished'
    return
  }
  if (run.seg >= leg.segments.length) endLeg(run)
}

/**
 * Where something sits on this piece of ground (the ice's thinnest place, or
 * the tightest corner), as a share of the way along: the same every time
 * for the same raid.
 */
function placeOn(state: RaidState, run: StageRun, what: string, from: number, to: number): number {
  return new Rng(hashString(`${raidSeed(state)}:${run.stage}:${run.leg}:${run.seg}:${what}`)).range(from, to)
}

/** A winter stop with nothing broken: lose the time, let the oil cool, ease off. */
function winterStop(run: StageRun, kind: 'ice' | 'slide', fix: 'shore' | 'dig', lost: number): void {
  coolFor(run, lost)
  run.time += lost
  run.stops.push({ leg: run.leg, at: run.at, kind, corner: -1, zone: null, lost, fix, estimated: false })
  run.legStops++
  run.eased = Math.min(RAID.easeSteps, run.eased + 1)
  run.trace.distance.push(run.at)
  run.trace.oil.push(Math.max(...run.oil))
  run.trace.wear.push(worstDamage(run.wear))
}

/** The ice cracked under the truck: back off onto thick ice and take the shore track for the rest of this stretch. */
function iceCracks(run: StageRun): void {
  winterStop(run, 'ice', 'shore', ICE_ROAD.backOff)
  run.shore = true
}

/** Too fast for the grip at the tightest corner: wide into the snowbank, and dug out. */
function slideOff(run: StageRun): void {
  winterStop(run, 'slide', 'dig', CORNERS.digOut)
}

function limp(run: StageRun, ground: RaidGround, distance: number): void {
  const speed = STEADY_KMH[run.truck.build.cls][ground] * KMH * RAID.limpShare
  // Limping picks its way round the rocks, but a dented part still leaks.
  const leak = leakPerKm(run.under) * (distance / 1000)
  run.leak += leak
  const time = distance / speed + leak
  run.time += time
  run.at += distance
  run.segDone += distance
  run.limped = true
  coolFor(run, time)
  refuel(run)
  run.trace.distance.push(run.at)
  run.trace.oil.push(Math.max(...run.oil))
  run.trace.wear.push(worstDamage(run.wear))
}

function endLeg(run: StageRun): void {
  if (run.leg + 1 >= run.legs.length) {
    run.status = 'finished'
    return
  }
  run.status = 'checkpoint'
}

/** At a checkpoint: the pace call for the next leg, then drive on. */
export function leaveCheckpoint(run: StageRun, pace: PaceId): void {
  if (run.status !== 'checkpoint') return
  run.leg++
  run.seg = 0
  run.segDone = 0
  run.restarts = 0
  run.shore = false
  run.eased = 0
  run.legStops = 0
  run.paces.push(pace)
  run.status = 'driving'
}

/** Drive the whole stage at once with one pace call per leg (for tests and the balance bot). */
export function driveStage(state: RaidState, run: StageRun, paces: readonly PaceId[]): void {
  while (run.status !== 'finished') {
    if (run.status === 'checkpoint') leaveCheckpoint(run, paces[run.leg + 1] ?? (run.paces[run.leg] as PaceId))
    else advanceStage(state, run)
  }
}

/** Let the oil cool while the truck stands (or crawls) for `seconds`. */
function coolFor(run: StageRun, seconds: number): void {
  const ride = run.truck.ride
  const air = airNow(run)
  for (let i = 0; i < 4; i++) {
    const d = (i < 2 ? ride.front : ride.rear).damper
    const decay = detExp((-d.coolStill * seconds) / d.heatCapacity)
    run.oil[i] = air + ((run.oil[i] as number) - air) * decay
  }
}

/** The air where the truck is now (K): the morning's, or the weather's once it has turned. */
export function airNow(run: StageRun): number {
  const w = run.weather
  return weatherOn(w, run.at) ? run.airTemp + WEATHER[w!.kind].airK : run.airTemp
}

/** How long a faded damper takes to cool to its warm line, standing still (s). */
export function coolingTime(run: StageRun): number {
  const ride = run.truck.ride
  let longest = 0
  for (let i = 0; i < 4; i++) {
    const d = (i < 2 ? ride.front : ride.rear).damper
    const air = airNow(run)
    const hot = (run.oil[i] as number) - air
    const warm = d.warmFrom - air
    if (hot > warm && warm > 0) longest = Math.max(longest, (d.heatCapacity / d.coolStill) * detLog(hot / warm))
  }
  return Math.max(RAID.coolMin, longest)
}

/** The fatigue count a break or a job works on. */
export function fatigueOf(w: WearState, part: JobPart, index: number): Fatigue {
  const list = part === 'frame' ? w.frame : w[part]
  const f = list[index]
  if (!f) throw new RangeError(`No ${part} ${index}`)
  return f
}

function setFatigue(w: WearState, part: JobPart, index: number, f: Fatigue): void {
  const list = part === 'frame' ? w.frame : w[part]
  list[index] = f
}

/** A fatigue count with this much damage, starting fresh. */
function worn(damage: number): Fatigue {
  const f = newFatigue()
  f.damage = damage
  return f
}

function zoneIndex(zone: BreakEvent['zone']): number {
  return zone === 'front' ? 0 : zone === 'rear' ? 2 : 1
}

function roadsideFix(state: RaidState, run: StageRun, ev: BreakEvent): void {
  const cls = run.truck.build.cls
  const driver = DRIVERS[state.entry.driver]
  let lost: number
  let fix: Stop['fix']
  if (ev.kind === 'fade') {
    lost = coolingTime(run)
    fix = 'cool'
  } else {
    const r = ROADSIDE[ev.kind]
    const index = ev.kind === 'frame' ? zoneIndex(ev.zone) : ev.corner
    const spare = r.spare
    const work = CLASS_WORK[cls] * driver.fixTime * 3600
    if (spare && run.spares[spare] > 0) {
      run.spares[spare]--
      setFatigue(run.wear, ev.kind, index, newFatigue())
      if (spare === 'shock') freshShock(run, index)
      lost = r.withSpare * work
      fix = 'spare'
    } else {
      setFatigue(run.wear, ev.kind, index, worn(r.bodgeWear))
      lost = r.bodge * work
      fix = 'bodge'
    }
  }
  coolFor(run, lost)
  run.time += lost
  run.stops.push({ leg: run.leg, at: run.at, kind: ev.kind, corner: ev.corner, zone: ev.zone, lost, fix, estimated: ev.estimated })
  run.legStops++
  run.eased = Math.min(RAID.easeSteps, run.eased + 1)
  run.trace.distance.push(run.at)
  run.trace.oil.push(Math.max(...run.oil))
  run.trace.wear.push(worstDamage(run.wear))
}

/**
 * Rocks that reached the underside on a stretch just driven (`metres` long,
 * from `run.at`). The guards take some; each one that gets through dents a
 * part, and the crew stops to patch it. The oil isn't cooled for these stops:
 * they happen partway along, and the truck heats up again before the end.
 * Dented parts leak from where they were hit, which costs time to top up.
 */
function undersideHits(state: RaidState, run: StageRun, ground: RaidGround, metres: number, bottomOuts: readonly number[], key: string): void {
  if (!(metres > 0)) return
  const work = CLASS_WORK[run.truck.build.cls] * DRIVERS[state.entry.driver].fixTime * 3600
  const bottoms = bottomOuts.reduce((a, b) => a + b, 0)
  const strikes = rollStrikes(new Rng(hashString(`${key}:under`)), run.truck, ground, currentPace(run), metres, bottoms)
  let leak = leakPerKm(run.under) * (metres / 1000)
  for (const hit of strikes) {
    if (!hit.part) {
      run.guardHits++
      continue
    }
    const before = run.under[hit.part]
    const after = Math.min(1, before + hit.damage)
    run.under[hit.part] = after
    leak += (after - before) * UNDERSIDE.leakPerKm[hit.part] * ((metres - hit.at) / 1000)
    const lost = patchHours(hit.part, before) * work
    run.time += lost
    run.stops.push({ leg: run.leg, at: run.at + hit.at, kind: hit.part, corner: -1, zone: null, lost, fix: 'patch', estimated: false })
    run.legStops++
    run.eased = Math.min(RAID.easeSteps, run.eased + 1)
  }
  run.time += leak
  run.leak += leak
}

/** A new shock on one corner at the roadside: fresh oil in it, and the truck drives on with it. */
function freshShock(run: StageRun, corner: number): void {
  const axle = axleOf(corner)
  run.cond.oil[axle] = (run.cond.oil[axle] as number) * CONDITION.oneShock
  run.truck = wornTruck(run.base, run.cond)
}

/** The stage is over: keep its result and the truck's wear, and head for the bivouac. */
export function finishStage(state: RaidState, run: StageRun): StageRecord {
  if (run.status !== 'finished') throw new Error('The stage is still running')
  const close = closingTime(run)
  const record: StageRecord = {
    time: run.late ? close + RAID.latePenalty : run.time,
    paces: run.paces.slice(),
    stops: run.stops.slice(),
    late: run.late,
    limped: run.limped,
    rivals: run.rivals,
    iceNotes: run.iceNotes.slice(),
    weather: run.weather ? { ...run.weather } : null,
    guardHits: run.guardHits,
    leak: run.leak,
    fuelStops: run.fuelStops,
    fuel: run.fuel,
  }
  state.results.push(record)
  state.wear = structuredClone(run.wear)
  state.wear.broken = null
  state.spares = { ...run.spares }
  state.cond = structuredClone(run.cond)
  state.under = { ...run.under }
  state.stage++
  state.phase = state.stage >= raidOf(state).stages.length ? 'done' : 'bivouac'
  return record
}

// ── Standings ──

export interface Standing {
  /** 'you' or the rival's id. */
  who: string
  time: number
}

/** The class standings after the stages done so far (or after one stage), quickest first. */
export function standings(state: RaidState, onlyStage?: number): Standing[] {
  const records = onlyStage === undefined ? state.results : state.results.slice(onlyStage, onlyStage + 1)
  const sums = new Map<string, number>([['you', 0]])
  for (const rec of records) {
    sums.set('you', (sums.get('you') as number) + rec.time)
    for (const r of rec.rivals) sums.set(r.id, (sums.get(r.id) ?? 0) + r.time)
  }
  return [...sums].map(([who, time]) => ({ who, time })).sort((a, b) => a.time - b.time)
}

// ── The bivouac ──

export interface Job {
  kind: JobKind
  part: JobPart | CondPart | UnderPart
  /** Corner (0 to 3), frame zone (0 front, 1 centre, 2 rear), axle (0 front, 1 rear) for oil, bushings and springs, or 0 under the truck. */
  index: number
  /** Mechanic hours. */
  hours: number
  spare: SpareId | null
  /** Money for parts (cr.). */
  cost: number
  /** Damage (or how tired) now, and after the job. */
  damage: number
  after: number
}

const JOB_PARTS: readonly (JobPart | CondPart | UnderPart)[] = ['tire', 'bottoming', 'axle', 'mount', 'frame', 'oil', 'bushing', 'spring', ...UNDER_PARTS]

const COND_SET = new Set<string>(['oil', 'bushing', 'spring'])
const UNDER_SET = new Set<string>(UNDER_PARTS)

/** True for oil, bushings and springs: jobs on a whole axle. */
export function isCondPart(part: JobPart | CondPart | UnderPart): part is CondPart {
  return COND_SET.has(part)
}

/** True for the oil pan, diff and fuel tank: one of each, under the truck. */
export function isUnderPart(part: JobPart | CondPart | UnderPart): part is UnderPart {
  return UNDER_SET.has(part)
}

/** How worn each of a part's corners (or zones, or axles) is now. */
function levels(state: RaidState, part: JobPart | CondPart | UnderPart): number[] {
  if (isUnderPart(part)) return [state.under[part]]
  if (isCondPart(part)) return state.cond[part]
  return (part === 'frame' ? state.wear.frame : state.wear[part]).map((f) => f.damage)
}

/** Every job the crew could do tonight, worst parts first. A part can have two (a new one or a patch). */
export function bivouacJobs(state: RaidState): Job[] {
  const cls = state.entry.build.cls
  const out: Job[] = []
  for (const part of JOB_PARTS) {
    levels(state, part).forEach((damage, index) => {
      if (damage < RAID.jobFrom) return
      for (const kind of JOB_KINDS) {
        const spec = JOBS[kind]
        if (spec.part !== part) continue
        out.push({
          kind, part, index, hours: spec.hours * CLASS_WORK[cls], spare: spec.spare,
          cost: Math.round(spec.cost * CLASS_MONEY[cls]), damage, after: damage * spec.keep,
        })
      }
    })
  }
  return out.sort((a, b) => b.damage - a.damage)
}

export type JobProblem =
  | { kind: 'hours'; over: number }
  | { kind: 'spare'; spare: SpareId }
  | { kind: 'money'; over: number }
  | { kind: 'twice'; part: JobPart | CondPart | UnderPart; index: number }

/** What's wrong with a night's plan, or null if the crew can do it all. */
export function checkJobs(state: RaidState, jobs: readonly Job[]): JobProblem | null {
  const hours = jobs.reduce((sum, j) => sum + j.hours, 0)
  const have = bivouacHours(state)
  if (hours > have + 1e-9) return { kind: 'hours', over: hours - have }
  const used: Record<SpareId, number> = { tire: 0, shock: 0, cv: 0 }
  const seen = new Set<string>()
  for (const j of jobs) {
    const key = `${j.part}:${j.index}`
    if (seen.has(key)) return { kind: 'twice', part: j.part, index: j.index }
    seen.add(key)
    if (j.spare) used[j.spare]++
  }
  for (const s of SPARE_IDS) if (used[s] > state.spares[s]) return { kind: 'spare', spare: s }
  const cost = jobs.reduce((sum, j) => sum + j.cost, 0)
  const money = partsMoney(state)
  if (cost > money) return { kind: 'money', over: cost - money }
  return null
}

/** Do the night's jobs and get ready for the morning. Throws if the plan doesn't fit (the screen checks first). */
export function doJobs(state: RaidState, jobs: readonly Job[]): void {
  if (state.phase !== 'bivouac') throw new Error(`No bivouac at ${state.phase}`)
  const problem = checkJobs(state, jobs)
  if (problem) throw new Error(`Can't do those jobs: ${problem.kind}`)
  for (const j of jobs) {
    const spec = JOBS[j.kind]
    if (isUnderPart(j.part)) {
      state.under[j.part] *= spec.keep
    } else if (isCondPart(j.part)) {
      const list = state.cond[j.part]
      list[j.index] = (list[j.index] as number) * spec.keep
    } else {
      if (spec.keep === 0) setFatigue(state.wear, j.part, j.index, newFatigue())
      else fatigueOf(state.wear, j.part, j.index).damage *= spec.keep
      // A new or rebuilt shock goes in with fresh oil.
      if (j.part === 'bottoming') state.cond.oil[axleOf(j.index)] = (state.cond.oil[axleOf(j.index)] as number) * CONDITION.oneShock
    }
    if (j.spare) state.spares[j.spare]--
    state.spent += j.cost
  }
  state.phase = 'morning'
}
