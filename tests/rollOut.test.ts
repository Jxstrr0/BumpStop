/**
 * The finish (v1.26): a run that lasts every lap carries on in 3D through
 * the start-line arch and brakes to a stop. It works on a copy, so the run
 * and its result never change. On the jump ramp it pulls up well short of
 * the tabletop (it never brakes on it).
 */
import { describe, expect, it } from 'vitest'
import { RIGS, ROLL_OUT, type Rig } from '../src/data/rigs'
import { START_LINE } from '../src/data/scenery'
import { buildTruck, stockBuild } from '../src/sim/build'
import { advanceLaps, lapLength, lapResult, rollOut, startLaps } from '../src/sim/laps'
import { lastPoses } from '../src/sim/poses'
import { fromCelsius } from '../src/sim/units'

const AIR = fromCelsius(20)
const KMH = 1 / 3.6
// A short, gentle loop every stock truck lasts.
const EASY: Rig = { ...RIGS.washboardLadder, pieces: [{ ground: 'graded', length: 120, pace: 1 }], startSpeed: 60 * KMH, speedStep: 10 * KMH, maxLaps: 2 }

describe('the finish roll-out', () => {
  const truck = buildTruck(stockBuild('light4x4'))

  it('drives through the arch, brakes to a stop and leaves the run alone', () => {
    const r = startLaps(truck.ride, truck.wear, EASY, 3, { airTemp: AIR, poses: 4 })
    advanceLaps(r, Infinity)
    expect(r.run.w.broken).toBeNull()
    const before = structuredClone(r.s)
    const result = structuredClone(lapResult(r))
    const poses = rollOut(r)
    expect(r.s).toEqual(before)
    expect(lapResult(r)).toEqual(result)

    const last = lastPoses(r.poses!, 0.1).at(-1)!
    const first = poses[0]!
    const end = poses.at(-1)!
    // Carries straight on from the log: the same clock and distance, no gap.
    expect(first.t).toBeGreaterThan(last.t)
    expect(first.t - last.t).toBeLessThanOrEqual(0.04 + 1e-9)
    expect(first.distance).toBeGreaterThan(last.distance)
    // Through the arch with room to spare, stopped, and sat still for a moment.
    const lineAt = 2 * lapLength(EASY)
    expect(end.distance - lineAt).toBeGreaterThan(START_LINE.arch + 5)
    expect(end.speed).toBe(0)
    expect(poses.filter((p) => p.speed === 0).length).toBeGreaterThan(ROLL_OUT.settle * 40)
    for (let i = 1; i < poses.length; i++) expect(poses[i]!.speed).toBeLessThanOrEqual(poses[i - 1]!.speed)
    // Braking nods the nose down.
    const braking = poses.filter((p) => p.speed > 0 && p.speed < first.speed - 3)
    expect(Math.min(...braking.map((p) => p.pitch))).toBeLessThan(Math.min(...poses.slice(0, 10).map((p) => p.pitch)))
  }, 60000)

  it('pulls up on the jump ramp before it reaches the tabletop', () => {
    const r = startLaps(truck.ride, truck.wear, RIGS.jumpRig, 9, { airTemp: AIR, poses: 4 })
    advanceLaps(r, Infinity)
    expect(r.run.w.broken).toBeNull()
    const poses = rollOut(r)
    const table = RIGS.jumpRig.pieces[0]!.table!
    // Since v1.28 the run-up is long: it stops well short of the jump, and never brakes on it.
    const last = poses.at(-1)!
    expect(last.speed).toBe(0)
    expect(last.x + truck.ride.cgToFront).toBeLessThan(table.at)
  }, 60000)

  it('gives nothing once something broke', () => {
    const r = startLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR })
    advanceLaps(r, Infinity)
    expect(r.run.w.broken).not.toBeNull()
    expect(rollOut(r)).toEqual([])
  }, 60000)
})
