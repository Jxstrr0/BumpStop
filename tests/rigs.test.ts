/**
 * The shop's rigs (plan PR 4): lap runs step by step, the run history the
 * live trace and the ghost draw from, the shaker rig, and where each fix on
 * the report jumps to.
 */
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { FAILURES } from '../src/data/failures'
import { RIG_HISTORY_STEP, RIGS, SHAKER } from '../src/data/rigs'
import { buildTruck, partIn, stockBuild } from '../src/sim/build'
import { advanceLaps, lapResult, runLaps, startLaps } from '../src/sim/laps'
import { advanceShaker, runShaker, shakerPeaks, startShaker, washboardSpeed } from '../src/sim/shaker'
import { fromCelsius, msToKmh } from '../src/sim/units'
import { fixJump } from '../src/ui/fixes'
import { tweaked } from './helpers/tweak'

const AIR = fromCelsius(20)

describe('lap runs, step by step', { timeout: 60_000 }, () => {
  const truck = buildTruck(stockBuild('light4x4'))

  it('a run in small pieces ends exactly like one run all at once, trace and all', () => {
    const whole = runLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR })
    const r = startLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR })
    let guard = 0
    while (!r.done && guard++ < 1e6) advanceLaps(r, 777)
    expect(lapResult(r)).toEqual(whole)
  })

  it('keeps a history every few metres, ending at the break', () => {
    const run = runLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR })
    const h = run.history
    expect(h.distance.length).toBeGreaterThan(10)
    for (const list of [h.lap, h.oil, h.travel, h.wear]) expect(list.length).toBe(h.distance.length)
    for (let k = 1; k < h.distance.length; k++) {
      expect(h.distance[k]!).toBeGreaterThanOrEqual(h.distance[k - 1]!)
      expect(h.distance[k]! - h.distance[k - 1]!).toBeLessThan(RIG_HISTORY_STEP + 1)
      expect(h.lap[k]!).toBeGreaterThanOrEqual(h.lap[k - 1]!)
      expect(h.wear[k]!).toBeGreaterThanOrEqual(h.wear[k - 1]!)
    }
    expect(h.distance.at(-1)).toBeCloseTo(run.broken!.distance, 6)
    expect(h.wear.at(-1)).toBeGreaterThan(0)
    // Each lap's end is where the next one starts.
    expect(run.laps.at(-1)!.endDistance).toBeCloseTo(run.broken!.distance, 6)
  })

  it('the trace ends on the very step it broke', () => {
    const run = runLaps(truck.ride, truck.wear, RIGS.tortureLoop, 7, { airTemp: AIR })
    expect(run.trace!.t.at(-1)).toBe(run.broken!.t)
  })

  it('the washboard ladder gets hotter every lap on the stock build', () => {
    const run = runLaps(truck.ride, truck.wear, RIGS.washboardLadder, 11, { airTemp: AIR, trace: false })
    const hottest = run.laps.map((l) => Math.max(...l.peakTemp))
    for (let k = 1; k < hottest.length; k++) expect(hottest[k]!).toBeGreaterThan(hottest[k - 1]!)
  })
})

describe('the shaker rig', () => {
  it.each(CLASSES.map((c) => c.id))('%s: finds the body bounce and the wheel hop', (cls) => {
    const points = runShaker(buildTruck(stockBuild(cls)).ride, AIR)
    expect(points.length).toBe(SHAKER.points)
    for (const p of points) for (const v of [...p.body, ...p.wheel]) expect(Number.isFinite(v)).toBe(true)
    const peaks = shakerPeaks(points)!
    // Body bounce: a slow beat where the body moves more than the posts.
    expect(peaks.body.freq).toBeGreaterThan(0.8)
    expect(peaks.body.freq).toBeLessThan(2)
    expect(peaks.body.gain).toBeGreaterThan(1.2)
    // Wheel hop: a fast beat, which on washboard lands in the 20 to 40 km/h band the ride sim found.
    expect(peaks.wheel.freq).toBeGreaterThan(5)
    expect(peaks.wheel.freq).toBeLessThan(14)
    expect(peaks.wheel.gain).toBeGreaterThan(1.5)
    const kmh = msToKmh(washboardSpeed(peaks.wheel.freq))
    expect(kmh).toBeGreaterThan(15)
    expect(kmh).toBeLessThan(45)
    // Shaken fast, the body hardly moves at all.
    expect(Math.max(...points.at(-1)!.body)).toBeLessThan(0.1)
  })

  it('stiffer springs move the body bounce to a faster beat', () => {
    const stock = buildTruck(stockBuild('light4x4'))
    const stiff = tweaked(stock.ride, stock.wear, { springRate: 2 }).ride
    expect(shakerPeaks(runShaker(stiff, AIR))!.body.freq).toBeGreaterThan(shakerPeaks(runShaker(stock.ride, AIR))!.body.freq)
  })

  it('in small pieces, measures exactly what it does all at once', () => {
    const ride = buildTruck(stockBuild('sxs')).ride
    const r = startShaker(ride, AIR)
    while (!r.done) advanceShaker(r, 333)
    expect(r.points).toEqual(runShaker(ride, AIR))
  })
})

describe('fix jumps', () => {
  it.each(CLASSES.map((c) => c.id))('%s: every fix on the report goes somewhere the build screen has', (cls) => {
    const b = stockBuild(cls)
    const clicks = partIn(b, 'dampers').clicks
    for (const info of Object.values(FAILURES)) {
      for (const fix of info.fixes) {
        for (const end of ['front', 'rear'] as const) {
          const jump = fixJump(fix.target, end, b)
          if (fix.target === 'pace') {
            expect(jump).toBeNull()
            continue
          }
          expect(jump).not.toBeNull()
          if (jump!.kind === 'slider') {
            expect(jump!.end).toBe(end)
            // Damper sliders only exist where the damper has that adjuster.
            if (jump!.key === 'compLow' || jump!.key === 'compHigh' || jump!.key === 'rebound') expect(clicks[jump!.key]).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})
