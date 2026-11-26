/**
 * The truck card (plan PR 12): a picture of the truck on the build screen,
 * with its class, year, the parts that matter and its weight, to send to a
 * friend. The build code goes along with it as text, so they can paste it
 * under Share this build and drive the very same truck.
 *
 * The card is 1080 × 1350 (the shape phones and feeds show whole), drawn in
 * the roadbook look and following the phone's light or dark mode, with the
 * truck drawn by the build screen's own 3D view (`Garage.snapshot`).
 *
 * Opening the card makes a preview. The Share button draws it again there
 * and then without waiting, because phones only open the share sheet right
 * after a tap.
 */
import { CLASSES } from '../data/classes'
import type { SlotId } from '../data/parts'
import { t, tf, type StringKey } from '../data/strings'
import { encodeBuildCode } from '../persist/code'
import type { Garage } from '../render/garage'
import { findPart } from '../sim/build'
import type { BuildStore } from './buildStore'
import { el, num } from './dom'
import { cardLines } from './logbook'
import { cssVar, pictureName, pngFile, shareFile } from './shareImage'
import { signedMm, stanceOf } from './truckView'

const W = 1080
const H = 1350
const M = 60
/** The truck's picture on the card (pixels): a little shorter when the card carries the truck's logbook lines. */
const SHOT_W = W - 2 * M
const SHOT_H_FULL = 560
const SHOT_H_LOG = 440
/** The parts the card lists, in this order. */
const CARD_SLOTS: readonly SlotId[] = ['frontSusp', 'rearSusp', 'dampers', 'bumpStops', 'tires', 'axles', 'engine']
const ADDRESS = 'bumpstop.longlight.games'

const HEAD = "'Big Shoulders', 'Arial Narrow', sans-serif"
const MONO = "'Overpass Mono', ui-monospace, monospace"
const UI = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const STUDIO = "'Space Grotesk', system-ui, sans-serif"

function isDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const logos = new Map<boolean, HTMLImageElement>()
/** The studio logo for this mode (the official file, never redrawn), loading in the background. */
function logo(dark: boolean): HTMLImageElement {
  let img = logos.get(dark)
  if (!img) {
    img = new Image()
    img.src = new URL(`./brand/longlight-logo-${dark ? 'dark' : 'light'}.svg`, document.baseURI).href
    logos.set(dark, img)
  }
  return img
}

/** Fonts and the logo, so the card draws right the first time. */
async function prepareCard(): Promise<void> {
  const img = logo(isDark())
  await Promise.all([
    document.fonts?.load(`800 100px ${HEAD}`),
    document.fonts?.load(`700 50px ${HEAD}`),
    document.fonts?.load(`600 30px ${MONO}`),
    document.fonts?.load(`400 24px ${MONO}`),
    document.fonts?.load(`500 20px ${STUDIO}`),
    img.decode().catch(() => {}),
  ])
}

/** How tall the truck's picture is on this store's card. */
function shotHeight(store: BuildStore): number {
  return store.bench()?.log?.() ? SHOT_H_LOG : SHOT_H_FULL
}

/** Draw the card for the store's truck, with `shot` (the 3D truck) if there is one. */
export function drawCard(store: BuildStore, shot: HTMLCanvasElement | null): HTMLCanvasElement {
  const truck = store.truck()
  // The garage's own truck in a career carries its logbook: its record and newest moment.
  const log = store.bench()?.log?.() ?? null
  const shotH = log ? SHOT_H_LOG : SHOT_H_FULL
  const b = truck.build
  const cls = CLASSES.find((c) => c.id === b.cls)!
  const dark = isDark()
  const c = {
    bg: cssVar('--bg', '#f4f1e8'),
    panel: cssVar('--panel-2', '#ece8dc'),
    line: cssVar('--line', '#d4cebf'),
    ink: cssVar('--ink', '#25272b'),
    muted: cssVar('--muted', '#5b5d61'),
    accent: cssVar('--accent', '#ff4fb2'),
    onAccent: cssVar('--on-accent', '#25272b'),
  }
  const card = document.createElement('canvas')
  card.width = W
  card.height = H
  const g = card.getContext('2d')
  if (!g) return card
  g.fillStyle = c.bg
  g.fillRect(0, 0, W, H)
  g.textBaseline = 'alphabetic'

  // The title on its highlighter swipe, like the top of the page.
  g.font = `800 100px ${HEAD}`
  const title = t('game.name').toUpperCase()
  const tw = g.measureText(title).width
  g.fillStyle = c.accent
  g.fillRect(M - 10, 66, tw + 20, 96)
  g.fillStyle = c.onAccent
  g.fillText(title, M, 150)
  // The class and the year, right-aligned.
  g.textAlign = 'right'
  g.fillStyle = c.ink
  g.font = `700 50px ${HEAD}`
  g.fillText(t(cls.name).toUpperCase(), W - M, 112)
  g.font = `600 32px ${MONO}`
  g.fillStyle = c.muted
  g.fillText(String(store.year()), W - M, 154)
  g.textAlign = 'left'

  // A heavy ink rule, then the truck.
  g.fillStyle = c.ink
  g.fillRect(M, 190, W - 2 * M, 4)
  const shotY = 214
  g.fillStyle = c.panel
  g.fillRect(M, shotY, SHOT_W, shotH)
  if (shot) g.drawImage(shot, M, shotY, SHOT_W, shotH)
  g.strokeStyle = c.line
  g.lineWidth = 2
  g.strokeRect(M + 1, shotY + 1, SHOT_W - 2, shotH - 2)

  // Weight and ride height.
  const s = stanceOf(truck)
  const front = Math.round(s.front * 1000)
  const rear = Math.round(s.rear * 1000)
  const ride = front === 0 && rear === 0 ? t('card.rideStock') : tf('card.ride', { front: signedMm(front), rear: signedMm(rear) })
  g.font = `400 26px ${MONO}`
  g.fillStyle = c.ink
  g.fillText(tf('card.weight', { kg: num(truck.mass), min: num(cls.minMass), max: num(cls.maxMass) }), M, shotY + shotH + 44)
  g.fillStyle = c.muted
  g.fillText(ride, M, shotY + shotH + 80)
  let y = shotY + shotH + 108
  if (log) {
    const lines = cardLines(log)
    g.font = `600 26px ${MONO}`
    g.fillStyle = c.ink
    g.fillText(lines.record, M, shotY + shotH + 124, W - 2 * M)
    if (lines.moment) {
      g.font = `italic 400 26px ${UI}`
      g.fillStyle = c.muted
      g.fillText(lines.moment, M, shotY + shotH + 162, W - 2 * M)
    }
    y = shotY + shotH + 188
  }

  // The parts, one roadbook row each.
  const rowH = 54
  for (const slot of CARD_SLOTS) {
    const part = findPart(b.parts[slot])
    g.strokeStyle = c.line
    g.lineWidth = 2
    g.setLineDash([8, 6])
    g.beginPath()
    g.moveTo(M, y)
    g.lineTo(W - M, y)
    g.stroke()
    g.setLineDash([])
    g.font = `600 20px ${UI}`
    g.fillStyle = c.muted
    g.fillText(t(`slot.${slot}` as StringKey).toUpperCase(), M, y + 35)
    g.font = `600 28px ${UI}`
    g.fillStyle = c.ink
    const name = part ? t(part.name) : '—'
    g.fillText(name, M + 290, y + 36, W - 2 * M - 290)
    y += rowH
  }

  // The footer: the address and the studio credit, and the logo.
  g.fillStyle = c.ink
  g.fillRect(M, H - 92, W - 2 * M, 3)
  g.font = `600 24px ${MONO}`
  g.fillStyle = c.ink
  g.fillText(ADDRESS, M, H - 54)
  g.font = `500 20px ${STUDIO}`
  g.fillStyle = c.muted
  g.fillText('© 2026 Kelbo / Longlight Interactive', M, H - 24)
  const img = logo(dark)
  if (img.complete && img.naturalWidth > 0) {
    const lh = 56
    const lw = (lh * 1043) / 336
    g.drawImage(img, W - M - lw, H - 80, lw, lh)
  }
  return card
}

/**
 * The truck card block on the build screen. `garage` gives the build
 * screen's 3D view, loading it if it isn't yet; `garageNow` gives it only
 * if it's ready.
 */
export function truckCardBlock(store: BuildStore, garage: () => Promise<Garage | null>, garageNow: () => Garage | null): HTMLElement {
  const box = el('details', 'share-build truck-card')
  box.append(el('summary', '', t('card.title')), el('p', 'small', t('card.lead')))
  const preview = el('img', 'card-preview')
  preview.width = W
  preview.height = H
  preview.hidden = true
  const share = el('button', 'btn', t('card.share'))
  share.type = 'button'
  share.disabled = true
  const note = el('p', 'small')
  note.setAttribute('aria-live', 'polite')
  const row = el('div', 'btn-row')
  row.append(share)
  box.append(preview, row, note)

  let code = ''
  let shown = 0
  let ready = false

  function describe(): string {
    const cls = CLASSES.find((c) => c.id === store.cls())!
    return tf('card.alt', { cls: t(cls.name).toLowerCase(), year: String(store.year()) })
  }

  function card(): HTMLCanvasElement {
    return drawCard(store, garageNow()?.snapshot(SHOT_W, shotHeight(store)) ?? null)
  }

  /** Redraw the preview (and the build code) for the truck as it stands. */
  async function refresh(): Promise<void> {
    if (!box.open) return
    const mine = ++shown
    note.textContent = ready ? '' : t('card.making')
    await Promise.all([prepareCard(), garage()])
    let next: string
    try {
      next = await encodeBuildCode(store.build())
    } catch {
      next = ''
    }
    if (mine !== shown || !box.open) return
    code = next
    const canvas = card()
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src)
    canvas.toBlob((blob) => {
      if (!blob || mine !== shown) return
      preview.src = URL.createObjectURL(blob)
      preview.alt = describe()
      preview.hidden = false
    }, 'image/png')
    ready = true
    share.disabled = false
    note.textContent = ''
  }

  let timer = 0
  box.addEventListener('toggle', () => void refresh())
  store.onChange(() => {
    if (!box.open) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void refresh(), 400)
  })

  share.addEventListener('click', () => {
    // Drawn again here and now (no waiting), so the share sheet still counts as part of the tap.
    const file = pngFile(card(), pictureName(`truck-${store.cls()}`))
    const cls = CLASSES.find((c) => c.id === store.cls())!
    const text = code ? tf('card.shareText', { cls: t(cls.name).toLowerCase(), code }) : undefined
    void shareFile(file, text).then((r) => {
      note.textContent = r === 'shared' ? t('card.shared') : r === 'downloaded' ? t('card.downloaded') : r === 'failed' ? t('card.failed') : ''
    })
  })
  return box
}
