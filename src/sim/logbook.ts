/**
 * The garage logbook: each truck the garage owns builds up a history.
 *
 * - **What's kept:** raids entered and finished, wins, podiums, Long Ones,
 *   raids it didn't finish, its best place, the raid kilometres driven,
 *   roadside stops, and how many parts were swapped on it.
 * - **Moments:** after each raid, up to two lines worth telling: how it
 *   went (a win, a podium, its first raid, or a raid it didn't finish) and
 *   its worst stop of the raid ("Snapped the rear left axle at Frozen
 *   Knuckle '91"). Newest first, the oldest dropping off (`LOGBOOK.moments`).
 * - **Old trucks:** a sold truck keeps its logbook, with the year it was
 *   sold, so the garage remembers it.
 *
 * Logs live in `CareerState.trucks`, oldest truck first. The garage's
 * truck now (`CareerState.own`) is the last log that isn't sold. Only the
 * garage's own trucks have logs: contract trucks belong to the privateers.
 *
 * Pure: no DOM, no clock. Called from `career.ts` (buying, selling, fitting
 * parts, settling a raid).
 */
import type { ClassId } from '../data/classes'
import type { TruckBuild } from '../data/kit'
import { LOGBOOK } from '../data/logbook'
import { SLOTS } from '../data/parts'
import { RAIDS, type RaidId } from '../data/raids'
import type { FailureKind } from '../data/wear'
import { stageKm, type RaidState, type Stop } from './raid'

/** A line worth telling in a truck's logbook. The screens turn it into words. */
export type TruckMoment =
  | { kind: 'win' | 'podium' | 'longOne' | 'firstRaid'; year: number; raid: RaidId; pos: number | null }
  | { kind: 'retired'; year: number; raid: RaidId }
  /** A breakdown: what broke and where (corner 0 to 3, or -1 for the frame). */
  | { kind: 'broke'; year: number; raid: RaidId; part: FailureKind; corner: number }
  /** Slid into a snowbank, or the ice cracked under it and it took the shore track. */
  | { kind: 'slide' | 'ice'; year: number; raid: RaidId }

export const MOMENT_KINDS: readonly TruckMoment['kind'][] = ['win', 'podium', 'longOne', 'firstRaid', 'retired', 'broke', 'slide', 'ice']

export interface TruckLog {
  /** The garage's truck number: 1 for its first truck, 2 for the next, and so on. */
  n: number
  cls: ClassId
  /** The year the garage bought it, and the year it was sold (null while it's still the garage's). */
  bought: number
  sold: number | null
  /** Raids entered, finished (classified), won, on the podium, Long Ones won, and not finished. */
  raids: number
  finishes: number
  wins: number
  podiums: number
  longOnes: number
  retired: number
  /** Best place in class, or null before its first finish. */
  best: number | null
  /** Raid kilometres driven (stages done; free practice and rigs don't count). */
  km: number
  /** Roadside stops: breakdowns, slides and cracking ice. */
  stops: number
  /** Parts swapped on it since it was bought. */
  parts: number
  /** Newest first, at most `LOGBOOK.moments`. */
  moments: TruckMoment[]
}

/** Just what a logbook needs from the career, so this file doesn't import `career.ts` (which imports it). */
interface HasTrucks {
  year: number
  own: TruckBuild | null
  trucks: TruckLog[]
}

export function newLog(n: number, cls: ClassId, year: number): TruckLog {
  return {
    n, cls, bought: year, sold: null,
    raids: 0, finishes: 0, wins: 0, podiums: 0, longOnes: 0, retired: 0, best: null,
    km: 0, stops: 0, parts: 0, moments: [],
  }
}

/** The logbook of the garage's truck now, or null with no truck. */
export function ownLog(c: HasTrucks): TruckLog | null {
  if (!c.own) return null
  for (let k = c.trucks.length - 1; k >= 0; k--) {
    const log = c.trucks[k]!
    if (log.sold === null && log.cls === c.own.cls) return log
  }
  return null
}

/** The trucks the garage sold, newest first. */
export function oldTrucks(c: HasTrucks): TruckLog[] {
  return c.trucks.filter((x) => x.sold !== null).reverse()
}

/**
 * Make the logbooks match the truck the garage has: a truck with no log gets
 * a fresh one (an older save, say), and any log left open with no truck is
 * closed this year. Safe to call any time.
 */
export function tidyLogs(c: HasTrucks): void {
  const mine = ownLog(c)
  for (const log of c.trucks) if (log.sold === null && log !== mine) log.sold = c.year
  if (c.own && !mine) c.trucks.push(newLog(nextNumber(c), c.own.cls, c.year))
  // Keep the newest old trucks only, and always the one in the garage.
  const old = c.trucks.filter((x) => x.sold !== null)
  if (old.length > LOGBOOK.oldTrucks) {
    const drop = new Set(old.slice(0, old.length - LOGBOOK.oldTrucks))
    c.trucks = c.trucks.filter((x) => !drop.has(x))
  }
}

function nextNumber(c: HasTrucks): number {
  return c.trucks.reduce((n, x) => Math.max(n, x.n), 0) + 1
}

/** A new truck came into the garage. */
export function logBought(c: HasTrucks): void {
  tidyLogs(c)
}

/** The garage's truck was sold: its logbook is closed, and stays on the wall. */
export function logSold(c: HasTrucks): void {
  const log = ownLog(c)
  if (log) log.sold = c.year
}

/** Parts were swapped on the garage's truck (`from` before, `to` after). */
export function logParts(c: HasTrucks, from: TruckBuild, to: TruckBuild): void {
  const log = ownLog(c)
  if (log) log.parts += SLOTS.filter((s) => from.parts[s] !== to.parts[s]).length
}

function addMoment(log: TruckLog, m: TruckMoment): void {
  log.moments.unshift(m)
  if (log.moments.length > LOGBOOK.moments) log.moments.length = LOGBOOK.moments
}

/** The stop that cost the most time, or null with none. */
function worstStop(state: RaidState): Stop | null {
  let worst: Stop | null = null
  for (const r of state.results) for (const s of r.stops) if (!worst || s.lost > worst.lost) worst = s
  return worst
}

/**
 * The garage's truck is back from a raid (its own entry, not a contract).
 * @param pos place in class, or null if it wasn't classified.
 * @param retired true if it was retired before the end.
 * @param longOne true if this was the Long One.
 */
export function logRaid(c: HasTrucks, state: RaidState, pos: number | null, retired: boolean, longOne: boolean): void {
  const log = ownLog(c)
  if (!log) return
  const raid = state.entry.raid
  const stages = RAIDS[raid].stages
  log.raids++
  log.km += state.results.reduce((sum, _r, k) => sum + (stages[k] ? stageKm(stages[k]) : 0), 0)
  log.stops += state.results.reduce((sum, r) => sum + r.stops.length, 0)
  if (pos !== null) {
    log.finishes++
    log.best = log.best === null ? pos : Math.min(log.best, pos)
    if (pos === 1) log.wins++
    if (pos <= 3) log.podiums++
    if (pos === 1 && longOne) log.longOnes++
  }
  if (retired) log.retired++

  // The worst stop first, so the result ends up on top (moments are newest first).
  const stop = worstStop(state)
  if (stop) {
    const year = c.year
    if (stop.kind === 'ice' || stop.kind === 'slide') addMoment(log, { kind: stop.kind, year, raid })
    else addMoment(log, { kind: 'broke', year, raid, part: stop.kind, corner: stop.corner })
  }
  const year = c.year
  if (retired) addMoment(log, { kind: 'retired', year, raid })
  else if (pos === 1 && longOne) addMoment(log, { kind: 'longOne', year, raid, pos })
  else if (pos === 1) addMoment(log, { kind: 'win', year, raid, pos })
  else if (pos !== null && pos <= 3) addMoment(log, { kind: 'podium', year, raid, pos })
  else if (log.raids === 1) addMoment(log, { kind: 'firstRaid', year, raid, pos })
}

/**
 * The garage's favourite truck: the one with the most raids, then the most
 * wins, then the most kilometres; the older truck on a tie. Null with no
 * trucks that raced. For the career's recap.
 */
export function favouriteTruck(c: { trucks: readonly TruckLog[] }): TruckLog | null {
  let best: TruckLog | null = null
  for (const log of c.trucks) {
    if (log.raids === 0) continue
    if (!best || log.raids > best.raids || (log.raids === best.raids && (log.wins > best.wins || (log.wins === best.wins && log.km > best.km)))) best = log
  }
  return best
}
