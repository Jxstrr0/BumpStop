/**
 * The way from photo mode to the career's album (after 1.2).
 *
 * Photo mode sits deep inside the test track and the raid views, which
 * know nothing about careers. So the career panel registers a hook here
 * when a career is open in this slot, and photo mode asks it two things:
 * what to call a photo taken now (null: no career, so no keep button),
 * and to keep one. The album itself is `src/persist/album.ts`; the hall of
 * fame shows it (`src/ui/hall.ts`).
 */
import { HALL } from '../data/career'
import type { KeepResult } from '../persist/album'

/** Where photo mode is: the test track (rigs) or a raid's highlights. */
export type PhotoPlace = 'track' | 'raid'

export interface AlbumHook {
  /** The caption for a photo taken here now, or null when there's no career album to keep it in. */
  caption(where: PhotoPlace): string | null
  keep(picture: Blob, caption: string): Promise<KeepResult>
}

let hook: AlbumHook | null = null

export function setAlbumHook(h: AlbumHook | null): void {
  hook = h
}

export function albumHook(): AlbumHook | null {
  return hook
}

/** A photo as a JPEG for the album (much smaller than the PNG that gets shared). */
export function albumPicture(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', HALL.albumQuality)
    } catch {
      resolve(null)
    }
  })
}
