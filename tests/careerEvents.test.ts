/**
 * One-day events in the career: the rounds between the raids, entering one,
 * the pay-out and series points, the rounds the rivals run without you, the
 * champions at the end of the year, and the series in the save.
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR, CLASS_MONEY, DRIVER_TERMS, TIERS } from '../src/data/career'
import { CLASSES, classOut, type ClassId } from '../src/data/classes'
import { CONTEST_IDS, CONTESTS, EVENT_CAREER, ROUNDS } from '../src/data/contests'
import { newSave, readSave } from '../src/persist/save'
import { buyTruck, entryProblems, eventDays, newCareer, settle, takeContract, offers, type CareerState } from '../src/sim/career'
import {
  addEventRun, endSeries, enterEvent, eventDriverFee, eventEntryFee, eventProblems, eventSeason, passRounds, roundNo, roundRivals,
  roundsBeforeRaid, seriesTable, settleEvent,
} from '../src/sim/careerEvents'
import { rivalRuns } from '../src/sim/contest'
import { rivalsIn } from '../src/sim/rivals'

/** A career with its own light 4x4, past the two winter raids (sat out): the spring rounds are next. */
function spring(seed = 1): CareerState {
  const c = newCareer(seed)
  c.money = 200_000
  buyTruck(c, 'light4x4')
  settle(c, null)
  settle(c, null)
  return c
}

/** The best score possible in an event of this kind: a time of one second, or a huge speed or points. */
function winning(i: number): number {
  return CONTESTS[ROUNDS[i]!.contest].kind === 'timed' ? 1 : 10_000
}

/** Enter round `i` and drive every run to `score`. */
function runRound(c: CareerState, i: number, score: number | null, driver = 'veteran' as const) {
  enterEvent(c, i, driver)
  for (let k = 0; k < CONTESTS[ROUNDS[i]!.contest].runs; k++) addEventRun(c, score, score === null)
  return settleEvent(c)
}

describe('the rounds', () => {
  it('are in day order, three a year for each event, all in the gaps between raids', () => {
    for (let i = 1; i < ROUNDS.length; i++) expect(ROUNDS[i]!.day).toBeGreaterThan(ROUNDS[i - 1]!.day)
    for (const id of CONTEST_IDS) expect(ROUNDS.filter((r) => r.contest === id)).toHaveLength(3)
    for (const r of ROUNDS) {
      for (const e of CALENDAR) expect(r.day < e.day || r.day >= e.day + eventDays(e)).toBe(true)
    }
    expect(ROUNDS.map((_, i) => roundNo(i)).filter((n) => n === 1)).toHaveLength(CONTEST_IDS.length)
  })

  it('open up between raids, until the next raid starts', () => {
    const c = spring()
    const raidDay = CALENDAR[c.next]!.day
    const open = roundsBeforeRaid(c)
    expect(open.length).toBeGreaterThan(0)
    for (const i of open) expect(ROUNDS[i]!.day).toBeLessThan(raidDay)
    expect(roundsBeforeRaid(newCareer(1))).toEqual([])
  })

  it('give each round different rivals’ runs, and leave free play as it was', () => {
    const c = spring()
    const a = roundRivals(c, 0, 'light4x4')
    const b = roundRivals(c, 3, 'light4x4')
    expect(a.map((r) => r.runs)).not.toEqual(b.map((r) => r.runs))
    expect(rivalRuns(CONTESTS.hillClimb, 'light4x4', rivalsIn('light4x4'))).toEqual(rivalRuns(CONTESTS.hillClimb, 'light4x4', rivalsIn('light4x4'), ''))
  })
})

describe('entering a round', () => {
  it('takes your own truck, a fee and (on a timed event) a day’s pay for the driver', () => {
    const c = spring()
    const i = roundsBeforeRaid(c)[0]!
    expect(ROUNDS[i]!.contest).toBe('hillClimb')
    const before = c.money
    enterEvent(c, i, 'veteran')
    const fee = EVENT_CAREER.entryFee * CLASS_MONEY.light4x4
    const driver = DRIVER_TERMS.veteran.fee * TIERS.regional.driverFee * EVENT_CAREER.driverShare
    expect(eventEntryFee('light4x4')).toBe(fee)
    expect(eventDriverFee('hillClimb', 'veteran', 'light4x4')).toBe(driver)
    expect(eventDriverFee('speedTrial', 'veteran', 'light4x4')).toBe(0)
    expect(c.money).toBe(before - fee - driver)
    expect(c.day).toBe(ROUNDS[i]!.day)
    expect(eventSeason(c).live?.round).toBe(i)
  })

  it('says why not: no truck, a job taken, the driver’s reputation, money, or an event already on', () => {
    const none = newCareer(1)
    settle(none, null)
    settle(none, null)
    expect(eventProblems(none, roundsBeforeRaid(none)[0]!, 'veteran').map((p) => p.kind)).toContain('noTruck')

    const c = spring()
    const i = roundsBeforeRaid(c)[0]!
    expect(eventProblems(c, i, 'veteran')).toEqual([])
    expect(eventProblems(c, i, 'charger').map((p) => p.kind)).toContain('driverRep')
    // The speed trial is driven by the crew: no driver to ask.
    const trial = roundsBeforeRaid(c).find((k) => ROUNDS[k]!.contest === 'speedTrial')!
    expect(eventProblems(c, trial, 'charger')).toEqual([])
    c.money = 10
    expect(eventProblems(c, i, 'veteran').map((p) => p.kind)).toContain('money')
    c.money = 200_000
    const bench = { ...c.own!, parts: { ...c.own!.parts, bumpStops: 'urethane' } }
    expect(eventProblems(c, i, 'veteran', bench).map((p) => p.kind)).toContain('parts')
    takeContract(c, offers(c)[0]!)
    expect(eventProblems(c, i, 'veteran').map((p) => p.kind)).toContain('busy')

    const d = spring()
    enterEvent(d, roundsBeforeRaid(d)[0]!, 'veteran')
    expect(eventProblems(d, roundsBeforeRaid(d)[0]!, 'veteran').map((p) => p.kind)).toContain('busy')
    expect(entryProblems(d, 'veteran').map((p) => p.kind)).toContain('busy')
  })

  it('passes the rounds before it: the rivals run them alone', () => {
    const c = spring()
    const open = roundsBeforeRaid(c)
    const later = open[2]!
    enterEvent(c, later, 'veteran')
    const s = eventSeason(c)
    expect(s.done).toBe(later)
    expect(roundsBeforeRaid(c)).not.toContain(open[0])
    const table = seriesTable(c, ROUNDS[open[0]!]!.contest, 'light4x4')
    expect(table[0]!.points).toBe(EVENT_CAREER.points[0])
    expect(table.some((r) => r.who === 'you')).toBe(false)
  })
})

describe('the pay-out', () => {
  it('pays a winner the prize, some reputation and ten points, and moves on a day', () => {
    const c = spring()
    const i = roundsBeforeRaid(c)[0]!
    const rep = c.rep
    const money = c.money
    const out = runRound(c, i, winning(i))
    expect(out.pos).toBe(1)
    expect(out.prize).toBe(EVENT_CAREER.prizes[0]! * CLASS_MONEY.light4x4)
    expect(out.repairs).toBe(0)
    expect(c.money).toBe(money - out.paid + out.prize)
    expect(out.money).toBe(out.prize - out.paid)
    expect(c.rep).toBe(rep + EVENT_CAREER.rep.win)
    expect(out.points).toBe(10)
    expect(seriesTable(c, 'hillClimb', 'light4x4')[0]).toEqual({ who: 'you', points: 10 })
    expect(c.day).toBe(ROUNDS[i]!.day + 1)
    expect(eventSeason(c).live).toBeUndefined()
    expect(c.news[0]).toMatchObject({ kind: 'event', contest: 'hillClimb', round: 1, pos: 1 })
    // The other classes' rivals ran it too.
    expect(seriesTable(c, 'hillClimb', 'heavy')[0]!.points).toBe(10)
  })

  it('pays nothing for runs that all broke, and charges the repairs', () => {
    const c = spring()
    const i = roundsBeforeRaid(c)[0]!
    const out = runRound(c, i, null)
    expect(out.pos).toBeNull()
    expect(out.prize).toBe(0)
    expect(out.points).toBe(0)
    expect(out.repairs).toBeCloseTo(CONTESTS.hillClimb.runs * EVENT_CAREER.breakRepair)
    expect(out.money).toBeCloseTo(-out.paid - out.repairs)
  })
})

describe('the series', () => {
  it('runs on when the garage goes to a raid, and crowns its champions at the end of the year', () => {
    const c = spring()
    const won: number[] = []
    let crowned = false
    // Win every hill climb round; sit out everything else.
    while (c.season === 0) {
      for (const i of roundsBeforeRaid(c)) {
        if (ROUNDS[i]!.contest !== 'hillClimb') continue
        runRound(c, i, winning(i))
        won.push(i)
      }
      const money = c.money
      const rep = c.rep
      const out = settle(c, null)
      if (out.series.length) {
        const win = out.series.find((w) => w.contest === 'hillClimb')!
        expect(win).toMatchObject({ cls: 'light4x4', points: 30 })
        expect(c.money).toBe(money + EVENT_CAREER.champion.money)
        expect(c.rep).toBe(rep + EVENT_CAREER.champion.rep)
        expect(c.news.some((n) => n.kind === 'series' && n.who === 'you')).toBe(true)
        crowned = true
      }
    }
    expect(won).toHaveLength(3)
    expect(crowned).toBe(true)
    // A new year, new series.
    expect(eventSeason(c)).toMatchObject({ season: 1, done: 0, points: {} })
  })

  it('every round is run by the rivals by the end of the year, in every class that races', () => {
    const c = spring()
    passRounds(c, Infinity)
    const total = (id: (typeof CONTEST_IDS)[number], cls: ClassId) => seriesTable(c, id, cls).reduce((s, r) => s + r.points, 0)
    for (const id of CONTEST_IDS) {
      for (const cls of CLASSES.map((x) => x.id)) {
        // Side-by-sides race from 2005 (real-history dates), so 1985 has no series for them.
        if (classOut(cls, c.year)) expect(total(id, cls)).toBeGreaterThan(0)
        else expect(total(id, cls)).toBe(0)
      }
    }
    expect(endSeries(c)).toEqual([])
    // From 2005 there's a side-by-side series too.
    const later = spring(2)
    later.year = 2005
    passRounds(later, Infinity)
    for (const id of CONTEST_IDS) expect(seriesTable(later, id, 'sxs').reduce((s, r) => s + r.points, 0)).toBeGreaterThan(0)
  })
})

describe('the save', () => {
  it('keeps the series and an entry under way', () => {
    const c = spring()
    runRound(c, roundsBeforeRaid(c)[0]!, winning(0))
    const i = roundsBeforeRaid(c)[0]!
    enterEvent(c, i, 'veteran')
    addEventRun(c, 123.4, false)
    const save = { ...newSave(), career: c }
    const back = readSave(JSON.parse(JSON.stringify(save))).career!
    expect(back.events).toEqual(c.events)
  })

  it('starts the series fresh in a save from before them, or from another year', () => {
    const c = spring()
    const old = JSON.parse(JSON.stringify({ ...newSave(), career: c }))
    delete old.career.events
    expect(readSave(old).career!.events).toBeUndefined()
    old.career.events = { season: 4, done: 3, points: {} }
    expect(readSave(old).career!.events).toBeUndefined()
    old.career.events = { season: 0, done: 2, points: { hillClimb: { light4x4: { you: 'ten' } } }, live: { round: 99 } }
    expect(readSave(old).career!.events).toEqual({ season: 0, done: 2, points: { hillClimb: { light4x4: {} } } })
  })
})
