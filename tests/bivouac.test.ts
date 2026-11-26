/**
 * Bivouac breakdowns (after 1.2): shock oil cooks, springs sag and bushings
 * crack over a raid, each night the crew has hours, spares and money for
 * parts, and it can't fix everything.
 */
import { describe, expect, it } from 'vitest'
import { CAREER, CLASS_MONEY } from '../src/data/career'
import { CONDITION, FREE_PLAY_PARTS_MONEY } from '../src/data/condition'
import { CLASS_WORK, JOBS, RAID } from '../src/data/raids'
import { newSave, readSave } from '../src/persist/save'
import { buildTruck, stockBuild } from '../src/sim/build'
import { buyTruck, enterOwn, newCareer, repairBill, settle } from '../src/sim/career'
import { conditionEffect, newCondition, wornTruck } from '../src/sim/condition'
import {
  bivouacJobs, checkJobs, doJobs, driveStage, enterRaid, finishStage, partsBudget, partsMoney, raidTruck, startStage, type RaidState,
} from '../src/sim/raid'

/** The Summer Sprint's first stage, driven Steady, and on to the bivouac. */
function afterStage(cond?: Partial<RaidState['cond']>): RaidState {
  const b = stockBuild('light4x4')
  b.parts.spares = 'lightKit'
  const state = enterRaid('summerSprint', b, 'gravelAce')
  if (cond) Object.assign(state.cond, structuredClone(cond))
  const run = startStage(state, raidTruck(state), 'steady')
  driveStage(state, run, ['steady', 'steady', 'steady'])
  finishStage(state, run)
  return state
}

describe('the truck wears in over a raid', { timeout: 60_000 }, () => {
  it('a new raid starts with fresh oil, springs and bushings, and the free-play parts money for its class', () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      const state = enterRaid('summerSprint', stockBuild(cls), 'veteran')
      expect(state.cond).toEqual(newCondition())
      expect(state.spent).toBe(0)
      expect(partsBudget(state)).toBe(FREE_PLAY_PARTS_MONEY * CLASS_MONEY[cls])
    }
  })

  it('a stage cooks the oil and sags the springs and bushings on both axles, and never past worn out', () => {
    const state = afterStage()
    for (const part of ['oil', 'bushing', 'spring'] as const) {
      for (const v of state.cond[part]) {
        expect(v).toBeGreaterThan(0.03)
        expect(v).toBeLessThan(0.5)
      }
    }
    // Hotter shocks tire their oil faster: the hotter axle has the more tired oil.
    const tired = afterStage({ oil: [0.95, 0.95] })
    for (const v of tired.cond.oil) expect(v).toBeLessThanOrEqual(1)
  })

  it('a worn truck damps less, fades sooner, sits lower and has weaker mounts; the original is left alone', () => {
    const fresh = buildTruck(stockBuild('light4x4'))
    const before = structuredClone(fresh)
    expect(wornTruck(fresh, newCondition())).toEqual(fresh)
    const worn = wornTruck(fresh, { oil: [0, 1], bushing: [1, 0], spring: [0.5, 0] })
    expect(fresh).toEqual(before)
    // Rear oil worn out: damping and the red line drop on the rear only.
    expect(worn.ride.rear.damper.compLow).toBeCloseTo(fresh.ride.rear.damper.compLow * (1 - CONDITION.oil.damping), 6)
    expect(worn.ride.rear.damper.redLine).toBeCloseTo(fresh.ride.rear.damper.redLine - CONDITION.oil.redDrop, 6)
    expect(worn.ride.front.damper).toEqual(fresh.ride.front.damper)
    // Front springs half sagged: travel moves from bump to droop.
    const lost = fresh.ride.front.bumpTravel * 0.5 * CONDITION.spring.travel
    expect(worn.ride.front.bumpTravel).toBeCloseTo(fresh.ride.front.bumpTravel - lost, 9)
    expect(worn.ride.front.droopTravel).toBeCloseTo(fresh.ride.front.droopTravel + lost, 9)
    expect(worn.ride.rear.bumpTravel).toBe(fresh.ride.rear.bumpTravel)
    // Front bushings cracked: weaker front mounts.
    expect(worn.wear.front.mount.ultimate).toBeCloseTo(fresh.wear.front.mount.ultimate * (1 - CONDITION.bushing.mount), 3)
    expect(worn.wear.rear.mount).toEqual(fresh.wear.rear.mount)
    expect(conditionEffect('oil', 0.5)).toEqual({ damping: 0.15, fadeSooner: CONDITION.oil.redDrop / 2, travel: 0, mount: 0 })
  })

  it('a stage drives the worn truck: tired oil runs closer to its red line than fresh oil', () => {
    const margin = (cond?: Partial<RaidState['cond']>) => {
      const b = stockBuild('light4x4')
      const state = enterRaid('summerSprint', b, 'gravelAce')
      if (cond) Object.assign(state.cond, cond)
      const run = startStage(state, raidTruck(state), 'steady')
      driveStage(state, run, ['steady', 'steady', 'steady'])
      const red = Math.min(run.truck.ride.front.damper.redLine, run.truck.ride.rear.damper.redLine)
      return red - Math.max(...run.trace.oil)
    }
    expect(margin({ oil: [1, 1] })).toBeLessThan(margin() - 5)
  })
})

describe('the bivouac', { timeout: 60_000 }, () => {
  it('lists oil, bushings and springs per axle, with the class hours and money', () => {
    const state = afterStage()
    const jobs = bivouacJobs(state)
    const oil = jobs.filter((j) => j.part === 'oil')
    expect(oil.map((j) => j.index).sort()).toEqual([0, 1])
    const springs = jobs.filter((j) => j.part === 'spring' && j.index === 1)
    expect(springs.map((j) => j.kind).sort()).toEqual(['newSprings', 'resetSprings'])
    const rear = oil.find((j) => j.index === 1)!
    expect(rear.hours).toBe(JOBS.freshOil.hours * CLASS_WORK.light4x4)
    expect(rear.cost).toBe(JOBS.freshOil.cost)
    expect(rear.after).toBe(0)
  })

  it('a heavy truck pays more for the same job', () => {
    const state = enterRaid('summerSprint', stockBuild('heavy'), 'veteran')
    state.cond.oil = [0.4, 0.4]
    state.phase = 'bivouac'
    state.stage = 1
    const job = bivouacJobs(state).find((j) => j.kind === 'freshOil')!
    expect(job.cost).toBe(Math.round(JOBS.freshOil.cost * CLASS_MONEY.heavy))
    expect(job.hours).toBe(JOBS.freshOil.hours * CLASS_WORK.heavy)
  })

  it('does the jobs, spends the money, and turns away a night the money cannot cover', () => {
    const state = afterStage({ oil: [0.6, 0.6], bushing: [0.6, 0.6], spring: [0.6, 0.6] })
    const jobs = bivouacJobs(state)
    const oil = jobs.find((j) => j.kind === 'freshOil' && j.index === 1)!
    const reset = jobs.find((j) => j.kind === 'resetSprings' && j.index === 0)!
    const springs = state.cond.spring[0]!
    doJobs(state, [oil, reset])
    expect(state.cond.oil[1]).toBe(0)
    expect(state.cond.spring[0]).toBeCloseTo(springs * JOBS.resetSprings.keep, 9)
    expect(state.spent).toBe(oil.cost)
    expect(partsMoney(state)).toBe(partsBudget(state) - oil.cost)

    // Spend nearly all of it, and new springs no longer fit.
    state.spent = partsBudget(state) - 100
    state.phase = 'bivouac'
    const pricey = bivouacJobs(state).find((j) => j.kind === 'newSprings')!
    expect(checkJobs(state, [pricey])).toEqual({ kind: 'money', over: pricey.cost - 100 })
    const free = bivouacJobs(state).find((j) => j.kind === 'resetSprings')!
    expect(checkJobs(state, [free])).toBeNull()
  })

  it('a new or rebuilt shock goes in with fresh oil: half the axle’s oil is new', () => {
    const state = afterStage({ oil: [0.8, 0.8] })
    state.wear.bottoming[2]!.damage = 0.5
    const oil = state.cond.oil[1]!
    const rebuild = bivouacJobs(state).find((j) => j.kind === 'rebuildShock' && j.index === 2)!
    doJobs(state, [rebuild])
    expect(state.cond.oil[1]).toBeCloseTo(oil * CONDITION.oneShock, 9)
  })

  it('can’t fix everything in one night: a worn truck has more jobs than hours', () => {
    const state = afterStage({ oil: [0.7, 0.7], bushing: [0.7, 0.7], spring: [0.7, 0.7] })
    let hours = 0
    for (const part of ['oil', 'bushing', 'spring'] as const) {
      for (const axle of [0, 1]) {
        const best = bivouacJobs(state).filter((j) => j.part === part && j.index === axle).sort((a, b) => a.after - b.after)[0]!
        hours += best.hours
      }
    }
    expect(hours).toBeGreaterThan(RAID.bivouacHours)
  })
})

describe('bivouac money in the career', { timeout: 60_000 }, () => {
  it('a career raid spends the garage’s own money, settled after the raid with the condition left', () => {
    const c = newCareer(5)
    c.money = 40_000
    buyTruck(c, 'light4x4')
    const state = enterOwn(c, 'veteran')
    expect(state.entry.budget).toBe(c.money)
    state.spent = 300
    state.cond.oil = [1, 0]
    const bill = repairBill(c, state)
    expect(bill.repairs).toBe(Math.round(JOBS.freshOil.cost * CAREER.repairShare))
    // Finish the raid on paper and settle.
    for (let k = 0; k < 3; k++) state.results.push({ time: 100, paces: [], stops: [], late: false, limped: false, rivals: [] })
    state.stage = 3
    state.phase = 'done'
    const money = c.money
    const s = settle(c, state)
    expect(s.bivouac).toBe(300)
    expect(c.money).toBe(money + s.prize - s.repairs - s.spares - s.bivouac)
  })

  it('a broke garage enters with no money for parts, but the free jobs still fit', () => {
    const c = newCareer(5)
    c.money = 40_000
    buyTruck(c, 'light4x4')
    c.money = -500
    const state = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran', { budget: c.money })
    expect(partsBudget(state)).toBe(0)
  })
})

describe('bivouac saves', () => {
  it('a raid saved before bivouac breakdowns loads with a fresh truck and nothing spent', () => {
    const s = newSave()
    s.raid = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const old = structuredClone(s) as unknown as { raid: Record<string, unknown> }
    delete old.raid.cond
    delete old.raid.spent
    const loaded = readSave(JSON.parse(JSON.stringify(old)))
    expect(loaded.raid!.cond).toEqual(newCondition())
    expect(loaded.raid!.spent).toBe(0)
  })

  it('keeps the condition and money through a save, and turns away nonsense', () => {
    const s = newSave()
    s.raid = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran', { budget: 2000 })
    s.raid.cond = { oil: [0.25, 0.5], bushing: [0.1, 0], spring: [0, 0.3] }
    s.raid.spent = 240
    const loaded = readSave(JSON.parse(JSON.stringify(s)))
    expect(loaded.raid).toEqual(s.raid)
    const bad = JSON.parse(JSON.stringify(s))
    bad.raid.cond.oil = [2, 0]
    expect(() => readSave(bad)).toThrow()
    const short = JSON.parse(JSON.stringify(s))
    short.raid.cond.spring = [0]
    expect(() => readSave(short)).toThrow()
  })
})
