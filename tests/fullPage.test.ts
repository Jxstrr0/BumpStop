// The test track full page (Kelbo asked, 27 November 2026): the remembered choice, the lens and the pixels.
import { describe, expect, it } from 'vitest'
import { TIER_IDS, TIERS, TRACK_CAMERA } from '../src/data/graphics'
import { t } from '../src/data/strings'
import { pixelRatioFor, trackFov } from '../src/render/framing'
import { readFullPage, writeFullPage } from '../src/ui/fullPage'

/** A pretend localStorage. */
function memory(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

/** How wide the picture is, side to side (degrees), for a lens `fov` degrees top to bottom. */
function widthOf(fov: number, aspect: number): number {
  const rad = Math.PI / 180
  return (2 * Math.atan(Math.tan((fov / 2) * rad) * aspect)) / rad
}

describe('the test track, full page', () => {
  it('starts full page for a new player', () => {
    expect(readFullPage(memory())).toBe(true)
    expect(readFullPage(undefined)).toBe(true)
  })

  it('the phone remembers the pick under a bumpstop. key', () => {
    const s = memory()
    writeFullPage(false, s)
    expect(s.getItem('bumpstop.trackFull')).toBe('0')
    expect(readFullPage(s)).toBe(false)
    writeFullPage(true, s)
    expect(readFullPage(s)).toBe(true)
  })

  it('storage that throws (private mode) still starts full page', () => {
    const broken = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(readFullPage(broken)).toBe(true)
    expect(() => writeFullPage(false, broken)).not.toThrow()
  })

  it('the buttons have their words', () => {
    expect(t('shop.fullPage')).toBeTruthy()
    expect(t('shop.traces')).toBeTruthy()
    expect(t('shop.seeReport')).toBeTruthy()
  })
})

describe('the test track camera fits the shape of its canvas', () => {
  it('keeps the plain lens at the shape the shots were framed for, and wider', () => {
    expect(trackFov(TRACK_CAMERA.designAspect)).toBe(TRACK_CAMERA.fov)
    expect(trackFov(2.4)).toBe(TRACK_CAMERA.fov)
  })

  it('opens up on a narrower canvas so the picture stays as wide', () => {
    const designWidth = widthOf(TRACK_CAMERA.fov, TRACK_CAMERA.designAspect)
    for (const aspect of [1.4, 1.2, 1]) {
      const fov = trackFov(aspect)
      expect(fov).toBeGreaterThan(TRACK_CAMERA.fov)
      expect(fov).toBeLessThan(TRACK_CAMERA.maxFov)
      expect(widthOf(fov, aspect)).toBeCloseTo(designWidth, 6)
    }
  })

  it('stops at the limit on a phone held upright, and the truck still fits', () => {
    // A phone screen above the tabs is about 9 wide to 17 tall.
    const aspect = 9 / 17
    expect(trackFov(aspect)).toBe(TRACK_CAMERA.maxFov)
    // The side-on camera stands 2.2 truck lengths out: the picture there is this many truck lengths wide.
    const lengths = 2 * 2.2 * Math.tan((widthOf(TRACK_CAMERA.maxFov, aspect) / 2) * (Math.PI / 180))
    expect(lengths).toBeGreaterThan(1.5)
  })

  it('a canvas with no size yet gets the plain lens', () => {
    expect(trackFov(0)).toBe(TRACK_CAMERA.fov)
    expect(trackFov(Number.NaN)).toBe(TRACK_CAMERA.fov)
  })
})

describe('the test track pixels', () => {
  it('a phone screen full page is drawn as sharp as the tier allows', () => {
    // A big phone, upright, above the tabs.
    expect(pixelRatioFor(430, 800, 3, TIERS.full.pixelRatioCap, TIERS.full.maxPixels)).toBe(2)
    expect(pixelRatioFor(430, 800, 3, TIERS.lite.pixelRatioCap, TIERS.lite.maxPixels)).toBe(1)
  })

  it('a canvas the size of a big monitor is drawn softer, inside the budget', () => {
    for (const id of TIER_IDS) {
      const tier = TIERS[id]
      const ratio = pixelRatioFor(2560, 1300, 2, tier.pixelRatioCap, tier.maxPixels)
      expect(ratio).toBeLessThanOrEqual(Math.min(2, tier.pixelRatioCap))
      expect(2560 * 1300 * ratio * ratio).toBeLessThanOrEqual(tier.maxPixels + 1)
    }
  })

  it('each tier draws no more pixels than the one above it', () => {
    for (let i = 1; i < TIER_IDS.length; i++) {
      expect(TIERS[TIER_IDS[i - 1]!].maxPixels).toBeLessThanOrEqual(TIERS[TIER_IDS[i]!].maxPixels)
    }
  })

  it('a canvas with no size yet gets the tier’s own ratio', () => {
    expect(pixelRatioFor(0, 0, 3, 2, 2_500_000)).toBe(2)
  })
})
