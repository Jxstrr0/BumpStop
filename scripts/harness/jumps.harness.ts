/**
 * The jump ramp (v1.20): every landing's score for the stock trucks, and
 * for a few tunes, so the scoring can be checked by eye.
 *
 *   npx vitest run --config vitest.harness.config.ts jumps --silent=false
 *
 * X_CLS picks classes (comma list); X_TUNE is a JSON object of changes, e.g.
 * '{"both.bumpStop":0.1,"rear.rebound":4,"parts.dampers":"zedTwo","both.springRate":1.2}'
 * (springRate multiplies; the rest replace).
 */
import { it } from 'vitest'
import { buildTruck, stockBuild } from '../../src/sim/build'
import { RIGS } from '../../src/data/rigs'
import { runLaps } from '../../src/sim/laps'
import { fromCelsius } from '../../src/sim/units'
import type { ClassId } from '../../src/data/classes'

it('jump ramp landings', () => {
  const classes = (process.env.X_CLS ?? 'light4x4,heavy,sxs').split(',') as ClassId[]
  const tune = JSON.parse(process.env.X_TUNE ?? '{}') as Record<string, number | string>
  for (const cls of classes) {
    const b = stockBuild(cls) as unknown as Record<string, Record<string, unknown>>
    for (const [k, v] of Object.entries(tune)) {
      const [ax, key] = k.split('.') as [string, string]
      if (ax === 'parts') b.parts![key] = v
      else for (const a of ax === 'both' ? ['front', 'rear'] : [ax]) b[a]![key] = key === 'springRate' ? (b[a]![key] as number) * (v as number) : v
    }
    const truck = buildTruck(b as never)
    const run = runLaps(truck.ride, truck.wear, RIGS.jumpRig, 104, { airTemp: fromCelsius(20), trace: false })
    for (const l of run.landings) {
      console.log(`${cls} ${Math.round(l.speed * 3.6)} km/h ${l.grade} ${l.score}  ${l.spot} ${l.first}-first air ${l.air.toFixed(2)} s flew ${l.flown.toFixed(1)} m angle ${l.angle.toFixed(1)}° bs ${l.bumpStops.map(Number).join('')} bottoms ${l.bottoms.join('')} bounces ${l.bounces} g ${l.peakG.toFixed(1)} travel ${(l.travel * 100).toFixed(0)}%`)
    }
    console.log(`${cls}: ${run.broken ? `broke (${run.broken.kind}) on jump ${run.brokenLap}` : 'lasted'}`)
  }
})
