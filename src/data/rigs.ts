/**
 * Test loops that get faster every lap until something breaks (plan PR 2,
 * for the balance bot). These are first drafts of the shop's rigs; plan
 * PR 4 puts them on screen with live traces and the report.
 *
 * Each lap drives the same road (the loop doesn't change), at the lap's
 * speed times each piece's `pace`: slower through the rocks, flat out on the
 * graded bits. Heat and wear carry over from lap to lap. Speeds in m/s,
 * lengths in metres.
 *
 * The washboard ladder mixes in rough ground on purpose: washboard alone heats
 * dampers most at 20 to 40 km/h and less above that (see `docs/RIDE-SIM.md`),
 * so a loop of pure washboard wouldn't get hotter as it got faster.
 */
import type { GroundId } from './ground'

export type RigId = 'washboardLadder' | 'tortureLoop'

export interface RigPiece {
  ground: GroundId
  length: number
  /** Share of the lap speed driven here. */
  pace: number
}

export interface Rig {
  id: RigId
  pieces: readonly RigPiece[]
  /** First lap's speed (m/s). */
  startSpeed: number
  /** Added every lap (m/s). 5 km/h ≈ 1.39 m/s. */
  speedStep: number
  /** The run stops here if nothing has broken. */
  maxLaps: number
}

const KMH = 1 / 3.6

export const RIGS: Readonly<Record<RigId, Rig>> = {
  // Fade finder: long washboard plus whoops, 5 km/h faster each lap.
  washboardLadder: {
    id: 'washboardLadder',
    pieces: [
      { ground: 'washboard', length: 1200, pace: 1 },
      { ground: 'whoops', length: 600, pace: 0.8 },
    ],
    startSpeed: 40 * KMH,
    speedStep: 5 * KMH,
    maxLaps: 16,
  },
  // Breaker: whoops, a rock garden and a jump.
  tortureLoop: {
    id: 'tortureLoop',
    pieces: [
      { ground: 'whoops', length: 400, pace: 0.9 },
      { ground: 'rocks', length: 250, pace: 0.6 },
      { ground: 'graded', length: 150, pace: 1 },
      { ground: 'jumps', length: 350, pace: 1 },
    ],
    startSpeed: 30 * KMH,
    speedStep: 5 * KMH,
    maxLaps: 16,
  },
}
