import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { stockBuild, tidyBuild, partsFor, massAndCost } from '../../src/sim/build'
import { driveAutoStage, newCareer, repairBill } from '../../src/sim/career'
import { PACE_SPEED, RAID, RAIDS, type PaceId, type RaidId } from '../../src/data/raids'
import { CLASSES, type ClassId } from '../../src/data/classes'
import { enterRaid, stageLegs } from '../../src/sim/raid'
import type { SlotId } from '../../src/data/parts'

function good(cls: ClassId, year: number) {
  let b = stockBuild(cls)
  const k = CLASSES.find((x) => x.id === cls)!
  for (const slot of ['dampers', 'tires', 'bumpStops', 'axles'] as SlotId[]) {
    const opts = partsFor(cls, slot).filter((p) => p.year <= year && !p.id.toLowerCase().includes('stud')).sort((a, z) => (z.cost[cls] as number) - (a.cost[cls] as number))
    for (const p of opts) { const t = tidyBuild({ ...b, parts: { ...b.parts, [slot]: p.id } }); const m = massAndCost(t).mass; if (m >= k.minMass && m <= k.maxMass) { b = t; break } }
  }
  return b
}

it('push', () => {
  const cls = (process.env.X_CLS ?? 'light4x4') as ClassId
  const raids = (process.env.X_RAIDS ?? 'summerRaid').split(',') as RaidId[]
  const pushes = (process.env.X_PUSH ?? '1.12').split(',').map(Number)
  const cools = (process.env.X_COOL ?? '600').split(',').map(Number)
  const truckKind = process.env.X_TRUCK ?? 'stock'
  const c = newCareer(1)
  for (const raid of raids) for (const push of pushes) for (const cool of cools) for (const pace of ['steady', 'push'] as PaceId[]) {
    ;(PACE_SPEED as Record<PaceId, number>).push = push
    ;(RAID as { coolMin: number }).coolMin = cool
    let ratio = 0, late = 0, bill = 0
    const kinds: Record<string, number> = {}
    const seeds = [1, 2, 3, 4]
    for (const seed of seeds) {
      const b = truckKind === 'good' ? good(cls, 1986) : stockBuild(cls)
      const s = enterRaid(raid, b, 'veteran', { seed })
      while (!driveAutoStage(s, pace));
      const par = RAIDS[raid].stages.reduce((sum, st) => sum + stageLegs(cls, st).reduce((a, l) => a + l.par, 0), 0)
      ratio += s.results.reduce((a, x) => a + x.time, 0) / par / seeds.length
      for (const r of s.results) for (const st of r.stops) kinds[st.kind] = (kinds[st.kind] ?? 0) + 1
      late += s.results.filter((x) => x.late).length
      const rb = repairBill(c, s)
      bill += (rb.repairs + rb.spares + s.spent) / seeds.length
    }
    appendFileSync(process.env.X_OUT ?? '/tmp/push.txt', `${cls} ${truckKind} ${raid} push=${push} cool=${cool} ${pace.padEnd(6)} ratio ${ratio.toFixed(3)} late ${late} bill ${Math.round(bill)} stops ${JSON.stringify(kinds)}\n`)
  }
})
