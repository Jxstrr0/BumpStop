/**
 * Rival teams with their own trucks (plan PR 9): each team buys parts for a
 * new year in its own way, copies what wins, and its truck sets its pace and
 * how often it gets into trouble on a raid.
 *
 * Rivals still don't go through the ride sim: a whole field of trucks would
 * take too long on a phone (`rivals.ts`). Instead their truck gives them a
 * few ratings against the class's stock truck (how much heat its dampers
 * take, how much travel, how strong, how much power for its weight), and
 * those set the `pace` and `risk` that `rivalStages` uses. So a team that
 * buys bypass dampers really does get quicker and break down less.
 *
 * Pure and seeded: no DOM, no clock.
 */
import { CLASSES, type ClassId } from '../data/classes'
import type { Rival } from '../data/raids'
import { KITS, type TruckBuild } from '../data/kit'
import { PRIVATEERS, TEAM_TUNING, TEAMS, type TeamId, type TeamSpec, type Tier } from '../data/career'
import { SLOTS, type Part, type SlotId } from '../data/parts'
import { buildTruck, massAndCost, partIn, partsFor, stockBuild, tidyBuild } from './build'
import { detLog, detPow } from './det'
import type { Rng } from './rng'

/** What a team can spend on one class's truck in a year. */
export function teamBudget(team: TeamSpec, cls: ClassId, year: number): number {
  return KITS[cls].budget * team.budget * (1 + TEAM_TUNING.budgetGrowth * (year - TEAM_FIRST_YEAR))
}

const TEAM_FIRST_YEAR = 1985

/** Does the team race this class this year, and under which number? */
export function teamClass(team: TeamSpec, cls: ClassId, year: number): { number: number } | null {
  const c = team.classes.find((x) => x.cls === cls)
  return c && year >= c.from ? { number: c.number } : null
}

function fits(b: TruckBuild, budget: number): boolean {
  const cls = CLASSES.find((c) => c.id === b.cls)!
  const { mass, cost } = massAndCost(b)
  return cost <= budget && mass >= cls.minMass && mass <= cls.maxMass
}

/** Is `next` better than `now` for this way of buying? */
function better(habit: TeamSpec['buy'], cls: ClassId, next: Part, now: Part): boolean {
  if (next.id === now.id) return false
  const cost = (p: Part) => p.cost[cls] as number
  const mass = (p: Part) => p.mass[cls] as number
  switch (habit) {
    case 'newest':
      return next.year > now.year || (next.year === now.year && cost(next) > cost(now))
    case 'light':
      return mass(next) < mass(now) || (mass(next) === mass(now) && cost(next) > cost(now))
    case 'strong':
    case 'power':
      // Dearer parts are the stronger and more powerful ones in every slot.
      return cost(next) > cost(now)
  }
}

/**
 * The team's truck for a class this year: last year's (or stock), with each
 * slot on its list upgraded in its own way while the budget and the weight
 * window allow. Settings stay the class's stock settings, tidied to fit.
 */
export function teamBuild(team: TeamSpec, cls: ClassId, year: number, prev?: TruckBuild): TruckBuild {
  let b = structuredClone(prev ?? stockBuild(cls))
  const budget = teamBudget(team, cls, year)
  for (const slot of team.priority) {
    const options = partsFor(cls, slot).filter((p) => p.year <= year)
    // Best first, so the first that fits the budget is the one they buy.
    const ranked = options.slice().sort((a, c) => (better(team.buy, cls, a, c) ? -1 : better(team.buy, cls, c, a) ? 1 : 0))
    for (const p of ranked) {
      if (!better(team.buy, cls, p, partIn(b, slot))) break
      const trial = { ...b, parts: { ...b.parts, [slot]: p.id } }
      if (fits(trial, budget)) {
        b = trial
        break
      }
    }
  }
  return tidyBuild(b)
}

// ── From truck to pace ──

/** A truck against its class's stock truck: 1 everywhere means stock. */
export interface Ratings {
  /** How much heat the dampers take and shed, and how hot they can run. */
  heat: number
  /** Wheel travel. */
  travel: number
  /** Frame, axles, mounts, tires and bump stops together. */
  strength: number
  /** Power for its weight. */
  power: number
}

export function ratings(b: TruckBuild): Ratings {
  const damper = partIn(b, 'dampers')
  const front = partIn(b, 'frontSusp')
  const rear = partIn(b, 'rearSusp')
  const strength = detPow(
    partIn(b, 'frame').strength * partIn(b, 'axles').strength * ((front.mount + rear.mount) / 2) *
      partIn(b, 'tires').casing * partIn(b, 'bumpStops').strength,
    1 / 5,
  )
  const truck = buildTruck(b)
  const stock = buildTruck(stockBuild(b.cls))
  return {
    heat: damper.heat * damper.cool * (1 + damper.tempLimit / 60),
    travel: (front.travel + rear.travel) / 2,
    strength,
    power: truck.power / truck.mass / (stock.power / stock.mass),
  }
}

function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** A team's pace (share of par) and chance of trouble on an average stage, from its driver and its truck. */
export function teamPace(team: TeamSpec, b: TruckBuild): { pace: number; risk: number } {
  const r = ratings(b)
  const k = TEAM_TUNING
  const quicker = k.paceFromHeat * detLog(r.heat) + k.paceFromTravel * (r.travel - 1) + k.paceFromPower * detLog(r.power)
  const pace = clamp(team.pace * (1 - quicker), k.paceLimits)
  const risk = clamp(k.risk * team.hardness * detPow(r.strength, -k.riskFromStrength) * detPow(r.heat, -k.riskFromHeat), k.riskLimits)
  return { pace, risk }
}

/** The team's entry in a raid, as `rivalStages` reads it. */
export function teamRival(teamId: TeamId, cls: ClassId, number: number, b: TruckBuild): Rival {
  const team = TEAMS[teamId]
  const { pace, risk } = teamPace(team, b)
  return {
    id: `${teamId}${number}`,
    team: team.name,
    number,
    cls,
    pace,
    spread: TEAM_TUNING.spread,
    risk,
    delay: TEAM_TUNING.delay,
    trouble: team.trouble,
    habit: team.habit,
  }
}

/** The privateers' entries in a class: stock trucks, known by their race numbers. */
export function privateerRivals(cls: ClassId): Rival[] {
  return PRIVATEERS.filter((p) => p.cls === cls).map((p) => ({
    id: `privateer${p.number}`,
    team: 'team.privateer',
    number: p.number,
    cls,
    pace: p.pace,
    spread: 0.04,
    risk: p.risk,
    delay: [0.3, 1.8],
    trouble: p.trouble,
    habit: 'habit.privateer',
  }))
}

/** Every team's truck, by class: only the classes a team races that year. */
export type TeamGarage = Record<TeamId, Partial<Record<ClassId, TruckBuild>>>

/** Who's in a class at a raid of this tier, with the trucks they have now. */
export function careerField(teams: TeamGarage, cls: ClassId, tier: Tier, year: number): Rival[] {
  const out: Rival[] = []
  for (const team of Object.values(TEAMS)) {
    const c = teamClass(team, cls, year)
    const b = teams[team.id][cls]
    if (c && b && team.tiers.includes(tier)) out.push(teamRival(team.id, cls, c.number, b))
  }
  return [...out, ...privateerRivals(cls)]
}

/** Each team's trucks for a new year: last year's, upgraded; a class they join this year starts from stock. */
export function teamsForYear(year: number, prev?: TeamGarage): TeamGarage {
  const out = {} as TeamGarage
  for (const team of Object.values(TEAMS)) {
    out[team.id] = {}
    for (const c of team.classes) {
      if (year < c.from) continue
      out[team.id][c.cls] = teamBuild(team, c.cls, year, prev?.[team.id][c.cls])
    }
  }
  return out
}

/**
 * After a raid, a team may copy the class winner's parts, slot by slot
 * (plan: "who copy what wins"). Only parts out this year, inside its budget
 * and the weight window. Returns the slots it copied.
 */
export function copyWinner(teams: TeamGarage, teamId: TeamId, winner: TruckBuild, year: number, rng: Rng): SlotId[] {
  const team = TEAMS[teamId]
  const mine = teams[teamId][winner.cls]
  if (!mine) return []
  const budget = teamBudget(team, winner.cls, year)
  let b = mine
  const copied: SlotId[] = []
  for (const slot of SLOTS) {
    if (winner.parts[slot] === b.parts[slot]) continue
    if (!rng.chance(team.copy)) continue
    if (partIn(winner, slot).year > year) continue
    const trial = { ...b, parts: { ...b.parts, [slot]: winner.parts[slot] } }
    if (fits(trial, budget)) {
      b = trial
      copied.push(slot)
    }
  }
  if (copied.length) teams[teamId][winner.cls] = tidyBuild(b)
  return copied
}
