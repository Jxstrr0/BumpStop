/**
 * The help (plan PR 11a): a panel near the bottom of the game with two
 * folding sections.
 *
 * - **Damper lessons:** four short lessons, one at a time, each with a
 *   slider and a live chart from a small "quarter car" (`src/sim/lesson.ts`,
 *   one corner of a light 4x4 on its own). The dashed line is always the
 *   damper as the factory set it, so the player sees what their slider did.
 *   Lesson 3 draws the player's own dampers: how hard they damp at every oil
 *   temperature, from the real sim's `dampingMultiplier`.
 * - **Glossary:** every suspension and rally-raid word the game uses, A to Z,
 *   with a search box and a "Show me" jump to the part or slider where there
 *   is one (the same jumps as the report's fixes).
 *
 * `showTerm` and `showLesson` let other screens open the help at a word or a
 * lesson (the tutorial in plan PR 11b uses them).
 */
import type { FixTarget } from '../data/failures'
import { GLOSSARY, type GlossaryId } from '../data/glossary'
import { LESSON_DIALS, LESSON_ROADS, OIL_CHART, QUARTER_CAR, type LessonRoad } from '../data/lessons'
import { t, tf, type StringKey } from '../data/strings'
import { findPart } from '../sim/build'
import { factorySetup, runLesson, type LessonClip, type LessonSetup } from '../sim/lesson'
import { dampingMultiplier } from '../sim/ride'
import type { BuildStore } from './buildStore'
import { BAND_WORD, lineChart, type Band } from './charts'
import { el, num, svg } from './dom'
import { fixJump, jumpTo } from './fixes'

const C0 = 273.15
const G = QUARTER_CAR.gravity

export interface HelpPanel {
  element: HTMLElement
  /** Open the glossary at a word, scroll to it and highlight it. */
  showTerm(id: GlossaryId): void
  /** Open the lessons at lesson n (from 1). */
  showLesson(n: number): void
}

function button(text: string, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, text)
  b.type = 'button'
  return b
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function flash(node: HTMLElement): void {
  node.classList.remove('jumped')
  void node.offsetWidth
  node.classList.add('jumped')
  window.setTimeout(() => node.classList.remove('jumped'), 2400)
}

// ── Lesson pieces ──

/** A slider for a lesson, stepping from `min` to `max` with 0 as the factory setting. */
function dial(id: string, label: StringKey, min: number, max: number, text: (step: number) => string, onInput: (step: number) => void): { row: HTMLElement; value(): number } {
  const row = el('div', 'setting')
  const lab = el('label', 'setting-label', t(label))
  lab.htmlFor = id
  const out = el('output', 'setting-value')
  out.htmlFor.add(id)
  const input = el('input')
  input.type = 'range'
  input.id = id
  input.min = String(min)
  input.max = String(max)
  input.step = '1'
  input.value = '0'
  const show = () => {
    out.textContent = text(Number(input.value))
  }
  input.addEventListener('input', () => {
    show()
    onInput(Number(input.value))
  })
  show()
  row.append(lab, out, input)
  return { row, value: () => Number(input.value) }
}

/** "Softer (−2)", "As the factory set it", "Firmer (+1)". */
function stepText(step: number, noneAtBottom = false, min = 0): string {
  if (noneAtBottom && step === min) return t('lesson.dial.none')
  if (step === 0) return t('lesson.dial.asSet')
  return step < 0 ? tf('lesson.dial.softer', { n: `−${-step}` }) : tf('lesson.dial.firmer', { n: `+${step}` })
}

/** The factor for a dial step from a table that starts at the dial's minimum. */
function factorAt(table: readonly number[], min: number, step: number): number {
  return table[step - min] as number
}

/** How far the body still moves in the last part of a clip (m, top to bottom). */
function bobbing(clip: LessonClip, from = 0.6): number {
  const tail = clip.body.slice(Math.floor(clip.body.length * from))
  return tail.length ? Math.max(...tail) - Math.min(...tail) : 0
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

/** Ticks every half second along a clip. */
function timeTicks(road: LessonRoad): { x: number; label: string }[] {
  const out: { x: number; label: string }[] = []
  // Stop short of the right edge, where the axis says "seconds →".
  for (let s = 0.5; s < road.seconds * 0.72; s += 0.5) out.push({ x: s, label: num(s, s % 1 ? 1 : 0) })
  return out
}

/** The y range every setting of a dial can reach, so the chart's scale holds still as the slider moves. */
function rangeOf(clips: readonly LessonClip[], pick: (c: LessonClip) => readonly number[], scale: number): number[] {
  let lo = Infinity
  let hi = -Infinity
  for (const c of clips) {
    for (const v of pick(c)) {
      lo = Math.min(lo, v * scale)
      hi = Math.max(hi, v * scale)
    }
  }
  return [lo, hi]
}

// ── Lesson 3's chart: damping against oil temperature, with the trace rule's bands standing up ──

function oilChart(damper: Parameters<typeof dampingMultiplier>[1], alt: string): SVGSVGElement {
  const W = 340
  const H = 180
  const left = 42
  const right = 8
  const top = 22
  const bottom = 24
  const redC = damper.redLine - C0
  const warmC = damper.warmFrom - C0
  const xMin = OIL_CHART.fromC
  const xMax = Math.max(OIL_CHART.toC, redC + 70)
  const xs: number[] = []
  const ys: number[] = []
  for (let c = xMin; c <= xMax; c += OIL_CHART.stepC) {
    xs.push(c)
    ys.push(dampingMultiplier(c + C0, damper) * 100)
  }
  const hi = Math.max(...ys) * 1.06
  const plotW = W - left - right
  const plotH = H - top - bottom
  const x = (v: number) => left + ((v - xMin) / (xMax - xMin)) * plotW
  const y = (v: number) => top + (1 - v / hi) * plotH
  const box = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': alt })
  const bands: { from: number; to: number; band: Band }[] = [
    { from: xMin, to: warmC, band: 'cool' },
    { from: warmC, to: redC, band: 'warm' },
    { from: redC, to: xMax, band: 'hot' },
  ]
  for (const b of bands) {
    const x0 = x(b.from)
    const w = x(b.to) - x0
    if (w <= 0) continue
    box.append(svg('rect', { x: x0, y: top, width: w, height: plotH, class: `band ${b.band}` }))
    // Each band says its word; a narrow one splits it over two lines.
    const word = BAND_WORD[b.band]
    const lines = word.length * 6.8 > w - 6 && word.includes(' ') ? [word.slice(0, word.lastIndexOf(' ')), word.slice(word.lastIndexOf(' ') + 1)] : [word]
    lines.forEach((line, k) => {
      const tx = svg('text', { x: x0 + w - 4, y: top - 10 + k * 12 + (lines.length > 1 ? -2 : 4), class: `chart-label band-word ${b.band}-text`, 'text-anchor': 'end' })
      tx.textContent = line
      box.append(tx)
    })
  }
  // Cold oil: a note over the far left, where the line climbs.
  const cold = svg('text', { x: left + 4, y: top + 12, class: 'chart-label' })
  cold.textContent = t('lesson.3.cold')
  box.append(cold)
  box.append(svg('line', { x1: x(redC), x2: x(redC), y1: top, y2: top + plotH, class: 'redline' }))
  // 100%: the damper as set (at 40 °C).
  box.append(svg('line', { x1: left, x2: W - right, y1: y(100), y2: y(100), class: 'seg-line' }))
  for (const v of [0, 100, Math.floor(hi / 100) * 100].filter((v, i, a) => a.indexOf(v) === i && v < hi)) {
    const tick = svg('text', { x: left - 4, y: y(v) + 4, class: 'chart-tick', 'text-anchor': 'end' })
    tick.textContent = `${v}%`
    box.append(tick)
  }
  for (const c of [0, 40, 100, Math.round(redC)]) {
    if (c < xMin || c > xMax) continue
    box.append(svg('line', { x1: x(c), x2: x(c), y1: top + plotH, y2: top + plotH + 4, class: 'seg-line' }))
    const label = svg('text', { x: x(c), y: H - 8, class: 'chart-tick', 'text-anchor': 'middle' })
    label.textContent = `${c}`
    box.append(label)
  }
  const unit = svg('text', { x: W - right, y: H - 8, class: 'chart-tick', 'text-anchor': 'end' })
  unit.textContent = '°C'
  box.append(unit)
  box.append(svg('polyline', { points: xs.map((v, i) => `${x(v).toFixed(1)},${y(ys[i] as number).toFixed(1)}`).join(' '), class: 'trace-line' }))
  return box
}

// ── The panel ──

export function helpPanel(store: BuildStore): HelpPanel {
  const box = el('section', 'panel help')
  box.id = 'help'
  box.append(el('h2', '', t('help.title')), el('p', 'lead', t('help.lead')))

  const lessonsBox = el('details', 'help-section')
  lessonsBox.append(el('summary', '', t('help.lessons')))
  const glossaryBox = el('details', 'help-section')
  glossaryBox.append(el('summary', '', t('help.glossary')))
  box.append(lessonsBox, glossaryBox)

  // ── Lessons ──

  const factory = factorySetup()
  const LESSONS = [lessonOne, lessonTwo, lessonThree, lessonFour]
  let current = 0
  /** Redraws the lesson on screen when the truck changes: lesson 3's chart, and every lesson's "Try it" buttons. */
  let onTruck: (() => void)[] = []

  const lessonHead = el('p', 'label')
  const lessonBody = el('div', 'lesson')
  const nav = el('div', 'btn-row lesson-nav')
  const back = button(t('help.back'))
  const next = button(t('help.next'))
  back.addEventListener('click', () => showLessonAt(current - 1, true))
  next.addEventListener('click', () => showLessonAt(current + 1, true))
  nav.append(back, next)
  lessonsBox.append(lessonHead, lessonBody, nav, el('p', 'small', t('help.toyNote')))

  function showLessonAt(k: number, focus: boolean): void {
    current = Math.max(0, Math.min(LESSONS.length - 1, k))
    lessonHead.textContent = tf('help.lessonOf', { n: String(current + 1), total: String(LESSONS.length) })
    onTruck = []
    lessonBody.replaceChildren(...LESSONS[current]!())
    back.disabled = current === 0
    next.disabled = current === LESSONS.length - 1
    if (focus) {
      const h = lessonBody.querySelector<HTMLElement>('h3')
      h?.focus({ preventScroll: true })
      lessonsBox.scrollIntoView({ behavior: smooth(), block: 'start' })
    }
  }

  function heading(key: StringKey): HTMLElement {
    const h = el('h3', 'lesson-title', `${current + 1}. ${t(key)}`)
    h.tabIndex = -1
    return h
  }

  /** The "Try it on your truck" buttons: jumps to the build screen, like the report's fixes. */
  function tryIt(targets: readonly FixTarget[]): HTMLElement {
    const wrap = el('div', 'lesson-try')
    const row = el('div', 'btn-row')
    wrap.append(el('p', 'small', t('help.tryIt')), row)
    // Which slider a fix goes to depends on the dampers' adjusters, so the buttons follow the truck.
    const draw = () => {
      row.replaceChildren()
      const seen = new Set<string>()
      for (const target of targets) {
        const jump = fixJump(target, 'front', store.build())
        if (!jump) continue
        const label = jump.kind === 'slot' ? t(`slot.${jump.slot}` as StringKey) : t(`build.${jump.key}` as StringKey)
        if (seen.has(label)) continue
        seen.add(label)
        const b = button(label, 'btn small-btn')
        b.addEventListener('click', () => jumpTo(jump))
        row.append(b)
      }
    }
    draw()
    onTruck.push(draw)
    return wrap
  }

  /** A chart of one clip, with the factory clip as the ghost. */
  function clipChart(road: LessonRoad, clip: LessonClip, ghost: LessonClip, pick: (c: LessonClip) => readonly number[], opts: { scale: number; warm: number | null; limit: number | null; include: number[]; alt: string; digits?: number }) {
    const series = { x: clip.t, y: pick(clip).map((v) => v * opts.scale) }
    const g = { x: ghost.t, y: pick(ghost).map((v) => v * opts.scale) }
    return lineChart({
      series,
      ghost: g,
      warm: opts.warm,
      limit: opts.limit,
      xMin: 0,
      xMax: road.seconds,
      xTicks: timeTicks(road),
      xLabel: t('help.time'),
      yInclude: opts.include,
      digits: opts.digits ?? 0,
      alt: opts.alt,
    }).svg
  }

  function lessonOne(): HTMLElement[] {
    const road = LESSON_ROADS.oneBump
    const d = LESSON_DIALS.damping
    const setup = (step: number): LessonSetup => {
      const k = factorAt(d.factors, d.min, step)
      return { ...factory, compression: factory.compression * k, rebound: factory.rebound * k }
    }
    const all: LessonClip[] = []
    for (let s = d.min; s <= d.max; s++) all.push(runLesson(road, setup(s)))
    const ghost = all[-d.min]!
    const include = rangeOf(all, (c) => c.body, 100)
    const chartHolder = el('div', 'sim-chart')
    const settle = el('p', 'readout-line')
    const read = el('p', 'readout-line')
    read.setAttribute('aria-live', 'polite')
    const draw = (step: number) => {
      const clip = all[step - d.min]!
      chartHolder.replaceChildren(clipChart(road, clip, ghost, (c) => c.body, {
        scale: 100, warm: null, limit: null, include, digits: 0, alt: tf('lesson.1.alt', { setting: stepText(step, true, d.min).toLowerCase() }),
      }))
      const ring = bobbing(clip) * 100
      settle.textContent = ring >= 0.5 ? tf('lesson.1.ring', { cm: num(ring, 1) }) : t('lesson.1.settled')
      read.textContent = tf('lesson.1.readout', { air: num(clip.airShare * 100), g: num(clip.peakJolt / G, 1), kj: num(clip.heat / 1000, 1) })
    }
    const control = dial('lesson-damping', 'lesson.1.dial', d.min, d.max, (s) => stepText(s, true, d.min), draw)
    draw(control.value())
    return [heading('lesson.1.title'), el('p', '', t('lesson.1.a')), el('p', '', t('lesson.1.b')), control.row,
      el('h4', 'sim-chart-title', t('lesson.1.chart')), chartHolder, el('p', 'small', t('help.asSet')), settle, read, tryIt(['damperSize', 'rebound'])]
  }

  function lessonTwo(): HTMLElement[] {
    const road = LESSON_ROADS.washboard
    const d = LESSON_DIALS.rebound
    const setup = (step: number): LessonSetup => ({ ...factory, rebound: factory.rebound * factorAt(d.factors, d.min, step) })
    const all: LessonClip[] = []
    for (let s = d.min; s <= d.max; s++) all.push(runLesson(road, setup(s)))
    const ghost = all[-d.min]!
    const include = rangeOf(all, (c) => c.travel, 100)
    const warm = (1 - QUARTER_CAR.bumpStopLength / QUARTER_CAR.bumpTravel) * 100
    const chartHolder = el('div', 'sim-chart')
    const read = el('p', 'readout-line')
    read.setAttribute('aria-live', 'polite')
    const draw = (step: number) => {
      const clip = all[step - d.min]!
      chartHolder.replaceChildren(clipChart(road, clip, ghost, (c) => c.travel, {
        scale: 100, warm, limit: 100, include, alt: tf('lesson.2.alt', { setting: stepText(step).toLowerCase() }),
      }))
      // The second half of the clip, once the wheel has found where it sits.
      const avg = average(clip.travel.slice(Math.floor(clip.travel.length / 2)))
      read.textContent = tf('lesson.2.readout', { avg: num(avg * 100), peak: num(clip.peakTravel * 100), cm: num(bobbing(clip, 0.4) * 100, 1) })
    }
    const control = dial('lesson-rebound', 'lesson.2.dial', d.min, d.max, (s) => stepText(s), draw)
    draw(control.value())
    return [heading('lesson.2.title'), el('p', '', t('lesson.2.a')), el('p', '', t('lesson.2.b')), control.row,
      el('h4', 'sim-chart-title', t('lesson.2.chart')), chartHolder, el('p', 'small', t('help.asSet')), read, tryIt(['rebound', 'compression'])]
  }

  function lessonThree(): HTMLElement[] {
    const chartHolder = el('div', 'sim-chart')
    const read = el('p', 'readout-line')
    const draw = () => {
      const b = store.build()
      const damper = store.truck().ride.front.damper
      const part = findPart(b.parts.dampers)
      const name = part ? t(part.name).toLowerCase() : t('slot.dampers').toLowerCase()
      chartHolder.replaceChildren(oilChart(damper, tf('lesson.3.alt', { part: name, from: String(OIL_CHART.fromC), to: String(OIL_CHART.toC) })))
      read.textContent = tf('lesson.3.readout', {
        part: name,
        cold: num(dampingMultiplier(C0 - 30, damper) * 100),
        hot: num(dampingMultiplier(damper.redLine, damper) * 100),
        red: num(damper.redLine - C0),
      })
    }
    draw()
    onTruck.push(draw)
    return [heading('lesson.3.title'), el('p', '', t('lesson.3.a')), el('p', '', t('lesson.3.b')),
      el('h4', 'sim-chart-title', t('lesson.3.chart')), chartHolder, read, el('p', '', t('lesson.3.c')), tryIt(['damperSize', 'compression'])]
  }

  function lessonFour(): HTMLElement[] {
    const road = LESSON_ROADS.bigHit
    const sp = LESSON_DIALS.spring
    const bs = LESSON_DIALS.bumpStop
    let springStep = 0
    let stopStep = 0
    const setup = (): LessonSetup => ({
      ...factory,
      springRate: factory.springRate * factorAt(sp.factors, sp.min, springStep),
      bumpStopLength: factorAt(bs.lengths, bs.min, stopStep),
    })
    const ghost = runLesson(road, factory)
    // Every corner of the two sliders, for a scale that holds still.
    const corners = [sp.min, sp.max].flatMap((s) => [bs.min, bs.max].map((b) => runLesson(road, {
      ...factory, springRate: factory.springRate * factorAt(sp.factors, sp.min, s), bumpStopLength: factorAt(bs.lengths, bs.min, b),
    })))
    const include = rangeOf([...corners, ghost], (c) => c.travel, 100)
    const chartHolder = el('div', 'sim-chart')
    const read = el('p', 'readout-line')
    read.setAttribute('aria-live', 'polite')
    const draw = () => {
      const s = setup()
      const clip = runLesson(road, s)
      const warm = (1 - s.bumpStopLength / QUARTER_CAR.bumpTravel) * 100
      chartHolder.replaceChildren(clipChart(road, clip, ghost, (c) => c.travel, {
        scale: 100, warm, limit: 100, include, alt: tf('lesson.4.alt', { peak: num(clip.peakTravel * 100) }),
      }))
      const g = num(clip.peakJolt / G, 1)
      read.textContent = clip.bottomOuts > 0
        ? tf('lesson.4.bottomed', { g })
        : tf('lesson.4.spare', { peak: num(clip.peakTravel * 100), cm: num((1 - clip.peakTravel) * QUARTER_CAR.bumpTravel * 100, 1), g })
    }
    const spring = dial('lesson-spring', 'lesson.4.spring', sp.min, sp.max, (s) => stepText(s), (s) => {
      springStep = s
      draw()
    })
    const stop = dial('lesson-stop', 'lesson.4.stop', bs.min, bs.max,
      (s) => tf('lesson.4.stopMm', { mm: num(factorAt(bs.lengths, bs.min, s) * 1000) }), (s) => {
        stopStep = s
        draw()
      })
    draw()
    return [heading('lesson.4.title'), el('p', '', t('lesson.4.a')), el('p', '', t('lesson.4.b')), spring.row, stop.row,
      el('h4', 'sim-chart-title', t('lesson.4.chart')), chartHolder, el('p', 'small', t('help.asSet')), read, tryIt(['springRate', 'bumpStops'])]
  }

  // Draw the first lesson when the section first opens (the charts are cheap, but no need before then).
  let lessonsDrawn = false
  lessonsBox.addEventListener('toggle', () => {
    if (lessonsBox.open && !lessonsDrawn) {
      lessonsDrawn = true
      showLessonAt(current, false)
    }
  })
  store.onChange(() => {
    for (const fn of onTruck) fn()
  })

  // ── Glossary ──

  const searchId = 'glossary-search'
  const searchLabel = el('label', 'setting-label', t('help.search'))
  searchLabel.htmlFor = searchId
  const search = el('input', 'glossary-search')
  search.type = 'search'
  search.id = searchId
  search.autocomplete = 'off'
  const count = el('p', 'small')
  count.setAttribute('aria-live', 'polite')
  const list = el('dl', 'glossary')
  const none = el('p', 'small', t('help.noMatch'))
  none.hidden = true

  const entries = GLOSSARY.map((g) => ({
    id: g.id as GlossaryId,
    see: 'see' in g ? g.see : undefined,
    term: t(`glossary.${g.id}` as StringKey),
    text: t(`glossary.${g.id}Text` as StringKey),
  })).sort((a, b) => a.term.localeCompare(b.term, 'en-CA'))

  const rows = entries.map((e) => {
    const dt = el('dt', '', e.term)
    dt.id = `term-${e.id}`
    dt.tabIndex = -1
    const dd = el('dd')
    dd.append(el('span', '', e.text))
    if (e.see) {
      const target = e.see
      const b = button(t('help.showMe'), 'btn small-btn see-btn')
      b.setAttribute('aria-label', `${t('help.showMe')}: ${e.term}`)
      b.addEventListener('click', () => {
        const jump = fixJump(target, 'front', store.build())
        if (jump) jumpTo(jump)
      })
      dd.append(' ', b)
    }
    list.append(dt, dd)
    return { e, dt, dd, haystack: `${e.term} ${e.text}`.toLowerCase() }
  })

  function filter(): void {
    const q = search.value.trim().toLowerCase()
    let shown = 0
    for (const r of rows) {
      const hit = !q || r.haystack.includes(q)
      r.dt.hidden = !hit
      r.dd.hidden = !hit
      if (hit) shown++
    }
    none.hidden = shown > 0
    count.textContent = tf('help.count', { n: String(shown) })
  }
  search.addEventListener('input', filter)
  filter()
  glossaryBox.append(searchLabel, search, count, list, none)

  return {
    element: box,
    showTerm(id) {
      const row = rows.find((r) => r.e.id === id)
      if (!row) return
      glossaryBox.open = true
      if (search.value) {
        search.value = ''
        filter()
      }
      row.dt.scrollIntoView({ behavior: smooth(), block: 'center' })
      row.dt.focus({ preventScroll: true })
      flash(row.dd)
    },
    showLesson(n) {
      lessonsBox.open = true
      lessonsDrawn = true
      showLessonAt(n - 1, true)
    },
  }
}
