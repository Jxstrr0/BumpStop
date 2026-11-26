// The truck card and photo mode (plan PR 12b): file names, limits, and keeping three.js out of the first load.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PHOTO_LIFT, PHOTO_ZOOM } from '../src/data/graphics'
import { pictureName } from '../src/ui/shareImage'

describe('photos and the truck card', () => {
  it('names pictures bump-stop-<what>-date-time.png', () => {
    expect(pictureName('photo', new Date(2026, 10, 26, 9, 5))).toBe('bump-stop-photo-2026-11-26-0905.png')
    expect(pictureName('truck-heavy', new Date(2026, 0, 2, 23, 59))).toBe('bump-stop-truck-heavy-2026-01-02-2359.png')
  })

  it('keeps the photo camera above the ground and within sensible zoom', () => {
    expect(PHOTO_LIFT.min).toBeGreaterThan(0)
    expect(PHOTO_LIFT.max).toBeLessThan(Math.PI / 2)
    expect(PHOTO_ZOOM.min).toBeLessThan(1)
    expect(PHOTO_ZOOM.max).toBeGreaterThan(1)
  })

  it('the card and photo mode only borrow types from the 3D, so three.js still loads on demand', () => {
    for (const file of ['truckCard', 'photoMode', 'shareImage', 'settings']) {
      const src = readFileSync(new URL(`../src/ui/${file}.ts`, import.meta.url), 'utf8')
      for (const line of src.split('\n').filter((l) => /^import .*render\/(garage|trackView|truckModel|look)'/.test(l))) {
        expect(line, `${file}: ${line}`).toMatch(/^import type /)
      }
      expect(src).not.toMatch(/from 'three'/)
    }
  })
})
