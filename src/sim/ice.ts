/**
 * Lake ice (plan PR 10): does the ice hold the truck up? Pure maths, no dice:
 * the same truck at the same speed on the same ice always gets the same
 * answer. The numbers and what they mean are in `src/data/winter.ts`.
 *
 * Load on the ice = the truck's mass × the wave factor (how much the wave it
 * pushes under the ice adds). What the ice holds = `ICE.bearing` × thickness².
 * The reading is one over the other: 1 or more and the ice cracks.
 */
import { ICE, type IceSheet } from '../data/winter'

export type IceBand = 'quiet' | 'creaking' | 'cracks'

export interface IceReading {
  /** What the ice holds before it cracks (kg). */
  holds: number
  /** How much the wave adds: 1 when crawling, up to about 1.5 near the wave's speed. */
  wave: number
  /** The load the ice feels (kg). */
  load: number
  /** Load against what it holds: 1 or more cracks it. */
  use: number
  band: IceBand
}

/** Where the wave factor peaks, as a share of the wave's speed. */
const PEAK = Math.sqrt(1 - 2 * ICE.waveDamping * ICE.waveDamping)

/**
 * How much the wave under the ice adds at this road speed: a resonance
 * curve that peaks just under the wave's own speed and stays at its peak
 * above it.
 */
export function waveFactor(speed: number, waveSpeed: number): number {
  const r0 = waveSpeed > 0 ? speed / waveSpeed : 0
  const r = r0 > PEAK ? PEAK : r0
  const a = 1 - r * r
  const b = 2 * ICE.waveDamping * r
  return 1 / Math.sqrt(a * a + b * b)
}

/** What a sheet of ice holds before it cracks (kg). */
export function iceHolds(ice: IceSheet): number {
  return ICE.bearing * ice.thickness * ice.thickness
}

/** How a truck of `mass` (kg) at `speed` (m/s) loads this ice. */
export function iceReading(mass: number, speed: number, ice: IceSheet): IceReading {
  const holds = iceHolds(ice)
  const wave = waveFactor(speed, ice.waveSpeed)
  const load = mass * wave
  const use = holds > 0 ? load / holds : Infinity
  const band: IceBand = use >= 1 ? 'cracks' : use >= ICE.warnFrom ? 'creaking' : 'quiet'
  return { holds, wave, load, use, band }
}

/** The fastest a truck of `mass` can go on this ice without cracking it (m/s), or Infinity if any speed is fine, or 0 if none is. */
export function safeSpeed(mass: number, ice: IceSheet): number {
  const holds = iceHolds(ice)
  if (mass >= holds) return 0
  const worst = waveFactor(ice.waveSpeed * PEAK, ice.waveSpeed)
  if (mass * worst < holds) return Infinity
  // Solve wave(r) = holds / mass for r below the peak: (1 - r²)² + (2ζr)² = (mass / holds)².
  const k = (mass / holds) * (mass / holds)
  const z = 2 * ICE.waveDamping * ICE.waveDamping
  // With u = r²: u² - 2(1 - z)u + (1 - k) = 0, smaller root.
  const half = 1 - z
  const u = half - Math.sqrt(half * half - (1 - k))
  return Math.sqrt(u > 0 ? u : 0) * ice.waveSpeed
}
