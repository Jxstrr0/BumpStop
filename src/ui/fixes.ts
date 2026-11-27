/**
 * Fix jumps (plan PR 4): each fix on the report is a tap that takes the
 * player to the part or slider that changes it on the build screen, opens
 * it, and highlights it for a moment.
 *
 * `fixJump` works out where a fix goes for this break and this build (the
 * front or rear axle, and only sliders the parts actually have);
 * `jumpTo` does the scrolling. The build screen marks its rows with
 * `data-slot`, `data-end` and slider ids `tune-<end>-<setting>`.
 */
import type { FixTarget } from '../data/failures'
import type { AxleSettings, TruckBuild } from '../data/kit'
import type { DamperPart, SlotId } from '../data/parts'
import { partIn, partsFor } from '../sim/build'
import { reveal } from './dom'

export type End = 'front' | 'rear'

export type Jump = { kind: 'slot'; slot: SlotId } | { kind: 'slider'; end: End; key: keyof AxleSettings }

/** The end of the truck a corner is on (0 and 1 are the front). Frame breaks pick the front. */
export function endOf(corner: number): End {
  return corner >= 2 ? 'rear' : 'front'
}

/** Where a fix goes, or null if there's nothing to jump to yet (a slower pace waits for the raids). */
export function fixJump(target: FixTarget, end: End, b: TruckBuild): Jump | null {
  const slider = (key: keyof AxleSettings): Jump => ({ kind: 'slider', end, key })
  switch (target) {
    case 'damperSize':
    case 'spoolValve':
      return { kind: 'slot', slot: 'dampers' }
    case 'compression': {
      // Only dampers with a compression adjuster have the slider; otherwise the dampers slot.
      const clicks = partIn(b, 'dampers').clicks
      if (clicks.compHigh > 0) return slider('compHigh')
      if (clicks.compLow > 0) return slider('compLow')
      return { kind: 'slot', slot: 'dampers' }
    }
    case 'pace':
      return null
    case 'springRate':
      return slider('springRate')
    case 'bumpStops':
      return slider('bumpStop')
    case 'rideHeight':
      return slider('preload')
    case 'mounts':
      return { kind: 'slot', slot: end === 'front' ? 'frontSusp' : 'rearSusp' }
    case 'limitStraps':
      return slider('droopLimit')
    case 'axles':
      return { kind: 'slot', slot: 'axles' }
    case 'tirePressure':
      return slider('tirePressure')
    case 'tireCasing':
      return { kind: 'slot', slot: 'tires' }
    case 'beadlocks':
      return { kind: 'slot', slot: 'wheels' }
    case 'frame':
    case 'gussets':
      return { kind: 'slot', slot: 'frame' }
    case 'lighterWheels':
      return { kind: 'slot', slot: 'wheels' }
    case 'recoveryKit':
      return { kind: 'slot', slot: 'recovery' }
    case 'rebound':
    case 'lessRebound': {
      const clicks = partIn(b, 'dampers').clicks
      return clicks.rebound > 0 ? slider('rebound') : { kind: 'slot', slot: 'dampers' }
    }
  }
}

/** The dampers this class can buy by `year`. */
function dampersOnSale(b: TruckBuild, year: number): DamperPart[] {
  return partsFor(b.cls, 'dampers').filter((p): p is DamperPart => p.slot === 'dampers' && p.year <= year)
}

/**
 * Does this fix make sense for this truck in this year? A fix that only
 * works with a part that isn't out yet (a remote-reservoir shock in 1985),
 * or a slider that's already as far as it goes, doesn't: the report skips it
 * and shows the next one instead (Kelbo's playtest, 26 November 2026).
 */
export function fixUseful(target: FixTarget, end: End, b: TruckBuild, year: number): boolean {
  const fitted = partIn(b, 'dampers')
  const set = b[end]
  switch (target) {
    case 'damperSize':
      // A bigger shock: one on sale that holds more heat than the one fitted.
      return dampersOnSale(b, year).some((p) => p.heat > fitted.heat)
    case 'compression': {
      // The slider if the shock has one and it isn't all the way soft; otherwise a shock with an adjuster that's on sale.
      const c = fitted.clicks
      if (c.compHigh > 0) return set.compHigh > -c.compHigh
      if (c.compLow > 0) return set.compLow > -c.compLow
      return dampersOnSale(b, year).some((p) => p.clicks.compLow > 0 || p.clicks.compHigh > 0)
    }
    case 'lessRebound':
      if (fitted.clicks.rebound > 0) return set.rebound > -fitted.clicks.rebound
      return dampersOnSale(b, year).some((p) => p.clicks.rebound > 0)
    case 'rebound':
      if (fitted.clicks.rebound > 0) return set.rebound < fitted.clicks.rebound
      return dampersOnSale(b, year).some((p) => p.clicks.rebound > 0)
    case 'spoolValve':
      // Position-sensitive dampers that firm up at the end of the stroke: only once on sale, and not if they're fitted.
      return !fitted.spool && dampersOnSale(b, year).some((p) => p.spool !== undefined)
    case 'lighterWheels': {
      const wheels = partIn(b, 'wheels')
      return partsFor(b.cls, 'wheels').some((p) => p.year <= year && (p.mass[b.cls] ?? Infinity) < (wheels.mass[b.cls] ?? 0))
    }
    default:
      return true
  }
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Flash a row so the eye finds it after the scroll. */
function flash(node: HTMLElement): void {
  node.classList.remove('jumped')
  // Restart the highlight if the same row is jumped to twice.
  void node.offsetWidth
  node.classList.add('jumped')
  window.setTimeout(() => node.classList.remove('jumped'), 2400)
}

/** Scroll to the part or slider, open its section, focus it and highlight it. Returns false if it isn't on screen. */
export function jumpTo(jump: Jump, root: ParentNode = document): boolean {
  if (jump.kind === 'slot') {
    const details = root.querySelector<HTMLDetailsElement>(`details.slot[data-slot="${jump.slot}"]`)
    if (!details) return false
    details.open = true
    // The slot's heading, not the middle of its (long) list of choices.
    const summary = details.querySelector<HTMLElement>('summary') ?? details
    reveal(summary, { behavior: smooth(), block: 'center' })
    const checked = details.querySelector<HTMLInputElement>('input:checked') ?? details.querySelector<HTMLElement>('summary')
    checked?.focus({ preventScroll: true })
    flash(details)
    return true
  }
  const details = root.querySelector<HTMLDetailsElement>(`details.axle[data-end="${jump.end}"]`)
  const input = document.getElementById(`tune-${jump.end}-${jump.key}`)
  if (!details || !input) return false
  details.open = true
  const row = input.closest<HTMLElement>('.setting') ?? input
  reveal(row, { behavior: smooth(), block: 'center' })
  input.focus({ preventScroll: true })
  flash(row)
  return true
}
