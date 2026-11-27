/**
 * Dev mode (Kelbo asked, 27 November 2026): playtesting switches at the
 * bottom of the More tab. Off for normal play.
 *
 * - Dev mode: shows the switches below it. Turning it off turns them all off.
 * - Unlock parts: every part is on sale whatever the year, on the build
 *   screen, for your own career truck and for contracts. Money, weight and
 *   reputation rules still apply. Rival teams don't get the parts early.
 *
 * The switches live on this phone only (`bumpstop.dev`), never in the garage
 * save or a save code, so turning dev mode off puts the normal rules back.
 * A truck fitted with a part from the future then shows "not out until..."
 * until that part is changed, the same as any other build.
 */
import { t } from '../data/strings'
import { setPartsUnlocked } from '../sim/build'
import { el } from './dom'
import { DEV_EVENT } from './events'

const DEV_KEY = 'bumpstop.dev'

export interface DevSettings {
  /** The dev mode switch itself. */
  on: boolean
  /** Every part on sale, any year. Only counts while dev mode is on. */
  unlockParts: boolean
}

const OFF: DevSettings = { on: false, unlockParts: false }

/** What this phone has saved; anything odd reads as off. */
export function readDev(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DevSettings {
  try {
    const raw = JSON.parse(storage?.getItem(DEV_KEY) ?? 'null') as Partial<DevSettings> | null
    if (!raw || typeof raw !== 'object') return { ...OFF }
    return { on: raw.on === true, unlockParts: raw.unlockParts === true }
  } catch {
    return { ...OFF }
  }
}

export function writeDev(d: DevSettings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(DEV_KEY, JSON.stringify(d))
  } catch {
    // Nowhere to keep it: the switches last until the page closes.
  }
}

/** Put the saved switches into effect. Called once as the game starts, before any screen draws. */
export function applyDev(d: DevSettings = readDev()): void {
  setPartsUnlocked(d.on && d.unlockParts)
}

/** The Dev mode panel for the More tab. */
export function devPanel(): HTMLElement {
  const box = el('section', 'panel dev-mode')
  box.append(el('h2', '', t('dev.title')), el('p', 'small', t('dev.lead')))
  let d = readDev()

  function tickBox(id: string, label: string, onChange: (on: boolean) => void): { row: HTMLElement; tick: HTMLInputElement } {
    const row = el('label', 'link-label')
    const tick = el('input')
    tick.type = 'checkbox'
    tick.id = id
    tick.addEventListener('change', () => onChange(tick.checked))
    row.append(tick, ' ', label)
    return { row, tick }
  }

  const devOn = tickBox('dev-on', t('dev.on'), (on) => {
    // Turning dev mode off turns every switch off with it.
    d = on ? { ...d, on } : { ...OFF }
    save()
  })
  const unlock = tickBox('dev-unlock-parts', t('dev.unlockParts'), (on) => {
    d = { ...d, unlockParts: on }
    save()
  })
  const unlockNote = el('p', 'small')
  unlockNote.setAttribute('aria-live', 'polite')
  const options = el('div', 'dev-options')
  options.append(unlock.row, unlockNote)

  function save(): void {
    writeDev(d)
    applyDev(d)
    show()
    // The build screen and the career redraw so locked parts open up (or lock again).
    window.dispatchEvent(new CustomEvent(DEV_EVENT))
  }

  function show(): void {
    devOn.tick.checked = d.on
    unlock.tick.checked = d.unlockParts
    options.hidden = !d.on
    unlockNote.textContent = t(d.unlockParts ? 'dev.unlockOn' : 'dev.unlockOff')
  }

  show()
  box.append(devOn.row, options)
  return box
}
