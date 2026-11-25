/**
 * The three truck classes, all in from day one (Kelbo, 25 November 2026).
 * Weights are the class limits in kilograms, from the plan's Classes table.
 * Their parts and settings are in `src/data/parts.ts` and `src/data/kit.ts`;
 * their rivals arrive with the raids.
 */
import type { StringKey } from './strings'

export type ClassId = 'light4x4' | 'heavy' | 'sxs'

export interface TruckClass {
  id: ClassId
  /** Lightest the truck may be, ready to race (kg). */
  minMass: number
  /** Heaviest the truck may be, ready to race (kg). */
  maxMass: number
  name: StringKey
  blurb: StringKey
}

export const CLASSES: readonly TruckClass[] = [
  { id: 'light4x4', minMass: 1800, maxMass: 2100, name: 'class.light4x4', blurb: 'class.light4x4Text' },
  { id: 'heavy', minMass: 8500, maxMass: 10000, name: 'class.heavy', blurb: 'class.heavyText' },
  { id: 'sxs', minMass: 900, maxMass: 1100, name: 'class.sxs', blurb: 'class.sxsText' },
]
