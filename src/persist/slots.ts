/**
 * The three garage slots on this device (plan PR 8).
 *
 * Each slot is one record, `{ slot, savedAt, data }`, in the IndexedDB
 * database `bumpstop` (object store `slots`, keyed by the slot number). If
 * IndexedDB won't open (some private windows), the same records go to
 * localStorage as `bumpstop.slot.1` to `.3` instead. Which slot is in the
 * garage now is `bumpstop.activeSlot`.
 *
 * `data` is stored as the game saved it and only trusted after `readSave`,
 * so a damaged slot shows as damaged (with Delete) instead of breaking the
 * page. Nothing here throws to callers: storage that's blocked or full
 * reads as empty and a failed write returns false.
 *
 * Bump Stop has its own address (bumpstop.longlight.games), so no other
 * game can see these; still, every key starts `bumpstop.` and nothing here
 * ever clears anything else.
 */
import { CLASSES, type ClassId } from '../data/classes'
import { RAIDS } from '../data/raids'
import { hasProgress, readSave, type GarageSave } from './save'

export type SlotNo = 1 | 2 | 3
export const SLOT_NUMBERS: readonly SlotNo[] = [1, 2, 3]
export const isSlotNo = (v: unknown): v is SlotNo => v === 1 || v === 2 || v === 3

const DB_NAME = 'bumpstop'
/** 2 adds the career photo album's store (`album.ts`). */
const DB_VERSION = 2
const STORE = 'slots'
/** The career photo albums (`album.ts`): one record a photo, numbered by the database. */
export const ALBUM_STORE = 'album'
const LOCAL_SLOT = (n: SlotNo) => `bumpstop.slot.${n}`
const ACTIVE_KEY = 'bumpstop.activeSlot'

export interface SlotRecord {
  slot: SlotNo
  /** Real time of the last save (ms since 1970). */
  savedAt: number
  data: unknown
}

/** What a slot card shows. */
export interface SlotView {
  slot: SlotNo
  /** Nothing saved here yet. */
  empty: boolean
  /** Something is here but it can't be read: only Delete is offered. */
  damaged: boolean
  savedAt: number
  /** The save, when it reads. */
  save: GarageSave | null
}

// ── Where the records live ──

export interface SlotStore {
  read(slot: SlotNo): Promise<SlotRecord | null>
  write(rec: SlotRecord): Promise<boolean>
  remove(slot: SlotNo): Promise<boolean>
}

function warn(what: string, err: unknown): void {
  console.warn(`Bump Stop: ${what} failed`, err)
}

/** IndexedDB as a promise. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null

/** The game's own database (also used by the photo album). Rejects if IndexedDB won't open. */
export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'slot' })
        if (!req.result.objectStoreNames.contains(ALBUM_STORE)) req.result.createObjectStore(ALBUM_STORE, { keyPath: 'id', autoIncrement: true })
      }
      req.onsuccess = () => {
        const db = req.result
        // Another tab wants a newer version: let go so it can.
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('blocked by another tab'))
    })
    dbPromise = opening
    // A failed open isn't kept, so the next save tries again.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null
    })
  }
  return dbPromise
}

const idbStore: SlotStore = {
  async read(slot) {
    const db = await openDb()
    const rec = await request(db.transaction(STORE).objectStore(STORE).get(slot))
    return (rec as SlotRecord | undefined) ?? null
  },
  async write(rec) {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(rec)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return true
  },
  async remove(slot) {
    const db = await openDb()
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(slot))
    return true
  },
}

/** localStorage, for when IndexedDB won't open. `storage` is swappable for the tests. */
export function localStore(storage: Storage): SlotStore {
  return {
    async read(slot) {
      const text = storage.getItem(LOCAL_SLOT(slot))
      if (text === null) return null
      try {
        return JSON.parse(text) as SlotRecord
      } catch {
        // Unreadable text still occupies the slot, so it shows as damaged rather than vanishing.
        return { slot, savedAt: 0, data: null }
      }
    },
    async write(rec) {
      storage.setItem(LOCAL_SLOT(rec.slot), JSON.stringify(rec))
      return true
    },
    async remove(slot) {
      storage.removeItem(LOCAL_SLOT(slot))
      return true
    },
  }
}

let chosen: Promise<SlotStore> | null = null

/** IndexedDB if it opens, else localStorage. Picked once per page load. */
function store(): Promise<SlotStore> {
  chosen ??= (async () => {
    try {
      if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB')
      await openDb()
      return idbStore
    } catch (err) {
      warn('opening the save database', err)
      return localStore(localStorage)
    }
  })()
  return chosen
}

// ── Reading and writing slots ──

/** Turn a stored record (or nothing) into what a slot card shows. Pure. */
export function viewOf(slot: SlotNo, rec: SlotRecord | null): SlotView {
  if (!rec) return { slot, empty: true, damaged: false, savedAt: 0, save: null }
  try {
    return { slot, empty: false, damaged: false, savedAt: rec.savedAt, save: readSave(rec.data) }
  } catch {
    return { slot, empty: false, damaged: true, savedAt: rec.savedAt, save: null }
  }
}

/** All three slots, read and checked. */
export async function listSlots(s?: SlotStore): Promise<SlotView[]> {
  const st = s ?? (await store())
  return Promise.all(
    SLOT_NUMBERS.map(async (n) => {
      try {
        return viewOf(n, await st.read(n))
      } catch (err) {
        warn(`reading slot ${n}`, err)
        return viewOf(n, null)
      }
    }),
  )
}

/** Save the garage into a slot. False if storage refused (full, blocked). */
export async function writeSlot(slot: SlotNo, save: GarageSave, now = Date.now(), s?: SlotStore): Promise<boolean> {
  try {
    return await (s ?? (await store())).write({ slot, savedAt: now, data: save })
  } catch (err) {
    warn(`saving slot ${slot}`, err)
    return false
  }
}

export async function deleteSlot(slot: SlotNo, s?: SlotStore): Promise<boolean> {
  try {
    return await (s ?? (await store())).remove(slot)
  } catch (err) {
    warn(`deleting slot ${slot}`, err)
    return false
  }
}

/** The slot in the garage now (1 if never picked or unreadable). */
export function activeSlot(): SlotNo {
  try {
    const n = Number(localStorage.getItem(ACTIVE_KEY))
    return isSlotNo(n) ? n : 1
  } catch {
    return 1
  }
}

export function setActiveSlot(slot: SlotNo): void {
  try {
    localStorage.setItem(ACTIVE_KEY, String(slot))
  } catch {
    // storage blocked: slot 1 next time
  }
}

// ── What a slot card says ──

/** The class name key, raid name key and progress, for a slot card. Pure. */
export function slotSummary(save: GarageSave): {
  cls: ClassId
  year: number
  raid: { name: (typeof RAIDS)[keyof typeof RAIDS]['name']; stage: number; stages: number; done: boolean } | null
  progress: boolean
} {
  const raid = save.raid
  return {
    cls: save.cls,
    year: save.year,
    raid: raid
      ? { name: RAIDS[raid.entry.raid].name, stage: raid.stage, stages: RAIDS[raid.entry.raid].stages.length, done: raid.phase === 'done' }
      : null,
    progress: hasProgress(save),
  }
}

/** The class's display-name key. */
export const classNameKey = (cls: ClassId) => CLASSES.find((c) => c.id === cls)!.name

