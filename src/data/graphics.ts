/**
 * The three graphics tiers (plan PR 12): Lite, Full and Ultra. Every 3D
 * view (the garage, the test track, the raid highlights) reads its numbers
 * from here. `src/render/tiers.ts` picks the tier and steps it down on a
 * slow phone.
 *
 * Full is how the game is meant to look. Since the HD pass a stock truck
 * shows 50,000 to 65,000 triangles (the lite models about 30,000), so the
 * biggest savings on a slow phone are not drawing it twice and drawing
 * less of it: Lite turns the sun's shadow off, which skips the whole shadow
 * pass, loads the lite truck models, and draws at one pixel per CSS pixel.
 */

export type TierId = 'lite' | 'full' | 'ultra'
export type GraphicsChoice = 'auto' | TierId

/** Slowest first, so stepping down is one place back in the list. */
export const TIER_IDS: readonly TierId[] = ['lite', 'full', 'ultra']

export interface TierSettings {
  /** Most pixels drawn per CSS pixel (phones are 2 to 3). */
  pixelRatioCap: number
  /**
   * Most pixels the test track draws in all. It only bites on a big canvas
   * (the test track full page on a computer); a phone screen fits under it.
   */
  maxPixels: number
  /** Smooth edges. Fixed when a 3D view is made, so a change shows after a reload. */
  antialias: boolean
  /** The sun casts the truck's shadow. */
  shadows: boolean
  /** Shadow map size (pixels a side). */
  shadowMap: number
  /** How far the shadow's edge is blurred (shadow map pixels; more costs more). */
  shadowBlur: number
  /** Share of the scenery planted round the road: trees, rocks, grass (1 is the whole table in `src/data/scenery.ts`). */
  cover: number
  /** Share of the dust the wheels throw up. */
  dust: number
  /** Metres between rows of the road strip (finer shows small washboard better). */
  roadStep: number
  /**
   * Load the lighter truck models (`truck-<class>-lite.glb.gz`: the same parts
   * with fewer triangles) in place of the full ones. A truck already on screen
   * keeps the model it has; the next truck loaded follows the tier.
   */
  liteModels: boolean
  /**
   * Damage you can see in full: stone chips, dents that catch the light and
   * a finer mud pattern. Off, the grime is a simpler version (one layer of
   * pattern, dents as scraped paint only).
   */
  grimeDetail: boolean
}

export const TIERS: Record<TierId, TierSettings> = {
  lite: { pixelRatioCap: 1, maxPixels: 1_500_000, antialias: false, shadows: false, shadowMap: 512, shadowBlur: 1, cover: 0.3, dust: 0.4, roadStep: 0.15, liteModels: true, grimeDetail: false },
  full: { pixelRatioCap: 2, maxPixels: 2_500_000, antialias: true, shadows: true, shadowMap: 1024, shadowBlur: 1, cover: 0.85, dust: 1, roadStep: 0.1, liteModels: false, grimeDetail: true },
  ultra: { pixelRatioCap: 3, maxPixels: 4_500_000, antialias: true, shadows: true, shadowMap: 2048, shadowBlur: 3, cover: 1.3, dust: 1.4, roadStep: 0.07, liteModels: false, grimeDetail: true },
}

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

/**
 * The test track's lens (see `src/render/framing.ts`). The shots were framed
 * for a 16:10 picture at 40 degrees top to bottom. On a taller canvas (the
 * test track full page on a phone held upright) the lens opens up to keep
 * the picture as wide, but never past `maxFov`, where the sky and the near
 * ground would start to look stretched.
 */
export const TRACK_CAMERA = { fov: 40, designAspect: 16 / 10, maxFov: 72 } as const

/** Photo mode (plan PR 12): how high the camera may go (radians above the ground). */
export const PHOTO_LIFT = { min: 0.03, max: 1.35 } as const
/** Photo mode: how close and how far, as a share of the distance it opened at. */
export const PHOTO_ZOOM = { min: 0.35, max: 2.5 } as const
