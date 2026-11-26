/**
 * The career, 1985 to 2025 (plan PR 9): a two-person garage that preps
 * privateers' trucks for money, then enters its own truck, then wins
 * sponsors and a works deal, and one day wins the Long One.
 *
 * - **The calendar:** eight raids a year, two in winter (`CALENDAR`). At each one the
 *   garage does one job: a prep contract, its own entry, or nothing. Time
 *   moves by days: from one raid to the next.
 * - **Prep contracts:** a privateer brings a class, a budget and a driver.
 *   You build the truck on the bench to their budget; they race it (the ride
 *   sim drives it, the privateer calls Steady); you get a fee and a bonus by
 *   result.
 * - **Your own entry:** your own truck (bought, then upgraded part by part;
 *   old parts sell back for half), an entry fee and a driver's fee, prize
 *   money by place, then the repair bill for whatever wore.
 * - **Reputation** comes from results. It opens the bigger raids, the better
 *   drivers, the heavy truck's privateers, sponsors and the works deal.
 * - **Parts arrive by year** (`src/data/parts.ts`), and so do the rival
 *   teams' upgrades (`teams.ts`). After each raid, rivals may copy the class
 *   winner's parts, yours included.
 * - **Broke** is a soft landing: money can go below zero after a repair
 *   bill. Then you can't buy parts or enter, but you can sell parts or the
 *   truck, and there's always a contract anyone can take.
 * - **The Long One**, the last raid of each year, is the career's goal. Win
 *   it and the career goes on.
 *
 * Everything in `CareerState` is plain data, kept in the garage save (plan
 * PR 8, format 2). Pure and seeded: no DOM, no clock.
 */
import { CLASSES, type ClassId } from '../data/classes'
import {
  CALENDAR, CAREER, CLASS_MONEY, CONTRACTS, DRIVER_TERMS, PRIVATEERS, SPARE_PRICE, SPONSORS, TEAMS, TIERS, TRAVEL_DAYS, UPGRADES,
  type CalendarEvent, type Sponsor, type TeamId, type Tier, type UpgradeId,
} from '../data/career'
import { KITS, type TruckBuild } from '../data/kit'
import { FIRST_YEAR, LAST_YEAR, PARTS, SLOTS, SPARE_IDS, type SlotId } from '../data/parts'
import { DRIVER_IDS, RAID, RAIDS, type DriverId, type PaceId, type RaidId } from '../data/raids'
import {
  changeCost, checkBuild, massAndCost, partIn, partsFor, stockBuild, tidyBuild, type BuildProblem, type BuildRules,
} from './build'
import {
  bivouacJobs, checkJobs, doJobs, driveStage, enterRaid, finishStage, harshShare, raidTruck, stageKm, stageLegs, standings,
  startStage, type Job as NightJob, type RaidState,
} from './raid'
import { rivalStages } from './rivals'
import { hashString, Rng } from './rng'
import { careerField, copyWinner, teamsForYear, type TeamGarage } from './teams'

/** A privateer who wants a truck prepped for the next raid. */
export interface Contract {
  /** `<season>:<event>:<offer>`, unique in a career. */
  id: string
  cls: ClassId
  /** Their race number (they're known by it until privateers get names). */
  number: number
  driver: DriverId
  /** What the parts may cost, all in. */
  budget: number
  /** Paid when the raid is done, whatever happens. */
  fee: number
  /** Paid on top: the best of these that they earn. */
  bonus: { finish: number; podium: number; win: number }
  /** Reputation it takes before they'll bring it to you. */
  rep: number
}

/** The garage's job at the next raid. */
export type CareerJob =
  /** Entered with its own truck: the raid itself lives in the garage save's `raid`. */
  | { kind: 'own'; driver: DriverId }
  /** Prepping a privateer's truck: the build on the bench for them. */
  | { kind: 'contract'; contract: Contract; build: TruckBuild }

/** One line in the career's news, newest first. The screens turn it into words. */
export type NewsItem =
  | { kind: 'result'; year: number; raid: RaidId; cls: ClassId; job: 'own' | 'contract'; pos: number | null; of: number; money: number; rep: number }
  | { kind: 'winner'; year: number; raid: RaidId; cls: ClassId; who: string }
  | { kind: 'copied'; year: number; team: TeamId; cls: ClassId; slots: SlotId[]; from: string }
  | { kind: 'newParts'; year: number; parts: string[] }
  | { kind: 'sponsor'; year: number; sponsor: number }
  | { kind: 'broke'; year: number }
  | { kind: 'longOne'; year: number }
  | { kind: 'skipped'; year: number; raid: RaidId }

export interface CareerStats {
  raids: number
  wins: number
  podiums: number
  contracts: number
}

export interface CareerState {
  /** Seeds the contracts, the roads and the rivals: picked when the career starts. */
  seed: number
  /** Seasons so far, from 0. The year follows it and stops at 2025; the seasons keep counting after. */
  season: number
  year: number
  /** Day of the year (1 is the first of January). */
  day: number
  /** The next raid: its place in `CALENDAR`. */
  next: number
  money: number
  rep: number
  /** Your own truck, once you've bought one. */
  own: TruckBuild | null
  upgrades: UpgradeId[]
  job: CareerJob | null
  teams: TeamGarage
  news: NewsItem[]
  /** Years you won the Long One. */
  longOne: number[]
  stats: CareerStats
}

// ── Starting ──

export function newCareer(seed: number): CareerState {
  return {
    seed: seed >>> 0,
    season: 0,
    year: FIRST_YEAR,
    day: CAREER.startDay,
    next: 0,
    money: CAREER.startMoney,
    rep: 0,
    own: null,
    upgrades: [],
    job: null,
    teams: teamsForYear(FIRST_YEAR),
    news: [],
    longOne: [],
    stats: { raids: 0, wins: 0, podiums: 0, contracts: 0 },
  }
}

// ── Where we are ──

export function nextEvent(c: CareerState): CalendarEvent {
  const e = CALENDAR[c.next]
  if (!e) throw new RangeError(`No raid ${c.next} in the calendar`)
  return e
}

/** The roads' seed for this year's running of the next raid. */
export function eventSeed(c: CareerState): number {
  return hashString(`${c.seed}:${c.season}:${c.next}:${RAIDS[nextEvent(c).raid].seed}`) % 1_000_000
}

/** How many days the next raid takes, travel included. */
export function eventDays(e: CalendarEvent): number {
  return RAIDS[e.raid].stages.length + TRAVEL_DAYS
}

/** The career's first raid, before anything has happened: the first-job guide's time (plan PR 11b). */
export function isFirstRaid(c: CareerState): boolean {
  return c.season === 0 && c.next === 0 && c.stats.raids === 0 && c.stats.contracts === 0
}

export function isBroke(c: CareerState): boolean {
  return c.money < 0
}

/** The best sponsor your reputation brings, or null. */
export function sponsorOf(c: CareerState): Sponsor | null {
  let best: Sponsor | null = null
  for (const s of SPONSORS) if (c.rep >= s.rep) best = s
  return best
}

export function discountOf(c: CareerState): number {
  return sponsorOf(c)?.discount ?? 0
}

/** Mechanic hours at each of your bivouacs. */
export function crewHours(c: CareerState): number {
  return RAID.bivouacHours + UPGRADES.filter((u) => c.upgrades.includes(u.id)).reduce((s, u) => s + u.hours, 0)
}

/** Share of a worn part's price that putting it right costs. */
export function repairShare(c: CareerState): number {
  return CAREER.repairShare - UPGRADES.filter((u) => c.upgrades.includes(u.id)).reduce((s, u) => s + u.repair, 0)
}

const round = (v: number) => Math.round(v / CONTRACTS.round) * CONTRACTS.round

// ── Contracts ──

/** The privateers' offers for the next raid. The same career always gets the same offers. */
export function offers(c: CareerState): Contract[] {
  const e = nextEvent(c)
  const rng = new Rng(hashString(`${c.seed}:${c.season}:${c.next}:offers`))
  const scale = CONTRACTS.tierScale[e.tier]
  const taken = new Set<number>()
  const out: Contract[] = []
  for (let k = 0; k < CONTRACTS.perEvent; k++) {
    // The career's very first offer is the guided first job (plan PR 11b). The dice are still rolled, so every other offer stays as it was.
    const firstJob = k === 0 && isFirstRaid(c)
    // The first offer is always open to anyone, in a cheap class: the way back from broke.
    const rolled: ClassId = k === 0
      ? rng.pick(['light4x4', 'sxs'] as const)
      : rng.weighted(CLASSES.map((x) => ({ item: x.id, weight: x.id === 'light4x4' ? 2 : 1 })))
    const cls = firstJob ? CONTRACTS.firstJob.cls : rolled
    const rep = k === 0 ? 0 : CONTRACTS.classRep[cls] + rng.int(0, 3) * 5
    const share = rng.range(CONTRACTS.budget[0], CONTRACTS.budget[1])
    const budget = round(KITS[cls].budget * (firstJob ? CONTRACTS.firstJob.budget : share) * scale)
    const fee = round(budget * CONTRACTS.fee)
    const base = cls === 'heavy' ? 520 : cls === 'sxs' ? 330 : 20
    let number = base + rng.int(0, 69)
    while (taken.has(number) || RESERVED_NUMBERS.has(number)) number++
    taken.add(number)
    out.push({
      id: `${c.season}:${c.next}:${k}`,
      cls,
      number,
      driver: rng.pick(DRIVER_IDS),
      budget,
      fee,
      bonus: { finish: round(fee * CONTRACTS.bonus.finish), podium: round(fee * CONTRACTS.bonus.podium), win: round(fee * CONTRACTS.bonus.win) },
      rep,
    })
  }
  return out
}

/** Race numbers the teams and the field's privateers already use. */
const RESERVED_NUMBERS = new Set<number>([
  ...Object.values(TEAMS).flatMap((t) => t.classes.map((x) => x.number)),
  ...PRIVATEERS.map((p) => p.number),
])

export function takeContract(c: CareerState, contract: Contract): void {
  if (c.job) throw new Error('The garage already has a job for this raid')
  if (c.rep < contract.rep) throw new Error('Not enough reputation for that contract')
  // The privateer's own truck: a stock build for its class.
  c.job = { kind: 'contract', contract: structuredClone(contract), build: stockBuild(contract.cls) }
}

/** Give a contract back before the raid (no money changes hands). */
export function dropContract(c: CareerState): void {
  if (c.job?.kind === 'contract') c.job = null
}

/** Save the bench build for the contract (the screens call this as you build). */
export function setContractBuild(c: CareerState, b: TruckBuild): void {
  if (c.job?.kind !== 'contract') throw new Error('No contract on the bench')
  if (b.cls !== c.job.contract.cls) throw new Error('That build is the wrong class for the contract')
  c.job.build = tidyBuild(b)
}

export function contractRules(c: CareerState, contract: Contract): BuildRules {
  return { year: c.year, budget: contract.budget }
}

/** What keeps the contract truck from being handed over: the build rules, under the privateer's budget. */
export function contractProblems(c: CareerState): BuildProblem[] {
  if (c.job?.kind !== 'contract') throw new Error('No contract on the bench')
  return checkBuild(c.job.build, contractRules(c, c.job.contract))
}

/** Hand the truck over: the privateer's raid, ready for `driveAuto`. */
export function contractRaid(c: CareerState): RaidState {
  if (c.job?.kind !== 'contract') throw new Error('No contract on the bench')
  if (contractProblems(c).length) throw new Error("The contract truck doesn't pass the rules")
  const e = nextEvent(c)
  const cls = c.job.contract.cls
  return enterRaid(e.raid, c.job.build, c.job.contract.driver, {
    seed: eventSeed(c),
    field: careerField(c.teams, cls, e.tier, c.year),
    hours: RAID.bivouacHours,
  })
}

// ── Your own truck ──

/** The rules for changing your own truck: owned parts are free, changes cost money. */
export function ownRules(c: CareerState): BuildRules {
  if (!c.own) throw new Error('No truck yet')
  return { year: c.year, budget: c.money, owned: { build: c.own, resale: CAREER.resale, discount: discountOf(c) } }
}

/** What a class's stock truck costs you to buy (sponsors' discount off). */
export function truckPrice(c: CareerState, cls: ClassId): number {
  return massAndCost(stockBuild(cls)).cost * (1 - discountOf(c))
}

/** What your truck sells for. */
export function truckValue(b: TruckBuild): number {
  return massAndCost(b).cost * CAREER.resale
}

export function buyTruck(c: CareerState, cls: ClassId): void {
  if (c.own) throw new Error('The garage already has a truck: sell it first')
  const price = truckPrice(c, cls)
  if (c.money < price) throw new Error('Not enough money for the truck')
  c.money -= price
  c.own = stockBuild(cls)
}

export function sellTruck(c: CareerState): void {
  if (!c.own) return
  if (c.job?.kind === 'own') throw new Error("Can't sell the truck in the middle of a raid")
  c.money += truckValue(c.own)
  c.own = null
}

/**
 * Fit your truck with the parts and settings in `b`: pays for the changes
 * (or takes the money back for parts sold). Settings alone are free. Throws
 * if a part isn't out yet or the money isn't there (when broke, only sales).
 */
export function fitOwn(c: CareerState, b: TruckBuild): number {
  if (!c.own) throw new Error('No truck yet')
  if (c.job?.kind === 'own') throw new Error("The parts are locked during a raid")
  const cost = changeCost(c.own, b, CAREER.resale, discountOf(c))
  for (const slot of SLOTS) if (partIn(b, slot).year > c.year) throw new Error(`The ${slot} part isn't out yet`)
  if (cost > 0 && cost > c.money) throw new Error('Not enough money for those parts')
  c.money -= cost
  c.own = tidyBuild(b)
  return cost
}

/** The cheapest parts on the market this year that keep the truck legal: for selling up when broke. */
export function cheapestBuild(b: TruckBuild, year: number): TruckBuild {
  const cls = CLASSES.find((x) => x.id === b.cls)!
  let out = structuredClone(b)
  for (const slot of SLOTS) {
    const cheaper = partsFor(b.cls, slot)
      .filter((p) => p.year <= year)
      .sort((a, z) => (a.cost[b.cls] as number) - (z.cost[b.cls] as number))
    for (const p of cheaper) {
      if (p.id === out.parts[slot]) break
      const trial = { ...out, parts: { ...out.parts, [slot]: p.id } }
      const { mass } = massAndCost(trial)
      if (mass >= cls.minMass && mass <= cls.maxMass) {
        out = trial
        break
      }
    }
  }
  return tidyBuild(out)
}

// ── The shop ──

export type UpgradeProblem = 'owned' | 'rep' | 'needs' | 'money'

export function upgradeProblem(c: CareerState, id: UpgradeId): UpgradeProblem | null {
  const u = UPGRADES.find((x) => x.id === id)
  if (!u) throw new RangeError(`No upgrade ${id}`)
  if (c.upgrades.includes(id)) return 'owned'
  if (c.rep < u.rep) return 'rep'
  if (u.needs && !c.upgrades.includes(u.needs)) return 'needs'
  if (c.money < u.cost) return 'money'
  return null
}

export function buyUpgrade(c: CareerState, id: UpgradeId): void {
  const problem = upgradeProblem(c, id)
  if (problem) throw new Error(`Can't buy ${id}: ${problem}`)
  c.money -= UPGRADES.find((x) => x.id === id)!.cost
  c.upgrades.push(id)
}

// ── Entering your own truck ──

export function entryFee(c: CareerState, cls: ClassId): number {
  return TIERS[nextEvent(c).tier].entryFee * CLASS_MONEY[cls]
}

export function driverFee(c: CareerState, driver: DriverId, cls: ClassId): number {
  return DRIVER_TERMS[driver].fee * TIERS[nextEvent(c).tier].driverFee * CLASS_MONEY[cls]
}

/** Paid by your sponsor when you enter (not for contracts). */
export function sponsorPay(c: CareerState, cls: ClassId): number {
  return (sponsorOf(c)?.pay ?? 0) * CLASS_MONEY[cls]
}

export type EntryProblem =
  | { kind: 'busy' }
  | { kind: 'noTruck' }
  | { kind: 'broke' }
  | { kind: 'rep'; need: number }
  | { kind: 'driverRep'; need: number }
  | { kind: 'money'; need: number }
  | { kind: 'parts' }
  | { kind: 'build'; problems: BuildProblem[] }

/**
 * What keeps you from entering your own truck in the next raid. `bench` is
 * the truck on the bench: it must have your truck's parts (unpaid changes
 * get bought first), but its settings may differ.
 */
export function entryProblems(c: CareerState, driver: DriverId, bench?: TruckBuild): EntryProblem[] {
  const out: EntryProblem[] = []
  if (c.job) out.push({ kind: 'busy' })
  if (!c.own) return [...out, { kind: 'noTruck' }]
  if (isBroke(c)) out.push({ kind: 'broke' })
  const tier = TIERS[nextEvent(c).tier]
  if (c.rep < tier.rep) out.push({ kind: 'rep', need: tier.rep })
  if (c.rep < DRIVER_TERMS[driver].rep) out.push({ kind: 'driverRep', need: DRIVER_TERMS[driver].rep })
  const cls = c.own.cls
  const cost = entryFee(c, cls) + driverFee(c, driver, cls) - sponsorPay(c, cls)
  if (cost > c.money && !isBroke(c)) out.push({ kind: 'money', need: cost })
  if (bench && (bench.cls !== cls || SLOTS.some((s) => bench.parts[s] !== c.own!.parts[s]))) out.push({ kind: 'parts' })
  const problems = checkBuild(c.own, { year: c.year, budget: Infinity }).filter((p) => p.kind !== 'overBudget')
  if (problems.length) out.push({ kind: 'build', problems })
  return out
}

/** Enter your own truck: pays the fees (less the sponsor's money) and starts the raid. */
export function enterOwn(c: CareerState, driver: DriverId, bench?: TruckBuild): RaidState {
  const problems = entryProblems(c, driver, bench)
  if (problems.length) throw new Error(`Can't enter: ${problems.map((p) => p.kind).join(', ')}`)
  const own = c.own!
  const e = nextEvent(c)
  const cls = own.cls
  c.money -= entryFee(c, cls) + driverFee(c, driver, cls) - sponsorPay(c, cls)
  c.job = { kind: 'own', driver }
  // The bench's settings (same parts) go on the raid.
  const b = bench ? { ...own, front: bench.front, rear: bench.rear } : own
  return enterRaid(e.raid, b, driver, { seed: eventSeed(c), field: careerField(c.teams, cls, e.tier, c.year), hours: crewHours(c) })
}

// ── Driving without the player: privateers, and the bot ──

/** Each night: the worst parts first, as many jobs as the hours and spares allow. */
export function autoJobs(state: RaidState): NightJob[] {
  const picked: NightJob[] = []
  for (const j of bivouacJobs(state)) if (!checkJobs(state, [...picked, j])) picked.push(j)
  return picked
}

/** Drive the next stage on one pace call, then do the night's jobs. Returns true once the raid is over. */
export function driveAutoStage(state: RaidState, pace: PaceId = 'steady'): boolean {
  if (state.phase === 'bivouac') doJobs(state, autoJobs(state))
  if (state.phase === 'done') return true
  const run = startStage(state, raidTruck(state), pace)
  driveStage(state, run, [pace, pace, pace])
  finishStage(state, run)
  // finishStage moves the phase on (TypeScript can't see that through the call).
  return (state.phase as RaidState['phase']) === 'done'
}

/** Drive a whole raid on one pace call (a privateer's contract raid). */
export function driveAuto(state: RaidState, pace: PaceId = 'steady'): void {
  while (!driveAutoStage(state, pace));
}

// ── After a raid ──

export interface Settlement {
  raid: RaidId
  job: 'own' | 'contract' | null
  /** Your place in class (null if you retired or sat it out), and how many were in it. */
  pos: number | null
  of: number
  /** Never towed in. */
  finished: boolean
  prize: number
  fee: number
  bonus: number
  repairs: number
  spares: number
  /** Money in and out, all told (fees paid at entry aren't in here). */
  money: number
  rep: number
  /** The winner of each class: 'you', a rival's id. */
  winners: Record<ClassId, string>
  copies: Extract<NewsItem, { kind: 'copied' }>[]
  wonLongOne: boolean
}

/** What putting a raid's wear right costs, and the spares used. */
export function repairBill(c: CareerState, state: RaidState): { repairs: number; spares: number } {
  const b = state.entry.build
  const cls = b.cls
  const price = (slot: SlotId) => partIn(b, slot).cost[cls] as number
  const share = repairShare(c)
  const w = state.wear
  let repairs = 0
  for (let i = 0; i < 4; i++) {
    const susp = price(i < 2 ? 'frontSusp' : 'rearSusp') / 2
    repairs += (w.tire[i]!.damage * price('tires')) / 4
    repairs += (w.bottoming[i]!.damage * (price('dampers') + price('bumpStops'))) / 4
    repairs += (w.axle[i]!.damage * price('axles')) / 4
    repairs += w.mount[i]!.damage * susp / 2
  }
  for (const f of w.frame) repairs += (f.damage * price('frame')) / 3
  const carried = partIn(b, 'spares').carries
  let spares = 0
  for (const s of SPARE_IDS) spares += Math.max(0, carried[s] - state.spares[s]) * SPARE_PRICE[s] * CLASS_MONEY[cls]
  return { repairs: Math.round(repairs * share), spares: Math.round(spares) }
}

/** The class results of a raid the player wasn't in: the rivals' estimates only. */
function rivalsOnly(c: CareerState, cls: ClassId): string[] {
  const e = nextEvent(c)
  const raid = RAIDS[e.raid]
  const field = careerField(c.teams, cls, e.tier, c.year)
  const sums = new Map<string, number>()
  raid.stages.forEach((spec, k) => {
    const legs = stageLegs(cls, spec)
    const res = rivalStages(cls, legs.map((l) => l.par), stageKm(spec), harshShare(spec), eventSeed(c) * 100 + k, field, raid.season === 'winter')
    for (const r of res) sums.set(r.id, (sums.get(r.id) ?? 0) + r.time)
  })
  return [...sums].sort((a, b) => a[1] - b[1]).map(([id]) => id)
}

/** The team behind a rival entry's id, if it's a team. */
function teamOf(who: string): TeamId | null {
  for (const id of Object.keys(TEAMS) as TeamId[]) if (who.startsWith(id)) return id
  return null
}

function addNews(c: CareerState, item: NewsItem): void {
  c.news.unshift(item)
  if (c.news.length > CAREER.logLength) c.news.length = CAREER.logLength
}

/**
 * The raid is over (or the garage sat it out): pay out, put the truck right,
 * see who won each class and who copied them, and move on to the next raid
 * (and the next year after the Long One).
 * @param state the raid the garage was in (own or contract), or null if it sat this one out.
 * @param retired true if you retired from your own raid before the end.
 */
export function settle(c: CareerState, state: RaidState | null, retired = false): Settlement {
  const e = nextEvent(c)
  const tier = TIERS[e.tier]
  const job = c.job
  if (state && !job) throw new Error('No job to settle')
  if (state && !retired && state.phase !== 'done') throw new Error('The raid is still going')
  const brokeBefore = isBroke(c)
  const repBefore = c.rep
  const out: Settlement = {
    raid: e.raid, job: state ? job!.kind : null, pos: null, of: 0, finished: false,
    prize: 0, fee: 0, bonus: 0, repairs: 0, spares: 0, money: 0, rep: 0,
    winners: {} as Record<ClassId, string>, copies: [], wonLongOne: false,
  }
  const rng = new Rng(hashString(`${c.seed}:${c.season}:${c.next}:settle`))
  let mineCls: ClassId | null = null

  if (state && job) {
    const cls = state.entry.build.cls
    mineCls = cls
    const table = standings(state)
    out.of = table.length
    out.winners[cls] = table[0]!.who
    if (!retired) {
      out.pos = table.findIndex((x) => x.who === 'you') + 1
      out.finished = state.results.every((r) => !r.late)
    } else {
      // A retired truck isn't classified: the rivals' order stands without it
      // (or, if it retired before the first stage was done, the whole raid's estimate).
      const rest = table.filter((x) => x.who !== 'you')
      out.winners[cls] = rest[0]?.who ?? rivalsOnly(c, cls)[0] ?? ''
    }
    const pos = out.pos
    const earned = pos === 1 ? 'win' : pos !== null && pos <= 3 ? 'podium' : out.finished ? 'finish' : null
    if (job.kind === 'own') {
      out.prize = pos !== null ? (tier.prizes[pos - 1] ?? 0) * CLASS_MONEY[cls] : 0
      const bill = repairBill(c, state)
      out.repairs = bill.repairs
      out.spares = bill.spares
      out.rep = earned ? tier.repFor[earned] : 0
      c.stats.raids++
      if (pos === 1) c.stats.wins++
      if (pos !== null && pos <= 3) c.stats.podiums++
      if (e.tier === 'long' && pos === 1) {
        out.wonLongOne = true
        c.longOne.push(c.year)
      }
    } else {
      out.fee = job.contract.fee
      out.bonus = earned ? job.contract.bonus[earned] : 0
      out.rep = earned ? Math.round(tier.repFor[earned] / 2) : 0
      c.stats.contracts++
    }
    out.money = out.prize + out.fee + out.bonus - out.repairs - out.spares
    c.money += out.money
    c.rep += out.rep
    addNews(c, { kind: 'result', year: c.year, raid: e.raid, cls, job: job.kind, pos: out.pos, of: out.of, money: out.money, rep: out.rep })
    if (out.wonLongOne) addNews(c, { kind: 'longOne', year: c.year })
  } else {
    addNews(c, { kind: 'skipped', year: c.year, raid: e.raid })
  }

  // Every class has a winner, and the teams copy what won.
  for (const cls of CLASSES.map((x) => x.id)) {
    if (cls !== mineCls) out.winners[cls] = rivalsOnly(c, cls)[0] ?? ''
    const who = out.winners[cls]
    if (!who) continue
    addNews(c, { kind: 'winner', year: c.year, raid: e.raid, cls, who })
    const winTeam = teamOf(who)
    const winner = who === 'you' && state ? state.entry.build : winTeam ? c.teams[winTeam][cls] : undefined
    if (!winner) continue
    for (const id of Object.keys(TEAMS) as TeamId[]) {
      if (id === winTeam) continue
      const slots = copyWinner(c.teams, id, winner, c.year, rng.fork(`${id}:${cls}`))
      if (slots.length) {
        const item = { kind: 'copied' as const, year: c.year, team: id, cls, slots, from: who }
        out.copies.push(item)
        addNews(c, item)
      }
    }
  }

  // Sponsors who came in with this result.
  SPONSORS.forEach((s, k) => {
    if (repBefore < s.rep && c.rep >= s.rep) addNews(c, { kind: 'sponsor', year: c.year, sponsor: k })
  })
  if (!brokeBefore && isBroke(c)) addNews(c, { kind: 'broke', year: c.year })

  // On to the next raid, and the next year after the last one.
  c.day = e.day + eventDays(e)
  c.job = null
  c.next++
  if (c.next >= CALENDAR.length) newSeason(c)
  return out
}

/** A new year: the teams buy for it, and the news says what parts came out. */
function newSeason(c: CareerState): void {
  c.season++
  c.next = 0
  c.day = 1
  const year = Math.min(LAST_YEAR, FIRST_YEAR + c.season)
  const newYear = year !== c.year
  c.year = year
  c.teams = teamsForYear(year, c.teams)
  if (newYear) {
    const parts = PARTS.filter((p) => p.year === year).map((p) => p.id)
    if (parts.length) addNews(c, { kind: 'newParts', year, parts })
  }
}

/** Is the next raid one you could enter yourself, reputation-wise? */
export function tierOpen(c: CareerState, tier: Tier = nextEvent(c).tier): boolean {
  return c.rep >= TIERS[tier].rep
}
