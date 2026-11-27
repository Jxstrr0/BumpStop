/**
 * The bottom tabs (Kelbo asked, 26 November 2026): the game's panels used to
 * sit in one long page, so getting from the career to the rigs meant a long
 * scroll. Now a bar along the bottom of the screen, like a phone app's, shows
 * one area at a time:
 *
 *   Career  the loop, the career (and the backup reminder)
 *   Build   the build screen
 *   Test    the shop's rigs and the report
 *   Raid    the raids
 *   More    help, saves and backups, settings
 *
 * Each tab keeps its own scroll spot, and tapping the tab you're on goes back
 * to its top. Jumps from one area to another (a report's "where to fix it",
 * the guide's "Show me", a word in the glossary) switch tabs by themselves
 * through `reveal` in `dom.ts`. The phone remembers the last tab.
 */
import { t, type StringKey } from '../data/strings'
import { el, setTabFinder, svg } from './dom'

export const TAB_IDS = ['career', 'build', 'test', 'raid', 'more'] as const
export type TabId = (typeof TAB_IDS)[number]

const TAB_KEY = 'bumpstop.tab'

/** The tab to open on: the one from last time, or the career for a new player. */
export function readTab(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): TabId {
  try {
    const saved = storage?.getItem(TAB_KEY)
    return (TAB_IDS as readonly string[]).includes(saved ?? '') ? (saved as TabId) : 'career'
  } catch {
    return 'career'
  }
}

export function writeTab(id: TabId, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(TAB_KEY, id)
  } catch {
    // Nowhere to keep it; the game opens on the career next time.
  }
}

/**
 * The little drawings above each label, 24 × 24 in pencil strokes (they take
 * the text colour). Each is a list of SVG path outlines.
 */
const ICONS: Record<TabId, string[]> = {
  // A chequered flag on its pole.
  career: ['M5 21V4', 'M5 4h13l-2.5 4.5L18 13H5', 'M9 4v9M13 4v9'],
  // A spanner.
  build: ['M13.5 10.5L5 19', 'M13.5 10.5a5 5 0 0 1 6.2-6.7l-3.2 3.2.4 2.4 2.4.4 3.2-3.2a5 5 0 0 1-6.7 6.2'],
  // A trace climbing through a gauge's bands.
  test: ['M3 19h18', 'M3 15c3 0 3-6 6-6s3 8 6 8 3-10 6-10', 'M3 11h4M17 5h4'],
  // A roadbook tulip: a dot where you come in, the road straight on, and the arrow you take.
  raid: ['M10.5 20a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0', 'M12 18.5V4', 'M12 12l6-5.5', 'M14.5 6.5H18V10'],
  // Three dots.
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
}

function icon(id: TabId): SVGSVGElement {
  const pic = svg('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true', class: 'tab-icon' })
  for (const d of ICONS[id]) pic.append(svg('path', { d }))
  return pic
}

export interface Tabs {
  /** The bar itself, to add after the pages. */
  bar: HTMLElement
  /** Bring a tab on screen. */
  show(id: TabId): void
}

/**
 * Turn the game's areas into tabs. `pages` maps each tab to the elements it
 * holds, in order; they're moved into one page box per tab inside `app`.
 */
export function makeTabs(app: HTMLElement, pages: Record<TabId, HTMLElement[]>): Tabs {
  const bar = el('nav', 'tabs')
  bar.setAttribute('aria-label', t('tabs.label'))
  const list = el('div', 'tab-list')
  list.setAttribute('role', 'tablist')
  bar.append(list)

  const boxes = new Map<TabId, HTMLElement>()
  const buttons = new Map<TabId, HTMLButtonElement>()
  /** Where each tab was scrolled to when the player left it. */
  const scrolled = new Map<TabId, number>()
  let current: TabId | null = null

  for (const id of TAB_IDS) {
    const page = el('div', 'tab-page')
    page.id = `tab-${id}`
    page.setAttribute('role', 'tabpanel')
    page.setAttribute('aria-labelledby', `tab-btn-${id}`)
    page.hidden = true
    page.append(...pages[id])
    app.append(page)
    boxes.set(id, page)

    const b = el('button', 'tab-btn')
    b.type = 'button'
    b.id = `tab-btn-${id}`
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-controls', page.id)
    b.append(icon(id), el('span', 'tab-label', t(`tabs.${id}` as StringKey)))
    b.addEventListener('click', () => {
      // Tapping the tab you're already on goes back to its top, like phone apps do.
      if (current === id) window.scrollTo({ top: 0, behavior: smooth() })
      else show(id)
    })
    list.append(b)
    buttons.set(id, b)
  }

  // Arrow keys move between tabs for anyone using a keyboard.
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const at = TAB_IDS.indexOf(current ?? 'career')
    const next = TAB_IDS[(at + (e.key === 'ArrowRight' ? 1 : TAB_IDS.length - 1)) % TAB_IDS.length]!
    show(next)
    buttons.get(next)?.focus()
    e.preventDefault()
  })

  function show(id: TabId): void {
    if (id === current) return
    if (current) scrolled.set(current, window.scrollY)
    for (const [key, page] of boxes) page.hidden = key !== id
    for (const [key, b] of buttons) {
      const on = key === id
      b.setAttribute('aria-selected', String(on))
      // Only the open tab is a Tab-key stop; the arrow keys reach the others.
      b.tabIndex = on ? 0 : -1
    }
    current = id
    writeTab(id)
    // Back where the player left this tab (the top the first time).
    window.scrollTo(0, scrolled.get(id) ?? 0)
  }

  // Jumps from one area to another bring the right tab up first.
  setTabFinder((node) => {
    for (const [id, page] of boxes) {
      if (page.contains(node)) {
        show(id)
        return
      }
    }
  })

  show(readTab())
  return { bar, show }
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}
