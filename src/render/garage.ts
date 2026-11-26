/**
 * The garage view on the build screen (plan PR 5): the truck you're building,
 * in 3D, sitting at its own ride height on the shop floor.
 *
 * Softer springs or less preload and it squats lower; stiffer and it sits up.
 * It turns slowly on its own (not with reduced motion), and a sideways drag
 * turns it by hand. Up-and-down drags still scroll the page, so the view
 * never traps a thumb.
 *
 * It only draws while it's on screen, to save the battery.
 */
import * as THREE from 'three'
import type { ClassId } from '../data/classes'
import { addLights, applyLook, applyTier, cssColour, makeRenderer, onLookChange } from './look'
import { frameTime, onTierChange } from './tiers'
import { REST_POSE, TruckModel, type FittedParts, type Stance } from './truckModel'

export interface Garage {
  /** Show this class's truck at this stance, with these parts bolted on. Resolves once the model is in. */
  show(cls: ClassId, stance: Stance, parts: FittedParts): Promise<void>
  dispose(): void
}

/** Turns per second when turning on its own. */
const AUTO_TURN = 0.04
/** After a drag, wait this long before turning on its own again (ms). */
const HAND_PAUSE = 4000

export function createGarage(canvas: HTMLCanvasElement): Garage {
  const renderer = makeRenderer(canvas)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200)
  const lights = addLights(scene, 6)

  // The shop floor: a big disc in the panel colour with the roadbook's ruled lines.
  const floorMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  let grid = new THREE.GridHelper(16, 16)
  scene.add(grid)

  function look(): void {
    applyLook(scene, lights)
    floorMat.color.copy(cssColour('--panel-2', '#ece8dc'))
    scene.remove(grid)
    grid.dispose()
    const line = cssColour('--line', '#d4cebf')
    grid = new THREE.GridHelper(16, 16, line, line)
    grid.position.y = 0.002
    scene.add(grid)
    draw()
  }
  const stopLook = onLookChange(look)

  let truck: TruckModel | null = null
  let wanted = 0
  let turn = 0.6
  let lastHand = -Infinity
  let raf = 0
  let lastTime = 0
  let visible = true
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  function frameCamera(): void {
    const len = truck?.length ?? 5
    const height = truck ? truck.radius * 4.2 : 2
    const dist = len * 1.55 + 1.5
    camera.position.set(Math.cos(turn) * dist, height + len * 0.32, Math.sin(turn) * dist)
    camera.lookAt(0, height * 0.42, 0)
  }

  function resize(): void {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    draw()
  }

  function draw(): void {
    frameCamera()
    renderer.render(scene, camera)
  }

  function animating(): boolean {
    return visible && !reduced.matches && performance.now() - lastHand > HAND_PAUSE
  }

  function tick(now: number): void {
    raf = 0
    const dt = Math.min(0.1, (now - lastTime) / 1000)
    lastTime = now
    frameTime(dt)
    turn += dt * AUTO_TURN * Math.PI * 2
    draw()
    loop()
  }

  function loop(): void {
    if (raf || !animating()) return
    lastTime = performance.now()
    raf = requestAnimationFrame(tick)
  }

  // Sideways drags turn the truck. `touch-action: pan-y` (in the CSS) leaves
  // up-and-down to the page; if the page scrolls, the browser cancels the drag.
  let dragX: number | null = null
  canvas.addEventListener('pointerdown', (e) => {
    dragX = e.clientX
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (dragX === null) return
    turn += ((e.clientX - dragX) / Math.max(1, canvas.clientWidth)) * Math.PI * 1.5
    dragX = e.clientX
    lastHand = performance.now()
    draw()
  })
  const endDrag = () => {
    dragX = null
    lastHand = performance.now()
    window.setTimeout(loop, HAND_PAUSE + 50)
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  const sizer = new ResizeObserver(resize)
  sizer.observe(canvas)
  const watcher = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting)
    if (visible) loop()
  })
  watcher.observe(canvas)
  const onReduced = () => loop()
  reduced.addEventListener('change', onReduced)
  // A new graphics tier (picked, or Auto stepping down): new pixels and shadows.
  const stopTier = onTierChange(() => {
    if (applyTier(renderer, lights.sun)) resize()
    else draw()
  })

  look()
  resize()

  return {
    async show(cls, stance, parts) {
      const ticket = ++wanted
      if (truck?.cls !== cls) {
        const next = await TruckModel.load(cls)
        // A newer request came in while this one loaded.
        if (ticket !== wanted) return
        truck?.dispose()
        truck = next
        scene.add(truck.root)
        const reach = truck.length * 0.7
        const cam = lights.sun.shadow.camera
        cam.left = cam.bottom = -reach
        cam.right = cam.top = reach
        cam.updateProjectionMatrix()
      }
      truck.stance = stance
      truck.fit(parts)
      truck.pose(REST_POSE)
      draw()
      loop()
    },
    dispose() {
      cancelAnimationFrame(raf)
      sizer.disconnect()
      watcher.disconnect()
      reduced.removeEventListener('change', onReduced)
      stopLook()
      stopTier()
      truck?.dispose()
      renderer.dispose()
    },
  }
}
