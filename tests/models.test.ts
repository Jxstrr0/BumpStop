/**
 * The Blender trucks must fit the sim: each model's wheels sit where the test
 * mule's are (`TEST_MULES` in src/data/ride.ts), and every node the game
 * moves (src/render/truckModel.ts) is there. If this fails after a change to
 * the mules, update `TRUCKS` in scripts/blender/make-trucks.py and run it
 * again.
 *
 * The models also carry every part a player can bolt on, in nodes named
 * `Fit_<slot>_<part>[-<part>]_<where>`: these tests check each name is a real
 * slot and part, and that the parts you can see on a real truck are there.
 *
 * Each suspension layout's own shock mounts (`MountTop_FL_wishbone`) must
 * hold the shock at exactly the stock length at rest, so one set of shocks
 * fits every layout, and every arm needs the end on the hub it points at.
 *
 * Every class has two files: the full model and a lighter one for the Lite
 * graphics tier (`truck-<class>-lite.glb.gz`). Every check runs on both, and
 * the two must have exactly the same node names, so the game can move either.
 */
import { readFileSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { PARTS, SLOTS, type SlotId } from '../src/data/parts'
import { TEST_MULES } from '../src/data/ride'

interface GltfNode {
  name?: string
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  children?: number[]
  /** Index into `meshes`, for a node that draws something. */
  mesh?: number
}

interface GltfMesh {
  name?: string
  /** Each primitive lists its vertex data by name (POSITION, NORMAL, COLOR_0…). */
  primitives: { attributes: Record<string, number> }[]
}

interface Gltf {
  nodes: GltfNode[]
  meshes?: GltfMesh[]
}

/** The JSON part of a zipped .glb file (its first chunk). */
function gltfJson(path: string): Gltf {
  const buf = gunzipSync(readFileSync(path))
  expect(buf.readUInt32LE(0)).toBe(0x46546c67) // "glTF"
  const length = buf.readUInt32LE(12)
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a) // "JSON"
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'))
}

const CORNERS = ['FL', 'FR', 'RL', 'RR']

/** Parts with nothing to bolt on, so nothing to draw. */
const NOTHING_TO_SEE = new Set(['noGuards', 'noSpares', 'noBars', 'noLightBar', 'noSpots', 'shovelOnly'])
/** Slots drawn once per corner. */
const PER_CORNER: readonly SlotId[] = ['dampers', 'wheels', 'tires']

/** The two files each class has, and how big each may be. */
type Build = 'full' | 'lite'

// Size caps, in KB: the download (zipped) and what the phone holds once it's
// unzipped. The HD models aren't final, so these are roomy for now.
const FULL_MAX_ZIPPED_KB = 1000
const FULL_MAX_UNZIPPED_KB = 4500
const LITE_MAX_ZIPPED_KB = 600
const LITE_MAX_UNZIPPED_KB = 2800

const SIZE_CAPS: Record<Build, { zippedKb: number; unzippedKb: number }> = {
  full: { zippedKb: FULL_MAX_ZIPPED_KB, unzippedKb: FULL_MAX_UNZIPPED_KB },
  lite: { zippedKb: LITE_MAX_ZIPPED_KB, unzippedKb: LITE_MAX_UNZIPPED_KB },
}

/** Where a class's model is: `truck-<class>.glb.gz`, or `truck-<class>-lite.glb.gz`. */
function modelPath(cls: string, build: Build): string {
  return `public/models/truck-${cls}${build === 'lite' ? '-lite' : ''}.glb.gz`
}

/** Every class with each of its two files. */
const MODELS = CLASSES.flatMap((c) => (['full', 'lite'] as const).map((build) => ({ cls: c.id, build })))

describe.each(MODELS)('the $cls model ($build)', ({ cls, build }) => {
  const path = modelPath(cls, build)
  const json = gltfJson(path)
  const byName = new Map(json.nodes.map((n) => [n.name ?? '', n]))
  const mule = TEST_MULES[cls]
  const fits = json.nodes
    .map((n) => /^Fit_([A-Za-z]+)_([A-Za-z0-9-]+)(?:_(\w+))?$/.exec(n.name ?? ''))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ slot: m[1] as SlotId, parts: m[2]!.split('-'), where: m[3] ?? '' }))

  it('has every node the game moves', () => {
    for (const name of ['Body', ...CORNERS.flatMap((c) => [`Hub_${c}`, `Wheel_${c}`, `MountTop_${c}`, `MountLow_${c}`, `ShockBody_${c}`, `ShockShaft_${c}`, `Spring_${c}`])]) {
      expect(byName.has(name), name).toBe(true)
    }
  })

  it('puts the wheels where the test mule has them', () => {
    // glTF is Y up with Z to the right: X forward, Z = minus the sim's "left".
    for (const c of CORNERS) {
      const [x, , z] = byName.get(`Hub_${c}`)!.translation!
      expect(x).toBeCloseTo(c[0] === 'F' ? mule.cgToFront : -mule.cgToRear, 2)
      expect(z).toBeCloseTo(c[1] === 'L' ? -mule.track / 2 : mule.track / 2, 2)
    }
  })

  /** Where a node sits at rest (the nodes up to a mount or arm are only ever moved, never turned). */
  const parentOf = new Map<number, number>()
  json.nodes.forEach((n, i) => n.children?.forEach((ch) => parentOf.set(ch, i)))
  const restPosition = (name: string): number[] => {
    let i: number | undefined = json.nodes.findIndex((n) => n.name === name)
    const at = [0, 0, 0]
    while (i !== undefined) {
      const n = json.nodes[i]!
      expect(n.rotation === undefined || Math.abs(n.rotation[3]) > 0.999999, `${n.name} is turned`).toBe(true)
      expect(n.scale === undefined, `${n.name} is scaled`).toBe(true)
      n.translation?.forEach((v, k) => (at[k]! += v))
      i = parentOf.get(i)
    }
    return at
  }

  it('holds the shocks at the stock length on every layout\'s own mounts', () => {
    const own = [...byName.keys()].filter((n) => /^MountTop_(FL|FR|RL|RR)_[A-Za-z0-9-]+$/.test(n))
    if (cls !== 'heavy') expect(own.length).toBeGreaterThan(0)
    for (const top of own) {
      const [, corner, tag] = /^MountTop_(\w\w)_(.+)$/.exec(top)!
      const low = `MountLow_${corner}_${tag}`
      expect(byName.has(low), low).toBe(true)
      const dist = (a: string, b: string) => Math.hypot(...restPosition(a).map((v, k) => v - restPosition(b)[k]!))
      expect(dist(top, low), top).toBeCloseTo(dist(`MountTop_${corner}`, `MountLow_${corner}`), 3)
      for (const id of tag!.split('-')) {
        expect(PARTS.find((p) => p.id === id)?.slot, `${top}: ${id}`).toBe(corner![0] === 'F' ? 'frontSusp' : 'rearSusp')
      }
    }
  })

  it('gives every arm its end on the hub (or the axle, for a prop shaft)', () => {
    for (const name of byName.keys()) {
      if (!/^Arm_(FL|FR|RL|RR|F|R)(_\w+)?$/.test(name)) continue
      expect(byName.has(name.replace(/^Arm_/, 'ArmEnd_')), name).toBe(true)
    }
  })

  it('has a driveline of its own, on the body, for the X-ray view', () => {
    // A truck on solid axles has a two-piece prop shaft to each: one half on the gearbox, one on the axle, sliding together.
    for (const end of ['F', 'R']) {
      if (!byName.has(`Axle_${end}`)) continue
      const live = byName.has(`Arm_${end}_Prop`)
      expect(byName.has(`Arm_${end}_PropSlip`), `Arm_${end}_PropSlip`).toBe(live)
    }
    // The engine and gearbox are their own node, so the X-ray view (v1.27) can hide the body and keep them.
    expect(byName.has('Driveline')).toBe(true)
    expect(byName.get('Driveline')!.mesh, 'Driveline draws something').toBeDefined()
  })

  it('names only real slots and parts for this class', () => {
    expect(fits.length).toBeGreaterThan(0)
    for (const f of fits) {
      expect(SLOTS, f.slot).toContain(f.slot)
      for (const id of f.parts) {
        const part = PARTS.find((p) => p.id === id)
        expect(part, `${f.slot} ${id}`).toBeDefined()
        expect(part!.slot === f.slot || (f.slot.endsWith('Susp') && part!.slot.endsWith('Susp')), `${f.slot} ${id}`).toBe(true)
        expect(part!.mass[cls], `${id} in ${cls}`).toBeDefined()
      }
    }
  })

  it('draws every part you can see', () => {
    for (const slot of SLOTS) {
      for (const part of PARTS.filter((p) => p.slot === slot && p.mass[cls] !== undefined && !NOTHING_TO_SEE.has(p.id))) {
        const nodes = fits.filter((f) => f.slot === slot && f.parts.includes(part.id))
        expect(nodes.length, `${slot} ${part.id}`).toBeGreaterThan(0)
        if (PER_CORNER.includes(slot)) {
          expect(nodes.map((n) => n.where).sort(), `${slot} ${part.id}`).toEqual([...CORNERS].sort())
        }
      }
    }
  })

  it('paints every mesh with vertex colours', () => {
    // The trucks share one material and get their colours from COLOR_0: a mesh without it would draw plain white.
    const meshes = json.meshes ?? []
    expect(meshes.length).toBeGreaterThan(0)
    const bare: string[] = []
    meshes.forEach((mesh, m) => {
      mesh.primitives.forEach((prim, p) => {
        if (prim.attributes.COLOR_0 === undefined) bare.push(`${mesh.name ?? `mesh ${m}`} (primitive ${p})`)
      })
    })
    expect(bare, 'meshes with no COLOR_0').toEqual([])
  })

  it('stays small enough for a phone', () => {
    // The download (zipped) and what the phone holds once it's unzipped.
    const cap = SIZE_CAPS[build]
    expect(statSync(path).size / 1024, 'zipped KB').toBeLessThanOrEqual(cap.zippedKb)
    expect(gunzipSync(readFileSync(path)).length / 1024, 'unzipped KB').toBeLessThanOrEqual(cap.unzippedKb)
  })
})

describe.each(CLASSES.map((c) => c.id))('the %s lite model', (cls) => {
  it('has exactly the same node names as the full model', () => {
    // The game finds every part by name, so a node in one file and not the other is a part that goes missing on one tier.
    const names = (build: Build) => gltfJson(modelPath(cls, build)).nodes.map((n) => n.name ?? '').sort()
    const full = names('full')
    const lite = names('lite')
    const inLite = new Set(lite)
    const inFull = new Set(full)
    expect(full.filter((n) => !inLite.has(n)), 'in the full model only').toEqual([])
    expect(lite.filter((n) => !inFull.has(n)), 'in the lite model only').toEqual([])
    // The same count of each name too (a set alone would miss a doubled node).
    expect(lite).toEqual(full)
  })
})
