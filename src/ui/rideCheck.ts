/**
 * The ride sim on the preview screen (plan PR 1): the truck on the build
 * screen (plan PR 3) drives the 12 km test stage at 500 steps a second, and the chart shows the
 * hottest damper's oil temperature along the way. A second button runs a
 * 300 km stage the long-stage way (samples plus scaling) and says how long
 * it took. The chart follows the trace rule: cool blue for normal, amber for
 * warm, red for over the limit, always with a word too.
 *
 * This is a test bench, not the game screen: the rigs and the report arrive
 * in plan PR 4.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { PREVIEW_LONG_REPEATS, PREVIEW_STAGE, PREVIEW_TRACE_SECONDS } from '../data/previewStage'
import { SIM, type DamperSetup, type RideSetup } from '../data/ride'
import { t, tf, type StringKey } from '../data/strings'
import { buildProfile } from '../sim/ground'
import { driveSection, restingState, rideParams } from '../sim/ride'
import { Rng } from '../sim/rng'
import { runStage } from '../sim/stage'
import { fromCelsius, msToKmh, toCelsius } from '../sim/units'
import type { BuildStore } from './buildStore'
import { el, num, svg } from './dom'

const AIR = fromCelsius(20)

interface Point {
  km: number
  /** °C */
  temp: number
}

interface PreviewRun {
  points: Point[]
  km: number
  bumps: number
  airTime: number
  ms: number
}

type Band = 'cool' | 'warm' | 'hot'

function bandOf(tempC: number, d: DamperSetup): Band {
  return tempC >= toCelsius(d.redLine) ? 'hot' : tempC >= toCelsius(d.warmFrom) ? 'warm' : 'cool'
}

const BAND_WORD: Record<Band, StringKey> = { cool: 'trace.cool', warm: 'trace.warm', hot: 'trace.hot' }

function seedFor(id: ClassId, road: number): number {
  return (CLASSES.findIndex((c) => c.id === id) + 1) * 1000 + road
}

/** Drive the test stage in full detail and keep the hottest damper's temperature every half second. */
function runPreview(setup: RideSetup, id: ClassId, road: number): PreviewRun {
  const started = performance.now()
  const p = rideParams(setup)
  const s = restingState(AIR)
  const root = new Rng(seedFor(id, road))
  const every = Math.round(PREVIEW_TRACE_SECONDS * SIM.stepsPerSecond)
  const points: Point[] = [{ km: 0, temp: toCelsius(AIR) }]
  let distance = 0
  let bumps = 0
  let airTime = 0
  PREVIEW_STAGE.forEach((seg, i) => {
    const profile = buildProfile(seg.ground, seg.length + setup.cgToFront + setup.cgToRear, root.fork(`segment-${i}`))
    const { stats, trace } = driveSection(s, p, profile, { speed: seg.speed, traceEvery: every })
    for (const sample of trace) {
      points.push({ km: (distance + sample.x - setup.cgToRear) / 1000, temp: toCelsius(Math.max(...sample.oilTemp)) })
    }
    distance += stats.distance
    bumps += stats.bottomOuts.reduce((a, b) => a + b, 0)
    airTime += stats.airTime
  })
  return { points, km: distance / 1000, bumps, airTime, ms: performance.now() - started }
}

function chart(run: PreviewRun, d: DamperSetup): SVGSVGElement {
  const W = 320
  const H = 190
  const left = 34
  const right = 10
  const top = 10
  const bottom = 26
  const red = toCelsius(d.redLine)
  const warm = toCelsius(d.warmFrom)
  const peak = run.points.reduce((m, pt) => (pt.temp > m.temp ? pt : m), run.points[0] as Point)
  const tMin = 0
  const tMax = Math.ceil((Math.max(red + 30, peak.temp + 10)) / 20) * 20
  const x = (km: number) => left + (km / run.km) * (W - left - right)
  const y = (temp: number) => top + (1 - (temp - tMin) / (tMax - tMin)) * (H - top - bottom)

  const alt = tf('sim.alt', { km: num(run.km, 0), temp: num(peak.temp, 0), at: num(peak.km, 1) })
  const box = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': alt })
  const width = W - left - right
  box.append(
    svg('rect', { x: left, y: y(warm), width, height: y(tMin) - y(warm), class: 'band cool' }),
    svg('rect', { x: left, y: y(red), width, height: y(warm) - y(red), class: 'band warm' }),
    svg('rect', { x: left, y: y(tMax), width, height: y(red) - y(tMax), class: 'band hot' }),
  )
  // Where each kind of ground starts, as faint lines.
  let km = 0
  for (const seg of PREVIEW_STAGE.slice(0, -1)) {
    km += seg.length / 1000
    box.append(svg('line', { x1: x(km), x2: x(km), y1: top, y2: H - bottom, class: 'seg-line' }))
  }
  box.append(svg('line', { x1: left, x2: W - right, y1: y(red), y2: y(red), class: 'redline' }))
  const redLabel = svg('text', { x: left + 4, y: y(red) - 4, class: 'chart-label hot-text' })
  redLabel.textContent = `${t('trace.redline')} ${num(red)} °C`
  box.append(redLabel)
  for (let k = 0; k <= run.km; k += 2) {
    const tick = svg('text', { x: x(k), y: H - 8, class: 'chart-tick', 'text-anchor': 'middle' })
    tick.textContent = String(k)
    box.append(tick)
  }
  for (let temp = 0; temp <= tMax; temp += 40) {
    const tick = svg('text', { x: left - 4, y: y(temp) + 4, class: 'chart-tick', 'text-anchor': 'end' })
    tick.textContent = String(temp)
    box.append(tick)
  }
  const line = run.points.map((pt) => `${x(pt.km).toFixed(1)},${y(pt.temp).toFixed(1)}`).join(' ')
  box.append(svg('polyline', { points: line, class: 'trace-line' }))
  box.append(svg('circle', { cx: x(peak.km), cy: y(peak.temp), r: 6, class: `dot ${bandOf(peak.temp, d)}` }))
  return box
}

/** The stage as a roadbook list: where each ground starts, and the speed on it. */
function stageList(): HTMLElement {
  const list = el('ol', 'rb-rows sim-stage')
  let km = 0
  for (const seg of PREVIEW_STAGE) {
    const row = el('li', 'rb-row')
    const dist = el('div', 'rb-km')
    dist.append(el('span', 'rb-num', num(km, 1)), el('span', 'rb-unit', t('roadbook.km')))
    const ground = t(`ground.${seg.ground}` as StringKey)
    row.append(dist, el('p', 'rb-note', tf('sim.segment', { ground, speed: num(msToKmh(seg.speed), 0) })))
    list.append(row)
    km += seg.length / 1000
  }
  return list
}

/** Let the "Running…" text paint before the sim takes the main thread for a moment. */
function later(work: () => void): void {
  requestAnimationFrame(() => setTimeout(work, 0))
}

export function rideCheckPanel(store: BuildStore): HTMLElement {
  const box = el('section', 'panel trace')
  box.append(el('h2', '', t('sim.title')), el('p', 'lead', t('sim.lead')))

  let road = 1

  const testing = el('p', 'small testing')
  // The stage only runs when asked (or the class changes): running it on every slider move would be slow on a phone.
  const drive = el('button', 'btn', t('sim.drive'))
  drive.type = 'button'
  drive.addEventListener('click', () => draw())
  const another = el('button', 'btn', t('sim.anotherRoad'))
  another.type = 'button'
  another.addEventListener('click', () => {
    road++
    draw()
  })

  const title = el('h3', 'sim-chart-title', t('sim.chartTitle'))
  const roadLabel = el('span', 'sim-road')
  const holder = el('div', 'sim-chart')
  const verdict = el('p', 'verdict')
  verdict.setAttribute('aria-live', 'polite')
  const details = el('p', 'small')
  const legend = el('ul', 'legend')
  for (const band of ['cool', 'warm', 'hot'] as const) legend.append(el('li', `chip ${band}`, t(BAND_WORD[band])))

  const longButton = el('button', 'btn', t('sim.long'))
  longButton.type = 'button'
  const longResult = el('p', 'small')
  longResult.setAttribute('aria-live', 'polite')
  longButton.addEventListener('click', () => {
    longButton.disabled = true
    longResult.textContent = t('sim.running')
    later(() => {
      const setup = store.truck().ride
      const picked = store.cls()
      const segments = Array.from({ length: PREVIEW_LONG_REPEATS }, () => PREVIEW_STAGE).flat()
      const started = performance.now()
      const r = runStage(setup, { airTemp: AIR, segments }, seedFor(picked, road))
      const ms = performance.now() - started
      const pct = (100 * r.stepsSimulated) / (r.time * SIM.stepsPerSecond)
      longResult.textContent = tf('sim.longResult', {
        ms: num(ms),
        temp: num(toCelsius(Math.max(...r.endTemp))),
        pct: num(pct, 1),
      })
      longButton.disabled = false
    })
  })

  function draw(): void {
    const picked = store.cls()
    const cls = CLASSES.find((c) => c.id === picked)!
    testing.textContent = tf('build.testing', { cls: t(cls.name) })
    roadLabel.textContent = tf('sim.road', { n: String(road) })
    verdict.textContent = t('sim.running')
    longResult.textContent = ''
    later(() => {
      const setup = store.truck().ride
      const run = runPreview(setup, picked, road)
      const d = setup.rear.damper
      const peak = run.points.reduce((m, pt) => (pt.temp > m.temp ? pt : m), run.points[0] as Point)
      const band = bandOf(peak.temp, d)
      holder.replaceChildren(chart(run, d))
      verdict.replaceChildren(
        el('span', `chip ${band}`, t(BAND_WORD[band])),
        ` ${tf('sim.peak', { temp: num(peak.temp), at: num(peak.km, 1) })}`,
      )
      details.textContent = `${tf('sim.details', { bumps: num(run.bumps), air: num(run.airTime, 1) })} ${tf('sim.timing', { ms: num(run.ms) })}`
    })
  }

  const head = el('div', 'sim-head')
  head.append(title, roadLabel)
  box.append(testing, head, holder, el('p', 'axis', t('sim.axis')), legend, verdict, details, stageList(), drive, another, longButton, longResult)
  store.onChange((change) => {
    if (change === 'class') draw()
  })
  draw()
  return box
}
