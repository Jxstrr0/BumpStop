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
 * 4. **The bivouac:** a set number of mechanic hours and the spares left.
 *    The player picks jobs; what's left worn carries into tomorrow.
 * 5. **Results:** stage time, place in class and overall, against the
 *    rivals (`rivals.ts`).
 *
 * Everything in `RaidState` is plain numbers and strings, so saves (plan PR
 * 8) can keep a raid in progress. A `StageRun` (a stage being driven) is
 * not saved: a stage is short, so a reload starts it again.
 */
import type { ClassId } from '../data/classes'
import { KITS } from '../data/kit'
import { SPARE_IDS, type SpareId } from '../data/parts'
import {
  CLASS_WORK, DRIVERS, JOB_KINDS, JOBS, PACE_SPEED, PACES, RAID, RAIDS, ROADSIDE, STEADY_KMH,
  type DriverId, type JobKind, type JobPart, type PaceId, type Raid, type RaidGround, type RaidId, type RaidStage,
} from '../data/raids'
import type { TruckBuild } from '../data/kit'
import { buildTruck, partIn, type BuiltTruck } from './build'
import { detExp, detLog, detPow } from './det'
import { clipRecorder, type Clip } from './highlight'
import { rivalStages, type RivalStage } from './rivals'
import { hashString } from './rng'
import { runStage } from './stage'
import { fromCelsius } from './units'
import { newFatigue, newWearState, worstDamage, type BreakEvent, type Fatigue, type WearState } from './wear'

/** What the player entered: the truck (parts locked for the raid) and the driver. */
export interface RaidEntry {
  raid: RaidId
  build: TruckBuild
  driver: DriverId
}

/** A stop on a stage: what broke, where, and what the crew did. */
export interface Stop {
  leg: number
  /** Metres from the start of the stage. */
  at: number
  kind: BreakEvent['kind']
  /** The corner (0 to 3), or -1 for the frame. */
  corner: number
  zone: BreakEvent['zone']
  /** Seconds lost. */
  lost: number
  /** Fitted a spare, bodged it, let the dampers cool, or limped on (too many stops). */
  fix: 'spare' | 'bodge' | 'cool'
  /** True if the long-stage maths worked out the break rather than the sim driving that moment. */
  estimated: boolean
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
  truck: BuiltTruck
  airTemp: number
  legs: Leg[]
  /** The leg being driven (0 to 2), the piece of ground in it, and metres done on that piece. */
  leg: number
  seg: number
  segDone: number
  /** Restarts on this piece after a stop, for its road seed. */
  restarts: number
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
}

// ── Speeds and times ──

const KMH = 1 / 3.6

/** The stock truck's power-to-weight for a class (W/kg). */
function stockPowerToWeight(cls: ClassId): number {
  const stock = buildTruck(KITS[cls].stock)
  return stock.power / stock.mass
}

/** Speed on fast ground follows power-to-weight. */
export function powerFactor(truck: BuiltTruck): number {
  const ratio = truck.power / truck.mass / stockPowerToWeight(truck.build.cls)
  const k = detPow(ratio, RAID.powerExponent)
  return Math.min(RAID.powerLimits[1], Math.max(RAID.powerLimits[0], k))
}

/** The speed the driver takes a piece of ground at, on this pace call (m/s). */
export function groundSpeed(truck: BuiltTruck, driver: DriverId, ground: RaidGround, pace: PaceId, power = powerFactor(truck)): number {
  const d = DRIVERS[driver]
  let v = STEADY_KMH[truck.build.cls][ground] * KMH * PACE_SPEED[pace] * d.speed
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

/** Share of a stage on harsh ground (0 to 1). */
export function harshShare(stage: RaidStage): number {
  const total = stage.segments.reduce((sum, s) => sum + s.km, 0)
  const harsh = stage.segments.filter((s) => RAID.harshGround.includes(s.ground)).reduce((sum, s) => sum + s.km, 0)
  return total > 0 ? harsh / total : 0
}

export function stageKm(stage: RaidStage): number {
  return stage.segments.reduce((sum, s) => sum + s.km, 0)
}

// ── Entering ──

export function raidOf(state: RaidState): Raid {
  return RAIDS[state.entry.raid]
}

export function enterRaid(raid: RaidId, build: TruckBuild, driver: DriverId): RaidState {
  const b = structuredClone(build)
  const carries = partIn(b, 'spares').carries
  return {
    entry: { raid, build: b, driver },
    stage: 0,
    phase: 'morning',
    wear: newWearState(),
    spares: { tire: carries.tire, shock: carries.shock, cv: carries.cv },
    results: [],
  }
}

/**
 * The truck for this morning: the raid's parts, with the settings from
 * `settings` if it's the same class (the player may retune between stages).
 */
export function raidTruck(state: RaidState, settings?: TruckBuild): BuiltTruck {
  const b = state.entry.build
  const s = settings && settings.cls === b.cls ? settings : b
  return buildTruck({ cls: b.cls, parts: b.parts, front: s.front, rear: s.rear })
}

// ── Driving a stage ──

export function startStage(state: RaidState, truck: BuiltTruck, pace: PaceId): StageRun {
  if (state.phase !== 'morning') throw new Error(`Can't start a stage at ${state.phase}`)
  const raid = raidOf(state)
  const spec = raid.stages[state.stage]
  if (!spec) throw new RangeError(`No stage ${state.stage}`)
  const cls = truck.build.cls
  const legs = stageLegs(cls, spec)
  const airTemp = fromCelsius(spec.airC)
  return {
    stage: state.stage,
    spec,
    truck,
    airTemp,
    legs,
    leg: 0,
    seg: 0,
    segDone: 0,
    restarts: 0,
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
    rivals: rivalStages(cls, legs.map((l) => l.par), stageKm(spec), harshShare(spec), raid.seed * 100 + state.stage),
    status: 'driving',
    late: false,
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
    const speed = groundSpeed(run.truck, driver, seg.ground, currentPace(run))
    const seed = hashString(`${raidOf(state).seed}:${run.stage}:${run.leg}:${run.seg}:${run.restarts}`)
    const res = runStage(
      run.truck.ride,
      { airTemp: run.airTemp, oilTemp: run.oil, segments: [{ ground: seg.ground, length: remaining, speed }] },
      seed,
      'sampled',
      run.truck.wear,
      { wear: run.wear, clips: clipRecorder(run.clips, run.leg, run.at) },
    )
    const driven = Math.min(remaining, res.distance)
    for (let k = 1; k < res.trace.distance.length; k++) {
      run.trace.distance.push(run.at + (res.trace.distance[k] as number))
      run.trace.oil.push(res.trace.oil[k] as number)
      run.trace.wear.push(res.trace.wear[k] as number)
    }
    run.oil = res.endTemp.slice()
    run.wear = res.wear!.state
    run.time += (driven / speed) * lineFactor(driver, seg.ground)
    run.at += driven
    run.segDone += driven
    const broken = res.wear!.broken
    if (broken && run.segDone < seg.length - 1) {
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
  }
  if (run.time > closingTime(run)) {
    run.late = true
    run.status = 'finished'
    return
  }
  if (run.seg >= leg.segments.length) endLeg(run)
}

function limp(run: StageRun, ground: RaidGround, distance: number): void {
  const speed = STEADY_KMH[run.truck.build.cls][ground] * KMH * RAID.limpShare
  const time = distance / speed
  run.time += time
  run.at += distance
  run.segDone += distance
  run.limped = true
  coolFor(run, time)
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
  for (let i = 0; i < 4; i++) {
    const d = (i < 2 ? ride.front : ride.rear).damper
    const decay = detExp((-d.coolStill * seconds) / d.heatCapacity)
    run.oil[i] = run.airTemp + ((run.oil[i] as number) - run.airTemp) * decay
  }
}

/** How long a faded damper takes to cool to its warm line, standing still (s). */
export function coolingTime(run: StageRun): number {
  const ride = run.truck.ride
  let longest = 0
  for (let i = 0; i < 4; i++) {
    const d = (i < 2 ? ride.front : ride.rear).damper
    const hot = (run.oil[i] as number) - run.airTemp
    const warm = d.warmFrom - run.airTemp
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
  }
  state.results.push(record)
  state.wear = structuredClone(run.wear)
  state.wear.broken = null
  state.spares = { ...run.spares }
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
  part: JobPart
  /** Corner (0 to 3), or frame zone (0 front, 1 centre, 2 rear). */
  index: number
  /** Mechanic hours. */
  hours: number
  spare: SpareId | null
  /** Damage now, and after the job. */
  damage: number
  after: number
}

const JOB_PARTS: readonly JobPart[] = ['tire', 'bottoming', 'axle', 'mount', 'frame']

/** Every job the crew could do tonight, worst parts first. A part can have two (a new one or a patch). */
export function bivouacJobs(state: RaidState): Job[] {
  const cls = state.entry.build.cls
  const out: Job[] = []
  for (const part of JOB_PARTS) {
    const list = part === 'frame' ? state.wear.frame : state.wear[part]
    list.forEach((f, index) => {
      if (f.damage < RAID.jobFrom) return
      for (const kind of JOB_KINDS) {
        const spec = JOBS[kind]
        if (spec.part !== part) continue
        out.push({ kind, part, index, hours: spec.hours * CLASS_WORK[cls], spare: spec.spare, damage: f.damage, after: f.damage * spec.keep })
      }
    })
  }
  return out.sort((a, b) => b.damage - a.damage)
}

export type JobProblem = { kind: 'hours'; over: number } | { kind: 'spare'; spare: SpareId } | { kind: 'twice'; part: JobPart; index: number }

/** What's wrong with a night's plan, or null if the crew can do it all. */
export function checkJobs(state: RaidState, jobs: readonly Job[]): JobProblem | null {
  const hours = jobs.reduce((sum, j) => sum + j.hours, 0)
  if (hours > RAID.bivouacHours + 1e-9) return { kind: 'hours', over: hours - RAID.bivouacHours }
  const used: Record<SpareId, number> = { tire: 0, shock: 0, cv: 0 }
  const seen = new Set<string>()
  for (const j of jobs) {
    const key = `${j.part}:${j.index}`
    if (seen.has(key)) return { kind: 'twice', part: j.part, index: j.index }
    seen.add(key)
    if (j.spare) used[j.spare]++
  }
  for (const s of SPARE_IDS) if (used[s] > state.spares[s]) return { kind: 'spare', spare: s }
  return null
}

/** Do the night's jobs and get ready for the morning. Throws if the plan doesn't fit (the screen checks first). */
export function doJobs(state: RaidState, jobs: readonly Job[]): void {
  if (state.phase !== 'bivouac') throw new Error(`No bivouac at ${state.phase}`)
  const problem = checkJobs(state, jobs)
  if (problem) throw new Error(`Can't do those jobs: ${problem.kind}`)
  for (const j of jobs) {
    const spec = JOBS[j.kind]
    if (spec.keep === 0) setFatigue(state.wear, j.part, j.index, newFatigue())
    else fatigueOf(state.wear, j.part, j.index).damage *= spec.keep
    if (j.spare) state.spares[j.spare]--
  }
  state.phase = 'morning'
}
