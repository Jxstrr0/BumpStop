/**
 * Kelbo's names (26 November 2026): each career hires its own drivers from
 * each trade's pool and gets one of each pair of sponsors, the same ones for
 * the same career, and every name is real text.
 */
import { describe, expect, it } from 'vitest'
import { SPONSORS, TEAMS } from '../src/data/career'
import { DRIVER_IDS, DRIVERS } from '../src/data/raids'
import { t } from '../src/data/strings'
import { driverName, newCareer, sponsorName } from '../src/sim/career'

describe('names', () => {
  it('give every trade four drivers and every sponsor level two names, all in words', () => {
    for (const id of DRIVER_IDS) {
      expect(DRIVERS[id].pool).toHaveLength(4)
      for (const k of DRIVERS[id].pool) expect(t(k)).not.toBe(k)
    }
    for (const s of SPONSORS) {
      expect(s.names).toHaveLength(2)
      for (const k of s.names) expect(t(k)).not.toBe(k)
    }
    expect(Object.values(TEAMS).map((x) => t(x.name)).sort()).toEqual(['Goldpan Racing', 'Ironwood Brothers', 'Jackrabbit Sport', 'Tundra Dogs'])
  })

  it('hire the same drivers and sponsor for the same career, and a mix across careers', () => {
    const a = newCareer(7)
    for (const id of DRIVER_IDS) {
      expect(DRIVERS[id].pool).toContain(driverName(a, id))
      expect(driverName(newCareer(7), id)).toBe(driverName(a, id))
    }
    for (const s of SPONSORS) expect(s.names).toContain(sponsorName(a, s))
    // Free play has the first of each pool.
    for (const id of DRIVER_IDS) expect(driverName(null, id)).toBe(DRIVERS[id].pool[0])
    // Across many careers every driver and every sponsor turns up.
    const seen = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      const c = newCareer(seed)
      for (const id of DRIVER_IDS) seen.add(driverName(c, id))
      for (const s of SPONSORS) seen.add(sponsorName(c, s))
    }
    expect(seen.size).toBe(DRIVER_IDS.length * 4 + SPONSORS.length * 2)
  })
})
