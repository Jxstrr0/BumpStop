/**
 * Damage you can see (Kelbo, 27 November 2026): mud, dust and snow building
 * up on the truck over a raid, stone chips on the paint, and dents where
 * things went wrong. It's only a look: none of it changes the sim.
 *
 * What builds up comes from what the raid really did (`src/sim/grime.ts`):
 *
 * - **Ground.** Every kilometre driven adds a little: dry summer gravel
 *   throws dust, rough ground and whoops throw mud, snow and frost heaves
 *   pack snow into the arches. A share of 1 is a truck you can hardly see
 *   the paint on.
 * - **Pace.** Push throws more of everything, Conserve less.
 * - **Weather.** A thaw turns the road to mud, a dust storm coats the truck,
 *   and a whiteout plasters it in snow (only on the ground the weather
 *   changes, from where it turned).
 * - **The bivouac.** Overnight the crew knocks off the worst of the mud and
 *   the snow melts; the dust stays in the seams. A rest day washes more. A
 *   new raid starts with a clean truck.
 * - **Dents.** Sliding into a snowbank dents the nose, a corner that broke
 *   knocks its wheel arch about, and a rock that got past the guards dents
 *   the oil pan, diff or fuel tank (until the crew patches it). Rocks the
 *   guards took chip the paint low down. Body dents stay for the raid: there
 *   is no panel-beating at a bivouac.
 *
 * Each share is worked out as 1 - e^(-load), so it rises quickly at first
 * and then slows, and never passes 1.
 */
import type { ClassId } from './classes'
import type { GroundId } from './ground'
import type { PaceId, Season } from './raids'
import type { WeatherId } from './weather'
import type { FailureKind } from './wear'

/** What builds up: mud, dust, snow and stone chips. */
export type GrimeKind = 'mud' | 'dust' | 'snow' | 'chips'

type PerKm = Readonly<Partial<Record<GrimeKind, number>>>

export const GRIME = {
  /** Load per km at Steady on each ground, by season. */
  perKm: {
    summer: {
      graded: { dust: 0.006, mud: 0.001 },
      washboard: { dust: 0.006, mud: 0.001 },
      rough: { dust: 0.005, mud: 0.003, chips: 0.002 },
      whoops: { dust: 0.005, mud: 0.004, chips: 0.001 },
      rocks: { dust: 0.004, mud: 0.001, chips: 0.004 },
      jumps: { dust: 0.005, mud: 0.003, chips: 0.001 },
      // Summer raids don't run on these, but a table needs every ground.
      iceHeaves: { mud: 0.002 },
      ice: { mud: 0.001 },
      snow: { mud: 0.002 },
    },
    winter: {
      // Frozen gravel: no dust, a grey slush in the ruts.
      graded: { mud: 0.0015 },
      washboard: { mud: 0.0015 },
      rough: { mud: 0.002, chips: 0.002 },
      whoops: { mud: 0.002, chips: 0.001 },
      rocks: { mud: 0.001, chips: 0.004 },
      jumps: { mud: 0.002, chips: 0.001 },
      iceHeaves: { snow: 0.008, mud: 0.001, chips: 0.001 },
      ice: { snow: 0.003 },
      snow: { snow: 0.01, mud: 0.001 },
    },
  } as Readonly<Record<Season, Readonly<Record<GroundId, PerKm>>>>,
  /** Times the load at each pace call. Chips follow the stones thrown up, so they climb faster at Push. */
  pace: {
    conserve: { mud: 0.8, dust: 0.8, snow: 0.8, chips: 0.6 },
    steady: { mud: 1, dust: 1, snow: 1, chips: 1 },
    push: { mud: 1.35, dust: 1.3, snow: 1.35, chips: 1.8 },
  } as Readonly<Record<PaceId, Readonly<Record<GrimeKind, number>>>>,
  /**
   * Weather, on the ground it changes from where it turned: extra load per
   * km, and what's left of the clear-day dust (a thaw is wet, so no dust).
   */
  weather: {
    thaw: { add: { mud: 0.025 }, dust: 0 },
    dust: { add: { dust: 0.02 }, dust: 1 },
    whiteout: { add: { snow: 0.03 }, dust: 1 },
  } as Readonly<Record<WeatherId, { add: PerKm; dust: number }>>,
  /** Share of each that's still on the truck the next morning, after a normal night and after the rest day. */
  overnight: { mud: 0.6, dust: 0.5, snow: 0.15, chips: 1 } as Readonly<Record<GrimeKind, number>>,
  restDay: { mud: 0.2, dust: 0.15, snow: 0, chips: 1 } as Readonly<Record<GrimeKind, number>>,
  /** Extra load for each stop of a kind: digging out of a snowbank packs snow in; a cracked ice road splashes slush. */
  stops: { slide: { snow: 0.5 }, ice: { snow: 0.25, mud: 0.2 } } as Readonly<Record<'slide' | 'ice', PerKm>>,
  /** Extra load for each time the truck bogged down (recovery kit): wheels spun in deep mud in summer, snow packed in in winter. */
  bogged: { summer: { mud: 0.5 }, winter: { snow: 0.5 } } as Readonly<Record<Season, PerKm>>,
  /** Chips load for each rock the guards took. */
  guardHitChips: 0.05,
  /**
   * Dents: how deep each looks (0 to 1). A second knock in the same place
   * adds `again` of the first, up to 1.
   */
  dents: { slide: 0.9, corner: 0.6, again: 0.5 },
  /**
   * Breaks at a corner that knock the wheel arch about: a bottomed-out
   * corner slams the tire into the arch, a torn mount drops it there, a
   * snapped axle or a cut tire flails against it. A faded damper doesn't.
   */
  archKinds: ['bottoming', 'mount', 'axle', 'tire'] as readonly FailureKind[],
  /** An underside dent smaller than this isn't drawn (the crew's patch leaves a little). */
  underMin: 0.05,
  /** Most dents drawn at once (the shader has room for this many). */
  maxDents: 6,
} as const

// ── The look (src/render/grime.ts) ──

/**
 * Colours, as the eye sees them in daylight. Summer mud is the brown of wet
 * gravel; winter grime is the grey of slush; dust is pale and sandy.
 */
export const GRIME_LOOK = {
  mud: { summer: '#4D3B2A', winter: '#4F4C48' },
  /** Fresh mud on a thaw is darker and shines. */
  wetMud: '#33271C',
  dust: '#B9A27E',
  snow: '#F4F7FA',
  /** Grey primer where stones chipped the paint, and scraped, dull metal in a dent. */
  chip: '#9A9C98',
  scrape: '#5F5C57',
  /** Roughness of each (0 shiny to 1 flat). */
  rough: { mud: 0.85, wetMud: 0.3, dust: 0.95, snow: 0.55, chip: 0.6, scrape: 0.5 },
  /** At most this much of the paint is hidden under dust, however dusty (it's a film, not a crust). */
  dustMax: 0.75,
  /** Dent depth at full (m): exaggerated a little so a dent reads on a phone. */
  dentDepth: 0.12,
} as const

/**
 * Where the dents go on each truck, in tire radii (r) from the place named:
 * the nose and each wheel arch are worked out from the wheels, so they fit
 * any truck. Under the truck, `x` is a share of the wheelbase from the rear
 * axle (1 is the front axle, more is ahead of it), and `y` is the height.
 */
export const DENT_PLACES: Readonly<Record<ClassId, Readonly<Record<'sump' | 'diff' | 'tank', { x: number; y: number }>>>> = {
  // The pickup: the sump ahead of the front axle, the rear diff, the tank behind the rear axle.
  light4x4: { sump: { x: 1.12, y: 1.05 }, diff: { x: 0, y: 0.9 }, tank: { x: -0.3, y: 1.1 } },
  // The cabover: the sump ahead of the front axle, the rear diff, the tanks slung between the wheels.
  heavy: { sump: { x: 1.08, y: 1.05 }, diff: { x: 0, y: 0.85 }, tank: { x: 0.45, y: 1.1 } },
  // The buggy: the engine sits behind the seats, the tank under them.
  sxs: { sump: { x: 0.12, y: 1.0 }, diff: { x: 0, y: 0.9 }, tank: { x: 0.5, y: 0.9 } },
}
