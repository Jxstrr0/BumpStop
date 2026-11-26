import { afterAll, describe, expect, it } from 'vitest'
import { BOT_BUILDS, BOT_SEEDS, MULE_WINDOWS } from '../../src/data/balance'
import type { ClassId } from '../../src/data/classes'
import type { RigId } from '../../src/data/rigs'
import { botRun, breakKmh, describe as say, fixTweak, noteRow, weakTweak, writeSummary } from './bot'

const RIG_IDS: readonly RigId[] = ['washboardLadder', 'tortureLoop']

/** Each check drives a few full-detail lap runs: a couple of seconds here, slower on a shared CI runner. */
const BOT_TIMEOUT = 60_000

/** The balance bot's checks for one class (see `src/data/balance.ts`). */
export function balanceSuite(cls: ClassId): void {
  describe(`balance bot: ${cls}`, () => {
    afterAll(() => writeSummary(cls))

    it.each(RIG_IDS)('the test mule lasts a few laps on the %s, then breaks inside its window', (rig) => {
      const [lo, hi] = MULE_WINDOWS[cls][rig]
      const runs = BOT_SEEDS.map((seed) => botRun(cls, rig, {}, seed))
      noteRow(cls, 'test mule', rig, runs.map(say))
      for (const run of runs) {
        expect(run.broken, `${cls} on the ${rig} never broke`).not.toBeNull()
        expect(run.brokenLap).toBeGreaterThan(1)
        expect(breakKmh(run)).toBeGreaterThanOrEqual(lo)
        expect(breakKmh(run)).toBeLessThanOrEqual(hi)
        // The ladder is the fade finder (plan PR 4): the stock build's dampers give up before anything else.
        if (rig === 'washboardLadder') expect(run.broken?.kind, `${cls} on the ladder: ${say(run)}`).toBe('fade')
      }
    }, BOT_TIMEOUT)

    it.each(BOT_BUILDS)('$id: breaks by $expect first, and the fix helps', (b) => {
      const weak = BOT_SEEDS.map((seed) => botRun(cls, b.rig, weakTweak(b, cls), seed))
      const fixed = BOT_SEEDS.map((seed) => botRun(cls, b.rig, fixTweak(b, cls), seed))
      noteRow(cls, b.id, b.rig, weak.map(say))
      noteRow(cls, `${b.id}, fixed`, b.rig, fixed.map(say))
      weak.forEach((run, k) => {
        expect(run.broken?.kind, `${b.id} on seed ${BOT_SEEDS[k]}: ${say(run)}`).toBe(b.expect)
        // The fix either stops that failure or pushes it to a later lap.
        const fix = fixed[k]!
        const helped = fix.broken?.kind !== b.expect || fix.brokenLap > run.brokenLap
        expect(helped, `${b.id} fixed, seed ${BOT_SEEDS[k]}: ${say(fix)}`).toBe(true)
      })
    }, BOT_TIMEOUT)
  })
}
