// Graphics tiers (plan PR 12): the tier table and Auto's step-down.
import { describe, expect, it } from 'vitest'
import { AUTO_TIER, TIER_IDS, TIERS } from '../src/data/graphics'
import { guessTier, TierGovernor } from '../src/render/tiers'

/** Feed the governor `seconds` of frames at `fps`; returns the first step down, if any. */
function run(g: TierGovernor, fps: number, seconds: number): string | null {
  let down: string | null = null
  for (let t = 0; t < seconds; t += 1 / fps) down ??= g.sample(1 / fps)
  return down
}

describe('graphics tiers', () => {
  it('each tier draws no more than the one above it', () => {
    for (let i = 1; i < TIER_IDS.length; i++) {
      const lo = TIERS[TIER_IDS[i - 1]!]
      const hi = TIERS[TIER_IDS[i]!]
      expect(lo.pixelRatioCap).toBeLessThanOrEqual(hi.pixelRatioCap)
      expect(lo.shadowMap).toBeLessThanOrEqual(hi.shadowMap)
      expect(lo.cover).toBeLessThanOrEqual(hi.cover)
      expect(lo.dust).toBeLessThanOrEqual(hi.dust)
      expect(lo.roadStep).toBeGreaterThanOrEqual(hi.roadStep)
    }
  })

  it('Lite skips the shadow pass, so the trucks are drawn once', () => {
    expect(TIERS.lite.shadows).toBe(false)
    expect(TIERS.full.shadows).toBe(true)
  })

  it('guesses Full on phones, Lite with little memory, Ultra on a big computer', () => {
    expect(guessTier(true, 8, 8)).toBe('full')
    expect(guessTier(true, 8, 2)).toBe('lite')
    expect(guessTier(false, 12, undefined)).toBe('ultra')
    expect(guessTier(false, 4, undefined)).toBe('full')
  })
})

describe('Auto', () => {
  it('holds a tier at a smooth 60 fps', () => {
    const g = new TierGovernor('ultra')
    expect(run(g, 60, 30)).toBeNull()
    expect(g.current).toBe('ultra')
  })

  it('steps down one tier at a time when it stutters, and stops at Lite', () => {
    const g = new TierGovernor('ultra')
    expect(run(g, 30, AUTO_TIER.warmupS + AUTO_TIER.windowS + 0.5)).toBe('full')
    expect(run(g, 30, AUTO_TIER.warmupS + AUTO_TIER.windowS + 0.5)).toBe('lite')
    expect(run(g, 20, 30)).toBeNull()
    expect(g.current).toBe('lite')
  })

  it('waits out the warm-up and ignores stalls (a tab switch)', () => {
    const g = new TierGovernor('full')
    expect(run(g, 20, AUTO_TIER.warmupS - 0.1)).toBeNull()
    for (let i = 0; i < 100; i++) expect(g.sample(2)).toBeNull()
  })

  it('never steps when the player picked a tier', () => {
    const g = new TierGovernor('ultra', false)
    expect(run(g, 20, 30)).toBeNull()
    expect(g.current).toBe('ultra')
  })
})
