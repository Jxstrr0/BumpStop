import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { CLASSES, type ClassId } from '../../src/data/classes'
import { KITS, type TruckBuild } from '../../src/data/kit'
import { SLOTS } from '../../src/data/parts'
import { massAndCost, partIn, partsFor, stockBuild, tidyBuild } from '../../src/sim/build'
import { driveAutoStage } from '../../src/sim/career'
import { RAIDS, type DriverId, type PaceId, type RaidId } from '../../src/data/raids'
import { enterRaid, stageLegs } from '../../src/sim/raid'
import { ratings } from '../../src/sim/teams'

const ORDER = ['dampers', 'tires', 'frame', 'axles', 'bumpStops', 'frontSusp', 'rearSusp', 'wheels', 'protection', 'spares', 'engine', 'antiRoll'] as const

/** The dearest legal part in each slot, in the bot's order, inside a budget. */
export function bestBuild(cls: ClassId, year: number, budget: number): TruckBuild {
  const klass = CLASSES.find((x) => x.id === cls)!
  let b = stockBuild(cls)
  for (const slot of ORDER) {
    const opts = partsFor(cls, slot).filter((p) => p.year <= year && !p.id.toLowerCase().includes('stud'))
      .sort((x, y) => (y.cost[cls] as number) - (x.cost[cls] as number))
    for (const p of opts) {
      if ((p.cost[cls] as number) <= (partIn(b, slot).cost[cls] as number)) break
      const t = tidyBuild({ ...b, parts: { ...b.parts, [slot]: p.id } })
      const { mass, cost } = massAndCost(t)
      if (mass < klass.minMass || mass > klass.maxMass || cost > budget) continue
      b = t
      break
    }
  }
  return b
}

it('best', () => {
  const raids = (process.env.P_RAIDS ?? 'summerRaid').split(',') as RaidId[]
  const classes = (process.env.P_CLASSES ?? 'light4x4,heavy,sxs').split(',') as ClassId[]
  const years = (process.env.P_YEARS ?? '1988,1995,2005').split(',').map(Number)
  for (const year of years) for (const cls of classes) {
    const b = bestBuild(cls, year, KITS[cls].budget * Number(process.env.P_BUDGET ?? 1.5))
    const r = ratings(b)
    appendFileSync('/tmp/best.txt', `${year} ${cls} cost ${massAndCost(b).cost} heat ${r.heat.toFixed(2)} travel ${r.travel.toFixed(2)} str ${r.strength.toFixed(2)} pow ${r.power.toFixed(2)} ${SLOTS.map((s) => b.parts[s]).join(',')}\n`)
    for (const raid of raids) for (const driver of ['gravelAce'] as DriverId[]) for (const pace of ['steady', 'push'] as PaceId[]) for (const seed of [11, 12]) {
      const s = enterRaid(raid, b, driver, { seed })
      while (!driveAutoStage(s, pace));
      const par = RAIDS[raid].stages.reduce((sum, st) => sum + stageLegs(cls, st).reduce((a, l) => a + l.par, 0), 0)
      const time = s.results.reduce((a, x) => a + x.time, 0)
      appendFileSync('/tmp/best.txt', `  ${raid} ${driver} ${pace} s${seed} ratio ${(time / par).toFixed(3)} stops ${s.results.reduce((a, x) => a + x.stops.length, 0)} late ${s.results.filter((x) => x.late).length}\n`)
    }
  }
})
