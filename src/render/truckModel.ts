/**
 * The Blender-made trucks (plan PR 5), loaded and moved.
 *
 * `scripts/blender/make-trucks.py` builds one model per class with every
 * moving part as its own named node (the list is at the top of that
 * script). This file loads a model and poses it from the ride sim's numbers:
 *
 * - the body bounces, pitches and rolls,
 * - each wheel rides up and down on its own and spins with the distance,
 * - solid axles tilt as one wheel rises past the other,
 * - arms swing to follow the wheels,
 * - each shock and spring stretches between its two mounts.
 *
 * Each model also holds every part a player can bolt on (dampers, bump
 * stops, bars, axles, wheels, tires, guards, spares, engine bits, frames,
 * leaf or coil springs), in nodes named `Fit_<slot>_<part>[-<part>]_<where>`.
 * `fit()` shows the build's own parts and hides the rest, so a swap on the
 * build screen shows on the truck.
 *
 * Coordinates are three.js's: X forward, Y up, Z to the truck's right. The
 * sim's "left side up" roll is a positive turn about X, and its "nose up"
 * pitch a positive turn about Z, so the numbers go straight in. Corners are
 * numbered like the sim's: 0 front left, 1 front right, 2 rear left,
 * 3 rear right.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { ClassId } from '../data/classes'
import { KITS } from '../data/kit'
import type { SlotId } from '../data/parts'

const CORNERS = ['FL', 'FR', 'RL', 'RR'] as const

/** Where the truck is and how it sits, in the sim's numbers (metres and radians). */
export interface TruckPose {
  /** Body bounce from rest. */
  z: number
  /** Nose up. */
  pitch: number
  /** Left side up. */
  roll: number
  /** Each wheel's height from rest. */
  wheelZ: readonly number[]
  /** Distance driven, to spin the wheels. */
  distance: number
}

export const REST_POSE: TruckPose = { z: 0, pitch: 0, roll: 0, wheelZ: [0, 0, 0, 0], distance: 0 }

/**
 * How the build sits compared with the model, which is drawn at the stock
 * ride height: + means that end sits higher (stiffer springs, more preload).
 */
export interface Stance {
  front: number
  rear: number
}

interface Shock {
  top: THREE.Object3D
  low: THREE.Object3D
  body: THREE.Object3D
  shaft: THREE.Object3D
  spring: THREE.Object3D
  /** Mount to mount at rest (m). */
  rest: number
}

interface Arm {
  arm: THREE.Object3D
  end: THREE.Object3D
  /** Pivot to end at rest, in the body's space. */
  restDir: THREE.Vector3
}

/** The part in each slot, as a build lists them (`TruckBuild.parts`). */
export type FittedParts = Readonly<Partial<Record<SlotId, string>>>

const loader = new GLTFLoader()
const cache = new Map<ClassId, Promise<THREE.Group>>()

/**
 * The models are zipped (gzip) to about a fifth of their size, and the
 * browser unzips them itself. If a server has already unzipped the file on
 * the way (its first bytes are then "glTF"), it's used as it is.
 */
async function fetchModel(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load ${url}: ${res.status}`)
  const bytes = await res.arrayBuffer()
  const head = new Uint8Array(bytes, 0, 2)
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

/** Load a class's model once; each call after that gets a fresh copy to pose. */
async function loadScene(cls: ClassId): Promise<THREE.Group> {
  let p = cache.get(cls)
  if (!p) {
    // Relative to the page, so it works at the site's root and under a sub-path.
    const url = new URL(`./models/truck-${cls}.glb.gz`, document.baseURI).href
    p = fetchModel(url).then((bytes) => loader.parseAsync(bytes, '')).then((gltf) => gltf.scene)
    cache.set(cls, p)
    // A failed load (offline, say) shouldn't stick: try again next time.
    p.catch(() => cache.delete(cls))
  }
  return (await p).clone(true)
}

const DOWN = new THREE.Vector3(0, -1, 0)
const UP = new THREE.Vector3(0, 1, 0)
const SPIN_AXIS = new THREE.Vector3(0, 0, 1)

export class TruckModel {
  readonly root: THREE.Group
  readonly cls: ClassId
  /** Tire radius (m). */
  readonly radius: number
  /** Front and rear axle positions along X, and the track (m). */
  readonly frontX: number
  readonly rearX: number
  readonly track: number
  stance: Stance = { front: 0, rear: 0 }

  private body: THREE.Object3D
  private hubs: THREE.Object3D[]
  private hubRest: THREE.Vector3[]
  private wheels: THREE.Object3D[]
  private wheelRest: THREE.Quaternion[]
  private shocks: Shock[]
  private arms: (Arm | null)[]
  private axles: { node: THREE.Object3D; left: number; right: number }[]
  /** Every bolt-on part in the model, and the slot and part ids that show it. */
  private fits: { node: THREE.Object3D; slot: string; parts: string[] }[] = []
  /** Corners whose wheel has been made to look broken, and how. */
  private broken = new Map<number, 'flat' | 'flop' | 'mount'>()

  static async load(cls: ClassId): Promise<TruckModel> {
    return new TruckModel(cls, await loadScene(cls))
  }

  private constructor(cls: ClassId, scene: THREE.Group) {
    this.cls = cls
    this.root = scene
    const find = (name: string): THREE.Object3D => {
      const o = scene.getObjectByName(name)
      if (!o) throw new Error(`Truck model ${cls} has no ${name}`)
      return o
    }
    this.body = find('Body')
    this.hubs = CORNERS.map((c) => find(`Hub_${c}`))
    this.hubRest = this.hubs.map((h) => h.position.clone())
    this.wheels = CORNERS.map((c) => find(`Wheel_${c}`))
    this.wheelRest = this.wheels.map((w) => w.quaternion.clone())
    this.radius = this.hubRest[0]!.y
    this.frontX = this.hubRest[0]!.x
    this.rearX = this.hubRest[2]!.x
    this.track = this.hubRest[1]!.z - this.hubRest[0]!.z

    scene.updateMatrixWorld(true)
    const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
    this.shocks = CORNERS.map((c) => {
      const top = find(`MountTop_${c}`)
      const low = find(`MountLow_${c}`)
      return { top, low, body: find(`ShockBody_${c}`), shaft: find(`ShockShaft_${c}`), spring: find(`Spring_${c}`), rest: world(top).distanceTo(world(low)) }
    })
    this.arms = CORNERS.map((c) => {
      const arm = scene.getObjectByName(`Arm_${c}`)
      const end = scene.getObjectByName(`ArmEnd_${c}`)
      if (!arm || !end) return null
      const restDir = this.body.worldToLocal(world(end)).sub(arm.position).normalize()
      return { arm, end, restDir }
    })
    this.axles = []
    for (const [key, left, right] of [['F', 0, 1], ['R', 2, 3]] as const) {
      const node = scene.getObjectByName(`Axle_${key}`)
      if (node) this.axles.push({ node, left, right })
    }
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
      // Fit_<slot>_<part>[-<part>...]_<where>, as the Blender script names them.
      const m = /^Fit_([A-Za-z]+)_([A-Za-z0-9-]+)/.exec(o.name)
      if (m) this.fits.push({ node: o, slot: m[1]!, parts: m[2]!.split('-') })
    })
    this.fit(KITS[cls].stock.parts)
  }

  /** Show the build's own parts and hide the rest. */
  fit(parts: FittedParts): void {
    for (const f of this.fits) {
      const part = parts[f.slot as SlotId]
      f.node.visible = part !== undefined && f.parts.includes(part)
    }
  }

  /** Overall length (m), for framing the camera. */
  get length(): number {
    return this.frontX - this.rearX + this.radius * 4
  }

  /** Make a corner look broken, for the slow-motion replay; `null` puts every corner back. */
  breakCorner(corner: number | null, how: 'flat' | 'flop' | 'mount' = 'flop'): void {
    if (corner === null) this.broken.clear()
    else this.broken.set(corner, how)
  }

  /** Where a corner's wheel is now, in world space. */
  cornerPosition(corner: number, out = new THREE.Vector3()): THREE.Vector3 {
    return (this.hubs[corner] ?? this.body).getWorldPosition(out)
  }

  pose(p: TruckPose): void {
    const a = this.frontX
    const b = -this.rearX
    const { front, rear } = this.stance
    // The stance lifts each end; in between it's a straight line.
    const lift = (front * b + rear * a) / (a + b)
    const tilt = (front - rear) / (a + b)
    this.body.position.y = p.z + lift
    this.body.rotation.set(p.roll, 0, p.pitch + tilt, 'ZXY')

    for (let i = 0; i < 4; i++) {
      const hub = this.hubs[i]!
      const rest = this.hubRest[i]!
      hub.position.set(rest.x, rest.y + (p.wheelZ[i] ?? 0), rest.z)
      hub.rotation.set(0, 0, 0)
      hub.scale.set(1, 1, 1)
      // Spin about the hub's own axle; a flopped wheel (snapped axle) leans out.
      const spin = new THREE.Quaternion().setFromAxisAngle(SPIN_AXIS, -p.distance / this.radius)
      this.wheels[i]!.quaternion.copy(spin).multiply(this.wheelRest[i]!)
    }
    // Solid axles: both hubs tilt with the beam.
    for (const ax of this.axles) {
      const l = this.hubs[ax.left]!
      const r = this.hubs[ax.right]!
      const angle = Math.atan2(l.position.y - r.position.y, this.track)
      ax.node.position.y = (l.position.y + r.position.y) / 2
      ax.node.rotation.x = angle
      l.rotation.x = angle
      r.rotation.x = angle
    }
    for (const [corner, how] of this.broken) {
      const hub = this.hubs[corner]!
      const side = corner % 2 === 0 ? -1 : 1
      if (how === 'flop') hub.rotation.x += side * 0.35
      // A cut tire: the wheel drops onto the squashed rubber.
      if (how === 'flat') {
        hub.position.y -= this.radius * 0.12
        hub.scale.set(1, 0.84, 1)
      }
    }

    this.root.updateMatrixWorld(true)
    const top = new THREE.Vector3()
    const low = new THREE.Vector3()
    const dir = new THREE.Vector3()
    for (let i = 0; i < 4; i++) {
      const s = this.shocks[i]!
      // Mount positions in the model's own space (the root may sit anywhere in the scene).
      this.root.worldToLocal(s.top.getWorldPosition(top))
      this.root.worldToLocal(s.low.getWorldPosition(low))
      if (this.broken.get(i) === 'mount') top.y -= 0.12 * (this.radius / 0.4)
      dir.subVectors(low, top)
      const length = dir.length()
      dir.divideScalar(length || 1)
      s.body.position.copy(top)
      s.body.quaternion.setFromUnitVectors(DOWN, dir)
      s.spring.position.copy(top)
      s.spring.quaternion.copy(s.body.quaternion)
      s.spring.scale.set(1, length / s.rest, 1)
      s.shaft.position.copy(low)
      s.shaft.quaternion.setFromUnitVectors(UP, dir.negate())

      const arm = this.arms[i]
      if (arm) {
        const end = this.body.worldToLocal(arm.end.getWorldPosition(new THREE.Vector3()))
        arm.arm.quaternion.setFromUnitVectors(arm.restDir, end.sub(arm.arm.position).normalize())
      }
    }
  }

  dispose(): void {
    // Geometry and materials are shared with the cached original, so only detach.
    this.root.removeFromParent()
  }
}
