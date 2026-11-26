/**
 * The truck being built (plan PR 3): one build per class, the class on the
 * bench, and the year. The build screen changes it; the ride sim and the
 * break test read it. The garage (`src/ui/garage.ts`) saves it into the
 * slot after each change (plan PR 8).
 */
import { CLASSES, type ClassId } from '../data/classes'
import type { TruckBuild } from '../data/kit'
import { FIRST_YEAR, LAST_YEAR } from '../data/parts'
import { buildTruck, shopRules, stockBuild, tidyBuild, type BuildRules, type BuiltTruck } from '../sim/build'

/** What changed: the class (or year) means redraw everything; a part or setting just the numbers. */
export type Change = 'class' | 'year' | 'part' | 'setting' | 'bench'

/**
 * The career's hold on the bench (plan PR 9): whose truck it is, the class
 * and year it's locked to, and the rules it's built under (a privateer's
 * budget, or your own money with the parts you own). Null in free play.
 */
export interface Bench {
  kind: 'contract' | 'own' | 'shop'
  /** Locked to this class, or null to let the player pick (window shopping with no truck yet). */
  cls: ClassId | null
  year: number
  rules(b: TruckBuild): BuildRules
  /** A line at the top of the build screen saying whose truck this is. */
  label: string
  /** What "Reset" puts back (your own truck as you own it, say); stock if left out. */
  reset?(): TruckBuild
  /** A note and maybe a button under the money line (e.g. "Buy these parts"), checked after every change. */
  note?(b: TruckBuild): { text: string; button?: { text: string; run(): void } } | null
}

export interface BuildStore {
  cls(): ClassId
  build(): TruckBuild
  truck(): BuiltTruck
  year(): number
  setClass(cls: ClassId): void
  setYear(year: number): void
  /** Replace the build; it's tidied so every setting fits the parts. */
  setBuild(b: TruckBuild, change: 'part' | 'setting'): void
  resetClass(): void
  onChange(fn: (change: Change) => void): void
  /** Every class's build, for saving. */
  builds(): Record<ClassId, TruckBuild>
  /** The career's hold on the bench, or null in free play. */
  bench(): Bench | null
  /** Lock the bench for the career (or free it with null); with a build, put that truck on it. */
  setBench(bench: Bench | null, b?: TruckBuild): void
  /** The rules the truck on the bench is built under. */
  rules(): BuildRules
}

/** Where a store starts: a saved garage's builds, class and year. */
export interface StoreStart {
  builds: Record<ClassId, TruckBuild>
  cls: ClassId
  year: number
}

export { FIRST_YEAR, LAST_YEAR }

export function makeBuildStore(start?: StoreStart): BuildStore {
  const builds = Object.fromEntries(CLASSES.map((c) => [c.id, start ? tidyBuild(start.builds[c.id]) : stockBuild(c.id)])) as Record<ClassId, TruckBuild>
  let cls: ClassId = start?.cls ?? 'light4x4'
  let year = start?.year ?? FIRST_YEAR
  let built: BuiltTruck | null = null
  let bench: Bench | null = null
  const listeners: ((change: Change) => void)[] = []

  function changed(change: Change): void {
    built = null
    for (const fn of listeners) fn(change)
  }

  return {
    cls: () => cls,
    build: () => builds[cls],
    truck: () => (built ??= buildTruck(builds[cls])),
    year: () => year,
    setClass(next) {
      if (next === cls || (bench?.cls && bench.cls !== next)) return
      cls = next
      changed('class')
    },
    setYear(next) {
      if (bench) return
      year = next
      changed('year')
    },
    setBuild(b, change) {
      builds[b.cls] = tidyBuild(b)
      changed(change)
    },
    resetClass() {
      builds[cls] = bench?.reset ? tidyBuild(bench.reset()) : stockBuild(cls)
      changed('part')
    },
    onChange(fn) {
      listeners.push(fn)
    },
    builds: () => ({ ...builds }),
    bench: () => bench,
    setBench(next, b) {
      bench = next
      if (next) {
        year = next.year
        if (next.cls) cls = next.cls
      }
      if (b) builds[b.cls] = tidyBuild(b)
      changed('bench')
    },
    rules: () => (bench ? bench.rules(builds[cls]) : shopRules(cls, year)),
  }
}
