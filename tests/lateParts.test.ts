/**
 * The 2017 to 2025 parts (Kelbo, 26 November 2026): the Zed-Two spool-valve
 * dampers, which damp by where the wheel is in its travel and care less how
 * hot the oil is, plus aramid tires, forged beadlocks, gas-charged bump stops
 * and two twin-turbo engines, so the last career years have something new.
 */
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { LAST_YEAR, PARTS, type DamperPart } from '../src/data/parts'
import { RIGS } from '../src/data/rigs'
import type { DamperSetup } from '../src/data/ride'
import { t } from '../src/data/strings'
import { buildTruck, checkBuild, fitsClass, stockBuild } from '../src/sim/build'
import { runLaps } from '../src/sim/laps'
import { dampingMultiplier, positionScale } from '../src/sim/ride'
import { fromCelsius } from '../src/sim/units'
import { fixUseful } from '../src/ui/fixes'

const spool = PARTS.find((p) => p.id === 'spoolValve') as DamperPart

describe('the 2017 to 2025 parts', () => {
  const late = PARTS.filter((p) => p.year > 2016)

  it('are all on sale by 2025, named in words, and some come out in each of several years', () => {
    expect(late.length).toBeGreaterThanOrEqual(6)
    for (const p of late) {
      expect(p.year).toBeLessThanOrEqual(LAST_YEAR)
      expect(t(p.name)).not.toBe(p.name)
      expect(t(p.text)).not.toBe(p.text)
    }
    expect(new Set(late.map((p) => p.year)).size).toBeGreaterThanOrEqual(4)
  })

  it('give every class something new after 2016', () => {
    for (const c of CLASSES) expect(late.filter((p) => fitsClass(p, c.id)).length, c.id).toBeGreaterThanOrEqual(4)
  })

  it('can’t be bought before their year', () => {
    const b = stockBuild('light4x4')
    b.parts.dampers = 'spoolValve'
    const rules = { year: 2016, budget: 1e9 }
    expect(checkBuild(b, rules).some((p) => p.kind === 'notYet')).toBe(true)
    expect(checkBuild(b, { ...rules, year: 2017 }).some((p) => p.kind === 'notYet')).toBe(false)
  })
})

describe('Zed-Two spool-valve dampers', () => {
  it('come in every class, out in 2017, with every adjuster', () => {
    expect(spool.year).toBe(2017)
    for (const c of CLASSES) expect(fitsClass(spool, c.id)).toBe(true)
    expect(spool.clicks).toEqual({ compLow: 4, compHigh: 4, rebound: 4 })
    expect(t(spool.name)).toBe('Zed-Two spool-valve dampers')
  })

  it('pass their spool valves to the ride sim; other dampers have none', () => {
    const b = stockBuild('heavy')
    expect(buildTruck(b).ride.front.damper.position).toBeUndefined()
    expect(buildTruck(b).ride.front.damper.oilSense).toBeUndefined()
    b.parts.dampers = 'spoolValve'
    const d = buildTruck(b).ride.rear.damper
    expect(d.position).toEqual(spool.spool!.position)
    expect(d.oilSense).toBe(spool.spool!.oilSense)
  })

  describe('damping by position', () => {
    const d = buildTruck({ ...stockBuild('light4x4'), parts: { ...stockBuild('light4x4').parts, dampers: 'spoolValve' } }).ride.front.damper
    const pd = d.position!
    const bump = 0.12
    const droop = 0.1

    it('is a touch soft through the middle of the travel, both ways', () => {
      for (const c of [-0.05, 0, 0.05]) {
        expect(positionScale(c, 1, d, bump, droop)).toBe(pd.mid)
        expect(positionScale(c, -1, d, bump, droop)).toBe(pd.mid)
      }
    })

    it('firms up compression near the bump end, smoothly, up to its end value', () => {
      const start = bump * (1 - pd.zone)
      let last = pd.mid
      for (let c = start; c <= bump; c += bump / 100) {
        const k = positionScale(c, 1, d, bump, droop)
        expect(k).toBeGreaterThanOrEqual(last)
        last = k
      }
      expect(positionScale(bump, 1, d, bump, droop)).toBeCloseTo(pd.end, 9)
      expect(positionScale(bump + 0.05, 1, d, bump, droop)).toBeCloseTo(pd.end, 9)
      // Rebound near the bump end stays soft, so the wheel can come back down.
      expect(positionScale(bump, -1, d, bump, droop)).toBe(pd.mid)
    })

    it('firms up rebound near full droop, and leaves compression there soft', () => {
      expect(positionScale(-droop, -1, d, bump, droop)).toBeCloseTo(pd.end, 9)
      expect(positionScale(-droop, 1, d, bump, droop)).toBe(pd.mid)
    })

    it('is 1 everywhere for a damper without spool valves', () => {
      const plain: DamperSetup = { ...d, position: undefined }
      for (const c of [-0.1, 0, 0.12]) expect(positionScale(c, 1, plain, bump, droop)).toBe(1)
    })
  })

  it('care half as much how hot or cold the oil is', () => {
    const plain = buildTruck(stockBuild('light4x4')).ride.front.damper
    const sv = { ...plain, oilSense: spool.spool!.oilSense }
    const hot = fromCelsius(120)
    const cold = fromCelsius(-30)
    expect(dampingMultiplier(fromCelsius(40), sv)).toBeCloseTo(1, 12)
    // Hot: a normal damper fades further than the spool valve.
    expect(dampingMultiplier(hot, sv)).toBeGreaterThan(dampingMultiplier(hot, plain))
    expect(dampingMultiplier(hot, sv)).toBeLessThan(1)
    // Cold: a normal damper is stiffer on a frozen morning.
    expect(dampingMultiplier(cold, sv)).toBeLessThan(dampingMultiplier(cold, plain))
    expect(dampingMultiplier(cold, sv)).toBeGreaterThan(1)
  })

  it.each(['light4x4', 'heavy'] as const)(
    '%s on the torture loop: bottom out less than the electronic dampers and go at least as far',
    { timeout: 60_000 },
    (cls) => {
      const run = (dampers: string) => {
        const b = stockBuild(cls)
        b.parts.dampers = dampers
        const truck = buildTruck(b)
        return runLaps(truck.ride, truck.wear, RIGS.tortureLoop, 11, { airTemp: fromCelsius(20), trace: false })
      }
      const elec = run('electronic')
      const sv = run('spoolValve')
      const laps = Math.min(elec.laps.length, sv.laps.length)
      const bottoms = (r: typeof elec) => r.laps.slice(0, laps).reduce((sum, l) => sum + l.bottomOuts, 0)
      expect(bottoms(sv)).toBeLessThan(bottoms(elec))
      expect(sv.wear.distance).toBeGreaterThanOrEqual(elec.wear.distance)
    },
  )

  it('are offered as a bottoming fix only once on sale, and not when fitted', () => {
    const b = stockBuild('light4x4')
    expect(fixUseful('spoolValve', 'front', b, 2016)).toBe(false)
    expect(fixUseful('spoolValve', 'front', b, 2017)).toBe(true)
    b.parts.dampers = 'spoolValve'
    expect(fixUseful('spoolValve', 'front', b, 2020)).toBe(false)
  })
})
