/**
 * The pace check and Push's cost (playtest, 26 November 2026: "Push is
 * always right, and the rigs don't predict the raids").
 */
import { describe, expect, it } from 'vitest'
import { CONDITION } from '../src/data/condition'
import { buildTruck, stockBuild } from '../src/sim/build'
import { newCondition, tireCondition } from '../src/sim/condition'
import { checkGround, groundsToCheck, paceCheck, verdict } from '../src/sim/paceCheck'

describe('the pace check', () => {
  const truck = buildTruck(stockBuild('light4x4'))

  it('checks each rough kind of ground once, leaving out the fast smooth stuff', () => {
    expect(groundsToCheck(['graded', 'rough', 'washboard', 'graded', 'rough', 'ice', 'rocks'])).toEqual(['rough', 'washboard', 'rocks'])
    expect(paceCheck(truck, 'veteran', [], 20)).toBeNull()
  })

  it('runs the shocks hotter and wears the parts faster the harder the pace call', () => {
    const rough = ['conserve', 'steady', 'push'].map((p) => checkGround(truck, 'veteran', 'rough', p as 'steady', 22))
    expect(rough[0]!.speed).toBeLessThan(rough[1]!.speed)
    expect(rough[1]!.speed).toBeLessThan(rough[2]!.speed)
    expect(rough[0]!.oil).toBeLessThan(rough[1]!.oil)
    expect(rough[1]!.oil).toBeLessThan(rough[2]!.oil)
    const rocks = ['steady', 'push'].map((p) => checkGround(truck, 'veteran', 'rocks', p as 'steady', 22))
    expect(rocks[1]!.wear10).toBeGreaterThan(rocks[0]!.wear10 * 2)
  })

  it('is the same every time for the same truck', () => {
    expect(checkGround(truck, null, 'whoops', 'push', 20)).toEqual(checkGround(truck, null, 'whoops', 'push', 20))
  })

  it('gives each pace call its hottest shocks and worst wear, and the worse of the two bands', () => {
    const v = paceCheck(truck, null, ['rough', 'rocks'], 22)!
    expect(v.map((x) => x.pace)).toEqual(['conserve', 'steady', 'push'])
    const push = v[2]!
    expect(push.worstOil.ground).toBe('rough')
    expect(push.worstWear.ground).toBe('rocks')
    const fake = (ground: 'rough' | 'rocks', oilBand: 'cool' | 'hot', wear10: number) => ({ ...push.worstOil, ground, oilBand, wear10, wearBand: 'cool' as const })
    expect(verdict('push', [fake('rough', 'cool', 0.01), fake('rocks', 'hot', 0)]).band).toBe('hot')
  })
})

describe('Push wears the truck', () => {
  it('ages the springs and bushings faster over harsh ground at Push, slower at Conserve', () => {
    const truck = buildTruck(stockBuild('light4x4'))
    const load = { damperEnergy: [0, 0, 0, 0], peakTemp: [300, 300, 300, 300], bottomOuts: [0, 0, 0, 0], distance: 10_000, harsh: true }
    const at = (pace: 'conserve' | 'steady' | 'push') => {
      const c = newCondition()
      tireCondition(c, truck, { ...load, pace })
      return c
    }
    expect(at('steady').bushing[0]).toBeCloseTo(10 * CONDITION.bushing.perHarshKm, 9)
    expect(at('push').bushing[0]).toBeCloseTo(10 * CONDITION.bushing.perHarshKm * CONDITION.paceLoad.push, 9)
    expect(at('push').spring[0]).toBeGreaterThan(at('steady').spring[0]!)
    expect(at('conserve').spring[0]).toBeLessThan(at('steady').spring[0]!)
  })

  it('tires the oil and sags the springs slower with the garage’s shock dyno and spring rig', () => {
    const truck = buildTruck(stockBuild('light4x4'))
    const load = { damperEnergy: [4e5, 4e5, 4e5, 4e5], peakTemp: [340, 340, 340, 340], bottomOuts: [3, 3, 3, 3], distance: 10_000, harsh: true }
    const plain = newCondition()
    tireCondition(plain, truck, load)
    const cared = newCondition()
    tireCondition(cared, truck, { ...load, oilWear: 0.65, springSag: 0.6 })
    expect(plain.oil[0]).toBeGreaterThan(0)
    expect(cared.oil[0]).toBeCloseTo(plain.oil[0]! * 0.65, 9)
    expect(cared.spring[0]).toBeCloseTo(plain.spring[0]! * 0.6, 9)
    // The bushings don't change.
    expect(cared.bushing[0]).toBeCloseTo(plain.bushing[0]!, 9)
  })
})
