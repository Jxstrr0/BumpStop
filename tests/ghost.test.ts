/**
 * Ghost trucks: a ghost is only a build and a result, so the same build on
 * the same loop must drive exactly the same run again (after a trip through
 * a code, and step for step beside another truck), and codes must turn
 * away anything they can't trust.
 */
import { describe, expect, it } from 'vitest'
import { RIGS } from '../src/data/rigs'
import { BUILD_CODE_PREFIX, checksum, decodeGhostCode, encodeBuildCode, encodeGhostCode, GHOST_CODE_PREFIX, SaveCodeError, toBase64Url } from '../src/persist/code'
import { ghostKey, isGhostKey, readGhostRun } from '../src/persist/ghost'
import { buildTruck, stockBuild } from '../src/sim/build'
import { ghostFromRun, isNewBest, raceResult, type GhostRun } from '../src/sim/ghost'
import { advanceLaps, lapResult, runLaps, startLaps } from '../src/sim/laps'
import { lastPoses } from '../src/sim/poses'
import { fromCelsius } from '../src/sim/units'

const AIR = fromCelsius(20)
const SEED = 101

async function codeError(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    if (err instanceof SaveCodeError) return err.key
    throw err
  }
  return 'loaded'
}

function plainCode(prefix: string, value: unknown): string {
  const payload = `p${toBase64Url(new TextEncoder().encode(JSON.stringify(value)))}`
  return `${prefix}${payload}.${checksum(prefix + payload)}`
}

/** The stock light 4x4 with softer front springs and firmer rebound: a different truck to race. */
function otherBuild() {
  const b = stockBuild('light4x4')
  return { ...b, front: { ...b.front, springRate: b.front.springRate * 0.8, rebound: b.front.rebound + 2 } }
}

function ghostOf(build = stockBuild('light4x4')): GhostRun {
  const truck = buildTruck(build)
  return ghostFromRun('light4x4', 'tortureLoop', truck.build, runLaps(truck.ride, truck.wear, RIGS.tortureLoop, SEED, { airTemp: AIR }))
}

describe('ghost runs drive again exactly', { timeout: 120_000 }, () => {
  it('a ghost read back from its code drives the very same run', async () => {
    const ghost = ghostOf()
    expect(ghost.distance).toBeGreaterThan(0)
    const back = await decodeGhostCode(await encodeGhostCode(ghost))
    expect(back).toEqual(ghost)
    const truck = buildTruck(back.build)
    const again = ghostFromRun(back.cls, back.rig, truck.build, runLaps(truck.ride, truck.wear, RIGS.tortureLoop, SEED, { airTemp: AIR, trace: false }))
    expect(again).toEqual(ghost)
  })

  it('driven step for step beside another truck, the ghost keeps time and ends where it ended alone', () => {
    const ghost = ghostOf()
    const mine = buildTruck(otherBuild())
    const theirs = buildTruck(ghost.build)
    const a = startLaps(mine.ride, mine.wear, RIGS.tortureLoop, SEED, { airTemp: AIR, poses: 4 })
    const b = startLaps(theirs.ride, theirs.wear, RIGS.tortureLoop, SEED, { airTemp: AIR, poses: 4, trace: false })
    let guard = 0
    while (!a.done && guard++ < 1e6) {
      const taken = advanceLaps(a, 913)
      if (!b.done) advanceLaps(b, taken)
      // While both run, their newest poses are the same moment of the run.
      if (!a.done && !b.done) {
        const pa = lastPoses(a.poses!, 0)[0]!
        const pb = lastPoses(b.poses!, 0)[0]!
        expect(pb.t).toBeCloseTo(pa.t, 9)
        expect(pb.distance).toBeCloseTo(pa.distance, 6)
      }
    }
    // Finish the ghost if mine broke first.
    advanceLaps(b, Infinity)
    expect(ghostFromRun('light4x4', 'tortureLoop', theirs.build, lapResult(b))).toEqual(ghost)
  })
})

describe('best runs and races', () => {
  const base = ghostOf()

  it('keeps the run that went furthest; a tie keeps the old best', () => {
    expect(isNewBest(base, null)).toBe(true)
    expect(isNewBest({ ...base, distance: base.distance + 50 }, base)).toBe(true)
    expect(isNewBest({ ...base, distance: base.distance + 0.5 }, base)).toBe(false)
    expect(isNewBest({ ...base, distance: base.distance - 50 }, base)).toBe(false)
  })

  it('says who lasted longer and by how much', () => {
    expect(raceResult({ distance: 5000 }, { distance: 4200 })).toEqual({ outcome: 'ahead', gap: 800 })
    expect(raceResult({ distance: 4200 }, { distance: 5000 })).toEqual({ outcome: 'behind', gap: 800 })
    expect(raceResult({ distance: 5000 }, { distance: 5000.4 })).toEqual({ outcome: 'level', gap: 0 })
  })

  it('files ghosts under their own keys, apart from the rigs’ last-run lines', () => {
    expect(ghostKey('best', 'sxs', 'washboardLadder')).toBe('best:sxs:washboardLadder')
    expect(isGhostKey('friend:heavy:tortureLoop')).toBe(true)
    expect(isGhostKey('heavy:tortureLoop')).toBe(false)
  })

  it('turns away a stored ghost that doesn’t check out', () => {
    expect(readGhostRun(base)).toEqual(base)
    expect(readGhostRun({ ...base, rig: 'shaker' })).toBeNull()
    expect(readGhostRun({ ...base, cls: 'monsterTruck' })).toBeNull()
    expect(readGhostRun({ ...base, broken: 'exploded' })).toBeNull()
    expect(readGhostRun({ ...base, distance: -1 })).toBeNull()
    expect(readGhostRun({ ...base, laps: 2.5 })).toBeNull()
    expect(readGhostRun({ ...base, build: { ...base.build, cls: 'heavy' } })).toBeNull()
    expect(readGhostRun('ghost')).toBeNull()
  })
})

describe('ghost codes', { timeout: 60_000 }, () => {
  it('are short enough to send in a message, and survive what chat apps do to them', async () => {
    const ghost = ghostOf(otherBuild())
    const code = await encodeGhostCode(ghost)
    expect(code.startsWith(GHOST_CODE_PREFIX)).toBe(true)
    expect(code.length).toBeLessThan(700)
    const messy = `Race me! "${code.slice(0, 30)}\n${code.slice(30).replace(/-/g, '–')}" good luck`
    expect(await decodeGhostCode(messy)).toEqual(ghost)
  })

  it('turn away build codes, junk, damaged, cut-off and newer codes with a message to show', async () => {
    const code = await encodeGhostCode(base())
    expect(await codeError(decodeGhostCode(''))).toBe('ghostCode.empty')
    expect(await codeError(decodeGhostCode('hello there'))).toBe('ghostCode.notGhost')
    expect(await codeError(decodeGhostCode(await encodeBuildCode(stockBuild('sxs'))))).toBe('ghostCode.isBuild')
    expect(await codeError(decodeGhostCode(code.slice(0, -3)))).toBe('code.cutOff')
    expect(await codeError(decodeGhostCode(code.replace(GHOST_CODE_PREFIX + 'z', GHOST_CODE_PREFIX + 'zA')))).toBe('code.damaged')
    expect(await codeError(decodeGhostCode('x'.repeat(5000)))).toBe('ghostCode.tooLong')
    expect(await codeError(decodeGhostCode(plainCode(GHOST_CODE_PREFIX, { v: 2, ghost: base() })))).toBe('ghostCode.future')
    expect(await codeError(decodeGhostCode(plainCode(GHOST_CODE_PREFIX, { v: 1, ghost: { cls: 'sxs' } })))).toBe('ghostCode.notValid')
    expect(BUILD_CODE_PREFIX).not.toBe(GHOST_CODE_PREFIX)
  })

  function base(): GhostRun {
    return { cls: 'sxs', rig: 'washboardLadder', build: stockBuild('sxs'), distance: 12_345, laps: 7, broken: 'fade', corner: 2, lastSpeed: 19.4 }
  }
})
