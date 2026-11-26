/**
 * The truck's condition over a raid (bivouac breakdowns): tired shock oil,
 * sagging springs and cracked bushings, per axle. They never stop the
 * truck by themselves; they change the truck the next stage drives, so a
 * fade or a cracked mount comes sooner. Numbers: `src/data/condition.ts`.
 *
 * Pure maths on plain numbers, so a raid in progress can be saved.
 */
import { CONDITION, type CondPart } from '../data/condition'
import type { BuiltTruck } from './build'

/** Each list is [front, rear], 0 (fresh) to 1 (worn out). */
export type Condition = Record<CondPart, number[]>

export function newCondition(): Condition {
  return { oil: [0, 0], bushing: [0, 0], spring: [0, 0] }
}

/** The axle a corner is on: 0 front, 1 rear. */
export function axleOf(corner: number): number {
  return corner < 2 ? 0 : 1
}

const cap = (x: number) => (x > 1 ? 1 : x < 0 ? 0 : x)

/** What one piece of a stage did to the truck's condition, from the ride sim's numbers for it. */
export interface ConditionLoad {
  /** Heat each damper made (J). */
  damperEnergy: readonly number[]
  /** Hottest oil per damper (K). */
  peakTemp: readonly number[]
  /** Bottom-outs per corner. */
  bottomOuts: readonly number[]
  /** Metres driven, and the ground. */
  distance: number
  harsh: boolean
}

/** Add one piece of a stage's wear to the condition (changes `c`). */
export function tireCondition(c: Condition, truck: BuiltTruck, load: ConditionLoad): void {
  const km = load.distance / 1000
  for (let axle = 0; axle < 2; axle++) {
    const d = (axle === 0 ? truck.ride.front : truck.ride.rear).damper
    let oil = 0
    let hits = 0
    for (const corner of [axle * 2, axle * 2 + 1]) {
      const kelvin = (load.damperEnergy[corner] ?? 0) / d.heatCapacity
      const span = d.redLine - d.warmFrom
      const hot = span > 0 ? cap(((load.peakTemp[corner] ?? 0) - d.warmFrom) / span) : 0
      oil += kelvin * CONDITION.oil.perKelvin * (1 + (CONDITION.oil.hotBoost - 1) * hot)
      hits += load.bottomOuts[corner] ?? 0
    }
    // The two shocks share one service, so the axle's oil is the average of the pair.
    c.oil[axle] = cap((c.oil[axle] as number) + oil / 2)
    const harshKm = load.harsh ? km : 0
    c.spring[axle] = cap((c.spring[axle] as number) + hits * CONDITION.spring.perBottomOut + harshKm * CONDITION.spring.perHarshKm)
    c.bushing[axle] = cap((c.bushing[axle] as number) + hits * CONDITION.bushing.perBottomOut + harshKm * CONDITION.bushing.perHarshKm)
  }
}

/** The plain-words effect of a condition, for the screens: damping lost, kelvin sooner to fade, travel lost, mounts weaker (shares). */
export interface ConditionEffect {
  damping: number
  fadeSooner: number
  travel: number
  mount: number
}

export function conditionEffect(part: CondPart, value: number): ConditionEffect {
  const v = cap(value)
  return {
    damping: part === 'oil' ? v * CONDITION.oil.damping : 0,
    fadeSooner: part === 'oil' ? v * CONDITION.oil.redDrop : 0,
    travel: part === 'spring' ? v * CONDITION.spring.travel : 0,
    mount: part === 'bushing' ? v * CONDITION.bushing.mount : 0,
  }
}

/**
 * The truck as it stands this morning: the same parts and settings, with
 * tired oil, sagged springs and cracked bushings worked in. Returns a copy.
 */
export function wornTruck(truck: BuiltTruck, c: Condition): BuiltTruck {
  const t = structuredClone(truck)
  // Copy each axle on its own: the front and rear may share one object in the build, and only one should change.
  t.ride.front = structuredClone(truck.ride.front)
  t.ride.rear = structuredClone(truck.ride.rear)
  t.wear.front = structuredClone(truck.wear.front)
  t.wear.rear = structuredClone(truck.wear.rear)
  for (let axle = 0; axle < 2; axle++) {
    const a = axle === 0 ? t.ride.front : t.ride.rear
    const oil = cap(c.oil[axle] ?? 0)
    if (oil > 0) {
      const keep = 1 - oil * CONDITION.oil.damping
      const d = a.damper
      d.compLow *= keep
      d.compHigh *= keep
      d.rebLow *= keep
      d.rebHigh *= keep
      d.redLine -= oil * CONDITION.oil.redDrop
      d.aerationTemp -= oil * CONDITION.oil.redDrop
    }
    const sag = cap(c.spring[axle] ?? 0)
    if (sag > 0) {
      // The spring sits lower: travel moves from bump to droop, and it's a little softer.
      const lost = a.bumpTravel * sag * CONDITION.spring.travel
      a.bumpTravel -= lost
      a.droopTravel += lost
      a.bumpStopLength = Math.min(a.bumpStopLength, a.bumpTravel)
      a.springRate *= 1 - sag * CONDITION.spring.rate
    }
    const bush = cap(c.bushing[axle] ?? 0)
    if (bush > 0) {
      const m = (axle === 0 ? t.wear.front : t.wear.rear).mount
      const keep = 1 - bush * CONDITION.bushing.mount
      m.ultimate *= keep
      m.endurance *= keep
    }
  }
  return t
}
