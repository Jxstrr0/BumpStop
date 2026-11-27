/**
 * The scenery round the road (the scenery pass): the Blender kit has every
 * piece the tables ask for, the land joins up, a loop has the same scenery
 * every lap, and nothing tall ever stands between the cameras and the truck.
 */
import { readFileSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { TIERS } from '../src/data/graphics'
import { LAND, RIDGES, SUMMER, WINTER } from '../src/data/scenery'
import { plant, type PlantOptions, type Planter } from '../src/render/scenery'
import { buildGround, isWinter, lumps, type Land, type PlacedPiece } from '../src/render/terrain'
import { buildProfile } from '../src/sim/ground'
import { Rng } from '../src/sim/rng'
import type { GroundId } from '../src/data/ground'

const KIT = 'public/models/scenery.glb.gz'

interface Gltf {
  nodes: { name?: string; mesh?: number }[]
  meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[]
  accessors: { count: number }[]
}

function kitJson(): Gltf {
  const buf = gunzipSync(readFileSync(KIT))
  const length = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8')) as Gltf
}

/** Pieces the code stands by name (`src/render/scenery.ts`, `sky.ts`, `trackView.ts`). */
const BY_NAME = ['Post', 'Board_1', 'Board_2', 'Board_3', 'Pole', 'Wall', 'Gate', 'Bothy', 'Cairn', 'Arch', 'TireStack', 'Hut', 'Pennant', 'Bale', 'Cloud_A', 'Cloud_B', 'Cloud_C', 'Shop', 'ShakerBase', 'ShakerPan']

describe('the scenery kit', () => {
  const json = kitJson()
  const meshOf = new Map(json.nodes.filter((n) => n.mesh !== undefined).map((n) => [n.name ?? '', json.meshes[n.mesh!]!]))

  it('has every piece the tables and the code ask for', () => {
    const wanted = new Set([...BY_NAME, ...RIDGES.map((r) => r.piece)])
    for (const layer of [...SUMMER, ...WINTER]) for (const [piece] of layer.pieces) wanted.add(piece)
    for (const piece of wanted) expect(meshOf.has(piece), piece).toBe(true)
  })

  it('is one mesh per piece with its colours painted on, so each kind is one draw call', () => {
    for (const [name, mesh] of meshOf) {
      expect(mesh.primitives.length, name).toBe(1)
      expect(mesh.primitives[0]!.attributes.COLOR_0, name).toBeDefined()
    }
  })

  it('stays small: trees a phone can draw by the hundred, and a quick download', () => {
    const triangles = (name: string) => json.accessors[meshOf.get(name)!.primitives[0]!.indices]!.count / 3
    for (const name of meshOf.keys()) {
      if (/^(Spruce|Pine|Birch|Snag)/.test(name)) expect(triangles(name), name).toBeLessThan(1000)
      if (/^(Grass|Rock|Reeds|Stump|Shrub|Heather)/.test(name)) expect(triangles(name), name).toBeLessThan(100)
    }
    // The far-off spruces are planted by the hundred.
    expect(triangles('Spruce_Far')).toBeLessThan(100)
    expect(statSync(KIT).size).toBeLessThan(320 * 1024)
    expect(gunzipSync(readFileSync(KIT)).length).toBeLessThan(1400 * 1024)
  })
})

const WHEELBASE = 2.8

/** A road of these grounds, each 400 m, with the truck at the start of the second piece. */
function roadOf(grounds: readonly GroundId[]): { pieces: PlacedPiece[]; lap: number; winter: boolean } {
  const rng = new Rng(5)
  const road = grounds.map((g) => buildProfile(g, 400 + WHEELBASE, rng.fork(g)))
  const pieces = road.map((profile, i) => ({ profile, offset: i * 400 }))
  return { pieces, lap: grounds.length * 400, winter: isWinter(road) }
}

/** Collects what `plant` stands, instead of drawing it. */
function collector(): Planter & { puts: { piece: string; x: number; y: number; z: number }[] } {
  const puts: { piece: string; x: number; y: number; z: number }[] = []
  return {
    puts,
    begin: () => (puts.length = 0),
    put: (piece, x, y, z) => puts.push({ piece, x, y, z }),
    end: () => undefined,
  }
}

function planted(grounds: readonly GroundId[], from: number, to: number, more: Partial<PlantOptions> = {}, loop = true) {
  const road = roadOf(grounds)
  const land: Land = { pieces: road.pieces, halfTrack: 0.8, winter: road.winter, lap: loop ? road.lap : 0 }
  const ground = buildGround(land, { from, to, origin: from, step: 0.5, night: false })
  const into = collector()
  const options: PlantOptions = { from, to, origin: from, lane: 14, cover: 1, night: false, loop, wheelbase: WHEELBASE, ...more }
  plant(into, ground, options)
  return { puts: into.puts, ground, lap: road.lap }
}

describe('the land', () => {
  it('lumps stay between 0 and 1 and join up every lap', () => {
    for (let i = 0; i < 200; i++) {
      const a = i * 7.3
      const b = i * 3.1 - 200
      const v = lumps(a, b, 38, 1800, 1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(lumps(a + 1800, b, 38, 1800, 1)).toBeCloseTo(v, 9)
    }
  })

  it('meets the road strip along the seam with no step', () => {
    const { ground } = planted(['graded', 'rough'], 400, 520)
    for (let s = 404; s < 516; s += 3.7) {
      for (const side of [-1, 1]) {
        expect(Math.abs(ground.at(s, side * (LAND.seam - 0.001)) - ground.at(s, side * (LAND.seam + 0.001)))).toBeLessThan(0.02)
      }
    }
  })

  it('stays low on the cameras side, so the verge never hides the wheels', () => {
    const { ground } = planted(['graded', 'rough'], 400, 520)
    for (let s = 400; s <= 520; s += 2) {
      for (let z = -4; z >= -16; z -= 1) expect(ground.at(s, z), `s ${s} z ${z}`).toBeLessThan(0.9)
    }
  })

  it('is winter only on ice and snow', () => {
    expect(roadOf(['graded', 'rocks']).winter).toBe(false)
    expect(roadOf(['graded', 'snow']).winter).toBe(true)
  })
})

/** Pieces low enough to stand between the cameras and the truck (the start arch spans the road). */
const LOW = new Set(['Grass_A', 'Grass_B', 'Heather', 'Rock_C', 'TireStack', 'Arch'])

describe('planting', () => {
  it('keeps everything tall out of the cameras view of the truck', () => {
    for (const from of [0, 400, 1000]) {
      const { puts } = planted(['graded', 'rough', 'rocks'], from, from + 140)
      expect(puts.length).toBeGreaterThan(200)
      for (const p of puts) {
        if (p.z < 0 && p.z > -14) expect(LOW.has(p.piece), `${p.piece} at z ${p.z.toFixed(1)}`).toBe(true)
      }
    }
  })

  it('plants the same things every time, and the same things a lap later', () => {
    const a = planted(['graded', 'rough'], 96, 220)
    const b = planted(['graded', 'rough'], 96, 220)
    expect(b.puts).toEqual(a.puts)
    const later = planted(['graded', 'rough'], 96 + a.lap, 220 + a.lap)
    // The road pieces a lap on are the same pieces again.
    const trees = (puts: typeof a.puts) => puts.filter((p) => /^(Spruce|Birch|Pine)/.test(p.piece))
    expect(trees(later.puts).length).toBe(trees(a.puts).length)
    trees(a.puts).forEach((p, i) => {
      const q = trees(later.puts)[i]!
      expect(q.piece).toBe(p.piece)
      expect(q.x).toBeCloseTo(p.x, 5)
      expect(q.z).toBeCloseTo(p.z, 5)
    })
  })

  it('stands the start line once a lap on a loop, and never on a raid stage', () => {
    const count = (puts: { piece: string }[], piece: string) => puts.filter((p) => p.piece === piece).length
    const loop = planted(['graded', 'rough'], 760, 880)
    expect(count(loop.puts, 'Arch')).toBe(1)
    expect(count(loop.puts, 'Hut')).toBe(1)
    const stage = planted(['graded', 'rough'], 760, 880, {}, false)
    expect(count(stage.puts, 'Arch')).toBe(0)
  })

  it('puts a caution board before rough ground', () => {
    const { puts } = planted(['graded', 'rocks'], 300, 420)
    expect(puts.some((p) => p.piece === 'Board_3')).toBe(true)
  })

  it('plants the snowy trees in winter', () => {
    const { puts } = planted(['snow', 'ice'], 400, 520)
    expect(puts.some((p) => p.piece.startsWith('Spruce_Snow'))).toBe(true)
    expect(puts.some((p) => p.piece === 'Fireweed' || p.piece === 'Birch_A')).toBe(false)
  })

  it('stands things on the ground, not under water', () => {
    const { puts, ground } = planted(['graded', 'rough'], 400, 520)
    for (const p of puts) {
      if (/^(Spruce|Birch|Pine|Rock|Boulder)/.test(p.piece)) expect(ground.at(p.x + 400, p.z), p.piece).toBeGreaterThan(LAND.water)
    }
  })

  it('plants less on a lower graphics tier', () => {
    const at = (cover: number) => planted(['graded', 'rough'], 400, 520, { cover }).puts.length
    expect(at(TIERS.lite.cover)).toBeLessThan(at(TIERS.full.cover) * 0.6)
    expect(at(TIERS.full.cover)).toBeLessThanOrEqual(at(TIERS.ultra.cover))
  })
})
