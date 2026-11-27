/**
 * What every Bump Stop 3D view shares (plan PR 5): the renderer, the light,
 * and colours taken from the page's own CSS variables, so the 3D views
 * follow the roadbook look and switch to the night-stage colours with the
 * phone's dark mode.
 */
import * as THREE from 'three'
import { tierSettings } from './tiers'

/** A colour from a CSS variable on the page, e.g. `--bg`. */
export function cssColour(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  try {
    return new THREE.Color(value || fallback)
  } catch {
    return new THREE.Color(fallback)
  }
}

export function isDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * A renderer for one 3D view, at the graphics tier in play
 * (`src/render/tiers.ts`). Smooth edges are fixed here, when the view is
 * made; the rest follows the tier live through `applyTier`.
 */
export function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const tier = tierSettings()
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.antialias, alpha: false, powerPreference: 'low-power' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  // Always on: whether anything casts a shadow is the sun's `castShadow` (see applyTier).
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatioCap))
  return renderer
}

/**
 * Set a view's pixels and shadows to the tier in play. Turning the sun's
 * shadow off skips the whole shadow pass (the trucks aren't drawn twice);
 * changing `castShadow` also makes three.js rebuild the materials to match.
 * Returns true when the canvas needs its size set again.
 */
export function applyTier(renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight): boolean {
  const tier = tierSettings()
  const ratio = Math.min(window.devicePixelRatio || 1, tier.pixelRatioCap)
  const resize = renderer.getPixelRatio() !== ratio
  if (resize) renderer.setPixelRatio(ratio)
  sun.castShadow = tier.shadows
  sun.shadow.radius = tier.shadowBlur
  if (sun.shadow.mapSize.x !== tier.shadowMap) {
    sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap)
    // The old map is the wrong size: let three.js make a new one.
    sun.shadow.map?.dispose()
    sun.shadow.map = null
  }
  return resize
}

/**
 * Sky and sun: a soft sky-and-ground light plus one sun that casts the
 * truck's shadow. Night stages are bluer and dimmer, with the lamps doing
 * more of the work.
 */
export function addLights(scene: THREE.Scene, reach: number): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight } {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f6a, 1.4)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6)
  sun.position.set(reach * 0.6, reach * 1.2, -reach * 0.8)
  sun.castShadow = tierSettings().shadows
  sun.shadow.mapSize.set(tierSettings().shadowMap, tierSettings().shadowMap)
  sun.shadow.radius = tierSettings().shadowBlur
  const s = sun.shadow.camera
  s.left = -reach
  s.right = reach
  s.top = reach
  s.bottom = -reach
  s.near = 0.5
  s.far = reach * 4
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.02
  scene.add(sun)
  scene.add(sun.target)
  return { sun, hemi }
}

// ── What the trucks reflect ──
//
// Paint, chrome, glass and alloy only look like themselves when they have
// something to mirror. This is a tiny picture of the world round the truck
// (a sky that pales to the horizon, the ground below, one bright patch where
// the sun is and a soft band of light low down) that three.js blurs into
// reflections. Only the trucks use it (`truckReflections`), so the land and
// the scenery keep their own flat look. It's made once, in code, with no
// image to download, and redrawn when the phone goes dark.

const ENV_W = 64
const ENV_H = 32
/** Sky, horizon, ground and sun for the reflections, by day and on a night stage (linear RGB, 1 = white). */
const ENV_LOOK = {
  day: { zenith: [0.16, 0.28, 0.6], horizon: [0.62, 0.62, 0.6], ground: [0.1, 0.09, 0.075], sun: [14, 13, 11], band: 0.35 },
  night: { zenith: [0.012, 0.02, 0.05], horizon: [0.1, 0.13, 0.2], ground: [0.03, 0.03, 0.04], sun: [1.6, 1.9, 2.6], band: 0.12 },
} as const
/** Where the bright patch sits: the same side as the sun the trucks are lit from. */
const ENV_SUN = new THREE.Vector3(8, 14, -10).normalize()

let envTexture: THREE.DataTexture | null = null
let envIsDark: boolean | null = null

function paintEnv(texture: THREE.DataTexture, dark: boolean): void {
  const look = dark ? ENV_LOOK.night : ENV_LOOK.day
  const data = texture.image.data as Uint16Array
  const dir = new THREE.Vector3()
  for (let y = 0; y < ENV_H; y++) {
    // Row 0 is straight down, the last row straight up.
    const lat = ((y + 0.5) / ENV_H - 0.5) * Math.PI
    for (let x = 0; x < ENV_W; x++) {
      const lon = ((x + 0.5) / ENV_W - 0.5) * Math.PI * 2
      dir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon))
      const up = dir.y
      const rgb = [0, 0, 0]
      for (let k = 0; k < 3; k++) {
        if (up >= 0) {
          // Pale at the horizon, deepening overhead.
          const t = Math.pow(up, 0.55)
          rgb[k] = look.horizon[k]! * (1 - t) + look.zenith[k]! * t
        } else {
          // The ground: lit near the horizon, darker straight below.
          const t = Math.min(1, -up * 3)
          rgb[k] = look.horizon[k]! * 0.55 * (1 - t) + look.ground[k]! * t
        }
        // A soft band of light just above the horizon, all the way round: it draws a line along bodywork.
        rgb[k]! += look.band * Math.exp(-((up - 0.12) * (up - 0.12)) / 0.004)
      }
      // The sun: a small, very bright patch with a glow round it.
      const near = dir.dot(ENV_SUN)
      const glow = Math.pow(Math.max(0, near), 600) + 0.02 * Math.pow(Math.max(0, near), 12)
      const i = (y * ENV_W + x) * 4
      for (let k = 0; k < 3; k++) data[i + k] = THREE.DataUtils.toHalfFloat(rgb[k]! + look.sun[k]! * glow)
      data[i + 3] = THREE.DataUtils.toHalfFloat(1)
    }
  }
  texture.needsUpdate = true
  // Each 3D view keeps its own blurred copy: tell them to make it again.
  texture.needsPMREMUpdate = true
}

/** The picture the trucks reflect, painted for the page's light or dark look. */
export function truckEnvironment(): THREE.DataTexture {
  const dark = isDark()
  if (!envTexture) {
    envTexture = new THREE.DataTexture(new Uint16Array(ENV_W * ENV_H * 4), ENV_W, ENV_H, THREE.RGBAFormat, THREE.HalfFloatType)
    envTexture.mapping = THREE.EquirectangularReflectionMapping
    envTexture.colorSpace = THREE.LinearSRGBColorSpace
    envTexture.magFilter = THREE.LinearFilter
    envTexture.minFilter = THREE.LinearFilter
  }
  if (envIsDark !== dark) {
    envIsDark = dark
    paintEnv(envTexture, dark)
  }
  return envTexture
}

/** How strongly the trucks take up their reflections. */
export const TRUCK_REFLECTION = 1

/** Give a truck's materials the world to reflect (see `truckEnvironment`). */
export function truckReflections(root: THREE.Object3D): void {
  const env = truckEnvironment()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial
      if (!std.isMeshStandardMaterial || std.envMap === env) continue
      std.envMap = env
      std.envMapIntensity = TRUCK_REFLECTION
      std.needsUpdate = true
    }
  })
}

/** Set the lights and background for the page's light or dark look. */
export function applyLook(scene: THREE.Scene, lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight }): void {
  const dark = isDark()
  // Repaint the trucks' reflections if the phone has just gone dark or light.
  truckEnvironment()
  scene.background = cssColour('--bg', dark ? '#17181b' : '#f4f1e8')
  lights.hemi.color.set(dark ? 0x9fb4d8 : 0xffffff)
  lights.hemi.groundColor.set(dark ? 0x2a2a30 : 0x8a7f6a)
  lights.hemi.intensity = dark ? 0.9 : 1.4
  lights.sun.color.set(dark ? 0xc8d6ff : 0xfff3e0)
  lights.sun.intensity = dark ? 1.1 : 2.6
}

/** Calls back when the phone switches between light and dark. Returns a function that stops listening. */
export function onLookChange(fn: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}
