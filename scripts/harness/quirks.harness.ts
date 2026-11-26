import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { stockBuild, tidyBuild } from '../../src/sim/build'
import { driveAutoStage } from '../../src/sim/career'
import { KITS, type AxleSettings, type TruckBuild } from '../../src/data/kit'
import { RAIDS, type RaidId } from '../../src/data/raids'
import { enterRaid, stageLegs } from '../../src/sim/raid'
import type { ClassId } from '../../src/data/classes'

it('bad', () => {
  const cls = (process.env.B_CLS ?? 'light4x4') as ClassId
  const r = KITS[cls].ranges
  const tweaks: Record<string, Partial<AxleSettings>> = {
    factory: {},
    pressHigh: { tirePressure: r.tirePressure.max },
    pressLow: { tirePressure: r.tirePressure.min },
    stopShort: { bumpStop: r.bumpStop.min },
    springSoft: { springRate: r.springRate.min, preload: 0 },
    springHard: { springRate: r.springRate.max },
    droopShort: { droopLimit: r.droopLimit.min },
  }
  const only = process.env.B_ONLY?.split(',')
  for (const raid of ['winterSprint', 'summerRaid'] as RaidId[]) for (const [name, tw] of Object.entries(tweaks)) {
    if (only && !only.includes(name)) continue
    let ratio = 0, stops = 0, late = 0
    for (const seed of [1, 2, 3, 4]) {
      const s0 = stockBuild(cls)
      const b: TruckBuild = tidyBuild({ ...s0, front: { ...s0.front, ...tw }, rear: { ...s0.rear, ...tw } })
      const s = enterRaid(raid, b, 'veteran', { seed })
      while (!driveAutoStage(s, 'steady'));
      const par = RAIDS[raid].stages.reduce((sum, st) => sum + stageLegs(cls, st).reduce((a, l) => a + l.par, 0), 0)
      ratio += s.results.reduce((a, x) => a + x.time, 0) / par / 4
      stops += s.results.reduce((a, x) => a + x.stops.length, 0)
      late += s.results.filter((x) => x.late).length
    }
    appendFileSync('/tmp/bad.txt', `${cls} ${raid} ${name.padEnd(10)} ratio ${ratio.toFixed(3)} stops ${stops} late ${late}\n`)
  }
})
