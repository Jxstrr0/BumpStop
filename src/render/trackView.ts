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
 * On the shaker rig the truck stands on four hydraulic posts in the team's
 * workshop.
 *
 * Round the road is Birchland (the scenery pass): the land from
 * `terrain.ts`, the forest and roadside from `scenery.ts`, and the sky from
 * `sky.ts`. A rig's loop has a start line; a raid stage doesn't.
 *
 * A ghost truck (your best run, or a friend's) can drive the loop with you:
 * a pale, see-through copy posed from its own clip of the same moments.
 * When it has broken it stays where it stopped, so you drive away from it.
 *
 * With reduced motion the camera holds one side-on view and never shakes or
 * swoops; the truck still moves as the sim says.
 *
 * The swing-around camera (v1.19): a drag on the picture hands the camera
 * to the player (`swingStart`/`swingSet`). It keeps following the truck
 * from wherever they put it, clip after clip, until `swingEnd` gives it
 * back to the TV-style shots. It never goes into the forest on the right
 * or past the cameras' clear lane on the left (`SWING` in `graphics.ts`).
 */
import * as THREE from 'three'
import type { ClassId } from '../data/classes'
import { PHOTO_LIFT, SWING, TRACK_CAMERA } from '../data/graphics'
import { LAND, LAND_COLOUR, SHAKER_FLOOR, SKY } from '../data/scenery'
import type { FailureKind } from '../data/wear'
import { WEATHER_LOOK, type WeatherId } from '../data/weather'
import type { Grime } from '../sim/grime'
import type { Profile } from '../sim/ground'
import type { Pose } from '../sim/poses'
import { GHOST_LOOK } from '../data/rigs'
import { pixelRatioFor, trackFov } from './framing'
import { addLights, applyLook, applyTier, cssColour, isDark, makeRenderer, onLookChange } from './look'
import { TruckLamps, type NightLamps } from './lamps'
import { NIGHT_LOOK } from '../data/graphics'
import { Puffs } from './particles'
import { loadKit, plant, Props, Wires, type Kit } from './scenery'
import { Sky, SKY_RADIUS, SUN_DIRECTION } from './sky'
import { buildGround, isWinter, placePieces, wholeRows, type Ground } from './terrain'
import { frameTime, onTierChange, tierSettings } from './tiers'
import { TruckModel, type FittedParts, type Stance, type TruckPose } from './truckModel'

export interface BreakFocus {
  corner: number
  kind: FailureKind
}

/**
 * A moment in a jump ramp landing (`src/sim/landing.ts`), shown as the
 * replay passes it: a puff at the corner (amber on the bump stop, red for a
 * bottom-out, dust where the wheels touch) and `onMark` for the caption.
 * `t` is seconds into the run; `corner` 0 to 3, or -1 for the whole truck.
 */
export interface ClipMark {
  t: number
  kind: 'takeoff' | 'touch' | 'bumpStop' | 'bottom' | 'bounce'
  corner: number
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
  /** The ghost truck's poses over the same moments (it may have stopped earlier), or null for no ghost. */
  ghost?: readonly Pose[] | null
  /** What broke on the ghost, shown once it has stopped. */
  ghostBroken?: BreakFocus | null
  /** Hold the side-on shot (the jump ramp's landing replays). */
  side?: boolean
  /** The finish of a run that lasted: watch from where the truck pulls up as it comes through the arch. */
  finish?: boolean
  /** Moments to mark as the clip passes them, and who to tell. */
  marks?: readonly ClipMark[]
  onMark?: (mark: ClipMark) => void
}

export interface RunSetup {
  cls: ClassId
  stance: Stance
  /** The build's parts, so the truck on the track is the one you built. */
  parts: FittedParts
  /** The loop's road, one profile per piece; null for the shaker rig. */
  road: readonly Profile[] | null
  /** Front axle to rear axle (m). */
  wheelbase: number
  /** A ghost truck of the same class to race, or null. */
  ghost?: { stance: Stance; parts: FittedParts } | null
  /** The road is a rig's loop, driven lap after lap: it gets a start line, and the same scenery every lap. */
  loop?: boolean
  /** Mud, dust, snow and dents to show on the truck (a raid's); left out for a clean truck. */
  grime?: Grime | null
}

/** Photo mode's camera and moment (plan PR 12). */
export interface PhotoControls {
  /** Where in the clip, 0 (its start) to 1 (its end). */
  moment: number
  /** The camera's way round the truck (radians; 0 is side-on from the left). */
  turn: number
  /** The camera's height, as an angle above the ground (radians). */
  lift: number
  /** Distance from the truck, as a share of where photo mode started (smaller is closer). */
  zoom: number
}

/** The swing-around camera: where the player has put it, round the middle of the truck. */
export interface SwingControls {
  /** The camera's way round the truck (radians; 0 is side-on from the left). */
  turn: number
  /** The camera's height, as an angle above the ground (radians). */
  lift: number
  /** Distance from the truck, as a share of `SWING.base` truck lengths (smaller is closer). */
  zoom: number
}

export interface TrackView {
  setRun(run: RunSetup): Promise<void>
  play(clip: readonly Pose[], o: ClipOptions): void
  /** Stop drawing until the next clip (the run was reset). */
  stop(): void
  /**
   * Photo mode (plan PR 12): freeze the clip where it is and hand the camera
   * to the player. Returns where it starts, or null when there's nothing on
   * screen. Clips asked for meanwhile wait until `photoEnd`.
   */
  photoStart(): PhotoControls | null
  photoSet(c: PhotoControls): void
  photoEnd(): void
  /**
   * The swing-around camera: take the camera from wherever the shot has it
   * (or carry on from where the player left it). Null when there's no truck yet.
   */
  swingStart(): SwingControls | null
  swingSet(c: SwingControls): void
  /** Back to the TV-style shots. */
  swingEnd(): void
  /** The sky for a raid's weather (the fog closes in and changes colour); 'clear' for a clear day. */
  setWeather(kind: WeatherId | 'clear'): void
  /** The truck's mud, dust, snow and dents as the raid goes on (`src/sim/grime.ts`); null for a clean truck. */
  setGrime(g: Grime | null): void
  /** Night (night stages, after 1.20): the dark, and the build's lamps lighting the road; null for daylight. */
  setNight(lamps: NightLamps | null): void
  /** The view as it stands, drawn with its longer side `longSide` pixels and copied onto a plain canvas. */
  snapshot(longSide: number): HTMLCanvasElement | null
  dispose(): void
}


type Shot = 'side' | 'front' | 'chase' | 'wheel' | 'high' | 'finish'
const SHOTS: readonly Shot[] = ['side', 'front', 'chase', 'wheel', 'high']

/** The finish camera stands at least this far out from the middle of the road (m): clear of the arch's legs (5.2 m) and the tire stacks. */
const FINISH_SIDE = 7.5
/** Seconds a break holds on screen before the replay starts again. */
const HOLD = 1.8
/** Strip margins behind and ahead of the clip (m). */
const BEHIND = 30
const AHEAD = 60

const smooth = (u: number) => {
  const v = Math.min(1, Math.max(0, u))
  return v * v * (3 - 2 * v)
}

/** The pose at time `t` (s into the run) in a clip, starting the search at `cursor`. Returns the pose and where it was found. */
function poseIn(list: readonly Pose[], cursor: number, t: number): { pose: Pose; cursor: number } {
  let k = cursor
  while (k < list.length - 2 && list[k + 1]!.t <= t) k++
  while (k > 0 && list[k]!.t > t) k--
  const a = list[k]!
  const b = list[Math.min(k + 1, list.length - 1)]!
  const span = b.t - a.t
  return { pose: lerpPose(a, b, span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0), cursor: k }
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
  // The far limit is past the sky's bowl.
  const camera = new THREE.PerspectiveCamera(TRACK_CAMERA.fov, 1, 0.1, SKY_RADIUS * 1.2)
  const lights = addLights(scene, 8)
  scene.fog = new THREE.Fog(0xffffff, 40, 140)

  // Outdoors: the road strip and the land (rebuilt per clip), a lake's water, the scenery and the sky.
  const outdoors = new THREE.Group()
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false })
  const strip = new THREE.Mesh(new THREE.BufferGeometry(), roadMat)
  strip.receiveShadow = true
  // The land is drawn in flat facets, like the trees and rocks standing on it.
  const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true })
  const hills = new THREE.Mesh(new THREE.BufferGeometry(), landMat)
  const waterMat = new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0 })
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), waterMat)
  water.rotation.x = -Math.PI / 2
  const sky = new Sky()
  const wires = new Wires()
  outdoors.add(strip, hills, water, wires.lines, sky.group)
  scene.add(outdoors)
  let ground: Ground | null = null
  // The scenery kit arrives a moment after the first truck does.
  let props: Props | null = null

  // The shaker rig: the workshop, its floor, and four hydraulic posts with a pan under each wheel.
  const shop = new THREE.Group()
  const shopFloorMat = new THREE.MeshStandardMaterial({ roughness: 0.95 })
  const shopFloor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), shopFloorMat)
  shopFloor.rotation.x = -Math.PI / 2
  shopFloor.position.y = SHAKER_FLOOR
  shopFloor.receiveShadow = true
  shop.add(shopFloor)
  const shopMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
  // Each post: a base bolted to the floor and a pan that follows the wheel.
  const posts = [0, 1, 2, 3].map(() => {
    const post = { base: new THREE.Group(), pan: new THREE.Group() }
    shop.add(post.base, post.pan)
    return post
  })
  scene.add(shop)

  /** Build what's made from the scenery kit: the workshop, the posts, the far hills and the clouds. */
  function useKit(kit: Kit): void {
    if (props) return
    props = new Props(kit)
    outdoors.add(props.group)
    sky.setKit(kit)
    const room = kit.get('Shop')
    if (room) shop.add(new THREE.Mesh(room, shopMat))
    for (const post of posts) {
      for (const [name, into] of [['ShakerBase', post.base], ['ShakerPan', post.pan]] as const) {
        const g = kit.get(name)
        if (!g) continue
        const mesh = new THREE.Mesh(g, shopMat)
        mesh.castShadow = true
        mesh.receiveShadow = true
        into.add(mesh)
      }
    }
  }

  const dust = new Puffs(160, 0xc8b89a)
  const smoke = new Puffs(70, 0xe8e8e8)
  // The jump ramp's landing marks: amber on the bump stops, red for a bottom-out.
  const amber = new Puffs(40, 0xf0ae45)
  const red = new Puffs(40, 0xff5050)
  scene.add(dust.points, smoke.points, amber.points, red.points)

  let truck: TruckModel | null = null
  // The ghost truck, and its clip of the same moments.
  let ghost: TruckModel | null = null
  let ghostClip: readonly Pose[] = []
  let ghostCursor = 0
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
  // Photo mode: the player's camera, the distance it started at, and what to do once it ends.
  let photo: PhotoControls | null = null
  let photoDistance = 1
  let waiting: { clip: readonly Pose[]; o: ClipOptions } | 'stop' | null = null
  // The swing-around camera, while the player has it.
  let swing: SwingControls | null = null
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  // The raid's weather, if any: it sets the sky colour and how near the fog closes in.
  let weather: WeatherId | 'clear' = 'clear'
  // A night stage: the build's lamps, and their lights on the truck. Night looks dark whatever the phone's theme.
  let night: NightLamps | null = null
  let lamps: TruckLamps | null = null
  const darkNow = () => night !== null || isDark()
  /** Hang the lamps' lights on the truck as it is now (or take them off for daylight). */
  function fitLamps(): void {
    lamps?.dispose()
    lamps = night && truck ? new TruckLamps(truck, night) : null
  }

  function look(): void {
    applyLook(scene, lights)
    const dark = darkNow()
    // A pale northern sky by day; a deep blue one for night stages. Weather greys it, whitens it or browns it.
    const w = WEATHER_LOOK[weather]
    const haze = new THREE.Color(dark ? w.dark : w.light)
    const fog = scene.fog as THREE.Fog
    fog.color.copy(haze)
    if (run && !run.road) {
      // Indoors on the shaker rig: no haze, and the workshop's own gloom past the open side.
      scene.background = cssColour('--panel-2', '#ece8dc').multiplyScalar(dark ? 0.5 : 0.8)
      fog.near = 200
      fog.far = 800
    } else {
      scene.background = haze
      fog.near = w.near
      fog.far = w.far
    }
    if (night) {
      // Night: only the moon, and the dark closes in past the lamps (sooner still in weather).
      lights.hemi.color.set(0x9fb4d8)
      lights.hemi.groundColor.set(0x2a2a30)
      lights.hemi.intensity = 0.9 * NIGHT_LOOK.moon
      lights.sun.color.set(0xc8d6ff)
      lights.sun.intensity = 1.1 * NIGHT_LOOK.moon
      fog.color.setHex(NIGHT_LOOK.fog).lerp(haze, weather === 'clear' ? 0 : 0.25)
      fog.near = Math.min(w.near, NIGHT_LOOK.fogNear)
      fog.far = Math.min(w.far, NIGHT_LOOK.fogFar)
      if (run?.road) scene.background = fog.color.clone()
    }
    sky.setLook(weather, dark)
    // Still water takes the colour of the sky above it.
    waterMat.color.setHex(dark ? LAND_COLOUR.waterNight : LAND_COLOUR.water).lerp(new THREE.Color(dark ? SKY[weather].zenithDark : SKY[weather].zenith), 0.3)
    shopFloorMat.color.copy(cssColour('--panel-2', '#ece8dc'))
    // The workshop's lights are dimmer on a night stage.
    shopMat.color.setScalar(dark ? 0.5 : 1)
    dustColour()
    smoke.setColour(dark ? 0x9a9a9a : 0xeeeeee)
    if (clip.length) buildStrip()
  }
  /** Dust off gravel; a white spray off snow and ice. */
  function dustColour(): void {
    const snow = !!run?.road && isWinter(run.road)
    if (darkNow()) dust.setColour(snow ? 0x8e99a8 : 0x6b6457)
    else dust.setColour(snow ? 0xf2f5f8 : 0xc8b89a)
  }
  const stopLook = onLookChange(look)

  /** Fit the lens to a picture this shape: a tall one (full page on a phone) opens it up. */
  function frame(aspect: number): void {
    camera.aspect = aspect
    camera.fov = trackFov(aspect)
    camera.updateProjectionMatrix()
  }

  function resize(): void {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    // A very big canvas (full page on a computer) is drawn a little softer to stay smooth.
    const tier = tierSettings()
    const ratio = pixelRatioFor(w, h, window.devicePixelRatio, tier.pixelRatioCap, tier.maxPixels)
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio)
    renderer.setSize(w, h, false)
    frame(w / h)
  }

  /** Lay the road under this clip, with room behind and ahead for the camera. */
  function buildStrip(): void {
    if (!run || !clip.length || !truck) return
    const first = clip[0]!
    const last = clip[clip.length - 1]!
    origin = first.distance
    const night = darkNow()
    if (!run.road) {
      outdoors.visible = false
      shop.visible = true
      ground = null
      return
    }
    shop.visible = false
    outdoors.visible = true
    const pieces = placePieces(run.road, run.wheelbase, first.piece, first.distance, first.x)
    const { from, to } = wholeRows(first.distance - BEHIND, last.distance + AHEAD)
    const tier = tierSettings()
    // A loop's length: each piece's road overlaps the next by a wheelbase.
    const lap = run.loop ? run.road.reduce((sum, p) => sum + p.length - run!.wheelbase, 0) : 0
    const winter = isWinter(run.road)
    dustColour()
    strip.geometry.dispose()
    hills.geometry.dispose()
    ground = buildGround({ pieces, halfTrack: truck.track / 2, winter, lap }, { from, to, origin, step: tier.roadStep, night })
    strip.geometry = ground.strip
    hills.geometry = ground.hills
    // One sheet of water under the whole left side: it shows wherever the land dips below it. Frozen over in winter.
    const far = LAND.columns[LAND.columns.length - 1]!
    water.scale.set(ground.to - ground.from, far - LAND.seam, 1)
    water.position.set((ground.from + ground.to) / 2 - origin, LAND.water, -(far + LAND.seam) / 2)
    waterMat.roughness = winter ? 0.7 : 0.18
    if (winter) waterMat.color.setHex(LAND_COLOUR.ice).multiplyScalar(night ? 0.45 : 1)
    if (props) {
      // Nothing tall between the cameras and the truck: the side-on camera stands 2.2 truck lengths out.
      const lane = 2.2 * truck.length + 4
      const poles = plant(props, ground, { from, to, origin, lane, cover: tier.cover, night, loop: !!run.loop, wheelbase: run.wheelbase })
      wires.set(poles, night)
    }
  }

  function poseAt(time: number): Pose {
    const found = poseIn(clip, cursor, clip[0]!.t + time)
    cursor = found.cursor
    return found.pose
  }

  /**
   * Put the ghost truck where its own clip says at this moment of the run
   * (`time` s into the clip). Once its clip runs out it has stopped: it
   * stays put, showing what broke, and drops out of the picture behind.
   */
  function placeGhost(time: number): void {
    const g = ghost
    if (!g) return
    if (!run?.road || ghostClip.length === 0 || clip.length === 0) {
      g.root.visible = false
      return
    }
    const t = clip[0]!.t + time
    const last = ghostClip[ghostClip.length - 1]!
    let p = last
    if (t < last.t) {
      const found = poseIn(ghostClip, ghostCursor, t)
      ghostCursor = found.cursor
      p = found.pose
    }
    const gx = p.distance - origin
    g.root.visible = gx > -BEHIND * 0.8
    if (!g.root.visible) return
    const broken = t >= last.t ? opts.ghostBroken : null
    g.breakCorner(null)
    if (broken && broken.corner >= 0) {
      if (broken.kind === 'tire') g.breakCorner(broken.corner, 'flat')
      if (broken.kind === 'axle') g.breakCorner(broken.corner, 'flop')
      if (broken.kind === 'mount') g.breakCorner(broken.corner, 'mount')
    }
    g.root.position.set(gx, 0, 0)
    g.pose({ z: p.z, pitch: p.pitch, roll: p.roll, wheelZ: p.wheelZ, distance: p.distance })
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
      case 'finish': {
        // A camera on the cameras' side of the road, four truck lengths ahead, looking back at it: the
        // truck comes through the arch towards it. As the truck brakes the camera eases to a stop just past
        // where the truck pulls up, so the run ends on the truck from the front, the arch behind it.
        // (d² / (d + lead) is about d − lead far off, and comes to rest smoothly at 0.)
        const stop = clip.length > 0 ? clip[clip.length - 1]!.distance - origin : tx
        const d = Math.max(0, stop - tx)
        const ease = 2.5 * L
        out.set(stop + 1.5 * L - (d * d) / (d + ease), 1.6 + 0.1 * L, -Math.max(1.35 * L, FINISH_SIDE))
        target.set(tx + 0.1 * L, 1.5 * R, 0)
        break
      }
    }
  }

  const camPos = new THREE.Vector3()
  const camTarget = new THREE.Vector3()
  const focusPos = new THREE.Vector3()
  const focusTarget = new THREE.Vector3()

  function placeCamera(tx: number, progress: number): void {
    if (!truck) return
    if (swing) {
      placeSwing(swing, tx, progress)
    } else {
      placeShot(tx, progress)
    }
    if (shake > 0 && !reduced.matches) {
      const k = shake * 0.06 * truck.radius
      camPos.x += Math.sin(performance.now() * 0.09) * k
      camPos.y += Math.sin(performance.now() * 0.13) * k
    }
    aim(tx)
  }

  /** The player's camera, following the truck. On a break replay it looks more and more at the corner that broke. */
  function placeSwing(c: SwingControls, tx: number, progress: number): void {
    const t = truck!
    photoTarget(tx, camTarget)
    const focus = opts.focus
    if (focus && focus.corner >= 0) {
      const corner = t.cornerPosition(focus.corner, focusTarget)
      camTarget.lerp(corner, 0.6 * (reduced.matches ? 1 : smooth(progress * 1.25)))
    }
    orbit(c.turn, c.lift, swingBase() * c.zoom, camTarget, camPos)
  }

  /** The distance the swing camera stands at zoom 1 (m). */
  function swingBase(): number {
    return SWING.base * (truck?.length ?? 4)
  }

  const toward = new THREE.Vector3()
  /**
   * Put `out` at distance `d` from `target`, `turn` round and `lift` up, but
   * no further than the clear space round the truck: the road's verges
   * outdoors (the forest on the right, the cameras' lane on the left), the
   * workshop's walls and roof indoors. It comes in closer instead.
   */
  function orbit(turn: number, lift: number, d: number, target: THREE.Vector3, out: THREE.Vector3): void {
    const up = Math.min(PHOTO_LIFT.max, Math.max(PHOTO_LIFT.min, lift))
    toward.set(Math.sin(turn) * Math.cos(up), Math.sin(up), -Math.cos(turn) * Math.cos(up))
    let reach = d
    const limit = (dir: number, from: number, edge: number) => {
      if (dir > 1e-4) reach = Math.min(reach, (edge - from) / dir)
    }
    if (run && !run.road) {
      const box = SWING.shop
      limit(toward.x, target.x, box.xMax)
      limit(-toward.x, -target.x, -box.xMin)
      limit(toward.y, target.y, box.yMax)
      limit(toward.z, target.z, box.zMax)
    } else if (run && truck) {
      // The same lane `buildStrip` keeps clear of anything tall.
      const lane = 2.2 * truck.length + 4
      limit(toward.z, target.z, SWING.rightEdge)
      limit(-toward.z, -target.z, lane - SWING.leftSpare)
    }
    reach = Math.max(reach, (truck?.radius ?? 0.4) * 3)
    out.copy(target).addScaledVector(toward, reach)
    out.y = Math.max(0.15, out.y)
  }

  /** The TV-style shot for this clip, closing in on a break. */
  function placeShot(tx: number, progress: number): void {
    const t = truck!
    // The finish camera stands still, so it stays on with reduced motion too.
    shotCamera(reduced.matches && shot !== 'finish' ? 'side' : shot, tx, camPos, camTarget)
    const focus = opts.focus
    if (focus && focus.corner >= 0) {
      // Close in on the corner that broke, from its own side.
      const c = t.cornerPosition(focus.corner, focusTarget)
      const out = focus.corner % 2 === 0 ? -1 : 1
      const R = t.radius
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
  }

  /** Point the camera from `camPos` at `camTarget`, keeping it above the ground, and bring the sun and sky along. */
  function aim(tx: number): void {
    if (ground) camPos.y = Math.max(camPos.y, ground.at(camPos.x + origin, camPos.z) + 0.3)
    camera.position.copy(camPos)
    camera.lookAt(camTarget)
    lights.sun.position.set(tx, 0, 0).addScaledVector(SUN_DIRECTION, 19)
    lights.sun.target.position.set(tx, 0, 0)
    sky.follow(camPos)
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

  /** The landing marks between two moments of the clip (run seconds): a puff at the corner, and tell the caption. */
  function passMarks(from: number, to: number): void {
    if (!truck) return
    for (const m of opts.marks ?? []) {
      if (m.t <= from || m.t > to) continue
      opts.onMark?.(m)
      const puffs = m.kind === 'bumpStop' ? amber : m.kind === 'bottom' ? red : m.kind === 'touch' ? dust : null
      if (!puffs) continue
      if (m.kind === 'bottom' && !reduced.matches) shake = Math.max(shake, 0.5)
      const corners = m.corner >= 0 ? [m.corner] : [0, 1, 2, 3]
      for (const corner of corners) {
        const c = truck.cornerPosition(corner, focusPos)
        for (let i = 0; i < 8; i++) {
          puffs.emit({
            x: c.x + (Math.random() - 0.5) * 0.3, y: Math.max(0.05, c.y - truck.radius * 0.3), z: c.z,
            vx: (Math.random() - 0.5) * 1.6, vy: 0.4 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 1.6,
            life: 0.9 + Math.random() * 0.5, size: truck.radius * 0.6, grow: truck.radius * 1.2, alpha: m.kind === 'touch' ? 0.5 : 0.8,
          })
        }
      }
    }
  }

  function emitDust(p: Pose, dt: number): void {
    if (!truck || !run?.road || p.speed < 2) return
    // More dust the faster it goes (and the higher the graphics tier); it trails behind each wheel.
    const chance = Math.min(1, p.speed * dt * 1.2 * tierSettings().dust)
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

  /** Put the truck (and the shaker's posts) where pose `p` says. Returns the truck's x in the scene. */
  function applyPose(p: Pose): number {
    const t = truck!
    const tx = p.distance - origin
    t.root.position.set(run?.road ? tx : 0, 0, 0)
    const pose: TruckPose = { z: p.z, pitch: p.pitch, roll: p.roll, wheelZ: p.wheelZ, distance: p.distance }
    t.pose(pose)
    if (!run?.road) {
      // Each pan sits under its wheel and rides up and down with the post; the base stays bolted to the floor.
      for (let i = 0; i < 4; i++) {
        const c = t.cornerPosition(i, focusPos)
        posts[i]!.pan.position.set(c.x, p.ground, c.z)
        posts[i]!.base.position.set(c.x, 0, c.z)
      }
    }
    return run?.road ? tx : 0
  }

  /** Where photo mode's camera looks: the middle of the truck. */
  function photoTarget(tx: number, out: THREE.Vector3): THREE.Vector3 {
    const t = truck!
    return out.set(tx + (t.frontX + t.rearX) / 2, 1.6 * t.radius, 0)
  }

  /** Draw the frozen moment from the player's camera. */
  function drawPhoto(): void {
    if (!truck || !photo || clip.length === 0) return
    const length = clipLength()
    clipTime = Math.min(1, Math.max(0, photo.moment)) * length
    // The break shows only at the very end of a break replay.
    const atBreak = !!opts.focus && photo.moment >= 0.999
    if (atBreak && !broke) showBreak(opts.focus!)
    if (!atBreak && broke) {
      broke = false
      truck.breakCorner(null)
    }
    shake = 0
    const tx = applyPose(poseAt(clipTime))
    placeGhost(clipTime)
    photoTarget(tx, camTarget)
    // The same clear space as the swing camera: it comes in rather than go into the trees.
    orbit(photo.turn, photo.lift, photoDistance * photo.zoom, camTarget, camPos)
    aim(tx)
    renderer.render(scene, camera)
  }

  function draw(dtReal: number): void {
    if (photo) {
      drawPhoto()
      return
    }
    if (!truck || clip.length === 0) {
      renderer.render(scene, camera)
      return
    }
    const length = clipLength()
    const dt = dtReal * opts.rate
    const before = clipTime
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
    const tx = applyPose(p)
    placeGhost(clipTime)
    if (opts.marks && clipTime > before) passMarks(clip[0]!.t + before, clip[0]!.t + clipTime)
    if (!ended) {
      emitDust(p, dt)
      if (opts.focus) emitSmoke(opts.focus, dt, progress)
    }
    // Puffs move on the clip's clock, so they slow down in slow motion too.
    const puffDt = ended ? dtReal * 0.6 : dt
    dust.update(puffDt)
    smoke.update(puffDt)
    amber.update(puffDt)
    red.update(puffDt)
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
    if (!ended) frameTime(dt)
    draw(dt)
    loop()
  }

  function loop(): void {
    if (raf || !visible || clip.length === 0 || photo) return
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
  // A new graphics tier (picked, or Auto stepping down): new pixels, shadows, road and trees.
  const stopTier = onTierChange(() => {
    if (applyTier(renderer, lights.sun)) resize()
    if (clip.length) buildStrip()
    if (!raf) draw(0)
  })

  look()
  resize()

  return {
    setWeather(kind) {
      if (kind === weather) return
      weather = kind
      look()
    },
    setGrime(g) {
      truck?.setGrime(g)
    },
    setNight(next) {
      if (JSON.stringify(next) === JSON.stringify(night)) return
      night = next
      fitLamps()
      look()
    },
    async setRun(next) {
      const mine = ++ticket
      // The scenery kit too. If it can't be fetched the truck still drives, on bare land.
      if (!props) {
        const kit = await loadKit().catch(() => null)
        if (mine !== ticket) return
        if (kit) useKit(kit)
      }
      if (truck?.cls !== next.cls) {
        const model = await TruckModel.load(next.cls)
        if (mine !== ticket) return
        lamps?.dispose()
        lamps = null
        truck?.dispose()
        truck = model
        scene.add(truck.root)
        fitLamps()
      }
      if (next.ghost && ghost?.cls !== next.cls) {
        const model = await TruckModel.load(next.cls)
        if (mine !== ticket) {
          model.dispose()
          return
        }
        ghost?.dispose()
        ghost = model
        ghost.ghostly(new THREE.Color(GHOST_LOOK.tint), GHOST_LOOK.opacity, GHOST_LOOK.mix)
        scene.add(ghost.root)
      }
      if (ghost) {
        ghost.root.visible = false
        if (next.ghost) {
          ghost.stance = next.ghost.stance
          ghost.fit(next.ghost.parts)
          ghost.breakCorner(null)
        }
      }
      const indoors = !next.road
      const wasIndoors = !!run && !run.road
      run = next
      clip = []
      // Indoors and outdoors have different air (haze, background).
      if (indoors !== wasIndoors) look()
      truck.stance = next.stance
      truck.fit(next.parts)
      truck.breakCorner(null)
      truck.setGrime(next.grime ?? null)
      clip = []
      ghostClip = []
      dust.clear()
      smoke.clear()
    },
    play(next, o) {
      if (next.length === 0) return
      if (photo) {
        waiting = { clip: next, o }
        return
      }
      const sameRoad = clip.length > 0 && clip[0] === next[0]
      clip = next
      opts = o
      cursor = 0
      ghostClip = (run?.ghost && o.ghost) || []
      ghostCursor = 0
      if (ghost && ghostClip.length === 0) ghost.root.visible = false
      restart()
      if (o.finish) {
        shot = 'finish'
      } else if (!o.focus && !o.side) {
        shot = SHOTS[shotIndex++ % SHOTS.length]!
      } else {
        shot = 'side'
      }
      if (!sameRoad) buildStrip()
      dust.clear()
      amber.clear()
      red.clear()
      loop()
    },
    stop() {
      if (photo) {
        waiting = 'stop'
        return
      }
      cancelAnimationFrame(raf)
      raf = 0
      clip = []
      ghostClip = []
      truck?.breakCorner(null)
      if (ghost) ghost.root.visible = false
    },
    photoStart() {
      if (!truck || clip.length < 2) return null
      cancelAnimationFrame(raf)
      raf = 0
      // Start from the camera as it is, seen from the middle of the truck.
      const tx = applyPose(poseAt(clipTime))
      const target = photoTarget(tx, new THREE.Vector3())
      const off = camera.position.clone().sub(target)
      photoDistance = Math.max(truck.radius * 3, off.length())
      const length = clipLength()
      photo = {
        moment: length > 0 ? clipTime / length : 1,
        turn: Math.atan2(off.x, -off.z),
        lift: Math.min(PHOTO_LIFT.max, Math.max(PHOTO_LIFT.min, Math.asin(Math.min(1, Math.max(-1, off.y / photoDistance))))),
        zoom: 1,
      }
      waiting = null
      drawPhoto()
      return { ...photo }
    },
    photoSet(c) {
      if (!photo) return
      photo = { ...c }
      drawPhoto()
    },
    photoEnd() {
      if (!photo) return
      photo = null
      const next = waiting
      waiting = null
      if (next === 'stop') this.stop()
      else if (next) this.play(next.clip, next.o)
      else {
        lastTime = 0
        loop()
      }
    },
    swingStart() {
      if (!truck) return null
      if (!swing) {
        // Start from the camera as it is, seen from the middle of the truck, so nothing jumps.
        const target = photoTarget(truck.root.position.x, new THREE.Vector3())
        const off = camera.position.clone().sub(target)
        const d = Math.max(truck.radius * 3, off.length())
        swing = {
          turn: Math.atan2(off.x, -off.z),
          lift: Math.min(PHOTO_LIFT.max, Math.max(PHOTO_LIFT.min, Math.asin(Math.min(1, Math.max(-1, off.y / d))))),
          zoom: Math.min(SWING.zoom.max, Math.max(SWING.zoom.min, d / swingBase())),
        }
      }
      return { ...swing }
    },
    swingSet(c) {
      if (!swing) return
      swing = {
        turn: c.turn,
        lift: Math.min(PHOTO_LIFT.max, Math.max(PHOTO_LIFT.min, c.lift)),
        zoom: Math.min(SWING.zoom.max, Math.max(SWING.zoom.min, c.zoom)),
      }
      // A clip that has ended isn't redrawn on its own: show the new view now.
      if (!raf && !photo) draw(0)
    },
    swingEnd() {
      if (!swing) return
      swing = null
      if (!raf && !photo) draw(0)
    },
    snapshot(longSide) {
      const w0 = canvas.clientWidth
      const h0 = canvas.clientHeight
      if (!truck || w0 === 0 || h0 === 0) return null
      const k = longSide / Math.max(w0, h0)
      const width = Math.round(w0 * k)
      const height = Math.round(h0 * k)
      // Draw once at the photo's size and copy it off straight away (the
      // canvas keeps its picture only until the browser shows it), then put
      // the view back, all in one go.
      const ratio = renderer.getPixelRatio()
      renderer.setPixelRatio(1)
      renderer.setSize(width, height, false)
      frame(width / height)
      draw(0)
      const out = document.createElement('canvas')
      out.width = width
      out.height = height
      out.getContext('2d')?.drawImage(canvas, 0, 0, width, height)
      renderer.setPixelRatio(ratio)
      resize()
      draw(0)
      return out
    },
    dispose() {
      cancelAnimationFrame(raf)
      sizer.disconnect()
      watcher.disconnect()
      stopLook()
      stopTier()
      truck?.dispose()
      ghost?.dispose()
      strip.geometry.dispose()
      hills.geometry.dispose()
      roadMat.dispose()
      landMat.dispose()
      water.geometry.dispose()
      waterMat.dispose()
      shopMat.dispose()
      props?.dispose()
      lamps?.dispose()
      wires.dispose()
      sky.dispose()
      dust.dispose()
      smoke.dispose()
      renderer.dispose()
    },
  }
}
