/**
 * Saves (plan PR 8): the garage format, save codes, truck build codes, the
 * slots' localStorage fallback and the backup reminder.
 */
import { describe, expect, it } from 'vitest'
import { KITS } from '../src/data/kit'
import { SAVE } from '../src/data/save'
import { stockBuild, tidyBuild } from '../src/sim/build'
import { bivouacJobs, checkJobs, doJobs, driveStage, enterRaid, finishStage, raidTruck, startStage, type RaidState } from '../src/sim/raid'
import {
  BUILD_CODE_PREFIX, checksum, decodeBuildCode, decodeSaveCode, encodeBuildCode, encodeSaveCode, SAVE_CODE_PREFIX, SaveCodeError, toBase64Url,
} from '../src/persist/code'
import { backupAgeDays, backupFileName, backupReminderDue } from '../src/persist/safety'
import { hasProgress, leanSave, newSave, readBuild, readSave, SaveFormatError } from '../src/persist/save'
import { deleteSlot, listSlots, localStore, slotSummary, viewOf, writeSlot } from '../src/persist/slots'

/** A pretend localStorage for the slot fallback. */
function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

/** The error key a code is turned away with. */
async function codeError(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    if (err instanceof SaveCodeError) return err.key
    throw err
  }
  return 'loaded'
}

/** A raw code with any JSON inside, plain (`p`) payload, for building bad codes by hand. */
function plainCode(prefix: string, value: unknown): string {
  const payload = `p${toBase64Url(new TextEncoder().encode(JSON.stringify(value)))}`
  return `${prefix}${payload}.${checksum(prefix + payload)}`
}

describe('the garage save', () => {
  it('a new garage reads back as itself and has no progress yet', () => {
    const s = newSave()
    expect(readSave(JSON.parse(JSON.stringify(s)))).toEqual(s)
    expect(hasProgress(s)).toBe(false)
  })

  it('counts a tuned truck, a later year, a rig run or a raid as progress', () => {
    const tuned = newSave()
    tuned.builds.heavy = tidyBuild({ ...tuned.builds.heavy, front: { ...tuned.builds.heavy.front, preload: tuned.builds.heavy.front.preload + 0.01 } })
    expect(hasProgress(tuned)).toBe(true)
    expect(hasProgress({ ...newSave(), year: 1990 })).toBe(true)
    expect(hasProgress({ ...newSave(), ghosts: { 'sxs:shaker': {} } })).toBe(true)
    expect(hasProgress({ ...newSave(), raid: enterRaid('summerSprint', stockBuild('sxs'), 'veteran') })).toBe(true)
  })

  it('leaves the ghosts out of what a save code carries', () => {
    const s = { ...newSave(), ghosts: { 'light4x4:ladder': { kind: 'laps' } } }
    expect(leanSave(s).ghosts).toEqual({})
    expect(s.ghosts).not.toEqual({})
  })

  it('turns away saves it cannot trust, and says when one is from a newer version', () => {
    const bad = (v: unknown) => {
      try {
        readSave(v)
      } catch (err) {
        return err instanceof SaveFormatError ? err.kind : 'other'
      }
      return 'loaded'
    }
    const good = JSON.parse(JSON.stringify(newSave()))
    expect(bad(good)).toBe('loaded')
    expect(bad(null)).toBe('bad')
    expect(bad({ ...good, v: undefined })).toBe('bad')
    expect(bad({ ...good, v: SAVE.version + 1 })).toBe('future')
    expect(bad({ ...good, cls: 'tank' })).toBe('bad')
    expect(bad({ ...good, year: 1900 })).toBe('bad')
    expect(bad({ ...good, builds: undefined })).toBe('bad')
    expect(bad({ ...good, builds: { ...good.builds, sxs: { ...good.builds.sxs, front: { springRate: 'soft' } } } })).toBe('bad')
    expect(bad({ ...good, builds: { ...good.builds, sxs: good.builds.heavy } })).toBe('bad')
    expect(bad({ ...good, raid: { entry: { raid: 'nowhere' } } })).toBe('bad')
  })

  it('a build with a part that no longer exists goes back to the stock part; settings are pulled into range', () => {
    const stock = stockBuild('light4x4')
    const raw = JSON.parse(JSON.stringify(stock))
    raw.parts.dampers = 'aPartFromTheFuture'
    raw.parts.tires = KITS.heavy.stock.parts.tires === stock.parts.tires ? raw.parts.tires : KITS.heavy.stock.parts.tires
    raw.front.springRate = 1e9
    const b = readBuild(raw)
    expect(b.parts.dampers).toBe(stock.parts.dampers)
    expect(b.front.springRate).toBe(KITS.light4x4.ranges.springRate.max)
    expect(b).toEqual(tidyBuild(b))
  })
})

describe('save codes', { timeout: 60_000 }, () => {
  it('round-trip a garage, and survive what chat apps do to pasted text', async () => {
    const s = newSave()
    s.cls = 'heavy'
    s.year = 2003
    const code = await encodeSaveCode(s)
    expect(code.startsWith(SAVE_CODE_PREFIX)).toBe(true)
    expect(code).toMatch(/^BMP1:z[A-Za-z0-9_-]+\.[0-9a-z]{7}$/)
    expect(await decodeSaveCode(code)).toEqual(s)
    // Line breaks, spaces, a smart dash for a hyphen, and words around it.
    const mangled = `Here's my garage: "${code.slice(0, 30)}\n ${code.slice(30, 60)}  ${code.slice(60)}" thanks`.replace(/-/g, '–')
    expect(await decodeSaveCode(mangled)).toEqual(s)
  })

  it('a raid saved after a stage carries on exactly as if it had never been saved', async () => {
    const play = (state: RaidState) => {
      const run = startStage(state, raidTruck(state), 'push')
      driveStage(state, run, ['push', 'steady', 'push'])
      finishStage(state, run)
      doJobs(state, bivouacJobs(state).filter((j) => !checkJobs(state, [j])).slice(0, 1))
    }
    const s = newSave()
    s.raid = enterRaid('summerSprint', stockBuild('light4x4'), 'charger')
    play(s.raid)
    const loaded = await decodeSaveCode(await encodeSaveCode(s))
    expect(loaded.raid).toEqual(s.raid)
    play(s.raid)
    play(loaded.raid!)
    expect(JSON.stringify(loaded.raid)).toBe(JSON.stringify(s.raid))
    expect(loaded.raid!.results.length).toBe(2)
  })

  it('turns away damaged, cut-off, wrong-kind and newer codes with a message to show', async () => {
    const code = await encodeSaveCode(newSave())
    expect(await codeError(decodeSaveCode(''))).toBe('code.empty')
    expect(await codeError(decodeSaveCode('hello there'))).toBe('code.notSave')
    expect(await codeError(decodeSaveCode(code.slice(0, code.length - 3)))).toBe('code.cutOff')
    expect(await codeError(decodeSaveCode(code.slice(0, code.indexOf('.'))))).toBe('code.cutOff')
    const k = 12
    const flipped = code.slice(0, k) + (code[k] === 'A' ? 'B' : 'A') + code.slice(k + 1)
    expect(await codeError(decodeSaveCode(flipped))).toBe('code.damaged')
    expect(await codeError(decodeSaveCode(await encodeBuildCode(stockBuild('sxs'))))).toBe('code.isBuild')
    expect(await codeError(decodeSaveCode('x'.repeat(SAVE.maxCodeChars + 1)))).toBe('code.tooLong')
    expect(await codeError(decodeSaveCode(plainCode(SAVE_CODE_PREFIX, { ...newSave(), v: SAVE.version + 1 })))).toBe('code.future')
    expect(await codeError(decodeSaveCode(plainCode(SAVE_CODE_PREFIX, { hello: 'world' })))).toBe('code.notValid')
  })

  it('still reads the plain kind of code made by a browser that cannot squash', async () => {
    const s = { ...newSave(), year: 2011 }
    expect(await decodeSaveCode(plainCode(SAVE_CODE_PREFIX, s))).toEqual(s)
  })

  it('gives up on a code that would unpack to something huge', async () => {
    // Megabytes of spaces squash to almost nothing: a "zip bomb".
    const bytes = new TextEncoder().encode(`"${' '.repeat(SAVE.maxInflatedBytes + 10)}"`)
    const squashed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    const payload = `z${toBase64Url(squashed)}`
    const bomb = `${SAVE_CODE_PREFIX}${payload}.${checksum(SAVE_CODE_PREFIX + payload)}`
    expect(bomb.length).toBeLessThan(SAVE.maxCodeChars)
    expect(await codeError(decodeSaveCode(bomb))).toBe('code.unpack')
  })

  it('leaves the rig ghosts out, so codes stay short', async () => {
    const s = { ...newSave(), ghosts: { 'heavy:ladder': { history: { distance: Array.from({ length: 5000 }, (_, i) => i * 1.37) } } } }
    const code = await encodeSaveCode(s)
    expect(code.length).toBeLessThan(2000)
    expect((await decodeSaveCode(code)).ghosts).toEqual({})
  })
})

describe('truck build codes', () => {
  it('round-trip each class, short enough to send in a message', async () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      const b = stockBuild(cls)
      const code = await encodeBuildCode(b)
      expect(code.startsWith(BUILD_CODE_PREFIX)).toBe(true)
      expect(code.length).toBeLessThan(600)
      expect(await decodeBuildCode(` ${code} `)).toEqual(b)
    }
  })

  it('turn away save codes and junk', async () => {
    expect(await codeError(decodeBuildCode(await encodeSaveCode(newSave())))).toBe('buildCode.isSave')
    expect(await codeError(decodeBuildCode('BMPT1'))).toBe('buildCode.notBuild')
    expect(await codeError(decodeBuildCode(plainCode(BUILD_CODE_PREFIX, { v: 1, build: { cls: 'boat' } })))).toBe('buildCode.notValid')
    expect(await codeError(decodeBuildCode(plainCode(BUILD_CODE_PREFIX, { v: 2, build: stockBuild('sxs') })))).toBe('buildCode.future')
  })
})

describe('garage slots (the localStorage fallback)', () => {
  it('saves, lists and deletes slots, and shows a damaged one as damaged', async () => {
    const storage = fakeStorage()
    const st = localStore(storage)
    const s = { ...newSave(), cls: 'sxs' as const, year: 1999 }
    expect((await listSlots(st)).every((v) => v.empty)).toBe(true)
    expect(await writeSlot(2, s, 1234, st)).toBe(true)
    const views = await listSlots(st)
    expect(views[1]).toMatchObject({ slot: 2, empty: false, damaged: false, savedAt: 1234 })
    expect(views[1]!.save).toEqual(s)
    expect(views[0]!.empty && views[2]!.empty).toBe(true)
    // Only bumpstop. keys are used.
    expect([...Array(storage.length).keys()].map((i) => storage.key(i))).toEqual(['bumpstop.slot.2'])

    storage.setItem('bumpstop.slot.3', '{not json')
    expect((await listSlots(st))[2]).toMatchObject({ empty: false, damaged: true })
    expect(viewOf(1, { slot: 1, savedAt: 5, data: { v: 1 } }).damaged).toBe(true)

    await deleteSlot(2, st)
    expect((await listSlots(st))[1]!.empty).toBe(true)
  })

  it('a slot card knows the class, year and raid', () => {
    const s = newSave()
    s.raid = enterRaid('summerRaid', stockBuild('light4x4'), 'mechanic')
    const sum = slotSummary(s)
    expect(sum).toMatchObject({ cls: 'light4x4', year: 1985, progress: true, raid: { stage: 0, done: false } })
    expect(sum.raid!.stages).toBeGreaterThan(1)
  })
})

describe('the backup reminder', () => {
  const day = 24 * 3600 * 1000
  it('waits for progress, then shows when never backed up or after 14 days', () => {
    const now = 100 * day
    expect(backupReminderDue(false, null, now)).toBe(false)
    expect(backupReminderDue(true, null, now)).toBe(true)
    expect(backupReminderDue(true, now - 13 * day, now)).toBe(false)
    expect(backupReminderDue(true, now - SAVE.backupReminderDays * day, now)).toBe(true)
    expect(backupAgeDays(null, now)).toBeNull()
    expect(backupAgeDays(now - 2.5 * day, now)).toBe(2)
  })

  it('names backup files by the local date', () => {
    expect(backupFileName(new Date(2026, 10, 6))).toBe('bump-stop-backup-2026-11-06.txt')
  })
})
