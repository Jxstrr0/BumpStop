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
 * With a ghost truck (your best run or a friend's) its own pose log, kept
 * step for step with yours, is handed over beside each clip.
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
import type { BreakFocus, TrackView } from '../render/trackView'
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
  /** A ghost truck driving the same loop step for step, or null. */
  ghost?: { truck: BuiltTruck; log: PoseLog; broken: () => BreakEvent | null } | null
}

/** The ghost's clip covering the same moments (a second spare, in case it stopped a little before). */
function ghostClip(r: RigRun, seconds: number): { ghost: ReturnType<typeof lastPoses> | null; ghostBroken: BreakFocus | null } {
  if (!r.ghost || posesHeld(r.ghost.log) < 2) return { ghost: null, ghostBroken: null }
  const b = r.ghost.broken()
  return { ghost: lastPoses(r.ghost.log, seconds + 1), ghostBroken: b ? { corner: b.corner, kind: b.kind } : null }
}

export interface RigView {
  element: HTMLElement
  begin(run: RigRun): void
  /** The run ended: replay the break (if there was one), or show the last clip. */
  finish(broken: BreakEvent | null): void
  reset(): void
  /** False once the phone turned out not to do WebGL. */
  works(): boolean
}

/** `onFail` is called if the 3D can't start, so the shop can go back to the page with the traces. */
export function rigView(onFail: () => void = () => {}): RigView {
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
    view.play(clip, { rate, loop: false, onEnd: next, ...ghostClip(r, VIEW_3D.clipSeconds) })
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
      // What the view is showing, for the full-page layout: the "live" caption is left off there, the others stay.
      box.dataset.state = 'loading'
      const setup = run.truck.ride
      void load().then(async (v) => {
        if (!v || current !== run) return
        try {
          const ghost = run.ghost ? { stance: stanceOf(run.ghost.truck), parts: run.ghost.truck.build.parts } : null
          await v.setRun({ cls: run.truck.build.cls, stance: stanceOf(run.truck), parts: run.truck.build.parts, road: run.road, wheelbase: setup.cgToFront + setup.cgToRear, ghost, loop: true })
        } catch (err) {
          fail(err)
          return
        }
        if (current !== run) return
        caption.textContent = t(run.road ? (run.ghost ? 'view3d.liveGhost' : 'view3d.live') : 'view3d.liveShaker')
        box.dataset.state = 'live'
        next()
      })
    },
    finish(broken) {
      live = false
      window.clearTimeout(retry)
      const r = current
      if (!r || failed) return
      // The shaker's caption doesn't change when it ends, so it stays off the full page.
      if (r.road) box.dataset.state = 'ended'
      void load().then((v) => {
        if (!v || current !== r || posesHeld(r.log) < 2) return
        // A break worked out on a long stage has no moment to replay; the rigs always drive it.
        if (broken && !broken.estimated) {
          const what = t(`fail.${broken.kind}` as StringKey).toLowerCase()
          caption.textContent = broken.corner >= 0
            ? tf('view3d.replay', { what, where: t(`cornerName.${broken.corner}` as StringKey).toLowerCase() })
            : tf('view3d.replayFrame', { what, zone: t(`zone.${broken.zone ?? 'centre'}` as StringKey) })
          v.play(lastPoses(r.log, VIEW_3D.replaySeconds), { rate: VIEW_3D.slowMotion, loop: true, focus: { corner: broken.corner, kind: broken.kind }, ...ghostClip(r, VIEW_3D.replaySeconds) })
          photo.ready(true)
        } else {
          if (r.road) caption.textContent = t('view3d.lasted')
          const rate = r.beat ? Math.min(1, VIEW_3D.shakerShownHz / Math.max(0.1, r.beat())) : 1
          v.play(lastPoses(r.log, VIEW_3D.clipSeconds), { rate, loop: false, ...ghostClip(r, VIEW_3D.clipSeconds) })
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
    works: () => !failed,
  }
}
