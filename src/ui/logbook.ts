/**
 * The garage logbook on screen: each truck's record and moments, shown
 * under Your truck on the career screen, plus the old trucks the garage
 * sold. The truck card draws a short version (`cardLines`). The logbook
 * itself is kept by `src/sim/logbook.ts`.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { LOGBOOK } from '../data/logbook'
import { RAIDS } from '../data/raids'
import { t, tf, type StringKey } from '../data/strings'
import { oldTrucks, ownLog, type TruckLog, type TruckMoment } from '../sim/logbook'
import type { CareerState } from '../sim/career'
import { el, num } from './dom'
import { ordinal } from './raid'

const className = (cls: ClassId) => t(CLASSES.find((c) => c.id === cls)!.name)

/** A year as a roadbook writes it: ’91, ’05. */
export function shortYear(year: number): string {
  return String(year % 100).padStart(2, '0')
}

/** One moment in words: "Frozen Knuckle ’91: snapped the rear left axle". */
export function momentText(m: TruckMoment): string {
  const vars = { raid: t(RAIDS[m.raid].name), yy: shortYear(m.year) }
  switch (m.kind) {
    case 'broke': {
      const corner = m.corner >= 0 ? t(`corner.${m.corner}` as StringKey) : ''
      return tf('log.m.broke', { ...vars, what: tf(`log.b.${m.part}` as StringKey, { corner }) })
    }
    case 'win': case 'longOne': case 'retired': case 'slide': case 'ice':
      return tf(`log.m.${m.kind}`, vars)
    case 'podium': case 'firstRaid':
      return tf(`log.m.${m.kind}`, { ...vars, pos: m.pos === null ? '' : ordinal(m.pos) })
  }
}

/** Kilometres, whole. */
function km(log: TruckLog): string {
  return num(Math.round(log.km))
}

/** The two lines the truck card adds: the record, and the newest moment (or null before its first raid). */
export function cardLines(log: TruckLog): { record: string; moment: string | null } {
  return {
    record: tf('card.log', { n: String(log.n), raids: String(log.raids), wins: String(log.wins), km: km(log) }),
    moment: log.moments[0] ? momentText(log.moments[0]) : null,
  }
}

/** One truck's logbook: who it is, its record and its moments. */
function logEntry(log: TruckLog): HTMLElement {
  const box = el('div', 'logbook-entry')
  const head = log.sold === null
    ? tf('log.truck', { n: String(log.n), cls: className(log.cls).toLowerCase(), year: String(log.bought) })
    : log.sold === log.bought
      ? tf('log.oldTruckYear', { n: String(log.n), cls: className(log.cls).toLowerCase(), year: String(log.bought) })
      : tf('log.oldTruck', { n: String(log.n), cls: className(log.cls).toLowerCase(), from: String(log.bought), to: String(log.sold) })
  box.append(el('p', 'logbook-head', head))
  if (log.raids === 0) {
    box.append(el('p', 'small', t('log.none')))
    return box
  }
  box.append(
    el('p', 'small logbook-num', tf('log.record', { raids: String(log.raids), finishes: String(log.finishes), wins: String(log.wins), podiums: String(log.podiums) })),
    el('p', 'small logbook-num', tf('log.miles', { km: km(log), stops: String(log.stops), parts: String(log.parts) })),
  )
  if (log.best !== null) box.append(el('p', 'small', tf('log.best', { pos: ordinal(log.best) })))
  if (log.moments.length) {
    const list = el('ul', 'raid-list logbook-moments')
    for (const m of log.moments.slice(0, LOGBOOK.shown)) list.append(el('li', '', momentText(m)))
    box.append(list)
    const more = log.moments.length - LOGBOOK.shown
    if (more > 0) box.append(el('p', 'small', tf('log.more', { n: String(more) })))
  }
  return box
}

/** The logbook of the garage's truck, open by default. Null with no truck. */
export function logbookBlock(c: CareerState): HTMLElement | null {
  const log = ownLog(c)
  if (!log) return null
  const box = el('details', 'logbook')
  box.open = true
  box.append(el('summary', '', t('log.title')), logEntry(log))
  return box
}

/** The trucks the garage sold, newest first, closed by default. Null before the first sale. */
export function oldTrucksBlock(c: CareerState): HTMLElement | null {
  const old = oldTrucks(c)
  if (!old.length) return null
  const box = el('details', 'logbook')
  box.append(el('summary', '', t('log.old')), el('p', 'small', t('log.oldLead')), ...old.map(logEntry))
  return box
}

/** The goodbye line when the garage sells a truck. */
export function farewellText(log: TruckLog): string {
  return tf('log.farewell', { n: String(log.n), raids: String(log.raids), km: km(log) })
}
