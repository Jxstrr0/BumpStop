/**
 * Underside hits (Kelbo, 27 November 2026): rocks reach the bottom of the
 * truck on rough ground, more often at Push, riding low or bottoming out;
 * the guards take most of them; the rest dent the oil pan, diff or fuel
 * tank, which costs a roadside patch, then leaks until the bivouac fixes it.
 */
import { describe, expect, it } from 'vitest'
import { CLASS_WORK, DRIVERS, JOBS, RAIDS } from '../src/data/raids'
import { UNDER_PARTS, UNDERSIDE } from '../src/data/underside'
import { newSave, readSave } from '../src/persist/save'
import { buildTruck, stockBuild } from '../src/sim/build'
import { buyTruck, newCareer, repairBill } from '../src/sim/career'
import { logRaid, newLog, type TruckLog } from '../src/sim/logbook'
import { bivouacJobs, doJobs, driveStage, enterRaid, finishStage, raidTruck, startStage, type RaidState } from '../src/sim/raid'
import { Rng } from '../src/sim/rng'
import {
  expectedStrikes, guardShare, heightFactor, leakPerKm, newUnderside, patchHours, rollStrikes, stageOutlook, strikeRate,
} from '../src/sim/underside'
import type { TruckBuild } from '../src/data/kit'
import { momentText } from '../src/ui/logbook'

function truckWith(guards: string, change?: (b: TruckBuild) => void) {
  const b = stockBuild('light4x4')
  b.parts.protection = guards
  change?.(b)
  return buildTruck(b)
}

/** Strikes over many rolls of the same stretch: how many the guards took and how many got through. */
function tally(guards: string, rolls = 400) {
  const truck = truckWith(guards)
  const rng = new Rng(42)
  let took = 0
  let through = 0
  for (let k = 0; k < rolls; k++) {
    for (const s of rollStrikes(rng, truck, 'rocks', 'steady', 5000, 0)) {
      if (s.part) through++
      else took++
    }
  }
  return { took, through }
}

describe('underside hits: the chance', () => {
  it('only rough ground sends rocks at the underside, and rocks the most', () => {
    const t = truckWith('noGuards')
    for (const g of ['graded', 'washboard', 'ice', 'snow'] as const) expect(strikeRate(t, g, 'steady')).toBe(0)
    for (const g of ['rough', 'whoops', 'jumps', 'iceHeaves'] as const) {
      expect(strikeRate(t, g, 'steady')).toBeGreaterThan(0)
      expect(strikeRate(t, 'rocks', 'steady')).toBeGreaterThan(strikeRate(t, g, 'steady'))
    }
  })

  it('Push hits more rocks than Steady, and Conserve fewer', () => {
    const t = truckWith('noGuards')
    expect(strikeRate(t, 'rocks', 'push')).toBeGreaterThan(strikeRate(t, 'rocks', 'steady'))
    expect(strikeRate(t, 'rocks', 'conserve')).toBeLessThan(strikeRate(t, 'rocks', 'steady'))
  })

  it('a truck riding lower gets hit more often, one riding higher less, within limits', () => {
    // The stock truck, which carries skid plates, sits at the stock height.
    expect(heightFactor(truckWith('skidPlates'))).toBeCloseTo(1, 6)
    // Armour's weight sits the truck a touch lower than no guards at all.
    expect(heightFactor(truckWith('fullArmour'))).toBeGreaterThan(heightFactor(truckWith('noGuards')))
    const soft = truckWith('noGuards', (b) => {
      b.front.springRate = 20000
      b.rear.springRate = 20000
    })
    const lifted = truckWith('noGuards', (b) => {
      b.front.preload = 0.04
      b.rear.preload = 0.04
    })
    expect(heightFactor(soft)).toBeGreaterThan(1.5)
    expect(heightFactor(soft)).toBeLessThanOrEqual(UNDERSIDE.heightLimits[1])
    expect(heightFactor(lifted)).toBeLessThan(1)
    expect(heightFactor(lifted)).toBeGreaterThanOrEqual(UNDERSIDE.heightLimits[0])
  })

  it('every hard bottom-out slams the belly down: more strikes on the same stretch', () => {
    const t = truckWith('noGuards')
    expect(expectedStrikes(t, 'rocks', 'steady', 5000, 10)).toBeGreaterThan(expectedStrikes(t, 'rocks', 'steady', 5000, 0))
    // Not on ground with no rocks.
    expect(expectedStrikes(t, 'graded', 'steady', 5000, 10)).toBe(0)
  })
})

describe('underside hits: the guards', () => {
  it('skid plates take about two in three, full armour nearly all, and no guards none', () => {
    expect(guardShare(truckWith('noGuards'))).toBe(0)
    expect(guardShare(truckWith('skidPlates'))).toBeCloseTo(0.65, 6)
    expect(guardShare(truckWith('fullArmour'))).toBeGreaterThan(0.9)
    const bare = tally('noGuards')
    const plates = tally('skidPlates')
    const armour = tally('fullArmour')
    expect(bare.took).toBe(0)
    expect(plates.through).toBeLessThan(bare.through * 0.5)
    expect(armour.through).toBeLessThan(plates.through * 0.4)
  })

  it('strikes come in order along the stretch, each on one part with a fair dent, or taken by the guards', () => {
    const t = truckWith('skidPlates')
    const rng = new Rng(7)
    for (let k = 0; k < 200; k++) {
      const list = rollStrikes(rng, t, 'rocks', 'push', 4000, 3)
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!
        expect(s.at).toBeGreaterThanOrEqual(0)
        expect(s.at).toBeLessThanOrEqual(4000)
        if (i > 0) expect(s.at).toBeGreaterThanOrEqual(list[i - 1]!.at)
        if (s.part) {
          expect(UNDER_PARTS).toContain(s.part)
          expect(s.damage).toBeGreaterThanOrEqual(UNDERSIDE.hitDamage[0])
          expect(s.damage).toBeLessThanOrEqual(UNDERSIDE.hitDamage[1])
        } else expect(s.damage).toBe(0)
      }
    }
  })

  it('the morning outlook: a rocky stage expects more through no guards than plates, and plates more than armour', () => {
    const stage = RAIDS.summerRaid.stages[2]!
    const bare = stageOutlook(truckWith('noGuards'), stage.segments, 'steady')
    const plates = stageOutlook(truckWith('skidPlates'), stage.segments, 'steady')
    const armour = stageOutlook(truckWith('fullArmour'), stage.segments, 'steady')
    expect(bare).toBeGreaterThan(plates)
    expect(plates).toBeGreaterThan(armour)
    // A winter stage of snow sends hardly any.
    expect(stageOutlook(truckWith('noGuards'), RAIDS.winterSprint.stages[0]!.segments, 'steady')).toBeLessThan(bare)
  })
})

describe('underside hits: patching and leaks', () => {
  it('a dented part takes longer to patch, and leaks in proportion to the dent', () => {
    expect(patchHours('sump', 0.5)).toBeGreaterThan(patchHours('sump', 0))
    expect(leakPerKm(newUnderside())).toBe(0)
    const half = { ...newUnderside(), sump: 0.5 }
    expect(leakPerKm(half)).toBeCloseTo(UNDERSIDE.leakPerKm.sump * 0.5, 6)
  })
})

/** The Summer Raid's rock stage with no guards, Push all day, on a seed with rocks getting through. */
function rockyDay(): RaidState {
  for (let seed = 1; seed < 40; seed++) {
    const b = stockBuild('light4x4')
    b.parts.protection = 'noGuards'
    const state = enterRaid('summerRaid', b, 'veteran', { seed })
    for (let k = 0; k < 3; k++) {
      const run = startStage(state, raidTruck(state), 'push')
      driveStage(state, run, ['push', 'push', 'push'])
      finishStage(state, run)
      if (state.results[k]!.stops.some((s) => s.fix === 'patch')) return state
      if (state.phase === 'bivouac') doJobs(state, [])
    }
  }
  throw new Error('No rocks got through on any seed')
}

describe('underside hits in a raid', { timeout: 120_000 }, () => {
  it('a new raid starts with nothing dented', () => {
    expect(enterRaid('summerSprint', stockBuild('light4x4'), 'veteran').under).toEqual(newUnderside())
  })

  it('a rock that gets through stops the truck to patch it, dents the part, and the leak costs time', () => {
    const state = rockyDay()
    const rec = state.results[state.results.length - 1]!
    const hits = rec.stops.filter((s) => s.fix === 'patch')
    expect(hits.length).toBeGreaterThan(0)
    const work = CLASS_WORK.light4x4 * DRIVERS.veteran.fixTime * 3600
    for (const h of hits) {
      expect(UNDER_PARTS).toContain(h.kind)
      expect(h.corner).toBe(-1)
      expect(h.lost).toBeGreaterThanOrEqual(UNDERSIDE.patchHours[h.kind as 'sump'] * work - 1e-6)
    }
    // The stops stay in order along the stage, so the live log reads right.
    for (let i = 1; i < rec.stops.length; i++) expect(rec.stops[i]!.at).toBeGreaterThanOrEqual(rec.stops[i - 1]!.at)
    expect(UNDER_PARTS.some((p) => state.under[p] > 0)).toBe(true)
    expect(rec.leak).toBeGreaterThan(0)
    expect(rec.guardHits).toBe(0)
  })

  it('the same raid on the same seed hits the same rocks', () => {
    const go = () => {
      const b = stockBuild('light4x4')
      b.parts.protection = 'noGuards'
      const s = enterRaid('summerRaid', b, 'charger', { seed: 3 })
      const run = startStage(s, raidTruck(s), 'push')
      driveStage(s, run, ['push', 'push', 'push'])
      finishStage(s, run)
      return s
    }
    expect(go().results).toEqual(go().results)
  })

  it('the bivouac can weld, reseal or patch a dent, for hours and money, and that stops the leak', () => {
    const state = rockyDay()
    const jobs = bivouacJobs(state).filter((j) => UNDER_PARTS.includes(j.part as 'sump'))
    expect(jobs.length).toBeGreaterThan(0)
    for (const j of jobs) {
      expect(j.cost).toBeGreaterThan(0)
      expect(j.hours).toBeGreaterThan(0)
      expect(j.after).toBe(0)
      expect(JOBS[j.kind].part).toBe(j.part)
    }
    if (state.phase !== 'bivouac') return
    const job = jobs[0]!
    doJobs(state, [job])
    expect(state.under[job.part as 'sump']).toBe(0)
  })

  it('the career pays to put dents right after the raid', () => {
    const c = newCareer(1)
    c.money = 1e6
    buyTruck(c, 'light4x4')
    const s = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran', { budget: 5000 })
    const before = repairBill(c, s).repairs
    s.under = { sump: 1, diff: 0.5, tank: 0 }
    expect(repairBill(c, s).repairs).toBeGreaterThan(before)
  })
})

describe('underside hits in saves and the logbook', () => {
  it('a raid saved before underside hits loads with nothing dented', () => {
    const s = newSave()
    s.raid = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const old = structuredClone(s) as unknown as { raid: Record<string, unknown> }
    delete old.raid.under
    expect(readSave(JSON.parse(JSON.stringify(old))).raid!.under).toEqual(newUnderside())
  })

  it('keeps the dents through a save, and turns away nonsense', () => {
    const s = newSave()
    s.raid = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    s.raid.under = { sump: 0.4, diff: 0, tank: 1 }
    expect(readSave(JSON.parse(JSON.stringify(s))).raid).toEqual(s.raid)
    const bad = JSON.parse(JSON.stringify(s))
    bad.raid.under.tank = 1.5
    expect(() => readSave(bad)).toThrow()
    const missing = JSON.parse(JSON.stringify(s))
    delete missing.raid.under.diff
    expect(() => readSave(missing)).toThrow()
  })

  it('the worst stop of a raid can be a rock, and the logbook keeps it through a save', () => {
    const state = rockyDay()
    // Make the rock the costliest stop of the raid.
    for (const r of state.results) for (const st of r.stops) if (st.fix !== 'patch') st.lost = 1
    const holder: { year: number; own: TruckBuild; trucks: TruckLog[] } = { year: 1990, own: stockBuild('light4x4'), trucks: [newLog(1, 'light4x4', 1990)] }
    logRaid(holder, state, 2, false, false)
    const moment = holder.trucks[0]!.moments.find((m) => m.kind === 'hit')
    expect(moment).toBeDefined()
    expect(momentText(moment!)).toMatch(/^Washboard 800|’90: a rock /)
    // Through a save with a career, the moment stays.
    const save = newSave()
    const c = newCareer(1)
    c.money = 1e6
    buyTruck(c, 'light4x4')
    c.trucks[c.trucks.length - 1]!.moments.unshift(moment!)
    save.career = c
    const loaded = readSave(JSON.parse(JSON.stringify(save)))
    expect(loaded.career!.trucks.at(-1)!.moments[0]).toEqual(moment)
  })
})
