/**
 * What a garage slot holds (plan PR 8), and how a stored or pasted save is
 * checked before the game trusts it.
 *
 * A save is plain JSON: the build for each class, the class on the bench,
 * the year, the raid in progress (if any) and the last run on each rig (the
 * ghosts). Save codes leave the ghosts out (`leanSave`) because they're big
 * and only there for comparing runs.
 *
 * `readSave` takes anything (a slot from storage, an unpacked save code)
 * and either returns a save the game can load or throws SaveFormatError.
 * It moves old formats up to the newest one first, so a save made by an
 * older version of Bump Stop still loads. Pure: no DOM, no storage.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { KITS, type AxleSettings, type TruckBuild } from '../data/kit'
import { FIRST_YEAR, LAST_YEAR, SLOTS } from '../data/parts'
import { DRIVER_IDS, RAIDS, type RaidId } from '../data/raids'
import { SAVE } from '../data/save'
import { findPart, fitsClass, stockBuild, tidyBuild } from '../sim/build'
import type { RaidState } from '../sim/raid'

export interface GarageSave {
  /** The save format (`SAVE.version`). */
  v: number
  /** The class on the bench. */
  cls: ClassId
  /** The year the shop's parts list is set to. */
  year: number
  /** One build per class. */
  builds: Record<ClassId, TruckBuild>
  /** The raid in progress or just finished, saved each morning, each night and at the end. */
  raid: RaidState | null
  /** The last run on each rig (`<class>:<rig>`), for the ghost line. Only the shop reads these. */
  ghosts: Record<string, unknown>
}

/** Why a save couldn't be read: damaged or not a save at all ('bad'), or made by a newer Bump Stop ('future'). */
export class SaveFormatError extends Error {
  constructor(
    readonly kind: 'bad' | 'future',
    message: string,
  ) {
    super(message)
    this.name = 'SaveFormatError'
  }
}

const CLASS_IDS = CLASSES.map((c) => c.id)

/** A fresh garage: stock builds, the first class, the first year. */
export function newSave(): GarageSave {
  return {
    v: SAVE.version,
    cls: CLASS_IDS[0]!,
    year: FIRST_YEAR,
    builds: Object.fromEntries(CLASS_IDS.map((c) => [c, stockBuild(c)])) as Record<ClassId, TruckBuild>,
    raid: null,
    ghosts: {},
  }
}

/** The save without the rig ghosts: what a save code carries. */
export function leanSave(save: GarageSave): GarageSave {
  return { ...save, ghosts: {} }
}

/**
 * Has the player done anything worth keeping? Asking the browser to keep our
 * storage, and the backup reminder, both wait for this.
 */
export function hasProgress(save: GarageSave): boolean {
  if (save.raid || Object.keys(save.ghosts).length > 0 || save.year !== FIRST_YEAR) return true
  return CLASS_IDS.some((c) => JSON.stringify(save.builds[c]) !== JSON.stringify(stockBuild(c)))
}

// ── Checking ──

function fail(why: string): never {
  throw new SaveFormatError('bad', why)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function finite(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} is not a number`)
  return v
}

function arrayOf(v: unknown, what: string, length?: number): unknown[] {
  if (!Array.isArray(v)) fail(`${what} is not a list`)
  if (length !== undefined && v.length !== length) fail(`${what} has ${v.length} items, not ${length}`)
  return v
}

const AXLE_KEYS: readonly (keyof AxleSettings)[] = [
  'springRate', 'preload', 'compLow', 'compHigh', 'rebound', 'bumpStop', 'droopLimit', 'tirePressure', 'antiRoll',
]

/**
 * A build from a save or a build code. Parts that don't exist any more (or
 * don't fit the class) go back to stock, and every setting is pulled inside
 * its range, so an old save never breaks the build screen.
 */
export function readBuild(raw: unknown, cls?: ClassId): TruckBuild {
  if (!isObj(raw)) fail('build is missing')
  const c = raw.cls as ClassId
  if (!CLASS_IDS.includes(c)) fail('build has an unknown class')
  if (cls && c !== cls) fail('build is filed under the wrong class')
  const stock = KITS[c].stock
  const parts = isObj(raw.parts) ? raw.parts : fail('build has no parts')
  const out: TruckBuild = { cls: c, parts: { ...stock.parts }, front: { ...stock.front }, rear: { ...stock.rear } }
  for (const slot of SLOTS) {
    const id = parts[slot]
    const part = typeof id === 'string' ? findPart(id) : undefined
    if (part && part.slot === slot && fitsClass(part, c)) out.parts[slot] = part.id
  }
  for (const end of ['front', 'rear'] as const) {
    const axle = isObj(raw[end]) ? raw[end] : fail(`build has no ${end} settings`)
    for (const key of AXLE_KEYS) out[end][key] = finite(axle[key], `${end} ${key}`)
  }
  return tidyBuild(out)
}

function checkFatigue(v: unknown, what: string): void {
  if (!isObj(v)) fail(`${what} is missing`)
  for (const k of ['damage', 'lastTurn', 'extreme', 'dir'] as const) finite(v[k], `${what} ${k}`)
  if (typeof v.fresh !== 'boolean') fail(`${what} fresh is not true or false`)
}

/**
 * The raid in progress. Checked closely enough that the raid screens can't
 * trip over it: the raid and driver exist, the stage and results add up,
 * and the wear has a number everywhere the sim reads one.
 */
function readRaid(raw: unknown): RaidState {
  if (!isObj(raw) || !isObj(raw.entry)) fail('raid is missing its entry')
  const raidId = raw.entry.raid as RaidId
  const raid = Object.hasOwn(RAIDS, raidId) ? RAIDS[raidId] : fail('raid is unknown')
  if (!DRIVER_IDS.includes(raw.entry.driver as never)) fail('raid driver is unknown')
  const build = readBuild(raw.entry.build)
  const stage = finite(raw.stage, 'raid stage')
  if (!Number.isInteger(stage) || stage < 0 || stage > raid.stages.length) fail('raid stage is out of range')
  const phase = raw.phase
  if (phase !== 'morning' && phase !== 'bivouac' && phase !== 'done') fail('raid phase is unknown')
  if ((phase === 'done') !== (stage === raid.stages.length)) fail('raid phase does not match its stage')
  const results = arrayOf(raw.results, 'raid results', stage)
  for (const [n, r] of results.entries()) {
    if (!isObj(r)) fail(`stage ${n + 1} result is missing`)
    finite(r.time, `stage ${n + 1} time`)
    arrayOf(r.paces, `stage ${n + 1} paces`)
    arrayOf(r.stops, `stage ${n + 1} stops`)
    arrayOf(r.rivals, `stage ${n + 1} rivals`)
  }
  const w = isObj(raw.wear) ? raw.wear : fail('raid wear is missing')
  for (const part of ['bottoming', 'mount', 'axle', 'tire'] as const) {
    arrayOf(w[part], `${part} wear`, 4).forEach((f, i) => checkFatigue(f, `${part} wear ${i + 1}`))
  }
  arrayOf(w.frame, 'frame wear', 3).forEach((f, i) => checkFatigue(f, `frame wear ${i + 1}`))
  for (const k of ['spin', 'overRed'] as const) arrayOf(w[k], `${k} wear`, 4).forEach((x) => finite(x, `${k} wear`))
  finite(w.t, 'wear time')
  finite(w.distance, 'wear distance')
  if (w.broken !== null && !isObj(w.broken)) fail('wear broken is not a break')
  const spares = isObj(raw.spares) ? raw.spares : fail('raid spares are missing')
  for (const k of ['tire', 'shock', 'cv'] as const) {
    const n = finite(spares[k], `${k} spares`)
    if (n < 0 || !Number.isInteger(n)) fail(`${k} spares are not a count`)
  }
  return { ...(raw as unknown as RaidState), entry: { raid: raidId, build, driver: raw.entry.driver as RaidState['entry']['driver'] } }
}

/** Move a save made by an older format up one step at a time. Version 1 is the first, so there's nothing yet. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = raw.v
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) fail('save has no format number')
  if (v > SAVE.version) throw new SaveFormatError('future', 'save is from a newer Bump Stop')
  // When the format changes: `if (raw.v === 1) raw = { ...raw, v: 2, newThing: ... }`, and so on.
  return raw
}

/** Check a stored or pasted save, moving it up to the newest format. Throws SaveFormatError. */
export function readSave(input: unknown): GarageSave {
  if (!isObj(input)) fail('save is not an object')
  const raw = migrate(input)
  const cls = raw.cls as ClassId
  if (!CLASS_IDS.includes(cls)) fail('save has an unknown class')
  const year = finite(raw.year, 'year')
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) fail('year is out of range')
  const builds = isObj(raw.builds) ? raw.builds : fail('save has no builds')
  const out = newSave()
  out.cls = cls
  out.year = year
  for (const c of CLASS_IDS) if (builds[c] !== undefined) out.builds[c] = readBuild(builds[c], c)
  out.raid = raw.raid === null || raw.raid === undefined ? null : readRaid(raw.raid)
  out.ghosts = isObj(raw.ghosts) ? raw.ghosts : {}
  return out
}

