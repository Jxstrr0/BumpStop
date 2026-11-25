/**
 * Road profiles built from the seeded recipes in `src/data/ground.ts`.
 *
 * A profile is two rows of heights, one per wheel track (left and right),
 * sampled every `SIM.profileStep` metres. The same recipe, length and seed
 * always give exactly the same heights.
 */
import { GROUND, type GroundId, type Range } from '../data/ground'
import { SIM } from '../data/ride'
import { PI, detCos, detExp, detSin } from './det'
import type { Rng } from './rng'

export interface Profile {
  ground: GroundId
  /** Metres between samples. */
  step: number
  /** Length of road covered (m). */
  length: number
  left: Float64Array
  right: Float64Array
}

const TWO_PI = 2 * PI

/** Road height under one track at distance x, straight-line between samples. Off the ends it stays at the end height. */
export function heightAt(track: Float64Array, step: number, x: number): number {
  const last = track.length - 1
  const f = x / step
  if (f <= 0) return track[0] as number
  if (f >= last) return track[last] as number
  const i = Math.floor(f)
  const a = track[i] as number
  return a + ((track[i + 1] as number) - a) * (f - i)
}

function pick(rng: Rng, r: Range): number {
  return rng.range(r[0], r[1])
}


/** Smoothed random ripples with a given RMS height, run forward and back through a one-step filter. */
function roughness(rng: Rng, n: number, step: number, rms: number, length: number): Float64Array {
  const out = new Float64Array(n)
  if (rms <= 0) return out
  // One draw per sample is enough: the smoothing below turns it into gentle ripples.
  for (let i = 0; i < n; i++) out[i] = 2 * rng.next() - 1
  const a = detExp(-step / length)
  let y = 0
  for (let i = 0; i < n; i++) { y = a * y + (1 - a) * (out[i] as number); out[i] = y }
  y = 0
  for (let i = n - 1; i >= 0; i--) { y = a * y + (1 - a) * (out[i] as number); out[i] = y }
  let sum = 0
  for (let i = 0; i < n; i++) sum += (out[i] as number) * (out[i] as number)
  const now = Math.sqrt(sum / n)
  const scale = now > 0 ? rms / now : 0
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) * scale
  return out
}

/** A smooth hump from 0 up to 1 and back to 0 over u in [0, 1]. */
function hump(u: number): number {
  return 0.5 - 0.5 * detCos(TWO_PI * u)
}

/** A smooth rise from 0 to 1 over u in [0, 1]. */
function rise(u: number): number {
  return 0.5 - 0.5 * detCos(PI * u)
}

/** Add `h(u)` over [x0, x0 + len] to a track, where u runs 0 to 1. */
function stamp(track: Float64Array, step: number, x0: number, len: number, h: (u: number) => number): void {
  const i0 = Math.max(0, Math.ceil(x0 / step))
  const i1 = Math.min(track.length - 1, Math.floor((x0 + len) / step))
  for (let i = i0; i <= i1; i++) {
    const u = (i * step - x0) / len
    track[i] = (track[i] as number) + h(u)
  }
}

/**
 * Build `length` metres of road from a recipe. Each layer draws from its own
 * named stream, so adding a layer to a recipe never moves another layer's bumps.
 */
export function buildProfile(ground: GroundId, length: number, rng: Rng): Profile {
  const recipe = GROUND[ground]
  const step = SIM.profileStep
  const n = Math.max(2, Math.floor(length / step) + 1)
  const left = new Float64Array(n)
  const right = new Float64Array(n)

  // Base roughness: a shared layer plus each side's own, mixed by trackLink.
  const shared = roughness(rng.fork('rough-shared'), n, step, recipe.roughness, recipe.roughnessLength)
  const ownL = roughness(rng.fork('rough-left'), n, step, recipe.roughness, recipe.roughnessLength)
  const ownR = roughness(rng.fork('rough-right'), n, step, recipe.roughness, recipe.roughnessLength)
  const k = recipe.trackLink
  const kOwn = Math.sqrt(1 - k * k)
  for (let i = 0; i < n; i++) {
    left[i] = k * (shared[i] as number) + kOwn * (ownL[i] as number)
    right[i] = k * (shared[i] as number) + kOwn * (ownR[i] as number)
  }

  if (recipe.washboard) {
    const w = recipe.washboard
    const r = rng.fork('washboard')
    const baseLength = pick(r, w.wavelength)
    const baseAmp = pick(r, w.amplitude)
    // The wavelength and depth wander slowly along the road.
    const drift = roughness(r.fork('drift'), n, step, 1, w.wanderLength)
    const depth = roughness(r.fork('depth'), n, step, 1, w.depthLength)
    let phase = r.range(0, TWO_PI)
    for (let i = 0; i < n; i++) {
      const lambda = baseLength * (1 + w.wander * (drift[i] as number))
      phase += (TWO_PI * step) / lambda
      const amp = baseAmp * (1 + w.depthWobble * (depth[i] as number))
      const h = amp * detSin(phase)
      left[i] = (left[i] as number) + h
      right[i] = (right[i] as number) + h
    }
  }

  if (recipe.whoops) {
    const w = recipe.whoops
    const r = rng.fork('whoops')
    // Start part-way through a gap, so short and long sections get the same whoops per km on average.
    let x = r.range(0, (w.gap[0] + w.gap[1]) / 2)
    while (x < length) {
      const count = Math.round(pick(r, w.perSet))
      for (let j = 0; j < count && x < length; j++) {
        const len = pick(r, w.length)
        const h = pick(r, w.height)
        stamp(left, step, x, len, (u) => h * hump(u))
        stamp(right, step, x + r.range(-w.stagger, w.stagger), len, (u) => h * hump(u))
        x += len
      }
      x += pick(r, w.gap)
    }
  }

  if (recipe.rocks) {
    const w = recipe.rocks
    const r = rng.fork('rocks')
    const count = Math.round((w.per100m * length) / 100)
    for (let j = 0; j < count; j++) {
      const x = r.range(0, length)
      const len = pick(r, w.length)
      const h = pick(r, w.height)
      // Rocks are steep-sided: a hump squared.
      const shape = (u: number) => { const s = detSin(PI * u); return h * s * s }
      if (r.chance(w.bothTracks)) {
        stamp(left, step, x, len, shape)
        stamp(right, step, x, len, shape)
      } else {
        stamp(r.chance(0.5) ? left : right, step, x, len, shape)
      }
    }
  }

  if (recipe.jumps) {
    const w = recipe.jumps
    const r = rng.fork('jumps')
    // Start part-way through a gap, so short and long sections get the same jumps per km on average.
    let x = r.range(0, (w.spacing[0] + w.spacing[1]) / 2)
    while (x < length) {
      const up = pick(r, w.runUp)
      const h = pick(r, w.height)
      const top = pick(r, w.top)
      const drop = pick(r, w.drop)
      const total = up + top + drop
      const shape = (u: number) => {
        const d = u * total
        if (d < up) return h * rise(d / up)
        if (d < up + top) return h
        return h * (1 - rise((d - up - top) / drop))
      }
      stamp(left, step, x, total, shape)
      stamp(right, step, x, total, shape)
      x += total + pick(r, w.spacing)
    }
  }

  if (recipe.heaves) {
    const w = recipe.heaves
    const r = rng.fork('heaves')
    const count = Math.round((w.per100m * length) / 100)
    for (let j = 0; j < count; j++) {
      const x = r.range(0, length)
      const len = pick(r, w.length)
      const h = pick(r, w.height)
      const crack = pick(r, w.crack)
      // A broad lump with a crack in it: the slab before the crack is lifted a
      // little more, so the wheel drops off a sharp step part-way over.
      const shape = (u: number) => h * hump(u) + (u < w.crackAt ? crack * rise(u / w.crackAt) : 0)
      if (r.chance(w.oneTrack)) {
        stamp(r.chance(0.5) ? left : right, step, x, len, shape)
      } else {
        stamp(left, step, x, len, shape)
        stamp(right, step, x, len, shape)
      }
    }
  }

  // Fade the ground in and out at both ends so every section starts and ends level.
  const taper = Math.min(SIM.profileTaper, length / 4)
  for (let i = 0; i < n; i++) {
    const x = i * step
    const edge = x < taper ? x / taper : x > length - taper ? (length - x) / taper : 1
    if (edge < 1) {
      const e = rise(edge < 0 ? 0 : edge)
      left[i] = (left[i] as number) * e
      right[i] = (right[i] as number) * e
    }
  }

  return { ground, step, length: (n - 1) * step, left, right }
}
