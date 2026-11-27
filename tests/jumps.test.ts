/**
 * The jump ramp (v1.20): the tabletop's shape, one scored landing a jump,
 * the sweet speed, a fix that helps, and that a run in pieces scores the
 * same as one all at once.
 */
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { LANDING, RIGS, tableMarks } from '../src/data/rigs'
import { SIM } from '../src/data/ride'
import { buildTruck, stockBuild } from '../src/sim/build'
import { buildProfile, heightAt, stampTable } from '../src/sim/ground'
import { advanceLaps, lapResult, runLaps, startLaps } from '../src/sim/laps'
import { Rng } from '../src/sim/rng'
import { fromCelsius, msToKmh } from '../src/sim/units'

const AIR = fromCelsius(20)
const RIG = RIGS.jumpRig
const JUMP = RIG.pieces[0]!.table!
const run = (cls: (typeof CLASSES)[number]['id'], change?: (b: ReturnType<typeof stockBuild>) => void) => {
  const b = stockBuild(cls)
  change?.(b)
  const truck = buildTruck(b)
  return runLaps(truck.ride, truck.wear, RIG, 104, { airTemp: AIR, trace: false })
}

describe('the tabletop', () => {
  it('rises to the lip, stays flat on top, and comes back down to the ground', () => {
    const p = buildProfile('graded', 100, new Rng(1))
    const before = p.left.slice()
    stampTable(p, JUMP)
    const m = tableMarks(JUMP)
    const added = (x: number) => heightAt(p.left, p.step, x) - heightAt(before, p.step, x)
    expect(added(JUMP.at - 1)).toBe(0)
    expect(added(m.lip + 0.5)).toBeCloseTo(JUMP.height, 6)
    expect(added(m.topEnd - 0.5)).toBeCloseTo(JUMP.height, 6)
    expect(added(m.landEnd + 1)).toBe(0)
    // The face is straight up to the lip: the same slope just before it as halfway up.
    const slope = (x: number) => (added(x + SIM.profileStep) - added(x)) / SIM.profileStep
    expect(slope(m.lip - 0.2)).toBeCloseTo(JUMP.slope, 3)
  })
})

describe('the jump ramp', { timeout: 60_000 }, () => {
  it.each(CLASSES.map((c) => c.id))('%s: one scored landing a jump, each faster than the last', (cls) => {
    const r = run(cls)
    expect(r.landings.length).toBe(r.laps.length)
    r.landings.forEach((l, k) => {
      expect(l.lap).toBe(k + 1)
      expect(msToKmh(l.speed)).toBeCloseTo(45 + 5 * k, 6)
      expect(l.score).toBeGreaterThanOrEqual(0)
      expect(l.score).toBeLessThanOrEqual(100)
      expect(l.grade).toBe(l.score >= LANDING.clean ? 'clean' : l.score >= LANDING.firm ? 'firm' : 'hard')
      expect(r.laps[k]!.landing).toEqual(l)
      // Marks come in order, between take-off and the end of the watch.
      for (const m of l.marks) {
        expect(m.t).toBeGreaterThanOrEqual(l.from - 1e-9)
        expect(m.t).toBeLessThanOrEqual(l.to + 1e-9)
      }
    })
  })

  it('every stock truck lands clean on the slope at 50 km/h, and flies past it at 70 and bottoms out', () => {
    for (const c of CLASSES) {
      const r = run(c.id)
      const at50 = r.landings.find((l) => Math.round(msToKmh(l.speed)) === 50)!
      expect(at50.spot, c.id).toBe('slope')
      expect(at50.grade, c.id).toBe('clean')
      expect(at50.air, c.id).toBeGreaterThan(0.2)
      const at70 = r.landings.find((l) => Math.round(msToKmh(l.speed)) === 70)
      // The side-by-side may not get that far: it bottoms out for good first.
      if (!at70) {
        expect(r.broken?.kind, c.id).toBe('bottoming')
        continue
      }
      expect(at70.spot, c.id).toBe('flat')
      expect(at70.bottoms.some((n) => n > 0), c.id).toBe(true)
      expect(at70.grade, c.id).toBe('hard')
    }
  })

  it('it lands nose first off the lip, more so the faster it goes', () => {
    const r = run('light4x4')
    const onSlope = r.landings.filter((l) => l.spot === 'slope')
    expect(onSlope.length).toBeGreaterThan(2)
    for (const l of onSlope) expect(l.first).toBe('front')
    for (let k = 1; k < onSlope.length; k++) expect(onSlope[k]!.angle).toBeLessThan(onSlope[k - 1]!.angle)
  })

  it('longer bump stops land the fast jumps better', () => {
    const stock = run('light4x4')
    const long = run('light4x4', (b) => {
      b.front.bumpStop = 0.1
      b.rear.bumpStop = 0.1
    })
    const at = (r: typeof stock, kmh: number) => r.landings.find((l) => Math.round(msToKmh(l.speed)) === kmh)!.score
    expect(at(long, 60)).toBeGreaterThan(at(stock, 60))
    expect(at(long, 65)).toBeGreaterThan(at(stock, 65) + 10)
  })

  it('a run in small pieces scores exactly like one run all at once', () => {
    const truck = buildTruck(stockBuild('heavy'))
    const whole = runLaps(truck.ride, truck.wear, RIG, 9, { airTemp: AIR })
    const r = startLaps(truck.ride, truck.wear, RIG, 9, { airTemp: AIR, poses: 4 })
    let guard = 0
    while (!r.done && guard++ < 1e6) advanceLaps(r, 613)
    expect(lapResult(r)).toEqual(whole)
  })

  it('the other rigs score no landings', () => {
    const truck = buildTruck(stockBuild('light4x4'))
    expect(runLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR, trace: false }).landings).toEqual([])
  })
})
