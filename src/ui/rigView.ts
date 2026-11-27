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
 * On the jump ramp the run plays at true speed, so each clip carries on
 * where the last one stopped, and after every landing `landing` replays it
 * in slow motion from the side, with puffs where the bump stops and
 * bottom-outs happen and the caption saying each one as it comes.
 *
 * three.js loads the first time a run starts. If the phone can't do WebGL,
 * the view hides itself and the rigs carry on in 2D.
 */
import { VIEW_3D } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import type { BuiltTruck } from '../sim/build'
import type { Profile } from '../sim/ground'
import { lastPoses, poseAgo, posesHeld, POSES_PER_SECOND, type PoseLog } from '../sim/poses'
import type { LandingMark, LandingScore } from '../sim/landing'
import type { BreakEvent } from '../sim/wear'
import type { BreakFocus, TrackView } from '../render/trackView'
import { el, num } from './dom'
import { msToKmh } from '../sim/units'
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
  /** The sim runs at true speed (the jump ramp): each clip picks up where the last one ended instead of the newest few seconds. */
  trueSpeed?: boolean
}

/** The ghost's clip covering the same moments (a second spare, in case it stopped a little before). */
function ghostClip(r: RigRun, seconds: number): { ghost: ReturnType<typeof lastPoses> | null; ghostBroken: BreakFocus | null } {
  if (!r.ghost || posesHeld(r.ghost.log) < 2) return { ghost: null, ghostBroken: null }
  const b = r.ghost.broken()
  return { ghost: lastPoses(r.ghost.log, seconds + 1), ghostBroken: b ? { corner: b.corner, kind: b.kind } : null }
}

/** The newest pose's time (s into the run). */
function poseNewest(log: PoseLog): number {
  return posesHeld(log) > 0 ? poseAgo(log, 0).t : 0
}

export interface RigView {
  element: HTMLElement
  begin(run: RigRun): void
  /**
   * The jump ramp: replay this landing in slow motion, then call `done` (the
   * shop holds the run meanwhile). Calls `done` straight away if there's no 3D.
   */
  landing(score: LandingScore, done: () => void): void
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
  // Bumped whenever what's on screen changes hands, so a landing replay that ends late doesn't restart a finished run.
  let turn = 0

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
    // At true speed the newest few seconds would show some of the last clip again: take only what's new.
    const fresh = r.trueSpeed && Number.isFinite(lastShown) ? Math.max(0.02, Math.min(VIEW_3D.clipSeconds, poseNewest(r.log) - lastShown)) : VIEW_3D.clipSeconds
    const clip = lastPoses(r.log, fresh)
    const end = clip[clip.length - 1]
    if (!end || clip.length < POSES_PER_SECOND / 2 || end.t <= lastShown + 0.05) {
      retry = window.setTimeout(next, 150)
      return
    }
    lastShown = end.t
    const rate = r.beat ? Math.min(1, VIEW_3D.shakerShownHz / Math.max(0.1, r.beat())) : 1
    // The jump ramp holds the side-on shot: one clip runs into the next, and a jump reads best from the side.
    view.play(clip, { rate, loop: false, onEnd: next, side: r.trueSpeed === true, ...ghostClip(r, VIEW_3D.clipSeconds) })
    photo.ready(true)
  }

  return {
    element: box,
    begin(run) {
      if (failed) return
      turn++
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
    landing(score, done) {
      const r = current
      if (!r || failed || !view || !live || posesHeld(r.log) < 2) {
        done()
        return
      }
      const v = view
      window.clearTimeout(retry)
      live = false
      const mine = ++turn
      const speed = num(msToKmh(score.speed))
      caption.textContent = tf('jump.replay', { n: String(score.lap), speed })
      box.dataset.state = 'landing'
      const notes: string[] = []
      const seconds = Math.min(VIEW_3D.poseSeconds, poseNewest(r.log) - score.from + VIEW_3D.landingBefore)
      const finished = () => {
        if (current !== r || turn !== mine) return
        caption.textContent = landingVerdict(score)
        retry = window.setTimeout(() => {
          if (current !== r || turn !== mine) return
          live = true
          lastShown = poseNewest(r.log)
          box.dataset.state = 'live'
          caption.textContent = t(r.ghost ? 'view3d.liveGhost' : 'view3d.live')
          done()
          next()
        }, VIEW_3D.landingHold * 1000)
      }
      v.play(lastPoses(r.log, seconds), {
        rate: VIEW_3D.slowMotion,
        loop: false,
        side: true,
        marks: score.marks,
        // The caption keeps the last two things that happened, so a quick pair (front then rear bump stops) both get read.
        onMark: (m) => {
          const said = markText(m, score)
          if (!said) return
          notes.push(said)
          caption.textContent = notes.slice(-2).join(' ')
        },
        onEnd: finished,
        ...ghostClip(r, seconds),
      })
    },
    finish(broken) {
      turn++
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
      turn++
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

/** What the caption says as the landing replay passes a moment, or null to leave it. */
function markText(m: LandingMark, score: LandingScore): string | null {
  switch (m.kind) {
    case 'takeoff':
      return t('jump.markTakeoff')
    case 'touch': {
      const deg = num(Math.abs(score.angle))
      const level = Math.abs(score.angle) < 4
      if (score.spot === 'none') return t('jump.markRolled')
      if (level) return t('jump.markLevel')
      return tf(score.angle < 0 ? 'jump.markNose' : 'jump.markTail', { deg })
    }
    case 'bumpStop':
      return t(m.corner < 2 ? 'jump.markStopFront' : 'jump.markStopRear')
    case 'bottom':
      return tf('jump.markBottom', { where: t(`cornerName.${m.corner}` as StringKey).toLowerCase() })
    case 'bounce':
      return t('jump.markBounce')
  }
}

/** "Clean landing: 87 out of 100." */
export function landingVerdict(score: LandingScore): string {
  return tf('jump.verdict', { grade: t(`jump.grade.${score.grade}` as StringKey), score: String(score.score) })
}
