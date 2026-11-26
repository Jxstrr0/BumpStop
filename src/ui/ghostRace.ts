/**
 * Ghost trucks in the shop (Kelbo asked, 26 November 2026): race your best
 * run on a loop, or a friend's, as a see-through truck beside yours.
 *
 * Under the start button, for the washboard ladder and the torture loop:
 *
 * - a row to pick the ghost for the next run: none, your best, or a friend's;
 * - a line saying what that ghost did (how far it got, what broke);
 * - Share or race a friend's ghost: your best as a `BMPG1:` code (through
 *   the share sheet, or copied), and a box to paste a friend's code in.
 *
 * Your best is kept for each class and loop: a finished run that went
 * further than the best so far takes its place. Ghosts are saved with the
 * garage (`src/persist/ghost.ts`). The shop drives the ghost's run again
 * beside yours (`src/sim/ghost.ts` says why that's exact), so a code holds
 * only the build and the result, never a recording, and nothing leaves the
 * phone unless the player shares it.
 */
import { CLASSES, type ClassId } from '../data/classes'
import type { RigId, ShopRigId } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import { decodeGhostCode, encodeGhostCode } from '../persist/code'
import { GHOST_RIGS, ghostKey, readGhostRun, type GhostSource } from '../persist/ghost'
import { isNewBest, raceResult, type GhostRun } from '../sim/ghost'
import { msToKmh } from '../sim/units'
import { el, num } from './dom'
import { button, codeBox, copyText, errorText, pasteBox } from './saves'

/** The ghost picked for a run, and whose it is. */
export interface GhostPick {
  ghost: GhostRun
  source: GhostSource
}

export interface GhostRace {
  element: HTMLElement
  /** Redraw for the class and rig on the bench; `busy` while a run is on. */
  sync(cls: ClassId, rig: ShopRigId, busy: boolean): void
  /** The ghost to race on the next run, or null. */
  pick(cls: ClassId, rig: RigId): GhostPick | null
  /** A run just finished (not stopped): keep it if it's a new best. True if it was. */
  record(run: GhostRun): boolean
  /** Every ghost, for the save. */
  stored(): Record<string, GhostRun>
}

export interface GhostRaceOptions {
  /** What the garage saved last time. */
  saved: Record<string, unknown>
  /** A ghost was added or replaced: save the garage. */
  onChange(): void
  /** A friend's ghost was pasted: put its class and loop on the bench if allowed. */
  onFriend(ghost: GhostRun): void
}

const className = (cls: ClassId) => t(CLASSES.find((c) => c.id === cls)!.name)
const isLoop = (rig: ShopRigId): rig is RigId => (GHOST_RIGS as readonly string[]).includes(rig)

/** "850 m" or "12.4 km". */
export function distanceText(m: number): string {
  return m < 1000 ? tf('ghost.m', { n: num(m) }) : tf('ghost.km', { n: num(m / 1000, 1) })
}

/** What a ghost did, in one line. */
export function ghostRunText(g: GhostRun): string {
  if (!g.broken) return tf('ghost.didLast', { laps: String(g.laps), dist: distanceText(g.distance) })
  return tf('ghost.didBreak', { what: t(`fail.${g.broken}` as StringKey).toLowerCase(), lap: String(g.laps), speed: num(msToKmh(g.lastSpeed)), dist: distanceText(g.distance) })
}

/** How your run went against the ghost's, in one line. */
export function raceText(mine: { distance: number }, ghost: { distance: number }): string {
  const r = raceResult(mine, ghost)
  if (r.outcome === 'level') return t('ghost.level')
  return tf(r.outcome === 'ahead' ? 'ghost.ahead' : 'ghost.behind', { dist: distanceText(r.gap) })
}

export function ghostRace(o: GhostRaceOptions): GhostRace {
  const ghosts = new Map<string, GhostRun>()
  for (const [key, raw] of Object.entries(o.saved)) {
    const g = readGhostRun(raw)
    // Only keep a ghost that's filed under its own class and loop.
    if (g && (key === ghostKey('best', g.cls, g.rig) || key === ghostKey('friend', g.cls, g.rig))) ghosts.set(key, g)
  }
  // Which ghost each class and loop races: null for none. Starts on your best, or a friend's if that's all there is.
  const chosen = new Map<string, GhostSource | null>()
  let cls: ClassId = 'light4x4'
  let rig: ShopRigId = 'washboardLadder'
  let busy = false

  const box = el('div', 'ghost-race')
  box.append(el('h3', 'ghost-title', t('ghost.title')))
  const row = el('div', 'btn-row chip-row')
  row.setAttribute('role', 'group')
  row.setAttribute('aria-label', t('ghost.title'))
  const choices: { source: GhostSource | null; b: HTMLButtonElement }[] = ([null, 'best', 'friend'] as const).map((source) => {
    const b = button(t(source === null ? 'ghost.none' : source === 'best' ? 'ghost.best' : 'ghost.friend'), 'btn chip-btn')
    b.addEventListener('click', () => {
      if (busy || !isLoop(rig)) return
      chosen.set(`${cls}:${rig}`, source)
      draw()
    })
    row.append(b)
    return { source, b }
  })
  const line = el('p', 'small ghost-line')

  // Sharing and pasting.
  const share = el('details', 'share-build ghost-share')
  share.append(el('summary', '', t('ghost.shareTitle')), el('p', 'small', t('ghost.shareLead')))
  const note = el('p', 'small')
  note.setAttribute('aria-live', 'polite')
  const out = codeBox(t('ghost.codeLabel'), 'ghost-code-out')
  const shareBtn = button(t('ghost.share'), 'btn')
  shareBtn.addEventListener('click', () => {
    if (!isLoop(rig)) return
    const best = ghosts.get(ghostKey('best', cls, rig))
    if (!best) return
    void (async () => {
      const code = await encodeGhostCode(best)
      out.box.value = code
      out.wrap.hidden = false
      const message = tf('ghost.shareText', { cls: className(best.cls).toLowerCase(), rig: t(`rig.${best.rig}` as StringKey).toLowerCase(), did: ghostRunText(best), code })
      note.className = 'small'
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ text: message })
          note.textContent = t('ghost.shared')
          return
        } catch (err) {
          // Closing the share sheet isn't a failure; anything else falls back to copying.
          if (err instanceof DOMException && err.name === 'AbortError') return
        }
      }
      const ok = await copyText(message)
      note.textContent = ok ? t('ghost.copied') : t('saves.copyFailed')
      if (!ok) out.box.focus()
    })()
  })
  const shareRow = el('div', 'btn-row')
  shareRow.append(shareBtn)
  const paste = pasteBox(t('ghost.pasteLabel'), 'ghost-code-in')
  const raceBtn = button(t('ghost.race'), 'btn')
  raceBtn.addEventListener('click', () => {
    void (async () => {
      try {
        const g = await decodeGhostCode(paste.box.value)
        ghosts.set(ghostKey('friend', g.cls, g.rig), g)
        chosen.set(`${g.cls}:${g.rig}`, 'friend')
        paste.box.value = ''
        o.onChange()
        o.onFriend(g)
        note.className = 'small'
        const here = g.cls === cls && g.rig === rig
        note.textContent = tf(here ? 'ghost.loaded' : 'ghost.loadedElsewhere', {
          cls: className(g.cls).toLowerCase(),
          rig: t(`rig.${g.rig}` as StringKey).toLowerCase(),
          did: ghostRunText(g),
        })
        draw()
      } catch (err) {
        note.className = 'small hot-text'
        note.textContent = errorText(err)
      }
    })()
  })
  const raceRow = el('div', 'btn-row')
  raceRow.append(raceBtn)
  share.append(shareRow, out.wrap, paste.wrap, raceRow, note)
  box.append(row, line, share)

  function current(): GhostSource | null {
    if (!isLoop(rig)) return null
    const key = `${cls}:${rig}`
    const has = (s: GhostSource) => ghosts.has(ghostKey(s, cls, rig as RigId))
    const pick = chosen.has(key) ? chosen.get(key)! : has('best') ? 'best' : has('friend') ? 'friend' : null
    return pick && has(pick) ? pick : null
  }

  function draw(): void {
    const loop = rig
    box.hidden = !isLoop(loop)
    if (!isLoop(loop)) return
    const source = current()
    for (const { source: s, b } of choices) {
      const there = s === null || ghosts.has(ghostKey(s, cls, loop))
      b.hidden = !there
      b.disabled = busy
      b.setAttribute('aria-pressed', String(s === source))
    }
    const best = ghosts.get(ghostKey('best', cls, loop))
    const friend = ghosts.get(ghostKey('friend', cls, loop))
    if (!best && !friend) line.textContent = t('ghost.noneYet')
    else if (source === null) line.textContent = t('ghost.off')
    else line.textContent = tf(source === 'best' ? 'ghost.bestLine' : 'ghost.friendLine', { did: ghostRunText(source === 'best' ? best! : friend!) })
    shareBtn.disabled = !best
    shareBtn.textContent = t(best ? 'ghost.share' : 'ghost.shareNone')
  }

  draw()
  return {
    element: box,
    sync(nextCls, nextRig, nextBusy) {
      cls = nextCls
      rig = nextRig
      busy = nextBusy
      draw()
    },
    pick(c, r) {
      if (c !== cls || r !== rig) return null
      const source = current()
      const ghost = source ? ghosts.get(ghostKey(source, c, r)) : undefined
      return source && ghost ? { ghost, source } : null
    },
    record(run) {
      const key = ghostKey('best', run.cls, run.rig)
      if (!isNewBest(run, ghosts.get(key) ?? null)) return false
      ghosts.set(key, run)
      o.onChange()
      draw()
      return true
    },
    stored: () => Object.fromEntries(ghosts),
  }
}
