/**
 * The look preview's roadbook strip (plan PR 0): plain SVG with sample
 * notes, so the look can be judged on a phone. The trace that used to sit
 * beside it became the rigs in plan PR 4 (`shop.ts`).
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
