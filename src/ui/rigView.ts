/**
 * The 3D view in the shop (plan PR 5): sits at the top of a run's live view
 * and shows the truck on the rig while the sim runs.
 *
 * While the run goes on it keeps asking the sim's pose log
 * (`src/sim/poses.ts`) for its newest clip and plays it at true speed; when
 * a clip ends it takes the next newest. When the run ends on a break, it
 * replays the last seconds in slow motion, closing in on the part that let
 * go, over and over until the next run.
 *
 * three.js loads the first time a run starts. If the phone can't do WebGL,
 * the view hides itself and the rigs carry on in 2D.
 */
import { VIEW_3D } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import type { BuiltTruck } from '../sim/build'
import type { Profile } from '../sim/ground'
import { lastPoses, posesHeld, POSES_PER_SECOND, type PoseLog } from '../sim/poses'
import type { BreakEvent } from '../sim/wear'
import type { TrackView } from '../render/trackView'
import { el } from './dom'
import { photoMode } from './photoMode'
import { stanceOf } from './truckView'

export interface RigRun {
  truck: BuiltTruck
  /** The loop's road, or null for the shaker. */
  road: readonly Profile[] | null
  log: PoseLog
  /** The shaker's beat now (Hz), so it can be slowed to something you can see. */
  beat?: () => number
}

export interface RigView {
  element: HTMLElement
  begin(run: RigRun): void
  /** The run ended: replay the break (if there was one), or show the last clip. */
  finish(broken: BreakEvent | null): void
  reset(): void
}

export function rigView(): RigView {
  const box = el('figure', 'rig-view')
  box.hidden = true
  const canvas = el('canvas', 'rig-canvas')
  canvas.setAttribute('role', 'img')
  const caption = el('figcaption', 'small rig-caption')
  caption.setAttribute('aria-live', 'polite')
  box.append(canvas, caption)

  let view: TrackView | null = null
  // Photo mode (plan PR 12): freeze the run and frame a shot.
  const photo = photoMode(box, canvas, () => view)
  caption.after(photo.button)
  let loading: Promise<TrackView | null> | null = null
  let failed = false
  let current: RigRun | null = null
  let live = false
  let lastShown = -Infinity
  let retry = 0

  function load(): Promise<TrackView | null> {
    loading ??= import('../render/trackView').then(
      ({ createTrackView }) => (view = createTrackView(canvas)),
      (err) => fail(err),
    )
    return loading
  }

  function fail(err: unknown): null {
    console.error(err)
    failed = true
    box.hidden = true
    return null
  }

  /** Play the newest clip, or wait a moment if the sim hasn't moved on since the last one. */
  function next(): void {
    window.clearTimeout(retry)
    const r = current
    if (!live || !r || !view) return
    const clip = lastPoses(r.log, VIEW_3D.clipSeconds)
    const end = clip[clip.length - 1]
    if (!end || clip.length < POSES_PER_SECOND / 2 || end.t <= lastShown + 0.05) {
      retry = window.setTimeout(next, 150)
      return
    }
    lastShown = end.t
    const rate = r.beat ? Math.min(1, VIEW_3D.shakerShownHz / Math.max(0.1, r.beat())) : 1
    view.play(clip, { rate, loop: false, onEnd: next })
    photo.ready(true)
  }

  return {
    element: box,
    begin(run) {
      if (failed) return
      current = run
      live = true
      lastShown = -Infinity
      box.hidden = false
      canvas.setAttribute('aria-label', t(run.road ? 'view3d.alt' : 'view3d.altShaker'))
      caption.textContent = t('view3d.loading')
      const setup = run.truck.ride
      void load().then(async (v) => {
        if (!v || current !== run) return
        try {
          await v.setRun({ cls: run.truck.build.cls, stance: stanceOf(run.truck), parts: run.truck.build.parts, road: run.road, wheelbase: setup.cgToFront + setup.cgToRear })
        } catch (err) {
          fail(err)
          return
        }
        if (current !== run) return
        caption.textContent = t(run.road ? 'view3d.live' : 'view3d.liveShaker')
        next()
      })
    },
    finish(broken) {
      live = false
      window.clearTimeout(retry)
      const r = current
      if (!r || failed) return
      void load().then((v) => {
        if (!v || current !== r || posesHeld(r.log) < 2) return
        // A break worked out on a long stage has no moment to replay; the rigs always drive it.
        if (broken && !broken.estimated) {
          const what = t(`fail.${broken.kind}` as StringKey).toLowerCase()
          caption.textContent = broken.corner >= 0
            ? tf('view3d.replay', { what, where: t(`cornerName.${broken.corner}` as StringKey).toLowerCase() })
            : tf('view3d.replayFrame', { what, zone: t(`zone.${broken.zone ?? 'centre'}` as StringKey) })
          v.play(lastPoses(r.log, VIEW_3D.replaySeconds), { rate: VIEW_3D.slowMotion, loop: true, focus: { corner: broken.corner, kind: broken.kind } })
          photo.ready(true)
        } else {
          if (r.road) caption.textContent = t('view3d.lasted')
          const rate = r.beat ? Math.min(1, VIEW_3D.shakerShownHz / Math.max(0.1, r.beat())) : 1
          v.play(lastPoses(r.log, VIEW_3D.clipSeconds), { rate, loop: false })
          photo.ready(true)
        }
      })
    },
    reset() {
      photo.close()
      photo.ready(false)
      live = false
      current = null
      window.clearTimeout(retry)
      view?.stop()
      box.hidden = true
    },
  }
}
