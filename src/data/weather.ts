/**
 * Weather that changes mid-stage (Kelbo, 26 November 2026). Every tuning
 * number for it lives here; `src/sim/weather.ts` and the raid sim use them.
 *
 * Some mornings the roadbook carries a forecast: a thaw, a whiteout or a
 * dust storm, how likely it is, and where on the stage it may come in. On
 * the day it either comes or holds off (a seeded roll, the same every time
 * for the same raid). From the place it turns to the finish:
 *
 * - **Thaw** (cool summer stages): the gravel goes soft. Long, soft ruts
 *   (more base roughness, much longer ripples) work the springs through
 *   their travel instead of the dampers through quick hits, so the oil runs
 *   cool; the tires grip less; the driver slows down, the heavy truck most
 *   of all (it sinks). It costs time more than parts, so it can be the day
 *   to call Push. Rock is rock: it doesn't soften.
 * - **Whiteout** (winter stages): blowing snow, and the driver can hardly
 *   see. Slower everywhere, drifts and frost heaves that come unseen (the
 *   bumps hit as if bigger), a colder wind, and the tightest corner comes up
 *   before the driver sees it: Push slides into the snowbank, studs or not.
 * - **Dust storm** (hot summer stages): the driver can't see the ruts and
 *   rocks to pick a line round them, so every bump hits square (as if
 *   bigger), and a hot wind means the dampers have less room before fade.
 *   Slower, but harder on the truck: Steady on a rough stage can fade a
 *   stock truck's dampers, so it's the day for Conserve or bigger shocks.
 *
 * The weather changes the ground the ride sim drives (`GroundMod`), so heat,
 * wear and breaks still come out of the physics. The rivals slow down by
 * the same amount and get into a little more trouble.
 */
import type { ClassId } from './classes'
import type { GroundId } from './ground'
import type { Season } from './raids'

export type WeatherId = 'thaw' | 'whiteout' | 'dust'
export const WEATHER_IDS: readonly WeatherId[] = ['thaw', 'whiteout', 'dust']

/** How weather changes a piece of ground in the ride sim (`buildProfile`). Every number is a multiplier; 1 changes nothing. */
export interface GroundMod {
  /** The base roughness's typical height. */
  roughness: number
  /** The base roughness's ripple length (longer is slower, softer ruts). */
  roughnessLength: number
  /** The height of every feature on top: washboard, whoops, rocks, jumps and heaves. */
  features: number
  /** Tire grip. */
  grip: number
}

export interface WeatherSpec {
  id: WeatherId
  /** The season it comes in. */
  season: Season
  /** The stage's morning air (°C) it can come at: from, to. */
  airC: readonly [number, number]
  /** The ground it changes. Other ground only feels the air. */
  ground: readonly GroundId[]
  mod: GroundMod
  /** The driver slows to this share of the speed on that ground, by class. */
  speed: Readonly<Record<ClassId, number>>
  /** The air changes by this much once it turns (K). */
  airK: number
  /**
   * The tightest corner on winter ground comes up unseen: the speed it can
   * be taken at is this share of the clear-day speed (1 for no change).
   */
  corner: number
  /** The rivals' chance of trouble on the stage, times this (scaled by how much of the stage it covers). */
  rivalRisk: number
}

const SUMMER: readonly GroundId[] = ['graded', 'washboard', 'rough', 'whoops', 'rocks', 'jumps']
const EVERYWHERE: readonly GroundId[] = [...SUMMER, 'iceHeaves', 'ice', 'snow']

export const WEATHER: Readonly<Record<WeatherId, WeatherSpec>> = {
  thaw: {
    id: 'thaw',
    season: 'summer',
    airC: [-99, 20],
    // Dirt and gravel soften; rock doesn't.
    ground: ['graded', 'washboard', 'rough', 'whoops', 'jumps'],
    mod: { roughness: 2.2, roughnessLength: 2.5, features: 1, grip: 0.7 },
    speed: { light4x4: 0.85, heavy: 0.8, sxs: 0.88 },
    airK: -4,
    corner: 1,
    rivalRisk: 1.3,
  },
  whiteout: {
    id: 'whiteout',
    season: 'winter',
    airC: [-99, 99],
    ground: EVERYWHERE,
    mod: { roughness: 1.3, roughnessLength: 1, features: 1.2, grip: 1 },
    speed: { light4x4: 0.75, heavy: 0.75, sxs: 0.75 },
    airK: -6,
    // Steady (75% of the clear-day speed) just makes it; Push doesn't, even on studs.
    corner: 0.72,
    rivalRisk: 1.4,
  },
  dust: {
    id: 'dust',
    season: 'summer',
    airC: [19, 99],
    ground: SUMMER,
    mod: { roughness: 1.2, roughnessLength: 1, features: 1.3, grip: 1 },
    speed: { light4x4: 0.8, heavy: 0.8, sxs: 0.8 },
    airK: 5,
    corner: 1,
    rivalRisk: 1.4,
  },
}

/** Clear weather: no change to the ground. */
export const CLEAR: GroundMod = { roughness: 1, roughnessLength: 1, features: 1, grip: 1 }

/** How often weather comes, and where (shares of the stage's length). */
export const WEATHER_ROLL = {
  /** Chance a stage's morning has weather in the forecast at all. */
  forecast: 0.45,
  /** The forecast's chance it really comes: one of these, picked evenly. */
  chances: [0.3, 0.6, 0.85],
  /** It turns somewhere between these shares of the stage. */
  from: 0.25,
  to: 0.8,
  /** The forecast gives a window this wide (share of the stage) with the real place somewhere in it. */
  window: 0.2,
  /**
   * The forecast firms up at each checkpoint (Kelbo's playtest, 26 November
   * 2026): the chance moves this share of the way towards what will really
   * happen once the truck is inside the window, and `ahead` times that while
   * the window is still to come.
   */
  update: { inside: 0.7, ahead: 0.5 },
} as const

/** The forecast's words for its chance: below 0.5 possible, below 0.8 likely, else expected. */
export const FORECAST_WORDS = [
  { below: 0.5, word: 'possible' },
  { below: 0.8, word: 'likely' },
  { below: 2, word: 'expected' },
] as const

/** How the 3D highlight looks in each weather: fog colour (light, dark) and how near it closes in (m). */
export const WEATHER_LOOK: Readonly<Record<WeatherId | 'clear', { light: number; dark: number; near: number; far: number }>> = {
  clear: { light: 0xdfe4e3, dark: 0x151922, near: 55, far: 260 },
  thaw: { light: 0xc9cdcb, dark: 0x1d2126, near: 25, far: 100 },
  whiteout: { light: 0xf2f4f5, dark: 0x6d727a, near: 4, far: 38 },
  dust: { light: 0xcdb48c, dark: 0x5a4a35, near: 6, far: 48 },
}
