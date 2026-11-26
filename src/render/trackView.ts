/**
 * The test track in 3D (plan PR 5): the truck you built, driving the rig's
 * own road, with its suspension doing exactly what the ride sim says.
 *
 * The sim runs far faster than real time, so this view plays short clips of
 * it at true speed (`src/sim/poses.ts` keeps the last few seconds), cutting
 * to a new camera for each one like a TV feed. When something breaks, the
 * last seconds play again in slow motion while the camera closes in on the
 * part that let go, and the break shows: a flat tire, a wheel flopping on a
 * snapped axle, a shock torn off its mount, smoke off a cooked damper, a
 * jolt for a bottom-out or a cracked frame.
 *
 * On the shaker rig the truck stands on four posts on the shop floor.
 *
 * With reduced motion the camera holds one side-on view and never shakes or
 * swoops; the truck still moves as the sim says.
 */
import * as THREE from 'three'
import type { ClassId } from '../data/classes'
import type { FailureKind } from '../data/wear'
import type { Profile } from '../sim/ground'
import type { Pose } from '../sim/poses'
import { addLights, applyLook, cssColour, isDark, makeRenderer, onLookChange } from './look'
import { Puffs } from './particles'
import { Forest, placePieces, stripGeometry } from './terrain'
import { TruckModel, type Stance, type TruckPose } from './truckModel'

export interface BreakFocus {
  corner: number
  kind: FailureKind
}

export interface ClipOptions {
  /** Clip seconds per real second: 1 is true speed, 0.3 slow motion. */
  rate: number
  /** Start again from the top when it ends (the break replay does). */
  loop: boolean
  /** A slow-motion break replay: close in on this corner and show the break at the end. */
  focus?: BreakFocus | null
  /** Called when a clip that doesn't loop reaches its end. */
  onEnd?: () => void
}

export interface RunSetup {
  cls: ClassId
  stance: Stance
  /** The loop's road, one profile per piece; null for the shaker rig. */
  road: readonly Profile[] | null
  /** Front axle to rear axle (m). */
  wheelbase: number
}

export interface TrackView {
  setRun(run: RunSetup): Promise<void>
  play(clip: readonly Pose[], o: ClipOptions): void
  /** Stop drawing until the next clip (the run was reset). */
  stop(): void
  dispose(): void
}

type Shot = 'side' | 'front' | 'chase' | 'wheel' | 'high'
const SHOTS: readonly Shot[] = ['side', 'front', 'chase', 'wheel', 'high']

/** Seconds a break holds on screen before the replay starts again. */
const HOLD = 1.8
/** Strip margins behind and ahead of the clip (m). */
const BEHIND = 30
const AHEAD = 60

const smooth = (u: number) => {
  const v = Math.min(1, Math.max(0, u))
  return v * v * (3 - 2 * v)
}

function lerpPose(a: Pose, b: Pose, u: number): Pose {
  const l = (p: number, q: number) => p + (q - p) * u
  return {
    t: l(a.t, b.t),
    distance: l(a.distance, b.distance),
    piece: u < 0.5 ? a.piece : b.piece,
    x: l(a.x, b.x),
    speed: l(a.speed, b.speed),
    ground: l(a.ground, b.ground),
    z: l(a.z, b.z),
    pitch: l(a.pitch, b.pitch),
    roll: l(a.roll, b.roll),
    wheelZ: [l(a.wheelZ[0], b.wheelZ[0]), l(a.wheelZ[1], b.wheelZ[1]), l(a.wheelZ[2], b.wheelZ[2]), l(a.wheelZ[3], b.wheelZ[3])],
  }
}

export function createTrackView(canvas: HTMLCanvasElement): TrackView {
  const renderer = makeRenderer(canvas)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400)
  const lights = addLights(scene, 8)
  scene.fog = new THREE.Fog(0xffffff, 40, 140)

  // The road strip (rebuilt per clip) and the forest.
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false })
  const strip = new THREE.Mesh(new THREE.BufferGeometry(), roadMat)
  strip.receiveShadow = true
  scene.add(strip)
  const forest = new Forest()
  scene.add(forest.group)

  // The shaker rig's shop floor and four posts.
  const shop = new THREE.Group()
  const shopFloorMat = new THREE.MeshStandardMaterial({ roughness: 0.95 })
  const shopFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), shopFloorMat)
  shopFloor.rotation.x = -Math.PI / 2
  shopFloor.position.y = -0.3
  shopFloor.receiveShadow = true
  shop.add(shopFloor)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5b5d61, metalness: 0.6, roughness: 0.4 })
  const posts = [0, 1, 2, 3].map(() => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.6), postMat)
    m.castShadow = true
    m.receiveShadow = true
    shop.add(m)
    return m
  })
  scene.add(shop)

  const dust = new Puffs(160, 0xc8b89a)
  const smoke = new Puffs(70, 0xe8e8e8)
  scene.add(dust.points, smoke.points)

  let truck: TruckModel | null = null
  let run: RunSetup | null = null
  let clip: readonly Pose[] = []
  let opts: ClipOptions = { rate: 1, loop: false }
  let clipTime = 0
  let cursor = 0
  let origin = 0
  let holding = 0
  let ended = false
  let shotIndex = 0
  let shot: Shot = 'side'
  let shake = 0
  let broke = false
  let raf = 0
  let lastTime = 0
  let visible = true
  let ticket = 0
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  function look(): void {
    applyLook(scene, lights)
    const dark = isDark()
    // A pale northern sky by day; a deep blue one for night stages.
    const sky = new THREE.Color(dark ? 0x151922 : 0xdfe4e3)
    scene.background = sky
    ;(scene.fog as THREE.Fog).color.copy(sky)
    shopFloorMat.color.copy(cssColour('--panel-2', '#ece8dc'))
    dust.setColour(dark ? 0x6b6457 : 0xc8b89a)
    smoke.setColour(dark ? 0x9a9a9a : 0xeeeeee)
    if (clip.length) buildStrip()
  }
  const stopLook = onLookChange(look)

  function resize(): void {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  /** Lay the road under this clip, with room behind and ahead for the camera. */
  function buildStrip(): void {
    if (!run || !clip.length || !truck) return
    const first = clip[0]!
    const last = clip[clip.length - 1]!
    origin = first.distance
    const night = isDark()
    if (!run.road) {
      strip.visible = false
      forest.group.visible = false
      shop.visible = true
      return
    }
    shop.visible = false
    strip.visible = true
    forest.group.visible = true
    const pieces = placePieces(run.road, run.wheelbase, first.piece, first.distance, first.x)
    const from = first.distance - BEHIND
    const to = last.distance + AHEAD
    strip.geometry.dispose()
    strip.geometry = stripGeometry(pieces, { from, to, origin, halfTrack: truck.track / 2, step: 0.1, night })
    forest.plant(from, to, origin, truck.track / 2, night)
  }

  function poseAt(time: number): Pose {
    const t = clip[0]!.t + time
    while (cursor < clip.length - 2 && clip[cursor + 1]!.t <= t) cursor++
    while (cursor > 0 && clip[cursor]!.t > t) cursor--
    const a = clip[cursor]!
    const b = clip[Math.min(cursor + 1, clip.length - 1)]!
    const span = b.t - a.t
    return lerpPose(a, b, span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0)
  }

  function clipLength(): number {
    return clip.length > 1 ? clip[clip.length - 1]!.t - clip[0]!.t : 0
  }

  /** Where the camera sits for a shot, relative to the truck. */
  function shotCamera(s: Shot, tx: number, out: THREE.Vector3, target: THREE.Vector3): void {
    const t = truck!
    const L = t.length
    const R = t.radius
    target.set(tx + 0.1 * L, 1.7 * R, 0)
    switch (s) {
      case 'side': out.set(tx + 0.2 * L, 0.9 * R + 0.35 * L, -2.2 * L); break
      case 'front': out.set(tx + 1.7 * L, 1.8 * R, -1.15 * L); target.set(tx, 1.5 * R, 0); break
      case 'chase': out.set(tx - 2.2 * L, 0.65 * L, -0.6 * L); target.set(tx + 0.4 * L, 1.4 * R, 0); break
      case 'wheel':
        out.set(tx + t.frontX + 4.5 * R, 1.5 * R, -t.track / 2 - 6 * R)
        target.set(tx + t.frontX, 1.1 * R, -t.track / 2)
        break
      case 'high': out.set(tx - 0.4 * L, 1.6 * L, -1.5 * L); break
    }
  }

  const camPos = new THREE.Vector3()
  const camTarget = new THREE.Vector3()
  const focusPos = new THREE.Vector3()
  const focusTarget = new THREE.Vector3()

  function placeCamera(tx: number, progress: number): void {
    if (!truck) return
    shotCamera(reduced.matches ? 'side' : shot, tx, camPos, camTarget)
    const focus = opts.focus
    if (focus && focus.corner >= 0) {
      // Close in on the corner that broke, from its own side.
      const c = truck.cornerPosition(focus.corner, focusTarget)
      const out = focus.corner % 2 === 0 ? -1 : 1
      const R = truck.radius
      focusPos.set(c.x + 3.4 * R, c.y + 1.6 * R, c.z + out * 5.6 * R)
      const u = reduced.matches ? 1 : smooth(progress * 1.25)
      camPos.lerp(focusPos, u)
      camTarget.lerp(c, u)
    } else if (focus) {
      // The frame: pull in on the whole truck.
      const u = reduced.matches ? 1 : smooth(progress * 1.25)
      shotCamera('side', tx, focusPos, focusTarget)
      focusPos.lerp(focusTarget, 0.35)
      camPos.lerp(focusPos, u)
    }
    if (shake > 0 && !reduced.matches) {
      const k = shake * 0.06 * truck.radius
      camPos.x += Math.sin(performance.now() * 0.09) * k
      camPos.y += Math.sin(performance.now() * 0.13) * k
    }
    camera.position.copy(camPos)
    camera.lookAt(camTarget)
    lights.sun.position.set(tx + 8, 14, -10)
    lights.sun.target.position.set(tx, 0, 0)
  }

  /** Show the break itself, the moment it happens. */
  function showBreak(focus: BreakFocus): void {
    if (!truck || broke) return
    broke = true
    shake = 1
    const corner = focus.corner
    if (focus.kind === 'tire') truck.breakCorner(corner, 'flat')
    if (focus.kind === 'axle') truck.breakCorner(corner, 'flop')
    if (focus.kind === 'mount') truck.breakCorner(corner, 'mount')
    if (corner >= 0) {
      const c = truck.cornerPosition(corner, new THREE.Vector3())
      const n = focus.kind === 'fade' ? 26 : 18
      for (let i = 0; i < n; i++) {
        const target = focus.kind === 'fade' ? smoke : dust
        target.emit({
          x: c.x + (Math.random() - 0.5) * 0.3, y: focus.kind === 'fade' ? c.y + truck.radius * 0.6 : 0.1, z: c.z,
          vx: (Math.random() - 0.5) * 2, vy: 0.6 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 2,
          life: 1.6 + Math.random(), size: truck.radius * 0.9, grow: truck.radius * 1.4, alpha: 0.7,
        })
      }
    }
  }

  function emitDust(p: Pose, dt: number): void {
    if (!truck || !run?.road || p.speed < 2) return
    // More dust the faster it goes; it trails behind each wheel.
    const chance = Math.min(1, p.speed * dt * 1.2)
    for (let i = 0; i < 4; i++) {
      if (Math.random() > chance) continue
      const c = truck.cornerPosition(i, focusPos)
      dust.emit({
        x: c.x - truck.radius * 0.8, y: Math.max(0.05, c.y - truck.radius * 0.8), z: c.z,
        vx: -p.speed * 0.25 + (Math.random() - 0.5), vy: 0.4 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.2,
        life: 1.2 + Math.random() * 0.8, size: truck.radius * 0.7, grow: truck.radius * 2, alpha: 0.38,
      })
    }
  }

  function emitSmoke(focus: BreakFocus, dt: number, progress: number): void {
    if (!truck || focus.kind !== 'fade' || focus.corner < 0) return
    // A hot damper smokes more and more as the oil cooks.
    if (Math.random() > dt * 40 * (0.3 + progress)) return
    const c = truck.cornerPosition(focus.corner, focusPos)
    smoke.emit({
      x: c.x, y: c.y + truck.radius * 0.7, z: c.z,
      vx: -0.4 + Math.random() * 0.3, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.4,
      life: 1.4 + Math.random(), size: truck.radius * 0.5, grow: truck.radius * 1.5, alpha: 0.6,
    })
  }

  function draw(dtReal: number): void {
    if (!truck || clip.length === 0) {
      renderer.render(scene, camera)
      return
    }
    const length = clipLength()
    const dt = dtReal * opts.rate
    if (!ended) {
      clipTime += dt
      if (clipTime >= length) {
        clipTime = length
        ended = true
        holding = 0
        if (opts.focus) showBreak(opts.focus)
        if (!opts.loop) opts.onEnd?.()
      }
    } else if (opts.loop) {
      holding += dtReal
      if (holding > HOLD) restart()
    }
    const p = poseAt(clipTime)
    const progress = length > 0 ? clipTime / length : 1
    const tx = p.distance - origin
    truck.root.position.set(run?.road ? tx : 0, 0, 0)
    const pose: TruckPose = { z: p.z, pitch: p.pitch, roll: p.roll, wheelZ: p.wheelZ, distance: p.distance }
    truck.pose(pose)
    if (!run?.road) {
      for (let i = 0; i < 4; i++) {
        const c = truck.cornerPosition(i, focusPos)
        posts[i]!.position.set(c.x, p.ground - 0.15, c.z)
      }
    }
    if (!ended) {
      emitDust(p, dt)
      if (opts.focus) emitSmoke(opts.focus, dt, progress)
    }
    // Puffs move on the clip's clock, so they slow down in slow motion too.
    const puffDt = ended ? dtReal * 0.6 : dt
    dust.update(puffDt)
    smoke.update(puffDt)
    shake = Math.max(0, shake - dtReal * 2.2)
    placeCamera(run?.road ? tx : 0, progress)
    renderer.render(scene, camera)
  }

  function restart(): void {
    clipTime = 0
    cursor = 0
    ended = false
    broke = false
    holding = 0
    truck?.breakCorner(null)
    smoke.clear()
  }

  function tick(now: number): void {
    raf = 0
    const dt = Math.min(0.1, (now - lastTime) / 1000)
    lastTime = now
    draw(dt)
    loop()
  }

  function loop(): void {
    if (raf || !visible || clip.length === 0) return
    raf = requestAnimationFrame((now) => {
      if (!lastTime) lastTime = now
      tick(now)
    })
  }

  const sizer = new ResizeObserver(() => {
    resize()
    if (!raf) draw(0)
  })
  sizer.observe(canvas)
  const watcher = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting)
    lastTime = 0
    if (visible) loop()
  })
  watcher.observe(canvas)

  look()
  resize()

  return {
    async setRun(next) {
      const mine = ++ticket
      if (truck?.cls !== next.cls) {
        const model = await TruckModel.load(next.cls)
        if (mine !== ticket) return
        truck?.dispose()
        truck = model
        scene.add(truck.root)
      }
      run = next
      truck.stance = next.stance
      truck.breakCorner(null)
      clip = []
      dust.clear()
      smoke.clear()
    },
    play(next, o) {
      if (next.length === 0) return
      const sameRoad = clip.length > 0 && clip[0] === next[0]
      clip = next
      opts = o
      cursor = 0
      restart()
      if (!o.focus) {
        shot = SHOTS[shotIndex++ % SHOTS.length]!
      } else {
        shot = 'side'
      }
      if (!sameRoad) buildStrip()
      dust.clear()
      loop()
    },
    stop() {
      cancelAnimationFrame(raf)
      raf = 0
      clip = []
      truck?.breakCorner(null)
    },
    dispose() {
      cancelAnimationFrame(raf)
      sizer.disconnect()
      watcher.disconnect()
      stopLook()
      truck?.dispose()
      strip.geometry.dispose()
      dust.dispose()
      smoke.dispose()
      renderer.dispose()
    },
  }
}
