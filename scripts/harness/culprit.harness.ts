import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import type { ClassId } from '../../src/data/classes'
import { SLOTS } from '../../src/data/parts'
import { partsFor, stockBuild, tidyBuild } from '../../src/sim/build'
import { driveAutoStage } from '../../src/sim/career'
import { enterRaid } from '../../src/sim/raid'

/**
 * Every part, one at a time, on the class's stock truck with its factory
 * settings, driven Steady through the Summer Raid: no part should be a trap
 * that breaks far more than the stock truck does (plan PR 13).
 */
it('culprit', () => {
  for (const cls of (process.env.C_CLASSES ?? 'light4x4,heavy,sxs').split(',') as ClassId[]) {
    const stock = stockBuild(cls)
    const run = (label: string, b: typeof stock) => {
      let n = 0
      const kinds: string[] = []
      for (const seed of [11, 12]) {
        const s = enterRaid('summerRaid', b, 'gravelAce', { seed })
        while (!driveAutoStage(s, 'steady'));
        for (const r of s.results) for (const x of r.stops) { n++; kinds.push(x.kind) }
      }
      appendFileSync('/tmp/culprit.txt', `${cls} ${label}: ${n} stops [${kinds.join(',')}]\n`)
    }
    run('stock', stock)
    for (const slot of SLOTS) for (const p of partsFor(cls, slot)) {
      if (p.id === stock.parts[slot] || slot === 'spares') continue
      run(`+${p.id}`, tidyBuild({ ...stock, parts: { ...stock.parts, [slot]: p.id } }))
    }
  }
})
