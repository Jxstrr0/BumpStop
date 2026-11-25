import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { TEST_MULES, type RideSetup } from '../src/data/ride'
import { buildProfile } from '../src/sim/ground'
import {
  dampingMultiplier,
  driveSection,
  enterSection,
  restingState,
  rideEnergy,
  rideParams,
  stepRide,
  emptyStats,
} from '../src/sim/ride'
import { Rng } from '../src/sim/rng'
import { fromCelsius, kmhToMs } from '../src/sim/units'
import { flatRoad } from './helpers/flat'

const AIR = fromCelsius(20)

/** A copy of a setup with every damper (and the tires' own damping) switched off or scaled. */
function withDamping(setup: RideSetup, damperScale: number, tireDamping: boolean): RideSetup {
  const copy = structuredClone(setup)
  for (const ax of [copy.front, copy.rear]) {
    ax.damper.compLow *= damperScale
    ax.damper.compHigh *= damperScale
    ax.damper.rebLow *= damperScale
    ax.damper.rebHigh *= damperScale
    if (!tireDamping) ax.tireDamping = 0
  }
  return copy
}

describe('the test mules', () => {
  it.each(CLASSES)('$id weighs inside its class window and sags less than its travel', (c) => {
    const setup = TEST_MULES[c.id]
    const total = setup.sprungMass + 2 * setup.front.unsprungMass + 2 * setup.rear.unsprungMass
    expect(total).toBeGreaterThanOrEqual(c.minMass)
    expect(total).toBeLessThanOrEqual(c.maxMass)
    const p = rideParams(setup)
    for (let i = 0; i < 4; i++) {
      expect(p.staticCompression[i]).toBeGreaterThan(0)
      expect(p.staticCompression[i]).toBeLessThan(p.axle[i]!.droopTravel + p.axle[i]!.bumpTravel)
      expect(p.bumpStopStart[i]).toBeGreaterThan(0)
    }
  })

  it('the heavy truck is slowest to heat-soak and the side-by-side quickest', () => {
    // Time to cool (or heat) most of the way, at 20 m/s: heat capacity ÷ cooling.
    const soak = (s: RideSetup) => s.rear.damper.heatCapacity / (s.rear.damper.coolStill + 20 * s.rear.damper.coolPerSpeed)
    expect(soak(TEST_MULES.heavy)).toBeGreaterThan(soak(TEST_MULES.light4x4))
    expect(soak(TEST_MULES.light4x4)).toBeGreaterThan(soak(TEST_MULES.sxs))
  })
})

describe('the ride model', () => {
  it.each(CLASSES)('$id sits still at rest on flat ground', (c) => {
    const p = rideParams(TEST_MULES[c.id])
    const s = restingState(AIR)
    const road = flatRoad()
    enterSection(s, p, road)
    for (let n = 0; n < 2500; n++) stepRide(s, p, road, 0)
    expect(Math.abs(s.z)).toBeLessThan(1e-9)
    expect(Math.abs(s.pitch)).toBeLessThan(1e-9)
    expect(Math.abs(s.roll)).toBeLessThan(1e-9)
    for (const w of s.wheelZ) expect(Math.abs(w)).toBeLessThan(1e-9)
    for (const temp of s.oilTemp) expect(temp).toBeCloseTo(AIR, 9)
  })

  it.each(CLASSES)('$id keeps its energy with every damper off', (c) => {
    const p = rideParams(withDamping(TEST_MULES[c.id], 0, false))
    const s = restingState(AIR)
    const road = flatRoad()
    enterSection(s, p, road)
    s.vz = 0.3
    s.vPitch = 0.1
    s.vRoll = -0.1
    const start = rideEnergy(s, p, road)
    let worst = 0
    for (let n = 0; n < 5000; n++) {
      stepRide(s, p, road, 0)
      worst = Math.max(worst, Math.abs(rideEnergy(s, p, road) - start))
    }
    // The bounce holds about a hundred joules; the 500 Hz steps may wobble it by a percent or two, never drain or grow it.
    const bounce = 0.5 * p.sprungMass * 0.09 + 0.5 * p.pitchInertia * 0.01 + 0.5 * p.rollInertia * 0.01
    expect(worst / bounce).toBeLessThan(0.03)
  })

  it.each(CLASSES)('$id turns all of a bounce into damper heat', (c) => {
    const p = rideParams(withDamping(TEST_MULES[c.id], 1, false))
    const s = restingState(AIR)
    const road = flatRoad()
    enterSection(s, p, road)
    const rest = rideEnergy(s, p, road)
    s.vz = 0.4
    s.vRoll = 0.15
    const bounce = rideEnergy(s, p, road) - rest
    const stats = emptyStats()
    for (let n = 0; n < 5000; n++) stepRide(s, p, road, 0, stats)
    const left = rideEnergy(s, p, road) - rest
    const heat = stats.damperEnergy.reduce((a, b) => a + b)
    expect(left).toBeLessThan(bounce * 0.001)
    expect(Math.abs(heat - bounce) / bounce).toBeLessThan(0.03)
    // And the oil warmed by exactly that heat (less a little lost to the air).
    for (const temp of s.oilTemp) expect(temp).toBeGreaterThan(AIR)
  })

  it('bottoms out on a big jump at speed, never on a graded road', () => {
    const p = rideParams(TEST_MULES.light4x4)
    const jumps = driveSection(restingState(AIR), p, buildProfile('jumps', 1000, new Rng(3)), { speed: kmhToMs(90) })
    expect(jumps.stats.bottomOuts.reduce((a, b) => a + b)).toBeGreaterThan(0)
    expect(jumps.stats.airTime).toBeGreaterThan(0.5)
    const graded = driveSection(restingState(AIR), p, buildProfile('graded', 1000, new Rng(3)), { speed: kmhToMs(70) })
    expect(graded.stats.bottomOuts).toEqual([0, 0, 0, 0])
    expect(graded.stats.airTime).toBe(0)
  })

  it('makes more heat the faster it goes over big bumps', () => {
    const p = rideParams(TEST_MULES.light4x4)
    for (const ground of ['whoops', 'iceHeaves', 'jumps'] as const) {
      const heat = (kmh: number) => {
        const { stats } = driveSection(restingState(AIR, fromCelsius(40)), p, buildProfile(ground, 1500, new Rng(8)), { speed: kmhToMs(kmh) })
        return stats.damperEnergy.reduce((a, b) => a + b) / stats.time
      }
      expect(heat(80), ground).toBeGreaterThan(heat(40) * 1.3)
    }
  })
})

describe('damper heat and fade', () => {
  const dm = TEST_MULES.light4x4.rear.damper

  it('damps as set at 40 °C, stiffer cold, softer hot, and softer again once the oil foams', () => {
    expect(dampingMultiplier(fromCelsius(40), dm)).toBeCloseTo(1, 12)
    expect(dampingMultiplier(fromCelsius(-30), dm)).toBeGreaterThan(1.4)
    expect(dampingMultiplier(fromCelsius(130), dm)).toBeLessThan(0.65)
    const justBelow = dampingMultiplier(dm.aerationTemp - 1, dm)
    const wellAbove = dampingMultiplier(dm.aerationTemp + 30, dm)
    // Foam takes away more than the thinning oil alone would over those 31 K.
    expect(wellAbove / justBelow).toBeLessThan(0.7)
    // Always inside the limits.
    expect(dampingMultiplier(fromCelsius(-60), dm)).toBeLessThanOrEqual(2.2)
    expect(dampingMultiplier(fromCelsius(400), dm)).toBeGreaterThanOrEqual(0.2)
  })

  it('heats the oil on rough ground and cools it on smooth', () => {
    const p = rideParams(TEST_MULES.light4x4)
    const s = restingState(AIR, fromCelsius(40))
    driveSection(s, p, buildProfile('rocks', 1500, new Rng(4)), { speed: kmhToMs(50) })
    const hot = s.oilTemp.slice()
    for (const temp of hot) expect(temp).toBeGreaterThan(fromCelsius(50))
    driveSection(s, p, buildProfile('graded', 3000, new Rng(4)), { speed: kmhToMs(60) })
    s.oilTemp.forEach((temp, i) => expect(temp).toBeLessThan(hot[i]!))
  })

  it('lets the wheels go wild when the oil is hot (fade comes from the physics)', () => {
    const p = rideParams(TEST_MULES.light4x4)
    const road = buildProfile('whoops', 800, new Rng(11))
    const cool = driveSection(restingState(AIR, fromCelsius(40)), p, road, { speed: kmhToMs(45) })
    const hot = driveSection(restingState(AIR, fromCelsius(170)), p, road, { speed: kmhToMs(45) })
    const sum = (a: number[]) => a.reduce((x, y) => x + y)
    expect(sum(hot.stats.minDamping)).toBeLessThan(sum(cool.stats.minDamping))
    expect(sum(hot.stats.peakCompression) + sum(hot.stats.peakDroop)).toBeGreaterThan(
      sum(cool.stats.peakCompression) + sum(cool.stats.peakDroop),
    )
    expect(sum(hot.stats.bottomOuts)).toBeGreaterThanOrEqual(sum(cool.stats.bottomOuts))
  })

  it('starts stiff on a -30 °C morning and warms up as it drives', () => {
    const p = rideParams(TEST_MULES.light4x4)
    const air = fromCelsius(-30)
    const s = restingState(air)
    const { stats, trace } = driveSection(s, p, buildProfile('rocks', 3000, new Rng(2)), {
      speed: kmhToMs(40),
      traceEvery: 500,
    })
    expect(dampingMultiplier(air, p.damper[0]!)).toBeGreaterThan(1.4)
    expect(trace.length).toBeGreaterThan(100)
    for (const temp of s.oilTemp) expect(temp).toBeGreaterThan(air + 10)
    // Warming, so the oil is never colder than where it started and the damping eases off.
    expect(trace[trace.length - 1]!.oilTemp[0]).toBeGreaterThan(trace[0]!.oilTemp[0]!)
    expect(stats.minDamping[0]).toBeLessThan(dampingMultiplier(air, p.damper[0]!))
  })
})
