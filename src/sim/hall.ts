/**
 * The career's hall of fame (after 1.2): what the garage did, season by
 * season, so the end of the 1985–2025 career can look back on it.
 *
 * The career's news only keeps the last few dozen lines, so it can't tell
 * the whole story. This keeps a small record as the career goes:
 *
 * - **A line per season:** your own raids, wins and podiums, contracts,
 *   reputation and money earned, the best result, and whether the garage
 *   won the Whole Damn Country.
 * - **The rival teams:** how often you met each one, and who finished ahead.
 *   The team that beat you most is your biggest rival.
 * - **The drivers you hired** for your own entries, and how they did.
 *
 * `recap` turns it into the hall of fame the screens show. The favourite
 * truck comes from the truck logbooks, and the photo album lives in the
 * browser's storage (`src/persist/album.ts`), not here.
 *
 * Plain data in `CareerState.hall`, pure and seeded like the rest of the
 * sim: no DOM, no clock.
 */
import type { ClassId } from '../data/classes'
import { HALL, TEAM_IDS, type TeamId } from '../data/career'
import { FIRST_YEAR, LAST_YEAR } from '../data/parts'
import { DRIVER_IDS, type DriverId, type RaidId } from '../data/raids'
import type { CareerState, CareerStats } from './career'

/** One season of the garage. */
export interface SeasonLine {
  /** Seasons since the garage opened, from 0. */
  season: number
  year: number
  /** Your own raids, and how they went. */
  raids: number
  wins: number
  podiums: number
  /** Privateers' trucks prepped. */
  contracts: number
  /** Reputation earned and money made (prizes and fees less repairs) over the season. */
  rep: number
  money: number
  /** Won the Whole Damn Country this season. */
  longOne: boolean
  /** The best finish of the season (your own truck first, then a contract truck). */
  best: { raid: RaidId; cls: ClassId; job: 'own' | 'contract'; pos: number; of: number } | null
}

/** You against one rival team, counted at every raid one of your trucks met them. */
export interface RivalTally {
  met: number
  /** They finished ahead of your truck (or your truck retired and they didn't). */
  ahead: number
  /** Your truck finished ahead of all of theirs. */
  behind: number
}

/** A driver you hired for your own entries. */
export interface DriverTally {
  raids: number
  wins: number
  podiums: number
  /** The year they first drove for you. */
  first: number
}

export interface CareerHall {
  /** The season the record starts: 0, or later for a career saved before the hall of fame existed. */
  from: number
  /** Oldest first. The last line is the season under way. */
  seasons: SeasonLine[]
  rivals: Partial<Record<TeamId, RivalTally>>
  drivers: Partial<Record<DriverId, DriverTally>>
  /** The season that finished 2025 and ended the career, once it has. The career carries on after. */
  ended?: number
}

export function newHall(from = 0): CareerHall {
  return { from, seasons: [], rivals: {}, drivers: {} }
}

/** The career's hall record, started now if it hasn't one (older saves). */
export function hallOf(c: CareerState): CareerHall {
  c.hall ??= newHall(c.season)
  return c.hall
}

/** This season's line, started if it's the first raid of the season. */
function seasonLine(c: CareerState): SeasonLine {
  const hall = hallOf(c)
  let line = hall.seasons[hall.seasons.length - 1]
  if (!line || line.season !== c.season) {
    line = { season: c.season, year: c.year, raids: 0, wins: 0, podiums: 0, contracts: 0, rep: 0, money: 0, longOne: false, best: null }
    hall.seasons.push(line)
  }
  return line
}

/** What a settled raid adds to the hall. */
export interface HallResult {
  raid: RaidId
  cls: ClassId
  job: 'own' | 'contract'
  /** Place in class, or null if the truck retired. */
  pos: number | null
  of: number
  money: number
  rep: number
  wonLongOne: boolean
  /** Your driver (own entries). */
  driver?: DriverId
  /** The class table at the end, best first (`who` is 'you' or a rival's id). */
  table: readonly { who: string }[]
}

/** The garage sat a raid out: the season still gets its line. */
export function recordSkip(c: CareerState): void {
  seasonLine(c)
}

/** Add a finished raid (your own or a contract) to the season, the rivals and the drivers. */
export function recordResult(c: CareerState, r: HallResult): void {
  const hall = hallOf(c)
  const line = seasonLine(c)
  if (r.job === 'own') {
    line.raids++
    if (r.pos === 1) line.wins++
    if (r.pos !== null && r.pos <= 3) line.podiums++
  } else line.contracts++
  line.rep += r.rep
  line.money += r.money
  if (r.wonLongOne) line.longOne = true
  if (r.pos !== null && betterThan(r, line.best)) line.best = { raid: r.raid, cls: r.cls, job: r.job, pos: r.pos, of: r.of }

  // The rival teams: their best truck in the class against yours.
  const mine = r.pos === null ? Infinity : r.table.findIndex((x) => x.who === 'you')
  for (const team of TEAM_IDS) {
    const theirs = r.table.findIndex((x) => x.who.startsWith(team))
    if (theirs < 0) continue
    const tally = (hall.rivals[team] ??= { met: 0, ahead: 0, behind: 0 })
    tally.met++
    if (theirs < mine) tally.ahead++
    else tally.behind++
  }

  if (r.job === 'own' && r.driver) {
    const d = (hall.drivers[r.driver] ??= { raids: 0, wins: 0, podiums: 0, first: c.year })
    d.raids++
    if (r.pos === 1) d.wins++
    if (r.pos !== null && r.pos <= 3) d.podiums++
  }
}

/** Is this result the season's best so far? Lower place wins; your own truck beats a contract on the same place. */
function betterThan(r: HallResult, best: SeasonLine['best']): boolean {
  if (r.pos === null) return false
  if (!best) return true
  if (r.pos !== best.pos) return r.pos < best.pos
  return r.job === 'own' && best.job === 'contract'
}

/** The career has just finished its last season of 2025: mark the end once. True the first time. */
export function markEnd(c: CareerState): boolean {
  const hall = hallOf(c)
  if (hall.ended !== undefined) return false
  hall.ended = c.season
  return true
}

// ── The recap ──

export interface HallRecap {
  /** The career has reached the end of 2025 (otherwise this is the career so far). */
  ended: boolean
  firstYear: number
  /** The year of the last season counted. */
  lastYear: number
  /** Seasons played (the one under way counts once anything has happened in it). */
  seasons: number
  stats: CareerStats
  longOne: readonly number[]
  /** The best seasons, best first. */
  best: SeasonLine[]
  /** The team that beat you most (null until you've met one). */
  rival: { team: TeamId; tally: RivalTally } | null
  /** Drivers you hired, most raids first. */
  drivers: { id: DriverId; tally: DriverTally }[]
  /** The record starts after the first season (a career saved before the hall of fame). */
  partial: boolean
  fromYear: number
}

/** How a season ranks: a Whole Damn Country win first, then wins, podiums and reputation; earlier years win ties. */
function seasonRank(a: SeasonLine, b: SeasonLine): number {
  return Number(b.longOne) - Number(a.longOne) || b.wins - a.wins || b.podiums - a.podiums || b.rep - a.rep || a.year - b.year || a.season - b.season
}

export function recap(c: CareerState): HallRecap {
  const hall = c.hall ?? newHall(c.season)
  const played = hall.seasons.filter((s) => s.raids + s.contracts > 0)
  const best = [...played].sort(seasonRank).slice(0, HALL.bestSeasons)

  let rival: HallRecap['rival'] = null
  for (const team of TEAM_IDS) {
    const tally = hall.rivals[team]
    if (!tally || tally.met === 0) continue
    if (!rival || tally.ahead > rival.tally.ahead || (tally.ahead === rival.tally.ahead && tally.met > rival.tally.met)) rival = { team, tally }
  }

  const drivers = DRIVER_IDS
    .map((id) => ({ id, tally: hall.drivers[id] }))
    .filter((d): d is { id: DriverId; tally: DriverTally } => !!d.tally && d.tally.raids > 0)
    .sort((a, b) => b.tally.raids - a.tally.raids || b.tally.wins - a.tally.wins || a.tally.first - b.tally.first)

  const ended = hall.ended !== undefined
  const lastLine = hall.seasons[hall.seasons.length - 1]
  // A season counts once something happened in it; at the very start, nothing has.
  const seasons = ended ? hall.ended! + 1 : lastLine && lastLine.season === c.season ? c.season + 1 : c.season
  const firstSeason = hall.seasons[0]
  return {
    ended,
    firstYear: FIRST_YEAR,
    lastYear: ended ? yearOfSeason(hall.ended!) : lastLine?.year ?? c.year,
    seasons,
    stats: { ...c.stats },
    longOne: [...c.longOne],
    best,
    rival,
    drivers,
    partial: hall.from > 0,
    fromYear: firstSeason?.year ?? yearOfSeason(hall.from),
  }
}

/** A season's year: the seasons keep counting after 2025, the year doesn't. */
function yearOfSeason(season: number): number {
  return Math.min(LAST_YEAR, FIRST_YEAR + season)
}
