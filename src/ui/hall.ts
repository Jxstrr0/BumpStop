/**
 * The hall of fame (after 1.2): the end of the 1985–2025 career, looking
 * back on it. It folds away at the foot of the career panel as "The career
 * so far" until the last raid of 2025, then becomes the Hall of fame, and
 * the results card of that last raid opens it.
 *
 * - **The record:** seasons, raids, wins, podiums, contracts, and the years
 *   the garage won the Whole Damn Country.
 * - **Best seasons:** the top three (`HALL.bestSeasons`).
 * - **Biggest rival:** the team that finished ahead of your trucks most.
 * - **Favourite truck:** from the truck logbooks.
 * - **Drivers you hired**, and how each did.
 * - **The album:** photos kept from photo mode during the career.
 *
 * The numbers come from `recap` in `src/sim/hall.ts`; the photos from
 * `src/persist/album.ts`. This file only shows them.
 */
import { HALL, TEAMS } from '../data/career'
import { CLASSES, type ClassId } from '../data/classes'
import { DRIVERS, RAIDS } from '../data/raids'
import { t, tf } from '../data/strings'
import { careerPhotos, removePhoto, albumWorks, type AlbumPhoto } from '../persist/album'
import type { SlotNo } from '../persist/slots'
import { driverName, type CareerState } from '../sim/career'
import { recap, type HallRecap, type SeasonLine } from '../sim/hall'
import { el, num } from './dom'
import { ordinal } from './raid'

const money = (n: number) => tf('career.money', { n: num(Math.round(n)) })
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : `+${money(n)}`)
const className = (cls: ClassId) => t(CLASSES.find((c) => c.id === cls)!.name)

/** "4 wins, 6 podiums" with the ones and noughts said properly. */
function counted(n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]): string {
  return tf(n === 1 ? one : many, { n: String(n) })
}

/** One of the best seasons, in words. */
export function seasonText(s: SeasonLine): string {
  const parts = [
    counted(s.wins, 'hall.win', 'hall.wins'),
    counted(s.podiums, 'hall.podium', 'hall.podiums'),
  ]
  if (s.contracts) parts.push(counted(s.contracts, 'hall.contract', 'hall.contracts'))
  // Money before reputation, so the line never ends on "cr." and a second full stop.
  parts.push(signed(s.money), tf('hall.seasonRep', { n: String(s.rep) }))
  let text = tf('hall.seasonLine', { year: String(s.year), what: parts.join(', ') })
  if (s.longOne) text += ` ${t('hall.seasonLongOne')}`
  else if (s.best) {
    text += ` ${tf(s.best.job === 'own' ? 'hall.seasonBest' : 'hall.seasonBestContract', {
      pos: ordinal(s.best.pos), raid: t(RAIDS[s.best.raid].name), cls: className(s.best.cls).toLowerCase(),
    })}`
  }
  return text
}

/** The biggest rival, in words. */
export function rivalText(r: NonNullable<HallRecap['rival']>): string {
  const team = t(TEAMS[r.team].name)
  if (r.tally.ahead === 0) return tf('hall.rivalNever', { team, met: String(r.tally.met) })
  return tf('hall.rival', { team, met: String(r.tally.met), ahead: String(r.tally.ahead), behind: String(r.tally.behind) })
}

/** What the logbooks can say about the favourite truck (filled in by the career panel). */
export type FavouriteTruck = (c: CareerState) => string | null

export interface HallOptions {
  /** The slot the career is in, for its album. */
  slot?: SlotNo
  favourite?: FavouriteTruck
}

export interface HallBlock {
  element: HTMLDetailsElement
  /** Unfold it and scroll to it (the career's last results card calls this). */
  open(): void
}

/**
 * The hall of fame for the career, folded away until tapped. It reads the
 * career when it's opened, so it's always up to date.
 */
export function hallBlock(c: CareerState, opts: HallOptions = {}): HallBlock {
  const r = recap(c)
  const box = el('details', 'career-hall')
  box.id = 'hall-of-fame'
  box.append(el('summary', '', t(r.ended ? 'hall.summary' : 'hall.summarySoFar')))
  const body = el('div', 'hall-body')
  box.append(body)
  /** Picture addresses made for the album, let go when it's drawn again. */
  let urls: string[] = []

  function draw(): void {
    for (const u of urls) URL.revokeObjectURL(u)
    urls = []
    body.replaceChildren(...recapParts(c, recap(c), opts.favourite), albumPart())
  }

  function albumPart(): HTMLElement {
    const wrap = el('section', 'hall-album')
    wrap.append(el('h4', 'raid-sub', t('hall.album')))
    if (opts.slot === undefined || !albumWorks()) {
      wrap.append(el('p', 'small', t('hall.albumNone')))
      return wrap
    }
    const slot = opts.slot
    const lead = el('p', 'small', t('hall.albumLoading'))
    const grid = el('div', 'hall-photos')
    wrap.append(lead, grid)
    void careerPhotos(slot, c.seed).then((photos) => {
      lead.textContent = photos.length
        ? tf('hall.albumCount', { n: String(photos.length), max: String(HALL.albumMax) })
        : t('hall.albumEmpty')
      for (const p of photos) grid.append(photoFigure(p))
    })
    return wrap
  }

  function photoFigure(p: AlbumPhoto): HTMLElement {
    const fig = el('figure', 'hall-photo')
    const img = el('img')
    const url = URL.createObjectURL(p.picture)
    urls.push(url)
    img.src = url
    img.alt = tf('hall.photoAlt', { caption: p.caption })
    img.loading = 'lazy'
    // Tap to see it the full width of the screen, tap again to put it back.
    const zoom = el('button', 'hall-photo-zoom')
    zoom.type = 'button'
    zoom.setAttribute('aria-pressed', 'false')
    zoom.setAttribute('aria-label', tf('hall.photoZoom', { caption: p.caption }))
    zoom.append(img)
    zoom.addEventListener('click', () => {
      const big = fig.classList.toggle('big')
      zoom.setAttribute('aria-pressed', String(big))
    })
    const cap = el('figcaption', 'small', p.caption)
    fig.append(zoom, cap)
    if (p.id !== undefined) {
      const id = p.id
      const remove = el('button', 'btn small-btn', t('hall.remove'))
      remove.type = 'button'
      let armed = false
      remove.addEventListener('click', () => {
        if (!armed) {
          armed = true
          remove.textContent = t('hall.removeSure')
          window.setTimeout(() => {
            armed = false
            remove.textContent = t('hall.remove')
          }, 3000)
          return
        }
        void removePhoto(id).then(draw)
      })
      fig.append(remove)
    }
    return fig
  }

  box.addEventListener('toggle', () => {
    if (box.open) draw()
  })

  return {
    element: box,
    open() {
      box.open = true
      draw()
      box.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  }
}

/** Everything but the album: pure words from the recap, so the tests can read them. */
export function recapParts(c: CareerState, r: HallRecap, favourite?: FavouriteTruck): HTMLElement[] {
  const out: HTMLElement[] = []
  const years = r.lastYear > r.firstYear ? `${r.firstYear}–${r.lastYear}` : String(r.firstYear)
  out.push(el('h3', 'raid-sub', tf(r.ended ? 'hall.head' : 'hall.headSoFar', { years })))
  const s = r.stats
  out.push(el('p', '', tf(r.ended ? 'hall.lead' : 'hall.leadSoFar', {
    seasons: counted(r.seasons, 'hall.season', 'hall.seasons'),
    raids: String(s.raids), wins: String(s.wins), podiums: String(s.podiums), contracts: String(s.contracts),
  })))
  out.push(el('p', r.longOne.length ? 'career-win' : 'small', r.longOne.length
    ? tf(r.longOne.length > 1 ? 'hall.longOneTimes' : 'hall.longOneYears', { n: String(r.longOne.length), years: r.longOne.join(', ') })
    : t(r.ended ? 'hall.longOneNever' : 'hall.longOneNotYet')))
  if (r.partial) out.push(el('p', 'small', tf('hall.partial', { year: String(r.fromYear) })))

  out.push(el('h4', 'raid-sub', t('hall.bestSeasons')))
  if (r.best.length) {
    const list = el('ol', 'raid-list')
    for (const line of r.best) list.append(el('li', 'small', seasonText(line)))
    out.push(list)
  } else out.push(el('p', 'small', t('hall.noSeasons')))

  out.push(el('h4', 'raid-sub', t('hall.rivalHead')))
  out.push(el('p', 'small', r.rival ? rivalText(r.rival) : t('hall.noRival')))

  out.push(el('h4', 'raid-sub', t('hall.truckHead')))
  out.push(el('p', 'small', favourite?.(c) ?? t('hall.noTruck')))

  out.push(el('h4', 'raid-sub', t('hall.driversHead')))
  if (r.drivers.length) {
    const list = el('ul', 'raid-list')
    for (const d of r.drivers) {
      list.append(el('li', 'small', tf('hall.driverLine', {
        name: t(driverName(c, d.id)), trade: t(DRIVERS[d.id].name).toLowerCase(), first: String(d.tally.first),
        raids: counted(d.tally.raids, 'hall.raid', 'hall.raids'), wins: counted(d.tally.wins, 'hall.win', 'hall.wins'),
        podiums: counted(d.tally.podiums, 'hall.podium', 'hall.podiums'),
      })))
    }
    out.push(list)
  } else out.push(el('p', 'small', t('hall.noDrivers')))
  return out
}
