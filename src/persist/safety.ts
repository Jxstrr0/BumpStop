// Adapted from Lombard src/persist/safety.ts (26 November 2026)
/**
 * Save safety in the browser (plan PR 8): ask it to keep our storage,
 * remember when the player last made a backup, and write and read backup
 * files.
 *
 * Bump Stop has its own address (bumpstop.longlight.games), but the browser
 * can still wipe its storage when the phone runs low, or after weeks
 * unopened on an iPhone. A save code (or a backup file holding one) is the
 * way back.
 *
 * Nothing here throws to callers. Missing APIs (old browsers, Node in the
 * tests) read as "can't tell" and are skipped quietly.
 */
import { SAVE } from '../data/save'

/** When the last backup was made (ms since 1970). Per device, like the sound switch. */
const LAST_BACKUP_KEY = 'bumpstop.lastBackup'
const DAY_MS = 24 * 60 * 60 * 1000

// ── Keeping storage ──

type StorageApi = { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }

function storageApi(): StorageApi | null {
  try {
    const s = (globalThis.navigator as { storage?: StorageApi } | undefined)?.storage
    return s && typeof s.persisted === 'function' ? s : null
  } catch {
    return null
  }
}

/** true = the browser promised to keep our storage, false = it may clear it, null = can't tell. */
export async function storageProtected(): Promise<boolean | null> {
  const s = storageApi()
  if (!s?.persisted) return null
  try {
    return await s.persisted()
  } catch {
    return null
  }
}

let asked = false

/**
 * Ask the browser to keep this site's storage, at most once per page load.
 * Call it only once there's progress worth keeping (Firefox shows a
 * question; Chrome and Safari decide quietly). Resolves to the answer, or null.
 */
export async function keepStorage(): Promise<boolean | null> {
  const s = storageApi()
  if (!s?.persist) return null
  try {
    if (await s.persisted?.()) return true
    if (asked) return false
    asked = true
    return await s.persist()
  } catch {
    return null
  }
}

// ── The last backup ──

/** When the player last copied a save code or saved a backup file, or null if never (or can't tell). */
export function lastBackupAt(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_BACKUP_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function markBackedUp(now = Date.now()): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(now))
  } catch {
    // storage blocked: the reminder may show again next time
  }
}

/** Pure: should the backup reminder show? Only with real progress, and never backed up or too long ago. */
export function backupReminderDue(progress: boolean, last: number | null, now: number): boolean {
  if (!progress) return false
  if (last === null) return true
  return now - last >= SAVE.backupReminderDays * DAY_MS
}

/** Pure: whole days since the last backup (0 = today), or null for never. */
export function backupAgeDays(last: number | null, now: number): number | null {
  return last === null ? null : Math.floor(Math.max(0, now - last) / DAY_MS)
}

// ── Backup files ──

/** `bump-stop-backup-YYYY-MM-DD.txt`, in the player's own date. */
export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `bump-stop-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.txt`
}

export type FileResult = 'shared' | 'downloaded' | 'cancelled' | 'failed'

/**
 * Hand the player a text file holding `text`: the share sheet first (on an
 * iPhone it offers "Save to Files", and works from the Home Screen), else a
 * download.
 */
export async function saveBackupFile(text: string, name = backupFileName()): Promise<FileResult> {
  const body = `${text}\n`
  try {
    const file = new File([body], name, { type: 'text/plain' })
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return 'shared'
      } catch (err) {
        // The player closed the share sheet: not saved, and nothing to report.
        if ((err as { name?: string })?.name === 'AbortError') return 'cancelled'
        // Anything else (not allowed here, say): fall through to a download.
      }
    }
  } catch {
    // No File or share support: try a download.
  }
  try {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Give the browser a moment to start the download before letting go of the data.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}

/** The text of a chosen backup file, trimmed. Null for a file far too big to hold a code. */
export async function readBackupFile(file: File): Promise<string | null> {
  // A code is plain ASCII, so its size in bytes is its length; allow a little for line breaks.
  if (file.size > SAVE.maxCodeChars + 1024) return null
  return (await file.text()).trim()
}
