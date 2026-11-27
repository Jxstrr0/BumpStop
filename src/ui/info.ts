/**
 * The little "i" buttons on the build screen (Kelbo asked, 27 November 2026).
 *
 * Tapping one opens a short note right under it, in the page (not a
 * floating bubble, so nothing covers the slider on a small phone). Tap it
 * again, or press Escape, to close it. Only one note is open at a time:
 * opening another closes the last.
 *
 * The note's words come from `src/data/info.ts`. If the glossary has the
 * word, the note has a "More in the help" button that opens it there.
 */
import type { GlossaryId } from '../data/glossary'
import type { InfoNote } from '../data/info'
import { t, tf } from '../data/strings'
import { el } from './dom'

export type ShowTerm = (id: GlossaryId) => void

interface Open {
  button: HTMLButtonElement
  note: HTMLElement
}

/** The note open right now, anywhere on the page. */
let openNow: Open | null = null
let made = 0

function close(open: Open): void {
  open.button.setAttribute('aria-expanded', 'false')
  open.note.hidden = true
  if (openNow === open) openNow = null
}

/**
 * Make an "i" button and its note. `name` is what the note is about (e.g.
 * "Spring rate"), for screen readers. The caller places both: the button
 * beside the label, the note where it should open.
 */
export function infoButton(name: string, info: InfoNote, showTerm?: ShowTerm): { button: HTMLButtonElement; note: HTMLElement } {
  made += 1
  const id = `info-note-${made}`
  const button = el('button', 'info-btn')
  button.type = 'button'
  button.setAttribute('aria-label', tf('info.about', { thing: name }))
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', id)
  // The round "i" is drawn by CSS inside a 44 px tap area.
  button.append(el('span', 'info-dot', 'i'))

  const note = el('div', 'info-note')
  note.id = id
  note.hidden = true
  note.append(el('p', '', t(info.text)))
  if (info.term && showTerm) {
    const term = info.term
    const more = el('button', 'btn small-btn', t('info.more'))
    more.type = 'button'
    more.addEventListener('click', () => showTerm(term))
    note.append(more)
  }

  const self: Open = { button, note }
  button.addEventListener('click', (event) => {
    // Inside a part slot's heading, a tap on the "i" shouldn't fold the slot shut (or open).
    event.preventDefault()
    if (openNow === self) {
      close(self)
      return
    }
    if (openNow) close(openNow)
    openNow = self
    button.setAttribute('aria-expanded', 'true')
    note.hidden = false
    // A note inside a shut part slot needs the slot open to be seen. Opened a
    // moment later, so the slot's own tap handler (`oneOpenAtATime`) sees the
    // tap first and keeps the heading under the thumb as other slots fold.
    const slot = note.closest('details')
    if (slot && !slot.open) setTimeout(() => (slot.open = true), 0)
  })
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || openNow !== self) return
    close(self)
    button.focus()
  }
  button.addEventListener('keydown', escape)
  note.addEventListener('keydown', escape)
  return { button, note }
}
