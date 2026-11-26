/**
 * The truck being built (plan PR 3): one build per class, the class on the
 * bench, and the year. The build screen changes it; the ride sim and the
 * break test read it. Kept in memory only: saves arrive in plan PR 8.
 */
import { CLASSES, type ClassId } from '../data/classes'
import type { TruckBuild } from '../data/kit'
import { FIRST_YEAR, LAST_YEAR } from '../data/parts'
import { buildTruck, stockBuild, tidyBuild, type BuiltTruck } from '../sim/build'

/** What changed: the class (or year) means redraw everything; a part or setting just the numbers. */
export type Change = 'class' | 'year' | 'part' | 'setting'

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
}

export { FIRST_YEAR, LAST_YEAR }

export function makeBuildStore(): BuildStore {
  const builds = Object.fromEntries(CLASSES.map((c) => [c.id, stockBuild(c.id)])) as Record<ClassId, TruckBuild>
  let cls: ClassId = 'light4x4'
  let year = FIRST_YEAR
  let built: BuiltTruck | null = null
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
      if (next === cls) return
      cls = next
      changed('class')
    },
    setYear(next) {
      year = next
      changed('year')
    },
    setBuild(b, change) {
      builds[b.cls] = tidyBuild(b)
      changed(change)
    },
    resetClass() {
      builds[cls] = stockBuild(cls)
      changed('part')
    },
    onChange(fn) {
      listeners.push(fn)
    },
  }
}
