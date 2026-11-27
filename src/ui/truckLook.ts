/**
 * Truck, X-ray or Both (Kelbo asked, 27 November 2026): how the truck looks
 * in every 3D view (the build screen, the test track, the raid stage and
 * photo mode).
 *
 * - Truck: as built.
 * - X-ray: the body comes off, so the frame, the engine and gearbox, and the
 *   suspension stand on their own.
 * - Both: the body stays as a faint see-through skin over all that.
 *
 * It's one pick for the whole game: change it in one view and every other
 * view follows. The phone remembers it, like the last tab.
 * `src/render/truckModel.ts` (`setLook`) does the drawing.
 */
import { TRUCK_LOOKS, type TruckLook } from '../data/graphics'
import { t, type StringKey } from '../data/strings'
import { el } from './dom'

const LOOK_KEY = 'bumpstop.truckLook'

export function readTruckLook(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): TruckLook {
  try {
    const saved = storage?.getItem(LOOK_KEY)
    return TRUCK_LOOKS.find((l) => l === saved) ?? 'truck'
  } catch {
    return 'truck'
  }
}

export function writeTruckLook(look: TruckLook, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(LOOK_KEY, look)
  } catch {
    // Nowhere to keep it; the next visit starts on Truck again.
  }
}

let current: TruckLook | null = null
const listeners = new Set<(look: TruckLook) => void>()

/** The look in play. */
export function truckLook(): TruckLook {
  return (current ??= readTruckLook())
}

/** Pick a look: every view and every toggle follows, and the phone remembers it. */
export function setTruckLook(look: TruckLook): void {
  if (look === truckLook()) return
  current = look
  writeTruckLook(look)
  for (const fn of listeners) fn(look)
}

/** Call `fn` with the look now and whenever it changes. */
export function followTruckLook(fn: (look: TruckLook) => void): void {
  listeners.add(fn)
  fn(truckLook())
}

/**
 * The three buttons, side by side: Truck, X-ray, Both. The one in play is
 * pressed (it wears the highlighter and says so to a screen reader), so it
 * isn't colour alone.
 */
export function truckLookToggle(): HTMLElement {
  const group = el('div', 'look-toggle')
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', t('look.label'))
  const buttons = TRUCK_LOOKS.map((look) => {
    const b = el('button', 'look-btn', t(`look.${look}` as StringKey))
    b.type = 'button'
    b.dataset.look = look
    b.title = t(`look.${look}Title` as StringKey)
    b.addEventListener('click', () => setTruckLook(look))
    group.append(b)
    return b
  })
  followTruckLook((look) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.look === look))
  })
  return group
}
