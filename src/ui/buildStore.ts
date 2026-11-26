/**
 * The truck being built (plan PR 3): one build per class, the class on the
 * bench, and the year. The build screen changes it; the ride sim and the
 * break test read it. The garage (`src/ui/garage.ts`) saves it into the
 * slot after each change (plan PR 8).
 */
import { CLASSES, type ClassId } from '../data/classes'
import type { AxleSettings, TruckBuild } from '../data/kit'
import { FIRST_YEAR, LAST_YEAR } from '../data/parts'
import { buildTruck, shopRules, stockBuild, tidyBuild, type BuildRules, type BuiltTruck } from '../sim/build'
import type { TruckLog } from '../sim/logbook'

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
  /** The logbook of the truck on the bench (the garage's own truck), for the truck card. */
  log?(): TruckLog | null
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

/** One end of the truck. */
export type End = 'front' | 'rear'

/**
 * Change one tune setting. With the axles linked, both ends get the same
 * value, so one slider tunes the whole truck; unlinked, only `end` changes.
 * Either way the other settings keep what they had, so unlinking leaves the
 * values where they are, ready to tune apart again.
 */
export function withSetting(b: TruckBuild, end: End, key: keyof AxleSettings, value: number, linked: boolean): TruckBuild {
  if (!linked) return { ...b, [end]: { ...b[end], [key]: value } }
  return { ...b, front: { ...b.front, [key]: value }, rear: { ...b.rear, [key]: value } }
}

/**
 * "Link front and rear" is remembered on this phone (not in a save slot),
 * like the other screen choices. Everything is wrapped in try, because
 * private browsing can refuse localStorage; then it just starts unlinked.
 */
const LINK_KEY = 'bumpstop.linkAxles'

export function readLinkAxles(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(LINK_KEY) === '1'
  } catch {
    return false
  }
}

export function writeLinkAxles(linked: boolean, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(LINK_KEY, linked ? '1' : '0')
  } catch {
    // Nowhere to keep it; the toggle still works until the page reloads.
  }
}
