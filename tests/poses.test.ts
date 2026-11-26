/**
 * The pose log for the 3D view (plan PR 5) only watches: a run with it gives
 * exactly the same result as one without, and it holds the last few seconds
 * up to the very step that broke.
 */
import { describe, expect, it } from 'vitest'
import { RIGS } from '../src/data/rigs'
import { buildTruck, stockBuild } from '../src/sim/build'
import { advanceLaps, lapResult, startLaps } from '../src/sim/laps'
import { lastPoses, posesHeld, POSES_PER_SECOND } from '../src/sim/poses'
import { advanceShaker, startShaker } from '../src/sim/shaker'
import { fromCelsius } from '../src/sim/units'

const AIR = fromCelsius(20)

describe('the pose log', () => {
  const truck = buildTruck(stockBuild('sxs'))

  it('changes nothing about the run', () => {
    const plain = startLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR })
    const logged = startLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR, poses: 4 })
    advanceLaps(plain, Infinity)
    advanceLaps(logged, Infinity)
    const a = lapResult(plain)
    const b = lapResult(logged)
    expect(b.broken).toEqual(a.broken)
    expect(b.laps).toEqual(a.laps)
    expect(b.history).toEqual(a.history)
    expect(logged.s).toEqual(plain.s)
  }, 60000)

  it('keeps the last seconds, ending on the step that broke', () => {
    const r = startLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR, poses: 4 })
    advanceLaps(r, Infinity)
    const log = r.poses!
    expect(posesHeld(log)).toBe(4 * POSES_PER_SECOND)
    const clip = lastPoses(log, 3)
    expect(clip.length).toBe(3 * POSES_PER_SECOND + 1)
    const end = clip[clip.length - 1]!
    expect(end.t).toBeCloseTo(r.s.t, 9)
    expect(end.wheelZ).toEqual(r.s.wheelZ)
    // Oldest first, a 60th of a second apart, distance going up.
    for (let i = 1; i < clip.length - 1; i++) {
      expect(clip[i]!.t - clip[i - 1]!.t).toBeCloseTo(1 / POSES_PER_SECOND, 6)
      expect(clip[i]!.distance).toBeGreaterThan(clip[i - 1]!.distance)
    }
  }, 60000)

  it('gives the shaker the same result too, with the posts as the ground', () => {
    const plain = startShaker(truck.ride, AIR)
    const logged = startShaker(truck.ride, AIR, 2)
    advanceShaker(plain, 20000)
    advanceShaker(logged, 20000)
    expect(logged.points).toEqual(plain.points)
    const grounds = lastPoses(logged.poses!, 2).map((p) => Math.abs(p.ground))
    expect(Math.max(...grounds)).toBeGreaterThan(0)
  })
})
