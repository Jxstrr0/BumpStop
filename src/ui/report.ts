/**
 * The report (plan PR 4): one screen at the end of every run, laid out for a
 * 360 px phone. From the top:
 *
 * 1. What let go, where, on which lap and at what speed, in one sentence.
 * 2. Why, in plain words, and a note from the crew chief.
 * 3. One big trace of the last 3 seconds, played back in slow motion, with
 *    the limit it crossed. Chips switch between that failure's channels.
 * 4. How it compares with the last run on this rig (the ghost).
 * 5. Up to three fixes, each a button that jumps to the right part or slider.
 *
 * The shaker rig gets its own short report (`shakerReport`): where the body
 * and the wheels bounce most, and the two sliders that change it.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { FAILURES, WARM_SHARE, type CornerChannel, type FixTarget, type FrameChannel } from '../data/failures'
import { RIG_VIEW, type ShopRigId } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import type { BuiltTruck } from '../sim/build'
import type { LapRun } from '../sim/laps'
import { shakerPeaks, shakerVerdict, washboardSpeed, type ShakerGrade, type ShakerPoint } from '../sim/shaker'
import type { BreakTrace } from '../sim/trace'
import { msToKmh } from '../sim/units'
import type { BreakEvent } from '../sim/wear'
import { BAND_WORD, ghostLegend, lineChart, type Band, type Series } from './charts'
import { el, num } from './dom'
import { endOf, fixJump, fixUseful, type End, type Jump } from './fixes'

const C0 = 273.15

/** A lap run the report compares against: just what the report needs from the last run. */
export interface LapGhost {
  kind: 'laps'
  broken: BreakEvent | null
  brokenLap: number
  laps: number
  /** Speed of the last lap driven (m/s). */
  lastSpeed: number
  stopped: boolean
  trace: BreakTrace | null
}

export interface ReportContext {
  rig: ShopRigId
  cls: ClassId
  truck: BuiltTruck
  /** The year on the bench: fixes that need parts not out yet are left off. */
  year: number
  /** Jump to a fix on the build screen. */
  onFix: (jump: Jump) => void
  onRunAgain: () => void
}

type Channel = CornerChannel | FrameChannel

/** How to draw one trace channel: its words, units and the lines that mark warm and the limit. */
interface ChannelPlan {
  channel: Channel
  label: StringKey
  scale: (v: number) => number
  warm: number | null
  limit: number | null
  digits: number
  /** Unit for the readout under the chart. */
  unit: string
}

function channelPlan(ch: Channel, ev: BreakEvent, truck: BuiltTruck): ChannelPlan {
  const plan = basePlan(ch, ev, truck)
  return { ...plan, unit: t(`unit.${UNIT[ch]}` as StringKey) }
}

/** The unit each channel reads in on screen. */
const UNIT: Record<Channel, string> = {
  oilTemp: 'c',
  travel: 'cm',
  load: 'kn',
  hardStop: 'kn',
  tireSquash: 'cm',
  edge: 'pct',
  jointAngle: 'deg',
  jointTorque: 'knm',
  strengthUse: 'pct',
  mountDamage: 'pct',
  axleDamage: 'pct',
  tireDamage: 'pct',
  frameFront: 'kn',
  frameTwist: 'knm',
  frameRear: 'kn',
  frameDamageFront: 'pct',
  frameDamageCentre: 'pct',
  frameDamageRear: 'pct',
}

function basePlan(ch: Channel, ev: BreakEvent, truck: BuiltTruck): Omit<ChannelPlan, 'unit'> {
  const end = endOf(ev.corner)
  const ride = truck.ride[end]
  const wear = truck.wear[end]
  const pct = (v: number) => v * 100
  const kilo = (v: number) => v / 1000
  const cm = (v: number) => v * 100
  const deg = (r: number) => (r * 180) / Math.PI
  const shareOf = (limit: number) => ({ warm: limit * WARM_SHARE, limit })
  const label = `ch.${ch}` as StringKey
  switch (ch) {
    case 'oilTemp':
      return { channel: ch, label, scale: (k) => k - C0, warm: ride.damper.warmFrom - C0, limit: ride.damper.redLine - C0, digits: 0 }
    case 'travel':
      // Amber once the wheel is on the bump stop; red at the hard limit.
      return { channel: ch, label, scale: cm, warm: cm(ride.bumpTravel - ride.bumpStopLength), limit: cm(ride.bumpTravel), digits: 0 }
    case 'load':
      return { channel: ch, label, scale: kilo, ...shareOf(kilo(wear.mount.ultimate)), digits: 0 }
    case 'hardStop':
      return { channel: ch, label, scale: kilo, ...shareOf(kilo(wear.bottoming.ultimate)), digits: 0 }
    case 'tireSquash':
      return { channel: ch, label, scale: cm, warm: cm(wear.tire.bruiseFrom), limit: cm(wear.tire.pinchAt), digits: 1 }
    case 'edge':
      // Steep ground isn't a limit on its own, only a warning: amber from where it counts as sharp.
      return { channel: ch, label, scale: pct, warm: pct(wear.tire.sharpEdge), limit: null, digits: 0 }
    case 'jointAngle':
      return { channel: ch, label, scale: deg, ...shareOf(deg(wear.axle.maxAngle)), digits: 0 }
    case 'jointTorque':
      return { channel: ch, label, scale: kilo, warm: null, limit: null, digits: 1 }
    case 'frameTwist':
      return { channel: ch, label, scale: kilo, ...shareOf(kilo(truck.wear.frame.centre.ultimate)), digits: 0 }
    case 'frameFront':
    case 'frameRear':
      return { channel: ch, label, scale: kilo, warm: null, limit: null, digits: 0 }
    default:
      // Strength in use and every damage bar: a share, over the limit at 100%.
      return { channel: ch, label, scale: pct, ...shareOf(100), digits: 0 }
  }
}

/** The channel that tells the story best, shown first. */
function mainChannel(ev: BreakEvent): Channel {
  switch (ev.kind) {
    case 'fade':
      return 'oilTemp'
    case 'bottoming':
      return 'travel'
    case 'mount':
      return 'mountDamage'
    case 'axle':
      // A joint that bound up shows its angle; one that snapped shows how much of its strength was in use.
      return ev.limit !== 1 ? 'jointAngle' : 'strengthUse'
    case 'tire':
      return ev.fatigue ? 'tireDamage' : 'tireSquash'
    case 'frame':
      return ev.zone === 'front' ? 'frameDamageFront' : ev.zone === 'rear' ? 'frameDamageRear' : 'frameDamageCentre'
  }
}

/** Where it broke, in words: "rear left" or "centre of the frame". */
export function whereText(ev: BreakEvent): string {
  if (ev.kind === 'frame') return tf('report.whereFrame', { zone: t(`zone.${ev.zone ?? 'centre'}` as StringKey) })
  return t(`corner.${ev.corner}` as StringKey)
}

function lapsText(n: number): string {
  return n === 1 ? t('report.lap1') : tf('report.laps', { n: String(n) })
}

function smoothMotion(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** "Goes to the rear axle's spring rate slider" or "Goes to the dampers part". */
function jumpText(jump: Jump): string {
  if (jump.kind === 'slot') return tf('report.goesTo', { where: tf('report.whereSlot', { slot: t(`slot.${jump.slot}` as StringKey).toLowerCase() }) })
  return tf('report.goesTo', {
    where: tf('report.whereAxle', { end: t(`end.${jump.end}` as StringKey), setting: t(`build.${jump.key}` as StringKey).toLowerCase() }),
  })
}

/**
 * The fix buttons: each jumps to its part or slider. A fix with nowhere to go
 * yet is plain text. Fixes that can't be done in this year (or on this
 * truck) give way to the next one on the list, up to three.
 */
function fixList(fixes: readonly { target: FixTarget; text: StringKey }[], end: End, ctx: ReportContext): HTMLElement {
  const list = el('ul', 'fix-buttons')
  for (const fix of fixes.filter((f) => fixUseful(f.target, end, ctx.truck.build, ctx.year)).slice(0, 3)) {
    const jump = fixJump(fix.target, end, ctx.truck.build)
    const li = el('li')
    if (!jump) {
      li.append(el('p', 'small fix-later', fix.target === 'pace' ? t('report.pace') : t(fix.text)))
    } else {
      const b = el('button', 'fix-btn')
      b.type = 'button'
      b.append(el('span', 'fix-what', t(fix.text)), el('span', 'fix-where', jumpText(jump)))
      b.addEventListener('click', () => ctx.onFix(jump))
      li.append(b)
    }
    list.append(li)
  }
  return list
}

function kicker(ctx: ReportContext): HTMLElement {
  const cls = CLASSES.find((c) => c.id === ctx.cls)!
  return el('p', 'kicker', tf('report.kicker', { rig: t(`rig.${ctx.rig}` as StringKey), cls: t(cls.name) }))
}

function crewNote(text: string): HTMLElement {
  const q = el('blockquote', 'crew')
  q.append(el('p', '', `“${text}”`), el('cite', '', `— ${t('report.crewWho')}`))
  return q
}

function runAgainButton(ctx: ReportContext): HTMLButtonElement {
  const again = el('button', 'btn run-again', t('report.runAgain'))
  again.type = 'button'
  again.addEventListener('click', ctx.onRunAgain)
  return again
}

/** "Last run: Damper fade on lap 6 at 65 km/h. This one went 2 laps further." with a Better / Same / Worse chip. */
function compareLine(run: LapRun, stopped: boolean, ghost: LapGhost | null): HTMLElement | null {
  if (!ghost) return null
  const p = el('p', 'compare')
  let last: string
  if (ghost.broken) {
    last = tf('report.lastBroke', { what: t(FAILURES[ghost.broken.kind].name), lap: String(ghost.brokenLap), speed: num(msToKmh(ghost.lastSpeed)) })
  } else if (ghost.stopped) {
    last = tf('report.lastStopped', { lap: String(ghost.laps) })
  } else {
    last = tf('report.lastLasted', { laps: String(ghost.laps) })
  }
  // Only compare like with like: two runs that both broke, or a break against one that lasted.
  let verdict: 'better' | 'same' | 'worse' | null = null
  let diff = ''
  if (!stopped && !ghost.stopped) {
    const nowLaps = run.broken ? run.brokenLap : Infinity
    const thenLaps = ghost.broken ? ghost.brokenLap : Infinity
    if (nowLaps > thenLaps) {
      verdict = 'better'
      if (Number.isFinite(nowLaps)) diff = tf('report.further', { n: lapsText(nowLaps - thenLaps) })
    } else if (nowLaps < thenLaps) {
      verdict = 'worse'
      if (Number.isFinite(thenLaps)) diff = tf('report.sooner', { n: lapsText(thenLaps - nowLaps) })
    } else if (Number.isFinite(nowLaps)) {
      verdict = 'same'
      diff = t('report.sameLap')
    }
  }
  if (verdict) {
    const band = verdict === 'better' ? 'cool' : verdict === 'same' ? 'warm' : 'hot'
    p.append(el('span', `chip ${band}`, t(`report.${verdict}`)), ' ')
  }
  p.append([last, diff].filter(Boolean).join(' '))
  return p
}

/** The big trace, with its channel chips and slow-motion playback. */
function traceBlock(ev: BreakEvent, trace: BreakTrace, ghost: LapGhost | null, truck: BuiltTruck): HTMLElement {
  const info = FAILURES[ev.kind]
  const channels: Channel[] = ev.corner >= 0 ? [...info.corner] : [...info.frame]
  const first = mainChannel(ev)
  const ordered = [first, ...channels.filter((c) => c !== first)].filter((c) => (trace.channels[c]?.length ?? 0) > 1)
  const box = el('div', 'report-trace')
  if (ordered.length === 0) return box

  const chips = el('div', 'btn-row chip-row')
  chips.setAttribute('role', 'group')
  chips.setAttribute('aria-label', t('report.title'))
  const title = el('p', 'chart-title')
  const holder = el('div', 'big-chart')
  const legendHolder = el('div')
  const readout = el('p', 'readout-line')
  const caption = el('p', 'axis', t(info.traceText))
  const replay = el('button', 'btn small-btn', t('report.replay'))
  replay.type = 'button'
  let raf = 0
  let current = first

  const t0 = trace.t[0] as number
  const t1 = trace.t[trace.t.length - 1] as number
  // Seconds before the break, so both this run and the ghost end at 0.
  const xs = trace.t.map((tt) => tt - t1)

  function draw(ch: Channel, play: boolean): void {
    cancelAnimationFrame(raf)
    current = ch
    for (const b of chips.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.ch === ch))
    const plan = channelPlan(ch, ev, truck)
    const ys = (trace.channels[ch] as number[]).map(plan.scale)
    // The ghost only makes sense if the last run broke the same way: then its last 3 seconds line up.
    let ghostSeries: Series | null = null
    const gTrace = ghost?.broken?.kind === ev.kind ? ghost.trace : null
    const gRaw = gTrace?.channels[ch]
    if (gTrace && gRaw && gRaw.length > 1) {
      const gEnd = gTrace.t[gTrace.t.length - 1] as number
      ghostSeries = { x: gTrace.t.map((tt) => tt - gEnd), y: gRaw.map(plan.scale) }
    }
    const name = t(plan.label)
    const alt =
      plan.limit !== null
        ? tf('report.alt', { channel: name, limit: num(plan.limit, plan.digits) })
        : tf('report.altNoLimit', { channel: name })
    const chart = lineChart({
      series: { x: xs, y: ys },
      ghost: ghostSeries,
      warm: plan.warm,
      limit: plan.limit,
      xMin: t0 - t1,
      xMax: 0,
      xLabel: t('report.lastSecs'),
      digits: plan.digits,
      alt,
      height: 210,
    })
    title.textContent = name
    holder.replaceChildren(chart.svg)
    legendHolder.replaceChildren(...[ghostLegend(ghostSeries !== null)].filter((n): n is SVGSVGElement => n !== null))
    // "−1.2 s: 128 °C · Warm", following the dot.
    const show = (upTo: number) => {
      const at = chart.reveal(upTo)
      readout.replaceChildren(
        `${num(at.x, 1)} s: ${num(at.value, plan.digits)} ${plan.unit} `,
        el('span', `chip ${at.band}`, BAND_WORD[at.band]),
      )
    }
    if (!play || !smoothMotion()) {
      show(0)
      return
    }
    // Slow motion: the last 3 seconds drawn at RIG_VIEW.slowMotion of real speed.
    const start = performance.now()
    const span = t1 - t0
    const frame = (now: number) => {
      const shown = ((now - start) / 1000) * RIG_VIEW.slowMotion
      show(Math.min(0, -span + shown))
      if (shown < span) raf = requestAnimationFrame(frame)
    }
    show(-span)
    raf = requestAnimationFrame(frame)
  }

  if (ordered.length > 1) {
    for (const ch of ordered) {
      const b = el('button', 'btn chip-btn', t(`chs.${ch}` as StringKey))
      b.type = 'button'
      b.dataset.ch = ch
      b.addEventListener('click', () => draw(ch, true))
      chips.append(b)
    }
    box.append(chips)
  }
  replay.addEventListener('click', () => draw(current, true))
  box.append(title, holder, legendHolder, readout, caption, replay)
  draw(first, true)
  return box
}

/** The report for a washboard ladder or torture loop run. */
export function lapReport(run: LapRun, stopped: boolean, ghost: LapGhost | null, ctx: ReportContext): HTMLElement {
  const box = el('section', 'report')
  box.setAttribute('aria-labelledby', 'report-head')
  const last = run.laps[run.laps.length - 1]
  const lapNo = last?.lap ?? 0
  const speed = num(msToKmh(last?.speed ?? 0))
  const head = el('h3', 'report-head')
  head.id = 'report-head'
  head.tabIndex = -1
  const ev = run.broken

  box.append(el('h2', '', t('report.title')), kicker(ctx), head)
  if (ev) {
    const info = FAILURES[ev.kind]
    const where = whereText(ev)
    head.append(el('span', 'chip hot', t('trace.hot')), ' ', tf('report.head', { what: t(info.name), where, lap: String(run.brokenLap), speed }))
    const vars = { where, lap: String(run.brokenLap), speed, zone: t(`zone.${ev.zone ?? 'centre'}` as StringKey) }
    const variant = ((run.brokenLap + Math.max(0, ev.corner)) % 2) + 1
    box.append(el('p', 'cause', t(info.cause)), crewNote(tf(`crew.${ev.kind}${variant}` as StringKey, vars)))
    if (run.trace) box.append(traceBlock(ev, run.trace, ghost, ctx.truck))
    const cmp = compareLine(run, stopped, ghost)
    if (cmp) box.append(cmp)
    box.append(el('h4', '', t('report.fixes')), fixList(info.fixes, endOf(ev.corner), ctx))
  } else {
    head.append(el('span', 'chip cool', t('trace.cool')), ' ', stopped ? tf('report.stopped', { lap: String(lapNo), speed }) : tf('report.lasted', { laps: String(run.laps.length), speed }))
    box.append(crewNote(stopped ? tf('crew.stopped', { lap: String(lapNo) }) : tf('crew.lasted', { laps: String(run.laps.length) })))
    const cmp = compareLine(run, stopped, ghost)
    if (cmp) box.append(cmp)
  }
  box.append(runAgainButton(ctx))
  return box
}

/** The trace rule's colours for a shaker grade: calm is cool, lively warm, too much hot. Words always go with them. */
const GRADE_BAND: Record<ShakerGrade, Band> = { calm: 'cool', lively: 'warm', wild: 'hot' }

/**
 * The shaker's verdict (Kelbo's playtest, 26 November 2026): Good, Fair or
 * Poor, a chip each for the body and the wheels, and a sentence on what it
 * means for a raid, so the two numbers under it have a judgement.
 */
function shakerVerdictBox(peaks: NonNullable<ReturnType<typeof shakerPeaks>>, cls: ClassId): HTMLElement {
  const v = shakerVerdict(peaks, cls)
  const box = el('div', `shaker-verdict ${GRADE_BAND[v.overall]}-edge`)
  box.append(el('p', 'verdict-head', tf('shaker.verdict', { word: t(`shaker.grade.${v.overall}` as StringKey) })))
  const chips = el('p', 'verdict-chips')
  chips.append(
    t('shaker.gradeBody'), ' ', el('span', `chip ${GRADE_BAND[v.body]}`, t(`shaker.gBody.${v.body}` as StringKey)), ' ',
    t('shaker.gradeWheel'), ' ', el('span', `chip ${GRADE_BAND[v.wheel]}`, t(`shaker.gWheel.${v.wheel}` as StringKey)),
  )
  // Name whichever of the two is as bad as the verdict.
  const what = v.body === v.overall && v.wheel === v.overall ? 'both' : v.body === v.overall ? 'body' : 'wheel'
  box.append(chips, el('p', 'small', tf(`shaker.say.${v.overall}` as StringKey, { what: t(`shaker.what.${what}` as StringKey) })))
  return box
}

/** The shaker's report: where the body and the wheels bounce most, what that means, and what changes it. */
export function shakerReport(points: readonly ShakerPoint[], ghost: readonly ShakerPoint[] | null, ctx: ReportContext): HTMLElement {
  const box = el('section', 'report')
  box.setAttribute('aria-labelledby', 'report-head')
  const head = el('h3', 'report-head')
  head.id = 'report-head'
  head.tabIndex = -1
  box.append(el('h2', '', t('report.title')), kicker(ctx), head)
  const peaks = shakerPeaks(points)
  if (!peaks) return box
  const hz = (f: number) => num(f, 1)
  const gain = (g: number) => num(g, 1)
  head.append(tf('shaker.head', { body: hz(peaks.body.freq), wheel: hz(peaks.wheel.freq) }))
  box.append(
    shakerVerdictBox(peaks, ctx.cls),
    el('p', 'cause', tf('shaker.bodyLine', { hz: hz(peaks.body.freq), end: t(`end.${peaks.body.end}` as StringKey), gain: gain(peaks.body.gain) })),
    el(
      'p',
      'cause',
      tf('shaker.wheelLine', {
        hz: hz(peaks.wheel.freq),
        end: t(`end.${peaks.wheel.end}` as StringKey),
        gain: gain(peaks.wheel.gain),
        kmh: num(msToKmh(washboardSpeed(peaks.wheel.freq))),
      }),
    ),
    crewNote(t(Math.round(peaks.wheel.freq) % 2 === 0 ? 'crew.shaker1' : 'crew.shaker2')),
  )
  const before = ghost ? shakerPeaks(ghost) : null
  if (before) {
    box.append(
      el(
        'p',
        'compare',
        tf('shaker.last', { body: gain(before.body.gain), bodyHz: hz(before.body.freq), wheel: gain(before.wheel.gain), wheelHz: hz(before.wheel.freq) }),
      ),
    )
  }
  // Springs move the body's bounce; damping (or lighter wheels) calms the hop.
  const springFix: { target: FixTarget; text: StringKey } = { target: 'springRate', text: 'shaker.fixSpring' }
  const hopFix: { target: FixTarget; text: StringKey } = { target: 'rebound', text: 'shaker.fixHop' }
  const list = el('ul', 'fix-buttons')
  for (const [fix, end] of [
    [springFix, peaks.body.end],
    [hopFix, peaks.wheel.end],
  ] as const) {
    const jump = fixUseful(fix.target, end, ctx.truck.build, ctx.year) ? fixJump(fix.target, end, ctx.truck.build) : null
    if (!jump) continue
    const b = el('button', 'fix-btn')
    b.type = 'button'
    b.append(el('span', 'fix-what', t(fix.text)), el('span', 'fix-where', jumpText(jump)))
    b.addEventListener('click', () => ctx.onFix(jump))
    const li = el('li')
    li.append(b)
    list.append(li)
  }
  box.append(el('h4', '', t('shaker.fixes')), list, runAgainButton(ctx))
  return box
}
