/**
 * The raid balance bot (plan PR 7): drives the Summer Sprint with each
 * class's stock truck (and a light spares kit) at each pace call, every leg
 * the same, doing what the bivouac can each night, and checks the pace calls
 * mean what they say:
 *
 * - Steady gets the stock truck home: never towed in, never a faded damper.
 * - Conserve is slower than Steady, runs cooler and stops no more often.
 *   (It isn't always kinder on every part: a slower landing off a jump can
 *   hit an axle harder. That's the physics, so the bot doesn't ask for it.)
 * - Push is quicker on a clean stage, and harder on the truck: more stops
 *   or more wear than Steady.
 *
 * If a change to the ride, wear or raid numbers turns this red, the raid
 * speeds in `src/data/raids.ts` probably need a look (`docs/RAIDS.md`).
 */
import { describe, expect, it } from 'vitest'
import type { ClassId } from '../src/data/classes'
import type { PaceId } from '../src/data/raids'
import { stockBuild } from '../src/sim/build'
import { bivouacJobs, checkJobs, doJobs, driveStage, enterRaid, finishStage, raidTruck, startStage, type Job, type RaidState, type StageRecord } from '../src/sim/raid'
import { worstDamage } from '../src/sim/wear'

/** Each night: the worst parts first, as many jobs as the hours and spares allow. */
function nightJobs(state: RaidState): Job[] {
  const picked: Job[] = []
  for (const j of bivouacJobs(state)) if (!checkJobs(state, [...picked, j])) picked.push(j)
  return picked
}

interface Outcome {
  records: StageRecord[]
  /** Worst damage at the end of each stage, before the bivouac. */
  wear: number[]
  /** Hottest oil on each stage, over the red line (K): below 0 means it never got there. */
  overRed: number[]
  /** Clean stages' times. */
  clean: (number | null)[]
}

function drive(cls: ClassId, pace: PaceId): Outcome {
  const b = stockBuild(cls)
  b.parts.spares = 'lightKit'
  const state = enterRaid('summerSprint', b, 'gravelAce')
  const out: Outcome = { records: [], wear: [], overRed: [], clean: [] }
  while (state.phase !== 'done') {
    const run = startStage(state, raidTruck(state), pace)
    driveStage(state, run, [pace, pace, pace])
    const rec = finishStage(state, run)
    out.records.push(rec)
    out.wear.push(worstDamage(state.wear))
    const red = Math.min(run.truck.ride.front.damper.redLine, run.truck.ride.rear.damper.redLine)
    out.overRed.push(Math.max(...run.trace.oil) - red)
    out.clean.push(rec.stops.length === 0 ? rec.time : null)
    if (state.phase === 'bivouac') doJobs(state, nightJobs(state))
  }
  return out
}

const stops = (o: Outcome) => o.records.reduce((n, r) => n + r.stops.length, 0)
const total = (o: Outcome) => o.records.reduce((n, r) => n + r.time, 0)
const wear = (o: Outcome) => o.wear.reduce((a, b) => a + b, 0)

describe.each(['light4x4', 'heavy', 'sxs'] as ClassId[])('raid balance: %s', (cls) => {
  const runs = {} as Record<PaceId, Outcome>
  const get = (pace: PaceId) => (runs[pace] ??= drive(cls, pace))

  it('Steady gets the stock truck home: never towed in, never faded', { timeout: 120_000 }, () => {
    const o = get('steady')
    for (const r of o.records) expect(r.late).toBe(false)
    for (const r of o.records) expect(r.stops.filter((s) => s.kind === 'fade')).toEqual([])
    for (const over of o.overRed) expect(over).toBeLessThan(0)
    expect(stops(o)).toBeLessThanOrEqual(1)
  })

  it('Conserve is slower than Steady, runs cooler and stops no more often', { timeout: 120_000 }, () => {
    const c = get('conserve')
    const s = get('steady')
    expect(total(c)).toBeGreaterThan(total(s))
    expect(stops(c)).toBeLessThanOrEqual(stops(s))
    expect(Math.max(...c.overRed)).toBeLessThan(Math.max(...s.overRed))
    expect(wear(c)).toBeLessThan(wear(get('push')))
  })

  it('Push is quicker when clean, and harder on the truck', { timeout: 120_000 }, () => {
    const p = get('push')
    const s = get('steady')
    p.clean.forEach((t, k) => {
      const st = s.clean[k]
      if (t !== null && st !== null && st !== undefined) expect(t).toBeLessThan(st)
    })
    expect(stops(p) > stops(s) || wear(p) > wear(s)).toBe(true)
    expect(Math.max(...p.overRed)).toBeGreaterThan(Math.max(...s.overRed))
  })
})
