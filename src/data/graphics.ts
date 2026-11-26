/**
 * The three graphics tiers (plan PR 12): Lite, Full and Ultra. Every 3D
 * view (the garage, the test track, the raid highlights) reads its numbers
 * from here. `src/render/tiers.ts` picks the tier and steps it down on a
 * slow phone.
 *
 * Full is how the game has always looked. The trucks are 35,000 to 50,000
 * triangles each since the Blender pass (PR 5c), so the biggest saving on a
 * slow phone is not drawing them twice: Lite turns the sun's shadow off,
 * which skips the whole shadow pass, and draws at one pixel per CSS pixel.
 */

export type TierId = 'lite' | 'full' | 'ultra'
export type GraphicsChoice = 'auto' | TierId

/** Slowest first, so stepping down is one place back in the list. */
export const TIER_IDS: readonly TierId[] = ['lite', 'full', 'ultra']

export interface TierSettings {
  /** Most pixels drawn per CSS pixel (phones are 2 to 3). */
  pixelRatioCap: number
  /** Smooth edges. Fixed when a 3D view is made, so a change shows after a reload. */
  antialias: boolean
  /** The sun casts the truck's shadow. */
  shadows: boolean
  /** Shadow map size (pixels a side). */
  shadowMap: number
  /** How far the shadow's edge is blurred (shadow map pixels; more costs more). */
  shadowBlur: number
  /** Rows of trees each side of the road (up to MAX_TREE_ROWS). */
  treeRows: number
  /** Share of the dust the wheels throw up. */
  dust: number
  /** Metres between rows of the road strip (finer shows small washboard better). */
  roadStep: number
}

export const TIERS: Record<TierId, TierSettings> = {
  lite: { pixelRatioCap: 1, antialias: false, shadows: false, shadowMap: 512, shadowBlur: 1, treeRows: 1, dust: 0.4, roadStep: 0.15 },
  full: { pixelRatioCap: 2, antialias: true, shadows: true, shadowMap: 1024, shadowBlur: 1, treeRows: 3, dust: 1, roadStep: 0.1 },
  ultra: { pixelRatioCap: 3, antialias: true, shadows: true, shadowMap: 2048, shadowBlur: 3, treeRows: 4, dust: 1.4, roadStep: 0.07 },
}

/** The forest is made with room for this many rows. */
export const MAX_TREE_ROWS = 4

/** Auto's frame-rate watcher (see TierGovernor in src/render/tiers.ts). */
export const AUTO_TIER = {
  /**
   * Step down when the median frame rate over a window is under this. Above
   * 30 on purpose: under about 45 a 60 Hz phone visibly judders, and a lower
   * tier is the better trade (Lombard learned the same).
   */
  minFps: 45,
  /** Seconds to wait after a view starts drawing (shader compiles, model unzips). */
  warmupS: 2,
  /** Length of one measuring window (s of drawing). */
  windowS: 4,
  /** A frame longer than this is a tab switch or a stall, not the frame rate (s). */
  stallS: 0.5,
} as const

/** Photo mode (plan PR 12): how high the camera may go (radians above the ground). */
export const PHOTO_LIFT = { min: 0.03, max: 1.35 } as const
/** Photo mode: how close and how far, as a share of the distance it opened at. */
export const PHOTO_ZOOM = { min: 0.35, max: 2.5 } as const
