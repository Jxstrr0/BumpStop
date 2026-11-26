/**
 * The terrain strip (plan PR 5): the test loop's road in 3D, built from the
 * very same road profiles the ride sim drives (`src/sim/ground.ts`), so every
 * washboard ripple, whoop, rock and jump the truck reacts to is there under
 * its wheels.
 *
 * The sim's road is two lines of heights, one under each wheel track. The
 * strip stretches them across a gravel road: the left track, a slight crown
 * in the middle, the right track, then soft shoulders, a ditch and a bank,
 * with boreal forest (spruce and birch) beyond.
 *
 * Distances along the strip are metres into the run, less the strip's
 * `origin`, so numbers stay small and exact on the phone's graphics chip.
 */
import * as THREE from 'three'
import type { GroundId } from '../data/ground'
import { heightAt, type Profile } from '../sim/ground'

/** One piece of the loop, placed along the run: its road starts `offset` metres into the run. */
export interface PlacedPiece {
  profile: Profile
  offset: number
}

/** Ground colours (sRGB): gravel in two tones, plus the odd ones out. */
const GROUND_COLOUR: Record<GroundId, number> = {
  graded: 0xb9a888,
  washboard: 0xb0997a,
  rough: 0xa48d6f,
  whoops: 0xab9473,
  rocks: 0x9a9286,
  jumps: 0xb39a76,
  iceHeaves: 0xc9d3da,
}
const VERGE = 0x8f8a6c
const BANK = 0x6f7259
const NIGHT_DIM = 0.62

/** A repeatable 0 to 1 number from a position, so colours and trees stay put between rebuilds. */
export function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Where each piece of the loop sits along the run, from the poses in a clip.
 * A piece's road is `piece length + wheelbase` long and the truck drives the
 * middle of it, so the next piece's road starts `piece length` later.
 */
export function placePieces(road: readonly Profile[], wheelbase: number, piece: number, distance: number, x: number): PlacedPiece[] {
  const n = road.length
  const here = distance - x
  const out: PlacedPiece[] = [{ profile: road[piece]!, offset: here }]
  // Two pieces each way is plenty for a strip of a couple of hundred metres.
  let off = here
  for (let k = 1; k <= 2; k++) {
    const prev = road[(((piece - k) % n) + n) % n]!
    off -= prev.length - wheelbase
    out.unshift({ profile: prev, offset: off })
  }
  off = here
  for (let k = 1; k <= 2; k++) {
    off += road[(((piece + k - 1) % n) + n) % n]!.length - wheelbase
    out.push({ profile: road[(piece + k) % n]!, offset: off })
  }
  return out
}

/** The piece that covers run-distance `s` best (furthest from its ends), or null. */
function pieceAt(pieces: readonly PlacedPiece[], s: number): PlacedPiece | null {
  let best: PlacedPiece | null = null
  let room = 0
  for (const p of pieces) {
    const u = s - p.offset
    const r = Math.min(u, p.profile.length - u)
    if (r > room) {
      room = r
      best = p
    }
  }
  return best
}

/** Road height under the left or right wheel track at run-distance `s`. */
export function roadHeight(pieces: readonly PlacedPiece[], side: 'left' | 'right', s: number): number {
  const p = pieceAt(pieces, s)
  if (!p) return 0
  return heightAt(p.profile[side], p.profile.step, s - p.offset)
}

export interface StripOptions {
  /** Run-distance of the strip's start and end (m). */
  from: number
  to: number
  /** The run-distance that sits at x = 0 in the scene. */
  origin: number
  /** Half the distance between the wheel tracks (m). */
  halfTrack: number
  /** Metres between rows along the road. */
  step: number
  night: boolean
}

/**
 * Lateral columns across the strip (m, + to the truck's right) and how each
 * gets its height: from a wheel track, between them, or as verge.
 */
function columns(halfTrack: number): { z: number; kind: 'left' | 'right' | 'mid' | 'shoulder' | 'ditch' | 'bank' | 'far' }[] {
  const edge = halfTrack + 0.9
  return [
    { z: -28, kind: 'far' }, { z: -9, kind: 'bank' }, { z: -edge - 1.6, kind: 'ditch' }, { z: -edge, kind: 'shoulder' },
    { z: -halfTrack - 0.25, kind: 'left' }, { z: -halfTrack, kind: 'left' }, { z: -halfTrack + 0.25, kind: 'left' },
    { z: 0, kind: 'mid' },
    { z: halfTrack - 0.25, kind: 'right' }, { z: halfTrack, kind: 'right' }, { z: halfTrack + 0.25, kind: 'right' },
    { z: edge, kind: 'shoulder' }, { z: edge + 1.6, kind: 'ditch' }, { z: 9, kind: 'bank' }, { z: 28, kind: 'far' },
  ]
}

/** Build the road strip's mesh geometry (heights and colours). */
export function stripGeometry(pieces: readonly PlacedPiece[], o: StripOptions): THREE.BufferGeometry {
  const cols = columns(o.halfTrack)
  const rows = Math.max(2, Math.ceil((o.to - o.from) / o.step) + 1)
  const nc = cols.length
  const pos = new Float32Array(rows * nc * 3)
  const col = new Float32Array(rows * nc * 3)
  const c = new THREE.Color()
  const dim = o.night ? NIGHT_DIM : 1
  for (let r = 0; r < rows; r++) {
    const s = o.from + r * o.step
    const left = roadHeight(pieces, 'left', s)
    const right = roadHeight(pieces, 'right', s)
    const ground = pieceAt(pieces, s)?.profile.ground ?? 'graded'
    for (let k = 0; k < nc; k++) {
      const { z, kind } = cols[k]!
      const n = hash2(Math.round(s * 2), k)
      let y: number
      let base: number
      switch (kind) {
        case 'left': y = left; base = GROUND_COLOUR[ground]; break
        case 'right': y = right; base = GROUND_COLOUR[ground]; break
        // A slight crown between the ruts, so the middle of the road isn't flat.
        case 'mid': y = (left + right) / 2 + 0.03; base = GROUND_COLOUR[ground]; break
        case 'shoulder': y = (z < 0 ? left : right) * 0.4 + 0.02; base = GROUND_COLOUR.graded; break
        case 'ditch': y = -0.35 + n * 0.08; base = VERGE; break
        case 'bank': y = 0.4 + hash2(Math.round(s / 6), k) * 0.9; base = BANK; break
        default: y = 1.5 + hash2(Math.round(s / 20), k) * 3; base = BANK
      }
      const i = (r * nc + k) * 3
      pos[i] = s - o.origin
      pos[i + 1] = y
      pos[i + 2] = z
      c.setHex(base, THREE.SRGBColorSpace)
      // Ruts are darker, and every patch varies a little so the eye can read the speed.
      const rut = kind === 'left' || kind === 'right' ? (Math.abs(Math.abs(z) - o.halfTrack) < 0.01 ? 0.86 : 0.93) : 1
      const shade = (0.9 + n * 0.16) * rut * dim
      col[i] = c.r * shade
      col[i + 1] = c.g * shade
      col[i + 2] = c.b * shade
    }
  }
  const index: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < nc - 1; k++) {
      const a = r * nc + k
      const b = a + nc
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/**
 * The forest beside the road: spruces (dark cones) and birches (pale trunks
 * with a light crown), placed by a hash of their position so they stay put.
 */
export class Forest {
  readonly group = new THREE.Group()
  private spruce: THREE.InstancedMesh
  private birch: THREE.InstancedMesh
  private crowns: THREE.InstancedMesh

  constructor(max = 260) {
    const spruceMat = new THREE.MeshStandardMaterial({ color: 0x3d4a40, roughness: 0.9, flatShading: true })
    this.spruce = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), spruceMat, max)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.8 })
    this.birch = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 1, 6), trunkMat, max)
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x8c8a5c, roughness: 0.9, flatShading: true })
    this.crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), crownMat, max)
    for (const m of [this.spruce, this.birch, this.crowns]) {
      m.castShadow = false
      m.receiveShadow = false
      m.frustumCulled = false
      this.group.add(m)
    }
  }

  /** Plant trees along [from, to] (run-distance), drawn relative to `origin`. */
  plant(from: number, to: number, origin: number, halfTrack: number, night: boolean): void {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    const p = new THREE.Vector3()
    let ns = 0
    let nb = 0
    const max = this.spruce.instanceMatrix.count
    // One chance of a tree per 3 metres per side, between the bank and the far slope.
    for (let s = Math.ceil(from / 3) * 3; s < to; s += 3) {
      for (const side of [-1, 1]) {
        for (let row = 0; row < 3; row++) {
          const h = hash2(s, side * 7 + row)
          if (h < 0.35) continue
          const dist = halfTrack + 9 + row * 6 + hash2(s + 1, row) * 5
          const along = s + hash2(s, row + 11) * 3 - origin
          const y = 0.4 + row * 0.5
          if (h < 0.85 && ns < max) {
            const tall = 4 + hash2(s, row + 3) * 6
            p.set(along, y + tall / 2, side * dist)
            sc.set(tall * 0.22, tall, tall * 0.22)
            this.spruce.setMatrixAt(ns++, m.compose(p, q, sc))
          } else if (nb < max) {
            const tall = 4 + hash2(s, row + 5) * 4
            p.set(along, y + tall / 2, side * dist)
            sc.set(1, tall, 1)
            this.birch.setMatrixAt(nb, m.compose(p, q, sc))
            p.set(along, y + tall * 0.82, side * dist)
            sc.set(0.9 + h * 0.4, tall * 0.28, 0.9 + h * 0.4)
            this.crowns.setMatrixAt(nb++, m.compose(p, q, sc))
          }
        }
      }
    }
    this.spruce.count = ns
    this.birch.count = nb
    this.crowns.count = nb
    for (const mesh of [this.spruce, this.birch, this.crowns]) mesh.instanceMatrix.needsUpdate = true
    const dim = night ? 0.5 : 1
    ;(this.spruce.material as THREE.MeshStandardMaterial).color.setHex(0x3d4a40).multiplyScalar(dim)
    ;(this.birch.material as THREE.MeshStandardMaterial).color.setHex(0xe9e4d6).multiplyScalar(dim)
    ;(this.crowns.material as THREE.MeshStandardMaterial).color.setHex(0x8c8a5c).multiplyScalar(dim)
  }
}
