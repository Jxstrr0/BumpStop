/**
 * The hall of fame (after 1.2): the career's record season by season, the
 * biggest rival, the drivers you hired, the end of the career after 2025,
 * the record in the save, and the photo album's bookkeeping.
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR, HALL, TIERS } from '../src/data/career'
import { RAIDS } from '../src/data/raids'
import { careerPhotos, clearSlotPhotos, keepPhoto, memoryAlbum, removePhoto, type AlbumPhoto } from '../src/persist/album'
import { newSave, readSave } from '../src/persist/save'
import { buyTruck, enterOwn, newCareer, settle, type CareerState } from '../src/sim/career'
import { recap, recordResult } from '../src/sim/hall'
import type { RaidState, StageRecord } from '../src/sim/raid'

/** A finished raid without driving it: the player's time `mine` on every stage, each rival's `theirs`. */
function fakeDone(state: RaidState, mine: number, theirs: (id: string) => number): RaidState {
  const raid = RAIDS[state.entry.raid]
  const field = state.entry.field ?? []
  state.results = raid.stages.map((): StageRecord => ({
    time: mine, paces: ['steady', 'steady', 'steady'], stops: [], late: false, limped: false,
    rivals: field.map((r) => ({ id: r.id, splits: [1, 2, theirs(r.id)], time: theirs(r.id), trouble: null, late: false })),
  }))
  state.stage = raid.stages.length
  state.phase = 'done'
  return state
}

/** Enter your own truck in the next raid and finish it: `win` beats everyone, otherwise last. */
function race(c: CareerState, win: boolean, driver: 'veteran' | 'mechanic' = 'veteran') {
  c.money = Math.max(c.money, 500_000)
  const state = enterOwn(c, driver)
  fakeDone(state, win ? 100 : 1_000, () => 500)
  return settle(c, state)
}

describe('the hall of fame record', () => {
  it('starts with every new career, and keeps a line per season with the wins, podiums and best result', () => {
    const c = newCareer(3)
    expect(c.hall).toEqual({ from: 0, seasons: [], rivals: {}, drivers: {} })
    c.money = 500_000
    buyTruck(c, 'light4x4')
    race(c, true)
    race(c, false)
    settle(c, null)
    const line = c.hall!.seasons[0]!
    expect(line).toMatchObject({ season: 0, year: 1985, raids: 2, wins: 1, podiums: 1, contracts: 0, longOne: false })
    expect(line.best).toMatchObject({ raid: CALENDAR[0]!.raid, cls: 'light4x4', job: 'own', pos: 1 })
    expect(line.rep).toBe(TIERS.regional.repFor.win + TIERS.regional.repFor.finish)
  })

  it('counts the rival teams who met your truck, and which of them finished ahead', () => {
    const c = newCareer(4)
    c.money = 500_000
    buyTruck(c, 'light4x4')
    race(c, true)
    race(c, false)
    const r = recap(c)
    // Tundra Dogs race the light 4x4 from 1985: met twice, ahead once.
    expect(c.hall!.rivals.brannigan).toEqual({ met: 2, ahead: 1, behind: 1 })
    expect(r.rival?.team).toBe('brannigan')
  })

  it('names the team that beat you most as the biggest rival, most meetings breaking a tie', () => {
    const c = newCareer(5)
    c.hall!.rivals = { brannigan: { met: 9, ahead: 2, behind: 7 }, highbank: { met: 5, ahead: 4, behind: 1 }, hardpan: { met: 8, ahead: 4, behind: 4 } }
    expect(recap(c).rival).toEqual({ team: 'hardpan', tally: { met: 8, ahead: 4, behind: 4 } })
  })

  it('keeps each driver you hired, with their first year', () => {
    const c = newCareer(6)
    c.money = 500_000
    buyTruck(c, 'sxs')
    race(c, true, 'veteran')
    race(c, false, 'mechanic')
    race(c, true, 'mechanic')
    const r = recap(c)
    expect(r.drivers.map((d) => d.id)).toEqual(['mechanic', 'veteran'])
    expect(r.drivers[0]!.tally).toEqual({ raids: 2, wins: 1, podiums: 1, first: 1985 })
  })

  it('counts contracts in the season, and a retired truck never beats anyone', () => {
    const c = newCareer(7)
    recordResult(c, { raid: 'winterSprint', cls: 'sxs', job: 'contract', pos: 2, of: 6, money: 900, rep: 2, wonLongOne: false, table: [{ who: 'jackrabbit301' }, { who: 'you' }] })
    recordResult(c, { raid: 'winterRaid', cls: 'sxs', job: 'own', pos: null, of: 6, money: -400, rep: 0, wonLongOne: false, table: [{ who: 'you' }, { who: 'jackrabbit301' }] })
    const line = c.hall!.seasons[0]!
    expect(line).toMatchObject({ contracts: 1, raids: 1, wins: 0, money: 500, rep: 2 })
    expect(line.best).toMatchObject({ job: 'contract', pos: 2 })
    expect(c.hall!.rivals.jackrabbit).toEqual({ met: 2, ahead: 2, behind: 0 })
  })

  it('ranks the best seasons: a Whole Damn Country win first, then wins and podiums', () => {
    const c = newCareer(8)
    const line = (season: number, wins: number, podiums: number, longOne = false) => ({
      season, year: 1985 + season, raids: 6, wins, podiums, contracts: 0, rep: 10, money: 0, longOne, best: null,
    })
    c.hall!.seasons = [line(0, 0, 1), line(1, 3, 4), line(2, 1, 2, true), line(3, 3, 5), line(4, 0, 0)]
    c.season = 5
    expect(recap(c).best.map((s) => s.year)).toEqual([1987, 1988, 1986].slice(0, HALL.bestSeasons))
  })
})

describe('the end of the career', () => {
  it('comes once, when the last raid of 2025 is settled, and the career carries on after', () => {
    const c = newCareer(9)
    let ends = 0
    let endedAt = ''
    while (c.season < 42) {
      const before = `${c.year}:${c.next}`
      if (settle(c, null).careerEnd) {
        ends++
        endedAt = before
      }
    }
    expect(ends).toBe(1)
    expect(endedAt).toBe(`2025:${CALENDAR.length - 1}`)
    const r = recap(c)
    expect(r.ended).toBe(true)
    expect(r.seasons).toBe(41)
    expect(r.lastYear).toBe(2025)
    expect(r.partial).toBe(false)
    // Sitting out every raid: nothing raced, no rival, no drivers.
    expect(r.best).toEqual([])
    expect(r.rival).toBeNull()
  })

  it('counts the career so far before then', () => {
    const c = newCareer(10)
    expect(recap(c)).toMatchObject({ ended: false, seasons: 0, firstYear: 1985, lastYear: 1985 })
    settle(c, null)
    expect(recap(c).seasons).toBe(1)
  })
})

describe('the hall of fame in the save', () => {
  it('goes through a save and back', () => {
    const c = newCareer(11)
    c.money = 500_000
    buyTruck(c, 'light4x4')
    race(c, true)
    const save = newSave()
    save.career = c
    expect(readSave(JSON.parse(JSON.stringify(save)))).toEqual(save)
  })

  it('starts counting from where an older career is, without the record', () => {
    const c = newCareer(12)
    for (let i = 0; i < CALENDAR.length * 3; i++) settle(c, null)
    delete c.hall
    const save = newSave()
    save.career = c
    const back = readSave(JSON.parse(JSON.stringify(save)))
    expect(back.career!.hall).toBeUndefined()
    settle(back.career!, null)
    expect(back.career!.hall!.from).toBe(3)
    expect(recap(back.career!)).toMatchObject({ partial: true, fromYear: 1988 })
  })

  it('drops a record or a season that does not add up, never the save', () => {
    const c = newCareer(13)
    settle(c, null)
    const save = newSave()
    save.career = c
    const raw = JSON.parse(JSON.stringify(save))
    raw.career.hall.seasons.push({ season: 'two' }, null)
    raw.career.hall.rivals.nobody = { met: 1, ahead: 1, behind: 0 }
    expect(readSave(raw).career!.hall).toEqual(c.hall)
    raw.career.hall = { from: -1 }
    expect(readSave(raw).career!.hall).toBeUndefined()
    raw.career.hall = 'lots'
    expect(readSave(raw).career).not.toBeNull()
  })
})

describe('the photo album', () => {
  const photo = (slot: 1 | 2 | 3, career: number, year: number, caption = 'The test track'): AlbumPhoto => ({
    slot, career, year, caption, takenAt: year, picture: new Blob(['x'], { type: 'image/jpeg' }),
  })

  it('keeps each career’s photos apart, oldest first, up to the most it holds', async () => {
    const store = memoryAlbum()
    expect(await keepPhoto(photo(1, 5, 1990), store)).toBe('kept')
    expect(await keepPhoto(photo(1, 5, 1986), store)).toBe('kept')
    expect(await keepPhoto(photo(1, 6, 1986), store)).toBe('kept')
    expect(await keepPhoto(photo(2, 5, 1986), store)).toBe('kept')
    const mine = await careerPhotos(1, 5, store)
    expect(mine.map((p) => p.year)).toEqual([1986, 1990])
    for (let i = mine.length; i < HALL.albumMax; i++) await keepPhoto(photo(1, 5, 2000), store)
    expect(await keepPhoto(photo(1, 5, 2001), store)).toBe('full')
    expect(await removePhoto(mine[0]!.id!, store)).toBe(true)
    expect(await keepPhoto(photo(1, 5, 2001), store)).toBe('kept')
  })

  it('clears only the deleted slot', async () => {
    const store = memoryAlbum()
    await keepPhoto(photo(1, 5, 1990), store)
    await keepPhoto(photo(2, 5, 1990), store)
    await clearSlotPhotos(1, store)
    expect(await careerPhotos(1, 5, store)).toEqual([])
    expect(await careerPhotos(2, 5, store)).toHaveLength(1)
  })
})

describe('the hall of fame in words', () => {
  it('writes seasons and rivals without gaps or raw keys', async () => {
    const { seasonText, rivalText } = await import('../src/ui/hall')
    const texts = [
      seasonText({ season: 3, year: 1988, raids: 6, wins: 1, podiums: 3, contracts: 2, rep: 14, money: 21_500, longOne: false, best: { raid: 'summerRaid', cls: 'light4x4', job: 'own', pos: 1, of: 9 } }),
      seasonText({ season: 4, year: 1989, raids: 0, wins: 0, podiums: 0, contracts: 4, rep: 3, money: -800, longOne: false, best: { raid: 'nationalRaid', cls: 'sxs', job: 'contract', pos: 2, of: 9 } }),
      seasonText({ season: 9, year: 1994, raids: 6, wins: 4, podiums: 6, contracts: 0, rep: 40, money: 90_000, longOne: true, best: null }),
      rivalText({ team: 'hardpan', tally: { met: 30, ahead: 18, behind: 12 } }),
      rivalText({ team: 'jackrabbit', tally: { met: 3, ahead: 0, behind: 3 } }),
    ]
    for (const text of texts) expect(text).not.toMatch(/\{|hall\.|undefined|NaN/)
    expect(texts[0]).toBe('1988: 1 win, 3 podiums, 2 contracts, +21,500 cr., 14 reputation. Best: 1st at the Washboard 800, in a light 4x4.')
    expect(texts[1]).toContain('−800 cr.')
    expect(texts[2]).toContain('Won the Whole Damn Country.')
    expect(texts[3]).toContain('Ironwood Brothers')
    expect(texts[4]).toContain('never once ahead')
  })

  it('names the favourite truck from its logbook, with the moment it’s remembered for', async () => {
    const { favouriteText } = await import('../src/ui/hall')
    const c = newCareer(14)
    expect(favouriteText(c)).toBeNull()
    c.money = 500_000
    buyTruck(c, 'light4x4')
    race(c, false)
    race(c, true)
    const text = favouriteText(c)!
    expect(text).toContain('Truck 1, a light 4x4, from 1985, still in the garage: 2 raids, 1 win')
    expect(text).toContain('won it')
    expect(text).not.toMatch(/\{|hall\.|log\.|undefined|NaN/)
  })
})
