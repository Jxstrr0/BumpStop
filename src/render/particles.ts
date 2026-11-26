/**
 * Dust and smoke (plan PR 5): one small pool of soft round puffs, drawn in a
 * single go so it's cheap on a phone. Dust kicks up behind the wheels on the
 * test loop; smoke curls off a damper that has faded.
 */
import * as THREE from 'three'

const VERT = /* glsl */ `
  attribute float alpha;
  attribute float size;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`
const FRAG = /* glsl */ `
  uniform vec3 colour;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(colour, vAlpha * (1.0 - r));
  }
`

interface Puff {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  size: number
  grow: number
  alpha: number
}

export class Puffs {
  readonly points: THREE.Points
  private puffs: Puff[] = []
  private pos: Float32Array
  private alpha: Float32Array
  private size: Float32Array
  private geometry: THREE.BufferGeometry
  private material: THREE.ShaderMaterial

  constructor(private max: number, colour: THREE.ColorRepresentation) {
    this.pos = new Float32Array(max * 3)
    this.alpha = new Float32Array(max)
    this.size = new Float32Array(max)
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1))
    this.material = new THREE.ShaderMaterial({
      uniforms: { colour: { value: new THREE.Color(colour) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
  }

  setColour(c: THREE.ColorRepresentation): void {
    ;(this.material.uniforms.colour!.value as THREE.Color).set(c)
  }

  /** Let off one puff. */
  emit(p: Omit<Puff, 'age'>): void {
    if (this.puffs.length >= this.max) this.puffs.shift()
    this.puffs.push({ ...p, age: 0 })
  }

  clear(): void {
    this.puffs = []
    this.update(0)
  }

  /** Move and fade every puff by `dt` seconds (of the clip's own time). */
  update(dt: number): void {
    this.puffs = this.puffs.filter((p) => (p.age += dt) < p.life)
    for (let i = 0; i < this.max; i++) {
      const p = this.puffs[i]
      if (!p) {
        this.alpha[i] = 0
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      // Air drag slows each puff down.
      const drag = Math.max(0, 1 - dt * 1.6)
      p.vx *= drag
      p.vz *= drag
      this.pos[i * 3] = p.x
      this.pos[i * 3 + 1] = p.y
      this.pos[i * 3 + 2] = p.z
      const u = p.age / p.life
      this.alpha[i] = p.alpha * (1 - u) * Math.min(1, u * 6)
      this.size[i] = p.size + p.grow * p.age
    }
    for (const name of ['position', 'alpha', 'size']) this.geometry.getAttribute(name).needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
