/**
 * The recovery kit (Kelbo picked it, 27 November 2026): trucks bog in soft
 * snow and thawed gravel and hang up on rocks; the shovel digs out the
 * shallow ones, the kit's boards, jack and winch reach deeper and work
 * faster, and a truck nothing on board can free is towed out by the sweep
 * truck, which loses the stage and costs the crew hours at the bivouac.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { KITS, type TruckBuild } from '../src/data/kit'
import { PARTS, type RecoveryPart } from '../src/data/parts'
import { RAID } from '../src/data/raids'
import { RECOVERY } from '../src/data/recovery'
import { readBuild } from '../src/persist/save'
import { buildTruck, kitWeights, massAndCost, stockBuild } from '../src/sim/build'
import { loadShift } from '../src/sim/load'
import { logRaid, newLog, type TruckLog } from '../src/sim/logbook'
import {
  bivouacHours, closingTime, driveStage, enterRaid, finishStage, raidTruck, startStage, sweptIn,
} from '../src/sim/raid'
import {
  bogRate, hangRate, hasKit, jackFactor, kitReach, kitTools, pressureFactor, recovery, rollStuck, snowbankRecovery,
  stuckOutlook, towShare, weightFactor,
} from '../src/sim/recovery'
import { Rng } from '../src/sim/rng'
import { CORNERS } from '../src/data/winter'
import { momentText } from '../src/ui/logbook'

function truckWith(kit: string, change?: (b: TruckBuild) => void) {
  const b = stockBuild('light4x4')
  b.parts.recovery = kit
  change?.(b)
  return buildTruck(b)
}

const KITS_IN_ORDER = PARTS.filter((p): p is RecoveryPart => p.slot === 'recovery')

describe('the parts', () => {
  it('every class starts with the shovel only, which weighs and costs nothing', () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      expect(KITS[cls].stock.parts.recovery).toBe('shovelOnly')
      const shovel = KITS_IN_ORDER.find((p) => p.id === 'shovelOnly')!
      expect(shovel.mass[cls]).toBe(0)
      expect(shovel.cost[cls]).toBe(0)
    }
  })

  it('come in every class, inside the era, and a winch kit is the heaviest', () => {
    for (const p of KITS_IN_ORDER) {
      expect(p.year).toBeGreaterThanOrEqual(1985)
      expect(p.year).toBeLessThanOrEqual(2025)
      for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
        expect(p.mass[cls], `${p.id} ${cls}`).toBeDefined()
        expect(p.cost[cls], `${p.id} ${cls}`).toBeDefined()
      }
    }
    const light = (id: string) => KITS_IN_ORDER.find((p) => p.id === id)!.mass.light4x4!
    expect(light('cableWinch')).toBeGreaterThan(light('laddersJack'))
    expect(light('ropeWinch')).toBeLessThan(light('cableWinch'))
    expect(light('boardsJack')).toBeLessThan(light('laddersJack'))
  })

  it('an old build with no recovery slot reads back with the shovel only', () => {
    const b = stockBuild('heavy') as TruckBuild & { parts: Record<string, string> }
    const raw = structuredClone(b) as { parts: Record<string, string> }
    delete raw.parts.recovery
    expect(readBuild(raw).parts.recovery).toBe('shovelOnly')
  })

  it('the kit adds its weight to the truck', () => {
    const bare = massAndCost(stockBuild('light4x4')).mass
    expect(truckWith('cableWinch').mass).toBeCloseTo(bare + 75, 6)
  })
})

describe('where the kit rides (weight and balance)', () => {
  it('the winch sits on the front bumper and the boards and jack at the back', () => {
    const b = stockBuild('light4x4')
    b.parts.recovery = 'cableWinch'
    const w = kitWeights(b)
    expect(w.front).toBe(RECOVERY.winchMass.cable.light4x4)
    expect(w.front + w.rear).toBe(75)
    b.parts.recovery = 'laddersJack'
    expect(kitWeights(b)).toEqual({ front: 0, rear: 37 })
  })

  it('no kit moves nothing; a winch pulls the balance forward of boards alone', () => {
    expect(loadShift('light4x4', undefined, 0, 1500, { front: 0, rear: 0 })).toEqual({ dMass: 0, dx: 0, dy: 0, dPitch: 0, dRoll: 0 })
    const back = loadShift('light4x4', undefined, 0, 1500, { front: 0, rear: 37 })
    const both = loadShift('light4x4', undefined, 0, 1500, { front: 38, rear: 37 })
    expect(back.dMass).toBe(0)
    expect(back.dx).toBeLessThan(0)
    expect(both.dx).toBeGreaterThan(back.dx)
    expect(both.dPitch).toBeGreaterThan(back.dPitch)
  })
})

describe('getting stuck', () => {
  it('bogs only on soft ground, and a thaw softens the gravel', () => {
    const t = truckWith('shovelOnly')
    expect(bogRate(t, 'graded', 'steady')).toBe(0)
    expect(bogRate(t, 'rocks', 'steady')).toBe(0)
    expect(bogRate(t, 'snow', 'steady')).toBeGreaterThan(0)
    expect(bogRate(t, 'graded', 'steady', 'thaw')).toBeGreaterThan(0)
    expect(bogRate(t, 'snow', 'steady', 'whiteout')).toBeGreaterThan(bogRate(t, 'snow', 'steady'))
    expect(bogRate(t, 'snow', 'push')).toBeGreaterThan(bogRate(t, 'snow', 'conserve'))
  })

  it('airing down bogs less, and a heavier truck bogs more', () => {
    const stock = truckWith('shovelOnly')
    const aired = truckWith('shovelOnly', (b) => {
      b.front.tirePressure *= 0.7
      b.rear.tirePressure *= 0.7
    })
    expect(pressureFactor(stock)).toBeCloseTo(1, 6)
    expect(bogRate(aired, 'snow', 'steady')).toBeLessThan(bogRate(stock, 'snow', 'steady'))
    expect(weightFactor(stock)).toBeCloseTo(1, 6)
    expect(weightFactor(truckWith('cableWinch'))).toBeGreaterThan(1)
    expect(bogRate(truckWith('cableWinch'), 'snow', 'steady')).toBeGreaterThan(bogRate(stock, 'snow', 'steady'))
  })

  it('hangs up on rocks, more when the truck rides low', () => {
    const stock = truckWith('shovelOnly')
    const low = truckWith('shovelOnly', (b) => {
      b.front.preload = KITS.light4x4.ranges.preload.min
      b.rear.preload = KITS.light4x4.ranges.preload.min
      b.front.springRate = KITS.light4x4.ranges.springRate.min
      b.rear.springRate = KITS.light4x4.ranges.springRate.min
    })
    expect(hangRate(stock, 'graded', 'steady')).toBe(0)
    expect(hangRate(stock, 'rocks', 'steady')).toBeGreaterThan(0)
    expect(hangRate(low, 'rocks', 'steady')).toBeGreaterThan(hangRate(stock, 'rocks', 'steady'))
  })

  it('rolls the same for the same seed, in order along the stretch, each 0 to 1 deep', () => {
    const t = truckWith('shovelOnly')
    const a = rollStuck(new Rng(7), t, 'snow', 'push', 3000000)
    const b = rollStuck(new Rng(7), t, 'snow', 'push', 3000000)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    for (let k = 1; k < a.length; k++) expect(a[k]!.at).toBeGreaterThanOrEqual(a[k - 1]!.at)
    for (const s of a) {
      expect(s.kind).toBe('bogged')
      expect(s.depth).toBeGreaterThanOrEqual(0)
      expect(s.depth).toBeLessThanOrEqual(1)
    }
  })
})

describe('getting out', () => {
  it('the shovel only reaches the shallow ones; a winch reaches anything', () => {
    const shovel = truckWith('shovelOnly')
    expect(kitTools(shovel)).toEqual(['shovel'])
    expect(hasKit(shovel)).toBe(false)
    expect(recovery(shovel, 'bogged', 0.3)?.tool).toBe('shovel')
    expect(recovery(shovel, 'bogged', 0.5)).toBeNull()
    const winch = truckWith('cableWinch')
    expect(kitTools(winch)).toEqual(['shovel', 'boards', 'jack', 'winch'])
    expect(kitReach(winch, 'hungUp')).toBe(1)
    expect(recovery(winch, 'hungUp', 1)?.tool).toBe('winch')
    expect(towShare(winch, 'bogged', 'push')).toBe(0)
  })

  it('boards are for bogs, a jack for hang-ups', () => {
    const ladders = truckWith('sandLadders')
    expect(recovery(ladders, 'bogged', 0.7)?.tool).toBe('boards')
    expect(recovery(ladders, 'hungUp', 0.7)).toBeNull()
    const jack = truckWith('laddersJack')
    expect(recovery(jack, 'hungUp', 0.7)?.tool).toBe('jack')
  })

  it('picks the quickest tool that reaches, and deeper takes longer', () => {
    const winch = truckWith('cableWinch')
    // Even a shallow bog: the winch is quicker than the shovel.
    expect(recovery(winch, 'bogged', 0.1)?.tool).toBe('winch')
    expect(recovery(winch, 'bogged', 0.9)!.hours).toBeGreaterThan(recovery(winch, 'bogged', 0.1)!.hours)
    // Nylon boards and a rope winch are quicker than steel.
    expect(recovery(truckWith('ropeWinch'), 'bogged', 0.5)!.hours).toBeLessThan(recovery(winch, 'bogged', 0.5)!.hours)
    expect(recovery(truckWith('boardsJack'), 'bogged', 0.5)!.hours).toBeLessThan(recovery(truckWith('laddersJack'), 'bogged', 0.5)!.hours)
  })

  it('the kit gets a slid truck out of the snowbank quicker than the shovel', () => {
    expect(snowbankRecovery(truckWith('shovelOnly'))).toEqual({ tool: 'shovel', seconds: CORNERS.digOut })
    const out = snowbankRecovery(truckWith('cableWinch'))
    expect(out.tool).toBe('winch')
    expect(out.seconds).toBeLessThan(CORNERS.digOut)
  })

  it('a high-lift jack speeds up roadside wheel swaps', () => {
    expect(jackFactor(truckWith('shovelOnly'))).toBe(1)
    expect(jackFactor(truckWith('sandLadders'))).toBe(1)
    expect(jackFactor(truckWith('laddersJack'))).toBe(RECOVERY.jackFix)
  })

  it('the outlook: a kit leaves fewer stuck trucks for the sweep truck', () => {
    const segs = [{ ground: 'snow' as const, km: 100 }, { ground: 'rocks' as const, km: 10 }]
    const bare = stuckOutlook(truckWith('shovelOnly'), segs, 'steady')
    const kit = stuckOutlook(truckWith('laddersJack'), segs, 'steady')
    expect(bare.stuck).toBeGreaterThan(0)
    expect(bare.tows).toBeGreaterThan(kit.tows)
    expect(stuckOutlook(truckWith('cableWinch'), segs, 'steady').tows).toBe(0)
  })
})

describe('on a raid stage', () => {
  // Make the snow very soft for these, so the stage gets stuck for sure (and put it back after).
  const snow = RECOVERY.bogPerKm.snow!
  const soft = (on: boolean) => ((RECOVERY.bogPerKm as Record<string, number>).snow = on ? 0.08 : snow)
  afterEach(() => soft(false))

  function firstStage(kit: string) {
    soft(true)
    const b = stockBuild('light4x4')
    b.parts.recovery = kit
    b.parts.tires = 'studdedRally'
    const state = enterRaid('winterSprint', b, 'veteran')
    const run = startStage(state, raidTruck(state), 'steady')
    driveStage(state, run, ['steady', 'steady', 'steady'])
    const close = closingTime(run)
    const rec = finishStage(state, run)
    return { state, rec, close }
  }

  it('with only the shovel, a deep bog waits for the sweep truck: the stage is lost and the night is short', () => {
    const { state, rec, close } = firstStage('shovelOnly')
    const swept = rec.stops.find((s) => s.fix === 'sweep')
    expect(swept, 'towed by the sweep truck').toBeDefined()
    expect(swept!.kind).toBe('bogged')
    expect(swept!.depth!).toBeGreaterThan(RECOVERY.reach.shovel.bogged)
    expect(rec.late).toBe(true)
    expect(rec.time).toBeCloseTo(close + RAID.latePenalty, 6)
    // Stops before it were dug out with the shovel, never deeper than it reaches.
    for (const s of rec.stops.filter((x) => x.fix === 'shovel')) expect(s.depth!).toBeLessThanOrEqual(RECOVERY.reach.shovel.bogged)
    expect(state.phase).toBe('bivouac')
    expect(sweptIn(state)).toBe(true)
    expect(bivouacHours(state)).toBe(RAID.bivouacHours - RECOVERY.sweepHours)
  })

  it('with a winch the same stage is finished: every bog winched out', () => {
    const { state, rec } = firstStage('cableWinch')
    const stuck = rec.stops.filter((s) => s.kind === 'bogged')
    expect(stuck.length).toBeGreaterThan(0)
    expect(stuck.every((s) => s.fix === 'winch')).toBe(true)
    expect(rec.late).toBe(false)
    expect(sweptIn(state)).toBe(false)
    expect(bivouacHours(state)).toBe(RAID.bivouacHours)
  })

  it('the logbook keeps the tow as the raid\'s worst moment', () => {
    const { state } = firstStage('shovelOnly')
    const c: { year: number; own: TruckBuild; trucks: TruckLog[] } = { year: 1990, own: state.entry.build, trucks: [newLog(1, 'light4x4', 1990)] }
    logRaid(c, state, null, false, false)
    const m = c.trucks[0]!.moments.find((x) => x.kind === 'stuck')
    expect(m).toMatchObject({ kind: 'stuck', how: 'bogged', fix: 'sweep' })
    expect(momentText(m!)).toContain('sweep truck')
  })
})
