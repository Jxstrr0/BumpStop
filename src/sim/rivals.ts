/**
 * Rival entries on a raid (plan PR 7).
 *
 * The player's truck is driven by the full ride sim. The rivals are not: a
 * whole field of trucks through the sim would take too long on a phone. Each
 * rival is a quick, seeded estimate instead, from the numbers in
 * `src/data/raids.ts`: a clean run takes their `pace` times the stage's par
 * time (wandering by `spread`), and on some stages trouble costs them time.
 * Harsh stages bring more trouble. The same raid always gives the same
 * rival results, so a second go is a fair comparison.
 *
 * In the career (plan PR 9) the field comes from `teams.ts` instead: rival
 * teams with their own trucks, whose parts set their pace and trouble.
 */
import type { ClassId } from '../data/classes'
import { CLASS_WORK, RAID, RIVAL_HARSH_AVERAGE, RIVALS, type Rival, type RivalTrouble } from '../data/raids'
import { hashString, Rng } from './rng'

export interface RivalStage {
  id: string
  /** Time at each checkpoint and the finish (s from the start), so the checkpoints can show the gaps. */
  splits: number[]
  /** The stage time (s), with any towing penalty. */
  time: number
  /** What cost them time, on which leg, and how much (s), or null for a clean run. */
  trouble: { kind: RivalTrouble; leg: number; lost: number } | null
  /** Still out when the stage closed. */
  late: boolean
}

export function rivalsIn(cls: ClassId): Rival[] {
  return RIVALS.filter((r) => r.cls === cls)
}

/**
 * Every rival's run on one stage.
 * @param legPar each leg's par time (s): Steady, average driver, no stops.
 * @param km the stage's length.
 * @param harsh the share of the stage on harsh ground (0 to 1).
 * @param field who's entered: the free-play rivals by default, or the career's teams (`teams.ts`).
 */
export function rivalStages(
  cls: ClassId, legPar: readonly number[], km: number, harsh: number, seed: number, field: readonly Rival[] = rivalsIn(cls),
): RivalStage[] {
  const par = legPar.reduce((a, b) => a + b, 0)
  const close = par * RAID.closeAfter
  return field.map((rival) => {
    const rng = new Rng(hashString(`${seed}:${rival.id}`))
    const clean = rival.pace * (1 + rival.spread * rng.range(-1, 1))
    const legs = legPar.map((p) => p * clean * (1 + (rival.spread / 2) * rng.range(-1, 1)))
    const chance = Math.min(0.9, rival.risk * (km / 100) * (harsh / RIVAL_HARSH_AVERAGE))
    let trouble: RivalStage['trouble'] = null
    if (rng.chance(chance)) {
      const leg = rng.int(0, legs.length - 1)
      const lost = rng.range(rival.delay[0], rival.delay[1]) * 3600 * CLASS_WORK[cls]
      const kind = rival.trouble[rng.int(0, rival.trouble.length - 1)] as RivalTrouble
      legs[leg] = (legs[leg] as number) + lost
      trouble = { kind, leg, lost }
    }
    const splits: number[] = []
    let sum = 0
    for (const t of legs) splits.push((sum += t))
    const late = sum > close
    return { id: rival.id, splits, time: late ? close + RAID.latePenalty : sum, trouble, late }
  })
}
