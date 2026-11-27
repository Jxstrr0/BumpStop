/**
 * The 3D stage highlight (plan PR 7b): the test track's 3D view
 * (`src/render/trackView.ts`), playing clips of a raid stage
 * (`src/sim/highlight.ts`) one after another. The raid screen decides which
 * clip plays when; this only shows it.
 *
 * Each leg's clips become one "road" of pieces, one piece per clip, so the
 * view builds the strip under whichever clip is playing.
 *
 * three.js loads the first time a stage starts. If the phone can't do
 * WebGL, the view hides itself and the stage plays on in 2D (the traces).
 */
import { t, tf, type StringKey } from '../data/strings'
import type { WeatherId } from '../data/weather'
import type { BuiltTruck } from '../sim/build'
import type { Clip } from '../sim/highlight'
import type { Pose } from '../sim/poses'
import type { TrackView } from '../render/trackView'
import { el } from './dom'
import { photoMode } from './photoMode'
import { swingCamera } from './swingCamera'
import { stanceOf } from './truckView'

/** Slow motion for a clip that ends on a break (share of true speed). */
export const BREAK_RATE = 0.35

export interface RaidView {
  element: HTMLElement
  /** Get ready for a leg's clips (loads the truck and lays their road). */
  setLeg(truck: BuiltTruck, clips: readonly Clip[]): Promise<void>
  /** Play clip `i` of the leg: true speed, or slow motion closing in on a break; `weather` sets the sky if it had turned there. */
  show(i: number, weather?: WeatherId | null): void
  stop(): void
  /** False once the phone turned out not to do WebGL. */
  works(): boolean
}

/** `onFail` is called if the 3D can't start, so the stage can go back to the page with the trace. */
export function raidView(onFail: () => void = () => {}): RaidView {
  const box = el('figure', 'rig-view raid-view')
  box.hidden = true
  const canvas = el('canvas', 'rig-canvas')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', t('raidUi.view'))
  const caption = el('figcaption', 'small rig-caption')
  caption.setAttribute('aria-live', 'polite')
  box.append(canvas, caption)

  let view: TrackView | null = null
  // Photo mode (plan PR 12): freeze the highlight and frame a shot.
  const photo = photoMode(box, canvas, () => view, 'raid')
  caption.after(photo.button)
  // The swing-around camera (v1.19): drag the picture to look round the truck as it drives.
  const swing = swingCamera(box, canvas, () => view)
  caption.after(swing.hint, swing.button)
  let loading: Promise<TrackView | null> | null = null
  let failed = false
  let poses: Pose[][] = []
  let clips: readonly Clip[] = []
  let ready = false

  function load(): Promise<TrackView | null> {
    // The catch covers both ways it can go wrong: the 3D code not arriving, and the phone refusing WebGL when the view is made.
    loading ??= import('../render/trackView')
      .then(({ createTrackView }) => (view = createTrackView(canvas)))
      .catch((err: unknown) => fail(err))
    return loading
  }

  function fail(err: unknown): null {
    console.error(err)
    failed = true
    box.hidden = true
    onFail()
    return null
  }

  return {
    element: box,
    async setLeg(truck, legClips) {
      ready = false
      clips = legClips
      // Each clip is its own piece of road: number its poses to match.
      poses = legClips.map((c, i) => c.poses.map((p) => ({ ...p, piece: i })))
      if (failed || legClips.length === 0) return
      box.hidden = false
      const v = await load()
      if (!v || clips !== legClips) return
      const ride = truck.ride
      try {
        await v.setRun({ cls: truck.build.cls, stance: stanceOf(truck), parts: truck.build.parts, road: legClips.map((c) => c.road), wheelbase: ride.cgToFront + ride.cgToRear })
        ready = true
      } catch (err) {
        fail(err)
      }
    },
    show(i, weather) {
      const c = clips[i]
      const p = poses[i]
      if (!view || !ready || !c || !p || p.length < 2) return
      view.setWeather(weather ?? 'clear')
      const b = c.broken
      if (b) {
        const what = t(`fail.${b.kind}` as StringKey).toLowerCase()
        caption.textContent = b.corner >= 0
          ? tf('raidUi.viewBreak', { what, where: t(`corner.${b.corner}` as StringKey) })
          : tf('raidUi.viewBreakFrame', { what, zone: t(`zone.${b.zone ?? 'centre'}` as StringKey) })
        // What the caption is saying, for the full-page layout: plain "highlights" is left off there, the rest stays.
        box.dataset.state = 'ended'
        view.play(p, { rate: BREAK_RATE, loop: false, focus: { corner: b.corner, kind: b.kind } })
      } else {
        caption.textContent = weather ? tf('raidUi.viewWeather', { kind: t(`weather.${weather}` as StringKey) }) : t('raidUi.viewLive')
        box.dataset.state = weather ? 'note' : 'live'
        view.play(p, { rate: 1, loop: false })
      }
      photo.ready(true)
      swing.ready(true)
    },
    stop() {
      photo.close()
      photo.ready(false)
      swing.ready(false)
      view?.stop()
    },
    works: () => !failed,
  }
}
