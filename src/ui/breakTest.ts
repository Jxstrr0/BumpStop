/**
 * The break test on the preview screen (plan PR 2): pick a truck and a test
 * loop, and the sim drives it 5 km/h faster every lap until something lets
 * go. It says what broke, where and why, draws that failure's trace from the
 * last few seconds, and lists where to fix it.
 *
 * This is a test bench, not the game screen: the rigs with live traces and
 * the report with fix jumps arrive in plan PR 4.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { FAILURES, type CornerChannel, type FrameChannel } from '../data/failures'
import { RIGS, type RigId } from '../data/rigs'
import { TEST_MULES } from '../data/ride'
import { t, tf, type StringKey } from '../data/strings'
import { MULE_WEAR } from '../data/wear'
import { runLaps, type LapRun } from '../sim/laps'
import { fromCelsius, msToKmh } from '../sim/units'
import type { BreakEvent } from '../sim/wear'
import { el, num, svg } from './dom'

const AIR = fromCelsius(20)
const RIG_IDS: readonly RigId[] = ['tortureLoop', 'washboardLadder']
const RIG_NAME: Record<RigId, StringKey> = { tortureLoop: 'break.torture', washboardLadder: 'break.ladder' }

/** Which channel the little chart shows for a break, how to scale it, and where its limit line goes. */
interface ChartPlan {
  channel: CornerChannel | FrameChannel
  label: StringKey
  scale: (v: number) => number
  limit: number
}

function chartPlan(ev: BreakEvent, cls: ClassId): ChartPlan {
  const pct = (v: number) => v * 100
  const axle = ev.corner < 2 ? TEST_MULES[cls].front : TEST_MULES[cls].rear
  switch (ev.kind) {
    case 'fade':
      return { channel: 'oilTemp', label: 'break.chOil', scale: (k) => k - 273.15, limit: ev.limit - 273.15 }
    case 'bottoming':
      return { channel: 'travel', label: 'break.chTravel', scale: (m) => m * 100, limit: axle.bumpTravel * 100 }
    case 'mount':
      return { channel: 'mountDamage', label: 'break.chDamage', scale: pct, limit: 100 }
    case 'axle':
      // A joint that bound up shows its angle; one that snapped shows how much of its strength was in use.
      return ev.limit !== 1
        ? { channel: 'jointAngle', label: 'break.chAngle', scale: (r) => (r * 180) / Math.PI, limit: (ev.limit * 180) / Math.PI }
        : { channel: 'strengthUse', label: 'break.chStrength', scale: pct, limit: 100 }
    case 'tire':
      return ev.fatigue
        ? { channel: 'tireDamage', label: 'break.chDamage', scale: pct, limit: 100 }
        : { channel: 'tireSquash', label: 'break.chSquash', scale: (m) => m * 100, limit: ev.limit * 100 }
    case 'frame': {
      const zone = ev.zone === 'front' ? 'frameDamageFront' : ev.zone === 'rear' ? 'frameDamageRear' : 'frameDamageCentre'
      return { channel: zone, label: 'break.chDamage', scale: pct, limit: 100 }
    }
  }
}

/** The last seconds before the break, with the limit as a red dashed line. */
function traceChart(run: LapRun, cls: ClassId): SVGSVGElement | null {
  const ev = run.broken
  const trace = run.trace
  if (!ev || !trace) return null
  const plan = chartPlan(ev, cls)
  const raw = trace.channels[plan.channel]
  if (!raw || raw.length < 2) return null
  const values = raw.map(plan.scale)
  const W = 320
  const H = 150
  const left = 38
  const right = 10
  const top = 10
  const bottom = 24
  const t0 = trace.t[0] as number
  const t1 = trace.t[trace.t.length - 1] as number
  let lo = Math.min(...values, plan.limit)
  let hi = Math.max(...values, plan.limit)
  const pad = (hi - lo) * 0.1 || 1
  lo -= pad
  hi += pad
  const x = (tt: number) => left + ((tt - t0) / (t1 - t0 || 1)) * (W - left - right)
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom)

  const name = t(FAILURES[ev.kind].name)
  const box = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    role: 'img',
    'aria-label': tf('break.alt', { what: name, channel: t(plan.label), limit: num(plan.limit, 0) }),
  })
  box.append(svg('rect', { x: left, y: top, width: W - left - right, height: H - top - bottom, class: 'band cool' }))
  box.append(svg('line', { x1: left, x2: W - right, y1: y(plan.limit), y2: y(plan.limit), class: 'redline' }))
  const limitLabel = svg('text', { x: left + 4, y: y(plan.limit) - 4, class: 'chart-label hot-text' })
  limitLabel.textContent = t('break.limit')
  box.append(limitLabel)
  for (const v of [lo + pad, hi - pad]) {
    const tick = svg('text', { x: left - 4, y: y(v) + 4, class: 'chart-tick', 'text-anchor': 'end' })
    tick.textContent = num(v, 0)
    box.append(tick)
  }
  const secs = svg('text', { x: W - right, y: H - 6, class: 'chart-tick', 'text-anchor': 'end' })
  secs.textContent = t('break.axis')
  box.append(secs)
  const line = values.map((v, i) => `${x(trace.t[i] as number).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  box.append(svg('polyline', { points: line, class: 'trace-line' }))
  box.append(svg('circle', { cx: x(t1), cy: y(values[values.length - 1] as number), r: 6, class: 'dot hot' }))
  return box
}

function where(ev: BreakEvent): string {
  if (ev.kind === 'frame') return tf('break.whereFrame', { zone: t(`zone.${ev.zone ?? 'centre'}` as StringKey) })
  return t(`corner.${ev.corner}` as StringKey)
}

/** Let the "Running…" text paint before the sim takes the main thread for a moment. */
function later(work: () => void): void {
  requestAnimationFrame(() => setTimeout(work, 0))
}

export function breakTestPanel(): HTMLElement {
  const box = el('section', 'panel trace')
  box.append(el('h2', '', t('break.title')), el('p', 'lead', t('break.lead')))

  let cls: ClassId = 'light4x4'
  let rig: RigId = 'tortureLoop'
  let road = 1

  const classRow = el('div', 'btn-row')
  const classButtons = CLASSES.map((c) => {
    const b = el('button', 'btn', t(c.name))
    b.type = 'button'
    b.addEventListener('click', () => {
      cls = c.id
      sync()
    })
    classRow.append(b)
    return { id: c.id, b }
  })
  const rigRow = el('div', 'btn-row')
  const rigButtons = RIG_IDS.map((id) => {
    const b = el('button', 'btn', t(RIG_NAME[id]))
    b.type = 'button'
    b.addEventListener('click', () => {
      rig = id
      sync()
    })
    rigRow.append(b)
    return { id, b }
  })

  const runButton = el('button', 'btn', t('break.run'))
  runButton.type = 'button'
  const verdict = el('p', 'verdict')
  verdict.setAttribute('aria-live', 'polite')
  const cause = el('p', 'small')
  const holder = el('div', 'sim-chart')
  const traceNote = el('p', 'axis')
  const fixTitle = el('h3', 'sim-chart-title')
  const fixes = el('ul', 'fix-list')
  const laps = el('p', 'small')

  function sync(): void {
    for (const { id, b } of classButtons) b.setAttribute('aria-pressed', String(id === cls))
    for (const { id, b } of rigButtons) b.setAttribute('aria-pressed', String(id === rig))
  }

  runButton.addEventListener('click', () => {
    runButton.disabled = true
    verdict.textContent = t('sim.running')
    for (const n of [cause, traceNote, fixTitle, laps]) n.textContent = ''
    fixes.replaceChildren()
    holder.replaceChildren()
    later(() => {
      const started = performance.now()
      const run = runLaps(TEST_MULES[cls], MULE_WEAR[cls], RIGS[rig], (CLASSES.findIndex((c) => c.id === cls) + 1) * 100 + road, {
        airTemp: AIR,
      })
      const ms = performance.now() - started
      road++
      const ev = run.broken
      const last = run.laps[run.laps.length - 1]
      if (!ev || !last) {
        verdict.textContent = t('break.none')
      } else {
        const info = FAILURES[ev.kind]
        verdict.replaceChildren(
          el('span', 'chip hot', t('trace.hot')),
          ` ${tf('break.result', { lap: String(run.brokenLap), speed: num(msToKmh(last.speed)), what: t(info.name), where: where(ev) })}`,
        )
        cause.textContent = t(info.cause)
        const chart = traceChart(run, cls)
        if (chart) holder.append(chart)
        traceNote.textContent = t(info.traceText)
        fixTitle.textContent = t('break.fixes')
        for (const fix of info.fixes) fixes.append(el('li', '', t(fix.text)))
      }
      laps.textContent = tf('break.timing', { laps: String(run.laps.length), ms: num(ms) })
      runButton.disabled = false
    })
  })

  box.append(classRow, rigRow, runButton, verdict, cause, holder, traceNote, fixTitle, fixes, laps)
  sync()
  return box
}
