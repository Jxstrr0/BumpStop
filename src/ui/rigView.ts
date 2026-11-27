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
 * On the jump ramp the run plays at true speed as one unbroken shot from
 * the side (v1.28, Kelbo asked for it smoother and more continuous): the
 * view follows the pose log a moment behind the sim instead of playing
 * clips (`ClipStream` in `src/render/trackView.ts`), and the run never stops
 * for a replay. Once it's over, `replay` plays any landing again in slow
 * motion, with puffs where the bump stops and bottom-outs happen and the
 * caption saying each one as it comes.
 *
 * three.js loads the first time a run starts. If the phone can't do WebGL,
 * the view hides itself and the rigs carry on in 2D.
 */
import { ROLL_OUT, VIEW_3D } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import type { BuiltTruck } from '../sim/build'
import type { Profile } from '../sim/ground'
import { lastPoses, posesHeld, posesSince, POSES_PER_SECOND, type Pose, type PoseLog } from '../sim/poses'
import type { LandingMark, LandingScore } from '../sim/landing'
import type { BreakEvent } from '../sim/wear'
import type { BreakFocus, TrackView } from '../render/trackView'
import { el, num } from './dom'
import { msToKmh } from '../sim/units'
import { photoMode } from './photoMode'
import { swingCamera } from './swingCamera'
import { followTruckLook, truckLook, truckLookToggle } from './truckLook'
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
  /** The sim runs at true speed (the jump ramp): show it as one unbroken shot instead of clips. */
  trueSpeed?: boolean
}

/** A landing's moments, kept when it was scored so it can be replayed after the run: your truck's poses and the ghost's. */
export interface LandingClip {
  mine: readonly Pose[]
  ghost: readonly Pose[] | null
}

/** The poses from `from` to `to` (s into the run), oldest first. */
export function posesBetween(log: PoseLog, from: number, to: number): Pose[] {
  return posesSince(log, from).filter((p) => p.t <= to)
}

/** The ghost's clip covering the same moments (a second spare, in case it stopped a little before). */
function ghostClip(r: RigRun, seconds: number): { ghost: ReturnType<typeof lastPoses> | null; ghostBroken: BreakFocus | null } {
  if (!r.ghost || posesHeld(r.ghost.log) < 2) return { ghost: null, ghostBroken: null }
  const b = r.ghost.broken()
  return { ghost: lastPoses(r.ghost.log, seconds + 1), ghostBroken: b ? { corner: b.corner, kind: b.kind } : null }
}

/**
 * A run that lasted every lap, carried on past its end (`rollOut` in
 * `src/sim/laps.ts`): your truck's poses through the arch to a stop, and the
 * ghost's (empty if it broke, or there's none).
 */
export interface RunFinish {
  mine: readonly Pose[]
  ghost: readonly Pose[]
}

export interface RigView {
  element: HTMLElement
  begin(run: RigRun): void
  /** The jump ramp, after the run: play this landing again in slow motion. False if there's no 3D to show it on. */
  replay(score: LandingScore, clip: LandingClip): boolean
  /**
   * The run ended: replay the break (if there was one), or show the last
   * clip. A run that lasted every lap brings its `rollOut`, and the truck
   * drives through the finish and pulls up.
   */
  finish(broken: BreakEvent | null, done?: RunFinish | null): void
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
  // The swing-around camera (v1.19): drag the picture to look round the truck as it drives.
  const swing = swingCamera(box, canvas, () => view)
  caption.after(swing.hint, swing.button)
  // Truck, X-ray or Both (v1.27): one pick for every 3D view.
  swing.hint.after(truckLookToggle())
  followTruckLook((look) => view?.setLook(look))
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
      .then(({ createTrackView }) => {
        view = createTrackView(canvas)
        view.setLook(truckLook())
        return view
      })
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
    swing.ready(true)
  }

  /** The jump ramp: one unbroken side-on shot that follows the run as it happens (`ClipStream`). */
  function stream(): void {
    window.clearTimeout(retry)
    const r = current
    if (!live || !r || !view) return
    if (posesHeld(r.log) < 2) {
      retry = window.setTimeout(stream, 100)
      return
    }
    const g = r.ghost
    const lead = VIEW_3D.streamLead
    view.play(lastPoses(r.log, lead * 2), {
      rate: 1,
      loop: false,
      side: true,
      ghost: g && posesHeld(g.log) > 0 ? lastPoses(g.log, lead * 2 + 1) : null,
      stream: {
        more: (after) => posesSince(r.log, after),
        ...(g
          ? {
              ghostMore: (after: number) => posesSince(g.log, after),
              ghostBroken: () => {
                const b = g.broken()
                return b ? { corner: b.corner, kind: b.kind } : null
              },
            }
          : {}),
        lead,
      },
    })
    photo.ready(true)
    swing.ready(true)
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
        caption.textContent = t(run.road ? (run.ghost ? 'view3d.liveGhost' : run.trueSpeed ? 'view3d.liveStream' : 'view3d.live') : 'view3d.liveShaker')
        box.dataset.state = 'live'
        if (run.trueSpeed) stream()
        else next()
      })
    },
    replay(score, clip) {
      const r = current
      const v = view
      if (!r || failed || !v || clip.mine.length < 2) return false
      window.clearTimeout(retry)
      live = false
      const mine = ++turn
      caption.textContent = tf('jump.replay', { n: String(score.lap), speed: num(msToKmh(score.speed)) })
      box.dataset.state = 'landing'
      const notes: string[] = []
      v.play(clip.mine, {
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
        onEnd: () => {
          if (current === r && turn === mine) caption.textContent = landingVerdict(score)
        },
        ghost: clip.ghost,
        ghostBroken: null,
      })
      photo.ready(true)
      swing.ready(true)
      return true
    },
    finish(broken, done) {
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
          swing.ready(true)
        } else if (r.road && done && done.mine.length > 0) {
          // Lasted every lap: the last moments before the line, then on through the arch to a stop.
          caption.textContent = t('view3d.finished')
          const { ghost, ghostBroken } = ghostClip(r, ROLL_OUT.before)
          v.play([...lastPoses(r.log, ROLL_OUT.before), ...done.mine], {
            rate: 1,
            loop: false,
            finish: true,
            ghost: ghost ? [...ghost, ...done.ghost] : null,
            ghostBroken,
          })
          photo.ready(true)
          swing.ready(true)
        } else {
          if (r.road) caption.textContent = t('view3d.lasted')
          const rate = r.beat ? Math.min(1, VIEW_3D.shakerShownHz / Math.max(0.1, r.beat())) : 1
          v.play(lastPoses(r.log, VIEW_3D.clipSeconds), { rate, loop: false, ...ghostClip(r, VIEW_3D.clipSeconds) })
          photo.ready(true)
          swing.ready(true)
        }
      })
    },
    reset() {
      turn++
      photo.close()
      photo.ready(false)
      swing.ready(false)
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
