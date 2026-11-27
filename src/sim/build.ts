/**
 * The truck builder (plan PR 3): turns a build (one part per slot plus the
 * settings, `src/data/kit.ts`) into the numbers the ride sim and the wear
 * model drive, and checks it against the class's rules: weight window,
 * budget and the year each part comes out.
 *
 * Every part's numbers are multipliers on the class's test mule, so a build
 * of all-"1" parts with the mule's settings drives like the mule.
 *
 * Ride height comes from the spring (see `src/data/kit.ts`): positions are
 * measured up from full droop, where the shock is fully out. The truck rests
 * where the spring holds its weight: `sag = load ÷ rate − preload` up from
 * full droop. Bump travel is the total travel minus that; droop is that, or
 * the limit strap if it's shorter.
 *
 * Weight and balance (27 November 2026): the load (`src/data/load.ts`, the
 * spares kit, the tools and the fuel) moves the centre of mass, so each axle
 * carries a different share and sags to its own height; a load off to one
 * side makes the truck lean (the ride model splits each axle's weight left
 * and right, `cgLeft`). The class's weight window is for the truck as built
 * with a full tank (`mass`); the sim drives what it really weighs (`runMass`).
 */
import type { ClassId } from '../data/classes'
import { CLASSES } from '../data/classes'
import { KITS, TUNE, type AxleSettings, type Range, type TruckBuild } from '../data/kit'
import { LEAN, STOCK_LOAD, type TruckLoad } from '../data/load'
import { PARTS, SLOTS, type Part, type PartIn, type SlotId } from '../data/parts'
import { SIM, TEST_MULES, type AxleSetup, type DamperSetup, type RideSetup } from '../data/ride'
import { MULE_WEAR, type AxleWear, type FatigueSpec, type WearSetup } from '../data/wear'
import { powInt } from './det'
import { loadShift, tidyLoad, type KitWeights } from './load'
import { RECOVERY } from '../data/recovery'

/** How one axle's corners came out, for the build screen. */
export interface CornerGeometry {
  /** Total travel, full droop to hard limit (m). */
  travel: number
  /** Where the truck sits, up from full droop (m). */
  sag: number
  bumpTravel: number
  droopTravel: number
  /** Weight on each tire at rest (N), springs plus wheel. */
  tireLoad: number
  /** Tire stiffness at this pressure (N/m). */
  tireRate: number
  unsprungMass: number
}

/** How the load sits on one corner, for the Load section of the Tune screen. */
export interface CornerLoad {
  /** Weight on the tire at rest (N). */
  tireLoad: number
  /** Bump travel left from ride height (m), after the lean. */
  bumpTravel: number
}

/** What the load does to the balance, for the screen. */
export interface Balance {
  /** Share of the running weight on the front wheels, and on the left wheels (0 to 1). */
  front: number
  left: number
  /** The same for this build with the stock load, to compare. */
  stockFront: number
  /**
   * How the load tips the body at rest, against the same truck with the
   * stock load (rad): pitch + is nose up, roll + is left side up.
   */
  pitch: number
  roll: number
  /** Front left, front right, rear left, rear right. */
  corners: CornerLoad[]
}

export interface BuiltTruck {
  build: TruckBuild
  ride: RideSetup
  wear: WearSetup
  /** Ready to race with a full tank, as the class rules weigh it (kg). */
  mass: number
  /** What it weighs with the fuel it really carries (kg): what the sim drives and the engine pulls. */
  runMass: number
  /** The load on board (the stock load if the build has none). */
  load: TruckLoad
  balance: Balance
  /** Money (cr.). */
  cost: number
  /** Engine peak power (W). */
  power: number
  front: CornerGeometry
  rear: CornerGeometry
}

const BY_ID = new Map<string, Part>(PARTS.map((p) => [p.id, p]))

/** A part by id, or undefined. */
export function findPart(id: string): Part | undefined {
  return BY_ID.get(id)
}

/** Whether a part comes in this class's size. */
export function fitsClass(part: Part, cls: ClassId): boolean {
  return part.mass[cls] !== undefined && part.cost[cls] !== undefined
}

/** Every part for one slot in one class, any year, in the order they're listed. */
export function partsFor(cls: ClassId, slot: SlotId): Part[] {
  return PARTS.filter((p) => p.slot === slot && fitsClass(p, cls))
}

/** The build's part in a slot. Throws if the id is unknown or in the wrong slot or class, which is a bug. */
export function partIn<S extends SlotId>(b: TruckBuild, slot: S): PartIn<S> {
  const p = BY_ID.get(b.parts[slot])
  if (!p || p.slot !== slot || !fitsClass(p, b.cls)) {
    throw new RangeError(`No ${slot} part "${b.parts[slot]}" for ${b.cls}`)
  }
  return p as PartIn<S>
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Snap to the range's steps and keep it inside. */
export function snap(v: number, r: Range): number {
  const k = Math.round((v - r.min) / r.step)
  return clamp(r.min + k * r.step, r.min, r.max)
}

/** The lowest tire pressure allowed with these wheels (Pa). */
export function minPressure(b: TruckBuild): number {
  const kit = KITS[b.cls]
  return partIn(b, 'wheels').beadlock ? kit.beadlockMinPressure : kit.ranges.tirePressure.min
}

/** One axle's settings pulled inside their ranges and onto their steps. */
function tidyAxle(b: TruckBuild, a: AxleSettings): AxleSettings {
  const r = KITS[b.cls].ranges
  const d = partIn(b, 'dampers').clicks
  const bars = partIn(b, 'antiRoll')
  const n = TUNE.antiRollPositions
  const pressure: Range = { ...r.tirePressure, min: minPressure(b) }
  return {
    springRate: snap(a.springRate, r.springRate),
    preload: snap(a.preload, r.preload),
    compLow: clamp(Math.round(a.compLow), -d.compLow, d.compLow),
    compHigh: clamp(Math.round(a.compHigh), -d.compHigh, d.compHigh),
    rebound: clamp(Math.round(a.rebound), -d.rebound, d.rebound),
    bumpStop: snap(a.bumpStop, r.bumpStop),
    droopLimit: snap(a.droopLimit, r.droopLimit),
    tirePressure: snap(a.tirePressure, pressure),
    antiRoll: bars.adjustable ? clamp(Math.round(a.antiRoll), -n, n) : 0,
  }
}

/**
 * A copy of the build with every setting inside its range (and dampers or
 * bars without adjusters set to the middle). The build screen calls this
 * after a part swap, because a new part can change what's allowed.
 */
export function tidyBuild(b: TruckBuild): TruckBuild {
  const out: TruckBuild = { cls: b.cls, parts: { ...b.parts }, front: tidyAxle(b, b.front), rear: tidyAxle(b, b.rear) }
  // A build without a load keeps none (the stock load), so old saves and codes stay as they were.
  if (b.load) out.load = tidyLoad(b.load)
  return out
}

/** A fresh copy of a class's stock build. */
export function stockBuild(cls: ClassId): TruckBuild {
  return structuredClone(KITS[cls].stock)
}

/** Damping scale for some clicks from the middle: each click is `clickStep` firmer or softer, compounding. */
export function clickScale(clicks: number): number {
  const step = 1 + TUNE.clickStep
  return clicks >= 0 ? powInt(step, clicks) : 1 / powInt(step, -clicks)
}

function scaleFatigue(f: FatigueSpec, k: number): FatigueSpec {
  return { ...f, ultimate: f.ultimate * k, endurance: f.endurance * k, gate: f.gate * k }
}

/** The recovery kit's weight by where it rides: the winch on the front bumper, the rest on the rear carrier (kg). */
export function kitWeights(b: TruckBuild): KitWeights {
  const kit = partIn(b, 'recovery')
  const total = kit.mass[b.cls] as number
  const front = kit.winch === 'none' ? 0 : (RECOVERY.winchMass[kit.winch][b.cls] ?? 0)
  return { front, rear: total - front }
}

/** Total mass (kg) and cost (cr.) of a build. */
export function massAndCost(b: TruckBuild): { mass: number; cost: number } {
  let mass = KITS[b.cls].baseMass
  let cost = 0
  for (const slot of SLOTS) {
    const p = partIn(b, slot)
    mass += p.mass[b.cls] as number
    cost += p.cost[b.cls] as number
  }
  return { mass, cost }
}

/** Build the truck: the ride setup, the wear setup, and what the screen shows about it. */
export function buildTruck(input: TruckBuild): BuiltTruck {
  const b = tidyBuild(input)
  const cls = b.cls
  const kit = KITS[cls]
  const mule = TEST_MULES[cls]
  const muleWear = MULE_WEAR[cls]
  const { mass, cost } = massAndCost(b)

  const frame = partIn(b, 'frame')
  const susp = [partIn(b, 'frontSusp'), partIn(b, 'rearSusp')] as const
  const damper = partIn(b, 'dampers')
  const stops = partIn(b, 'bumpStops')
  const bars = partIn(b, 'antiRoll')
  const axles = partIn(b, 'axles')
  const wheels = partIn(b, 'wheels')
  const tires = partIn(b, 'tires')
  const engine = partIn(b, 'engine')

  // Weight that moves with each wheel, then the rest is held up by the springs.
  const unsprung = susp.map((s, k) => {
    const muleAxle = k === 0 ? mule.front : mule.rear
    return muleAxle.unsprungMass * s.unsprung * wheels.unsprung * tires.unsprung * axles.unsprung
  })
  const sprungMass = mass - 2 * (unsprung[0] as number) - 2 * (unsprung[1] as number)
  // The load (weight and balance): weight added or taken away, and where the centre of mass ends up.
  const load = b.load ?? { ...STOCK_LOAD }
  // The recovery kit rides where it's carried: a winch on the nose, boards and jack at the back.
  const shift = loadShift(cls, b.load, partIn(b, 'spares').mass[cls] as number, sprungMass, kitWeights(b))
  const runSprung = sprungMass + shift.dMass
  const a0 = mule.cgToFront
  const r0 = mule.cgToRear
  const a = a0 - shift.dx
  const r = r0 + shift.dx
  const g = SIM.gravity

  const corners: CornerGeometry[] = []
  const rideAxles: AxleSetup[] = []
  const wearAxles: AxleWear[] = []
  /** The same truck with the stock load: each axle's sag and corner load, to see what the load changed. */
  const stockSag: number[] = []
  const stockLoad: number[] = []

  for (let k = 0; k < 2; k++) {
    const set = k === 0 ? b.front : b.rear
    const s = susp[k] as (typeof susp)[number]
    const muleAxle = k === 0 ? mule.front : mule.rear
    const muleAw = k === 0 ? muleWear.front : muleWear.rear
    const m = unsprung[k] as number

    // Ride height from the spring, measured up from full droop.
    const load = (runSprung * g * (k === 0 ? r : a)) / (a + r) / 2
    const travel = kit.travel * s.travel
    const sag = clamp(load / set.springRate - set.preload, TUNE.minDroop, travel - TUNE.minBump)
    const load0 = (sprungMass * g * (k === 0 ? r0 : a0)) / (a0 + r0) / 2
    stockLoad.push(load0)
    stockSag.push(clamp(load0 / set.springRate - set.preload, TUNE.minDroop, travel - TUNE.minBump))
    const bumpTravel = travel - sag
    const droopTravel = Math.max(TUNE.minDroop, Math.min(sag, set.droopLimit))

    // Tire stiffness: a share from the casing, the rest from the air, which follows the pressure.
    const air = set.tirePressure / kit.refPressure
    const tireRate = muleAxle.tireRate * tires.stiffness * (TUNE.casingShare + (1 - TUNE.casingShare) * air)

    const md = muleAxle.damper
    const reb = clickScale(set.rebound)
    const dmp: DamperSetup = {
      ...md,
      compLow: md.compLow * clickScale(set.compLow),
      compHigh: md.compHigh * clickScale(set.compHigh),
      rebLow: md.rebLow * reb,
      rebHigh: md.rebHigh * reb,
      heatCapacity: md.heatCapacity * damper.heat,
      coolStill: md.coolStill * damper.cool,
      coolPerSpeed: md.coolPerSpeed * damper.cool,
      aerationTemp: md.aerationTemp + damper.tempLimit,
      redLine: md.redLine + damper.tempLimit,
      warmFrom: md.warmFrom + damper.tempLimit,
    }
    // Spool valves (2017 on): damping by position in the travel, and oil heat that matters less.
    if (damper.spool) {
      dmp.position = { ...damper.spool.position }
      dmp.oilSense = damper.spool.oilSense
    }
    // Bypass tubes (bypass 1996, internal bypass 2008): damping that firms up in steps towards each end.
    if (damper.bypass) dmp.zones = damper.bypass

    rideAxles.push({
      ...muleAxle,
      unsprungMass: m,
      springRate: set.springRate,
      bumpTravel,
      droopTravel,
      bumpStopLength: Math.min(set.bumpStop, bumpTravel - TUNE.bumpStopRoom),
      bumpStopRate: muleAxle.bumpStopRate * stops.rate,
      bumpStopProgression: stops.progression,
      antiRollRate: muleAxle.antiRollRate * bars.rate * (1 + TUNE.antiRollStep * set.antiRoll),
      tireRate,
      damper: dmp,
    })

    // The axle or CV joint runs straight at a fixed height above full droop, so its angle at ride height follows the sag.
    // That height doesn't grow with a longer-travel part (plan PR 13): makers set the joint straight near ride height, and
    // scaling it put the 1990s wishbones and trailing arms' joints off-straight on factory settings, snapping axles every stage.
    const ma = muleAw.axle
    wearAxles.push({
      mount: scaleFatigue(muleAw.mount, s.mount),
      bottoming: scaleFatigue(muleAw.bottoming, stops.strength),
      axle: {
        ...ma,
        fatigue: { ...ma.fatigue },
        strength: ma.strength * axles.strength,
        armLength: ma.armLength * s.arm,
        straightAt: kit.straightFromDroop - sag,
        maxAngle: ma.maxAngle * s.maxAngle,
        driveTorque: ma.driveTorque * engine.torque,
        spinMomentum: ma.spinMomentum * engine.torque,
      },
      tire: {
        ...muleAw.tire,
        bruiseFrom: muleAw.tire.bruiseFrom * tires.casing,
        pinchAt: muleAw.tire.pinchAt * tires.casing,
        bruise: { ...muleAw.tire.bruise },
        studded: tires.studded,
      },
    })

    corners.push({ travel, sag, bumpTravel, droopTravel, tireLoad: load + m * g, tireRate, unsprungMass: m })
  }

  // A heavier or lighter body is harder or easier to pitch and roll, in step with its mass,
  // plus whatever the load adds by sitting away from the middle.
  const inertia = sprungMass / mule.sprungMass
  const ride: RideSetup = {
    ...mule,
    sprungMass: runSprung,
    pitchInertia: mule.pitchInertia * inertia + shift.dPitch,
    rollInertia: mule.rollInertia * inertia + shift.dRoll,
    cgToFront: a,
    cgToRear: r,
    front: rideAxles[0] as AxleSetup,
    rear: rideAxles[1] as AxleSetup,
  }
  if (shift.dy !== 0) ride.cgLeft = shift.dy
  const wear: WearSetup = {
    front: wearAxles[0] as AxleWear,
    rear: wearAxles[1] as AxleWear,
    frame: {
      front: scaleFatigue(muleWear.frame.front, frame.strength),
      centre: scaleFatigue(muleWear.frame.centre, frame.strength),
      rear: scaleFatigue(muleWear.frame.rear, frame.strength),
    },
  }
  const runMass = mass + shift.dMass
  return {
    build: b,
    ride,
    wear,
    mass,
    runMass,
    load,
    balance: balanceOf(ride, corners, stockSag, stockLoad, runMass, sprungMass + 2 * (unsprung[0] as number) + 2 * (unsprung[1] as number)),
    cost,
    power: engine.power,
    front: corners[0] as CornerGeometry,
    rear: corners[1] as CornerGeometry,
  }
}

/**
 * How the load sits: the weight on each corner, the bump travel each has left
 * once the truck leans, and how far the load tips the body (`Balance`). The
 * left and right split follows the ride model's own sums (`rideParams`).
 */
function balanceOf(ride: RideSetup, corners: CornerGeometry[], stockSag: number[], stockLoad: number[], runMass: number, mass: number): Balance {
  const g = SIM.gravity
  const w = ride.track / 2
  const y = ride.cgLeft ?? 0
  const out: CornerLoad[] = []
  const heights: number[] = []
  let rolls = 0
  let front = 0
  let left = 0
  let stockFront = 0
  for (let k = 0; k < 2; k++) {
    const ax = k === 0 ? ride.front : ride.rear
    const c = corners[k] as CornerGeometry
    const springs = c.tireLoad - c.unsprungMass * g
    // The axle's weight leans onto the low side; the springs and the anti-roll bar hold it.
    const lean = (2 * springs * y) / w / 2
    const twist = (2 * lean) / (ax.springRate + 2 * ax.antiRollRate)
    out.push(
      { tireLoad: c.tireLoad + lean, bumpTravel: leanTravel(c.bumpTravel - twist / 2) },
      { tireLoad: c.tireLoad - lean, bumpTravel: leanTravel(c.bumpTravel + twist / 2) },
    )
    rolls += -(twist + (2 * lean) / ax.tireRate) / ride.track
    // Each end's height against the stock load: the springs' sag, and the tires squashing.
    heights.push(-(c.sag - (stockSag[k] as number)) - (springs - (stockLoad[k] as number)) / ax.tireRate)
    front += k === 0 ? 2 * c.tireLoad : 0
    left += c.tireLoad + lean
    stockFront += k === 0 ? 2 * ((stockLoad[k] as number) + c.unsprungMass * g) : 0
  }
  return {
    front: front / (runMass * g),
    left: left / (runMass * g),
    stockFront: stockFront / (mass * g),
    pitch: ((heights[0] as number) - (heights[1] as number)) / (ride.cgToFront + ride.cgToRear),
    roll: rolls / 2,
    corners: out,
  }
}

/** Bump travel never drops below the ride model's floor (`LEAN.minTravel`). */
function leanTravel(v: number): number {
  return Math.max(LEAN.minTravel, v)
}

/** Something that keeps a build out of a raid. */
export type BuildProblem =
  | { kind: 'tooHeavy'; by: number; limit: number }
  | { kind: 'tooLight'; by: number; limit: number }
  | { kind: 'overBudget'; by: number; budget: number }
  | { kind: 'notYet'; slot: SlotId; part: string; year: number }

export interface BuildRules {
  /** The year it is: parts that come out later can't be bought (career, plan PR 9). */
  year: number
  /** Money (cr.) to spend. */
  budget: number
  /**
   * The career's own truck (plan PR 9): the parts already on it cost
   * nothing, a change costs the new part (less any works discount) minus
   * what the old one sells for, and `budget` is the money in the bank.
   */
  owned?: { build: TruckBuild; resale: number; discount: number }
}

/**
 * What changing a truck's parts from `from` to `to` costs: each new part's
 * price (less the discount) minus what the old one sells for. Below 0 is
 * money back. Settings are free. Both builds must be the same class.
 */
export function changeCost(from: TruckBuild, to: TruckBuild, resale: number, discount = 0): number {
  if (from.cls !== to.cls) throw new RangeError(`Can't change a ${from.cls} into a ${to.cls}`)
  let sum = 0
  for (const slot of SLOTS) {
    if (from.parts[slot] === to.parts[slot]) continue
    sum += (partIn(to, slot).cost[to.cls] as number) * (1 - discount) - (partIn(from, slot).cost[from.cls] as number) * resale
  }
  return sum
}

/** The shop's rules for a class until the career sets them: its test budget, any year. */
export function shopRules(cls: ClassId, year: number): BuildRules {
  return { year, budget: KITS[cls].budget }
}

/** Everything wrong with a build under the class rules; empty means it may race. */
export function checkBuild(b: TruckBuild, rules: BuildRules): BuildProblem[] {
  const out: BuildProblem[] = []
  const cls = CLASSES.find((c) => c.id === b.cls)
  if (!cls) throw new RangeError(`Unknown class ${b.cls}`)
  const { mass, cost } = massAndCost(b)
  if (mass > cls.maxMass) out.push({ kind: 'tooHeavy', by: mass - cls.maxMass, limit: cls.maxMass })
  if (mass < cls.minMass) out.push({ kind: 'tooLight', by: cls.minMass - mass, limit: cls.minMass })
  const spend = rules.owned ? changeCost(rules.owned.build, b, rules.owned.resale, rules.owned.discount) : cost
  if (spend > 0 && spend > rules.budget) out.push({ kind: 'overBudget', by: spend - rules.budget, budget: rules.budget })
  for (const slot of SLOTS) {
    const p = partIn(b, slot)
    if (p.year > rules.year) out.push({ kind: 'notYet', slot, part: p.id, year: p.year })
  }
  return out
}
