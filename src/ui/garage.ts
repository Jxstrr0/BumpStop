/**
 * The garage in play (plan PR 8): which slot is open, what's in it, and the
 * autosave that writes it back.
 *
 * At page load `openGarage` reads the three slots and starts the build
 * store, the shop's ghosts and the raid from the open slot. After that,
 * every change (a part, a slider, a rig run, a raid morning or night) asks
 * for a save, and the slot is written a moment after the last one, so a
 * slider drag is one write, not hundreds. It also saves as the page is
 * hidden or closed.
 *
 * An empty slot stays empty until there's something to keep. A slot that
 * can't be read is never written over: the game starts fresh in memory and
 * the saves panel offers Delete or another slot.
 */
import { SAVE } from '../data/save'
import { hasProgress, newSave, type GarageSave } from '../persist/save'
import { keepStorage } from '../persist/safety'
import { activeSlot, listSlots, setActiveSlot, writeSlot, type SlotNo, type SlotView } from '../persist/slots'
import type { RaidState } from '../sim/raid'
import { makeBuildStore, type BuildStore } from './buildStore'
import type { RaidSaves } from './raid'
import type { ShopSaves } from './shop'

/** How the last save went, for the line on the saves panel. */
export type SaveStatus = { kind: 'idle' } | { kind: 'saved'; at: number } | { kind: 'failed' } | { kind: 'readOnly' }

export interface Garage {
  slot: SlotNo
  /** The three slots as they were at page load. */
  slots: SlotView[]
  store: BuildStore
  shop: ShopSaves
  raid: RaidSaves
  /** The garage as it stands now. */
  current(): GarageSave
  status(): SaveStatus
  onStatus(fn: (s: SaveStatus) => void): void
  /** Write now if anything is waiting. */
  flush(): Promise<void>
  /** Stop saving (before deleting this slot or loading over it). */
  stop(): void
  /** Open another slot: save this one, then reload into that one. */
  open(slot: SlotNo): Promise<void>
  /** Put a garage (from a save code) into this slot and reload into it. */
  replace(save: GarageSave): Promise<boolean>
}

export async function openGarage(): Promise<Garage> {
  const slot = activeSlot()
  const slots = await listSlots()
  const view = slots[slot - 1]!
  const start = view.save ?? newSave()
  let writable = !view.damaged
  let stopped = false

  const store = makeBuildStore({ builds: start.builds, cls: start.cls, year: start.year })
  let ghosts = start.ghosts
  let raid: RaidState | null = start.raid
  let status: SaveStatus = writable ? (view.empty ? { kind: 'idle' } : { kind: 'saved', at: view.savedAt }) : { kind: 'readOnly' }
  const listeners: ((s: SaveStatus) => void)[] = []
  let timer = 0
  let dirty = false
  let asked = false

  function current(): GarageSave {
    return { v: SAVE.version, cls: store.cls(), year: store.year(), builds: store.builds(), raid, ghosts }
  }

  function setStatus(s: SaveStatus): void {
    status = s
    for (const fn of listeners) fn(s)
  }

  async function write(): Promise<void> {
    window.clearTimeout(timer)
    if (!dirty || !writable || stopped) return
    dirty = false
    const save = current()
    const ok = await writeSlot(slot, save)
    setStatus(ok ? { kind: 'saved', at: Date.now() } : { kind: 'failed' })
    // Once there's something worth keeping, ask the browser to keep our storage (once per load).
    if (ok && !asked && hasProgress(save)) {
      asked = true
      void keepStorage()
    }
  }

  function changed(): void {
    dirty = true
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void write(), SAVE.autosaveDelayMs)
  }

  store.onChange(changed)
  // Save straight away when the player leaves the page or switches app.
  const leaving = () => void write()
  window.addEventListener('pagehide', leaving)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leaving()
  })

  return {
    slot,
    slots,
    store,
    shop: {
      ghosts: start.ghosts,
      onGhosts(g) {
        ghosts = g
        changed()
      },
    },
    raid: {
      raid: start.raid,
      onRaid(r) {
        raid = r
        changed()
      },
    },
    current,
    status: () => status,
    onStatus: (fn) => void listeners.push(fn),
    flush: write,
    stop() {
      stopped = true
      window.clearTimeout(timer)
    },
    async open(next) {
      await write()
      stopped = true
      setActiveSlot(next)
      location.reload()
    },
    async replace(save) {
      stopped = true
      window.clearTimeout(timer)
      const ok = await writeSlot(slot, save)
      if (!ok) {
        stopped = false
        return false
      }
      writable = true
      location.reload()
      return true
    },
  }
}
