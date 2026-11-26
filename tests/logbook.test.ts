/**
 * The garage logbook: every truck the career's garage owns keeps its
 * history (raids, wins, kilometres, stops, parts swapped and moments), the
 * sold ones stay on the wall, and saves keep it all (older saves get a
 * fresh logbook for the truck they have).
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR, TIERS } from '../src/data/career'
import { LOGBOOK } from '../src/data/logbook'
import { SLOTS } from '../src/data/parts'
import { RAIDS } from '../src/data/raids'
import { SAVE } from '../src/data/save'
import { newSave, readSave } from '../src/persist/save'
import { buyTruck, enterOwn, fitOwn, newCareer, offers, contractRaid, driveAuto, sellTruck, settle, takeContract, type CareerState } from '../src/sim/career'
import { favouriteTruck, oldTrucks, ownLog, type TruckLog } from '../src/sim/logbook'
import { stageKm, type RaidState, type StageRecord, type Stop } from '../src/sim/raid'
import { cardLines, momentText } from '../src/ui/logbook'

/** A finished raid without driving it: every stage done in `mine` seconds, each rival in `theirs`, with `stops` on the first stage. */
function fakeDone(state: RaidState, mine: number, theirs: number, stops: Stop[] = []): RaidState {
  const raid = RAIDS[state.entry.raid]
  const field = state.entry.field ?? []
  state.results = raid.stages.map((_, k): StageRecord => ({
    time: mine, paces: ['steady', 'steady', 'steady'], stops: k === 0 ? stops : [], late: false, limped: false,
    rivals: field.map((r) => ({ id: r.id, splits: [1, 2, theirs], time: theirs, trouble: null, late: false })),
  }))
  state.stage = raid.stages.length
  state.phase = 'done'
  return state
}

function stop(kind: Stop['kind'], corner: number, lost: number): Stop {
  return { leg: 0, at: 1000, kind, corner, zone: null, lost, fix: 'spare', estimated: false }
}

function raidKm(state: RaidState): number {
  return RAIDS[state.entry.raid].stages.reduce((s, x) => s + stageKm(x), 0)
}

function richCareer(seed = 3): CareerState {
  const c = newCareer(seed)
  c.money = 200_000
  return c
}

describe('a truck’s logbook', () => {
  it('starts when the garage buys a truck, and closes when it sells it', () => {
    const c = richCareer()
    expect(c.trucks).toEqual([])
    expect(ownLog(c)).toBeNull()
    buyTruck(c, 'light4x4')
    const first = ownLog(c)!
    expect(first).toMatchObject({ n: 1, cls: 'light4x4', bought: 1985, sold: null, raids: 0, km: 0 })
    sellTruck(c)
    expect(ownLog(c)).toBeNull()
    expect(first.sold).toBe(1985)
    buyTruck(c, 'sxs')
    expect(ownLog(c)).toMatchObject({ n: 2, cls: 'sxs', sold: null })
    expect(oldTrucks(c).map((x) => x.n)).toEqual([1])
  })

  it('counts the parts swapped, not settings', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    fitOwn(c, { ...c.own!, front: { ...c.own!.front, preload: c.own!.front.preload + 0.005 } })
    expect(ownLog(c)!.parts).toBe(0)
    const before = c.own!
    fitOwn(c, { ...before, parts: { ...before.parts, dampers: 'monotube', bumpStops: 'urethane' } })
    const swapped = SLOTS.filter((s) => before.parts[s] !== c.own!.parts[s]).length
    expect(swapped).toBeGreaterThan(0)
    expect(ownLog(c)!.parts).toBe(swapped)
  })

  it('records a win: the raid, the kilometres, the stops and the moments, newest first', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    const state = fakeDone(enterOwn(c, 'veteran'), 100, 200, [stop('tire', 1, 40), stop('axle', 2, 300)])
    settle(c, state)
    const log = ownLog(c)!
    expect(log).toMatchObject({ raids: 1, finishes: 1, wins: 1, podiums: 1, longOnes: 0, retired: 0, best: 1, stops: 2 })
    expect(log.km).toBeCloseTo(raidKm(state), 6)
    // The result on top, then the stop that cost the most time.
    expect(log.moments.map((m) => m.kind)).toEqual(['win', 'broke'])
    expect(log.moments[1]).toMatchObject({ part: 'axle', corner: 2, year: 1985, raid: CALENDAR[0]!.raid })
    expect(momentText(log.moments[0]!)).toBe('Cold Start 300 ’85: won it')
    expect(momentText(log.moments[1]!)).toBe('Cold Start 300 ’85: snapped the rear left axle')
  })

  it('records a first raid down the field, and a raid it didn’t finish', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    settle(c, fakeDone(enterOwn(c, 'veteran'), 500, 100))
    const log = ownLog(c)!
    expect(log.moments[0]!.kind).toBe('firstRaid')
    expect(momentText(log.moments[0]!)).toMatch(/^Cold Start 300 ’85: first raid, \d+(st|nd|rd|th) place$/)
    const kmBefore = log.km
    const state = enterOwn(c, 'veteran')
    state.results = [{ time: 900, paces: ['steady'], stops: [stop('slide', 0, 120)], late: false, limped: false, rivals: [] }]
    state.stage = 1
    settle(c, state, true)
    expect(log).toMatchObject({ raids: 2, finishes: 1, retired: 1, wins: 0 })
    // Only the stage it drove counts.
    expect(log.km - kmBefore).toBeCloseTo(stageKm(RAIDS[state.entry.raid].stages[0]!), 6)
    expect(log.moments.slice(0, 2).map((m) => m.kind)).toEqual(['retired', 'slide'])
    expect(momentText(log.moments[1]!)).toBe('Frozen Knuckle ’85: slid into a snowbank')
  })

  it('records the Long One', () => {
    const c = richCareer(11)
    buyTruck(c, 'light4x4')
    while (CALENDAR[c.next]!.raid !== 'longOne') settle(c, null)
    c.rep = TIERS.long.rep
    settle(c, fakeDone(enterOwn(c, 'veteran'), 100, 200))
    expect(ownLog(c)).toMatchObject({ longOnes: 1, wins: 1 })
    expect(ownLog(c)!.moments[0]!.kind).toBe('longOne')
  })

  it('keeps only the newest moments', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    c.rep = TIERS.long.rep
    for (let k = 0; k < LOGBOOK.moments + 4; k++) settle(c, fakeDone(enterOwn(c, 'veteran'), 100, 200))
    expect(ownLog(c)!.moments).toHaveLength(LOGBOOK.moments)
    expect(ownLog(c)!.raids).toBe(LOGBOOK.moments + 4)
  })

  // It drives a whole raid, about 3 s here and slower on the CI machine, so it gets the raid tests' time.
  it('leaves contract trucks out: they belong to the privateers', { timeout: 60_000 }, () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    takeContract(c, offers(c)[0]!)
    const state = contractRaid(c)
    driveAuto(state)
    settle(c, state)
    expect(ownLog(c)!.raids).toBe(0)
    expect(c.trucks).toHaveLength(1)
  })

  it('picks the favourite: most raids, then wins, then kilometres', () => {
    const log = (n: number, raids: number, wins: number, km: number): TruckLog =>
      ({ ...newCareer(1).trucks[0], n, cls: 'light4x4', bought: 1985, sold: 1986, raids, finishes: raids, wins, podiums: wins, longOnes: 0, retired: 0, best: 1, km, stops: 0, parts: 0, moments: [] })
    expect(favouriteTruck({ trucks: [] })).toBeNull()
    expect(favouriteTruck({ trucks: [log(1, 0, 0, 0)] })).toBeNull()
    expect(favouriteTruck({ trucks: [log(1, 5, 1, 900), log(2, 7, 0, 100), log(3, 7, 0, 300)] })!.n).toBe(3)
    expect(favouriteTruck({ trucks: [log(1, 7, 2, 100), log(2, 7, 1, 900)] })!.n).toBe(1)
  })

  it('gives the truck card a record line and the newest moment', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    expect(cardLines(ownLog(c)!)).toEqual({ record: 'Truck No. 1 · Raids 0 · Wins 0 · 0 km', moment: null })
    settle(c, fakeDone(enterOwn(c, 'veteran'), 100, 200))
    expect(cardLines(ownLog(c)!).moment).toBe('Cold Start 300 ’85: won it')
  })
})

describe('logbooks in the save', () => {
  function savedWith(c: CareerState): unknown {
    return JSON.parse(JSON.stringify({ ...newSave(), career: c }))
  }

  it('keep every truck, old and new', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    settle(c, fakeDone(enterOwn(c, 'veteran'), 100, 200, [stop('fade', 0, 90)]))
    sellTruck(c)
    buyTruck(c, 'heavy')
    const back = readSave(savedWith(c)).career!
    expect(back.trucks).toEqual(c.trucks)
    expect(ownLog(back)!.n).toBe(2)
  })

  it('give a save from before logbooks a fresh logbook for its truck, with no new save format', () => {
    const c = richCareer()
    buyTruck(c, 'sxs')
    const raw = savedWith(c) as { v: number; career: Record<string, unknown> }
    delete raw.career.trucks
    expect(raw.v).toBe(SAVE.version)
    const back = readSave(raw).career!
    expect(back.trucks).toHaveLength(1)
    expect(ownLog(back)).toMatchObject({ n: 1, cls: 'sxs', bought: back.year, raids: 0 })
    // No truck, no logbook.
    const none = savedWith(richCareer()) as { career: Record<string, unknown> }
    delete none.career.trucks
    expect(readSave(none).career!.trucks).toEqual([])
  })

  it('drop logs and moments that don’t add up, without failing the save', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    settle(c, fakeDone(enterOwn(c, 'veteran'), 100, 200))
    const raw = savedWith(c) as { career: { trucks: unknown[] } }
    const log = raw.career.trucks[0] as { moments: unknown[]; wins: unknown }
    log.moments.push({ kind: 'teleported', year: 1985, raid: 'winterSprint' }, { kind: 'broke', year: 1985, raid: 'winterSprint', part: 'wing', corner: 0 }, { kind: 'win', year: 1985, raid: 'nowhere' })
    log.wins = 'lots'
    raw.career.trucks.unshift({ n: 'one' }, 'junk')
    const back = readSave(raw).career!
    expect(back.trucks).toHaveLength(1)
    expect(back.trucks[0]!.moments.map((m) => m.kind)).toEqual(['win'])
    expect(back.trucks[0]!.wins).toBe(0)
    expect(ownLog(back)).toBe(back.trucks[0])
  })

  it('close a log left open when the save has no truck', () => {
    const c = richCareer()
    buyTruck(c, 'light4x4')
    const raw = savedWith(c) as { career: Record<string, unknown> }
    raw.career.own = null
    const back = readSave(raw).career!
    expect(back.trucks[0]!.sold).toBe(back.year)
  })
})
