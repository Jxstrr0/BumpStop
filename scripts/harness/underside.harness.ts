/**
 * Underside hits (after 1.13): rocks that reach the underside, the share the
 * guards take, and the time the rest cost, for the stock trucks on every
 * raid. Prints one line per class, raid, guards and pace.
 *
 *   npx vitest run --config vitest.harness.config.ts underside
 *
 * X_CLS, X_RAIDS, X_GUARDS and X_PACES pick a subset (comma lists).
 */
import { it } from 'vitest'
import { stockBuild } from '../../src/sim/build'
import { driveAutoStage } from '../../src/sim/career'
import { RAID_IDS, RAIDS, type PaceId, type RaidId } from '../../src/data/raids'
import type { ClassId } from '../../src/data/classes'
import { enterRaid, stageLegs } from '../../src/sim/raid'
import { UNDERSIDE } from '../../src/data/underside'

const list = <T extends string>(v: string | undefined, all: readonly T[]) => (v ? (v.split(',') as T[]) : all)

it('underside hits', () => {
  // X_OFF=1: no rocks at all, to compare with the game before underside hits.
  if (process.env.X_OFF) for (const k of Object.keys(UNDERSIDE.perKm)) (UNDERSIDE.perKm as Record<string, number>)[k] = 0
  const classes = list<ClassId>(process.env.X_CLS, ['light4x4', 'heavy', 'sxs'])
  const raids = list<RaidId>(process.env.X_RAIDS, RAID_IDS)
  const guards = list(process.env.X_GUARDS, ['noGuards', 'skidPlates', 'fullArmour'])
  const paces = list<PaceId>(process.env.X_PACES, ['steady'])
  const seeds = [1, 2, 3, 4]
  for (const cls of classes) for (const raid of raids) for (const g of guards) for (const pace of paces) {
    let through = 0, took = 0, patch = 0, leak = 0, ratio = 0, late = 0, bottomStops = 0
    for (const seed of seeds) {
      const b = stockBuild(cls)
      b.parts.protection = g
      const s = enterRaid(raid, b, 'veteran', { seed })
      while (!driveAutoStage(s, pace));
      const par = RAIDS[raid].stages.reduce((sum, st) => sum + stageLegs(cls, st).reduce((a, l) => a + l.par, 0), 0)
      ratio += s.results.reduce((a, x) => a + x.time, 0) / par / seeds.length
      for (const r of s.results) {
        took += r.guardHits ?? 0
        leak += r.leak ?? 0
        late += r.late ? 1 : 0
        for (const st of r.stops) {
          if (st.kind === 'sump' || st.kind === 'diff' || st.kind === 'tank') { through++; patch += st.lost }
          if (st.kind === 'bottoming') bottomStops++
        }
      }
    }
    const n = seeds.length
    const min = (x: number) => (x / n / 60).toFixed(1)
    process.stdout.write(`${cls.padEnd(8)} ${raid.padEnd(15)} ${g.padEnd(10)} ${pace.padEnd(8)} through ${(through / n).toFixed(1)} took ${(took / n).toFixed(1)} patch ${min(patch)}m leak ${min(leak)}m ratio ${ratio.toFixed(3)} late ${late} bottomStops ${(bottomStops / n).toFixed(1)}\n`)
  }
})
