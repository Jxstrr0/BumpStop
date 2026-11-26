/**
 * What every Bump Stop 3D view shares (plan PR 5): the renderer, the light,
 * and colours taken from the page's own CSS variables, so the 3D views
 * follow the roadbook look and switch to the night-stage colours with the
 * phone's dark mode.
 */
import * as THREE from 'three'

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

/** A renderer sized for phones: no more than two pixels per CSS pixel. */
export function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  return renderer
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
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
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

/** Set the lights and background for the page's light or dark look. */
export function applyLook(scene: THREE.Scene, lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight }): void {
  const dark = isDark()
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
