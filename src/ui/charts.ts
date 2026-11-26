/**
 * The rigs' charts (plan PR 4), drawn as plain SVG so they stay sharp on a
 * phone. Three kinds:
 *
 * - `lineChart`: a trace over time or distance, with the trace rule's bands
 *   behind it (Normal, Warm, Over the limit, each with its word), the limit
 *   as a red dashed line, and the last run as a ghost line.
 * - The report's break trace is a `lineChart` that can be revealed bit by
 *   bit, so it plays back in slow motion (`reveal`).
 * - `shakerChart`: how much the body and the wheels move at each beat.
 *
 * Colour never carries meaning alone: bands have words, lines have a legend.
 */
import { t } from '../data/strings'
import { num, svg } from './dom'

export type Band = 'cool' | 'warm' | 'hot'

/** Which band a value is in, by the trace rule. */
export function bandOf(v: number, warm: number | null, limit: number | null): Band {
  if (limit !== null && v >= limit) return 'hot'
  if (warm !== null && v >= warm) return 'warm'
  return 'cool'
}

export const BAND_WORD: Record<Band, string> = {
  cool: t('trace.cool'),
  warm: t('trace.warm'),
  hot: t('trace.hot'),
}

export interface Series {
  x: readonly number[]
  y: readonly number[]
}

export interface LineSpec {
  series: Series
  /** The last run, drawn faint and dashed underneath. */
  ghost?: Series | null
  /** Where the trace turns amber, and the limit (red dashed line), in the chart's units. Null for none. */
  warm: number | null
  limit: number | null
  /** The x range; defaults to the series' own. */
  xMin?: number
  xMax?: number
  /** Ticks under the chart: where, and their words. */
  xTicks?: readonly { x: number; label: string }[]
  /** Words at the bottom right, e.g. "last 3 s →". */
  xLabel: string
  /** Digits on the y ticks. */
  digits?: number
  /** The y range always includes these. */
  yInclude?: readonly number[]
  /** Read out by screen readers. */
  alt: string
  /** Taller for the report's big trace. */
  height?: number
}

export interface LineChart {
  svg: SVGSVGElement
  /** Show the trace up to this x only, with a dot at the end (for slow motion). Returns the value there and its band. */
  reveal(upTo: number): { x: number; value: number; band: Band }
}

const W = 340

/** Shorten a list of points to about `max`, keeping each stretch's highest and lowest so spikes survive. */
function thin(xs: readonly number[], ys: readonly number[], max: number): [number[], number[]] {
  if (xs.length <= max) return [xs.slice(), ys.slice()]
  const per = Math.ceil(xs.length / (max / 2))
  const ox: number[] = []
  const oy: number[] = []
  for (let i = 0; i < xs.length; i += per) {
    let lo = i
    let hi = i
    for (let k = i; k < Math.min(xs.length, i + per); k++) {
      if ((ys[k] as number) < (ys[lo] as number)) lo = k
      if ((ys[k] as number) > (ys[hi] as number)) hi = k
    }
    for (const k of lo < hi ? [lo, hi] : [hi, lo]) {
      ox.push(xs[k] as number)
      oy.push(ys[k] as number)
    }
  }
  return [ox, oy]
}

export function lineChart(spec: LineSpec): LineChart {
  const H = spec.height ?? 170
  const left = 42
  const right = 8
  const top = 8
  const bottom = 24
  const { series } = spec
  const xs = series.x
  const ys = series.y
  const xMin = spec.xMin ?? (xs[0] ?? 0)
  const xMax = spec.xMax ?? (xs[xs.length - 1] ?? 1)
  const all = [...ys, ...(spec.ghost?.y ?? []), ...(spec.yInclude ?? [])]
  if (spec.limit !== null) all.push(spec.limit)
  let lo = all.length ? Math.min(...all) : 0
  let hi = all.length ? Math.max(...all) : 1
  const pad = (hi - lo) * 0.08 || 1
  lo -= pad
  hi += pad
  const plotW = W - left - right
  const plotH = H - top - bottom
  const x = (v: number) => left + ((v - xMin) / (xMax - xMin || 1)) * plotW
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * plotH
  const clampY = (v: number) => Math.min(top + plotH, Math.max(top, y(v)))

  const box = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': spec.alt })

  // The bands: Normal below warm, Warm up to the limit, Over the limit above it. Each says its word.
  const edges: { from: number; to: number; band: Band }[] = []
  const limitY = spec.limit !== null ? clampY(spec.limit) : top
  const warmY = spec.warm !== null ? clampY(spec.warm) : limitY
  edges.push({ from: warmY, to: top + plotH, band: 'cool' })
  if (spec.warm !== null) edges.push({ from: limitY, to: warmY, band: 'warm' })
  if (spec.limit !== null) edges.push({ from: top, to: limitY, band: 'hot' })
  for (const e of edges) {
    const h = e.to - e.from
    if (h <= 0) continue
    box.append(svg('rect', { x: left, y: e.from, width: plotW, height: h, class: `band ${e.band}` }))
    if (h >= 14 && (spec.warm !== null || spec.limit !== null)) {
      const word = svg('text', { x: W - right - 4, y: e.from + 12, class: `chart-label band-word ${e.band}-text`, 'text-anchor': 'end' })
      word.textContent = BAND_WORD[e.band]
      box.append(word)
    }
  }
  if (spec.limit !== null && spec.limit <= hi) {
    box.append(svg('line', { x1: left, x2: W - right, y1: y(spec.limit), y2: y(spec.limit), class: 'redline' }))
  }

  // Y ticks: bottom and top of the data, and the limit.
  const ticks = new Set<number>([lo + pad, hi - pad])
  // A narrow range needs a decimal, or both ticks read the same.
  const tickDigits = (spec.digits ?? 0) + (hi - lo < 5 ? 1 : 0)
  for (const v of ticks) {
    const tick = svg('text', { x: left - 4, y: y(v) + 4, class: 'chart-tick', 'text-anchor': 'end' })
    tick.textContent = num(v, tickDigits)
    box.append(tick)
  }
  for (const tk of spec.xTicks ?? []) {
    if (tk.x < xMin || tk.x > xMax) continue
    box.append(svg('line', { x1: x(tk.x), x2: x(tk.x), y1: top, y2: top + plotH, class: 'seg-line' }))
    const label = svg('text', { x: x(tk.x) + 2, y: H - 8, class: 'chart-tick' })
    label.textContent = tk.label
    box.append(label)
  }
  const xl = svg('text', { x: W - right, y: H - 8, class: 'chart-tick', 'text-anchor': 'end' })
  xl.textContent = spec.xLabel
  box.append(xl)

  const toPoints = (px: readonly number[], py: readonly number[]) => {
    const [tx, ty] = thin(px, py, 600)
    return tx.map((v, i) => `${x(v).toFixed(1)},${y(ty[i] as number).toFixed(1)}`).join(' ')
  }
  if (spec.ghost && spec.ghost.x.length > 1) {
    box.append(svg('polyline', { points: toPoints(spec.ghost.x, spec.ghost.y), class: 'ghost-line' }))
  }
  const line = svg('polyline', { points: toPoints(xs, ys), class: 'trace-line' })
  box.append(line)
  const dot = svg('circle', { cx: 0, cy: 0, r: 6, class: 'dot cool' })
  if (xs.length) {
    const lastX = xs[xs.length - 1] as number
    const lastY = ys[ys.length - 1] as number
    dot.setAttribute('cx', x(lastX).toFixed(1))
    dot.setAttribute('cy', clampY(lastY).toFixed(1))
    dot.setAttribute('class', `dot ${bandOf(lastY, spec.warm, spec.limit)}`)
    box.append(dot)
  }

  return {
    svg: box,
    reveal(upTo: number) {
      let n = 0
      while (n < xs.length && (xs[n] as number) <= upTo) n++
      n = Math.max(1, n)
      line.setAttribute('points', toPoints(xs.slice(0, n), ys.slice(0, n)))
      const v = ys[n - 1] as number
      const band = bandOf(v, spec.warm, spec.limit)
      dot.setAttribute('cx', x(xs[n - 1] as number).toFixed(1))
      dot.setAttribute('cy', clampY(v).toFixed(1))
      dot.setAttribute('class', `dot ${band}`)
      return { x: xs[n - 1] as number, value: v, band }
    },
  }
}

export interface ShakerSeries {
  freq: readonly number[]
  body: readonly number[]
  wheel: readonly number[]
}

/** How much the body and the wheels move at each beat (log scale across), with the last sweep as a ghost. */
export function shakerChart(now: ShakerSeries, ghost: ShakerSeries | null, minFreq: number, maxFreq: number, alt: string): SVGSVGElement {
  const H = 190
  const left = 34
  const right = 8
  const top = 22
  const bottom = 24
  const plotW = W - left - right
  const plotH = H - top - bottom
  const lg = (f: number) => Math.log(f)
  const x = (f: number) => left + ((lg(f) - lg(minFreq)) / (lg(maxFreq) - lg(minFreq))) * plotW
  const peak = Math.max(2.5, ...now.body, ...now.wheel, ...(ghost?.body ?? []), ...(ghost?.wheel ?? []))
  const y = (g: number) => top + (1 - g / (peak * 1.05)) * plotH

  const box = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': alt })
  box.append(svg('rect', { x: left, y: top, width: plotW, height: plotH, class: 'band plain' }))
  // The posts' own movement, for scale.
  box.append(svg('line', { x1: left, x2: W - right, y1: y(1), y2: y(1), class: 'seg-line posts-line' }))
  // Under the line at the left, where the body line is above it and nothing else is.
  const postsLabel = svg('text', { x: left + 4, y: y(1) + 13, class: 'chart-tick' })
  postsLabel.textContent = t('shaker.postsLine')
  box.append(postsLabel)
  for (const g of [0, 1, 2]) {
    if (g > peak * 1.05) continue
    const tick = svg('text', { x: left - 4, y: y(g) + 4, class: 'chart-tick', 'text-anchor': 'end' })
    tick.textContent = `×${g}`
    box.append(tick)
  }
  for (const f of [1, 2, 5, 10]) {
    // Hz along the bottom.
    if (f < minFreq || f > maxFreq) continue
    box.append(svg('line', { x1: x(f), x2: x(f), y1: top, y2: top + plotH, class: 'seg-line' }))
    const label = svg('text', { x: x(f), y: H - 8, class: 'chart-tick', 'text-anchor': 'middle' })
    label.textContent = `${f}`
    box.append(label)
  }

  const pts = (fs: readonly number[], gs: readonly number[]) => fs.map((f, i) => `${x(f).toFixed(1)},${y(gs[i] as number).toFixed(1)}`).join(' ')
  if (ghost && ghost.freq.length > 1) {
    box.append(svg('polyline', { points: pts(ghost.freq, ghost.body), class: 'ghost-line' }))
    box.append(svg('polyline', { points: pts(ghost.freq, ghost.wheel), class: 'ghost-line dotted' }))
  }
  if (now.freq.length > 1) {
    box.append(svg('polyline', { points: pts(now.freq, now.body), class: 'trace-line' }))
    box.append(svg('polyline', { points: pts(now.freq, now.wheel), class: 'trace-line wheel-line' }))
  }

  // Legend across the top: a line sample and a word for each, never colour alone.
  const legend: [string, string][] = [
    ['trace-line', t('shaker.body')],
    ['trace-line wheel-line', t('shaker.wheels')],
  ]
  if (ghost) legend.push(['ghost-line', t('ghost.legend')])
  let lx = left
  for (const [cls, word] of legend) {
    box.append(svg('line', { x1: lx, x2: lx + 18, y1: 10, y2: 10, class: cls }))
    const text = svg('text', { x: lx + 22, y: 14, class: 'chart-label' })
    text.textContent = word
    box.append(text)
    lx += 30 + word.length * 7
  }
  return box
}

/** A legend line for a line chart with a ghost: "— This run  - - Last run". */
export function ghostLegend(hasGhost: boolean): SVGSVGElement | null {
  if (!hasGhost) return null
  const box = svg('svg', { viewBox: `0 0 ${W} 16`, class: 'chart-legend', 'aria-hidden': 'true' })
  box.append(svg('line', { x1: 42, x2: 60, y1: 8, y2: 8, class: 'trace-line' }))
  const a = svg('text', { x: 64, y: 12, class: 'chart-label' })
  a.textContent = t('ghost.thisRun')
  box.append(a)
  box.append(svg('line', { x1: 150, x2: 168, y1: 8, y2: 8, class: 'ghost-line' }))
  const b = svg('text', { x: 172, y: 12, class: 'chart-label' })
  b.textContent = t('ghost.legend')
  box.append(b)
  return box
}
