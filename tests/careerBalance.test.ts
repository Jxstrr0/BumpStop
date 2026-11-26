/**
 * The career's balance across the three classes (plan PR 13). The numbers
 * were tuned with the career bot (`scripts/harness/`, see `docs/BALANCE.md`);
 * these quick checks keep the shape of it from drifting:
 *
 * - every class has a rival quicker than par at every raid, and the quickest team in
 *   each class sits where a well-prepared truck on Push can beat it, while a
 *   stock truck on Steady can't (the player's Steady time is about par);
 * - reputation opens the Long One in the third or fourth season of podiums, and
 *   the works deal a couple of seasons after;
 * - the 1990s long-travel suspension isn't a trap on its factory settings.
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR, SPONSORS, TEAMS, TIERS, type TeamId } from '../src/data/career'
import { CLASSES } from '../src/data/classes'
import type { TruckBuild } from '../src/data/kit'
import { stockBuild, tidyBuild } from '../src/sim/build'
import { driveAuto } from '../src/sim/career'
import { enterRaid } from '../src/sim/raid'
import { careerField, teamPace, teamsForYear, type TeamGarage } from '../src/sim/teams'

/** Every year's teams, buying as they do (no copying). */
function everyYear(): { year: number; teams: TeamGarage }[] {
  const out: { year: number; teams: TeamGarage }[] = []
  let g: TeamGarage | undefined
  for (let year = 1985; year <= 2025; year++) out.push({ year, teams: (g = teamsForYear(year, g)) })
  return out
}

describe('rival teams across the classes', () => {
  const years = everyYear()

  it('every class has a rival quicker than par at every tier, every year', () => {
    for (const { year, teams } of years) for (const cls of CLASSES) for (const tier of ['regional', 'national', 'long'] as const) {
      const field = careerField(teams, cls.id, tier, year)
      expect(Math.min(...field.map((r) => r.pace)), `${year} ${cls.id} ${tier}`).toBeLessThan(0.98)
    }
  })

  it('the quickest team in each class is beatable on Push, not by a stock truck on Steady', () => {
    for (const { year, teams } of years) for (const cls of CLASSES) {
      const paces = (Object.keys(TEAMS) as TeamId[]).flatMap((id) => {
        const b = teams[id][cls.id]
        return b ? [teamPace(TEAMS[id], b).pace] : []
      })
      const best = Math.min(...paces)
      // Push is 12% quicker than Steady (par): a clean Push run is about 0.89 of par.
      expect(best, `${year} ${cls.id}`).toBeGreaterThan(0.85)
      expect(best, `${year} ${cls.id}`).toBeLessThan(0.98)
    }
  })
})

describe('reputation', () => {
  // A podium at every raid of a season, Long One left out.
  const season = CALENDAR.filter((e) => e.tier !== 'long').reduce((sum, e) => sum + TIERS[e.tier].repFor.podium, 0)

  it('opens the Long One in the third or fourth season of podiums', () => {
    expect(season * 2).toBeLessThan(TIERS.long.rep)
    expect(season * 4).toBeGreaterThanOrEqual(TIERS.long.rep)
  })

  it('brings the works deal a couple of seasons after that', () => {
    const works = SPONSORS[SPONSORS.length - 1]!
    expect(works.discount).toBeGreaterThan(0)
    expect(works.rep).toBeGreaterThanOrEqual(TIERS.long.rep + season * 2)
  })
})

describe('the 1990s suspension is no trap', () => {
  // Fitted on the stock light 4x4 with the factory settings, driven Steady:
  // no more snapped axles than the stock truck (the bot once found the
  // wishbones and trailing arms snapping one every few kilometres).
  const axleStops = (b: TruckBuild) => {
    const s = enterRaid('summerRaid', b, 'gravelAce', { seed: 11 })
    driveAuto(s)
    return s.results.reduce((n, r) => n + r.stops.filter((x) => x.kind === 'axle').length, 0)
  }
  const stock = stockBuild('light4x4')
  let base: number | undefined
  it.each([['frontSusp', 'wishbone'], ['rearSusp', 'trailingArm']] as const)('%s: %s', (slot, id) => {
    base ??= axleStops(stock)
    expect(axleStops(tidyBuild({ ...stock, parts: { ...stock.parts, [slot]: id } }))).toBeLessThanOrEqual(base + 1)
  }, 120_000)
})
