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
import { changeCost, checkBuild, minPressure, partIn, partsFor, type BuildProblem, type CornerGeometry } from '../sim/build'
import { FIRST_YEAR, LAST_YEAR, readLinkAxles, withSetting, writeLinkAxles, type BuildStore, type End } from './buildStore'
import { shareBuildBlock } from './saves'
import { truckCardBlock } from './truckCard'
import { el, num, oneOpenAtATime } from './dom'
import { truckView } from './truckView'

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

/** "+12 kg · −3,500 cr." against the part fitted now. */
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
  // The career's note under the money (plan PR 9): e.g. what the changes cost, and "Buy these parts".
  const benchNote = el('div', 'bench-note')
  // Weight and money each get a box, so a short (landscape) screen can set them side by side.
  const weightBox = el('div', 'sum-weight')
  weightBox.append(weightLine, weightBar)
  const moneyBox = el('div', 'sum-money')
  moneyBox.append(moneyLine, moneyBar)
  summary.append(weightBox, moneyBox, problems, benchNote)
  const benchLabel = el('p', 'bench-label')

  const partsHolder = el('div', 'slots')
  const tuneHolder = el('div', 'tune')
  const reset = el('button', 'btn', t('build.reset'))
  reset.type = 'button'
  reset.addEventListener('click', () => store.resetClass())

  // "Link front and rear": one slider sets both axles. Remembered on this phone.
  let linked = readLinkAxles()

  // Pieces that refresh() updates without rebuilding, so a slider being dragged keeps its place.
  let outputs: { end: End; slider: Slider; out: HTMLOutputElement; input: HTMLInputElement }[] = []
  let geometry: { end: End; p: HTMLElement }[] = []

  function refresh(): void {
    const b = store.build()
    const truck = store.truck()
    const cls = CLASSES.find((c) => c.id === b.cls)!
    const rules = store.rules()
    const found = checkBuild(b, rules)

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
      el('span', 'small sum-range', tf('build.window', { min: num(cls.minMass), max: num(cls.maxMass) })),
      ' ',
      el('span', `chip ${wBand}`, t(heavy ? 'build.tooHeavy' : light ? 'build.tooLight' : 'build.inWindow')),
    )

    const budget = rules.budget
    // Your own truck (career): only the changes cost money, against what's in the bank.
    const spend = rules.owned ? changeCost(rules.owned.build, b, rules.owned.resale, rules.owned.discount) : truck.cost
    const over = found.some((p) => p.kind === 'overBudget')
    moneyFill.style.width = `${budget > 0 ? Math.min(100, Math.max(0, (spend / budget) * 100)) : spend > 0 ? 100 : 0}%`
    moneyFill.className = `sum-fill ${over ? 'hot' : 'cool'}`
    moneyLine.replaceChildren(
      el('span', 'label', t(rules.owned ? 'build.changes' : 'build.budget')),
      ` ${rules.owned
        ? tf(spend < 0 ? 'build.refund' : 'build.spend', { n: num(Math.abs(spend)), total: num(budget) })
        : tf('build.of', { n: num(truck.cost), total: num(budget) })} `,
      el('span', `chip ${over ? 'hot' : 'cool'}`, t(over ? 'build.overBudget' : 'build.inBudget')),
    )
    const note = store.bench()?.note?.(b) ?? null
    benchNote.replaceChildren()
    if (note) {
      benchNote.append(el('p', 'small', note.text))
      if (note.button) {
        const action = el('button', 'btn start-btn', note.button.text)
        action.type = 'button'
        action.addEventListener('click', note.button.run)
        benchNote.append(action)
      }
    }

    problems.replaceChildren()
    for (const p of found) problems.append(el('li', '', problemText(p, store)))
    if (found.length === 0) problems.append(el('li', 'ok', t('build.ready')))

    for (const { end, slider, out, input } of outputs) {
      out.textContent = slider.text(b[end][slider.key], truck[end])
      // With the axles linked, the other axle's slider follows the one being dragged.
      // (The one under the thumb is left alone so it doesn't jump.)
      if (input !== document.activeElement) input.value = String(slider.show(b[end][slider.key]))
    }
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
    oneOpenAtATime(details, 'build-parts')
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
    oneOpenAtATime(details, 'build-tune')
    const head = el('summary', '', t(end === 'front' ? 'build.front' : 'build.rear'))
    // A tag on each axle while they're linked, so it's clear the other end moves too.
    if (linked) head.append(' ', el('span', 'chip link-chip', t('build.linkedChip')))
    details.append(head)
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
        store.setBuild(withSetting(now, end, slider.key, value, linked), 'setting')
      })
      outputs.push({ end, slider, out, input })
      row.append(label, out, input)
      details.append(row)
    }
    if (!slidersFor(store).some((s) => s.key === 'rebound')) details.append(el('p', 'small', t('build.noAdjusters')))
    return details
  }

  /** The "Link front and rear" tick box, with a line saying what it does right now. */
  function linkBlock(): HTMLElement {
    const wrap = el('div', 'link-axles')
    const label = el('label', 'link-label')
    const tick = el('input')
    tick.type = 'checkbox'
    tick.id = 'tune-link'
    tick.checked = linked
    tick.addEventListener('change', () => {
      linked = tick.checked
      writeLinkAxles(linked)
      // Nothing changes on the truck: unlinking keeps every value, so the ends can be tuned apart again.
      render()
    })
    label.append(tick, ' ', t('build.link'))
    wrap.append(label, el('p', 'small', t(linked ? 'build.linkOn' : 'build.linkOff')))
    return wrap
  }

  /** Rebuild the class, part and tune sections, keeping open sections open and focus where it was. */
  function render(): void {
    const b = store.build()
    const bench = store.bench()
    for (const { id, b: button } of classButtons) {
      button.setAttribute('aria-pressed', String(id === b.cls))
      // The career locks the class to the truck on the bench.
      button.disabled = !!bench?.cls && bench.cls !== id
    }
    const cls = CLASSES.find((c) => c.id === b.cls)!
    blurb.textContent = t(cls.blurb)
    yearInput.value = String(store.year())
    yearOut.textContent = String(store.year())
    yearInput.disabled = bench !== null
    yearNote.textContent = t(bench ? 'build.yearCareer' : 'build.yearNote')
    benchLabel.textContent = bench?.label ?? ''
    benchLabel.hidden = !bench

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
      linkBlock(),
      axleBlock('front', firstTime || openEnds.has('front')),
      axleBlock('rear', openEnds.has('rear')),
    )
    if (focused) document.getElementById(focused)?.focus()
    refresh()
  }

  store.onChange((change) => (change === 'setting' ? refresh() : render()))
  const yearNote = el('p', 'small', t('build.yearNote'))
  const view = truckView(store)
  box.append(benchLabel, classRow, blurb, view.element, yearRow, yearNote, summary, partsHolder, tuneHolder, reset, shareBuildBlock(store), truckCardBlock(store, view.garage, view.garageNow))
  render()
  return box
}
