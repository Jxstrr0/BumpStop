/**
 * The 12 km test stage on the preview screen (plan PR 1), so the ride sim
 * can be tried on a phone before the rigs arrive in plan PR 4. Lengths in
 * metres, speeds in m/s (25 m/s = 90 km/h).
 */
import type { GroundId } from './ground'

export interface PreviewSegment {
  ground: GroundId
  length: number
  speed: number
}

export const PREVIEW_STAGE: readonly PreviewSegment[] = [
  { ground: 'graded', length: 3000, speed: 25 },
  { ground: 'washboard', length: 3000, speed: 19.5 },
  { ground: 'rocks', length: 2000, speed: 12.5 },
  { ground: 'whoops', length: 1500, speed: 14 },
  { ground: 'jumps', length: 2500, speed: 16.5 },
]

/** The long stage behind the "Run a 300 km stage" button: the same mix, 25 times over. */
export const PREVIEW_LONG_REPEATS = 25

/** Seconds between points on the preview trace. */
export const PREVIEW_TRACE_SECONDS = 0.5
