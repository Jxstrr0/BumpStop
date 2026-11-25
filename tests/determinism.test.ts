import { describe, expect, it } from 'vitest'
import { TEST_MULES } from '../src/data/ride'
import { buildProfile } from '../src/sim/ground'
import { cloneState, enterSection, restingState, rideParams, stepRide, type RideState } from '../src/sim/ride'
import { Rng } from '../src/sim/rng'
import { runStage, type StageSpec } from '../src/sim/stage'
import { fromCelsius } from '../src/sim/units'

const SPEC: StageSpec = {
  airTemp: fromCelsius(5),
  segments: [
    { ground: 'graded', length: 3000, speed: 22 },
    { ground: 'rocks', length: 2000, speed: 12 },
    { ground: 'jumps', length: 2000, speed: 18 },
  ],
}

describe('determinism', () => {
  it.each(['sampled', 'full'] as const)('runs a %s stage exactly the same twice with the same seed', (mode) => {
    const a = runStage(TEST_MULES.light4x4, SPEC, 2026, mode)
    const b = runStage(TEST_MULES.light4x4, SPEC, 2026, mode)
    expect(b).toEqual(a)
  })

  it('runs differently with a different seed', () => {
    const a = runStage(TEST_MULES.light4x4, SPEC, 1)
    const b = runStage(TEST_MULES.light4x4, SPEC, 2)
    expect(b.endTemp).not.toEqual(a.endTemp)
  })

  it('carries on exactly the same after a save and load in the middle of a run', () => {
    const p = rideParams(TEST_MULES.sxs)
    const road = buildProfile('whoops', 300, new Rng(77))
    const run = (s: RideState, from: number, to: number) => {
      for (let n = from; n < to; n++) stepRide(s, p, road, 15)
    }
    const straight = restingState(fromCelsius(-10))
    enterSection(straight, p, road)
    run(straight, 0, 6000)

    const first = restingState(fromCelsius(-10))
    enterSection(first, p, road)
    run(first, 0, 2500)
    const loaded = JSON.parse(JSON.stringify(first)) as RideState
    run(loaded, 2500, 6000)

    expect(loaded).toEqual(straight)
    expect(cloneState(loaded)).toEqual(loaded)
  })
})
