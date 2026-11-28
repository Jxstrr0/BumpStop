/**
 * Balance and physics check (28 November 2026). Two fixes to how parts
 * behave, so they match how the real things work:
 *
 * - Hydraulic bump stops (and the gas-charged ones) are little dampers: they
 *   soak up the end of a big landing instead of handing it back like a
 *   rubber block. Rubber and urethane stay plain springy stops.
 * - A tired spring gets shorter, not softer: it sits lower, but its
 *   stiffness doesn't change.
 */
import { describe, expect, it } from 'vitest'
import { PARTS, type BumpStopPart } from '../src/data/parts'
import { BUMP_STOP } from '../src/data/ride'
import { RIGS } from '../src/data/rigs'
import { buildTruck, stockBuild } from '../src/sim/build'
import { wornTruck } from '../src/sim/condition'
import { runLaps } from '../src/sim/laps'
import { fromCelsius } from '../src/sim/units'

type Cls = 'light4x4' | 'heavy' | 'sxs'
const withStops = (cls: Cls, stops: string) => {
  const b = stockBuild(cls)
  b.parts.bumpStops = stops
  return buildTruck(b)
}

describe('hydraulic bump stops', () => {
  it('only the hydraulic and gas-charged stops damp; rubber and urethane are springy', () => {
    const stops = PARTS.filter((p): p is BumpStopPart => p.slot === 'bumpStops')
    for (const p of stops) {
      expect(p.damping).toBe(p.id === 'hydraulic' || p.id === 'gasCharged' ? 1 : 0)
    }
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      expect(withStops(cls, 'rubber').ride.front.bumpStopDamping).toBe(0)
      expect(withStops(cls, 'urethane').ride.rear.bumpStopDamping).toBe(0)
      const h = withStops(cls, 'hydraulic').ride.front
      expect(h.bumpStopDamping).toBeGreaterThan(0)
      // Sized from the class's plain stop: about 6,000 N·s/m on the light 4x4.
      expect(h.bumpStopDamping).toBeCloseTo((h.bumpStopRate / 1.5) * BUMP_STOP.dampingTime, 6)
    }
  })

  it('the stock trucks are unchanged: they run rubber stops', () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      expect(buildTruck(stockBuild(cls)).ride.front.bumpStopDamping).toBe(0)
    }
  })

  it('take a big landing without bottoming out where a rubber stop does', () => {
    const land = (stops: string) =>
      runLaps(withStops('light4x4', stops).ride, withStops('light4x4', stops).wear, RIGS.jumpRig, 104, {
        airTemp: fromCelsius(20),
        trace: false,
      }).landings
    const rubber = land('rubber')
    const hydraulic = land('hydraulic')
    const bottoms = (ls: typeof rubber) => ls.reduce((n, l) => n + l.bottoms.reduce((a, b) => a + b, 0), 0)
    expect(bottoms(rubber)).toBeGreaterThan(0)
    expect(bottoms(hydraulic)).toBe(0)
    // ...and the hardest jolt is gentler at the fastest jump.
    expect((hydraulic.at(-1) as (typeof hydraulic)[number]).peakG).toBeLessThan((rubber.at(-1) as (typeof rubber)[number]).peakG)
  })
})

describe('tired springs', () => {
  it('sit lower but keep their stiffness', () => {
    const fresh = buildTruck(stockBuild('light4x4'))
    const worn = wornTruck(fresh, { oil: [0, 0], bushing: [0, 0], spring: [1, 0] })
    expect(worn.ride.front.springRate).toBe(fresh.ride.front.springRate)
    expect(worn.ride.front.bumpTravel).toBeLessThan(fresh.ride.front.bumpTravel)
    expect(worn.ride.front.droopTravel).toBeGreaterThan(fresh.ride.front.droopTravel)
  })
})
