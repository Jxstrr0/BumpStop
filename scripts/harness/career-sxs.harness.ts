import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { playCareer } from './careerBot'

/** One class's career bot: `npx vitest run --config vitest.harness.config.ts career-sxs`. */
it('career bot: sxs', () => {
  const seeds = (process.env.BOT_SEEDS ?? '1').split(',').map(Number)
  const seasons = Number(process.env.BOT_SEASONS ?? 8)
  const out = process.env.BOT_OUT ?? '/tmp/careerbot-sxs.txt'
  const policies = (process.env.BOT_POLICY ?? 'steady').split(',') as ('steady' | 'smart')[]
  for (const policy of policies) for (const seed of seeds) {
    const r = playCareer({ policy, cls: 'sxs', seed, seasons, stopAtWin: process.env.BOT_STOP === '1',
      longOnePace: (process.env.BOT_LONG_PACE as 'steady' | 'conserve' | undefined),
      log: (l) => appendFileSync(out, `sxs ${policy} s${seed} ${l}\n`) })
    appendFileSync(out, `sxs ${policy} s${seed} SUMMARY truck@${r.firstTruck?.toFixed(2)} longEntry@${r.firstLongOneEntry} longWin@${r.firstLongOneWin} rep ${r.final.rep} bank ${Math.round(r.final.money)} wins ${r.final.stats.wins}/${r.final.stats.raids} contracts ${r.final.stats.contracts} ${(r.ms / 1000).toFixed(0)}s\n`)
  }
})
