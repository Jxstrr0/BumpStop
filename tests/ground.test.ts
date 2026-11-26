import { describe, expect, it } from 'vitest'
import { GROUND, GROUND_IDS, WINTER_GROUND } from '../src/data/ground'
import { buildProfile, heightAt } from '../src/sim/ground'
import { Rng } from '../src/sim/rng'

const rms = (a: Float64Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
const max = (a: Float64Array) => a.reduce((m, x) => (x > m ? x : m), -Infinity)

describe('ground recipes', () => {
  it('has a recipe for every ground, each with a sensible sample length', () => {
    for (const id of GROUND_IDS) {
      expect(GROUND[id].id).toBe(id)
      expect(GROUND[id].sampleLength).toBeGreaterThanOrEqual(200)
    }
  })

  it.each(GROUND_IDS)('%s: the same seed builds exactly the same road', (id) => {
    const a = buildProfile(id, 600, new Rng(42))
    const b = buildProfile(id, 600, new Rng(42))
    expect(Array.from(a.left)).toEqual(Array.from(b.left))
    expect(Array.from(a.right)).toEqual(Array.from(b.right))
  })

  it.each(GROUND_IDS)('%s: a different seed builds a different road', (id) => {
    const a = buildProfile(id, 600, new Rng(1))
    const b = buildProfile(id, 600, new Rng(2))
    expect(Array.from(a.left)).not.toEqual(Array.from(b.left))
  })

  it.each(GROUND_IDS)('%s: starts and ends level, with only real numbers in between', (id) => {
    const p = buildProfile(id, 600, new Rng(5))
    expect(Math.abs(p.left[0]!)).toBeLessThan(1e-12)
    expect(Math.abs(p.right[0]!)).toBeLessThan(1e-12)
    expect(Math.abs(p.left[p.left.length - 1]!)).toBeLessThan(1e-12)
    for (const h of p.left) expect(Number.isFinite(h)).toBe(true)
    for (const h of p.right) expect(Number.isFinite(h)).toBe(true)
  })

  it('makes each ground look like itself', () => {
    const r = () => new Rng(9)
    const graded = buildProfile('graded', 1000, r())
    const washboard = buildProfile('washboard', 1000, r())
    const jumps = buildProfile('jumps', 1000, r())
    const rocks = buildProfile('rocks', 1000, r())
    expect(rms(washboard.left)).toBeGreaterThan(rms(graded.left) * 1.2)
    expect(max(jumps.left)).toBeGreaterThan(GROUND.jumps.jumps!.height[0])
    // Rocks sit under one track or the other, so the two sides differ.
    expect(rms(rocks.left.map((h, i) => h - rocks.right[i]!))).toBeGreaterThan(0.01)
    // Washboard runs right across the road, so the two sides share it.
    const wbDiff = rms(washboard.left.map((h, i) => h - washboard.right[i]!))
    expect(wbDiff).toBeLessThan(rms(washboard.left))
  })

  it('makes the winter grounds look like themselves', () => {
    const r = () => new Rng(9)
    const graded = buildProfile('graded', 2000, r())
    const ice = buildProfile('ice', 2000, r())
    const snow = buildProfile('snow', 2000, r())
    const heaves = buildProfile('iceHeaves', 2000, r())
    // Lake ice is glass with the odd pressure ridge; packed snow is rougher than graded gravel.
    // (The middle of the slopes, so the rare ridges don't count.)
    const roughOf = (p: typeof graded) => {
      const slopes = Array.from(p.left, (h, i) => Math.abs(i > 0 ? h - p.left[i - 1]! : 0)).sort((a, b) => a - b)
      return slopes[Math.floor(slopes.length / 2)]!
    }
    expect(roughOf(ice)).toBeLessThan(roughOf(graded))
    expect(roughOf(snow)).toBeGreaterThan(roughOf(graded))
    expect(max(heaves.left)).toBeGreaterThan(GROUND.iceHeaves.heaves!.height[0])
  })

  it('cracks frost heaves both ways: some step down, some step up into the tire', () => {
    const p = buildProfile('iceHeaves', 3000, new Rng(4))
    const cut = GROUND.iceHeaves.heaves!.crack[0] * 0.8
    let up = 0
    let down = 0
    for (const track of [p.left, p.right]) {
      for (let i = 1; i < track.length; i++) {
        const d = track[i]! - track[i - 1]!
        if (d > cut) up++
        if (d < -cut) down++
      }
    }
    expect(up).toBeGreaterThan(5)
    expect(down).toBeGreaterThan(5)
  })

  it('gives winter ground low grip, and studs bite only there', () => {
    for (const id of GROUND_IDS) {
      const g = GROUND[id]
      expect(g.studGrip).toBeGreaterThanOrEqual(g.grip)
      if (WINTER_GROUND.includes(id)) {
        expect(g.grip).toBeLessThan(0.5)
        expect(g.studGrip).toBeGreaterThan(g.grip)
      } else {
        expect(g.studGrip).toBe(g.grip)
      }
    }
    expect(GROUND.ice.grip).toBeLessThan(GROUND.snow.grip)
  })

  it('reads heights between samples in a straight line', () => {
    const p = buildProfile('rocks', 50, new Rng(3))
    const i = 400
    const mid = heightAt(p.left, p.step, (i + 0.5) * p.step)
    expect(mid).toBeCloseTo((p.left[i]! + p.left[i + 1]!) / 2, 12)
    expect(heightAt(p.left, p.step, -5)).toBe(p.left[0])
    expect(heightAt(p.left, p.step, 1e6)).toBe(p.left[p.left.length - 1])
  })
})
