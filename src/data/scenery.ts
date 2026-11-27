/**
 * The look of the land round the test track and the raid stages: Birchland's
 * boreal north. Only the show lives here (colours, how thick the forest is,
 * where things stand); none of it reaches the sim.
 *
 * The pieces themselves (trees, rocks, boards, the workshop) are made by
 * `scripts/blender/make-scenery.py` and named there; `src/render/scenery.ts`
 * plants them and `src/render/terrain.ts` shapes the ground they stand on.
 *
 * **Which side is which.** The cameras stand on the truck's left, so the
 * right of the road is the backdrop: forest climbing into hills. The left
 * stays low and open (a verge, heath, a lake now and then), with nothing
 * tall between the camera and the truck.
 */
import type { GroundId } from './ground'
import type { WeatherId } from './weather'

/** Ground worth a caution board before it, and how many marks the board carries (the roadbook's danger grades). */
export const CAUTION: Readonly<Partial<Record<GroundId, 1 | 2 | 3>>> = {
  washboard: 1,
  iceHeaves: 1,
  whoops: 2,
  jumps: 2,
  rocks: 3,
}

/** The shape of the land (metres). */
export const LAND = {
  /** Where the fine road strip hands over to the coarse land, from the road's centre. */
  seam: 7,
  /** Metres between the land's rows along the road. */
  step: 4,
  /** The land's columns each side, from the seam outwards. */
  columns: [7, 10, 14, 19, 26, 35, 48, 66, 90, 125, 170],
  /** How far past each end of the fine road the land and a coarser road carry on, so the road runs off into the haze. */
  reach: 120,
  /** Metres between the far road's rows. */
  farStep: 1.5,
  /** The lakes' water level (the road is at about 0). */
  water: -0.55,
} as const

/** Land colours (sRGB), summer and winter. */
export const LAND_COLOUR = {
  grass: 0x858a5e,
  moss: 0x65724e,
  heath: 0x86727c,
  forestFloor: 0x4f5846,
  sand: 0xb5a98a,
  rock: 0x8c8880,
  snow: 0xe9edf1,
  snowShade: 0xcbd6e0,
  water: 0x7f97a8,
  waterNight: 0x1b2634,
  ice: 0xc9d6e0,
} as const

/** How the sky looks over each kind of weather: the colour overhead (the horizon is the weather's own fog colour). */
export const SKY: Readonly<Record<WeatherId | 'clear', { zenith: number; zenithDark: number; open: boolean }>> = {
  // `open` skies show the far hills, the clouds, the sun, and at night the stars and the northern lights.
  clear: { zenith: 0x6fa0d4, zenithDark: 0x05070e, open: true },
  thaw: { zenith: 0xaab0b1, zenithDark: 0x13161b, open: false },
  whiteout: { zenith: 0xf2f4f5, zenithDark: 0x6d727a, open: false },
  dust: { zenith: 0xbfa27a, zenithDark: 0x4a3c2b, open: false },
}

/** Far hills: three rings round the horizon, nearest first. `haze` is how far each is tinted towards the sky (0 to 1). */
export const RIDGES = [
  { piece: 'Ridge_0', radius: 230, height: 230, colour: 0x4a5a4c, haze: 0.45 },
  { piece: 'Ridge_1', radius: 420, height: 400, colour: 0x5a6a68, haze: 0.68 },
  { piece: 'Ridge_2', radius: 700, height: 640, colour: 0x6f7f8c, haze: 0.84 },
] as const

/** One kind of thing scattered over the land. */
export interface Scatter {
  /** Kit pieces, each with how often it's picked. */
  pieces: readonly (readonly [string, number])[]
  side: 'left' | 'right' | 'both'
  /** From how far to how far from the road's centre (m). */
  near: number
  far: number
  /** The land is cut into squares this big (m), each with one chance of a piece. */
  cell: number
  /** That chance at `near`, and what it has dropped to at `far`. */
  chance: number
  chanceFar: number
  /** Smallest and largest size, as a multiple of the piece's own. */
  scale: readonly [number, number]
  /** Tall enough to hide the truck: kept out of the camera's side of the road, up to where the camera stands. */
  tall?: boolean
  /** Trees: thick in the forest, a few on the open ground. */
  wood?: boolean
  /** Only where the trees thin out (heath, lake shores). */
  open?: boolean
}

/** Summer: spruce and birch on the right, thinner on the left; fireweed and grass on the verges. */
export const SUMMER: readonly Scatter[] = [
  // The forest wall on the right: birches and young spruce at its edge, tall spruce and pine behind.
  { pieces: [['Birch_A', 3], ['Birch_B', 3], ['Birch_C', 0.5], ['Birch_Gold', 1], ['Spruce_Young', 3], ['Spruce_C', 2]], side: 'right', near: 8.5, far: 20, cell: 4.6, chance: 0.5, chanceFar: 0.62, scale: [0.75, 1.15], tall: true, wood: true },
  { pieces: [['Spruce_A', 4], ['Spruce_B', 4], ['Spruce_D', 3], ['Spruce_C', 2], ['Pine_A', 2], ['Pine_B', 1], ['Birch_B', 1], ['Snag', 0.5]], side: 'right', near: 20, far: 52, cell: 6.5, chance: 0.6, chanceFar: 0.46, scale: [0.85, 1.3], tall: true, wood: true },
  { pieces: [['Spruce_Far', 1]], side: 'right', near: 52, far: 130, cell: 10, chance: 0.62, chanceFar: 0.45, scale: [0.9, 1.5], tall: true, wood: true },
  // The left: scattered trees past the camera, thicker further off.
  { pieces: [['Spruce_A', 3], ['Spruce_B', 2], ['Spruce_C', 3], ['Birch_A', 2], ['Birch_C', 1], ['Pine_A', 1], ['Snag', 1]], side: 'left', near: 12, far: 60, cell: 8, chance: 0.3, chanceFar: 0.5, scale: [0.8, 1.25], tall: true, wood: true },
  { pieces: [['Spruce_Far', 1]], side: 'left', near: 60, far: 150, cell: 11, chance: 0.5, chanceFar: 0.42, scale: [0.9, 1.5], tall: true, wood: true },
  // Ground cover on both verges.
  // Low grass on both verges (low enough to see the wheels over); the taller flowers on the far side only.
  { pieces: [['Grass_A', 5], ['Grass_B', 4]], side: 'both', near: 3.9, far: 8, cell: 1.5, chance: 0.5, chanceFar: 0.45, scale: [0.8, 1.4] },
  { pieces: [['Fireweed', 4], ['Cotton', 1], ['Shrub_B', 2]], side: 'right', near: 4.4, far: 9, cell: 2.4, chance: 0.26, chanceFar: 0.3, scale: [0.8, 1.4] },
  { pieces: [['Grass_A', 4], ['Grass_B', 4], ['Heather', 3], ['Rock_C', 2]], side: 'both', near: 8, far: 24, cell: 2.8, chance: 0.45, chanceFar: 0.3, scale: [0.7, 1.3] },
  { pieces: [['Shrub_A', 3], ['Shrub_B', 3], ['Fireweed', 1], ['Rock_A', 1]], side: 'both', near: 8, far: 30, cell: 3.4, chance: 0.3, chanceFar: 0.22, scale: [0.8, 1.6], tall: true },
  { pieces: [['Rock_B', 3], ['Rock_D', 2], ['Boulder', 1], ['Stump', 2], ['Log', 1], ['Shrub_A', 2]], side: 'both', near: 6, far: 40, cell: 7, chance: 0.22, chanceFar: 0.16, scale: [0.8, 1.5], tall: true },
  { pieces: [['Reeds', 5], ['Cotton', 1], ['Grass_B', 2]], side: 'left', near: 14, far: 60, cell: 2.4, chance: 0.6, chanceFar: 0.6, scale: [0.9, 1.5], open: true, tall: true },
]

/** Winter: the same land under snow. Snowy spruce, bare birch, and only rocks and reeds showing through. */
export const WINTER: readonly Scatter[] = [
  { pieces: [['Birch_Bare', 5], ['Spruce_Snow_B', 3], ['Spruce_Snow_A', 1]], side: 'right', near: 8.5, far: 20, cell: 4.6, chance: 0.48, chanceFar: 0.6, scale: [0.7, 1.15], tall: true, wood: true },
  { pieces: [['Spruce_Snow_A', 5], ['Spruce_Snow_B', 4], ['Birch_Bare', 1], ['Snag', 0.5]], side: 'right', near: 20, far: 52, cell: 6.5, chance: 0.66, chanceFar: 0.5, scale: [0.9, 1.4], tall: true, wood: true },
  { pieces: [['Spruce_Snow_Far', 1]], side: 'right', near: 52, far: 130, cell: 10, chance: 0.62, chanceFar: 0.45, scale: [0.9, 1.5], tall: true, wood: true },
  { pieces: [['Spruce_Snow_A', 3], ['Spruce_Snow_B', 3], ['Birch_Bare', 3], ['Snag', 1]], side: 'left', near: 12, far: 60, cell: 8, chance: 0.3, chanceFar: 0.5, scale: [0.8, 1.25], tall: true, wood: true },
  { pieces: [['Spruce_Snow_Far', 1]], side: 'left', near: 60, far: 150, cell: 11, chance: 0.5, chanceFar: 0.42, scale: [0.9, 1.5], tall: true, wood: true },
  { pieces: [['Rock_B', 3], ['Rock_D', 2], ['Boulder', 1], ['Rock_A', 2]], side: 'both', near: 6, far: 40, cell: 7, chance: 0.18, chanceFar: 0.14, scale: [0.8, 1.5], tall: true },
  { pieces: [['Reeds', 1]], side: 'right', near: 3.9, far: 9, cell: 2.4, chance: 0.2, chanceFar: 0.12, scale: [0.8, 1.2] },
  { pieces: [['Reeds', 1]], side: 'left', near: 14, far: 60, cell: 3, chance: 0.4, chanceFar: 0.4, scale: [0.9, 1.4], open: true, tall: true },
]

/** Things along the roadside (metres along the road between them, and how far out). */
export const ROADSIDE = {
  /** Marker posts, on the far side of the road (on the near side they'd pass in front of the wheels). */
  postEvery: 50,
  /** Caution boards stand this far before the rough ground starts. */
  boardBefore: 28,
  /** Power poles down the right, and how far a line of them runs before a gap (it comes and goes). */
  poleEvery: 46,
  poleOut: 13.5,
  /** A dry-stone wall along the right in places, in lengths of this many metres. */
  wallOut: 8.2,
  wallLength: 4,
  /** Walls are a lot of stones: only at this share of the scenery or more (Full and Ultra). */
  wallCover: 0.8,
  /** A stone bothy somewhere on the right about this often (m). */
  bothyEvery: 520,
} as const

/** The test loop's start line (rigs only): where things stand, in metres past the start of the lap. */
export const START_LINE = {
  arch: 8,
  /** Pink pennants down the right-hand verge after the arch: how many and how far apart. */
  pennants: 6,
  pennantEvery: 7,
} as const

/** The shaker rig stands this far above the workshop floor, on its four posts (m). */
export const SHAKER_FLOOR = -0.6
