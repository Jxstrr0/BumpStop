/**
 * The career's photo album (after 1.2): photos kept from photo mode during
 * a career, shown in the hall of fame at the end.
 *
 * Each photo is one record in the `album` store of the game's IndexedDB
 * database `bumpstop` (next to the save slots): the picture as a JPEG, the
 * slot and career it belongs to, and a caption. A career is known by its
 * seed, so starting a new career in the same slot starts a new album.
 *
 * Photos are too big for localStorage, so without IndexedDB (some private
 * windows) there's no album and the keep button says so. Nothing here
 * throws to callers: a refusal reads as empty or returns 'failed'.
 *
 * Every photo is the player's own and stays on this phone: the album is
 * never in save codes or backups.
 */
import { HALL } from '../data/career'
import { ALBUM_STORE, openDb, request, type SlotNo } from './slots'

export interface AlbumPhoto {
  /** Given by the database. */
  id?: number
  slot: SlotNo
  /** The career's seed: whose album it is. */
  career: number
  /** The career's year when it was taken, for sorting and the caption. */
  year: number
  /** Where it was taken, in words ("Washboard 800, 1991"). */
  caption: string
  /** Real time it was kept (ms since 1970). */
  takenAt: number
  picture: Blob
}

export type KeepResult = 'kept' | 'full' | 'failed'

/** Where album photos live. Swappable for the tests. */
export interface AlbumStore {
  all(): Promise<AlbumPhoto[]>
  add(photo: AlbumPhoto): Promise<number>
  remove(id: number): Promise<void>
}

const idbAlbum: AlbumStore = {
  async all() {
    const db = await openDb()
    return (await request(db.transaction(ALBUM_STORE).objectStore(ALBUM_STORE).getAll())) as AlbumPhoto[]
  },
  async add(photo) {
    const db = await openDb()
    return (await request(db.transaction(ALBUM_STORE, 'readwrite').objectStore(ALBUM_STORE).add(photo))) as number
  },
  async remove(id) {
    const db = await openDb()
    await request(db.transaction(ALBUM_STORE, 'readwrite').objectStore(ALBUM_STORE).delete(id))
  },
}

/** An album kept in memory: for the tests. */
export function memoryAlbum(): AlbumStore {
  const photos: AlbumPhoto[] = []
  let next = 1
  return {
    async all() {
      return photos.map((p) => ({ ...p }))
    },
    async add(photo) {
      const id = next++
      photos.push({ ...photo, id })
      return id
    },
    async remove(id) {
      const at = photos.findIndex((p) => p.id === id)
      if (at >= 0) photos.splice(at, 1)
    },
  }
}

function warn(what: string, err: unknown): void {
  console.warn(`Bump Stop: ${what} failed`, err)
}

/** Is there anywhere to keep photos on this device? */
export function albumWorks(): boolean {
  return typeof indexedDB !== 'undefined'
}

/** One career's photos, oldest first. */
export async function careerPhotos(slot: SlotNo, career: number, store: AlbumStore = idbAlbum): Promise<AlbumPhoto[]> {
  try {
    const all = await store.all()
    return all.filter((p) => p.slot === slot && p.career === career).sort((a, b) => a.year - b.year || a.takenAt - b.takenAt)
  } catch (err) {
    warn('reading the album', err)
    return []
  }
}

/** Keep a photo in a career's album, unless it's full (`HALL.albumMax`). */
export async function keepPhoto(photo: AlbumPhoto, store: AlbumStore = idbAlbum): Promise<KeepResult> {
  try {
    const have = await careerPhotos(photo.slot, photo.career, store)
    if (have.length >= HALL.albumMax) return 'full'
    await store.add(photo)
    return 'kept'
  } catch (err) {
    warn('keeping a photo', err)
    return 'failed'
  }
}

export async function removePhoto(id: number, store: AlbumStore = idbAlbum): Promise<boolean> {
  try {
    await store.remove(id)
    return true
  } catch (err) {
    warn('removing a photo', err)
    return false
  }
}

/**
 * Take a slot's photos out (the slot is being deleted or loaded over):
 * every photo in that slot, any career. Only ever touches the album.
 */
export async function clearSlotPhotos(slot: SlotNo, store: AlbumStore = idbAlbum): Promise<void> {
  try {
    const all = await store.all()
    for (const p of all) if (p.slot === slot && p.id !== undefined) await store.remove(p.id)
  } catch (err) {
    warn('clearing the album', err)
  }
}
