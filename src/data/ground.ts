/**
 * Ground recipes for the ride sim (plan PR 1). Each recipe says how to build
 * a road profile from a seed: the same recipe and seed always make the same
 * road. Heights and lengths are in metres.
 *
 * Every recipe has a base layer of gentle random roughness (`roughness`, the
 * typical height of the ripples, and `roughnessLength`, how long they are),
 * then its own features on top. `[min, max]` pairs are ranges the seed picks
 * from.
 *
 * `trackLink` is how alike the left and right wheel tracks are: 1 means the
 * same bumps under both sides, 0 means each side is on its own.
 */

export type GroundId = 'graded' | 'washboard' | 'whoops' | 'rocks' | 'jumps' | 'iceHeaves'

export type Range = readonly [number, number]

export interface GroundRecipe {
  id: GroundId
  /** Typical height of the base roughness (m, RMS). */
  roughness: number
  /** Typical length of the base roughness ripples (m). */
  roughnessLength: number
  /** How alike the left and right tracks' roughness is (0 to 1). */
  trackLink: number
  /**
   * How much of it a long stage drives in full detail per chunk (m). Ground
   * with rare, big features (jumps) needs a longer look to get a fair share
   * of them; even ground needs only a short one. See LONG_STAGE in ride.ts.
   */
  sampleLength: number
  /** Washboard corrugations across the whole road. */
  washboard?: {
    /** Crest to crest (m). */
    wavelength: Range
    /** Half the crest-to-trough height (m). */
    amplitude: Range
    /** How far the wavelength wanders along the road (fraction). */
    wander: number
    /** Typical stretch over which the wavelength wanders (m). */
    wanderLength: number
    /** How much the depth varies along the road (fraction). */
    depthWobble: number
    /** Typical stretch over which the depth varies (m). */
    depthLength: number
  }
  /** Long rollers in sets. */
  whoops?: {
    /** One whoop, crest to crest (m). */
    length: Range
    height: Range
    /** Whoops in one set. */
    perSet: Range
    /** Flat road between sets (m). */
    gap: Range
    /** How far the right track's whoop can sit ahead of or behind the left's (m). */
    stagger: number
  }
  /** Single rocks under one wheel track or both. */
  rocks?: {
    /** Rocks per 100 m. */
    per100m: number
    length: Range
    height: Range
    /** Share of rocks that sit across both tracks. */
    bothTracks: number
  }
  /** Crests that throw the truck in the air. */
  jumps?: {
    /** Distance between jumps (m). */
    spacing: Range
    /** Run-up face (m). */
    runUp: Range
    /** Lip height (m). */
    height: Range
    /** Flat top after the lip (m). */
    top: Range
    /** The drop on the far side (m). Short drop = the truck flies. */
    drop: Range
  }
  /** Frost heaves: broad lumps, often with a crack edge on the far side. */
  heaves?: {
    per100m: number
    length: Range
    height: Range
    /** Step down at the crack (m). */
    crack: Range
    /** Where the crack sits, as a share of the way over the heave. */
    crackAt: number
    /** Share of heaves under one track only, which rocks the truck. */
    oneTrack: number
  }
}

export const GROUND: Readonly<Record<GroundId, GroundRecipe>> = {
  // A freshly graded logging road: the baseline.
  graded: { id: 'graded', roughness: 0.015, roughnessLength: 3, trackLink: 0.6, sampleLength: 300 },

  washboard: {
    id: 'washboard',
    sampleLength: 300,
    roughness: 0.02,
    roughnessLength: 2.5,
    trackLink: 0.6,
    washboard: { wavelength: [0.55, 1.1], amplitude: [0.01, 0.025],
      wander: 0.12,
      wanderLength: 40,
      depthWobble: 0.3,
      depthLength: 25,
    },
  },

  whoops: {
    id: 'whoops',
    sampleLength: 600,
    roughness: 0.01,
    roughnessLength: 2,
    trackLink: 0.6,
    whoops: { length: [5, 10], height: [0.12, 0.3], perSet: [4, 10], gap: [20, 60], stagger: 0.2 },
  },

  rocks: {
    id: 'rocks',
    sampleLength: 400,
    roughness: 0.012,
    roughnessLength: 1.5,
    trackLink: 0.4,
    rocks: { per100m: 10, length: [0.2, 0.7], height: [0.03, 0.16], bothTracks: 0.2 },
  },

  jumps: {
    id: 'jumps',
    sampleLength: 1000,
    roughness: 0.008,
    roughnessLength: 2.5,
    trackLink: 0.6,
    jumps: { spacing: [120, 300], runUp: [7, 12], height: [0.5, 1.1], top: [2, 6], drop: [2.5, 5] },
  },

  // Winter ground. Cold oil and ice cracking come in plan PR 10; the shape of the road is here now.
  iceHeaves: {
    id: 'iceHeaves',
    sampleLength: 600,
    roughness: 0.005,
    roughnessLength: 3,
    trackLink: 0.7,
    heaves: { per100m: 3, length: [3, 9], height: [0.06, 0.22], crack: [0.015, 0.05], crackAt: 0.6, oneTrack: 0.4 },
  },
}

export const GROUND_IDS: readonly GroundId[] = ['graded', 'washboard', 'whoops', 'rocks', 'jumps', 'iceHeaves']
