import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'

describe('the three classes', () => {
  it('are all there from day one', () => {
    expect(CLASSES.map((c) => c.id)).toEqual(['light4x4', 'heavy', 'sxs'])
  })

  it('each have a weight window that makes sense', () => {
    for (const c of CLASSES) {
      expect(c.minMass).toBeGreaterThan(0)
      expect(c.maxMass).toBeGreaterThan(c.minMass)
    }
  })
})
