/**
 * The build screen (plan PR 3): pick the class, a part for every slot, and
 * tune each axle, with the weight and the money always in sight at the top.
 *
 * Every part and setting change goes through the build store, so the ride
 * sim and break test below drive the truck on the bench. The numbers come
 * from `src/sim/build.ts`; this file only shows them.
 */
import { CLASSES } from '../data/classes'
import { KITS, TUNE, type AxleSettings } from '../data/kit'
import { SLOTS, type Part, type SlotId } from '../data/parts'
import { t, tf, type StringKey } from '../data/strings'
import { checkBuild, minPressure, partIn, partsFor, shopRules, type BuildProblem, type CornerGeometry } from '../sim/build'
import { FIRST_YEAR, LAST_YEAR, type BuildStore } from './buildStore'
import { el, num } from './dom'
import { truckView } from './truckView'

type End = 'front' | 'rear'

/** One slider: its setting, label, range in screen units, and how to show its value. */
interface Slider {
  key: keyof AxleSettings
  label: StringKey
  min: number
  max: number
  step: number
  /** SI (or clicks) to screen units. */
  show: (v: number) => number
  /** Screen units back to SI. */
  store: (v: number) => number
  /** The value as words, e.g. "32 N/mm" or "+2 firmer". */
  text: (v: number, corner: CornerGeometry) => string
}

const toMm = (m: number) => m * 1000
const fromMm = (v: number) => v / 1000
const same = (v: number) => v

function clicksText(v: number): string {
  if (v === 0) return t('build.middle')
  return v > 0 ? tf('build.firmer', { n: `+${v}` }) : tf('build.softer', { n: `−${-v}` })
}

/** The sliders this build has for one axle: damper adjusters and bar positions only where the parts have them. */
function slidersFor(store: BuildStore): Slider[] {
  const b = store.build()
  const r = KITS[b.cls].ranges
  const clicks = partIn(b, 'dampers').clicks
  const out: Slider[] = [
    { key: 'springRate', label: 'build.springRate', min: r.springRate.min / 1000, max: r.springRate.max / 1000, step: r.springRate.step / 1000,
      show: (v) => v / 1000, store: (v) => v * 1000, text: (v) => `${num(v / 1000, r.springRate.step < 1000 ? 1 : 0)} ${t('unit.nmm')}` },
    { key: 'preload', label: 'build.preload', min: toMm(r.preload.min), max: toMm(r.preload.max), step: toMm(r.preload.step),
      show: toMm, store: fromMm, text: (v) => `${num(toMm(v))} ${t('unit.mm')}` },
    { key: 'bumpStop', label: 'build.bumpStop', min: toMm(r.bumpStop.min), max: toMm(r.bumpStop.max), step: toMm(r.bumpStop.step),
      show: toMm, store: fromMm, text: (v) => `${num(toMm(v))} ${t('unit.mm')}` },
    { key: 'droopLimit', label: 'build.droopLimit', min: toMm(r.droopLimit.min), max: toMm(r.droopLimit.max), step: toMm(r.droopLimit.step),
      show: toMm, store: fromMm,
      text: (v, c) => (v >= c.sag ? tf('build.slack', { mm: num(toMm(v)) }) : `${num(toMm(v))} ${t('unit.mm')}`) },
    { key: 'tirePressure', label: 'build.tirePressure', min: minPressure(b) / 1000, max: r.tirePressure.max / 1000, step: r.tirePressure.step / 1000,
      show: (v) => v / 1000, store: (v) => v * 1000, text: (v) => `${num(v / 1000)} ${t('unit.kpa')}` },
  ]
  for (const key of ['compLow', 'compHigh', 'rebound'] as const) {
    const n = clicks[key]
    if (n > 0) out.push({ key, label: `build.${key}`, min: -n, max: n, step: 1, show: same, store: same, text: clicksText })
  }
  if (partIn(b, 'antiRoll').adjustable) {
    const n = TUNE.antiRollPositions
    out.push({ key: 'antiRoll', label: 'build.antiRoll', min: -n, max: n, step: 1, show: same, store: same, text: clicksText })
  }
  return out
}

function problemText(p: BuildProblem, store: BuildStore): string {
  switch (p.kind) {
    case 'tooHeavy':
      return tf('build.tooHeavyText', { by: num(p.by), limit: num(p.limit) })
    case 'tooLight':
      return tf('build.tooLightText', { by: num(p.by), limit: num(p.limit) })
    case 'overBudget':
      return tf('build.overBudgetText', { by: num(p.by), budget: num(p.budget) })
    case 'notYet': {
      const part = partIn(store.build(), p.slot)
      return tf('build.notYetText', { part: t(part.name), year: String(p.year) })
    }
  }
}

/** "+12 kg · −3,500 antlers" against the part fitted now. */
function deltaText(part: Part, current: Part, store: BuildStore): string {
  const cls = store.cls()
  const sign = (v: number) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(-v)}` : '±0')
  const dm = (part.mass[cls] as number) - (current.mass[cls] as number)
  const dc = (part.cost[cls] as number) - (current.cost[cls] as number)
  return tf('build.delta', { mass: sign(dm), cost: sign(dc) })
}

export function buildPanel(store: BuildStore): HTMLElement {
  const box = el('section', 'panel build')
  box.append(el('h2', '', t('build.title')), el('p', 'lead', t('build.lead')))

  // Class buttons.
  const classRow = el('div', 'btn-row')
  const classButtons = CLASSES.map((c) => {
    const b = el('button', 'btn', t(c.name))
    b.type = 'button'
    b.addEventListener('click', () => store.setClass(c.id))
    classRow.append(b)
    return { id: c.id, b }
  })
  const blurb = el('p', 'small class-blurb')

  // The year.
  const yearRow = el('div', 'year-row')
  const yearLabel = el('label', 'setting-label', t('build.year'))
  const yearInput = el('input')
  yearInput.type = 'range'
  yearInput.id = 'build-year'
  yearLabel.htmlFor = yearInput.id
  yearInput.min = String(FIRST_YEAR)
  yearInput.max = String(LAST_YEAR)
  yearInput.step = '1'
  const yearOut = el('output', 'setting-value')
  yearOut.htmlFor.add(yearInput.id)
  yearInput.addEventListener('input', () => {
    yearOut.textContent = yearInput.value
  })
  yearInput.addEventListener('change', () => store.setYear(Number(yearInput.value)))
  yearRow.append(yearLabel, yearOut, yearInput)

  // The summary bar: weight and money, always in sight.
  const summary = el('div', 'build-summary')
  summary.setAttribute('aria-live', 'polite')
  const weightLine = el('p', 'sum-line')
  const weightBar = el('div', 'sum-bar')
  const weightWindow = el('div', 'sum-window')
  const weightMark = el('div', 'sum-mark')
  weightBar.append(weightWindow, weightMark)
  const moneyLine = el('p', 'sum-line')
  const moneyBar = el('div', 'sum-bar')
  const moneyFill = el('div', 'sum-fill')
  moneyBar.append(moneyFill)
  const problems = el('ul', 'problems')
  summary.append(weightLine, weightBar, moneyLine, moneyBar, problems)

  const partsHolder = el('div', 'slots')
  const tuneHolder = el('div', 'tune')
  const reset = el('button', 'btn', t('build.reset'))
  reset.type = 'button'
  reset.addEventListener('click', () => store.resetClass())

  // Pieces that refresh() updates without rebuilding, so a slider being dragged keeps its place.
  let outputs: { end: End; slider: Slider; out: HTMLOutputElement }[] = []
  let geometry: { end: End; p: HTMLElement }[] = []

  function refresh(): void {
    const b = store.build()
    const truck = store.truck()
    const cls = CLASSES.find((c) => c.id === b.cls)!
    const found = checkBuild(b, shopRules(b.cls, store.year()))

    // Weight: the window shaded on a bar from 10% under to 10% over, with a mark for the truck.
    const lo = cls.minMass * 0.9
    const hi = cls.maxMass * 1.1
    const pct = (m: number) => Math.min(100, Math.max(0, ((m - lo) / (hi - lo)) * 100))
    weightWindow.style.left = `${pct(cls.minMass)}%`
    weightWindow.style.width = `${pct(cls.maxMass) - pct(cls.minMass)}%`
    weightMark.style.left = `${pct(truck.mass)}%`
    const heavy = found.some((p) => p.kind === 'tooHeavy')
    const light = found.some((p) => p.kind === 'tooLight')
    const wBand = heavy || light ? 'hot' : 'cool'
    weightMark.className = `sum-mark ${wBand}`
    weightLine.replaceChildren(
      el('span', 'label', t('build.weight')),
      ` ${num(truck.mass)} kg `,
      el('span', 'small', tf('build.window', { min: num(cls.minMass), max: num(cls.maxMass) })),
      ' ',
      el('span', `chip ${wBand}`, t(heavy ? 'build.tooHeavy' : light ? 'build.tooLight' : 'build.inWindow')),
    )

    const budget = shopRules(b.cls, store.year()).budget
    const over = truck.cost > budget
    moneyFill.style.width = `${Math.min(100, (truck.cost / budget) * 100)}%`
    moneyFill.className = `sum-fill ${over ? 'hot' : 'cool'}`
    moneyLine.replaceChildren(
      el('span', 'label', t('build.budget')),
      ` ${tf('build.of', { n: num(truck.cost), total: num(budget) })} `,
      el('span', `chip ${over ? 'hot' : 'cool'}`, t(over ? 'build.overBudget' : 'build.inBudget')),
    )

    problems.replaceChildren()
    for (const p of found) problems.append(el('li', '', problemText(p, store)))
    if (found.length === 0) problems.append(el('li', 'ok', t('build.ready')))

    for (const { end, slider, out } of outputs) out.textContent = slider.text(b[end][slider.key], truck[end])
    for (const { end, p } of geometry) {
      const c = truck[end]
      p.textContent = tf('build.geometry', {
        sag: num(toMm(c.sag)),
        travel: num(toMm(c.travel)),
        bump: num(toMm(c.bumpTravel)),
        droop: num(toMm(c.droopTravel)),
      })
    }
  }

  function slotBlock(slot: SlotId, open: boolean): HTMLElement {
    const b = store.build()
    const current = partIn(b, slot)
    const details = el('details', 'slot')
    details.dataset.slot = slot
    details.open = open
    const head = el('summary')
    head.append(
      el('span', 'slot-name', t(`slot.${slot}` as StringKey)),
      el('span', 'slot-part', t(current.name)),
      el('span', 'slot-numbers', tf('build.partNumbers', { mass: num(current.mass[b.cls] as number), cost: num(current.cost[b.cls] as number) })),
    )
    const field = el('fieldset', 'options')
    field.append(el('legend', 'visually-hidden', t(`slot.${slot}` as StringKey)))
    for (const part of partsFor(b.cls, slot)) {
      const id = `part-${slot}-${part.id}`
      const label = el('label', 'option')
      label.htmlFor = id
      const radio = el('input')
      radio.type = 'radio'
      radio.name = `slot-${slot}`
      radio.id = id
      radio.value = part.id
      radio.checked = part.id === current.id
      const notYet = part.year > store.year()
      radio.disabled = notYet && part.id !== current.id
      radio.addEventListener('change', () => {
        if (!radio.checked) return
        const now = store.build()
        store.setBuild({ ...now, parts: { ...now.parts, [slot]: part.id } }, 'part')
      })
      const words = el('span', 'option-words')
      words.append(el('strong', '', t(part.name)), el('span', 'option-text', t(part.text)))
      const meta = el('span', 'option-meta', notYet ? tf('build.from', { year: String(part.year) }) : deltaText(part, current, store))
      label.append(radio, words, meta)
      field.append(label)
    }
    details.append(head, field)
    return details
  }

  function axleBlock(end: End, open: boolean): HTMLElement {
    const b = store.build()
    const details = el('details', 'axle')
    details.dataset.end = end
    details.open = open
    details.append(el('summary', '', t(end === 'front' ? 'build.front' : 'build.rear')))
    const geo = el('p', 'small geometry')
    geometry.push({ end, p: geo })
    details.append(geo)
    for (const slider of slidersFor(store)) {
      const id = `tune-${end}-${slider.key}`
      const row = el('div', 'setting')
      const label = el('label', 'setting-label', t(slider.label))
      label.htmlFor = id
      const out = el('output', 'setting-value')
      out.htmlFor.add(id)
      const input = el('input')
      input.type = 'range'
      input.id = id
      input.min = String(slider.min)
      input.max = String(slider.max)
      input.step = String(slider.step)
      input.value = String(slider.show(b[end][slider.key]))
      input.addEventListener('input', () => {
        const now = store.build()
        const value = slider.store(Number(input.value))
        store.setBuild({ ...now, [end]: { ...now[end], [slider.key]: value } }, 'setting')
      })
      outputs.push({ end, slider, out })
      row.append(label, out, input)
      details.append(row)
    }
    if (!slidersFor(store).some((s) => s.key === 'rebound')) details.append(el('p', 'small', t('build.noAdjusters')))
    return details
  }

  /** Rebuild the class, part and tune sections, keeping open sections open and focus where it was. */
  function render(): void {
    const b = store.build()
    for (const { id, b: button } of classButtons) button.setAttribute('aria-pressed', String(id === b.cls))
    const cls = CLASSES.find((c) => c.id === b.cls)!
    blurb.textContent = t(cls.blurb)
    yearInput.value = String(store.year())
    yearOut.textContent = String(store.year())

    const openSlots = new Set([...partsHolder.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.slot))
    const openEnds = new Set([...tuneHolder.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.end))
    const firstTime = tuneHolder.childElementCount === 0
    const focused = document.activeElement instanceof HTMLElement && box.contains(document.activeElement) ? document.activeElement.id : ''

    outputs = []
    geometry = []
    partsHolder.replaceChildren(el('h3', '', t('build.parts')), ...SLOTS.map((s) => slotBlock(s, openSlots.has(s))))
    tuneHolder.replaceChildren(
      el('h3', '', t('build.tune')),
      el('p', 'small', t('build.tuneLead')),
      axleBlock('front', firstTime || openEnds.has('front')),
      axleBlock('rear', openEnds.has('rear')),
    )
    if (focused) document.getElementById(focused)?.focus()
    refresh()
  }

  store.onChange((change) => (change === 'setting' ? refresh() : render()))
  box.append(classRow, blurb, truckView(store), yearRow, el('p', 'small', t('build.yearNote')), summary, partsHolder, tuneHolder, reset)
  render()
  return box
}
