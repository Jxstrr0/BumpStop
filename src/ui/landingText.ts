/**
 * Words for a jump ramp landing (`src/sim/landing.ts`), shared by the live
 * line, the 3D caption and the report.
 */
import { LANDING } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import type { LandingGrade, LandingScore } from '../sim/landing'
import type { Band } from './charts'
import { el, num } from './dom'

/** The trace rule's colours for a landing: clean is cool, firm warm, hard hot. The word always goes with it. */
export const GRADE_BAND: Record<LandingGrade, Band> = { clean: 'cool', firm: 'warm', hard: 'hot' }

/** A chip with the landing's word and score: "Clean 87". */
export function gradeChip(score: LandingScore): HTMLElement {
  return el('span', `chip ${GRADE_BAND[score.grade]}`, `${t(`jump.word.${score.grade}` as StringKey)} ${score.score}`)
}

/** "Landed on the slope, nose 7° down, both bump stops, bottomed out at the rear left." */
export function landingSummary(s: LandingScore): string {
  const parts: string[] = [t(`jump.spot.${s.spot}` as StringKey)]
  const deg = num(Math.abs(s.angle))
  if (s.spot !== 'none') {
    parts.push(Math.abs(s.angle) < LANDING.levelWithin ? t('jump.angleLevel') : tf(s.angle < 0 ? 'jump.angleNose' : 'jump.angleTail', { deg }))
  }
  const [front, rear] = s.bumpStops
  if (front || rear) parts.push(t(front && rear ? 'jump.stopsBoth' : front ? 'jump.stopsFront' : 'jump.stopsRear'))
  const corners = s.bottoms.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0)
  if (corners.length === 1) parts.push(tf('jump.bottom1', { where: t(`cornerName.${corners[0]}` as StringKey).toLowerCase() }))
  else if (corners.length > 1) parts.push(tf('jump.bottomN', { n: String(corners.length) }))
  if (s.bounces === 1) parts.push(t('jump.bounce1'))
  else if (s.bounces > 1) parts.push(tf('jump.bounceN', { n: String(s.bounces) }))
  return `${parts.join(', ')}.`
}
