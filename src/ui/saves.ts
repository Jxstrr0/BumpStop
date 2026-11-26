/**
 * The saves screens (plan PR 8):
 *
 * - `savesPanel`: the three garage slots, how the last save went, whether
 *   the browser promised to keep our storage, backups (copy a save code,
 *   save a backup file) and loading a garage from a code or a file.
 * - `backupReminder`: a quiet bar at the top of the page when there's
 *   progress and no backup in 14 days (`src/persist/safety.ts`).
 * - `shareBuildBlock`: copy this truck's build code, or paste one in, on
 *   the build screen.
 *
 * Anything that throws something away (delete a slot, load over one) needs
 * a second tap within three seconds.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { t, tf, type StringKey } from '../data/strings'
import { decodeBuildCode, decodeSaveCode, encodeBuildCode, encodeSaveCode, SaveCodeError } from '../persist/code'
import {
  backupAgeDays, backupReminderDue, lastBackupAt, markBackedUp, readBackupFile, saveBackupFile, storageProtected,
} from '../persist/safety'
import { hasProgress } from '../persist/save'
import { clearSlotPhotos } from '../persist/album'
import { deleteSlot, slotSummary, type SlotView } from '../persist/slots'
import type { BuildStore } from './buildStore'
import { el } from './dom'
import type { Garage, SaveStatus } from './garage'

const className = (cls: ClassId) => t(CLASSES.find((c) => c.id === cls)!.name)

export function button(text: string, cls = 'btn small-btn'): HTMLButtonElement {
  const b = el('button', cls, text)
  b.type = 'button'
  return b
}

/** A button that needs a second tap within three seconds, showing `sure` in between. */
function twoTap(text: string, sure: string, action: () => void, cls = 'btn small-btn'): HTMLButtonElement {
  const b = button(text, cls)
  let armed = false
  let disarm = 0
  b.addEventListener('click', () => {
    if (armed) {
      window.clearTimeout(disarm)
      armed = false
      b.textContent = text
      action()
      return
    }
    armed = true
    b.textContent = sure
    disarm = window.setTimeout(() => {
      armed = false
      b.textContent = text
    }, 3000)
  })
  return b
}

/** "just now", "5 min ago", "3 h ago" or "on 2026-11-20". */
function whenText(at: number, now = Date.now()): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000)
  if (min < 1) return t('saves.when.now')
  if (min < 60) return tf('saves.when.min', { n: String(min) })
  if (min < 24 * 60) return tf('saves.when.hours', { n: String(Math.floor(min / 60)) })
  return tf('saves.when.date', { date: new Date(at).toLocaleDateString('en-CA') })
}

function backupText(last: number | null): string {
  const days = backupAgeDays(last, Date.now())
  const when = days === null ? t('saves.backup.never') : days === 0 ? t('saves.backup.today') : days === 1 ? t('saves.backup.yesterday') : tf('saves.backup.days', { n: String(days) })
  return tf('saves.lastBackup', { when })
}

/** Copy text to the clipboard. False if the browser won't (then the player copies it from the box by hand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** A read-only box showing a code, selected when tapped so it's easy to copy by hand. */
export function codeBox(label: string, id: string): { wrap: HTMLElement; box: HTMLTextAreaElement } {
  const wrap = el('div', 'code-wrap')
  const lab = el('label', 'setting-label', label)
  const box = el('textarea', 'code-box')
  box.id = id
  lab.htmlFor = id
  box.readOnly = true
  box.rows = 3
  box.spellcheck = false
  box.addEventListener('focus', () => box.select())
  wrap.append(lab, box)
  wrap.hidden = true
  return { wrap, box }
}

/** An input box for pasting a code. */
export function pasteBox(label: string, id: string): { wrap: HTMLElement; box: HTMLTextAreaElement } {
  const wrap = el('div', 'code-wrap')
  const lab = el('label', 'setting-label', label)
  const box = el('textarea', 'code-box')
  box.id = id
  lab.htmlFor = id
  box.rows = 3
  box.spellcheck = false
  box.autocapitalize = 'off'
  box.setAttribute('autocomplete', 'off')
  wrap.append(lab, box)
  return { wrap, box }
}

export function errorText(err: unknown): string {
  return err instanceof SaveCodeError ? t(err.key) : t('code.notValid')
}

// ── The slots ──

function slotCard(view: SlotView, garage: Garage, onDeleted: () => void): HTMLElement {
  const card = el('li', 'slot-card')
  const here = view.slot === garage.slot
  if (here) card.classList.add('here')
  const head = el('p', 'slot-card-head')
  head.append(el('strong', '', tf('saves.slot', { n: String(view.slot) })))
  if (here) head.append(' ', el('span', 'chip cool', t('saves.here')))
  card.append(head)

  // The open slot shows what's in the garage now; the others show what was saved.
  const save = here ? garage.current() : view.save
  if (view.damaged) {
    card.append(el('p', 'small hot-text', t('saves.damaged')))
  } else if (save && (!view.empty || (here && hasProgress(save)))) {
    const sum = slotSummary(save)
    card.append(el('p', 'slot-line', tf('saves.line', { cls: className(sum.cls), year: String(sum.year) })))
    if (sum.raid) {
      const raid = t(sum.raid.name)
      card.append(el('p', 'small', sum.raid.done ? tf('saves.raidDone', { raid }) : tf('saves.raidLine', { raid, n: String(sum.raid.stage + 1), total: String(sum.raid.stages) })))
    }
    if (!here && view.savedAt > 0) card.append(el('p', 'small', tf('saves.savedAgo', { when: whenText(view.savedAt) })))
  } else {
    card.append(el('p', 'small', t('saves.empty')))
  }

  const row = el('div', 'btn-row slot-buttons')
  if (!here) {
    const open = button(view.empty ? t('saves.start') : t('saves.open'))
    open.addEventListener('click', () => void garage.open(view.slot))
    if (!view.damaged) row.append(open)
  }
  if (!view.empty) {
    row.append(
      twoTap(t('saves.delete'), t('saves.deleteSure'), () => {
        void (async () => {
          if (here) garage.stop()
          await deleteSlot(view.slot)
          // The slot's career photos go with it.
          await clearSlotPhotos(view.slot)
          // Deleting the open slot starts a fresh garage in it.
          if (here) location.reload()
          else onDeleted()
        })()
      }),
    )
  }
  if (row.childElementCount) card.append(row)
  return card
}

export function savesPanel(garage: Garage): HTMLElement {
  const box = el('section', 'panel saves')
  box.id = 'saves'
  box.append(el('h2', '', t('saves.title')), el('p', 'lead', t('saves.lead')))

  // Slots.
  const views = garage.slots.map((v) => ({ ...v }))
  const list = el('ul', 'slot-list')
  function drawSlots(): void {
    list.replaceChildren(
      ...views.map((v) =>
        slotCard(v, garage, () => {
          views[v.slot - 1] = { slot: v.slot, empty: true, damaged: false, savedAt: 0, save: null }
          drawSlots()
        }),
      ),
    )
  }

  // How the last save went.
  const statusLine = el('p', 'small save-status')
  statusLine.setAttribute('aria-live', 'polite')
  function drawStatus(s: SaveStatus): void {
    statusLine.className = `small save-status${s.kind === 'failed' || s.kind === 'readOnly' ? ' hot-text' : ''}`
    statusLine.textContent =
      s.kind === 'saved' ? tf('saves.status.saved', { when: whenText(s.at) })
      : s.kind === 'failed' ? t('saves.status.failed')
      : s.kind === 'readOnly' ? tf('saves.status.readOnly', { n: String(garage.slot) })
      : t('saves.status.idle')
  }
  garage.onStatus((s) => {
    drawStatus(s)
    drawSlots()
  })
  // Keep "saved 2 min ago" honest while the page stays open.
  window.setInterval(() => drawStatus(garage.status()), 60_000)

  const keptLine = el('p', 'small')
  async function drawKept(): Promise<void> {
    const kept = await storageProtected()
    keptLine.className = kept === false ? 'small warm-text' : 'small'
    keptLine.textContent = kept === true ? t('saves.kept') : kept === false ? t('saves.mayClear') : t('saves.keptUnknown')
  }

  // Backups.
  const backupLine = el('p', 'small')
  const drawBackup = () => (backupLine.textContent = backupText(lastBackupAt()))
  const backupNote = el('p', 'small')
  backupNote.setAttribute('aria-live', 'polite')
  const code = codeBox(t('saves.codeLabel'), 'save-code-out')
  const copy = button(t('saves.copy'), 'btn')
  copy.id = 'save-copy'
  copy.addEventListener('click', () => {
    void (async () => {
      copy.disabled = true
      const text = await encodeSaveCode(garage.current())
      code.box.value = text
      code.wrap.hidden = false
      const ok = await copyText(text)
      if (ok) markBackedUp()
      backupNote.textContent = ok ? t('saves.copied') : t('saves.copyFailed')
      if (!ok) code.box.focus()
      drawBackup()
      copy.disabled = false
    })()
  })
  const file = button(t('saves.file'), 'btn')
  file.addEventListener('click', () => {
    void (async () => {
      file.disabled = true
      const result = await saveBackupFile(await encodeSaveCode(garage.current()))
      if (result === 'shared' || result === 'downloaded') markBackedUp()
      backupNote.textContent = t(`saves.file.${result}` as StringKey)
      drawBackup()
      file.disabled = false
    })()
  })
  const backupRow = el('div', 'btn-row')
  backupRow.append(copy, file)

  // Loading a garage.
  const n = String(garage.slot)
  const paste = pasteBox(t('saves.pasteLabel'), 'save-code-in')
  const loadNote = el('p', 'small')
  loadNote.setAttribute('aria-live', 'polite')
  async function loadText(text: string): Promise<void> {
    loadNote.className = 'small'
    loadNote.textContent = t('saves.checking')
    try {
      const save = await decodeSaveCode(text)
      if (!(await garage.replace(save))) {
        loadNote.className = 'small hot-text'
        loadNote.textContent = tf('saves.loadFailed', { n })
      }
    } catch (err) {
      loadNote.className = 'small hot-text'
      loadNote.textContent = errorText(err)
    }
  }
  const load = twoTap(tf('saves.load', { n }), tf('saves.loadSure', { n }), () => void loadText(paste.box.value), 'btn')
  const fileInput = el('input')
  fileInput.type = 'file'
  fileInput.accept = '.txt,text/plain'
  fileInput.className = 'visually-hidden'
  fileInput.id = 'save-file-in'
  fileInput.tabIndex = -1
  const fromFile = button(t('saves.loadFile'), 'btn')
  fromFile.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    fileInput.value = ''
    if (!f) return
    void (async () => {
      const text = await readBackupFile(f)
      if (text === null) {
        loadNote.className = 'small hot-text'
        loadNote.textContent = t('saves.fileTooBig')
        return
      }
      // Show what was in the file and let the player confirm with the Load button.
      paste.box.value = text
      loadNote.className = 'small'
      loadNote.textContent = tf('saves.fileRead', { n })
      load.focus()
    })()
  })
  const loadRow = el('div', 'btn-row')
  loadRow.append(load, fromFile, fileInput)

  box.append(
    list, statusLine, keptLine,
    el('h3', 'saves-sub', t('saves.backupTitle')), el('p', 'small', t('saves.backupLead')), backupLine, backupRow, backupNote, code.wrap,
    el('h3', 'saves-sub', t('saves.loadTitle')), el('p', 'small', tf('saves.loadLead', { n })), paste.wrap, loadRow, loadNote,
  )
  drawSlots()
  drawStatus(garage.status())
  drawBackup()
  void drawKept()
  return box
}

// ── The reminder ──

/** The quiet bar at the top of the page, or null when no backup is due. */
export function backupReminder(garage: Garage): HTMLElement | null {
  const last = lastBackupAt()
  if (!backupReminderDue(hasProgress(garage.current()), last, Date.now())) return null
  const bar = el('aside', 'save-banner')
  bar.setAttribute('aria-label', t('remind.label'))
  const days = backupAgeDays(last, Date.now())
  bar.append(el('p', '', days === null ? t('remind.never') : tf('remind.days', { n: String(days) })))
  const row = el('div', 'btn-row')
  const now = button(t('remind.now'), 'btn')
  now.addEventListener('click', () => {
    bar.remove()
    const copy = document.getElementById('save-copy')
    copy?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
    copy?.focus({ preventScroll: true })
  })
  const later = button(t('remind.later'), 'btn')
  later.addEventListener('click', () => bar.remove())
  row.append(now, later)
  bar.append(row)
  return bar
}

// ── Sharing a build ──

export function shareBuildBlock(store: BuildStore): HTMLElement {
  const box = el('details', 'share-build')
  box.append(el('summary', '', t('share.title')), el('p', 'small', t('share.lead')))
  const note = el('p', 'small')
  note.setAttribute('aria-live', 'polite')
  const out = codeBox(t('share.codeLabel'), 'build-code-out')
  const copy = button(t('share.copy'), 'btn')
  copy.addEventListener('click', () => {
    void (async () => {
      const text = await encodeBuildCode(store.build())
      out.box.value = text
      out.wrap.hidden = false
      const ok = await copyText(text)
      note.className = 'small'
      note.textContent = ok ? t('share.copied') : t('saves.copyFailed')
      if (!ok) out.box.focus()
    })()
  })
  const paste = pasteBox(t('share.pasteLabel'), 'build-code-in')
  const load = button(t('share.load'), 'btn')
  load.addEventListener('click', () => {
    void (async () => {
      try {
        const b = await decodeBuildCode(paste.box.value)
        store.setClass(b.cls)
        store.setBuild(b, 'part')
        paste.box.value = ''
        note.className = 'small'
        note.textContent = tf('share.loaded', { cls: className(b.cls).toLowerCase() })
      } catch (err) {
        note.className = 'small hot-text'
        note.textContent = errorText(err)
      }
    })()
  })
  const row = el('div', 'btn-row')
  row.append(copy)
  const loadRow = el('div', 'btn-row')
  loadRow.append(load)
  box.append(row, out.wrap, paste.wrap, el('p', 'small', t('share.replaces')), loadRow, note)
  return box
}
