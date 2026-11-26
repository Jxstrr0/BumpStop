/**
 * The career bot (plan PR 13): plays a whole career the way a steady player
 * might, sticking to one class, and keeps a diary of money, reputation and
 * results, so the career's numbers can be tuned across the three classes.
 *
 * How it plays:
 * - Takes the best-paying contract it has the reputation for until it can
 *   buy its class's stock truck with money to spare.
 * - Then enters its own truck whenever the raid is open to it and it can
 *   pay, with the best driver its reputation brings; otherwise a contract.
 * - Calls Steady all the way (or Conserve on the Long One if asked), and
 *   does the worst jobs first each night.
 * - Between raids buys crew and tools, and upgrades the truck a slot at a
 *   time (the dearest part out that keeps the weight legal and leaves money
 *   in the bank), in a fixed order: dampers first.
 *
 * Not a test: the harnesses in this folder call it and print tables.
 */
import { CLASSES, type ClassId } from '../../src/data/classes'
import { CALENDAR, DRIVER_TERMS, TIERS, UPGRADES } from '../../src/data/career'
import type { DriverId, PaceId } from '../../src/data/raids'
import { changeCost, partIn, partsFor, stockBuild, tidyBuild, massAndCost } from '../../src/sim/build'
import {
  buyTruck, buyUpgrade, cheapestBuild, contractProblems, contractRaid, setContractBuild, driveAuto, driveAutoStage, driverFee, entryFee, entryProblems, enterOwn, isBroke,
  newCareer, nextEvent, offers, settle, sponsorPay, takeContract, truckPrice, upgradeProblem, discountOf, type CareerState,
  type Settlement,
} from '../../src/sim/career'
import type { TruckBuild } from '../../src/data/kit'
import type { SlotId } from '../../src/data/parts'
import { ratings } from '../../src/sim/teams'

export interface BotOptions {
  cls: ClassId
  seed: number
  seasons: number
  /** Money kept back after spending on parts, as raids' worth of entry costs. */
  reserveRaids?: number
  longOnePace?: PaceId
  /** 'steady' all the way, or 'smart': Push once the dampers are better than stock (heat rating 2 or more). */
  policy?: 'steady' | 'smart'
  /** Stop once the bot has won the Long One. */
  stopAtWin?: boolean
  log?: (line: string) => void
}

export interface RaidLine {
  season: number
  year: number
  raid: string
  tier: string
  job: 'own' | 'contract' | null
  cls: ClassId | null
  pos: number | null
  of: number
  money: number
  bank: number
  rep: number
}

export interface BotResult {
  lines: RaidLine[]
  firstLongOneEntry: number | null
  firstLongOneWin: number | null
  firstTruck: number | null
  final: CareerState
  ms: number
}

// Armour and a bigger engine add weight the bot can't judge, so it leaves them stock.
const UPGRADE_ORDER: readonly SlotId[] = ['dampers', 'tires', 'frame', 'axles', 'bumpStops', 'frontSusp', 'rearSusp', 'wheels']

/** The best driver this garage can hire. */
function bestDriver(c: CareerState): DriverId {
  const order: DriverId[] = ['gravelAce', 'charger', 'veteran', 'mechanic']
  return order.find((d) => c.rep >= DRIVER_TERMS[d].rep) ?? 'veteran'
}

/** What entering the next raid would cost, all in. */
function entryCost(c: CareerState, cls: ClassId, driver: DriverId): number {
  return entryFee(c, cls) + driverFee(c, driver, cls) - sponsorPay(c, cls)
}

function reserve(c: CareerState, cls: ClassId, raids: number): number {
  // A regional raid's entry plus a repair bill's worth, times the raids.
  return raids * (TIERS.regional.entryFee + 2000) * (cls === 'heavy' ? 3.5 : cls === 'sxs' ? 0.6 : 1)
}

/** Upgrade the truck a slot at a time while the money allows. */
function upgradeTruck(c: CareerState, keep: number): void {
  if (!c.own) return
  const cls = c.own.cls
  const klass = CLASSES.find((x) => x.id === cls)!
  for (const slot of UPGRADE_ORDER) {
    const now = partIn(c.own, slot)
    const options = partsFor(cls, slot)
      .filter((p) => p.year <= c.year && (p.cost[cls] as number) > (now.cost[cls] as number))
      .sort((a, b) => (b.cost[cls] as number) - (a.cost[cls] as number))
    for (const p of options) {
      if (slot === 'tires' && p.id.toLowerCase().includes('stud')) continue
      const trial: TruckBuild = tidyBuild({ ...c.own, parts: { ...c.own.parts, [slot]: p.id } })
      const { mass } = massAndCost(trial)
      if (mass < klass.minMass || mass > klass.maxMass) continue
      const cost = changeCost(c.own, trial, 0.5, discountOf(c))
      if (cost > c.money - keep) continue
      c.money -= cost
      c.own = trial
      break
    }
  }
}

function buyShop(c: CareerState, keep: number): void {
  for (const u of UPGRADES) if (!upgradeProblem(c, u.id) && c.money - u.cost > keep) buyUpgrade(c, u.id)
}

export function playCareer(o: BotOptions): BotResult {
  const t0 = performance.now()
  const c = newCareer(o.seed)
  const lines: RaidLine[] = []
  const reserveRaids = o.reserveRaids ?? 2
  let firstLongOneEntry: number | null = null
  let firstLongOneWin: number | null = null
  let firstTruck: number | null = null
  while (c.season < o.seasons) {
    const e = nextEvent(c)
    const keep = reserve(c, o.cls, reserveRaids)
    if (!c.own && c.money >= truckPrice(c, o.cls) + keep / 2) {
      buyTruck(c, o.cls)
      firstTruck ??= c.season + e.day / 365
    }
    if (c.own && !isBroke(c)) {
      buyShop(c, keep * 2)
      upgradeTruck(c, keep)
    }
    let s: Settlement
    const driver = bestDriver(c)
    const canEnter = c.own && entryProblems(c, driver).length === 0 && c.money - entryCost(c, c.own.cls, driver) > 0
    if (canEnter) {
      const state = enterOwn(c, driver)
      const smart = o.policy === 'smart' && ratings(c.own!).heat >= 2
      const pace: PaceId = e.tier === 'long' && o.longOnePace ? o.longOnePace : smart ? 'push' : 'steady'
      if (e.tier === 'long') firstLongOneEntry ??= c.season
      while (!driveAutoStage(state, pace));
      s = settle(c, state)
    } else {
      const open = offers(c).filter((x) => c.rep >= x.rep).sort((a, b) => b.fee - a.fee)
      const pick = open[0]
      if (pick) {
        takeContract(c, pick)
        // The privateer's stock truck, or the cheapest legal one when that's over their budget.
        if (contractProblems(c).length && c.job?.kind === 'contract') setContractBuild(c, cheapestBuild(c.job.build, c.year))
        const state = contractRaid(c)
        driveAuto(state)
        s = settle(c, state)
      } else {
        s = settle(c, null)
      }
    }
    if (s.wonLongOne) firstLongOneWin ??= c.season - 1
    const line: RaidLine = {
      season: s.wonLongOne ? c.season - 1 : (c.next === 0 ? c.season - 1 : c.season),
      year: c.year, raid: e.raid, tier: e.tier, job: s.job,
      cls: s.job === 'own' ? o.cls : null,
      pos: s.pos, of: s.of, money: Math.round(s.money), bank: Math.round(c.money), rep: c.rep,
    }
    lines.push(line)
    o.log?.(`${line.season} ${e.raid.padEnd(16)} ${String(s.job).padEnd(8)} ${s.pos ?? '-'}/${s.of} ${String(line.money).padStart(7)} bank ${String(line.bank).padStart(8)} rep ${c.rep}`)
    if (o.stopAtWin && firstLongOneWin !== null) break
  }
  return { lines, firstLongOneEntry, firstLongOneWin, firstTruck, final: c, ms: performance.now() - t0 }
}

export { CALENDAR, stockBuild }
