import { describe, expect, it } from 'vitest'
import { GROUND_IDS, type GroundId } from '../src/data/ground'
import { SIM, TEST_MULES } from '../src/data/ride'
import { runStage, type StageSpec } from '../src/sim/stage'
import { fromCelsius } from '../src/sim/units'

const AIR = fromCelsius(20)
const SPEED: Record<GroundId, number> = { graded: 24, washboard: 20, rough: 20, rocks: 14, whoops: 15, jumps: 18, iceHeaves: 20 }
const sum = (a: number[]) => a.reduce((x, y) => x + y)
const mean = (a: number[]) => sum(a) / a.length

describe('long stages', () => {
  it.each(GROUND_IDS)('%s: sampling makes about the same heat as driving every metre', (ground) => {
    let sampled = 0
    let full = 0
    let tempGap = 0
    for (const seed of [1, 2, 3]) {
      const spec: StageSpec = { airTemp: AIR, segments: [{ ground, length: 15000, speed: SPEED[ground] }] }
      const a = runStage(TEST_MULES.light4x4, spec, seed, 'sampled')
      const b = runStage(TEST_MULES.light4x4, spec, seed, 'full')
      sampled += sum(a.damperEnergy)
      full += sum(b.damperEnergy)
      tempGap += Math.abs(mean(a.endTemp) - mean(b.endTemp))
    }
    expect(sampled / full).toBeGreaterThan(0.85)
    expect(sampled / full).toBeLessThan(1.15)
    expect(tempGap / 3).toBeLessThan(12)
  })

  it('a mixed stage, sampled, lands close to the full-detail run for every class', () => {
    const spec: StageSpec = {
      airTemp: AIR,
      segments: [
        { ground: 'graded', length: 6000, speed: 24 },
        { ground: 'washboard', length: 6000, speed: 20 },
        { ground: 'rocks', length: 4000, speed: 14 },
        { ground: 'jumps', length: 4000, speed: 18 },
        { ground: 'graded', length: 6000, speed: 24 },
      ],
    }
    for (const setup of Object.values(TEST_MULES)) {
      const a = runStage(setup, spec, 5, 'sampled')
      const b = runStage(setup, spec, 5, 'full')
      expect(a.distance).toBeCloseTo(26000, 6)
      expect(b.distance).toBeCloseTo(26000, 6)
      expect(Math.abs(a.time - b.time)).toBeLessThan(0.01)
      expect(sum(a.damperEnergy) / sum(b.damperEnergy)).toBeGreaterThan(0.85)
      expect(sum(a.damperEnergy) / sum(b.damperEnergy)).toBeLessThan(1.15)
      expect(Math.abs(mean(a.peakTemp) - mean(b.peakTemp))).toBeLessThan(15)
      expect(a.stepsSimulated).toBeLessThan(b.stepsSimulated / 4)
    }
  })

  it('resolves a 300 km stage from a small share of full-detail steps', () => {
    const spec: StageSpec = {
      airTemp: AIR,
      segments: [
        { ground: 'graded', length: 120000, speed: 25 },
        { ground: 'washboard', length: 80000, speed: 20 },
        { ground: 'rocks', length: 40000, speed: 14 },
        { ground: 'whoops', length: 20000, speed: 14 },
        { ground: 'jumps', length: 40000, speed: 18 },
      ],
    }
    const r = runStage(TEST_MULES.heavy, spec, 300)
    const everyStep = r.time * SIM.stepsPerSecond
    expect(r.distance).toBeCloseTo(300000, 3)
    expect(r.stepsSimulated).toBeLessThan(everyStep * 0.12)
    expect(r.checkpoints.length).toBe(60)
    for (let i = 1; i < r.checkpoints.length; i++) {
      expect(r.checkpoints[i]!.distance).toBeGreaterThan(r.checkpoints[i - 1]!.distance)
    }
    for (const temp of r.peakTemp) expect(Number.isFinite(temp)).toBe(true)
  })

  it('refuses ground it does not know', () => {
    const spec = { airTemp: AIR, segments: [{ ground: 'lava' as GroundId, length: 1000, speed: 10 }] }
    expect(() => runStage(TEST_MULES.sxs, spec, 1)).toThrow(RangeError)
  })
})
