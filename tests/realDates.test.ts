/**
 * Real-history dates (Kelbo, 28 November 2026): side-by-sides race from
 * 2005, with their turbo engine from 2016; bypass shocks from 1986; gas-
 * charged bump stops from 2010. Garages saved before this keep working: a
 * side-by-side already bought before 2005 keeps its parts and may still race.
 */
import { describe, expect, it } from 'vitest'
import { classFrom, classOut } from '../src/data/classes'
import { PARTS } from '../src/data/parts'
import { stockBuild } from '../src/sim/build'
import { buyTruck, entryProblems, fitOwn, newCareer, offers, settle } from '../src/sim/career'

const year = (id: string) => PARTS.find((p) => p.id === id)!.year

describe('real-history dates', () => {
  it('put the parts and classes in the years the real ones came out', () => {
    expect(classFrom('sxs')).toBe(2005)
    expect(classOut('sxs', 2004)).toBe(false)
    expect(classOut('light4x4', 1985)).toBe(true)
    expect(year('bypass')).toBe(1986)
    expect(year('gasCharged')).toBe(2010)
    expect(year('turboTwin')).toBe(2016)
  })

  it('offer no side-by-side to buy, or privateer to prep for, before 2005', () => {
    const c = newCareer(4)
    c.money = 100_000
    expect(() => buyTruck(c, 'sxs')).toThrow()
    for (let k = 0; k < 6; k++) {
      expect(offers(c).every((o) => o.cls !== 'sxs')).toBe(true)
      settle(c, null)
    }
  })

  it('let a garage saved with a side-by-side bought before 2005 keep racing it', () => {
    const c = newCareer(5)
    c.money = 100_000
    c.own = stockBuild('sxs') // as an older save would have it, bought in 1985
    expect(entryProblems(c, 'veteran').some((p) => p.kind === 'build')).toBe(false)
    // Settings change freely, and the parts already on it stay...
    fitOwn(c, { ...c.own, front: { ...c.own.front, preload: c.own.front.preload + 0.002 } })
    // ...but a part from later still has to wait for its year.
    expect(() => fitOwn(c, { ...c.own!, parts: { ...c.own!.parts, bumpStops: 'gasCharged' } })).toThrow()
  })
})
