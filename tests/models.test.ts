/**
 * The Blender trucks (plan PR 5) must fit the sim: each model's wheels sit
 * where the test mule's are (`TEST_MULES` in src/data/ride.ts), and every
 * node the game moves (src/render/truckModel.ts) is there. If this fails
 * after a change to the mules, update `TRUCKS` in
 * scripts/blender/make-trucks.py and run it again.
 */
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { TEST_MULES } from '../src/data/ride'

interface GltfNode {
  name?: string
  translation?: [number, number, number]
  children?: number[]
}

/** The JSON part of a .glb file (its first chunk). */
function gltfJson(path: string): { nodes: GltfNode[] } {
  const buf = readFileSync(path)
  expect(buf.readUInt32LE(0)).toBe(0x46546c67) // "glTF"
  const length = buf.readUInt32LE(12)
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a) // "JSON"
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'))
}

const CORNERS = ['FL', 'FR', 'RL', 'RR']

describe.each(CLASSES.map((c) => c.id))('the %s model', (cls) => {
  const path = `public/models/truck-${cls}.glb`
  const json = gltfJson(path)
  const byName = new Map(json.nodes.map((n) => [n.name ?? '', n]))
  const mule = TEST_MULES[cls]

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

  it('stays small enough for a phone', () => {
    expect(statSync(path).size).toBeLessThan(600 * 1024)
  })
})
