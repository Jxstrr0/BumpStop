/**
 * Night stages (Kelbo, 27 November 2026): what the truck's lamps let the
 * driver do in the dark. The numbers and the reasoning are in
 * `src/data/night.ts`; the raid sim (`raid.ts`) uses these.
 *
 * Math.sqrt is exact in every browser (IEEE 754 requires it), so the sim may
 * use it; the det.ts versions are only for sin, exp and friends.
 */
import { GROUND, type GroundId } from '../data/ground'
import { HEADLAMPS, NIGHT, RUTS_PER_KM } from '../data/night'
import type { LightPart } from '../data/parts'
import type { RaidStage } from '../data/raids'
import { SIM } from '../data/ride'

/** The truck's lamps, all together. */
export interface Beam {
  /** The furthest anything fitted lights well enough to brake for (m). */
  reach: number
  /** The widest share of the road and corners anything fitted lights (0 to 1). */
  spread: number
  /** Electric power they draw at night (W). */
  draw: number
}

/** The headlamps plus a light bar and spots (either may be "none"). */
export function beamOf(bar: LightPart, spots: LightPart): Beam {
  return {
    reach: Math.max(HEADLAMPS.reach, bar.reach, spots.reach),
    spread: Math.max(HEADLAMPS.spread, bar.spread, spots.spread),
    draw: bar.draw + spots.draw,
  }
}

/** Hardest the truck can brake here (m/s²): the tire grip (studs or not, and any weather) times gravity times `brakeShare`. */
export function braking(ground: GroundId, studded: boolean, gripMod = 1): number {
  const g = GROUND[ground]
  return (studded ? g.studGrip : g.grip) * gripMod * SIM.gravity * NIGHT.brakeShare
}

/** Metres to stop from `speed` (m/s): the reaction, then braking. */
export function stopDistance(speed: number, brake: number): number {
  return speed * NIGHT.reaction + (speed * speed) / (2 * brake)
}

/** The fastest the truck can go and still stop inside `reach` metres (m/s): `stopDistance` solved for speed. */
export function sightSpeed(reach: number, brake: number): number {
  const t = NIGHT.reaction
  return brake * (Math.sqrt(t * t + (2 * reach) / brake) - t)
}

/**
 * Share of the ruts the driver doesn't see in time, at `speed`: the ones
 * outside the beam's spread, and of the rest, the ones the truck is going
 * too fast to stop for.
 */
export function unseenShare(beam: Beam, speed: number, brake: number): number {
  const inTime = Math.min(1, beam.reach / stopDistance(speed, brake))
  return 1 - beam.spread * inTime
}

/** Unseen ruts per km on this ground at this share unseen. */
export function unseenRuts(ground: GroundId, unseen: number): number {
  return RUTS_PER_KM[ground] * unseen
}

/** Where it gets dark on a stage (m from the start), or null if the stage finishes in daylight. */
export function darkFrom(stage: RaidStage): number | null {
  if (stage.dark === undefined) return null
  const total = stage.segments.reduce((sum, s) => sum + s.km, 0) * 1000
  return Math.max(0, Math.min(1, stage.dark)) * total
}

/** Whether it's dark `at` metres into the stage. */
export function darkAt(dark: number | null, at: number): boolean {
  return dark !== null && at >= dark
}
