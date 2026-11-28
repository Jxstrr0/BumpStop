/**
 * Rival drivers with grudges (Kelbo picked it, 28 November 2026). Every
 * tuning number for grudges lives here; `src/sim/grudges.ts` uses them.
 *
 * In the career each rival team's truck has a named driver, drawn from the
 * driver pool (`DRIVERS[id].pool`): the names your own garage didn't hire
 * this career. Those drivers remember you:
 *
 * - **Beat them** at a raid or a one-day round and they get sore. Take a win
 *   off them (you first, them second) and it stings more.
 * - **Bump them in the dust:** a quicker truck catches slower ones on a
 *   stage (they start a couple of minutes apart) and has to squeeze past.
 *   Sometimes it's a door rub. On Push that happens far more often. Passing
 *   a truck that's stopped with trouble doesn't count.
 * - **They settle the score** when they beat you, and cool off.
 * - **Time heals:** a raid where they don't meet you cools them a little,
 *   and a new year halves every grudge.
 *
 * A driver with a grudge drives your class's raids and rounds harder:
 * quicker, but they break down more. Nobody gets hurt: it's all on the clock.
 */
import type { ClassId } from './classes'
import type { TeamId } from './career'
import type { DriverId, PaceId } from './raids'

/** How sore a driver is: 0 not at all, then Sore, Grudge, Feud. */
export type GrudgeLevel = 0 | 1 | 2 | 3

export const GRUDGE = {
  /** Heat it takes to reach each level (Sore, Grudge, Feud). */
  levels: [2, 4, 6] as const,
  /** Heat never goes above this. */
  max: 8,
  /** Heat from finishing ahead of them at a raid or a round. */
  beat: 1,
  /** More on top when you win and they're second. */
  tookWin: 1,
  /** Heat from a door rub in the dust (once a raid per driver). */
  bump: 2,
  /** Heat lost when they finish ahead of you: score settled. */
  settled: 2,
  /** Heat lost at a raid where they don't meet you (another class, another tier, or you sat it out). */
  cool: 1,
  /** A new year: every grudge is multiplied by this, rounded down. */
  newYear: 0.5,
  /** By level: share taken off their pace (quicker)... */
  pace: [0, 0.01, 0.02, 0.03] as const,
  /** ...and extra chance of trouble, as a share on top (they push the truck too hard). */
  risk: [0, 0.15, 0.3, 0.5] as const,
  /** Starters on a stage go this far apart (s): you have to make that up to catch the truck ahead. */
  startGap: 120,
  /** Chance that catching a truck ends in a door rub, by the hardest pace called on the stage. */
  bumpChance: { conserve: 0.1, steady: 0.25, push: 0.5 } satisfies Record<PaceId, number>,
} as const

/**
 * Which trade drives for each team in each class it races. The trade's pool
 * (`DRIVERS`) gives the name. Chosen to suit the team: Tundra Dogs push hard
 * (chargers), Ironwood Brothers keep it together (a veteran and a
 * mechanic), Jackrabbit and Goldpan want speed on the loose stuff. With the
 * garage's own hire taken out, each pool has three names left, and no trade
 * is asked for more than three.
 */
export const RIVAL_TRADES: Readonly<Record<TeamId, Partial<Record<ClassId, DriverId>>>> = {
  brannigan: { light4x4: 'charger', sxs: 'charger' },
  highbank: { light4x4: 'gravelAce', heavy: 'veteran', sxs: 'gravelAce' },
  hardpan: { heavy: 'mechanic', light4x4: 'veteran' },
  jackrabbit: { sxs: 'gravelAce', light4x4: 'charger' },
}
