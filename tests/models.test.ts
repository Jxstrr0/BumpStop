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
  children?: number[]
}

/** The JSON part of a zipped .glb file (its first chunk). */
function gltfJson(path: string): { nodes: GltfNode[] } {
  const buf = gunzipSync(readFileSync(path))
  expect(buf.readUInt32LE(0)).toBe(0x46546c67) // "glTF"
  const length = buf.readUInt32LE(12)
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a) // "JSON"
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'))
}

const CORNERS = ['FL', 'FR', 'RL', 'RR']

/** Parts with nothing to bolt on, so nothing to draw. */
const NOTHING_TO_SEE = new Set(['noGuards', 'noSpares', 'noBars', 'petrolSix'])
/** Slots drawn once per corner. */
const PER_CORNER: readonly SlotId[] = ['dampers', 'wheels', 'tires']

describe.each(CLASSES.map((c) => c.id))('the %s model', (cls) => {
  const path = `public/models/truck-${cls}.glb.gz`
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
    // The side-by-side's arms are the same shape for every suspension part, for now.
    const slots = SLOTS.filter((s) => !(cls === 'sxs' && s.endsWith('Susp')))
    for (const slot of slots) {
      for (const part of PARTS.filter((p) => p.slot === slot && p.mass[cls] !== undefined && !NOTHING_TO_SEE.has(p.id))) {
        const nodes = fits.filter((f) => f.slot === slot && f.parts.includes(part.id))
        expect(nodes.length, `${slot} ${part.id}`).toBeGreaterThan(0)
        if (PER_CORNER.includes(slot)) {
          expect(nodes.map((n) => n.where).sort(), `${slot} ${part.id}`).toEqual([...CORNERS].sort())
        }
      }
    }
  })

  it('stays small enough for a phone', () => {
    // The download (zipped) and what the phone holds once it's unzipped.
    expect(statSync(path).size).toBeLessThan(300 * 1024)
    expect(gunzipSync(readFileSync(path)).length).toBeLessThan(1200 * 1024)
  })
})
