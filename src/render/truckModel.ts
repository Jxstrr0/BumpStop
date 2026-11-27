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
 * - arms (wishbones, trailing arms, drive shafts, tie rods) swing to follow
 *   the wheels,
 * - each shock and spring stretches between its two mounts.
 *
 * A truck can carry more than one suspension layout at an end (the light
 * 4x4's beam axle or double wishbones, say). Each layout's parts sit in a
 * `Fit_frontSusp_<part>_Rig…` group that `fit()` shows or hides like any
 * bolt-on, and a layout with its own shock mounts names them after its parts
 * (`MountTop_FL_wishbone`); a corner with no such mounts uses the plain
 * `MountTop_FL` / `MountLow_FL`. A hidden axle doesn't tilt its hubs.
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
import type { ClassId } from '../data/classes'
import { KITS } from '../data/kit'
import type { SlotId } from '../data/parts'
import { loadGlb } from './glb'

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

/** A pair of shock mounts: the plain ones, or one suspension layout's own. */
interface Mounts {
  top: THREE.Object3D
  low: THREE.Object3D
  /** Mount to mount at rest (m). */
  rest: number
  /** The suspension parts these are for; null for the plain ones. */
  parts: string[] | null
}

interface Shock {
  body: THREE.Object3D
  shaft: THREE.Object3D
  spring: THREE.Object3D
  /** Every pair of mounts at this corner, and the pair the fitted part uses. */
  mounts: Mounts[]
  active: Mounts
}

interface Arm {
  arm: THREE.Object3D
  end: THREE.Object3D
  /** Pivot to end at rest, in the arm's parent's space. */
  restDir: THREE.Vector3
}

/** True when a node and everything above it is shown (a hidden layout hides its arms and axle). */
function shown(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false
  return true
}

/** The part in each slot, as a build lists them (`TruckBuild.parts`). */
export type FittedParts = Readonly<Partial<Record<SlotId, string>>>

const cache = new Map<ClassId, Promise<THREE.Group>>()

/** Load a class's model once; each call after that gets a fresh copy to pose. */
async function loadScene(cls: ClassId): Promise<THREE.Group> {
  let p = cache.get(cls)
  if (!p) {
    p = loadGlb(`truck-${cls}`)
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
  private arms: Arm[] = []
  private axles: { node: THREE.Object3D; left: number; right: number }[]
  /** Every bolt-on part in the model, and the slot and part ids that show it. */
  private fits: { node: THREE.Object3D; slot: string; parts: string[] }[] = []
  /** Corners whose wheel has been made to look broken, and how. */
  private broken = new Map<number, 'flat' | 'flop' | 'mount'>()
  /** Materials this copy made for itself (a ghost truck's), freed with it. */
  private owned: THREE.Material[] = []

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
    // Shock mounts: MountTop_FL, or MountTop_FL_<part>[-<part>] for one layout's own.
    const tops = new Map<string, THREE.Object3D>()
    const lows = new Map<string, THREE.Object3D>()
    // Arms: Arm_FL_<what>, each pointing at its ArmEnd_FL_<what> on the hub.
    // A solid axle's prop shaft is two more (Arm_F_Prop on the body, pointing
    // at the axle, and Arm_F_PropSlip on the axle, pointing back at the body).
    const armNodes: THREE.Object3D[] = []
    scene.traverse((o) => {
      const m = /^Mount(Top|Low)_(FL|FR|RL|RR)(?:_([A-Za-z0-9-]+))?$/.exec(o.name)
      if (m) (m[1] === 'Top' ? tops : lows).set(`${m[2]}|${m[3] ?? ''}`, o)
      if (/^Arm_(FL|FR|RL|RR|F|R)(_\w+)?$/.test(o.name)) armNodes.push(o)
    })
    this.shocks = CORNERS.map((c) => {
      const mounts: Mounts[] = []
      for (const [key, top] of tops) {
        const [corner, tag] = key.split('|') as [string, string]
        const low = lows.get(key)
        if (corner !== c || !low) continue
        mounts.push({ top, low, rest: world(top).distanceTo(world(low)), parts: tag ? tag.split('-') : null })
      }
      const plain = mounts.find((m) => m.parts === null)
      if (!plain) throw new Error(`Truck model ${cls} has no MountTop_${c}`)
      return { body: find(`ShockBody_${c}`), shaft: find(`ShockShaft_${c}`), spring: find(`Spring_${c}`), mounts, active: plain }
    })
    for (const arm of armNodes) {
      const end = scene.getObjectByName(arm.name.replace(/^Arm_/, 'ArmEnd_'))
      if (!end || !arm.parent) continue
      const restDir = arm.parent.worldToLocal(world(end)).sub(arm.position).normalize()
      this.arms.push({ arm, end, restDir })
    }
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

  /** Show the build's own parts and hide the rest, and hang the shocks on the suspension's own mounts. */
  fit(parts: FittedParts): void {
    for (const f of this.fits) {
      const part = parts[f.slot as SlotId]
      f.node.visible = part !== undefined && f.parts.includes(part)
    }
    this.shocks.forEach((s, i) => {
      const susp = parts[i < 2 ? 'frontSusp' : 'rearSusp']
      const own = susp === undefined ? undefined : s.mounts.find((m) => m.parts?.includes(susp))
      s.active = own ?? s.mounts.find((m) => m.parts === null)!
    })
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
    // Solid axles: both hubs tilt with the beam (not when the build has independent arms there).
    for (const ax of this.axles) {
      if (!shown(ax.node)) continue
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

    // Arms first: some layouts hang the shock's bottom on an arm.
    this.root.updateMatrixWorld(true)
    const end = new THREE.Vector3()
    for (const a of this.arms) {
      if (!shown(a.arm)) continue
      a.arm.parent!.worldToLocal(a.end.getWorldPosition(end))
      a.arm.quaternion.setFromUnitVectors(a.restDir, end.sub(a.arm.position).normalize())
    }
    this.root.updateMatrixWorld(true)

    const top = new THREE.Vector3()
    const low = new THREE.Vector3()
    const dir = new THREE.Vector3()
    for (let i = 0; i < 4; i++) {
      const s = this.shocks[i]!
      const m = s.active
      // Mount positions in the model's own space (the root may sit anywhere in the scene).
      this.root.worldToLocal(m.top.getWorldPosition(top))
      this.root.worldToLocal(m.low.getWorldPosition(low))
      if (this.broken.get(i) === 'mount') top.y -= 0.12 * (this.radius / 0.4)
      dir.subVectors(low, top)
      const length = dir.length()
      dir.divideScalar(length || 1)
      s.body.position.copy(top)
      s.body.quaternion.setFromUnitVectors(DOWN, dir)
      s.spring.position.copy(top)
      s.spring.quaternion.copy(s.body.quaternion)
      s.spring.scale.set(1, length / m.rest, 1)
      s.shaft.position.copy(low)
      s.shaft.quaternion.setFromUnitVectors(UP, dir.negate())
    }
  }

  /**
   * Make this copy a see-through ghost truck: its own tinted, half-clear
   * materials (the real truck keeps its look) and no shadows. It's drawn
   * last and on top of everything, like an X-ray, because most of the time
   * it sits almost exactly where the real truck is and would be hidden
   * inside it otherwise.
   */
  ghostly(tint: THREE.Color, opacity: number, mix: number): void {
    const made = new Map<THREE.Material, THREE.Material>()
    const own = (m: THREE.Material): THREE.Material => {
      let c = made.get(m)
      if (!c) {
        c = m.clone()
        c.transparent = true
        c.opacity = opacity
        c.depthWrite = false
        c.depthTest = false
        const coloured = c as THREE.Material & { color?: THREE.Color }
        if (coloured.color instanceof THREE.Color) coloured.color.lerp(tint, mix)
        made.set(m, c)
        this.owned.push(c)
      }
      return c
    }
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.renderOrder = 10
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material)
    })
  }

  dispose(): void {
    // Geometry and materials are shared with the cached original, so only detach (and free a ghost's own materials).
    this.root.removeFromParent()
    for (const m of this.owned) m.dispose()
    this.owned = []
  }
}
