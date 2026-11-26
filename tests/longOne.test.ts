/**
 * The Long One as the career's finale (plan PR 13): the halfway rest day,
 * the road to it on the status line, the story of the first win (kept in
 * the save for the record), and every class's stock truck getting home.
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR, TIERS } from '../src/data/career'
import { RAID, RAID_IDS, RAIDS } from '../src/data/raids'
import { newSave, readSave } from '../src/persist/save'
import { stockBuild } from '../src/sim/build'
import { buyTruck, driveAuto, enterOwn, eventDays, longOneRoad, newCareer, nextEvent, settle, type CareerState } from '../src/sim/career'
import { bivouacHours, doJobs, enterRaid, isRestDay, type RaidState, type StageRecord } from '../src/sim/raid'

const LONG = CALENDAR.findIndex((e) => e.raid === 'longOne')

function skipTo(c: CareerState, year: number, next = 0): void {
  while (c.year < year || (c.year === year && c.next < next)) settle(c, null)
}

/** Every stage done without driving: the player's time `mine`, every rival's `theirs`. */
function fakeDone(state: RaidState, mine: number, theirs: number): RaidState {
  const raid = RAIDS[state.entry.raid]
  const field = state.entry.field ?? []
  state.results = raid.stages.map((): StageRecord => ({
    time: mine, paces: ['steady', 'steady', 'steady'], stops: [], late: false, limped: false,
    rivals: field.map((r) => ({ id: r.id, splits: [1, 2, theirs], time: theirs, trouble: null, late: false })),
  }))
  state.stage = raid.stages.length
  state.phase = 'done'
  return state
}

/** A career at the Long One with its own truck, the reputation to enter, and a fake result. */
function longOneWin(c: CareerState, year: number, win = true) {
  skipTo(c, year, LONG)
  c.rep = Math.max(c.rep, TIERS.long.rep)
  const state = enterOwn(c, 'veteran')
  return settle(c, fakeDone(state, win ? 100 : 300, 200))
}

describe('the rest day', () => {
  it('only the Long One has one, halfway, and it adds a day to the trip', () => {
    for (const id of RAID_IDS) {
      const raid = RAIDS[id]
      if (id === 'longOne') expect(raid.restAfter).toBe(raid.stages.length / 2)
      else expect(raid.restAfter).toBeUndefined()
    }
    const long = CALENDAR[LONG]!
    expect(eventDays(long)).toBe(RAIDS.longOne.stages.length + 3)
    // Still home before the year ends.
    expect(long.day + eventDays(long)).toBeLessThan(366)
  })

  it('gives the crew twice the hours on that day only', () => {
    const state = enterRaid('longOne', stockBuild('sxs'), 'veteran', { hours: 10 })
    expect(isRestDay(state)).toBe(false)
    state.stage = 6
    state.phase = 'bivouac'
    expect(isRestDay(state)).toBe(false)
    expect(bivouacHours(state)).toBe(10)
    state.stage = 7
    expect(isRestDay(state)).toBe(true)
    expect(bivouacHours(state)).toBe(10 * RAID.restDayHours)
    doJobs(state, [])
    expect(isRestDay(state)).toBe(false)
    expect(bivouacHours(state)).toBe(10)
    // The Summer Raid has none.
    const other = enterRaid('summerRaid', stockBuild('sxs'), 'veteran')
    other.stage = 2
    other.phase = 'bivouac'
    expect(bivouacHours(other)).toBe(RAID.bivouacHours)
  })
})

describe('the road to the Long One', () => {
  it('shows the reputation it takes, then that it is open, then the years won', () => {
    const c = newCareer(5)
    expect(longOneRoad(c)).toEqual({ rep: 0, need: TIERS.long.rep, open: false, won: [] })
    c.rep = TIERS.long.rep
    expect(longOneRoad(c).open).toBe(true)
    c.longOne.push(1990)
    expect(longOneRoad(c).won).toEqual([1990])
  })
})

describe('the finale', () => {
  it('keeps the story of the first win, and only the first', () => {
    const c = newCareer(31)
    c.money = 500_000
    buyTruck(c, 'heavy')
    const lost = longOneWin(c, 1985, false)
    expect(lost.story).toBeNull()
    expect(c.firstLongOne).toBeUndefined()
    const won = longOneWin(c, 1986)
    expect(won.wonLongOne).toBe(true)
    expect(won.story).toEqual({
      year: 1986, seasons: 2, cls: 'heavy', driver: 'veteran', parts: c.own!.parts,
      stats: { raids: 2, wins: 1, podiums: 1, contracts: 0 },
    })
    expect(c.firstLongOne).toEqual(won.story)
    // Winning it again goes in the record, but the finale was the first time.
    const again = longOneWin(c, 1987)
    expect(again.wonLongOne).toBe(true)
    expect(again.story).toBeNull()
    expect(c.longOne).toEqual([1986, 1987])
    expect(c.firstLongOne!.year).toBe(1986)
    expect(nextEvent(c).raid).toBe('winterSprint')
  })

  it('keeps the story through a save, and drops one that does not add up', () => {
    const c = newCareer(32)
    c.money = 500_000
    buyTruck(c, 'light4x4')
    longOneWin(c, 1985)
    const save = newSave()
    save.career = c
    expect(readSave(JSON.parse(JSON.stringify(save)))).toEqual(save)
    const bad = JSON.parse(JSON.stringify(save))
    bad.career.firstLongOne.cls = 'tractor'
    const read = readSave(bad)
    expect(read.career!.firstLongOne).toBeUndefined()
    expect(read.career!.longOne).toEqual([1985])
    // A career from before the finale has none, and loads as it was.
    const old = JSON.parse(JSON.stringify(save))
    delete old.career.firstLongOne
    expect(readSave(old).career!.firstLongOne).toBeUndefined()
  })
})

describe('every class gets home on the Long One', () => {
  // A stock truck with a light spares kit, Steady all the way and the crew
  // doing the worst jobs first, is never towed in: the finale is open to
  // every class, not just the light 4x4.
  it.each(['heavy', 'sxs'] as const)('%s', (cls) => {
    const b = stockBuild(cls)
    b.parts.spares = 'lightKit'
    const state = enterRaid('longOne', b, 'veteran')
    driveAuto(state)
    expect(state.results.filter((r) => r.late).length).toBe(0)
  }, 180_000)
})

