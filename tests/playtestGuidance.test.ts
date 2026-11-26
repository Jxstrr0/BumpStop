/**
 * Kelbo's playtest (26 November 2026): the guidance that confused him.
 * Fixes the report offers in 1985, the shaker's verdict, the forecast that
 * firms up at checkpoints, money that ended "cr..", a career's own ghosts,
 * and the first-job guide noticing a step tick off.
 */
import { describe, expect, it } from 'vitest'
import { FAILURES } from '../src/data/failures'
import type { TruckBuild } from '../src/data/kit'
import { RIGS } from '../src/data/rigs'
import { t, tf } from '../src/data/strings'
import { careerScope, isGhostKey, scopeOf, scoped, unscoped } from '../src/persist/ghost'
import { buildTruck, stockBuild } from '../src/sim/build'
import { runLaps } from '../src/sim/laps'
import { runShaker, shakerPeaks, shakerVerdict } from '../src/sim/shaker'
import { fromCelsius } from '../src/sim/units'
import { forecastAt, forecastWord, type StageWeather } from '../src/sim/weather'
import { fixUseful } from '../src/ui/fixes'
import { newlyDone, type GuideStep } from '../src/ui/tutorial'

const AIR = fromCelsius(20)
const withRebound = (b: TruckBuild, clicks: number): TruckBuild => ({ ...b, front: { ...b.front, rebound: clicks }, rear: { ...b.rear, rebound: clicks } })

/** The fade fixes the report would show for this truck in this year. */
const fadeFixes = (b: TruckBuild, year: number) => FAILURES.fade.fixes.filter((f) => fixUseful(f.target, 'front', b, year)).slice(0, 3).map((f) => f.target)

describe('damper fade fixes', () => {
  it('in 1985 point at softer rebound, not shocks you can’t buy yet', () => {
    const b = stockBuild('light4x4')
    expect(fadeFixes(b, 1985)).toEqual(['lessRebound', 'pace'])
  })

  it('offer the bigger shock and the compression clicks once they’re on sale', () => {
    const b = stockBuild('light4x4')
    expect(fadeFixes(b, 1990)).toEqual(['damperSize', 'compression', 'lessRebound'])
  })

  it('drop softer rebound once the clicks are all the way soft', () => {
    const b = withRebound(stockBuild('light4x4'), -4)
    expect(fadeFixes(b, 1985)).toEqual(['pace'])
  })

  it('softer rebound really does keep the first job’s dampers cooler', () => {
    const run = (b: TruckBuild) => {
      const truck = buildTruck(b)
      return runLaps(truck.ride, truck.wear, RIGS.washboardLadder, 101, { airTemp: AIR, trace: false })
    }
    const stock = run(stockBuild('light4x4'))
    const soft = run(withRebound(stockBuild('light4x4'), -4))
    const far = (r: typeof stock) => r.laps.at(-1)!.endDistance
    expect(far(soft)).toBeGreaterThanOrEqual(far(stock))
  }, 120_000)
})

describe('the shaker’s verdict', () => {
  const verdict = (b: TruckBuild) => shakerVerdict(shakerPeaks(runShaker(buildTruck(b).ride, AIR))!, b.cls)

  it('calls stock trucks fair, more rebound better and less worse', () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      const stock = stockBuild(cls)
      expect(verdict(stock).overall, cls).toBe('lively')
      expect(verdict(withRebound(stock, -4)).overall, cls).toBe('wild')
      expect(verdict(withRebound(stock, 4)).overall, cls).toBe('calm')
    }
  }, 60_000)
})

describe('the forecast at a checkpoint', () => {
  const w = (comes: boolean): StageWeather => ({ kind: 'dust', chance: 0.6, from: 20_000, to: 30_000, comes, at: 25_000 })

  it('firms up towards what will happen, more once inside the window', () => {
    expect(forecastAt(w(true), 10_000).chance).toBeGreaterThan(0.6)
    expect(forecastAt(w(true), 22_000).chance).toBeGreaterThan(forecastAt(w(true), 10_000).chance)
    expect(forecastAt(w(false), 10_000).chance).toBeLessThan(0.6)
    expect(forecastWord(forecastAt(w(false), 22_000).chance)).toBe('possible')
    expect(forecastAt(w(true), 22_000).chance).toBeLessThan(1)
  })

  it('narrows its window once the truck is inside it', () => {
    expect(forecastAt(w(true), 10_000)).toMatchObject({ from: 20_000, to: 30_000 })
    expect(forecastAt(w(true), 22_000)).toMatchObject({ from: 22_000, to: 30_000 })
  })
})

describe('words', () => {
  it('money at the end of a sentence keeps one full stop', () => {
    expect(tf('career.upgrade.cost', { n: '9,000 cr.' })).toBe('Costs 9,000 cr.')
    expect(tf('career.why.money', { need: '1,500 cr.' })).toBe('Entering costs 1,500 cr.')
  })

  it('the note above the footer doesn’t name an old version', () => {
    expect(t('preview.note')).not.toMatch(/version/i)
  })

  it('only the shop is called the shop', () => {
    expect(t('shop.title')).toBe('The shop')
    expect(t('career.shop')).not.toBe('The shop')
  })
})

describe('a career keeps its own runs', () => {
  it('files them under the career’s seed, apart from free play', () => {
    expect(careerScope(null)).toBe('')
    expect(careerScope(42)).toBe('career42')
    const key = scoped(careerScope(42), 'best:sxs:washboardLadder')
    expect(key).toBe('career42:best:sxs:washboardLadder')
    expect(scopeOf(key)).toBe('career42')
    expect(unscoped(key)).toBe('best:sxs:washboardLadder')
    expect(isGhostKey(key)).toBe(true)
    expect(scopeOf('light4x4:shaker')).toBe('')
    expect(scoped('', 'light4x4:shaker')).toBe('light4x4:shaker')
  })
})

describe('the first-job guide', () => {
  it('spots the step that just ticked off', () => {
    const before: GuideStep[] = [{ id: 'take', state: 'done' }, { id: 'test', state: 'now' }, { id: 'fix', state: 'later' }]
    const after: GuideStep[] = [{ id: 'take', state: 'done' }, { id: 'test', state: 'done' }, { id: 'fix', state: 'now' }]
    expect(newlyDone(before, after)).toEqual(['test'])
    expect(newlyDone(after, after)).toEqual([])
  })
})
