/**
 * Drag and pinch on a 3D view's canvas, shared by photo mode and the
 * swing-around camera: one finger (or the mouse) turns and lifts the
 * camera, two fingers pinch to zoom, and the mouse wheel (or a trackpad
 * pinch) zooms too.
 *
 * It only reports how far things moved; whoever uses it decides what that
 * does to the camera.
 */
import { SWING } from '../data/graphics'

export interface OrbitDragHandlers {
  /** Whether a drag that starts now counts (photo mode open, or the view showing a truck). */
  active(): boolean
  /** A drag moved: turn and lift by this much (radians). */
  turn(dTurn: number, dLift: number): void
  /** A pinch or the wheel: multiply the distance by this (under 1 is closer). */
  zoom(factor: number): void
  /** A drag (not just a tap) has started. */
  begin?(): void
  /** Whether the wheel zooms without a trackpad pinch (it would scroll the page otherwise). */
  wheel?(): boolean
}

/** How far a finger moves (CSS px) before it's a drag rather than a tap. */
const SLOP = 6

export function orbitDrag(canvas: HTMLCanvasElement, h: OrbitDragHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  let travelled = 0
  let dragging = false

  function spread(): number {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  function start(): void {
    if (dragging) return
    dragging = true
    h.begin?.()
  }
  function onDown(e: PointerEvent): void {
    if (!h.active()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // Not every pointer can be captured (one already gone); the drag still works while it stays on the canvas.
    }
    pinch = spread()
    if (pointers.size === 1) {
      travelled = 0
      dragging = false
    }
  }
  function onMove(e: PointerEvent): void {
    const last = pointers.get(e.pointerId)
    if (!last) return
    if (!h.active()) {
      pointers.clear()
      return
    }
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    last.x = e.clientX
    last.y = e.clientY
    if (pointers.size >= 2) {
      const now = spread()
      if (pinch > 0 && now > 0) {
        start()
        h.zoom(pinch / now)
      }
      pinch = now
      return
    }
    travelled += Math.abs(dx) + Math.abs(dy)
    if (travelled < SLOP) return
    start()
    const w = Math.max(1, canvas.clientWidth)
    h.turn(-(dx / w) * SWING.dragTurn, (dy / w) * SWING.dragLift)
  }
  function onUp(e: PointerEvent): void {
    pointers.delete(e.pointerId)
    pinch = spread()
    if (pointers.size === 0) dragging = false
  }
  function onWheel(e: WheelEvent): void {
    if (!h.active()) return
    // A trackpad pinch arrives as the wheel with Ctrl held; a plain wheel only zooms where the page can't scroll.
    if (!e.ctrlKey && !(h.wheel?.() ?? true)) return
    e.preventDefault()
    start()
    dragging = false
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    h.zoom(Math.exp(Math.min(1, Math.max(-1, (e.deltaY * lines) / 400))))
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    canvas.removeEventListener('wheel', onWheel)
    pointers.clear()
  }
}
