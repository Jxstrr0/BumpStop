/**
 * One-day events (Kelbo picked them, 28 November 2026): the hill climb's
 * course runs through the ride sim like a rig, a stock truck makes the top
 * at Steady, Push is quicker, bottom-outs cost time, and the rivals and
 * standings come out the same every time.
 */
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { CONTEST_IDS, CONTESTS, HILL_CLIMB } from '../src/data/contests'
import { t } from '../src/data/strings'
import { buildTruck, stockBuild } from '../src/sim/build'
import {
  bestOf, climbFactor, contestStandings, courseLength, courseRig, courseSeed, courseSpeeds, rivalRuns, scoreRun, type ContestRun,
} from '../src/sim/contest'
import { runLaps, type LapRun } from '../src/sim/laps'
import { rivalsIn } from '../src/sim/rivals'
import { fromCelsius } from '../src/sim/units'

const HILL = CONTESTS.hillClimb

function climb(cls: (typeof CLASSES)[number]['id'], driver: 'veteran' | 'charger', pace: 'conserve' | 'steady' | 'push'): ContestRun {
  const truck = buildTruck(stockBuild(cls))
  const speeds = courseSpeeds(HILL, truck, driver, pace)
  const run = runLaps(truck.ride, truck.wear, courseRig(HILL, speeds), courseSeed(HILL, cls), { airTemp: fromCelsius(HILL.airC), trace: false })
  return scoreRun(HILL, run, speeds, driver, pace)
}

describe('the events table', () => {
  it('has a name and a line for every event, and a course of real length', () => {
    for (const id of CONTEST_IDS) {
      const c = CONTESTS[id]
      expect(c.id).toBe(id)
      expect(t(c.name)).toBeTruthy()
      expect(t(c.text)).toBeTruthy()
      expect(courseLength(c)).toBeGreaterThan(1000)
      expect(c.runs).toBeGreaterThan(0)
    }
  })
})

describe('the hill climb', () => {
  it('turns the course into a one-lap rig that runs each piece at its own speed', () => {
    const truck = buildTruck(stockBuild('light4x4'))
    const speeds = courseSpeeds(HILL, truck, 'veteran', 'steady')
    const rig = courseRig(HILL, speeds)
    expect(rig.maxLaps).toBe(1)
    expect(rig.startSpeed * rig.pieces[0]!.pace).toBeCloseTo(speeds[0]!, 9)
    expect(rig.pieces.map((p) => p.ground)).toEqual(HILL.course.map((p) => p.ground))
  })

  it('climbs at the stock share in a stock truck, and better with more power to the kilo', () => {
    const stock = buildTruck(stockBuild('light4x4'))
    expect(climbFactor(stock)).toBeCloseTo(HILL_CLIMB.climbShare, 6)
    const light = { ...stock, runMass: stock.runMass * 0.85 }
    expect(climbFactor(light)).toBeGreaterThan(climbFactor(stock))
    expect(climbFactor(light)).toBeLessThanOrEqual(HILL_CLIMB.climbLimits[1])
  })

  it('takes every stock truck to the top at Steady', () => {
    for (const c of CLASSES) {
      const r = climb(c.id, 'veteran', 'steady')
      expect(r.broken, c.id).toBeNull()
      expect(r.time, c.id).toBeGreaterThan(60)
    }
  })

  it('is quicker on Push than on Steady', () => {
    const steady = climb('light4x4', 'veteran', 'steady')
    const push = climb('light4x4', 'veteran', 'push')
    expect(push.time).not.toBeNull()
    expect(push.time!).toBeLessThan(steady.time!)
  })

  it('takes time off for every bottom-out, and gives no time for a break', () => {
    const truck = buildTruck(stockBuild('heavy'))
    const speeds = courseSpeeds(HILL, truck, 'veteran', 'steady')
    const lap = { lap: 1, speed: 1, peakTemp: [0, 0, 0, 0], bottomOuts: 0, peakCompression: [0, 0, 0, 0], damage: {} as never, endDistance: 0 }
    const fake = (bottomOuts: number, broken: LapRun['broken']): LapRun =>
      ({ laps: [{ ...lap, bottomOuts }], broken, brokenLap: broken ? 1 : 0, trace: null, wear: {} as never, history: {} as never, landings: [] })
    const clean = scoreRun(HILL, fake(0, null), speeds, 'veteran', 'steady')
    const bumpy = scoreRun(HILL, fake(4, null), speeds, 'veteran', 'steady')
    expect(bumpy.time! - clean.time!).toBeCloseTo(4 * HILL_CLIMB.bottomOutCost, 9)
    const ev = { kind: 'tire', corner: 0, zone: null, t: 10, distance: 300, speed: 10 } as unknown as NonNullable<LapRun['broken']>
    expect(scoreRun(HILL, fake(0, ev), speeds, 'veteran', 'steady').time).toBeNull()
  })
})

describe('rivals and standings', () => {
  it('gives the rivals the same runs every time', () => {
    for (const c of CLASSES) {
      const a = rivalRuns(HILL, c.id, rivalsIn(c.id))
      expect(rivalRuns(HILL, c.id, rivalsIn(c.id))).toEqual(a)
      expect(a.every((r) => r.runs.length === HILL.runs)).toBe(true)
    }
  })

  it('keeps the best run each, quickest first, with no-times last', () => {
    expect(bestOf([null, 120, 118.5])).toBe(118.5)
    expect(bestOf([null, null])).toBeNull()
    const mine: ContestRun[] = [{ pace: 'push', time: null, broken: null, bottomOuts: 0, lost: 0 }, { pace: 'steady', time: 130, broken: null, bottomOuts: 0, lost: 0 }]
    const rivals = [{ id: 'a', runs: [125, null] }, { id: 'b', runs: [null, null] }, { id: 'c', runs: [140, 135] }]
    expect(contestStandings(mine, rivals, 1).map((r) => r.who)).toEqual(['a', 'c', 'you', 'b'])
    expect(contestStandings(mine, rivals, 2).map((r) => r.who)).toEqual(['a', 'you', 'c', 'b'])
  })

  it('leaves the best rival within reach of a stock truck on Push with a quick driver', () => {
    const best = Math.min(...rivalRuns(HILL, 'light4x4', rivalsIn('light4x4')).map((r) => bestOf(r.runs) ?? Infinity))
    const push = climb('light4x4', 'charger', 'push')
    const steady = climb('light4x4', 'veteran', 'steady')
    expect(steady.time!).toBeGreaterThan(best)
    expect(push.time!).toBeLessThan(best * 1.05)
  })
})
