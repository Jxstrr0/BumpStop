import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { stockBuild } from '../../src/sim/build'
import { driveAutoStage } from '../../src/sim/career'
import { RAIDS, type DriverId, type PaceId, type RaidId } from '../../src/data/raids'
import { enterRaid, stageLegs } from '../../src/sim/raid'

/** The player's time against par: stock truck, by driver and pace call. Rivals' `pace` is the same ratio. */
it('pace', () => {
  const raids = (process.env.P_RAIDS ?? 'summerRaid,nationalRaid').split(',') as RaidId[]
  const classes = (process.env.P_CLASSES ?? 'light4x4,heavy,sxs').split(',') as ('light4x4' | 'heavy' | 'sxs')[]
  for (const raid of raids) for (const cls of classes) for (const driver of ['veteran', 'gravelAce'] as DriverId[]) for (const pace of ['steady', 'push'] as PaceId[]) {
    for (const seed of [11, 12]) {
      const b = stockBuild(cls); b.parts.spares = 'lightKit'
      const s = enterRaid(raid, b, driver, { seed })
      while (!driveAutoStage(s, pace));
      const par = RAIDS[raid].stages.reduce((sum, st) => sum + stageLegs(cls, st).reduce((a, l) => a + l.par, 0), 0)
      const time = s.results.reduce((a, r) => a + r.time, 0)
      const clean = s.results.filter((r) => r.stops.length === 0).length
      appendFileSync('/tmp/pace.txt', `${raid} ${cls} ${driver} ${pace} s${seed} ratio ${(time / par).toFixed(3)} clean ${clean}/${s.results.length} late ${s.results.filter((r) => r.late).length} stops ${s.results.reduce((a, r) => a + r.stops.length, 0)}\n`)
    }
  }
})
