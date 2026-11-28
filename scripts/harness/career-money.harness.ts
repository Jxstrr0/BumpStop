import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { CLASS_MONEY } from '../../src/data/career'
import type { ClassId } from '../../src/data/classes'
import { truckValue } from '../../src/sim/career'
import { playCareer } from './careerBot'

/**
 * Money by class (side-by-side money check, 28 November 2026): one class's
 * career bot from a fresh garage in `BOT_START` (default 2005, the first year
 * side-by-sides race), entering the one-day events too, with where the money
 * came from and went. "Worth" is the bank plus the truck's resale plus what
 * went on crew, tools and parts; "in light 4x4 money" divides it by the
 * class's money scale (`CLASS_MONEY`), since a heavy truck's parts cost 3.5
 * times as much.
 *
 * `BOT_CLASS=sxs BOT_SEEDS=1,2 npx vitest run --config vitest.harness.config.ts career-money`
 */
it('career bot money', () => {
  const cls = (process.env.BOT_CLASS ?? 'sxs') as ClassId
  const seeds = (process.env.BOT_SEEDS ?? '1').split(',').map(Number)
  const seasons = Number(process.env.BOT_SEASONS ?? 8)
  const startYear = Number(process.env.BOT_START ?? 2005)
  const events = process.env.BOT_EVENTS !== '0'
  // BOT_ESTABLISHED=300,200000: a garage twenty years in (reputation, money, every crew and tool), changing class.
  const est = process.env.BOT_ESTABLISHED?.split(',').map(Number)
  const established = est ? { rep: est[0]!, money: est[1]! } : undefined
  const out = process.env.BOT_OUT ?? `/tmp/careermoney-${cls}.txt`
  for (const seed of seeds) {
    const r = playCareer({ policy: 'steady', cls, seed, seasons, startYear, events, established,
      log: (l) => appendFileSync(out, `${cls} s${seed} ${l}\n`) })
    const b = r.book
    const bank = Math.round(r.final.money)
    const worth = bank + truckValue(r.final) + b.upgrades + b.parts - (established?.money ?? 0)
    const k = (n: number) => `${Math.round(n / 1000)}k`
    appendFileSync(out, `${cls} s${seed} SUMMARY start ${startYear}${established ? ` established ${est!.join('/')}` : ''} truck@${r.firstTruck?.toFixed(2)} longEntry@${r.firstLongOneEntry} longWin@${r.firstLongOneWin} rep ${r.final.rep} wins ${r.final.stats.wins}/${r.final.stats.raids} contracts ${r.final.stats.contracts}`
      + ` | bank ${k(bank)} worth ${k(worth)} (light-money ${k(worth / CLASS_MONEY[cls])}) | raids ${k(b.raids)} contracts ${k(b.contracts)} events ${k(b.events)} (${b.eventWins} wins in ${b.eventEntries}) series ${k(b.series)}`
      + ` | spent truck ${k(b.truck)} parts ${k(b.parts)} crew+tools ${k(b.upgrades)} (${r.final.upgrades.length}) ${(r.ms / 1000).toFixed(0)}s\n`)
  }
})
