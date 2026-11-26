import { it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { TEAMS, type TeamId } from '../../src/data/career'
import { teamPace, teamsForYear, type TeamGarage } from '../../src/sim/teams'

/** Each team's pace (share of par) and trouble chance by year, buying with no copying. */
it('teams', () => {
  let g: TeamGarage | undefined
  for (let y = 1985; y <= 2025; y++) {
    g = teamsForYear(y, g)
    if (y % 5 !== 0) continue
    const row: string[] = []
    for (const id of Object.keys(TEAMS) as TeamId[]) for (const [cls, b] of Object.entries(g[id])) {
      const p = teamPace(TEAMS[id], b!)
      row.push(`${id}/${cls} ${p.pace.toFixed(3)} r${p.risk.toFixed(3)}`)
    }
    appendFileSync('/tmp/teams.txt', `${y}: ${row.join(' | ')}\n`)
  }
})
