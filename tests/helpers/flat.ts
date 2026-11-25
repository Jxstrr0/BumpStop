import { SIM } from '../../src/data/ride'
import type { Profile } from '../../src/sim/ground'

/** Perfectly flat road, for tests that need nothing pushing the wheels. */
export function flatRoad(length = 200): Profile {
  const n = Math.floor(length / SIM.profileStep) + 1
  return { ground: 'graded', step: SIM.profileStep, length: (n - 1) * SIM.profileStep, left: new Float64Array(n), right: new Float64Array(n) }
}
