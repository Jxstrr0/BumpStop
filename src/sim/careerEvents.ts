/**
 * One-day events in the career (after 1.33): each event is a small series of
 * three rounds a year (`ROUNDS`), held in the summer gaps between the raids.
 *
 * - **Entering** takes your own truck (as it is on the bench, same parts),
 *   an entry fee and, on a timed event, a day's fee for the driver. The
 *   career's day moves to the round's day: rounds before it are passed.
 *   Only between raids, with no job taken for the next one.
 * - **The runs** are driven on the Raid tab's One-day events panel, exactly
 *   as in free play; each run's score is kept here as it ends, so a reload
 *   carries on where it was.
 * - **After the last run:** prize money by place, a little reputation, the
 *   repair bill for anything that broke, and series points (10, 6, 4, 3, 2, 1).
 * - **Rounds you don't enter** still happen: the rivals in every class run
 *   them and score their points.
 * - **At the end of the year** each series has a champion. Win one in your
 *   class and it pays a bonus and some reputation.
 *
 * Plain data in `CareerState.events`, kept in the garage save; a save from
 * before has none, and a fresh series starts. Pure and seeded.
 */
import { CLASS_MONEY, CAREER, DRIVER_TERMS, TIERS } from '../data/career'
import { CLASSES, type ClassId } from '../data/classes'
import { CONTESTS, EVENT_CAREER, ROUNDS, type ContestId } from '../data/contests'
import type { TruckBuild } from '../data/kit'
import { SLOTS } from '../data/parts'
import type { DriverId } from '../data/raids'
import { checkBuild, type BuildProblem } from './build'
import { addNews, isBroke, nextEvent, repairShare, type CareerState } from './career'
import { contestStandings, rivalRuns, type ContestStanding, type RivalRuns } from './contest'
import { careerField } from './teams'

/** Your entry in a round, while its runs are being driven. */
export interface EventEntry {
  /** The round: its place in `ROUNDS`. */
  round: number
  cls: ClassId
  driver: DriverId
  /** Each run's score so far (null for a run that broke or didn't score). */
  scores: (number | null)[]
  /** Runs that ended with something broken: each is a repair. */
  breaks: number
  /** What was paid at entry. */
  paid: number
}

/** This year's series: who has how many points, and how far through the rounds the year is. */
export interface EventSeason {
  season: number
  /** Rounds settled so far this year (a place in `ROUNDS`). */
  done: number
  /** Points by event, then class, then entrant (`you` is the garage). */
  points: Partial<Record<ContestId, Partial<Record<ClassId, Record<string, number>>>>>
  /** Your entry being run, if any. */
  live?: EventEntry
}

/** The year's series, started fresh at a new year (or in a save from before the events). */
export function eventSeason(c: CareerState): EventSeason {
  if (!c.events || c.events.season !== c.season) c.events = { season: c.season, done: 0, points: {} }
  return c.events
}

/** Which round of its event's series a round is: 1, 2 or 3. */
export function roundNo(i: number): number {
  const id = ROUNDS[i]!.contest
  return ROUNDS.slice(0, i + 1).filter((r) => r.contest === id).length
}

/** How many rounds an event's series has a year. */
export function roundsOf(id: ContestId): number {
  return ROUNDS.filter((r) => r.contest === id).length
}

/** The rivals at a round in a class: the regional raids' field. */
export function eventField(c: CareerState, cls: ClassId) {
  return careerField(c.teams, cls, 'regional', c.year)
}

/** The rivals' runs at a round: the same every time for the same career, year and round. */
export function roundRivals(c: CareerState, i: number, cls: ClassId): RivalRuns[] {
  return rivalRuns(CONTESTS[ROUNDS[i]!.contest], cls, eventField(c, cls), `:${c.seed}:${c.season}:${i}`)
}

/** The rounds still to come before the next raid (places in `ROUNDS`). */
export function roundsBeforeRaid(c: CareerState): number[] {
  const s = eventSeason(c)
  const raidDay = nextEvent(c).day
  const out: number[] = []
  ROUNDS.forEach((r, i) => {
    if (i >= s.done && r.day >= c.day && r.day < raidDay) out.push(i)
  })
  return out
}

export function eventEntryFee(cls: ClassId): number {
  return EVENT_CAREER.entryFee * CLASS_MONEY[cls]
}

/** The driver's fee for the day: only a timed event has a driver to pay. */
export function eventDriverFee(id: ContestId, driver: DriverId, cls: ClassId): number {
  if (CONTESTS[id].kind !== 'timed') return 0
  return DRIVER_TERMS[driver].fee * TIERS.regional.driverFee * EVENT_CAREER.driverShare * CLASS_MONEY[cls]
}

export type EventProblem =
  | { kind: 'busy' }
  | { kind: 'gone' }
  | { kind: 'noTruck' }
  | { kind: 'broke' }
  | { kind: 'driverRep'; need: number }
  | { kind: 'money'; need: number }
  | { kind: 'parts' }
  | { kind: 'build'; problems: BuildProblem[] }

/** The truck on the bench must be your own truck's parts (unpaid changes get bought first); its settings may differ. */
export function benchMatches(c: CareerState, bench: TruckBuild): boolean {
  const own = c.own
  return own !== null && bench.cls === own.cls && SLOTS.every((s) => bench.parts[s] === own.parts[s])
}

/** What keeps you from entering a round. */
export function eventProblems(c: CareerState, i: number, driver: DriverId, bench?: TruckBuild): EventProblem[] {
  const out: EventProblem[] = []
  const s = eventSeason(c)
  if (c.job || s.live) out.push({ kind: 'busy' })
  if (!roundsBeforeRaid(c).includes(i)) out.push({ kind: 'gone' })
  if (!c.own) return [...out, { kind: 'noTruck' }]
  if (isBroke(c)) out.push({ kind: 'broke' })
  const id = ROUNDS[i]!.contest
  if (CONTESTS[id].kind === 'timed' && c.rep < DRIVER_TERMS[driver].rep) out.push({ kind: 'driverRep', need: DRIVER_TERMS[driver].rep })
  const cls = c.own.cls
  const cost = eventEntryFee(cls) + eventDriverFee(id, driver, cls)
  if (cost > c.money && !isBroke(c)) out.push({ kind: 'money', need: cost })
  if (bench && !benchMatches(c, bench)) out.push({ kind: 'parts' })
  const problems = checkBuild(c.own, { year: c.year, budget: Infinity }).filter((p) => p.kind !== 'overBudget')
  if (problems.length) out.push({ kind: 'build', problems })
  return out
}

/** Enter a round: pays the fees and moves the day to it (the rounds before it are passed). */
export function enterEvent(c: CareerState, i: number, driver: DriverId, bench?: TruckBuild): EventEntry {
  const problems = eventProblems(c, i, driver, bench)
  if (problems.length) throw new Error(`Can't enter: ${problems.map((p) => p.kind).join(', ')}`)
  const r = ROUNDS[i]!
  passRounds(c, r.day)
  const cls = c.own!.cls
  const paid = eventEntryFee(cls) + eventDriverFee(r.contest, driver, cls)
  c.money -= paid
  c.day = r.day
  const entry: EventEntry = { round: i, cls, driver, scores: [], breaks: 0, paid }
  eventSeason(c).live = entry
  return entry
}

/** A run has ended: keep its score. */
export function addEventRun(c: CareerState, score: number | null, broke: boolean): void {
  const live = c.events?.live
  if (!live) throw new Error('No event under way')
  if (live.scores.length >= CONTESTS[ROUNDS[live.round]!.contest].runs) throw new Error('All the runs are done')
  live.scores.push(score)
  if (broke) live.breaks++
}

/** The round's results for you, when it's over. */
export interface EventSettlement {
  contest: ContestId
  /** Which round of the series (1 to 3), and how many it has. */
  round: number
  rounds: number
  cls: ClassId
  /** Your place, or null if no run scored. */
  pos: number | null
  of: number
  prize: number
  /** Paid at entry. */
  paid: number
  repairs: number
  /** All told: prize less the entry and the repairs. */
  money: number
  rep: number
  points: number
  table: ContestStanding[]
  rivals: RivalRuns[]
}

/** Adds a round's series points to a class's table. */
function award(s: EventSeason, id: ContestId, cls: ClassId, table: readonly ContestStanding[]): void {
  const byEvent = (s.points[id] ??= {})
  const pts = (byEvent[cls] ??= {})
  table.forEach((row, k) => {
    const p = row.best === null ? 0 : (EVENT_CAREER.points[k] ?? 0)
    pts[row.who] = (pts[row.who] ?? 0) + p
  })
}

/** The rivals' results at a round in a class you didn't enter it in. */
function rivalsOnlyRound(c: CareerState, i: number, cls: ClassId): ContestStanding[] {
  const contest = CONTESTS[ROUNDS[i]!.contest]
  return contestStandings(contest.kind, [], roundRivals(c, i, cls), contest.runs).filter((r) => r.who !== 'you')
}

/** Your entry's runs are all done (or you left): pay out, score the series, and move on a day. */
export function settleEvent(c: CareerState): EventSettlement {
  const s = eventSeason(c)
  const live = s.live
  if (!live) throw new Error('No event under way')
  const i = live.round
  const id = ROUNDS[i]!.contest
  const contest = CONTESTS[id]
  const rivals = roundRivals(c, i, live.cls)
  const table = contestStandings(contest.kind, live.scores.map((score) => ({ score })), rivals, contest.runs)
  const k = table.findIndex((r) => r.who === 'you')
  const pos = table[k]!.best === null ? null : k + 1
  const prize = pos !== null ? (EVENT_CAREER.prizes[pos - 1] ?? 0) * CLASS_MONEY[live.cls] : 0
  const repairs = live.breaks * EVENT_CAREER.breakRepair * CLASS_MONEY[live.cls] * (repairShare(c) / CAREER.repairShare)
  const rep = pos === 1 ? EVENT_CAREER.rep.win : pos !== null && pos <= 3 ? EVENT_CAREER.rep.podium : 0
  const points = pos !== null ? (EVENT_CAREER.points[pos - 1] ?? 0) : 0
  c.money += prize - repairs
  c.rep += rep
  award(s, id, live.cls, table)
  for (const cls of CLASSES.map((x) => x.id)) {
    if (cls !== live.cls) award(s, id, cls, rivalsOnlyRound(c, i, cls))
  }
  s.done = i + 1
  delete s.live
  c.day = ROUNDS[i]!.day + 1
  const out: EventSettlement = {
    contest: id, round: roundNo(i), rounds: roundsOf(id), cls: live.cls, pos, of: table.length,
    prize, paid: live.paid, repairs, money: prize - live.paid - repairs, rep, points, table, rivals,
  }
  addNews(c, { kind: 'event', year: c.year, contest: id, round: out.round, cls: live.cls, pos, of: out.of, money: out.money, rep })
  return out
}

/**
 * Time has moved on to `day`: every round before it that you didn't enter is
 * run by the rivals alone (an entry still open is settled as it stands).
 */
export function passRounds(c: CareerState, day: number): void {
  const s = eventSeason(c)
  if (s.live && ROUNDS[s.live.round]!.day < day) settleEvent(c)
  while (s.done < ROUNDS.length && ROUNDS[s.done]!.day < day) {
    const i = s.done
    for (const cls of CLASSES.map((x) => x.id)) award(s, ROUNDS[i]!.contest, cls, rivalsOnlyRound(c, i, cls))
    s.done++
  }
}

/** A series' table in a class, most points first (you first on a tie). */
export function seriesTable(c: CareerState, id: ContestId, cls: ClassId): { who: string; points: number }[] {
  const pts = eventSeason(c).points[id]?.[cls] ?? {}
  return Object.entries(pts)
    .map(([who, points]) => ({ who, points }))
    .sort((a, b) => b.points - a.points || (a.who === 'you' ? -1 : b.who === 'you' ? 1 : 0))
}

/** A series you won. */
export interface SeriesWin {
  contest: ContestId
  cls: ClassId
  points: number
  money: number
  rep: number
}

/**
 * The year is over: the rest of the rounds are run, and each series has its
 * champion. You're paid for each one you won; the news says who won the
 * series you scored in.
 */
export function endSeries(c: CareerState): SeriesWin[] {
  passRounds(c, Infinity)
  const s = eventSeason(c)
  const wins: SeriesWin[] = []
  for (const id of Object.keys(s.points) as ContestId[]) {
    for (const cls of CLASSES.map((x) => x.id)) {
      const table = seriesTable(c, id, cls)
      if (!table.some((r) => r.who === 'you' && r.points > 0)) continue
      const top = table[0]!
      if (top.who === 'you') {
        const win = { contest: id, cls, points: top.points, money: EVENT_CAREER.champion.money * CLASS_MONEY[cls], rep: EVENT_CAREER.champion.rep }
        c.money += win.money
        c.rep += win.rep
        wins.push(win)
      }
      addNews(c, { kind: 'series', year: c.year, contest: id, cls, who: top.who, points: top.points })
    }
  }
  return wins
}
