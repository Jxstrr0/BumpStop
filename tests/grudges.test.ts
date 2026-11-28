/**
 * Rival drivers with grudges (after 1.35): the rival teams' named drivers,
 * how their heat rises and falls, door rubs on a stage, the harder driving,
 * and the grudges' place in the save.
 */
import { describe, expect, it } from 'vitest'
import { TEAMS, TEAM_TUNING } from '../src/data/career'
import { GRUDGE } from '../src/data/grudges'
import { DRIVER_IDS, RAIDS, type PaceId, type Rival } from '../src/data/raids'
import { newSave, readSave } from '../src/persist/save'
import { buyTruck, careerRivals, driverName, enterOwn, newCareer, settle, type CareerState } from '../src/sim/career'
import {
  coolGrudges, dustBumps, grudgeLevel, grudgesNow, meetRivals, newYearGrudges, pushHarder, raidBumps, raidGrudges, rivalDrivers,
} from '../src/sim/grudges'
import type { RaidState, StageRecord } from '../src/sim/raid'
import { rivalStages } from '../src/sim/rivals'

/** A career with its own light 4x4, entered in the first raid. */
function entered(seed = 5): { c: CareerState; state: RaidState } {
  const c = newCareer(seed)
  c.money = 40_000
  buyTruck(c, 'light4x4')
  return { c, state: enterOwn(c, 'veteran') }
}

/** One stage's record: your time, each rival's time, the pace called. */
function stage(mine: number, theirs: Record<string, number>, pace: PaceId = 'steady', trouble: string[] = []): StageRecord {
  return {
    time: mine, paces: [pace, pace, pace], stops: [], late: false, limped: false,
    rivals: Object.entries(theirs).map(([id, time]) => ({
      id, splits: [time / 3, (2 * time) / 3, time], time, late: false,
      trouble: trouble.includes(id) ? { kind: 'tire' as const, leg: 0, lost: 600 } : null,
    })),
  }
}

/** Every stage of the raid driven: you at `mine`, every rival at `theirs` (s). */
function finish(state: RaidState, mine: number, theirs: (id: string) => number): RaidState {
  const field = state.entry.field ?? []
  state.results = RAIDS[state.entry.raid].stages.map(() => stage(mine, Object.fromEntries(field.map((r) => [r.id, theirs(r.id)])), 'conserve'))
  state.stage = state.results.length
  state.phase = 'done'
  return state
}

describe('the rival drivers', () => {
  it('every team truck in every class has its own driver, none of them your own hires', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const names = rivalDrivers(seed)
      const entries = Object.values(TEAMS).flatMap((t) => t.classes.map((c) => `${t.id}${c.number}`))
      expect(Object.keys(names).sort()).toEqual(entries.sort())
      const all = Object.values(names)
      expect(new Set(all).size).toBe(all.length)
      const c = newCareer(seed)
      for (const id of DRIVER_IDS) expect(all).not.toContain(driverName(c, id))
      // The same career always meets the same drivers.
      expect(rivalDrivers(seed)).toEqual(names)
    }
  })

  it('the career field names each team driver; privateers stay known by number', () => {
    const c = newCareer(7)
    const field = careerRivals(c, 'light4x4', 'regional')
    for (const r of field) {
      if (r.team === 'team.privateer') expect(r.driver).toBeUndefined()
      else expect(r.driver).toMatch(/^driverName\./)
    }
    expect(field.some((r) => r.grudge)).toBe(false)
    c.grudges = { brannigan7: 5 }
    expect(careerRivals(c, 'light4x4', 'regional').find((r) => r.id === 'brannigan7')!.grudge).toBe(5)
  })
})

describe('driving with a grudge', () => {
  const base: Rival = {
    id: 'brannigan7', team: 'team.brannigan', number: 7, cls: 'light4x4', pace: 0.95, spread: 0.025, risk: 0.2,
    delay: [0.2, 1], trouble: ['tire'], habit: 'habit.brannigan',
  }

  it('levels go Sore, Grudge, Feud as the heat builds', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 8].map(grudgeLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })

  it('no grudge changes nothing; a feud is quicker and breaks down more', () => {
    expect(pushHarder(base)).toBe(base)
    const feud = pushHarder({ ...base, grudge: 6 })
    expect(feud.pace).toBeCloseTo(0.95 * (1 - GRUDGE.pace[3]), 9)
    expect(feud.risk).toBeCloseTo(0.2 * (1 + GRUDGE.risk[3]), 9)
    // Never past the rivals' limits.
    const flat = pushHarder({ ...base, pace: TEAM_TUNING.paceLimits[0], risk: TEAM_TUNING.riskLimits[1], grudge: 8 })
    expect(flat.pace).toBe(TEAM_TUNING.paceLimits[0])
    expect(flat.risk).toBe(TEAM_TUNING.riskLimits[1])
  })

  it('on a stage a driver with a feud is quicker on a clean run', () => {
    const legs = [3000, 3000, 3000]
    let calm = 0
    let angry = 0
    for (let seed = 0; seed < 200; seed++) {
      const [a] = rivalStages('light4x4', legs, 100, 0.3, seed, [base])
      const [b] = rivalStages('light4x4', legs, 100, 0.3, seed, [{ ...base, grudge: 6 }])
      if (!a!.trouble && !b!.trouble) {
        calm += a!.time
        angry += b!.time
      }
    }
    expect(angry).toBeLessThan(calm)
  })
})

describe('heat after a raid or a round', () => {
  const field = (c: CareerState) => careerRivals(c, 'light4x4', 'regional')

  it('beating a driver makes them sore; taking the win off them stings more', () => {
    const c = newCareer(3)
    const f = field(c)
    const notes = meetRivals(c, [{ who: 'you' }, { who: 'brannigan7' }, { who: 'privateer31' }], f)
    expect(c.grudges!.brannigan7).toBe(GRUDGE.beat + GRUDGE.tookWin)
    expect(notes).toEqual([expect.objectContaining({ who: 'brannigan7', from: 0, to: 1, why: 'tookWin' })])
    // Privateers don't hold grudges.
    expect(c.grudges!.privateer31).toBeUndefined()
  })

  it('a door rub counts most; a driver who beats you settles the score', () => {
    const c = newCareer(3)
    const f = field(c)
    meetRivals(c, [{ who: 'privateer31' }, { who: 'you' }, { who: 'brannigan7' }], f, new Set(['brannigan7']))
    expect(c.grudges!.brannigan7).toBe(GRUDGE.bump + GRUDGE.beat)
    expect(grudgeLevel(c.grudges!.brannigan7!)).toBe(1)
    const notes = meetRivals(c, [{ who: 'brannigan7' }, { who: 'you' }], f)
    expect(c.grudges!.brannigan7).toBe(GRUDGE.bump + GRUDGE.beat - GRUDGE.settled)
    expect(notes[0]).toMatchObject({ from: 1, to: 0, why: 'settled' })
  })

  it('heat never runs past the top; time cools it, and a new year halves it', () => {
    const c = newCareer(3)
    const f = field(c)
    for (let k = 0; k < 10; k++) meetRivals(c, [{ who: 'you' }, { who: 'brannigan7' }], f, new Set(['brannigan7']))
    expect(c.grudges!.brannigan7).toBe(GRUDGE.max)
    coolGrudges(c, new Set(['brannigan7']))
    expect(c.grudges!.brannigan7).toBe(GRUDGE.max)
    coolGrudges(c)
    expect(c.grudges!.brannigan7).toBe(GRUDGE.max - GRUDGE.cool)
    newYearGrudges(c)
    expect(c.grudges!.brannigan7).toBe(Math.floor((GRUDGE.max - GRUDGE.cool) * GRUDGE.newYear))
    expect(grudgesNow(c)[0]).toMatchObject({ who: 'brannigan7', driver: rivalDrivers(3).brannigan7 })
  })

  it('settling a raid you won puts the grudges on the results and in the news', () => {
    const { c, state } = entered()
    finish(state, 100, () => 200)
    const s = settle(c, state)
    expect(s.pos).toBe(1)
    const teams = (state.entry.field ?? []).filter((r) => r.driver)
    expect(teams.length).toBeGreaterThan(0)
    for (const r of teams) expect(c.grudges![r.id]).toBeGreaterThanOrEqual(GRUDGE.beat)
    // The runner-up lost the win to you: that's a level up.
    expect(s.grudges.length).toBeGreaterThan(0)
    expect(c.news.some((n) => n.kind === 'grudge')).toBe(true)
  })

  it('the grudges ride into the next raid: the field carries the heat', () => {
    const { c, state } = entered()
    finish(state, 100, () => 200)
    settle(c, state)
    const next = careerRivals(c, 'light4x4', 'regional')
    expect(next.filter((r) => r.grudge).length).toBeGreaterThan(0)
  })
})

describe('door rubs on a stage', () => {
  it('catching a truck that started ahead can end in a door rub; Push makes it likelier', () => {
    let steady = 0
    let push = 0
    let conserve = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { state } = entered(seed)
      const ids = (state.entry.field ?? []).filter((r) => r.driver).map((r) => r.id)
      // On the first stage you start last; an hour quicker than all of them catches every one.
      const theirs = Object.fromEntries((state.entry.field ?? []).map((r) => [r.id, 10_000]))
      for (const [pace, add] of [['steady', (n: number) => (steady += n)], ['push', (n: number) => (push += n)], ['conserve', (n: number) => (conserve += n)]] as const) {
        state.results = [stage(6_000, theirs, pace)]
        const bumped = dustBumps(state, 0)
        for (const id of bumped) expect(ids).toContain(id)
        add(bumped.length)
      }
    }
    expect(push).toBeGreaterThan(steady)
    expect(steady).toBeGreaterThan(conserve)
  })

  it('a truck you never caught, or one stopped with trouble, is just passed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { state } = entered(seed)
      const field = state.entry.field ?? []
      // Only a few seconds quicker: nowhere near the start gap.
      state.results = [stage(9_990, Object.fromEntries(field.map((r) => [r.id, 10_000])), 'push')]
      expect(dustBumps(state, 0)).toEqual([])
      // Way quicker, but every one of them is stopped with trouble.
      state.results = [stage(5_000, Object.fromEntries(field.map((r) => [r.id, 10_000])), 'push', field.map((r) => r.id))]
      expect(dustBumps(state, 0)).toEqual([])
    }
  })

  it('a truck you rubbed doors with drives hotter for the rest of the raid', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = entered(seed)
      const field = state.entry.field ?? []
      state.results = [stage(5_000, Object.fromEntries(field.map((r) => [r.id, 10_000])), 'push')]
      const bumped = raidBumps(state)
      if (!bumped.size) continue
      const hot = raidGrudges(state, field)
      for (const id of bumped) expect(hot.find((r) => r.id === id)!.grudge).toBe(GRUDGE.bump)
      return
    }
    throw new Error('No door rubs in 40 raids')
  })

  it('free play has no door rubs (no named drivers)', () => {
    const { state } = entered()
    delete state.entry.field
    state.results = [stage(1_000, { r1: 10_000 }, 'push')]
    expect(dustBumps(state, 0)).toEqual([])
  })
})

describe('grudges in the save', () => {
  it('a career keeps its grudges and grudge news; nonsense is dropped', () => {
    const { c, state } = entered()
    finish(state, 100, () => 200)
    settle(c, state)
    const save = { ...newSave(), career: c }
    const back = readSave(JSON.parse(JSON.stringify(save))).career!
    expect(back.grudges).toEqual(c.grudges)
    expect(back.news.filter((n) => n.kind === 'grudge')).toEqual(c.news.filter((n) => n.kind === 'grudge'))
    const odd = JSON.parse(JSON.stringify(save))
    odd.career.grudges = { brannigan7: 3, privateer31: 4, highbank11: -2, hardpan501: 'hot', jackrabbit33: 99 }
    odd.career.news.unshift({ kind: 'grudge', year: 1985, who: 'brannigan7', driver: 'nobody', from: 0, to: 1, why: 'beat' })
    const read = readSave(odd).career!
    expect(read.grudges).toEqual({ brannigan7: 3, jackrabbit33: GRUDGE.max })
    expect(read.news[0]!.kind).not.toBe('grudge')
  })

  it('a save from before grudges loads with nobody holding one', () => {
    const c = newCareer(9)
    const save = JSON.parse(JSON.stringify({ ...newSave(), career: c }))
    delete save.career.grudges
    expect(readSave(save).career!.grudges).toBeUndefined()
  })

  it('a raid under way keeps its drivers and heat; an odd driver is dropped', () => {
    const { c, state } = entered()
    state.entry.field![0]!.grudge = 4
    const save = JSON.parse(JSON.stringify({ ...newSave(), career: c, raid: state }))
    const back = readSave(save).raid!
    expect(back.entry.field![0]!.grudge).toBe(4)
    expect(back.entry.field!.filter((r) => r.driver).length).toBe(state.entry.field!.filter((r) => r.driver).length)
    save.raid.entry.field[0].driver = 42
    expect(readSave(save).raid!.entry.field![0]!.driver).toBeUndefined()
  })
})

describe('grudges in words', () => {
  it('every grudge line reads as a sentence, with the driver and the team', async () => {
    const { grudgeText, newsText, whoName } = await import('../src/ui/career')
    const c = newCareer(5)
    const driver = rivalDrivers(5).brannigan7!
    expect(whoName('brannigan7', undefined, c)).toMatch(/^Tundra Dogs #7 · \S/)
    for (const why of ['bump', 'tookWin', 'beat', 'settled'] as const) {
      for (const to of [0, 1, 2, 3] as const) {
        const text = grudgeText({ who: 'brannigan7', driver, from: 1, to, why })
        expect(text).toContain('Tundra Dogs #7')
        expect(text).not.toMatch(/\{|grudge\.|undefined/)
        expect(newsText({ kind: 'grudge', year: 1985, who: 'brannigan7', driver, from: 1, to, why }, c)).toBe(text)
      }
    }
  })
})
