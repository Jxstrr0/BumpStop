/**
 * The sky over the test track and the raid stages: a soft gradient from the
 * haze on the horizon up to the colour overhead, the sun (or the moon),
 * three rings of far hills fading into the haze, a few flat-bottomed clouds,
 * and on a clear night stage the stars and the northern lights.
 *
 * Everything here is "painted on the inside of a bowl" that follows the
 * camera, so it never gets nearer. It ignores the fog (it IS the far end of
 * the fog): the hills are tinted towards the sky by hand instead.
 *
 * The colours are in `src/data/scenery.ts` (`SKY`, `RIDGES`) and the
 * weather's own fog colour (`WEATHER_LOOK` in `src/data/weather.ts`).
 */
import * as THREE from 'three'
import { RIDGES, SKY } from '../data/scenery'
import { WEATHER_LOOK, type WeatherId } from '../data/weather'
import type { Kit } from './scenery'
import { hash2 } from './terrain'

/** How far away the bowl is (m). The camera's far limit must be beyond it. */
export const SKY_RADIUS = 1400

/** Where the sun stands, as a direction from the truck (the sun lamp in `trackView.ts` shines from here too). */
export const SUN_DIRECTION = new THREE.Vector3(8, 14, -10).normalize()

/** A soft round glow as a texture: bright in the middle, gone at the edge. */
function glowTexture(core: number): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(core, 'rgba(255,255,255,0.95)')
    g.addColorStop(core + 0.08, 'rgba(255,255,255,0.28)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class Sky {
  readonly group = new THREE.Group()
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private sun: THREE.Sprite
  private stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private aurora: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private ridges: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
  private clouds: THREE.InstancedMesh[] = []
  private cloudMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })
  private weather: WeatherId | 'clear' = 'clear'
  private dark = false

  constructor() {
    // The bowl: its colours are set per corner in `paint`.
    const bowl = new THREE.SphereGeometry(SKY_RADIUS, 24, 16)
    bowl.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bowl.attributes.position!.count * 3), 3))
    this.dome = new THREE.Mesh(bowl, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
    this.dome.renderOrder = -3
    this.dome.frustumCulled = false

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0.1), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }))
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(SKY_RADIUS * 0.9)
    this.sun.scale.setScalar(SKY_RADIUS * 0.5)
    this.sun.renderOrder = -2

    // Stars: more of them low in the north, where the cameras look.
    const starAt: number[] = []
    for (let i = 0; i < 420; i++) {
      const turn = hash2(i, 1.5) * Math.PI * 2
      const lift = 0.04 + hash2(i, 2.5) ** 1.6 * 1.4
      const r = SKY_RADIUS * 0.95
      starAt.push(Math.cos(turn) * Math.cos(lift) * r, Math.sin(lift) * r, Math.sin(turn) * Math.cos(lift) * r)
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starAt, 3))
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }))
    this.stars.renderOrder = -2
    this.stars.frustumCulled = false

    // The northern lights: two wavering curtains over the hills behind the truck. Black is clear (the glow adds to the sky).
    const curtain: number[] = []
    const glow: number[] = []
    const index: number[] = []
    const SEGMENTS = 40
    const c = new THREE.Color()
    for (let band = 0; band < 2; band++) {
      const r = SKY_RADIUS * (0.8 - band * 0.12)
      for (let k = 0; k <= SEGMENTS; k++) {
        const u = k / SEGMENTS
        // From north-west round to north-east (the truck's right is "north" here), wavering as it goes.
        const turn = Math.PI * (0.16 + 0.68 * u) + (band ? 0.12 : 0)
        const wave = Math.sin(u * 9 + band * 2.1) * 0.035 + Math.sin(u * 23 + band) * 0.012
        const foot = 0.2 + band * 0.1 + wave
        const tall = 0.2 + 0.1 * Math.sin(u * 6 + band * 1.7) + 0.06 * hash2(k, band + 40)
        const fade = Math.sin(Math.PI * u) ** 0.6 * (0.55 + 0.45 * hash2(k, band + 50))
        // Bright green along the foot, thinning upwards, with a magenta fringe at the top like the real thing.
        const stops: [number, number, number][] = [
          [foot, 0x000000, 0],
          [foot + tall * 0.12, 0x58e6a0, 0.6],
          [foot + tall * 0.45, 0x3fbf9a, 0.28],
          [foot + tall * 0.8, 0xc04fb0, 0.12],
          [foot + tall, 0x000000, 0],
        ]
        for (const [lift, hex, strength] of stops) {
          curtain.push(Math.cos(turn) * Math.cos(lift) * r, Math.sin(lift) * r, Math.sin(turn) * Math.cos(lift) * r)
          c.setHex(hex, THREE.SRGBColorSpace).multiplyScalar(strength * fade)
          glow.push(c.r, c.g, c.b)
        }
        if (k < SEGMENTS) {
          const n = stops.length
          const a = (band * (SEGMENTS + 1) + k) * n
          for (let row = 0; row < n - 1; row++) index.push(a + row, a + row + n, a + row + 1, a + row + 1, a + row + n, a + row + n + 1)
        }
      }
    }
    const auroraGeometry = new THREE.BufferGeometry()
    auroraGeometry.setAttribute('position', new THREE.Float32BufferAttribute(curtain, 3))
    auroraGeometry.setAttribute('color', new THREE.Float32BufferAttribute(glow, 3))
    auroraGeometry.setIndex(index)
    this.aurora = new THREE.Mesh(auroraGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }))
    this.aurora.renderOrder = -2
    this.aurora.frustumCulled = false

    this.group.add(this.dome, this.sun, this.stars, this.aurora)
    this.paint()
  }

  /** Add the far hills and the clouds, once the scenery kit has arrived. */
  setKit(kit: Kit): void {
    if (this.ridges.length) return
    for (const r of RIDGES) {
      const geometry = kit.get(r.piece)
      if (!geometry) continue
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }))
      mesh.scale.set(r.radius, r.height, r.radius)
      // Furthest first, so nearer hills cover it.
      mesh.renderOrder = -1
      mesh.frustumCulled = false
      this.ridges.push(mesh)
      this.group.add(mesh)
    }
    // A dozen clouds, low round the horizon and bigger overhead.
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    ;['Cloud_A', 'Cloud_B', 'Cloud_C'].forEach((name, n) => {
      const geometry = kit.get(name)
      if (!geometry) return
      const COPIES = 5
      const mesh = new THREE.InstancedMesh(geometry, this.cloudMaterial, COPIES)
      for (let i = 0; i < COPIES; i++) {
        const turn = (hash2(i, n + 60) + (i + n / 3) / COPIES) * Math.PI * 2
        const out = 520 + hash2(i, n + 61) * 500
        const size = 170 + hash2(i, n + 62) * 190
        p.set(Math.cos(turn) * out, 150 + hash2(i, n + 63) * 170, Math.sin(turn) * out)
        // Long side across the view.
        q.setFromAxisAngle(up, -turn + Math.PI / 2 + (hash2(i, n + 64) - 0.5) * 0.5)
        s.set(size, size * 0.8, size)
        mesh.setMatrixAt(i, m.compose(p, q, s))
      }
      mesh.frustumCulled = false
      mesh.renderOrder = -1
      this.clouds.push(mesh)
      this.group.add(mesh)
    })
    this.paint()
  }

  /** The sky for this weather, by day or on a night stage. */
  setLook(weather: WeatherId | 'clear', dark: boolean): void {
    this.weather = weather
    this.dark = dark
    this.paint()
  }

  /** The colour of the haze on the horizon (and of the fog). */
  horizon(out: THREE.Color): THREE.Color {
    const w = WEATHER_LOOK[this.weather]
    return out.setHex(this.dark ? w.dark : w.light, THREE.SRGBColorSpace)
  }

  private paint(): void {
    const look = SKY[this.weather]
    const dark = this.dark
    const horizon = this.horizon(new THREE.Color())
    const zenith = new THREE.Color().setHex(dark ? look.zenithDark : look.zenith, THREE.SRGBColorSpace)
    // The bowl: haze below and at the horizon, the colour overhead by about a third of the way up.
    const pos = this.dome.geometry.attributes.position!
    const col = this.dome.geometry.attributes.color as THREE.BufferAttribute
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const lift = pos.getY(i) / SKY_RADIUS
      const u = Math.min(1, Math.max(0, lift / 0.42))
      c.copy(horizon).lerp(zenith, u ** 0.7)
      col.setXYZ(i, c.r, c.g, c.b)
    }
    col.needsUpdate = true

    const open = look.open
    // The sun by day; a paler, smaller moon on a night stage.
    this.sun.visible = open
    this.sun.material.color.setHex(dark ? 0xaab8d8 : 0xfff1d6)
    this.sun.material.opacity = dark ? 0.8 : 1
    this.sun.scale.setScalar(SKY_RADIUS * (dark ? 0.2 : 0.5))
    this.stars.visible = open && dark
    this.aurora.visible = open && dark

    RIDGES.forEach((r, i) => {
      const mesh = this.ridges[i]
      if (!mesh) return
      mesh.visible = open
      c.setHex(r.colour, THREE.SRGBColorSpace)
      if (dark) c.multiplyScalar(0.16)
      mesh.material.color.copy(c.lerp(horizon, r.haze))
    })
    c.setHex(dark ? 0x2a3040 : 0xffffff, THREE.SRGBColorSpace).lerp(horizon, dark ? 0.5 : 0.25)
    this.cloudMaterial.color.copy(c)
    for (const mesh of this.clouds) mesh.visible = open
  }

  /** Keep the sky centred on the camera, so it never gets nearer. The hills stay level with the ground. */
  follow(camera: THREE.Vector3): void {
    this.group.position.set(camera.x, 0, camera.z)
    this.dome.position.y = camera.y
  }

  dispose(): void {
    this.dome.geometry.dispose()
    this.dome.material.dispose()
    this.sun.material.map?.dispose()
    this.sun.material.dispose()
    this.stars.geometry.dispose()
    this.stars.material.dispose()
    this.aurora.geometry.dispose()
    this.aurora.material.dispose()
    for (const mesh of this.ridges) mesh.material.dispose()
    for (const mesh of this.clouds) mesh.dispose()
    this.cloudMaterial.dispose()
  }
}
