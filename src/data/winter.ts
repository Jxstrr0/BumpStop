/**
 * Winter (plan PR 10): the numbers for lake ice. Cold oil lives with the
 * rest of the oil in `DAMPER_OIL` (`src/data/ride.ts`), and grip on each
 * winter ground in `src/data/ground.ts`.
 *
 * How the ice holds a truck up (`src/sim/ice.ts`):
 *
 * - **Thickness.** Ice carries a load that grows with its thickness
 *   squared (Gold's rule, which real ice-road crews use). `bearing` is the
 *   weight where the first cracks open, for each square metre of thickness
 *   squared: 70,000 kg per m² means 45 cm of good ice holds about 14 t.
 * - **The wave.** A truck pushes a slow wave through the water under the
 *   ice. Near the wave's own speed (`IceSheet.waveKmh`, set by how deep the
 *   lake is) the truck rides the wave it makes, and the ice bends as if the
 *   truck were up to about half as heavy again. That's why ice roads have
 *   speed limits. It works like any resonance, with `waveDamping` for how
 *   sharp the peak is; past the peak it stays at the peak (a truck can't
 *   jump past the wave without first riding it).
 * - **Reading it.** The load against what the ice holds, 0 to 1 and over:
 *   below `warnFrom` the ice is quiet, from there to 1 it booms and creaks,
 *   and at 1 it cracks under the truck. Nobody goes through: the crew backs
 *   off onto thick ice and takes the shore track (plan PR 10b).
 */

/** One stretch of lake ice: how thick it is at its thinnest, and how fast the wave under it runs. */
export interface IceSheet {
  /** Ice thickness at the thinnest place on the stretch (m). */
  thickness: number
  /** Speed of the wave under the ice (m/s): about 20 to 50 km/h on the lakes, slower where the lake is shallow. */
  waveSpeed: number
}

export const ICE = {
  /** kg the ice holds before it cracks, per m² of thickness squared (Gold's rule). */
  bearing: 70000,
  /** How sharp the wave's peak is (a damping ratio): 0.35 makes the worst case about 1.5 times the weight. */
  waveDamping: 0.35,
  /** The ice starts to boom and creak at this share of what it holds. */
  warnFrom: 0.85,
} as const
