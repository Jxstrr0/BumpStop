/**
 * The scenery round the road: Birchland's spruce and birch, rocks, heather
 * and fireweed, dry-stone walls, power poles, roadbook caution boards, and
 * the test loop's start line.
 *
 * The pieces are made in Blender (`scripts/blender/make-scenery.py` writes
 * `public/models/scenery.glb.gz`): one small mesh each, with its colours
 * painted on. Here each piece is drawn as many times as it's planted in one
 * go (an "instanced mesh"), so a whole forest costs a handful of draw calls.
 *
 * Where things stand comes from tables in `src/data/scenery.ts` and from
 * the land itself (`src/render/terrain.ts`): nothing is random, so the same
 * stretch of road always has the same trees.
 *
 * **The rule that matters:** nothing tall stands between the cameras (on
 * the truck's left) and the truck. The suspension is the show.
 */
import * as THREE from 'three'
import { CAUTION, LAND, ROADSIDE, START_LINE, SUMMER, WINTER, type Scatter } from '../data/scenery'
import { loadGlb } from './glb'
import { hash2, lumps, wood, type Ground } from './terrain'

/** Every piece's shape, by name. */
export type Kit = ReadonlyMap<string, THREE.BufferGeometry>

let kit: Promise<Kit> | null = null

/** Fetch the scenery kit (once; every view shares it). */
export function loadKit(): Promise<Kit> {
  kit ??= loadGlb('scenery').then((root) => {
    const out = new Map<string, THREE.BufferGeometry>()
    root.updateMatrixWorld(true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      out.set(mesh.name, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld))
    })
    return out
  })
  // A failed fetch isn't kept: the next view tries again.
  kit.catch(() => (kit = null))
  return kit
}

/** The one material every piece shares: its colours are painted on the mesh. Grass blades are single cards, so both faces draw. */
export function kitMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
}

/** How dark the scenery goes on a night stage. */
const NIGHT_DIM = 0.5

/** Somewhere to stand scenery: call `begin`, `put` each piece, then `end`. */
export interface Planter {
  begin(): void
  /** Stand a piece at a spot: `turn` radians about the upright, `size` times its own size, `tint` lighter or darker. */
  put(piece: string, x: number, y: number, z: number, turn?: number, size?: number, tint?: number): void
  end(night: boolean): void
}

/** Many copies of the kit's pieces, each kind drawn in one go. */
export class Props implements Planter {
  readonly group = new THREE.Group()
  readonly material = kitMaterial()
  private meshes = new Map<string, THREE.InstancedMesh>()
  /** Per piece: x, y, z, turn, size, tint for each copy. */
  private lists = new Map<string, number[]>()

  constructor(private kit: Kit) {}

  begin(): void {
    for (const list of this.lists.values()) list.length = 0
  }

  put(piece: string, x: number, y: number, z: number, turn = 0, size = 1, tint = 1): void {
    let list = this.lists.get(piece)
    if (!list) this.lists.set(piece, (list = []))
    list.push(x, y, z, turn, size, tint)
  }

  end(night: boolean): void {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    const dim = night ? NIGHT_DIM : 1
    for (const [piece, list] of this.lists) {
      const count = list.length / 6
      let mesh = this.meshes.get(piece)
      if (count > (mesh?.instanceMatrix.count ?? 0)) {
        // Not enough room: make a bigger one, with some to spare for the next stretch.
        const geometry = this.kit.get(piece)
        if (!geometry) continue
        if (mesh) {
          this.group.remove(mesh)
          mesh.dispose()
        }
        mesh = new THREE.InstancedMesh(geometry, this.material, Math.ceil(count * 1.4) + 4)
        // Scenery neither casts nor takes the truck's shadow (the sun's shadow only reaches round the truck).
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.frustumCulled = false
        this.meshes.set(piece, mesh)
        this.group.add(mesh)
      }
      if (!mesh) continue
      for (let i = 0; i < count; i++) {
        const k = i * 6
        p.set(list[k]!, list[k + 1]!, list[k + 2]!)
        q.setFromAxisAngle(up, list[k + 3]!)
        s.setScalar(list[k + 4]!)
        mesh.setMatrixAt(i, m.compose(p, q, s))
        mesh.setColorAt(i, c.setScalar(list[k + 5]! * dim))
      }
      mesh.count = count
      mesh.visible = count > 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose()
    this.material.dispose()
  }
}

export interface PlantOptions {
  /** Run-distance of the fine road's start and end (m): small things are only planted near it. */
  from: number
  to: number
  /** The run-distance at x = 0 in the scene. */
  origin: number
  /** How far out on the left the cameras stand (m): nothing tall is planted nearer than this on that side. */
  lane: number
  /** The graphics tier's share of the scenery (1 is Full). */
  cover: number
  night: boolean
  /** The road is a rig's loop: stand the start line at the top of the lap. */
  loop: boolean
  /** Front axle to rear axle (m). */
  wheelbase: number
}

/** A power line's wires, drawn as thin lines from pole to pole. */
export class Wires {
  readonly lines: THREE.LineSegments
  private material = new THREE.LineBasicMaterial({ color: 0x3a3b41 })

  constructor() {
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material)
    this.lines.frustumCulled = false
  }

  /** `poles`: x, y, z of each pole's foot, in order along the road; a gap in the line is a NaN x. */
  set(poles: readonly number[], night: boolean): void {
    const pts: number[] = []
    const SAG = 0.9
    const PARTS = 6
    for (let i = 0; i + 5 < poles.length; i += 3) {
      const [x0, y0, z0, x1, y1, z1] = [poles[i]!, poles[i + 1]!, poles[i + 2]!, poles[i + 3]!, poles[i + 4]!, poles[i + 5]!]
      if (Number.isNaN(x0) || Number.isNaN(x1)) continue
      // Three wires, one per insulator on the crossarm (see `power_pole` in the Blender script).
      for (const dz of [-0.85, 0, 0.85]) {
        for (let k = 0; k < PARTS; k++) {
          for (const u of [k / PARTS, (k + 1) / PARTS]) {
            // A hanging wire dips most in the middle.
            pts.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + 7.86 - SAG * 4 * u * (1 - u), z0 + (z1 - z0) * u + dz)
          }
        }
      }
    }
    this.lines.geometry.dispose()
    this.lines.geometry = new THREE.BufferGeometry()
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this.material.color.setHex(night ? 0x0c0d10 : 0x3a3b41)
    this.lines.visible = pts.length > 0
  }

  dispose(): void {
    this.lines.geometry.dispose()
    this.material.dispose()
  }
}

const mod = (a: number, n: number) => ((a % n) + n) % n

/**
 * Plant a stretch of road: the forest and ground cover from the tables,
 * then the things people put there. Returns the power poles' feet for the
 * wires (`Wires.set`).
 */
export function plant(props: Planter, ground: Ground, o: PlantOptions): number[] {
  const land = ground.land
  const lap = land.lap
  const edge = land.halfTrack + 0.9
  props.begin()
  const here = (s: number, z: number, piece: string, turn = 0, size = 1, tint = 1, sink = 0) =>
    props.put(piece, s - o.origin, ground.at(s, z) - sink, z, turn, size, tint)
  /** A spacing near `want` that divides the lap, so things come round in the same place each lap. */
  const every = (want: number) => (lap > 0 ? lap / Math.max(1, Math.round(lap / want)) : want)

  // --- Things people put there (first, so the forest can leave room for them). ---
  /** Circles to keep clear: s, z, radius. */
  const clear: number[] = []
  const lineRuns = (s: number) => lumps(s, 0, 420, lap, 7) > 0.5
  const wallRuns = (s: number) => o.cover >= ROADSIDE.wallCover && lumps(s, 0, 260, lap, 8) > 0.6

  // Marker posts down the far side.
  const postGap = every(ROADSIDE.postEvery)
  for (let k = Math.ceil(ground.from / postGap); k * postGap <= ground.to; k++) here(k * postGap, edge + 0.55, 'Post')

  // A caution board before rough ground, like the roadbook's own danger marks.
  land.pieces.forEach((p, i) => {
    const marks = CAUTION[p.profile.ground]
    const before = land.pieces[i - 1]?.profile.ground
    if (!marks || before === p.profile.ground) return
    const s = p.offset + o.wheelbase / 2 - ROADSIDE.boardBefore
    if (s > ground.from && s < ground.to) here(s, edge + 0.7, `Board_${marks}`, 0, 1, 1, 0.05)
  })

  // A power line down the right, where one runs.
  const poles: number[] = []
  const poleGap = every(ROADSIDE.poleEvery)
  for (let k = Math.ceil(ground.from / poleGap); k * poleGap <= ground.to; k++) {
    const s = k * poleGap
    if (!lineRuns(s)) {
      poles.push(NaN, 0, 0)
      continue
    }
    const y = ground.at(s, ROADSIDE.poleOut)
    props.put('Pole', s - o.origin, y - 0.1, ROADSIDE.poleOut, (hash2(k, 3) - 0.5) * 0.1)
    poles.push(s - o.origin, y - 0.1, ROADSIDE.poleOut)
  }

  // A dry-stone wall along the right in places, with a gate now and then.
  const wallGap = every(ROADSIDE.wallLength)
  for (let k = Math.ceil((o.from - 60) / wallGap); k * wallGap <= o.to + 90; k++) {
    const s = k * wallGap
    if (!wallRuns(s)) continue
    const gate = mod(k, 23) === 11
    here(s, ROADSIDE.wallOut, gate ? 'Gate' : 'Wall', 0, 1, 0.92 + hash2(k, 5) * 0.14, gate ? 0 : 0.06)
  }

  // A stone bothy back from the road, its door to the road, and a cairn on the verge further on.
  const bothyGap = every(ROADSIDE.bothyEvery)
  for (let k = Math.floor(ground.from / bothyGap); k * bothyGap <= ground.to; k++) {
    const n = lap > 0 ? mod(k, Math.round(lap / bothyGap)) : k
    const s = (k + 0.2 + hash2(n, 21) * 0.6) * bothyGap
    const z = 15 + hash2(n, 22) * 5
    if (s > ground.from && s < ground.to) {
      here(s, z, 'Bothy', Math.PI + (hash2(n, 23) - 0.5) * 0.5, 1, 1, 0.15)
      clear.push(s, z, 8.5)
    }
    const cairn = s + bothyGap * 0.45
    if (cairn > ground.from && cairn < ground.to) here(cairn, edge + 4.2, 'Cairn', hash2(n, 24) * 6)
  }

  // The test loop's start line: the arch over the road, the timing hut, tire stacks, pennants and straw bales.
  if (o.loop && lap > 0) {
    for (let k = Math.floor(ground.from / lap); k * lap + START_LINE.arch <= ground.to; k++) {
      const s = k * lap + START_LINE.arch
      if (s < ground.from) continue
      const foot = Math.min(ground.at(s, 5.2), ground.at(s, -5.2))
      props.put('Arch', s - o.origin, foot - 0.03, 0)
      for (const side of [-1, 1]) {
        for (const ds of [-1.3, 1.3]) here(s + ds, side * 4.25, 'TireStack', ds + side)
      }
      here(s + 6, 9.4, 'Hut', Math.PI / 2, 1, 1, 0.1)
      clear.push(s + 6, 9.4, 4.5)
      for (let i = 1; i <= START_LINE.pennants; i++) here(s + i * START_LINE.pennantEvery, edge + 2.9, 'Pennant', 0, 1, 1, 0.05)
      // Bales on the far side only: on the near side they'd hide the wheels.
      for (const ds of [-7, -4.6, 12, 19]) here(s + ds, edge + 2.6, 'Bale', hash2(ds, 31) * 0.5 - 0.25)
    }
  }

  const blocked = (s: number, z: number) => {
    for (let i = 0; i < clear.length; i += 3) {
      if (Math.hypot(s - clear[i]!, z - clear[i + 1]!) < clear[i + 2]!) return true
    }
    return false
  }

  // --- The forest and the ground cover, from the tables. ---
  const layers: readonly Scatter[] = land.winter ? WINTER : SUMMER
  layers.forEach((layer, li) => {
    // Small things only near the camera; trees all the way into the haze.
    const small = layer.cell < 3.5
    const a0 = small ? o.from - 20 : ground.from
    const a1 = small ? o.to + 45 : ground.to
    const cellS = every(layer.cell)
    const perLap = lap > 0 ? Math.round(lap / cellS) : 0
    let total = 0
    for (const [, weight] of layer.pieces) total += weight
    const sides = layer.side === 'both' ? [-1, 1] : [layer.side === 'left' ? -1 : 1]
    for (const side of sides) {
      for (let j = Math.floor(layer.near / layer.cell); j * layer.cell < layer.far; j++) {
        for (let i = Math.floor(a0 / cellS); i * cellS < a1; i++) {
          const ci = perLap ? mod(i, perLap) : i
          // Three numbers that belong to this square of this layer.
          const key = j * 7.13 + side * 3.7 + li * 29.9
          const d = (j + hash2(ci, key + 1.1)) * layer.cell
          if (d < layer.near || d > layer.far) continue
          const s = (i + hash2(ci, key + 2.3)) * cellS
          const z = side * d
          const u = (d - layer.near) / (layer.far - layer.near)
          let chance = (layer.chance + (layer.chanceFar - layer.chance) * u) * o.cover
          if (layer.wood) chance *= 0.1 + 0.9 * wood(land, s, z)
          if (hash2(ci, key + 3.9) > chance) continue
          // Keep the cameras' view of the truck clear.
          if (layer.tall && side < 0 && d < o.lane) continue
          // Room for the power line and the wall on the right.
          if (layer.tall && side > 0 && d < 12.5 && (lineRuns(s) || wallRuns(s))) continue
          if (blocked(s, z)) continue
          const y = ground.at(s, z)
          const shore = y < LAND.water + 0.6
          if (layer.open ? !shore || y < LAND.water - 0.12 : y < LAND.water + 0.08) continue
          // Pick the piece by its weight.
          let pick = hash2(ci, key + 5.7) * total
          let piece = layer.pieces[0]![0]
          for (const [name, weight] of layer.pieces) {
            piece = name
            pick -= weight
            if (pick <= 0) break
          }
          const size = layer.scale[0] + (layer.scale[1] - layer.scale[0]) * hash2(ci, key + 7.1)
          // Trees sink their roots a little, so none floats on a slope.
          props.put(piece, s - o.origin, y - (small ? 0.02 : 0.12 * size), z, hash2(ci, key + 8.3) * Math.PI * 2, size, 0.86 + hash2(ci, key + 9.9) * 0.24)
        }
      }
    }
  })

  props.end(o.night)
  return poles
}
