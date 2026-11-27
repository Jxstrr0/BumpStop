/**
 * The Load section of Tune (weight and balance, Kelbo picked it, 27
 * November 2026): where the spares kit and the tools ride, and how much
 * fuel goes in the tank.
 *
 * The truck is drawn from above, front at the top, as a three-by-three grid
 * of spots. Pick what you're placing (spares kit or tools), then tap a
 * spot. The weight on each wheel shows beside it, and two small gauges tip
 * with the truck: one seen from the side (nose up or down) and one from
 * behind (leaning left or right). The gauges are drawn ten times steeper
 * than the truck really tips, so a fraction of a degree still shows.
 *
 * The numbers come from `src/sim/build.ts` (`balance`); this file only
 * shows them. Changes go through the build store as settings, so the 3D
 * truck, the rigs and the raid all use them.
 */
import { LOAD_INFO } from '../data/info'
import { BALANCE_READ, CLASS_LOAD, FUEL_STEPS, LOAD_ITEMS, SPOT_IDS, type LoadItem, type SpotId } from '../data/load'
import { SIM, TEST_MULES } from '../data/ride'
import { t, tf, type StringKey } from '../data/strings'
import type { BuiltTruck } from '../sim/build'
import { fuelRangeKm } from '../sim/load'
import type { BuildStore } from './buildStore'
import { el, num } from './dom'
import { infoButton, type ShowTerm } from './info'

/** How many times steeper the gauges draw the tilt. */
const GAUGE_SCALE = 10
/** The gauges stop tipping past this many degrees (drawn). */
const GAUGE_MAX = 20

const DEG = 180 / Math.PI

/** "Full tank", "Half a tank"… for a fuel share. */
export function fuelWords(fuel: number): string {
  return t(`load.fuel${Math.round(fuel * 100)}` as StringKey)
}

/** The spot's name in words, e.g. "rear carrier". */
function spotName(spot: SpotId): string {
  return t(`load.spot.${spot}` as StringKey)
}

/** Degrees with one decimal. */
function deg(rad: number): string {
  return num(Math.abs(rad * DEG), 1)
}

/** The chip on the section's heading: even, nose or tail heavy, or leaning. */
export function balanceChip(truck: BuiltTruck): { word: StringKey; band: 'cool' | 'warm' } {
  const b = truck.balance
  const shift = b.front - b.stockFront
  const rollDeg = b.roll * DEG
  const lean = Math.abs(rollDeg) >= BALANCE_READ.levelDeg
  // The bigger story wins: a front-to-back shift against a lean (in comparable steps).
  const noseScore = Math.abs(shift) / BALANCE_READ.heavy
  const leanScore = Math.abs(rollDeg) / BALANCE_READ.warmDeg
  if (Math.abs(shift) < BALANCE_READ.even && !lean) return { word: 'load.chipEven', band: 'cool' }
  if (noseScore >= leanScore && Math.abs(shift) >= BALANCE_READ.even) {
    return { word: shift > 0 ? 'load.chipNose' : 'load.chipTail', band: noseScore >= 1 ? 'warm' : 'cool' }
  }
  return { word: rollDeg < 0 ? 'load.chipLeft' : 'load.chipRight', band: leanScore >= 1 ? 'warm' : 'cool' }
}

export interface LoadBlock {
  element: HTMLDetailsElement
  /** Bring the numbers up to date after any change. */
  update(): void
}

/** The section. `placing` remembers which item a tap moves while the screen is open. */
export function loadBlock(store: BuildStore, open: boolean, showTerm?: ShowTerm): LoadBlock {
  const details = el('details', 'axle load')
  details.dataset.end = 'load'
  details.open = open
  const chip = el('span', 'chip cool')
  const head = el('summary', '', t('build.load'))
  head.append(' ', chip)
  details.append(head, el('p', 'small', t('build.loadLead')))

  // What a tap moves: the spares kit or the tools.
  const placeHead = el('div', 'setting-head load-place-head')
  const placeInfo = infoButton(t('build.loadPlacing'), LOAD_INFO.place, showTerm)
  placeHead.append(el('span', 'setting-label', t('build.loadPlacing')), placeInfo.button)
  const pickRow = el('div', 'btn-row load-pick')
  const pickButtons = new Map<LoadItem, HTMLButtonElement>()
  let placing: LoadItem = 'spares'
  for (const item of LOAD_ITEMS) {
    const b = el('button', 'btn', t(`load.${item}` as StringKey))
    b.type = 'button'
    b.addEventListener('click', () => {
      placing = item
      update()
    })
    pickButtons.set(item, b)
    pickRow.append(b)
  }
  const noSpares = el('p', 'small', t('build.loadNoSpares'))

  // The truck from above, with a weight beside each wheel.
  const wrap = el('div', 'load-wrap')
  const map = el('div', 'load-map')
  map.setAttribute('role', 'group')
  map.setAttribute('aria-label', t('build.load'))
  const grid = el('div', 'load-grid')
  const tank = el('div', 'load-tank')
  tank.setAttribute('aria-hidden', 'true')
  const tankFill = el('span', 'load-tank-fill')
  tank.append(tankFill, el('span', 'load-tank-word', t('load.tank')))
  grid.append(tank)
  map.append(el('span', 'load-end', t('build.loadFront')), grid, el('span', 'load-end', t('build.loadRear')))
  // Each wheel, with its weight beside it (outside the truck, in the space either side).
  const wheels = [0, 1, 2, 3].map((i) => {
    const w = el('span', `load-wheel ${i % 2 === 0 ? 'left' : 'right'}`)
    w.setAttribute('aria-hidden', 'true')
    grid.append(w)
    return w
  })
  const kg = [0, 1, 2, 3].map((i) => {
    const p = el('span', `load-kg ${i % 2 === 0 ? 'left' : 'right'}`)
    grid.append(p)
    return p
  })
  const cells = new Map<SpotId, HTMLButtonElement>()
  for (const spot of SPOT_IDS) {
    const b = el('button', 'load-cell')
    b.type = 'button'
    b.dataset.spot = spot
    b.addEventListener('click', () => {
      const now = store.build()
      const truck = store.truck()
      store.setBuild({ ...now, load: { ...truck.load, [placing]: spot } }, 'setting')
    })
    cells.set(spot, b)
    grid.append(b)
  }
  wrap.append(el('div'), map, el('div'))

  // Fuel: a quarter to full.
  const fuelRow = el('div', 'setting')
  const fuelId = 'tune-load-fuel'
  const fuelLabel = el('label', 'setting-label', t('build.loadFuel'))
  fuelLabel.htmlFor = fuelId
  const fuelInfo = infoButton(t('build.loadFuel'), LOAD_INFO.fuel, showTerm)
  const fuelHead = el('span', 'setting-head')
  fuelHead.append(fuelLabel, fuelInfo.button)
  const fuelOut = el('output', 'setting-value')
  fuelOut.htmlFor.add(fuelId)
  const fuelInput = el('input')
  fuelInput.type = 'range'
  fuelInput.id = fuelId
  fuelInput.min = '0'
  fuelInput.max = String(FUEL_STEPS.length - 1)
  fuelInput.step = '1'
  fuelInput.addEventListener('input', () => {
    const now = store.build()
    const fuel = FUEL_STEPS[Number(fuelInput.value)] ?? 1
    store.setBuild({ ...now, load: { ...store.truck().load, fuel } }, 'setting')
  })
  fuelRow.append(fuelHead, fuelOut, fuelInput, fuelInfo.note)

  // The balance: shares, the tilt gauges, and what each corner has left.
  const balHead = el('div', 'setting-head')
  const balInfo = infoButton(t('build.load'), LOAD_INFO.balance, showTerm)
  const split = el('p', 'readout-line load-split')
  balHead.append(split, balInfo.button)
  const gauges = el('div', 'load-gauges')
  gauges.setAttribute('aria-hidden', 'true')
  const gauge = (label: StringKey, ends: [string, string]) => {
    const g = el('div', 'load-gauge')
    const bar = el('div', 'load-gauge-bar')
    const level = el('div', 'load-gauge-level')
    level.append(bar)
    g.append(el('span', 'label', t(label)), el('span', 'load-gauge-end', ends[0]), level, el('span', 'load-gauge-end', ends[1]))
    gauges.append(g)
    return bar
  }
  const noseBar = gauge('build.loadNose', [t('build.loadRear'), t('build.loadFront')])
  const leanBar = gauge('build.loadLean', [t('load.leftShort'), t('load.rightShort')])
  const sits = el('p', 'small load-sits')
  const corners = el('p', 'small load-corners')
  const weight = el('p', 'small load-weight')
  details.append(
    placeHead, placeInfo.note, pickRow, noSpares, wrap, fuelRow,
    balHead, balInfo.note, gauges, el('p', 'small load-gauge-note', t('build.loadGaugeNote')), sits, corners, weight,
  )

  function update(): void {
    const truck = store.truck()
    const cls = truck.build.cls
    const load = truck.load
    const c = CLASS_LOAD[cls]
    const hasSpares = truck.build.parts.spares !== 'noSpares'
    if (!hasSpares && placing === 'spares') placing = 'tools'
    for (const [item, b] of pickButtons) {
      b.setAttribute('aria-pressed', String(item === placing))
      b.disabled = item === 'spares' && !hasSpares
    }
    noSpares.hidden = hasSpares

    const itemName = t(`load.${placing}` as StringKey)
    for (const [spot, b] of cells) {
      const here: string[] = []
      if (hasSpares && load.spares === spot) here.push('spares')
      if (load.tools === spot) here.push('tools')
      b.replaceChildren(...here.map((h) => el('span', `load-tag load-tag-${h}`, t(`load.${h}Short` as StringKey))))
      b.setAttribute('aria-pressed', String(load[placing] === spot))
      const words = here.map((h) => t(`load.${h}` as StringKey).toLowerCase()).join(', ')
      b.setAttribute('aria-label', tf('load.cellAria', {
        item: itemName.toLowerCase(), spot: spotName(spot), here: here.length ? tf('load.here', { items: words }) : t('load.empty'),
      }))
    }

    // The tank and the wheels, drawn where they sit: the rows' middles are a sixth, a half and five sixths of the way down.
    const down = (x: number) => `${(1 / 6 + (4 / 6) * ((c.rowX.front - x) / (c.rowX.front - c.rowX.rear))) * 100}%`
    tank.style.top = down(c.tankX)
    tank.style.left = `${(1 / 6 + (4 / 6) * ((c.colY.left - c.tankY) / (c.colY.left - c.colY.right))) * 100}%`
    tankFill.style.height = `${load.fuel * 100}%`
    const mule = TEST_MULES[cls]
    const g = SIM.gravity
    truck.balance.corners.forEach((k, i) => {
      const top = down(i < 2 ? mule.cgToFront : -mule.cgToRear)
      wheels[i]!.style.top = top
      kg[i]!.style.top = top
      kg[i]!.replaceChildren(num(k.tireLoad / g), el('span', 'load-kg-unit', 'kg'))
    })

    const fuelIndex = FUEL_STEPS.indexOf(load.fuel)
    if (fuelInput !== document.activeElement) fuelInput.value = String(fuelIndex < 0 ? FUEL_STEPS.length - 1 : fuelIndex)
    fuelOut.textContent = tf('build.loadFuelValue', { share: fuelWords(load.fuel), km: num(fuelRangeKm(cls, load.fuel)) })

    const b = truck.balance
    split.textContent = tf('build.loadSplit', { front: num(b.front * 100), stock: num(b.stockFront * 100), left: num(b.left * 100) })
    const pDeg = b.pitch * DEG
    const rDeg = b.roll * DEG
    const level = BALANCE_READ.levelDeg
    const pitchWords = Math.abs(pDeg) < level ? t('load.levelPitch') : tf(pDeg > 0 ? 'load.noseUp' : 'load.noseDown', { deg: deg(b.pitch) })
    const rollWords = Math.abs(rDeg) < level ? t('load.levelRoll') : tf(rDeg > 0 ? 'load.leanRight' : 'load.leanLeft', { deg: deg(b.roll) })
    sits.textContent = tf('build.loadSits', { pitch: pitchWords, roll: rollWords })
    const clampDeg = (v: number) => Math.max(-GAUGE_MAX, Math.min(GAUGE_MAX, v * GAUGE_SCALE))
    // Side view, front on the right: nose up turns the bar anticlockwise. From behind, left up turns it clockwise.
    noseBar.style.transform = `rotate(${-clampDeg(pDeg)}deg)`
    leanBar.style.transform = `rotate(${clampDeg(rDeg)}deg)`
    noseBar.className = `load-gauge-bar ${Math.abs(pDeg) >= BALANCE_READ.warmDeg ? 'warm' : 'cool'}`
    leanBar.className = `load-gauge-bar ${Math.abs(rDeg) >= BALANCE_READ.warmDeg ? 'warm' : 'cool'}`

    const mm = (i: number) => num((b.corners[i]?.bumpTravel ?? 0) * 1000)
    corners.textContent = tf('build.loadCorners', { fl: mm(0), fr: mm(1), rl: mm(2), rr: mm(3) })
    const less = truck.mass - truck.runMass
    weight.textContent = less >= 0.5
      ? tf('build.loadLighter', { kg: num(truck.runMass), less: num(less) })
      : tf('build.loadWeight', { kg: num(truck.runMass) })

    const read = balanceChip(truck)
    chip.className = `chip ${read.band}`
    chip.textContent = t(read.word)
  }

  update()
  return { element: details, update }
}
