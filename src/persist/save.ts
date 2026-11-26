/**
 * What a garage slot holds (plan PR 8), and how a stored or pasted save is
 * checked before the game trusts it.
 *
 * A save is plain JSON: the build for each class, the class on the bench,
 * the year, the raid in progress (if any), the last run on each rig (the
 * ghosts) and the career (format 2, plan PR 9; format 3 has six raids a year). Save codes leave the ghosts out (`leanSave`) because they're big
 * and only there for comparing runs.
 *
 * `readSave` takes anything (a slot from storage, an unpacked save code)
 * and either returns a save the game can load or throws SaveFormatError.
 * It moves old formats up to the newest one first, so a save made by an
 * older version of Bump Stop still loads. Pure: no DOM, no storage.
 */
import { CALENDAR, TEAM_IDS, UPGRADES, type UpgradeId } from '../data/career'
import { CLASSES, type ClassId } from '../data/classes'
import { KITS, type AxleSettings, type TruckBuild } from '../data/kit'
import { LOGBOOK } from '../data/logbook'
import { FIRST_YEAR, LAST_YEAR, SLOTS } from '../data/parts'
import { DRIVER_IDS, RAIDS, type DriverId, type RaidId, type Rival } from '../data/raids'
import { SAVE } from '../data/save'
import { FAILURE_KINDS, type FailureKind } from '../data/wear'
import { WEATHER_IDS } from '../data/weather'
import { findPart, fitsClass, stockBuild, tidyBuild } from '../sim/build'
import type { CareerJob, CareerState, Contract, LongOneStory, NewsItem } from '../sim/career'
import type { CareerHall, DriverTally, RivalTally, SeasonLine } from '../sim/hall'
import { MOMENT_KINDS, newLog, tidyLogs, type TruckLog, type TruckMoment } from '../sim/logbook'
import type { RaidState } from '../sim/raid'
import { newCondition } from '../sim/condition'
import { COND_PARTS } from '../data/condition'
import { teamsForYear, type TeamGarage } from '../sim/teams'

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
  /** The career (plan PR 9, save format 2), or null if this garage hasn't started one. */
  career: CareerState | null
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
    career: null,
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
  if (save.raid || save.career || Object.keys(save.ghosts).length > 0 || save.year !== FIRST_YEAR) return true
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
    // The day's weather (missing in saves from before it came in).
    if (r.weather !== undefined && r.weather !== null) {
      const w = isObj(r.weather) ? r.weather : fail(`stage ${n + 1} weather is not weather`)
      if (!WEATHER_IDS.includes(w.kind as never)) fail(`stage ${n + 1} weather is unknown`)
      for (const k of ['chance', 'from', 'to', 'at'] as const) finite(w[k], `stage ${n + 1} weather ${k}`)
      if (typeof w.comes !== 'boolean') fail(`stage ${n + 1} weather has no answer`)
    }
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
  const entry: RaidState['entry'] = { raid: raidId, build, driver: raw.entry.driver as RaidState['entry']['driver'] }
  // Career raids (format 2) carry the year's seed, the field and the crew's hours.
  if (raw.entry.seed !== undefined) entry.seed = finite(raw.entry.seed, 'raid seed')
  if (raw.entry.hours !== undefined) {
    entry.hours = finite(raw.entry.hours, 'raid hours')
    if (entry.hours <= 0) fail('raid hours are not positive')
  }
  if (raw.entry.field !== undefined) entry.field = arrayOf(raw.entry.field, 'raid field').map((r, i) => readRival(r, i, build.cls))
  if (raw.entry.budget !== undefined) {
    entry.budget = finite(raw.entry.budget, 'raid parts money')
    if (entry.budget < 0) fail('raid parts money is below zero')
  }
  // Bivouac breakdowns (after 1.2): a raid saved before them has no condition
  // or parts money spent, so it carries on with fresh oil, springs and bushings.
  const cond = newCondition()
  if (raw.cond !== undefined) {
    if (!isObj(raw.cond)) fail('raid condition is not a list')
    const c = raw.cond
    for (const part of COND_PARTS) {
      cond[part] = arrayOf(c[part], `${part} condition`, 2).map((x) => {
        const v = finite(x, `${part} condition`)
        if (v < 0 || v > 1) fail(`${part} condition is out of range`)
        return v
      })
    }
  }
  const spent = raw.spent === undefined ? 0 : finite(raw.spent, 'raid parts money spent')
  if (spent < 0) fail('raid parts money spent is below zero')
  return { ...(raw as unknown as RaidState), entry, cond, spent }
}

const TROUBLES = ['fade', 'bottoming', 'mount', 'axle', 'tire', 'stuck', 'lost']

/** A rival entry in a career raid's field. */
function readRival(raw: unknown, i: number, cls: ClassId): Rival {
  const what = `rival ${i + 1}`
  if (!isObj(raw)) fail(`${what} is missing`)
  if (typeof raw.id !== 'string' || typeof raw.team !== 'string' || typeof raw.habit !== 'string') fail(`${what} has no name`)
  if (!raw.team.startsWith('team.') || !raw.habit.startsWith('habit.')) fail(`${what} has an unknown team`)
  if (raw.cls !== cls) fail(`${what} is in the wrong class`)
  for (const k of ['number', 'pace', 'spread', 'risk'] as const) finite(raw[k], `${what} ${k}`)
  const delay = arrayOf(raw.delay, `${what} delay`, 2).map((x) => finite(x, `${what} delay`))
  const trouble = arrayOf(raw.trouble, `${what} trouble`)
  if (!trouble.length || trouble.some((x) => !TROUBLES.includes(x as string))) fail(`${what} has unknown trouble`)
  return { ...(raw as unknown as Rival), delay: delay as [number, number] }
}

// ── The career (format 2) ──

function readContract(raw: unknown): Contract {
  if (!isObj(raw)) fail('contract is missing')
  if (typeof raw.id !== 'string') fail('contract has no id')
  if (!CLASS_IDS.includes(raw.cls as ClassId)) fail('contract has an unknown class')
  if (!DRIVER_IDS.includes(raw.driver as never)) fail('contract driver is unknown')
  for (const k of ['number', 'budget', 'fee', 'rep'] as const) finite(raw[k], `contract ${k}`)
  const bonus = isObj(raw.bonus) ? raw.bonus : fail('contract has no bonus')
  for (const k of ['finish', 'podium', 'win'] as const) finite(bonus[k], `contract ${k} bonus`)
  return raw as unknown as Contract
}

function readJob(raw: unknown): CareerJob | null {
  if (raw === null || raw === undefined) return null
  if (!isObj(raw)) fail('career job is not a job')
  if (raw.kind === 'own') {
    if (!DRIVER_IDS.includes(raw.driver as never)) fail('career job driver is unknown')
    return { kind: 'own', driver: raw.driver as DriverId }
  }
  if (raw.kind === 'contract') {
    const contract = readContract(raw.contract)
    return { kind: 'contract', contract, build: readBuild(raw.build, contract.cls) }
  }
  fail('career job is unknown')
}

/** The rival teams' trucks. A truck that can't be read is bought again for the year, so the career always carries on. */
function readTeams(raw: unknown, year: number): TeamGarage {
  const fresh = teamsForYear(year)
  if (!isObj(raw)) return fresh
  for (const id of TEAM_IDS) {
    const team = raw[id]
    if (!isObj(team)) continue
    for (const cls of Object.keys(fresh[id]) as ClassId[]) {
      try {
        if (team[cls] !== undefined) fresh[id][cls] = readBuild(team[cls], cls)
      } catch {
        // Keep the fresh truck for this one.
      }
    }
  }
  return fresh
}

const NEWS_KINDS: readonly NewsItem['kind'][] = ['result', 'winner', 'copied', 'newParts', 'sponsor', 'broke', 'longOne', 'skipped']

/**
 * The first Long One win (plan PR 13), for the finale card and the record.
 * Only for reading: one that doesn't add up is dropped rather than failing the save.
 */
function readStory(raw: unknown): { firstLongOne?: LongOneStory } {
  try {
    if (!isObj(raw)) return {}
    const cls = raw.cls as ClassId
    if (!CLASS_IDS.includes(cls) || !DRIVER_IDS.includes(raw.driver as never)) return {}
    const stats = isObj(raw.stats) ? raw.stats : fail('story stats are missing')
    for (const k of ['raids', 'wins', 'podiums', 'contracts'] as const) finite(stats[k], `story ${k}`)
    // The winning truck's parts, checked like any build's.
    const parts = readBuild({ ...stockBuild(cls), parts: raw.parts }, cls).parts
    return {
      firstLongOne: {
        year: finite(raw.year, 'story year'), seasons: finite(raw.seasons, 'story seasons'), cls, driver: raw.driver as DriverId, parts,
        stats: { raids: stats.raids as number, wins: stats.wins as number, podiums: stats.podiums as number, contracts: stats.contracts as number },
      },
    }
  } catch {
    return {}
  }
}

/** A count in the hall of fame: a whole number, never below zero. */
function hallCount(v: unknown, what: string): number {
  const n = finite(v, what)
  if (!Number.isInteger(n) || n < 0) fail(`${what} is not a count`)
  return n
}

function readSeasonLine(raw: unknown): SeasonLine | null {
  try {
    if (!isObj(raw)) return null
    let best: SeasonLine['best'] = null
    if (isObj(raw.best)) {
      const b = raw.best
      if (RAIDS[b.raid as RaidId] && CLASS_IDS.includes(b.cls as ClassId) && (b.job === 'own' || b.job === 'contract')) {
        best = { raid: b.raid as RaidId, cls: b.cls as ClassId, job: b.job, pos: hallCount(b.pos, 'best place'), of: hallCount(b.of, 'best of') }
      }
    }
    return {
      season: hallCount(raw.season, 'season'), year: hallCount(raw.year, 'season year'),
      raids: hallCount(raw.raids, 'season raids'), wins: hallCount(raw.wins, 'season wins'), podiums: hallCount(raw.podiums, 'season podiums'),
      contracts: hallCount(raw.contracts, 'season contracts'), rep: finite(raw.rep, 'season rep'), money: finite(raw.money, 'season money'),
      longOne: raw.longOne === true, best,
    }
  } catch {
    return null
  }
}

/**
 * The hall of fame's record (after 1.2). Only for looking back: a line
 * that doesn't add up is dropped, and a record that can't be read at all
 * starts again from the season the career is in, never failing the save.
 */
function readHall(raw: unknown, season: number): { hall?: CareerHall } {
  if (!isObj(raw)) return {}
  try {
    const from = hallCount(raw.from, 'hall start')
    const seasons = arrayOf(raw.seasons, 'hall seasons').map(readSeasonLine).filter((x): x is SeasonLine => x !== null && x.season <= season)
    const rivals: CareerHall['rivals'] = {}
    if (isObj(raw.rivals)) {
      for (const id of TEAM_IDS) {
        const r = raw.rivals[id]
        if (isObj(r)) rivals[id] = { met: hallCount(r.met, 'rival met'), ahead: hallCount(r.ahead, 'rival ahead'), behind: hallCount(r.behind, 'rival behind') } satisfies RivalTally
      }
    }
    const drivers: CareerHall['drivers'] = {}
    if (isObj(raw.drivers)) {
      for (const id of DRIVER_IDS) {
        const d = raw.drivers[id]
        if (isObj(d)) drivers[id] = { raids: hallCount(d.raids, 'driver raids'), wins: hallCount(d.wins, 'driver wins'), podiums: hallCount(d.podiums, 'driver podiums'), first: hallCount(d.first, 'driver first year') } satisfies DriverTally
      }
    }
    const hall: CareerHall = { from: Math.min(from, season), seasons, rivals, drivers }
    if (raw.ended !== undefined) hall.ended = Math.min(hallCount(raw.ended, 'hall end'), season)
    return { hall }
  } catch {
    return {}
  }
}

/** A whole number of at least 0, or 0 if it isn't one. */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

/**
 * The trucks' logbooks (added after 1.2, with no new save format: a save
 * without them gets a fresh log for the truck it has). Only for reading,
 * like the news: a log or moment that doesn't add up is dropped rather than
 * failing the save.
 */
function isMoment(m: unknown): m is TruckMoment {
  if (!isObj(m) || !MOMENT_KINDS.includes(m.kind as TruckMoment['kind'])) return false
  if (typeof m.raid !== 'string' || !Object.hasOwn(RAIDS, m.raid) || typeof m.year !== 'number') return false
  if (m.kind !== 'broke') return true
  return FAILURE_KINDS.includes(m.part as FailureKind) && Number.isInteger(m.corner) && (m.corner as number) >= -1 && (m.corner as number) <= 3
}

function readTrucks(raw: unknown): TruckLog[] {
  if (!Array.isArray(raw)) return []
  const out: TruckLog[] = []
  for (const x of raw) {
    if (!isObj(x) || !CLASS_IDS.includes(x.cls as ClassId)) continue
    const n = count(x.n)
    const bought = count(x.bought)
    if (n < 1 || bought < FIRST_YEAR) continue
    const log = newLog(n, x.cls as ClassId, bought)
    log.sold = typeof x.sold === 'number' && Number.isFinite(x.sold) ? x.sold : null
    for (const k of ['raids', 'finishes', 'wins', 'podiums', 'longOnes', 'retired', 'km', 'stops', 'parts'] as const) log[k] = k === 'km' ? Math.max(0, Number(x.km) || 0) : count(x[k])
    log.best = typeof x.best === 'number' && Number.isInteger(x.best) && x.best >= 1 ? x.best : null
    log.moments = Array.isArray(x.moments)
      ? x.moments.filter(isMoment).slice(0, LOGBOOK.moments)
      : []
    out.push(log)
  }
  return out
}

function readCareer(raw: unknown): CareerState {
  if (!isObj(raw)) fail('career is missing')
  const year = finite(raw.year, 'career year')
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) fail('career year is out of range')
  const season = finite(raw.season, 'career season')
  if (!Number.isInteger(season) || season < 0) fail('career season is out of range')
  const next = finite(raw.next, 'career next raid')
  if (!Number.isInteger(next) || next < 0 || next >= CALENDAR.length) fail('career next raid is out of range')
  const day = finite(raw.day, 'career day')
  if (day < 1 || day > 366) fail('career day is out of range')
  const upgrades = arrayOf(raw.upgrades, 'career upgrades')
  if (upgrades.some((u) => !UPGRADES.some((x) => x.id === u))) fail('career has an unknown upgrade')
  const stats = isObj(raw.stats) ? raw.stats : fail('career stats are missing')
  for (const k of ['raids', 'wins', 'podiums', 'contracts'] as const) finite(stats[k], `career ${k}`)
  const longOne = arrayOf(raw.longOne, 'career Long One wins').map((y) => finite(y, 'career Long One year'))
  // News is only for reading: anything that doesn't look like news is dropped rather than failing the save.
  const news = Array.isArray(raw.news) ? raw.news.filter((n): n is NewsItem => isObj(n) && NEWS_KINDS.includes(n.kind as NewsItem['kind'])) : []
  const career: CareerState = {
    seed: finite(raw.seed, 'career seed') >>> 0,
    season,
    year,
    day,
    next,
    money: finite(raw.money, 'career money'),
    rep: Math.max(0, finite(raw.rep, 'career reputation')),
    own: raw.own === null || raw.own === undefined ? null : readBuild(raw.own),
    upgrades: [...new Set(upgrades as UpgradeId[])],
    job: readJob(raw.job),
    teams: readTeams(raw.teams, year),
    news,
    longOne,
    ...(raw.firstLongOne === undefined ? {} : readStory(raw.firstLongOne)),
    ...readHall(raw.hall, season),
    stats: { raids: stats.raids as number, wins: stats.wins as number, podiums: stats.podiums as number, contracts: stats.contracts as number },
    trucks: readTrucks(raw.trucks),
  }
  // The garage's truck always has a logbook (a save from before logbooks gets a fresh one).
  tidyLogs(career)
  return career
}

/**
 * A format 2 career's next raid, moved onto the six-raid calendar: the same
 * raid if it's still there, otherwise the next one that is. A job already
 * under way at a raid that left the calendar carries on and is settled at
 * that next raid, so nobody loses a truck, a fee or a raid in progress.
 */
function nextOnNewCalendar(oldNext: unknown): unknown {
  if (typeof oldNext !== 'number' || !Number.isInteger(oldNext) || oldNext < 0 || oldNext >= SAVE.calendarV2.length) return oldNext
  for (let k = oldNext; k < SAVE.calendarV2.length; k++) {
    const at = CALENDAR.findIndex((e) => e.raid === SAVE.calendarV2[k])
    if (at >= 0) return at
  }
  return CALENDAR.length - 1
}

/**
 * Move a save made by an older format up one step at a time.
 * - 1 → 2 (plan PR 9): the career arrives; an old garage has none.
 * - 2 → 3 (26 November 2026): six raids a year instead of eight, so the
 *   career's `next` moves onto the new calendar (`nextOnNewCalendar`).
 */
function migrate(input: Record<string, unknown>): Record<string, unknown> {
  let raw = input
  const v = raw.v
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) fail('save has no format number')
  if (v > SAVE.version) throw new SaveFormatError('future', 'save is from a newer Bump Stop')
  if (raw.v === 1) raw = { ...raw, v: 2, career: null }
  if (raw.v === 2) raw = { ...raw, v: 3, career: isObj(raw.career) ? { ...raw.career, next: nextOnNewCalendar(raw.career.next) } : raw.career }
  // The next change: `if (raw.v === 2) raw = { ...raw, v: 3, newThing: ... }`, and so on.
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
  out.career = raw.career === null || raw.career === undefined ? null : readCareer(raw.career)
  // A career's own raid lives in `raid`: without it, there's no raid to come back to.
  if (out.career?.job?.kind === 'own' && !out.raid) out.career.job = null
  return out
}

