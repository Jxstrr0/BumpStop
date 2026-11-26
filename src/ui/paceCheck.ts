/**
 * The pace check on screen (playtest, 26 November 2026): one line per pace
 * call saying how hot the shocks settle and how fast the worst part wears,
 * in the trace rule's colours and words. The raid morning shows it for the
 * day's ground; the rig reports show it for the ground each rig stands for.
 * The sim is `src/sim/paceCheck.ts`.
 *
 * It's worked out a ground at a time between frames, so the page never
 * freezes while the ride sim drives.
 */
import { PACES, type DriverId, type PaceId, type RaidGround } from '../data/raids'
import { t, tf, type StringKey } from '../data/strings'
import type { BuiltTruck } from '../sim/build'
import { checkGround, verdict, type CheckBand, type GroundCheck, type PaceVerdict } from '../sim/paceCheck'
import { toCelsius } from '../sim/units'
import { BAND_WORD } from './charts'
import { el, num } from './dom'

const groundName = (g: RaidGround) => t(`ground.${g}` as StringKey).toLowerCase()

/** One pace call's line, in plain words. */
export function verdictText(v: PaceVerdict): string {
  const o = v.worstOil
  const w = v.worstWear
  const oil = o.broke === 'fade'
    ? tf('paceCheck.oilFade', { ground: groundName(o.ground) })
    : tf('paceCheck.oil', { oil: num(toCelsius(o.oil)), ground: groundName(o.ground), word: BAND_WORD[o.oilBand] })
  const wear = w.wear10 >= 1
    ? tf('paceCheck.wearBreak', { ground: groundName(w.ground) })
    : tf('paceCheck.wear', { pct: num(w.wear10 * 100, w.wear10 < 0.1 ? 1 : 0), ground: groundName(w.ground), word: t(`paceCheck.wear.${w.wearBand}` as StringKey) })
  return tf('paceCheck.line', { pace: t(`pace.${v.pace}` as StringKey), oil, wear })
}

const BAND_CLASS: Record<CheckBand, string> = { cool: 'cool-text', warm: 'warm-text', hot: 'hot-text' }

/**
 * The pace check block: a heading, a line on what it is, then a line per
 * pace call once worked out. `grounds` should be `groundsToCheck`ed; with
 * none, it says the ground is all fast and smooth.
 */
export function paceCheckBlock(truck: BuiltTruck, driver: DriverId | null, grounds: readonly RaidGround[], airC: number, lead: StringKey): HTMLElement {
  const box = el('div', 'pace-check')
  box.append(el('h4', 'raid-sub', t('paceCheck.head')))
  if (!grounds.length) {
    box.append(el('p', 'small', t('paceCheck.none')))
    return box
  }
  box.append(el('p', 'small', tf(lead, { air: num(airC) })))
  const list = el('ul', 'raid-list')
  const working = el('li', 'small', t('paceCheck.working'))
  list.append(working)
  box.append(list)
  const checks: Record<PaceId, GroundCheck[]> = { conserve: [], steady: [], push: [] }
  let k = 0
  // One ground (all three pace calls) per frame.
  const step = () => {
    if (!box.isConnected && k > 0) return
    const g = grounds[k]!
    for (const p of PACES) checks[p].push(checkGround(truck, driver, g, p, airC))
    k++
    if (k < grounds.length) {
      window.setTimeout(step, 0)
      return
    }
    working.remove()
    for (const p of PACES) {
      const v = verdict(p, checks[p])
      list.append(el('li', BAND_CLASS[v.band], verdictText(v)))
    }
  }
  window.setTimeout(step, 0)
  return box
}
