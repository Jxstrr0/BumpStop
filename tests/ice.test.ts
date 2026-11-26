import { describe, expect, it } from 'vitest'
import { ICE, type IceSheet } from '../src/data/winter'
import { buildTruck, stockBuild } from '../src/sim/build'
import { iceHolds, iceReading, safeSpeed, waveFactor } from '../src/sim/ice'
import { kmhToMs } from '../src/sim/units'

const sheet = (cm: number, waveKmh: number): IceSheet => ({ thickness: cm / 100, waveSpeed: kmhToMs(waveKmh) })

describe('lake ice', () => {
  it('holds a load that grows with its thickness squared (Gold’s rule)', () => {
    expect(iceHolds(sheet(45, 30))).toBeCloseTo(ICE.bearing * 0.45 * 0.45, 6)
    expect(iceHolds(sheet(90, 30)) / iceHolds(sheet(45, 30))).toBeCloseTo(4, 9)
  })

  it('feels just the weight at a crawl, more near the wave speed, and stays at the peak above it', () => {
    const wave = kmhToMs(30)
    expect(waveFactor(0, wave)).toBe(1)
    let last = 1
    for (let kmh = 2; kmh <= 26; kmh += 2) {
      const f = waveFactor(kmhToMs(kmh), wave)
      expect(f).toBeGreaterThan(last)
      last = f
    }
    const peak = waveFactor(wave, wave)
    expect(peak).toBeGreaterThan(1.4)
    expect(peak).toBeLessThan(1.6)
    expect(waveFactor(wave * 3, wave)).toBeCloseTo(peak, 12)
  })

  it('cracks under a heavy truck near the wave speed, but holds a light 4x4 and a side-by-side', () => {
    const ice = sheet(40, 35)
    const heavy = buildTruck(stockBuild('heavy')).mass
    const light = buildTruck(stockBuild('light4x4')).mass
    const sxs = buildTruck(stockBuild('sxs')).mass
    expect(iceReading(heavy, kmhToMs(35), ice).band).toBe('cracks')
    expect(iceReading(heavy, kmhToMs(5), ice).band).not.toBe('cracks')
    expect(iceReading(light, kmhToMs(60), ice).band).toBe('quiet')
    expect(iceReading(sxs, kmhToMs(60), ice).band).toBe('quiet')
  })

  it('creaks before it cracks', () => {
    const heavy = buildTruck(stockBuild('heavy')).mass
    const ice = sheet(40, 35)
    const bands = new Set<string>()
    for (let kmh = 0; kmh <= 40; kmh += 0.5) bands.add(iceReading(heavy, kmhToMs(kmh), ice).band)
    expect([...bands]).toEqual(['quiet', 'creaking', 'cracks'])
  })

  it('works out the fastest safe speed, matching the reading', () => {
    const heavy = buildTruck(stockBuild('heavy')).mass
    const ice = sheet(40, 35)
    const v = safeSpeed(heavy, ice)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(ice.waveSpeed)
    expect(iceReading(heavy, v, ice).use).toBeCloseTo(1, 6)
    expect(iceReading(heavy, v * 0.98, ice).use).toBeLessThan(1)
    // Thick ice takes any speed; ice too thin for the truck parked takes none.
    expect(safeSpeed(heavy, sheet(100, 35))).toBe(Infinity)
    expect(safeSpeed(heavy, sheet(20, 35))).toBe(0)
  })
})
