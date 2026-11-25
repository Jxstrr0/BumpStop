/**
 * The look preview's two drawings (plan PR 0): a roadbook strip and a sample
 * trace. Both are plain SVG with sample numbers, so the look can be judged on
 * a phone before the sim exists. The trace follows the game's one colour
 * rule: cool blue for normal, amber for warm, red for over the limit, and
 * always a word as well, so colour is never the only signal.
 */
import { t, type StringKey } from '../data/strings'
import { el, num, svg } from './dom'

/** A tulip: the roadbook's little junction drawing. Dot = where you come in, arrow = where you go. */
function tulip(turn: 'straight' | 'right' | 'left', label: StringKey): SVGSVGElement {
  const box = svg('svg', { viewBox: '0 0 48 48', class: 'tulip', role: 'img', 'aria-label': t(label) })
  // The road you don't take, drawn thin.
  box.append(svg('path', { d: 'M24 44V8', class: 'tulip-side' }))
  if (turn !== 'straight') box.append(svg('path', { d: turn === 'right' ? 'M24 24H6' : 'M24 24H42', class: 'tulip-side' }))
  // The road you take, drawn thick, ending in an arrow.
  const path =
    turn === 'straight' ? 'M24 42V10' : turn === 'right' ? 'M24 42V24H40' : 'M24 42V24L10 12'
  const head =
    turn === 'straight' ? 'M17 16L24 8L31 16' : turn === 'right' ? 'M34 17L42 24L34 31' : 'M8 21L8 10L19 10'
  box.append(svg('path', { d: path, class: 'tulip-way' }), svg('path', { d: head, class: 'tulip-way' }))
  box.append(svg('circle', { cx: 24, cy: 42, r: 4, class: 'tulip-dot' }))
  return box
}

export function roadbookStrip(): HTMLElement {
  const box = el('section', 'panel roadbook')
  box.append(el('h2', '', t('roadbook.title')))
  const rows: [number, 'straight' | 'right' | 'left', StringKey, StringKey][] = [
    [0, 'straight', 'roadbook.tulipStraight', 'roadbook.row1'],
    [2.35, 'right', 'roadbook.tulipRight', 'roadbook.row2'],
    [7.8, 'left', 'roadbook.tulipLeft', 'roadbook.row3'],
  ]
  const list = el('ol', 'rb-rows')
  for (const [km, turn, label, note] of rows) {
    const row = el('li', 'rb-row')
    const dist = el('div', 'rb-km')
    dist.append(el('span', 'rb-num', num(km, 2)), el('span', 'rb-unit', t('roadbook.km')))
    row.append(dist, tulip(turn, label), el('p', 'rb-note', t(note)))
    list.append(row)
  }
  box.append(list)
  return box
}

/** Sample oil temperatures per lap (°C). Display only; the real ones come from the sim in plan PR 1. */
const SAMPLE_TEMPS = [40, 62, 84, 103, 121, 150]
const WARM_FROM = 90
const RED_LINE = 130
const T_MIN = 20
const T_MAX = 160

export function tracePreview(): HTMLElement {
  const box = el('section', 'panel trace')
  box.append(el('h2', '', t('trace.title')), el('p', 'lead', t('trace.lead')))

  const W = 320
  const H = 180
  const left = 34
  const right = 10
  const top = 10
  const bottom = 26
  const x = (lap: number) => left + ((lap - 1) / (SAMPLE_TEMPS.length - 1)) * (W - left - right)
  const y = (temp: number) => top + (1 - (temp - T_MIN) / (T_MAX - T_MIN)) * (H - top - bottom)

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': t('trace.alt') })
  // Bands behind the line: normal, warm, over the limit.
  chart.append(
    svg('rect', { x: left, y: y(WARM_FROM), width: W - left - right, height: y(T_MIN) - y(WARM_FROM), class: 'band cool' }),
    svg('rect', { x: left, y: y(RED_LINE), width: W - left - right, height: y(WARM_FROM) - y(RED_LINE), class: 'band warm' }),
    svg('rect', { x: left, y: y(T_MAX), width: W - left - right, height: y(RED_LINE) - y(T_MAX), class: 'band hot' }),
  )
  // The red line, labelled in words.
  chart.append(svg('line', { x1: left, x2: W - right, y1: y(RED_LINE), y2: y(RED_LINE), class: 'redline' }))
  const redLabel = svg('text', { x: left + 4, y: y(RED_LINE) - 4, class: 'chart-label hot-text' })
  redLabel.textContent = `${t('trace.redline')} ${RED_LINE} °C`
  chart.append(redLabel)
  // Axis ticks.
  for (let lap = 1; lap <= SAMPLE_TEMPS.length; lap++) {
    const tick = svg('text', { x: x(lap), y: H - 8, class: 'chart-tick', 'text-anchor': 'middle' })
    tick.textContent = String(lap)
    chart.append(tick)
  }
  for (const temp of [40, 90, 130]) {
    const tick = svg('text', { x: left - 4, y: y(temp) + 4, class: 'chart-tick', 'text-anchor': 'end' })
    tick.textContent = String(temp)
    chart.append(tick)
  }
  // The trace itself, with a dot on each lap coloured by its band.
  const points = SAMPLE_TEMPS.map((temp, i) => `${x(i + 1)},${y(temp)}`).join(' ')
  chart.append(svg('polyline', { points, class: 'trace-line' }))
  SAMPLE_TEMPS.forEach((temp, i) => {
    const band = temp >= RED_LINE ? 'hot' : temp >= WARM_FROM ? 'warm' : 'cool'
    chart.append(svg('circle', { cx: x(i + 1), cy: y(temp), r: i === SAMPLE_TEMPS.length - 1 ? 6 : 4, class: `dot ${band}` }))
  })
  box.append(chart)

  const axis = el('p', 'axis', `${t('trace.axisX')} → · ${t('trace.axisY')} ↑`)
  const legend = el('ul', 'legend')
  for (const [cls, key] of [['cool', 'trace.cool'], ['warm', 'trace.warm'], ['hot', 'trace.hot']] as const) {
    legend.append(el('li', `chip ${cls}`, t(key)))
  }
  const verdict = el('p', 'verdict')
  verdict.append(el('span', 'chip hot', t('trace.hot')), ` ${t('trace.verdict')}`)
  box.append(axis, legend, verdict, el('p', 'small', t('trace.sample')))
  return box
}
