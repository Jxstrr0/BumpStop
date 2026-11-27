/**
 * The ground the trucks drive over and the land round it (plan PR 5; the
 * land came with the scenery pass).
 *
 * **The road** is built from the very same road profiles the ride sim drives
 * (`src/sim/ground.ts`), so every washboard ripple, whoop, rock and jump the
 * truck reacts to is there under its wheels. The sim's road is two lines of
 * heights, one under each wheel track. The strip stretches them across a
 * gravel road: the left track, a slight crown in the middle, the right
 * track, then soft shoulders, a ditch and a grassy verge.
 *
 * **The land** carries on from the verge out to the horizon's haze: low and
 * open on the truck's left, where the cameras stand, with a lake now and
 * then; climbing into forested hills on the right, behind the truck. It is
 * a coarse mesh (the road needs a row every 10 cm, the hills one every 4 m),
 * and the two meet along a seam 7 m out whose height both agree on.
 *
 * Nothing here is random: every height and colour comes from the distance
 * along the road and across it, so the land stays put between clips, and a
 * rig's loop has the same land every lap.
 *
 * Distances along the strip are metres into the run, less the strip's
 * `origin`, so numbers stay small and exact on the phone's graphics chip.
 */
import * as THREE from 'three'
import { WINTER_GROUND, type GroundId } from '../data/ground'
import { LAND, LAND_COLOUR } from '../data/scenery'
import { heightAt, type Profile } from '../sim/ground'

/** One piece of the loop, placed along the run: its road starts `offset` metres into the run. */
export interface PlacedPiece {
  profile: Profile
  offset: number
}

/** Ground colours (sRGB): gravel in two tones, plus the odd ones out. */
const GROUND_COLOUR: Record<GroundId, number> = {
  graded: 0xb9a888,
  washboard: 0xb0997a,
  rough: 0xa48d6f,
  whoops: 0xab9473,
  rocks: 0x9a9286,
  jumps: 0xb39a76,
  iceHeaves: 0xc9d3da,
  ice: 0xaec6d6,
  snow: 0xe6eaee,
}
const NIGHT_DIM = 0.62

/** A table of colours, worked out once in the numbers the graphics chip wants (converting each time is slow, and the road is 25,000 corners). */
function paints<K extends string>(table: Readonly<Record<K, number>>): Record<K, THREE.Color> {
  const out = {} as Record<K, THREE.Color>
  for (const key of Object.keys(table) as K[]) out[key] = new THREE.Color().setHex(table[key], THREE.SRGBColorSpace)
  return out
}
const ROAD_PAINT = paints(GROUND_COLOUR)
const LAND_PAINT = paints(LAND_COLOUR)

/** A repeatable 0 to 1 number from a position, so colours and trees stay put between rebuilds. */
export function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Where each piece of the loop sits along the run, from the poses in a clip.
 * A piece's road is `piece length + wheelbase` long and the truck drives the
 * middle of it, so the next piece's road starts `piece length` later.
 */
export function placePieces(road: readonly Profile[], wheelbase: number, piece: number, distance: number, x: number): PlacedPiece[] {
  const n = road.length
  const here = distance - x
  const out: PlacedPiece[] = [{ profile: road[piece]!, offset: here }]
  // Two pieces each way is plenty for a strip of a couple of hundred metres.
  let off = here
  for (let k = 1; k <= 2; k++) {
    const prev = road[(((piece - k) % n) + n) % n]!
    off -= prev.length - wheelbase
    out.unshift({ profile: prev, offset: off })
  }
  off = here
  for (let k = 1; k <= 2; k++) {
    off += road[(((piece + k - 1) % n) + n) % n]!.length - wheelbase
    out.push({ profile: road[(piece + k) % n]!, offset: off })
  }
  return out
}

/** The piece that covers run-distance `s` best (furthest from its ends), or null. */
function pieceAt(pieces: readonly PlacedPiece[], s: number): PlacedPiece | null {
  let best: PlacedPiece | null = null
  let room = 0
  for (const p of pieces) {
    const u = s - p.offset
    const r = Math.min(u, p.profile.length - u)
    if (r > room) {
      room = r
      best = p
    }
  }
  return best
}

/** Road height under the left or right wheel track at run-distance `s`. */
export function roadHeight(pieces: readonly PlacedPiece[], side: 'left' | 'right', s: number): number {
  const p = pieceAt(pieces, s)
  if (!p) return 0
  return heightAt(p.profile[side], p.profile.step, s - p.offset)
}


// --- The land ---------------------------------------------------------------

/** What the land is made from: the road it follows and the season. */
export interface Land {
  pieces: readonly PlacedPiece[]
  /** Half the distance between the wheel tracks (m). */
  halfTrack: number
  /** Snow on the ground (the stage is ice or snow). */
  winter: boolean
  /** The loop's length (m) when the road is a lap that comes round again, so the land does too; 0 for a raid stage. */
  lap: number
}

/** Is this road a winter one? (Any ice or snow piece in it.) */
export function isWinter(road: readonly Profile[]): boolean {
  return road.some((p) => WINTER_GROUND.includes(p.ground))
}

const smooth = (u: number) => {
  const v = Math.min(1, Math.max(0, u))
  return v * v * (3 - 2 * v)
}
const step = (a: number, b: number, x: number) => smooth((x - a) / (b - a))
const mix = (a: number, b: number, u: number) => a + (b - a) * u

/**
 * Smooth lumps, 0 to 1: `a` metres along the road, `b` across it, each lump
 * about `size` metres across. With a `lap` it joins up with itself every
 * lap. `seed` picks which pattern.
 */
export function lumps(a: number, b: number, size: number, lap: number, seed: number): number {
  // Whole lumps per lap, so the pattern meets itself where the lap closes.
  const n = lap > 0 ? Math.max(1, Math.round(lap / size)) : 0
  const u = n ? (a / lap) * n : a / size
  const v = b / size
  const i = Math.floor(u)
  const j = Math.floor(v)
  const fu = smooth(u - i)
  const fv = smooth(v - j)
  const wrap = (k: number) => (n ? ((k % n) + n) % n : k)
  const at = (ii: number, jj: number) => hash2(wrap(ii) + seed * 17.3, jj - seed * 9.1)
  return mix(mix(at(i, j), at(i + 1, j), fu), mix(at(i, j + 1), at(i + 1, j + 1), fu), fv)
}

/** How much of a lake there is here, 0 (dry land) to 1 (the middle of one). Lakes lie on the left only. */
function lake(land: Land, s: number, z: number): number {
  if (z > -LAND.seam) return 0
  const d = -z - LAND.seam
  return step(0.56, 0.7, lumps(s, z, 85, land.lap, 3)) * step(6, 20, d) * (1 - step(70, 110, d))
}

/** How wooded it is here, 0 (open heath) to 1 (thick forest). Mostly forest on the right, mostly open on the left. */
export function wood(land: Land, s: number, z: number): number {
  if (z > 0) return step(0.3, 0.46, lumps(s, z * 0.6, 95, land.lap, 5))
  return step(0.46, 0.64, lumps(s, z * 0.8, 80, land.lap, 6)) * (1 - lake(land, s, z))
}

/**
 * The land's height at `s` metres along the road and `z` across it (m, + to
 * the truck's right), from the seam outwards. The road is at about 0.
 */
function landShape(land: Land, s: number, z: number): number {
  const d = Math.max(0, Math.abs(z) - LAND.seam)
  const roll = lumps(s, z, 38, land.lap, 1) * 2 - 1
  const bump = lumps(s, z, 11, land.lap, 2) * 2 - 1
  if (z > 0) {
    // The backdrop: a bank, then hills that climb the further you look.
    return 0.3 + 0.05 * d + 0.0007 * d * d + roll * (0.28 + d / 22) + bump * (0.07 + d / 170)
  }
  // The camera's side: low and open, rising only far off, with lake basins.
  let h = 0.04 + 0.01 * d + roll * (0.12 + d / 50) + bump * (0.05 + d / 400)
  if (d > 60) h += 0.0011 * (d - 60) * (d - 60)
  return mix(h, -1.3, lake(land, s, z))
}

/** Land colour at a spot, into `out` (linear). `h` is the height there. */
function landColour(land: Land, s: number, z: number, h: number, out: THREE.Color): THREE.Color {
  const patch = lumps(s, z, 9, land.lap, 11)
  if (land.winter) {
    // Snow, bluer in the hollows; lake ice shows through where the wind has swept it.
    out.copy(LAND_PAINT.snow).lerp(LAND_PAINT.snowShade, patch * 0.7)
    if (h < LAND.water + 0.02) out.lerp(LAND_PAINT.ice, 0.8)
    return out
  }
  out.copy(LAND_PAINT.grass).lerp(LAND_PAINT.moss, step(0.35, 0.7, patch))
  // Heather on the open ground, needles and moss under the trees.
  const heath = step(0.5, 0.66, lumps(s, z, 26, land.lap, 12))
  out.lerp(LAND_PAINT.heath, heath * 0.75)
  const far = step(1, 6, Math.abs(z) - LAND.seam)
  out.lerp(LAND_PAINT.forestFloor, wood(land, s, z) * far * 0.85)
  // A sandy shore round the lakes, and mud under the water.
  const shore = 1 - step(LAND.water + 0.05, LAND.water + 0.5, h)
  out.lerp(LAND_PAINT.sand, shore)
  if (h < LAND.water) out.multiplyScalar(0.6)
  return out
}

export interface StripOptions {
  /** Run-distance of the fine road's start and end (m): whole rows of the land (`LAND.step`). */
  from: number
  to: number
  /** The run-distance that sits at x = 0 in the scene. */
  origin: number
  /** Metres between rows along the fine road. */
  step: number
  night: boolean
}

/** Round a stretch of road outwards to whole rows of the land. */
export function wholeRows(from: number, to: number): { from: number; to: number } {
  return { from: Math.floor(from / LAND.step) * LAND.step, to: Math.ceil(to / LAND.step) * LAND.step }
}

type ColumnKind = 'left' | 'right' | 'mid' | 'shoulder' | 'ditch' | 'verge' | 'seam'

/**
 * Lateral columns across the road strip (m, + to the truck's right) and how
 * each gets its height: from a wheel track, between them, or as verge.
 */
function columns(halfTrack: number): { z: number; kind: ColumnKind }[] {
  const edge = halfTrack + 0.9
  return [
    { z: -LAND.seam, kind: 'seam' }, { z: -edge - 3.2, kind: 'verge' }, { z: -edge - 1.6, kind: 'ditch' }, { z: -edge, kind: 'shoulder' },
    { z: -halfTrack - 0.25, kind: 'left' }, { z: -halfTrack, kind: 'left' }, { z: -halfTrack + 0.25, kind: 'left' },
    { z: 0, kind: 'mid' },
    { z: halfTrack - 0.25, kind: 'right' }, { z: halfTrack, kind: 'right' }, { z: halfTrack + 0.25, kind: 'right' },
    { z: edge, kind: 'shoulder' }, { z: edge + 1.6, kind: 'ditch' }, { z: edge + 3.2, kind: 'verge' }, { z: LAND.seam, kind: 'seam' },
  ]
}

/** The road, its verges and the land round it, as drawn: two meshes and the height of the ground anywhere on them. */
export interface Ground {
  land: Land
  strip: THREE.BufferGeometry
  hills: THREE.BufferGeometry
  /** Run-distance the land starts and ends at (m). */
  from: number
  to: number
  /** The ground's height at `s` along the road and `z` across it (m), as drawn, so things stand on it. */
  at(s: number, z: number): number
}

/** Build the road strip and the land round it for a stretch of the run. */
export function buildGround(land: Land, o: StripOptions): Ground {
  const dim = o.night ? NIGHT_DIM : 1
  const c = new THREE.Color()

  // --- The land: a grid each side, from the seam out to the haze. ---
  const from = o.from - LAND.reach
  const to = o.to + LAND.reach
  const rows = Math.round((to - from) / LAND.step) + 1
  const cols = LAND.columns
  const nc = cols.length
  // Heights of both sides' grids: [side][row][column], left first.
  const heights = new Float32Array(2 * rows * nc)
  const pos = new Float32Array(2 * rows * nc * 3)
  const col = new Float32Array(2 * rows * nc * 3)
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? -1 : 1
    for (let r = 0; r < rows; r++) {
      const s = from + r * LAND.step
      for (let k = 0; k < nc; k++) {
        const z = sign * cols[k]!
        const h = landShape(land, s, z)
        const v = (side * rows + r) * nc + k
        heights[v] = h
        pos[v * 3] = s - o.origin
        pos[v * 3 + 1] = h
        pos[v * 3 + 2] = z
        landColour(land, s, z, h, c)
        const shade = (0.93 + hash2(r * 3.1 + k, side + 7.7) * 0.12) * dim
        col[v * 3] = c.r * shade
        col[v * 3 + 1] = c.g * shade
        col[v * 3 + 2] = c.b * shade
      }
    }
  }
  const index: number[] = []
  for (let side = 0; side < 2; side++) {
    for (let r = 0; r < rows - 1; r++) {
      for (let k = 0; k < nc - 1; k++) {
        const a = (side * rows + r) * nc + k
        const b = a + nc
        // Wound so both sides face up (the left side's columns run the other way).
        if (side === 1) index.push(a, a + 1, b, b, a + 1, b + 1)
        else index.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
  }
  const hills = new THREE.BufferGeometry()
  hills.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  hills.setAttribute('color', new THREE.BufferAttribute(col, 3))
  hills.setIndex(index)
  hills.computeVertexNormals()

  /** The land's height as drawn (on its triangles), `d` metres out on one side. */
  function onLand(s: number, side: number, d: number): number {
    const u = Math.min(rows - 1.0001, Math.max(0, (s - from) / LAND.step))
    const r = Math.floor(u)
    let k = 0
    while (k < nc - 2 && cols[k + 1]! <= d) k++
    const fu = u - r
    const fv = Math.min(1, Math.max(0, (d - cols[k]!) / (cols[k + 1]! - cols[k]!)))
    const a = (side * rows + r) * nc + k
    const h00 = heights[a]!
    const h01 = heights[a + 1]!
    const h10 = heights[a + nc]!
    const h11 = heights[a + nc + 1]!
    // Each square is two triangles, split corner to corner.
    return fu + fv <= 1 ? h00 + fu * (h10 - h00) + fv * (h01 - h00) : h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11)
  }

  // --- The road strip: fine rows under the clip, coarser ones running off into the haze. ---
  const lanes = columns(land.halfTrack)
  const nl = lanes.length
  const profile = new Float32Array(nl)
  /** Heights across the road at `s`, into `profile`. Returns the ground the road is made of there. */
  function across(s: number): GroundId {
    const left = roadHeight(land.pieces, 'left', s)
    const right = roadHeight(land.pieces, 'right', s)
    const seamL = onLand(s, 0, LAND.seam)
    const seamR = onLand(s, 1, LAND.seam)
    for (let k = 0; k < nl; k++) {
      const { z, kind } = lanes[k]!
      let y: number
      switch (kind) {
        case 'left': y = left; break
        case 'right': y = right; break
        // A slight crown between the ruts, so the middle of the road isn't flat.
        case 'mid': y = (left + right) / 2 + 0.03; break
        case 'shoulder': y = (z < 0 ? left : right) * 0.4 + 0.02; break
        case 'ditch': y = -0.35 + hash2(Math.round(s * 2), k) * 0.08; break
        case 'verge': y = mix(-0.2, z < 0 ? seamL : seamR, 0.7) + hash2(Math.round(s), k) * 0.06; break
        default: y = z < 0 ? seamL : seamR
      }
      profile[k] = y
    }
    return pieceAt(land.pieces, s)?.profile.ground ?? 'graded'
  }

  const along: number[] = []
  for (let s = from; s < o.from - 1e-6; s += LAND.farStep) along.push(s)
  const fine = Math.max(1, Math.ceil((o.to - o.from) / o.step))
  for (let i = 0; i <= fine; i++) along.push(Math.min(o.to, o.from + i * o.step))
  for (let s = o.to + LAND.farStep; s <= to + 1e-6; s += LAND.farStep) along.push(s)
  const nr = along.length
  const spos = new Float32Array(nr * nl * 3)
  const scol = new Float32Array(nr * nl * 3)
  const verge = land.winter ? LAND_PAINT.snow : LAND_PAINT.grass
  const ditch = land.winter ? LAND_PAINT.snowShade : LAND_PAINT.moss
  const shoulder = land.winter ? LAND_PAINT.snow : ROAD_PAINT.graded
  for (let r = 0; r < nr; r++) {
    const s = along[r]!
    const ground = across(s)
    for (let k = 0; k < nl; k++) {
      const { z, kind } = lanes[k]!
      const n = hash2(Math.round(s * 2), k)
      const i = (r * nl + k) * 3
      spos[i] = s - o.origin
      spos[i + 1] = profile[k]!
      spos[i + 2] = z
      let shade = (0.9 + n * 0.16) * dim
      if (kind === 'seam') {
        // The same colour the land has here, so the join doesn't show.
        landColour(land, s, z, profile[k]!, c)
        shade = 0.99 * dim
      } else if (kind === 'verge') c.copy(verge)
      else if (kind === 'ditch') c.copy(ditch)
      else if (kind === 'shoulder') c.copy(shoulder)
      else {
        c.copy(ROAD_PAINT[ground])
        // Ruts are darker, and every patch varies a little so the eye can read the speed.
        if (kind !== 'mid') shade *= Math.abs(Math.abs(z) - land.halfTrack) < 0.01 ? 0.86 : 0.93
      }
      scol[i] = c.r * shade
      scol[i + 1] = c.g * shade
      scol[i + 2] = c.b * shade
    }
  }
  const sindex: number[] = []
  for (let r = 0; r < nr - 1; r++) {
    for (let k = 0; k < nl - 1; k++) {
      const a = r * nl + k
      const b = a + nl
      sindex.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const strip = new THREE.BufferGeometry()
  strip.setAttribute('position', new THREE.BufferAttribute(spos, 3))
  strip.setAttribute('color', new THREE.BufferAttribute(scol, 3))
  strip.setIndex(sindex)
  strip.computeVertexNormals()

  return {
    land,
    strip,
    hills,
    from,
    to,
    at(s, z) {
      const d = Math.abs(z)
      if (d >= LAND.seam) return onLand(s, z < 0 ? 0 : 1, d)
      across(s)
      let k = 0
      while (k < nl - 2 && lanes[k + 1]!.z <= z) k++
      const u = Math.min(1, Math.max(0, (z - lanes[k]!.z) / (lanes[k + 1]!.z - lanes[k]!.z)))
      return mix(profile[k]!, profile[k + 1]!, u)
    },
  }
}
