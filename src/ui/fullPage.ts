/**
 * Whether the test track runs full page (Kelbo asked, 27 November 2026) or
 * in the page with the traces under it. Full page unless the player picked
 * the traces; the phone remembers, like the last tab.
 */
const FULL_KEY = 'bumpstop.trackFull'

export function readFullPage(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(FULL_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeFullPage(on: boolean, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(FULL_KEY, on ? '1' : '0')
  } catch {
    // Nowhere to keep it; the next visit starts full page again.
  }
}
