/**
 * Bypass dampers firm up at the ends (Kelbo, 26 November 2026). The bypass
 * (1996) and internal bypass (2008) dampers damp softly through the middle of
 * the travel and step up towards each end as each bypass tube shuts, like the
 * glossary says. They stay clearly apart from the Zed-Two spool valves: flat
 * steps that start earlier and top out lower, and normal heat fade.
 */
import { describe, expect, it } from 'vitest'
import { BYPASS_TUBES, PARTS, type DamperPart } from '../src/data/parts'
import { RIGS } from '../src/data/rigs'
import type { DamperSetup } from '../src/data/ride'
import { buildTruck, stockBuild } from '../src/sim/build'
import { runLaps } from '../src/sim/laps'
import { bypassScale, positionScale } from '../src/sim/ride'
import { fromCelsius } from '../src/sim/units'

const part = (id: string) => PARTS.find((p) => p.id === id) as DamperPart
const withDampers = (cls: 'light4x4' | 'heavy' | 'sxs', dampers: string) => {
  const b = stockBuild(cls)
  b.parts.dampers = dampers
  return buildTruck(b)
}

describe('bypass dampers', () => {
  it('have tubes: three steps for the bypass, two for the internal bypass; no other damper has any', () => {
    expect(part('bypass').bypass).toBe(BYPASS_TUBES.external)
    expect(part('internalBypass').bypass).toBe(BYPASS_TUBES.internal)
    expect(BYPASS_TUBES.external.steps.length).toBe(3)
    expect(BYPASS_TUBES.internal.steps.length).toBe(2)
    const others = PARTS.filter((p) => p.slot === 'dampers' && p.id !== 'bypass' && p.id !== 'internalBypass')
    for (const p of others) expect((p as DamperPart).bypass, p.id).toBeUndefined()
  })

  it('pass their tubes to the ride sim, and keep normal heat fade', () => {
    expect(withDampers('heavy', 'monotube').ride.front.damper.zones).toBeUndefined()
    for (const id of ['bypass', 'internalBypass']) {
      const d = withDampers('light4x4', id).ride.rear.damper
      expect(d.zones).toEqual(part(id).bypass)
      expect(d.oilSense).toBeUndefined()
      expect(d.position).toBeUndefined()
    }
  })

  describe('damping by position', () => {
    const d = withDampers('light4x4', 'bypass').ride.front.damper
    const z = d.zones!
    const bump = 0.12
    const droop = 0.1

    it('is soft through the middle of the travel, both ways', () => {
      for (const c of [-0.03, 0, 0.03]) {
        expect(positionScale(c, 1, d, bump, droop)).toBe(z.mid)
        expect(positionScale(c, -1, d, bump, droop)).toBe(z.mid)
      }
      expect(z.mid).toBeLessThan(1)
    })

    it('steps up towards the bump end, never down, holding flat between the tubes', () => {
      let last = z.mid
      for (let c = 0; c <= bump * 1.2; c += bump / 400) {
        const k = positionScale(c, 1, d, bump, droop)
        expect(k).toBeGreaterThanOrEqual(last - 1e-12)
        last = k
      }
      // Each plateau, just before the next tube's port.
      const steps = z.steps
      for (let i = 0; i < steps.length; i++) {
        const before = i + 1 < steps.length ? (steps[i + 1]!.from - 0.01) : 1
        expect(bypassScale(before, z)).toBeCloseTo(steps[i]!.scale, 9)
      }
      expect(positionScale(bump, 1, d, bump, droop)).toBeCloseTo(steps[steps.length - 1]!.scale, 9)
      // Rebound near the bump end stays soft, so the wheel can come back down.
      expect(positionScale(bump, -1, d, bump, droop)).toBe(z.mid)
    })

    it('firms up rebound near full droop, and leaves compression there soft', () => {
      const end = z.steps[z.steps.length - 1]!.scale
      expect(positionScale(-droop, -1, d, bump, droop)).toBeCloseTo(end, 9)
      expect(positionScale(-droop, 1, d, bump, droop)).toBe(z.mid)
    })

    it('ramps over each port rather than jumping', () => {
      const s = z.steps[0]!
      const half = bypassScale(s.from + z.port / 2, z)
      expect(half).toBeGreaterThan(z.mid)
      expect(half).toBeLessThan(s.scale)
      expect(bypassScale(s.from, z)).toBe(z.mid)
    })

    it('is clearly not a spool valve: firmer from half travel, but well short of 3.5 times at the end', () => {
      const spool = withDampers('light4x4', 'spoolValve').ride.front.damper
      const at = (dmp: DamperSetup, share: number) => positionScale(bump * share, 1, dmp, bump, droop)
      // Half way up, the bypass has already stepped up while the spool valve is still soft.
      expect(at(d, 0.55)).toBeGreaterThan(1)
      expect(at(spool, 0.55)).toBe(spool.position!.mid)
      // At the bump stop the spool valve is far firmer.
      expect(at(spool, 1)).toBeGreaterThan(at(d, 1) * 1.5)
    })
  })

  it('internal bypass starts later and stays gentler than the bypass', () => {
    const ext = BYPASS_TUBES.external
    const int = BYPASS_TUBES.internal
    expect(int.steps[0]!.from).toBeGreaterThan(ext.steps[0]!.from)
    expect(bypassScale(1, int)).toBeLessThan(bypassScale(1, ext))
    expect(int.mid).toBeGreaterThan(ext.mid)
  })

  it.each(['light4x4', 'heavy'] as const)(
    '%s on the torture loop: the tubes mean fewer bottom-outs than the same shocks without them',
    { timeout: 60_000 },
    (cls) => {
      const run = (tubes: boolean) => {
        const truck = withDampers(cls, 'bypass')
        if (!tubes) for (const a of [truck.ride.front, truck.ride.rear]) a.damper.zones = undefined
        return runLaps(truck.ride, truck.wear, RIGS.tortureLoop, 11, { airTemp: fromCelsius(20), trace: false })
      }
      const flat = run(false)
      const tubes = run(true)
      const laps = Math.min(flat.laps.length, tubes.laps.length)
      const bottoms = (r: typeof flat) => r.laps.slice(0, laps).reduce((sum, l) => sum + l.bottomOuts, 0)
      expect(bottoms(tubes)).toBeLessThan(bottoms(flat))
      expect(tubes.laps.length).toBeGreaterThanOrEqual(flat.laps.length)
    },
  )
})
