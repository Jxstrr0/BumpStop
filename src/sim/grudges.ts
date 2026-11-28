/**
 * Rival drivers with grudges (Kelbo picked it, 28 November 2026). The rules
 * and numbers are in `src/data/grudges.ts`; this file does the sums.
 *
 * - **Names:** each rival team's truck in each class has a driver from the
 *   driver pool, from the names this career didn't hire (`rivalDrivers`).
 * - **Heat:** `CareerState.grudges` keeps each driver's heat against you, by
 *   their entry id (`brannigan7`). It rises when you beat them or rub doors
 *   with them, falls when they beat you, when you don't meet, and each new
 *   year. The heat sets a level: Sore, Grudge, Feud.
 * - **Driving angry:** a rival carries its heat in `Rival.grudge`, and
 *   `pushHarder` turns it into a quicker pace and more trouble wherever the
 *   rivals are worked out (raid stages and one-day rounds alike).
 * - **Door rubs** happen when your truck catches one that started ahead of
 *   it on a stage (`dustBumps`). The heat counts from the next stage of the
 *   same raid.
 *
 * Pure and seeded: no DOM, no clock. Only type imports from the raid and the
 * career, so the rivals' sums can use it without going round in a circle.
 */
import { TEAM_TUNING, TEAMS, type TeamId } from '../data/career'
import { GRUDGE, RIVAL_TRADES, type GrudgeLevel } from '../data/grudges'
import { DRIVERS, PACES, type DriverId, type PaceId, type Rival } from '../data/raids'
import type { StringKey } from '../data/strings'
import type { CareerState } from './career'
import type { RaidState } from './raid'
import { hashString, Rng } from './rng'

// ── Names ──

/**
 * The driver a career hires for a trade: each career draws its own from the
 * trade's pool, so replays meet new faces. No career (free play) has the first.
 */
export function hiredName(seed: number | null, id: DriverId): StringKey {
  const pool = DRIVERS[id].pool
  return seed !== null ? pool[hashString(`${seed}:driver:${id}`) % pool.length]! : pool[0]!
}

const namesBySeed = new Map<number, Readonly<Record<string, StringKey>>>()

/**
 * Every rival team's driver in every class it races, by entry id
 * (`brannigan7`): the trade in `RIVAL_TRADES`, a name from that trade's pool
 * that this career didn't hire and no other team took. The same every time
 * for the same career.
 */
export function rivalDrivers(seed: number): Readonly<Record<string, StringKey>> {
  const known = namesBySeed.get(seed)
  if (known) return known
  const out: Record<string, StringKey> = {}
  const taken = new Set<StringKey>()
  for (const team of Object.values(TEAMS)) {
    for (const c of team.classes) {
      const trade = RIVAL_TRADES[team.id][c.cls]
      if (!trade) continue
      const left = DRIVERS[trade].pool.filter((n) => n !== hiredName(seed, trade) && !taken.has(n))
      const id = `${team.id}${c.number}`
      const name = left[hashString(`${seed}:rival:${id}`) % Math.max(1, left.length)]
      if (!name) continue
      out[id] = name
      taken.add(name)
    }
  }
  namesBySeed.set(seed, out)
  return out
}

/** A rival entry's driver in this career, or null (privateers, and anyone unknown). */
export function rivalDriver(seed: number, who: string): StringKey | null {
  return rivalDrivers(seed)[who] ?? null
}

/** The team behind an entry id, if it's a team. */
export function teamOfEntry(who: string): TeamId | null {
  for (const id of Object.keys(TEAMS) as TeamId[]) if (who.startsWith(id)) return id
  return null
}

// ── Heat and levels ──

export function grudgeLevel(heat: number): GrudgeLevel {
  const [sore, grudge, feud] = GRUDGE.levels
  return heat >= feud ? 3 : heat >= grudge ? 2 : heat >= sore ? 1 : 0
}

/** A rival as they drive with their grudge: quicker, and harder on the truck. No grudge, no change. */
export function pushHarder(r: Rival): Rival {
  const level = grudgeLevel(r.grudge ?? 0)
  if (!level) return r
  const [fastest] = TEAM_TUNING.paceLimits
  const [, riskiest] = TEAM_TUNING.riskLimits
  return {
    ...r,
    pace: Math.max(Math.min(fastest, r.pace), r.pace * (1 - GRUDGE.pace[level])),
    risk: Math.min(Math.max(riskiest, r.risk), r.risk * (1 + GRUDGE.risk[level])),
  }
}

/** A career field with each team driver's name and heat against you on it. */
export function withGrudges(c: CareerState, field: readonly Rival[]): Rival[] {
  const names = rivalDrivers(c.seed)
  return field.map((r) => {
    const driver = names[r.id]
    if (!driver) return r
    const heat = c.grudges?.[r.id] ?? 0
    return { ...r, driver, ...(heat > 0 ? { grudge: heat } : {}) }
  })
}

// ── Door rubs on a stage ──

/** The hardest pace called on a stage. */
function hardest(paces: readonly PaceId[]): PaceId {
  let k = 0
  for (const p of paces) k = Math.max(k, PACES.indexOf(p))
  return PACES[k] ?? 'steady'
}

/**
 * The named rivals your truck caught and rubbed doors with on stage `k` of a
 * career raid. The start order is the overall standings after the stage
 * before (the leader goes first); on the first stage you start behind the
 * field, as the newest entry. Starters go `GRUDGE.startGap` apart, so you
 * caught a truck if you made up the gap to it. A truck stopped with trouble
 * (or out late) is just passed. Whether it ends in a door rub is a seeded
 * chance, higher on Push.
 */
export function dustBumps(state: RaidState, k: number): string[] {
  const rec = state.results[k]
  const field = state.entry.field
  if (!rec || rec.late || !field) return []
  let order: string[]
  if (k === 0) order = [...rec.rivals.map((r) => r.id), 'you']
  else {
    const sums = new Map<string, number>([['you', 0]])
    for (const prev of state.results.slice(0, k)) {
      sums.set('you', (sums.get('you') as number) + prev.time)
      for (const r of prev.rivals) sums.set(r.id, (sums.get(r.id) ?? 0) + r.time)
    }
    order = [...sums].sort((a, b) => a[1] - b[1]).map(([who]) => who)
  }
  const youAt = order.indexOf('you')
  const chance = GRUDGE.bumpChance[hardest(rec.paces)]
  const seed = state.entry.seed ?? 0
  const out: string[] = []
  for (let j = 0; j < youAt; j++) {
    const id = order[j]!
    const r = rec.rivals.find((x) => x.id === id)
    if (!r || r.trouble || r.late || !field.some((x) => x.id === id && x.driver)) continue
    const caught = (youAt - j) * GRUDGE.startGap + rec.time < r.time
    if (caught && new Rng(hashString(`${seed}:${k}:${id}:dust`)).chance(chance)) out.push(id)
  }
  return out
}

/** Everyone you rubbed doors with in this raid, on the stages before `upTo` (all of them by default). */
export function raidBumps(state: RaidState, upTo = state.results.length): Set<string> {
  const out = new Set<string>()
  for (let k = 0; k < Math.min(upTo, state.results.length); k++) for (const id of dustBumps(state, k)) out.add(id)
  return out
}

/** The field as it drives the next stage: anyone you rubbed doors with earlier in the raid is hotter. */
export function raidGrudges(state: RaidState, field: readonly Rival[]): Rival[] {
  const bumped = raidBumps(state)
  if (!bumped.size) return field.slice()
  return field.map((r) => (bumped.has(r.id) ? { ...r, grudge: Math.min(GRUDGE.max, (r.grudge ?? 0) + GRUDGE.bump) } : r))
}

// ── After a raid or a round ──

/** Why a grudge changed: the biggest reason. */
export type GrudgeWhy = 'bump' | 'tookWin' | 'beat' | 'settled'

/** A driver whose grudge moved to a new level, for the results card and the news. */
export interface GrudgeNote {
  who: string
  driver: StringKey
  from: GrudgeLevel
  to: GrudgeLevel
  why: GrudgeWhy
}

/**
 * You met these rivals at a raid or a round: each named driver's heat moves
 * with the result. `table` is the classified finishers, best first, with
 * `'you'` in it unless you weren't classified (retired, or no score).
 * Returns the drivers whose level changed.
 */
export function meetRivals(c: CareerState, table: readonly { who: string }[], field: readonly Rival[], bumped: ReadonlySet<string> = new Set()): GrudgeNote[] {
  const heat = (c.grudges ??= {})
  const place = (who: string) => {
    const k = table.findIndex((r) => r.who === who)
    return k < 0 ? Infinity : k
  }
  const you = place('you')
  const notes: GrudgeNote[] = []
  const names = rivalDrivers(c.seed)
  for (const r of field) {
    const driver = names[r.id]
    if (!driver) continue
    const before = heat[r.id] ?? 0
    const them = place(r.id)
    const bump = bumped.has(r.id)
    const beat = you < them
    const tookWin = beat && you === 0 && them === 1
    const lost = them < you
    let after = before + (bump ? GRUDGE.bump : 0) + (beat ? GRUDGE.beat : 0) + (tookWin ? GRUDGE.tookWin : 0) - (lost ? GRUDGE.settled : 0)
    after = Math.max(0, Math.min(GRUDGE.max, after))
    if (after > 0) heat[r.id] = after
    else delete heat[r.id]
    const from = grudgeLevel(before)
    const to = grudgeLevel(after)
    if (from === to) continue
    const why: GrudgeWhy = to < from ? 'settled' : bump ? 'bump' : tookWin ? 'tookWin' : 'beat'
    notes.push({ who: r.id, driver, from, to, why })
  }
  return notes
}

/** A raid where these drivers didn't meet you: everyone else's grudge cools a little. */
export function coolGrudges(c: CareerState, met: ReadonlySet<string> = new Set()): void {
  if (!c.grudges) return
  for (const [id, h] of Object.entries(c.grudges)) {
    if (met.has(id)) continue
    const after = h - GRUDGE.cool
    if (after > 0) c.grudges[id] = after
    else delete c.grudges[id]
  }
}

/** A new year: every grudge halves. */
export function newYearGrudges(c: CareerState): void {
  if (!c.grudges) return
  for (const [id, h] of Object.entries(c.grudges)) {
    const after = Math.floor(h * GRUDGE.newYear)
    if (after > 0) c.grudges[id] = after
    else delete c.grudges[id]
  }
}

/** The drivers who hold a grudge against you now, hottest first. */
export function grudgesNow(c: CareerState): { who: string; driver: StringKey; heat: number; level: GrudgeLevel }[] {
  const names = rivalDrivers(c.seed)
  return Object.entries(c.grudges ?? {})
    .filter(([id, h]) => names[id] && h > 0)
    .map(([who, heat]) => ({ who, driver: names[who]!, heat, level: grudgeLevel(heat) }))
    .sort((a, b) => b.heat - a.heat || a.who.localeCompare(b.who))
}
