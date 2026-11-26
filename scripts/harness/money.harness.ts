/**
 * Money (playtest, 26 November 2026): what a raid pays in each class and
 * tier, for your own stock truck and for an untouched stock contract truck.
 * Prints place, prize or fee, fees paid at entry, the repair bill and the net,
 * averaged over seeds. Run with
 * `npx vitest run --config vitest.harness.config.ts money`.
 */
import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { CALENDAR } from '../../src/data/career'
import type { ClassId } from '../../src/data/classes'
import type { DriverId, PaceId } from '../../src/data/raids'
import { stockBuild } from '../../src/sim/build'
import { cheapestBuild, contractProblems, contractRaid, setContractBuild, driveAuto, driveAutoStage, enterOwn, newCareer, offers, settle, takeContract } from '../../src/sim/career'

const OUT = process.env.M_OUT ?? '/tmp/money.txt'

it('money', () => {
  const classes = (process.env.M_CLASSES ?? 'light4x4,heavy,sxs').split(',') as ClassId[]
  const events = (process.env.M_EVENTS ?? '0,2,3,5').split(',').map(Number)
  const seeds = Number(process.env.M_SEEDS ?? 6)
  const pace = (process.env.M_PACE ?? 'steady') as PaceId
  const driver = (process.env.M_DRIVER ?? 'veteran') as DriverId
  for (const cls of classes) for (const ev of events) {
    const own = { pos: [] as number[], net: 0, prize: 0, fees: 0, bill: 0 }
    const con = { pos: [] as number[], pay: 0 }
    const fix = { pos: [] as number[], pay: 0 }
    for (let k = 0; k < seeds; k++) {
      // Your own stock truck.
      const c = newCareer(1000 + k)
      c.next = ev
      c.rep = { regional: 0, national: 15, long: 60 }[CALENDAR[ev]!.tier]
      c.money = 1e6
      c.own = stockBuild(cls)
      const bank = c.money
      const state = enterOwn(c, driver)
      while (!driveAutoStage(state, pace));
      const s = settle(c, state)
      own.pos.push(s.pos ?? 99)
      own.prize += s.prize
      own.bill += s.repairs + s.spares + s.bivouac
      own.fees += bank - c.money + s.prize - s.repairs - s.spares - s.bivouac
      own.net += c.money - bank
      // A contract truck, handed over untouched (the privateer's own settings) and put back to the factory's.
      let d = newCareer(2000 + k)
      let offer: ReturnType<typeof offers>[number] | undefined
      for (let tries = 0; !offer; tries++) {
        d = newCareer(2000 + k + tries * 100)
        d.next = ev
        d.season = 1
        d.rep = 100
        offer = offers(d).find((o) => o.cls === cls)
      }
      for (const fixed of [false, true]) {
        const e = structuredClone(d)
        takeContract(e, offer)
        if (fixed && e.job?.kind === 'contract') setContractBuild(e, stockBuild(cls))
        if (contractProblems(e).length && e.job?.kind === 'contract') setContractBuild(e, cheapestBuild(e.job.build, e.year))
        const before = e.money
        const cs = contractRaid(e)
        driveAuto(cs)
        const t = settle(e, cs)
        const into = fixed ? fix : con
        into.pos.push(t.pos ?? 99)
        into.pay += e.money - before
      }
    }
    const avg = (n: number) => Math.round(n / seeds)
    appendFileSync(OUT, `${cls.padEnd(8)} ${CALENDAR[ev]!.raid.padEnd(13)} own ${driver} ${pace} pos ${own.pos.join(',')} prize ${avg(own.prize)} fees ${avg(own.fees)} bill ${avg(own.bill)} net ${avg(own.net)} | contract untouched pos ${con.pos.join(',')} pay ${avg(con.pay)} | factory settings pos ${fix.pos.join(',')} pay ${avg(fix.pay)}\n`)
  }
})
