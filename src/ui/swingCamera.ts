/**
 * The swing-around camera (v1.19), for the 3D test track and the raid
 * stage highlights (Kelbo picked it, 27 November 2026).
 *
 * Drag the picture and the camera is yours: it swings round the truck and
 * keeps following it from there, clip after clip, while it drives. Pinch
 * (or the mouse wheel) zooms. "Auto camera" gives it back to the TV-style
 * shots, which are where every run starts, so the suspension is easy to see
 * until the player wants another view. With the picture focused, the arrow
 * keys swing it, + and − zoom, and Escape goes back to the auto camera.
 *
 * A small slip says how, until the first time the player tries it; the
 * phone remembers that, like the last tab.
 */
import { SWING } from '../data/graphics'
import { t } from '../data/strings'
import type { SwingControls, TrackView } from '../render/trackView'
import { el } from './dom'
import { orbitDrag } from './orbitDrag'

const TRIED_KEY = 'bumpstop.swingTried'

function tried(): boolean {
  try {
    return globalThis.localStorage?.getItem(TRIED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberTried(): void {
  try {
    globalThis.localStorage?.setItem(TRIED_KEY, '1')
  } catch {
    // Nowhere to keep it: the slip shows again next visit.
  }
}

export interface SwingCamera {
  /** "Auto camera": shown while the player has the camera. */
  button: HTMLButtonElement
  /** The "drag to swing" slip. */
  hint: HTMLElement
  /** A clip is on screen (the camera can be swung), or not. */
  ready(on: boolean): void
}

/** Add the swing-around camera to a 3D view's figure. `view` gives the view once three.js has loaded. */
export function swingCamera(box: HTMLElement, canvas: HTMLCanvasElement, view: () => TrackView | null): SwingCamera {
  const button = el('button', 'btn small-btn swing-btn', t('swing.auto'))
  button.type = 'button'
  button.hidden = true
  const hint = el('p', 'small swing-hint', t('swing.hint'))
  hint.hidden = true

  let on = false
  let c: SwingControls | null = null
  const photoOpen = () => box.classList.contains('photo-on')

  function take(): SwingControls | null {
    if (c) return c
    c = view()?.swingStart() ?? null
    if (c) {
      button.hidden = false
      hint.hidden = true
      rememberTried()
    }
    return c
  }
  function set(next: SwingControls): void {
    next.zoom = Math.min(SWING.zoom.max, Math.max(SWING.zoom.min, next.zoom))
    c = next
    view()?.swingSet(next)
  }
  function auto(): void {
    if (!c) return
    c = null
    button.hidden = true
    view()?.swingEnd()
  }

  orbitDrag(canvas, {
    active: () => on && !photoOpen() && view() !== null,
    begin: () => void take(),
    turn(dTurn, dLift) {
      const now = take()
      if (now) set({ ...now, turn: now.turn + dTurn, lift: now.lift + dLift })
    },
    zoom(factor) {
      const now = take()
      if (now) set({ ...now, zoom: now.zoom * factor })
    },
    // Full page there's no page to scroll, so the plain wheel zooms; in the page it scrolls as usual.
    wheel: () => canvas.closest('.live.full') !== null,
  })

  // The keyboard, with the picture focused.
  canvas.tabIndex = 0
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - Escape')
  canvas.addEventListener('keydown', (e) => {
    if (!on || photoOpen()) return
    if (e.key === 'Escape') {
      if (!c) return
      auto()
      e.preventDefault()
      return
    }
    const turn = { ArrowLeft: SWING.keyTurn, ArrowRight: -SWING.keyTurn }[e.key] ?? 0
    const lift = { ArrowUp: SWING.keyTurn, ArrowDown: -SWING.keyTurn }[e.key] ?? 0
    const zoom = e.key === '+' || e.key === '=' ? 1 - SWING.keyZoom : e.key === '-' || e.key === '_' ? 1 + SWING.keyZoom : 1
    if (!turn && !lift && zoom === 1) return
    e.preventDefault()
    const now = take()
    if (now) set({ ...now, turn: now.turn + turn, lift: now.lift + lift, zoom: now.zoom * zoom })
  })

  button.addEventListener('click', () => {
    auto()
    canvas.focus({ preventScroll: true })
  })

  return {
    button,
    hint,
    ready(next) {
      on = next
      hint.hidden = !next || c !== null || tried()
    },
  }
}
