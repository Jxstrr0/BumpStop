/**
 * The jump ramp's report (v1.20, Kelbo picked it, 27 November 2026). From
 * the top:
 *
 * 1. What happened: it took every jump, or what let go and on which jump.
 * 2. How far up the speeds it landed clean, and the best landing.
 * 3. A note from the crew chief on the worst habit (bottoming, nose dives,
 *    bounces, or flying past the slope).
 * 4. Every landing: its score and word, where it came down, the nose angle,
 *    the bump stops, bottom-outs and bounces. Beside each, the same jump on
 *    the last run here and on the ghost truck (if it raced one): before and
 *    after on the same ramp, a higher score being the calmer landing.
 * 5. If something broke, why, with its trace, as on the other rigs.
 * 6. Up to three fixes, each a jump to the part or slider.
 */
import { FAILURES, type FixTarget } from '../data/failures'
import { PACE_CHECK } from '../data/paceCheck'
import { t, tf, type StringKey } from '../data/strings'
import type { LapRun } from '../sim/laps'
import type { LandingScore } from '../sim/landing'
import { msToKmh } from '../sim/units'
import { el, num } from './dom'
import { endOf, type End } from './fixes'
import { gradeChip, landingSummary } from './landingText'
import { paceCheckBlock } from './paceCheck'
import { crewNote, fixButtons, kicker, runAgainButton, traceBlock, whereText, type LapGhost, type ReportContext } from './report'

/** A ghost truck the run raced: who it was, and its landings as driven beside yours. */
export interface JumpRival {
  who: string
  landings: readonly LandingScore[]
}

/** Better, Same or Worse, with a margin so a point or two either way counts as the same. */
const SAME_WITHIN = 3
type Verdict = 'better' | 'same' | 'worse'
const VERDICT_BAND: Record<Verdict, string> = { better: 'cool', same: 'warm', worse: 'hot' }
function verdictOf(now: number, then: number): Verdict {
  return now > then + SAME_WITHIN ? 'better' : now < then - SAME_WITHIN ? 'worse' : 'same'
}

/** The fastest jump that landed clean (m/s), or null. */
export function cleanUpTo(landings: readonly LandingScore[]): number | null {
  let best: number | null = null
  for (const l of landings) if (l.grade === 'clean' && (best === null || l.speed > best)) best = l.speed
  return best
}

export function jumpReport(run: LapRun, stopped: boolean, ghost: LapGhost | null, ctx: ReportContext, rival: JumpRival | null): HTMLElement {
  const box = el('section', 'report jump-report')
  box.setAttribute('aria-labelledby', 'report-head')
  const last = run.laps[run.laps.length - 1]
  const n = String(last?.lap ?? 0)
  const speed = num(msToKmh(last?.speed ?? 0))
  const head = el('h3', 'report-head')
  head.id = 'report-head'
  head.tabIndex = -1
  const ev = run.broken
  const landings = run.landings
  box.append(el('h2', '', t('report.title')), kicker(ctx), head)

  if (ev) {
    head.append(el('span', 'chip hot', t('trace.hot')), ' ', tf('jump.headBroke', { what: t(FAILURES[ev.kind].name), where: whereText(ev), n: String(run.brokenLap), speed }))
  } else {
    head.append(el('span', 'chip cool', t('trace.cool')), ' ', stopped ? tf('jump.headStopped', { n, speed }) : tf('jump.headLasted', { n, speed }))
  }

  // How far up the speeds it stayed clean, and the best one.
  const clean = cleanUpTo(landings)
  const best = landings.reduce<LandingScore | null>((b, l) => (!b || l.score > b.score ? l : b), null)
  const sums: string[] = [clean !== null ? tf('jump.cleanUpTo', { speed: num(msToKmh(clean)) }) : t('jump.noClean')]
  if (best) sums.push(tf('jump.best', { score: String(best.score), speed: num(msToKmh(best.speed)) }))
  box.append(el('p', 'jump-sum', sums.join(' ')))

  const habit = worstHabit(landings)
  box.append(crewNote(habit === 'flat' ? tf('jump.crewFlat', { speed: num(msToKmh(firstFlat(landings) ?? 0)) }) : t(CREW[habit])))

  if (landings.length > 0) box.append(landingList(landings, ghost, rival))

  if (ev) {
    box.append(el('p', 'cause', t(FAILURES[ev.kind].cause)))
    if (run.trace) box.append(traceBlock(ev, run.trace, ghost, ctx.truck))
  }

  const fixes = [
    ...(ev ? FAILURES[ev.kind].fixes.map((f) => ({ ...f, end: endOf(ev.corner) })) : []),
    ...landingFixes(landings),
  ]
  // The same fix twice (a break and a landing both saying bump stops) shows once.
  const seen = new Set<string>()
  const unique = fixes.filter((f) => {
    const key = `${f.target}:${f.end}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length > 0) box.append(el('h4', '', t('report.fixes')), fixButtons(unique, ctx))

  if (ctx.rig !== 'shaker') {
    box.append(paceCheckBlock(ctx.truck, null, PACE_CHECK.rigGround[ctx.rig], PACE_CHECK.shopAirC, 'paceCheck.leadRig'))
  }
  box.append(runAgainButton(ctx))
  return box
}

type Habit = 'clean' | 'bottom' | 'nose' | 'bounce' | 'flat'
const CREW: Record<Exclude<Habit, 'flat'>, StringKey> = {
  clean: 'jump.crewClean',
  bottom: 'jump.crewBottom',
  nose: 'jump.crewNose',
  bounce: 'jump.crewBounce',
}

/** A landing more than this far nose down counts as a nose dive (degrees). */
const NOSE_DIVE = 8

/** What went wrong most, on the landings that came down on the slope (past it, nothing helps for long). */
function worstHabit(landings: readonly LandingScore[]): Habit {
  const onSlope = landings.filter((l) => l.spot === 'slope' || l.spot === 'short')
  const count = (f: (l: LandingScore) => boolean) => onSlope.filter(f).length
  const tally: [Habit, number][] = [
    ['bottom', count((l) => l.bottoms.some((b) => b > 0))],
    ['nose', count((l) => l.angle < -NOSE_DIVE)],
    ['bounce', count((l) => l.bounces > 0)],
  ]
  tally.sort((a, b) => b[1] - a[1])
  if (tally[0]![1] > 0) return tally[0]![0]
  return landings.some((l) => l.spot === 'flat') ? 'flat' : 'clean'
}

function firstFlat(landings: readonly LandingScore[]): number | null {
  const f = landings.find((l) => l.spot === 'flat')
  return f ? f.speed : null
}

/** The fixes the landings call for, most useful first. */
function landingFixes(landings: readonly LandingScore[]): { target: FixTarget; text: StringKey; end: End }[] {
  const out: { target: FixTarget; text: StringKey; end: End }[] = []
  let front = 0
  let rear = 0
  for (const l of landings) {
    front += (l.bottoms[0] > 0 ? 1 : 0) + (l.bottoms[1] > 0 ? 1 : 0)
    rear += (l.bottoms[2] > 0 ? 1 : 0) + (l.bottoms[3] > 0 ? 1 : 0)
  }
  if (front + rear > 0) {
    const end: End = rear >= front ? 'rear' : 'front'
    out.push({ target: 'bumpStops', text: 'fix.bumpStops', end })
    out.push({ target: 'springRate', text: 'fix.softerSprings', end })
  }
  if (landings.some((l) => l.angle < -NOSE_DIVE)) out.push({ target: 'rebound', text: 'fix.landRebound', end: 'rear' })
  else if (landings.some((l) => l.bounces > 0)) out.push({ target: 'rebound', text: 'fix.landBounce', end: 'rear' })
  return out
}

/** Every landing, with the same jump on the last run and the ghost beside it. */
function landingList(landings: readonly LandingScore[], ghost: LapGhost | null, rival: JumpRival | null): HTMLElement {
  const wrap = el('div', 'jump-landings')
  const lastScores = ghost?.landings ?? null
  // Racing your best when your best was also the last run: one column says it all.
  if (rival && lastScores && rival.landings.length === lastScores.length && rival.landings.every((g, k) => g.score === lastScores[k])) rival = null
  const tallyLast = { better: 0, same: 0, worse: 0 }
  const tallyGhost = { better: 0, same: 0, worse: 0 }
  const list = el('ol', 'jump-list')
  for (const l of landings) {
    const li = el('li', 'jump-row')
    const top = el('p', 'jump-row-head')
    top.append(gradeChip(l), ' ', tf('jump.row', { n: String(l.lap), speed: num(msToKmh(l.speed)) }))
    li.append(top, el('p', 'small jump-row-what', landingSummary(l)))
    const vs = el('p', 'small jump-row-vs')
    const then = lastScores?.[l.lap - 1]
    if (typeof then === 'number') {
      const v = verdictOf(l.score, then)
      tallyLast[v]++
      vs.append(el('span', `chip ${VERDICT_BAND[v]}`, t(`report.${v}` as StringKey)), ' ', tf('jump.vsLast', { score: String(then) }))
    }
    const theirs = rival?.landings.find((g) => g.lap === l.lap)
    if (rival && theirs) {
      const v = verdictOf(l.score, theirs.score)
      tallyGhost[v]++
      if (vs.childNodes.length) vs.append(' · ')
      vs.append(el('span', `chip ${VERDICT_BAND[v]}`, t(`report.${v}` as StringKey)), ' ', tf('jump.vsGhost', { who: rival.who, score: String(theirs.score) }))
    }
    if (vs.childNodes.length) li.append(vs)
    list.append(li)
  }
  wrap.append(el('h4', '', t('jump.title')))
  const hasLast = tallyLast.better + tallyLast.same + tallyLast.worse > 0
  const hasGhost = tallyGhost.better + tallyGhost.same + tallyGhost.worse > 0
  if (hasLast || hasGhost) {
    wrap.append(el('p', 'small', tf('jump.vsLegend', { ghost: hasGhost ? t('jump.vsLegendGhost') : '' })))
    const sums: string[] = []
    if (hasLast) sums.push(tf('jump.compareSum', { better: String(tallyLast.better), same: String(tallyLast.same), worse: String(tallyLast.worse) }))
    if (hasGhost) sums.push(tf('jump.compareSumGhost', { better: String(tallyGhost.better), same: String(tallyGhost.same), worse: String(tallyGhost.worse) }))
    wrap.append(el('p', 'jump-compare', sums.join(' ')))
  }
  wrap.append(list)
  return wrap
}
