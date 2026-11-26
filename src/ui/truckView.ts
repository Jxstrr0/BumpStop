/**
 * The 3D truck on the build screen (plan PR 5).
 *
 * three.js and the models only load when this view first comes near the
 * screen, so the first screen stays quick. If the phone can't do WebGL (or
 * the model won't load), a line says so and everything else carries on.
 *
 * The truck sits at the build's own ride height: each end is drawn higher or
 * lower than stock by how much less or more the springs sag (`sag` from
 * `src/sim/build.ts`).
 */
import { CLASSES, type ClassId } from '../data/classes'
import { t, tf } from '../data/strings'
import { buildTruck, stockBuild, type BuiltTruck } from '../sim/build'
import type { Garage } from '../render/garage'
import type { BuildStore } from './buildStore'
import { el, num } from './dom'

const stockCache = new Map<ClassId, BuiltTruck>()
function stockOf(cls: ClassId): BuiltTruck {
  let s = stockCache.get(cls)
  if (!s) {
    s = buildTruck(stockBuild(cls))
    stockCache.set(cls, s)
  }
  return s
}

/** How much higher (+) or lower (−) each end sits than the stock build (m). */
export function stanceOf(truck: BuiltTruck): { front: number; rear: number } {
  const stock = stockOf(truck.build.cls)
  return { front: stock.front.sag - truck.front.sag, rear: stock.rear.sag - truck.rear.sag }
}

/** Millimetres with their sign: +12, −5 or ±0. */
export function signedMm(mm: number): string {
  const r = Math.round(mm)
  return r > 0 ? `+${num(r)}` : r < 0 ? `−${num(-r)}` : '±0'
}

export interface TruckViewHandle {
  element: HTMLElement
  /** The 3D view, loading it now if it hasn't come on screen yet (null if the phone can't). */
  garage(): Promise<Garage | null>
  /** The 3D view if it's ready, else null. */
  garageNow(): Garage | null
}

export function truckView(store: BuildStore): TruckViewHandle {
  const box = el('figure', 'truck-view')
  const canvas = el('canvas', 'truck-canvas')
  canvas.setAttribute('role', 'img')
  const status = el('p', 'small truck-status', t('view.loading'))
  const hint = el('figcaption', 'small', t('view.hint'))
  box.append(canvas, status, hint)

  let garage: Garage | null = null
  let failed = false
  /** The latest truck going into the view. */
  let shown: Promise<void> | null = null

  function describe(): void {
    const truck = store.truck()
    const s = stanceOf(truck)
    const front = s.front * 1000
    const rear = s.rear * 1000
    const stance = Math.round(front) === 0 && Math.round(rear) === 0
      ? t('view.stanceStock')
      : tf('view.stanceBoth', { front: signedMm(front), rear: signedMm(rear) })
    const cls = CLASSES.find((c) => c.id === truck.build.cls)!
    canvas.setAttribute('aria-label', tf('view.alt', { cls: t(cls.name).toLowerCase(), stance }))
  }

  function update(): void {
    describe()
    if (!garage || failed) return
    const truck = store.truck()
    shown = garage.show(truck.build.cls, stanceOf(truck), truck.build.parts).then(
      () => { status.hidden = true },
      (err) => fail(err),
    )
  }

  function fail(err: unknown): void {
    console.error(err)
    failed = true
    canvas.hidden = true
    hint.hidden = true
    status.hidden = false
    status.textContent = t('view.failed')
  }

  async function start(): Promise<void> {
    try {
      const { createGarage } = await import('../render/garage')
      garage = createGarage(canvas)
      const truck = store.truck()
      describe()
      shown = garage.show(truck.build.cls, stanceOf(truck), truck.build.parts).then(
        () => { status.hidden = true },
        (err) => fail(err),
      )
      await shown
    } catch (err) {
      fail(err)
    }
  }
  let starting: Promise<void> | null = null
  const begin = () => (starting ??= start())

  // Load three.js only when the view is about to be seen.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        void begin()
      }
    }, { rootMargin: '200px' })
    io.observe(box)
  } else {
    void begin()
  }

  store.onChange(update)
  describe()
  return {
    element: box,
    async garage() {
      await begin()
      await shown
      return failed ? null : garage
    },
    garageNow: () => (failed ? null : garage),
  }
}
