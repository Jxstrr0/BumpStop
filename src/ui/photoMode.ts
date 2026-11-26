/**
 * Photo mode (plan PR 12), for the 3D test track and the raid highlights.
 *
 * A "Photo mode" button sits under the 3D view. It freezes the clip where it
 * is and opens the view full screen with three sliders: Moment (scrub back
 * and forth through the clip, to catch the truck in the air or the wheel at
 * full stretch), Turn (walk round the truck) and Zoom. Dragging on the
 * picture turns and lifts the camera; two fingers pinch to zoom. Take photo
 * draws it at about 2,000 pixels with the BUMP STOP mark in the corner and
 * opens the share sheet (or downloads it). Done, or Escape, goes back, and
 * the run carries on from where it got to.
 */
import { t } from '../data/strings'
import { PHOTO_LIFT, PHOTO_ZOOM } from '../data/graphics'
import type { PhotoControls, TrackView } from '../render/trackView'
import { el } from './dom'
import { pictureName, pngFile, shareFile, stampMark } from './shareImage'

/** The photo's longer side (pixels). */
const PHOTO_SIZE = 2048
/** Slider steps across each range. */
const STEPS = 1000

interface Slider {
  wrap: HTMLElement
  input: HTMLInputElement
}

function slider(label: string, id: string): Slider {
  const wrap = el('div', 'photo-slider')
  const lab = el('label', 'setting-label', label)
  const input = el('input')
  input.type = 'range'
  input.min = '0'
  input.max = String(STEPS)
  input.step = '1'
  input.id = id
  lab.htmlFor = id
  wrap.append(lab, input)
  return { wrap, input }
}

let ids = 0

export interface PhotoMode {
  button: HTMLButtonElement
  /** Show the button (a clip is on screen) or hide it. */
  ready(on: boolean): void
  /** Leave photo mode if it's open (the view is going away). */
  close(): void
}

/**
 * Add photo mode to a 3D view's figure. `view` gives the view once three.js
 * has loaded (null before). Returns the button, hidden until `ready(true)`.
 */
export function photoMode(box: HTMLElement, canvas: HTMLCanvasElement, view: () => TrackView | null): PhotoMode {
  const n = ++ids
  const button = el('button', 'btn small-btn photo-btn', t('photo.open'))
  button.type = 'button'
  button.hidden = true

  const bar = el('div', 'photo-bar')
  bar.hidden = true
  const hint = el('p', 'small photo-hint', t('photo.hint'))
  const moment = slider(t('photo.moment'), `photo-moment-${n}`)
  const turn = slider(t('photo.turn'), `photo-turn-${n}`)
  const zoom = slider(t('photo.zoom'), `photo-zoom-${n}`)
  const take = el('button', 'btn photo-take', t('photo.take'))
  take.type = 'button'
  const done = el('button', 'btn', t('photo.done'))
  done.type = 'button'
  const row = el('div', 'btn-row photo-row')
  row.append(take, done)
  const note = el('p', 'small photo-note')
  note.setAttribute('aria-live', 'polite')
  bar.append(hint, moment.wrap, turn.wrap, zoom.wrap, row, note)
  box.append(bar)

  let c: PhotoControls | null = null

  // Sliders and the camera: turn wraps all the way round; zoom is even steps of distance.
  const TURN_SPAN = Math.PI * 2
  function toSliders(p: PhotoControls): void {
    moment.input.value = String(Math.round(p.moment * STEPS))
    const tu = (((p.turn / TURN_SPAN) % 1) + 1) % 1
    turn.input.value = String(Math.round(tu * STEPS))
    zoom.input.value = String(Math.round(((PHOTO_ZOOM.max - p.zoom) / (PHOTO_ZOOM.max - PHOTO_ZOOM.min)) * STEPS))
  }
  function set(p: PhotoControls): void {
    p.zoom = Math.min(PHOTO_ZOOM.max, Math.max(PHOTO_ZOOM.min, p.zoom))
    p.lift = Math.min(PHOTO_LIFT.max, Math.max(PHOTO_LIFT.min, p.lift))
    c = p
    view()?.photoSet(p)
  }
  moment.input.addEventListener('input', () => {
    if (c) set({ ...c, moment: Number(moment.input.value) / STEPS })
  })
  turn.input.addEventListener('input', () => {
    if (c) set({ ...c, turn: (Number(turn.input.value) / STEPS) * TURN_SPAN })
  })
  zoom.input.addEventListener('input', () => {
    if (c) set({ ...c, zoom: PHOTO_ZOOM.max - (Number(zoom.input.value) / STEPS) * (PHOTO_ZOOM.max - PHOTO_ZOOM.min) })
  })

  // Drag to turn and lift; pinch to zoom.
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  function spread(): number {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  function onDown(e: PointerEvent): void {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    canvas.setPointerCapture(e.pointerId)
    pinch = spread()
  }
  function onMove(e: PointerEvent): void {
    const last = pointers.get(e.pointerId)
    if (!last || !c) return
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    last.x = e.clientX
    last.y = e.clientY
    if (pointers.size >= 2) {
      const now = spread()
      if (pinch > 0 && now > 0) set({ ...c, zoom: c.zoom * (pinch / now) })
      pinch = now
    } else {
      const w = Math.max(1, canvas.clientWidth)
      set({ ...c, turn: c.turn - (dx / w) * Math.PI * 1.5, lift: c.lift + (dy / w) * Math.PI * 0.8 })
    }
    toSliders(c)
  }
  function onUp(e: PointerEvent): void {
    pointers.delete(e.pointerId)
    pinch = spread()
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  function open(): void {
    const v = view()
    const start = v?.photoStart()
    if (!v || !start) return
    c = start
    toSliders(start)
    note.textContent = ''
    box.classList.add('photo-on')
    document.body.classList.add('photo-open')
    bar.hidden = false
    button.hidden = true
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    document.addEventListener('keydown', onKey)
    moment.input.focus()
  }

  function close(): void {
    if (!box.classList.contains('photo-on')) return
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    document.removeEventListener('keydown', onKey)
    pointers.clear()
    box.classList.remove('photo-on')
    document.body.classList.remove('photo-open')
    bar.hidden = true
    button.hidden = false
    c = null
    view()?.photoEnd()
    button.focus()
  }

  take.addEventListener('click', () => {
    const shot = view()?.snapshot(PHOTO_SIZE)
    if (!shot) return
    stampMark(shot)
    // Made without waiting, so the phone still counts the share as part of the tap.
    const file = pngFile(shot, pictureName('photo'))
    void shareFile(file).then((r) => {
      note.textContent = r === 'shared' ? t('photo.shared') : r === 'downloaded' ? t('photo.downloaded') : r === 'failed' ? t('photo.failed') : ''
    })
  })
  done.addEventListener('click', close)
  button.addEventListener('click', open)

  return {
    button,
    ready(on) {
      if (!box.classList.contains('photo-on')) button.hidden = !on
    },
    close,
  }
}
