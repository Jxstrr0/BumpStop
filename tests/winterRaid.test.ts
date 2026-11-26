/**
 * Winter raids (plan PR 10b): studs, the tightest corner on winter ground,
 * lake ice that cracks under a heavy truck, the shore track, cold-weather
 * rivals, and a small balance bot for the Winter Sprint.
 */
import { describe, expect, it } from 'vitest'
import type { ClassId } from '../src/data/classes'
import { RAIDS, STEADY_KMH, type PaceId } from '../src/data/raids'
import { CORNERS, ICE_ROAD } from '../src/data/winter'
import { buildTruck, stockBuild } from '../src/sim/build'
import {
  cornerSpeed, driveStage, enterRaid, finishStage, groundSpeed, harshShare, iceAtPace, raidTruck, startStage, studFactor,
  type StageRecord,
} from '../src/sim/raid'
import { rivalStages, rivalsIn } from '../src/sim/rivals'

const KMH = 1 / 3.6

function truckOn(cls: ClassId, tires: string) {
  const b = stockBuild(cls)
  b.parts.tires = tires
  b.parts.spares = 'lightKit'
  return b
}

/** Drive the first stage of a raid at one pace call. */
function firstStage(raid: 'winterSprint' | 'winterRaid', cls: ClassId, tires: string, pace: PaceId): StageRecord {
  const state = enterRaid(raid, truckOn(cls, tires), 'gravelAce')
  const run = startStage(state, raidTruck(state), pace)
  driveStage(state, run, [pace, pace, pace])
  return finishStage(state, run)
}

describe('studs and corners', () => {
  const plain = buildTruck(truckOn('light4x4', 'rallyTires'))
  const studs = buildTruck(truckOn('light4x4', 'studdedRally'))

  it('studs make the driver a little faster on winter ground and change nothing on summer ground', () => {
    expect(studFactor(plain, 'ice')).toBe(1)
    expect(studFactor(studs, 'rough')).toBe(1)
    expect(studFactor(studs, 'graded')).toBe(1)
    expect(studFactor(studs, 'ice')).toBeCloseTo(1.107, 2)
    expect(studFactor(studs, 'snow')).toBeCloseTo(1.047, 2)
  })

  it('summer ground has no corner to slide off', () => {
    expect(cornerSpeed(plain, 'rough')).toBe(Infinity)
    expect(cornerSpeed(studs, 'jumps')).toBe(Infinity)
  })

  it('on plain tires Steady makes the tightest corner and Push does not; on studs Push makes it', () => {
    for (const g of ['ice', 'snow', 'iceHeaves'] as const) {
      expect(groundSpeed(plain, 'gravelAce', g, 'steady')).toBeLessThan(cornerSpeed(plain, g))
      expect(groundSpeed(plain, 'gravelAce', g, 'push')).toBeGreaterThan(cornerSpeed(plain, g))
      expect(groundSpeed(studs, 'gravelAce', g, 'push')).toBeLessThan(cornerSpeed(studs, g))
    }
    expect(cornerSpeed(plain, 'ice')).toBeCloseTo(STEADY_KMH.light4x4.ice * KMH * CORNERS.margin, 6)
  })

  it('winter ground counts towards rivals\' trouble, but less than harsh summer ground', () => {
    const iceOnly = { tag: 'stage.iceRoads', airC: -20, segments: [{ ground: 'ice' as const, km: 10 }] }
    const rocksOnly = { tag: 'stage.iceRoads', airC: -20, segments: [{ ground: 'rocks' as const, km: 10 }] }
    expect(harshShare(iceOnly as never)).toBeGreaterThan(0)
    expect(harshShare(iceOnly as never)).toBeLessThan(harshShare(rocksOnly as never))
  })

  it('in winter no rival\'s dampers fade', () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as ClassId[]) {
      for (let seed = 0; seed < 200; seed++) {
        const r = rivalStages(cls, [3000, 3000, 3000], 150, 0.8, seed, rivalsIn(cls), true)
        expect(r.some((x) => x.trouble?.kind === 'fade')).toBe(false)
      }
    }
  })
})

describe('lake ice on a raid', { timeout: 120_000 }, () => {
  const stage = RAIDS.winterSprint.stages[0]!

  it('the light classes never crack the ice; the heavy truck can', () => {
    for (const cls of ['light4x4', 'sxs'] as ClassId[]) {
      const t = buildTruck(truckOn(cls, 'studdedRally'))
      expect(iceAtPace(stage, t, 'charger', 'push')!.band).toBe('quiet')
    }
    const heavy = buildTruck(truckOn('heavy', 'studdedPly'))
    expect(iceAtPace(stage, heavy, 'gravelAce', 'push')!.band).toBe('cracks')
    expect(iceAtPace(stage, heavy, 'gravelAce', 'conserve')!.band).not.toBe('cracks')
  })

  it('a stage with no ice road has no ice reading', () => {
    expect(iceAtPace(RAIDS.winterSprint.stages[1]!, buildTruck(stockBuild('heavy')), 'gravelAce', 'push')).toBeNull()
  })

  it('a heavy truck too fast on thin ice cracks it, backs off and takes the shore track', () => {
    const fast = firstStage('winterSprint', 'heavy', 'studdedPly', 'push')
    const ice = fast.stops.filter((s) => s.kind === 'ice')
    expect(ice.length).toBeGreaterThan(0)
    for (const s of ice) {
      expect(s.fix).toBe('shore')
      expect(s.lost).toBe(ICE_ROAD.backOff)
    }
    // Easing off to Conserve keeps it on the ice, so it's quicker in the end.
    const slow = firstStage('winterSprint', 'heavy', 'studdedPly', 'conserve')
    expect(slow.stops.filter((s) => s.kind === 'ice')).toEqual([])
    expect(slow.time).toBeLessThan(fast.time)
    // Near the limit the ice booms and creaks: a warning, not a stop.
    expect(slow.iceNotes!.length).toBeGreaterThan(0)
  })

  it('Push on plain tires slides into the snowbank, once a leg at most', () => {
    const r = firstStage('winterSprint', 'light4x4', 'rallyTires', 'push')
    const slides = r.stops.filter((s) => s.kind === 'slide')
    expect(slides.length).toBeGreaterThan(0)
    for (let leg = 0; leg < 3; leg++) expect(slides.filter((s) => s.leg === leg).length).toBeLessThanOrEqual(1)
    for (const s of slides) {
      expect(s.fix).toBe('dig')
      expect(s.lost).toBe(CORNERS.digOut)
    }
  })
})

describe('Winter Sprint balance', { timeout: 300_000 }, () => {
  it.each(['light4x4', 'sxs'] as ClassId[])('%s: studs make Push pay; plain Push is a trap', (cls) => {
    const studsSteady = firstStage('winterSprint', cls, 'studdedRally', 'steady')
    const studsPush = firstStage('winterSprint', cls, 'studdedRally', 'push')
    const plainSteady = firstStage('winterSprint', cls, 'rallyTires', 'steady')
    const plainPush = firstStage('winterSprint', cls, 'rallyTires', 'push')
    expect(studsSteady.stops).toEqual([])
    expect(studsPush.stops).toEqual([])
    expect(studsPush.time).toBeLessThan(studsSteady.time)
    expect(studsSteady.time).toBeLessThan(plainSteady.time)
    expect(plainPush.time).toBeGreaterThan(plainSteady.time)
  })
})
