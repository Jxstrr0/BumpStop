/**
 * One-day events (Kelbo picked them, 28 November 2026): the hill climb's
 * course runs through the ride sim like a rig, a stock truck makes the top
 * at Steady, Push is quicker, bottom-outs cost time, and the rivals and
 * standings come out the same every time.
 */
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { CONTEST_IDS, CONTESTS, HILL_CLIMB, JUMP_OFF, SPEED_TRIAL } from '../src/data/contests'
import { t } from '../src/data/strings'
import { buildTruck, stockBuild } from '../src/sim/build'
import {
  bestOf, climbFactor, contestStandings, courseLength, courseRig, courseSeed, courseSpeeds, jumpRig, passKmh, passRig, rivalRuns, scoreJump, scorePasses, scoreRun, type ContestRun,
} from '../src/sim/contest'
import { runLaps, type LapRun } from '../src/sim/laps'
import { rivalsIn } from '../src/sim/rivals'
import { fromCelsius } from '../src/sim/units'

const HILL = CONTESTS.hillClimb
/** These drive whole runs through the ride sim: a second or so each here, more on a busy CI machine. */
const SLOW = 60_000

function climb(cls: (typeof CLASSES)[number]['id'], driver: 'veteran' | 'charger', pace: 'conserve' | 'steady' | 'push'): ContestRun {
  const truck = buildTruck(stockBuild(cls))
  const speeds = courseSpeeds(HILL, truck, driver, pace)
  const run = runLaps(truck.ride, truck.wear, courseRig(HILL, speeds), courseSeed(HILL, cls), { airTemp: fromCelsius(HILL.airC), trace: false })
  return scoreRun(HILL, run, speeds, driver, pace)
}

describe('the events table', () => {
  it('has a name and a line for every event, and a course of real length (a jump contest just one jump)', () => {
    for (const id of CONTEST_IDS) {
      const c = CONTESTS[id]
      expect(c.id).toBe(id)
      expect(t(c.name)).toBeTruthy()
      expect(t(c.text)).toBeTruthy()
      expect(courseLength(c)).toBeGreaterThanOrEqual(c.kind === 'judged' ? 150 : 1000)
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
      expect(r.score, c.id).toBeGreaterThan(60)
    }
  }, SLOW)

  it('is quicker on Push than on Steady', () => {
    const steady = climb('light4x4', 'veteran', 'steady')
    const push = climb('light4x4', 'veteran', 'push')
    expect(push.score).not.toBeNull()
    expect(push.score!).toBeLessThan(steady.score!)
  }, SLOW)

  it('takes time off for every bottom-out, and gives no time for a break', () => {
    const truck = buildTruck(stockBuild('heavy'))
    const speeds = courseSpeeds(HILL, truck, 'veteran', 'steady')
    const lap = { lap: 1, speed: 1, peakTemp: [0, 0, 0, 0], bottomOuts: 0, peakCompression: [0, 0, 0, 0], damage: {} as never, endDistance: 0 }
    const fake = (bottomOuts: number, broken: LapRun['broken']): LapRun =>
      ({ laps: [{ ...lap, bottomOuts }], broken, brokenLap: broken ? 1 : 0, trace: null, wear: {} as never, history: {} as never, landings: [] })
    const clean = scoreRun(HILL, fake(0, null), speeds, 'veteran', 'steady')
    const bumpy = scoreRun(HILL, fake(4, null), speeds, 'veteran', 'steady')
    expect(bumpy.score! - clean.score!).toBeCloseTo(4 * HILL_CLIMB.bottomOutCost, 9)
    const ev = { kind: 'tire', corner: 0, zone: null, t: 10, distance: 300, speed: 10 } as unknown as NonNullable<LapRun['broken']>
    expect(scoreRun(HILL, fake(0, ev), speeds, 'veteran', 'steady').score).toBeNull()
  })
})

const MILE = CONTESTS.speedTrial

function trial(cls: (typeof CLASSES)[number]['id'], dampers?: string): ContestRun {
  const b = stockBuild(cls)
  if (dampers) b.parts.dampers = dampers
  const truck = buildTruck(b)
  return scorePasses(MILE, runLaps(truck.ride, truck.wear, passRig(MILE), courseSeed(MILE, cls), { airTemp: fromCelsius(MILE.airC), trace: false }))
}

describe('the speed trial', () => {
  it('runs the mile faster every pass, from the first pass speed', () => {
    const rig = passRig(MILE)
    expect(rig.startSpeed * 3.6).toBeCloseTo(MILE.passes!.startKmh, 9)
    expect(rig.speedStep * 3.6).toBeCloseTo(MILE.passes!.stepKmh, 9)
    expect(passKmh(MILE, 3)).toBe(MILE.passes!.startKmh + 2 * MILE.passes!.stepKmh)
  })

  it('ends every stock truck on a fade, at the top pass the rivals are measured from', () => {
    for (const c of CLASSES) {
      const r = trial(c.id)
      expect(r.broken?.kind, c.id).toBe('fade')
      expect(r.score, c.id).toBe(SPEED_TRIAL.stockTop[c.id])
    }
  }, SLOW)

  it('goes faster with dampers that shed more heat', () => {
    expect(trial('light4x4', 'remoteReservoir').score!).toBeGreaterThan(trial('light4x4').score!)
    expect(trial('sxs', 'remoteReservoir').score!).toBeGreaterThan(trial('sxs').score!)
  }, SLOW)

  it('gives the rivals passes on the event\'s steps, the same every time', () => {
    for (const c of CLASSES) {
      const runs = rivalRuns(MILE, c.id, rivalsIn(c.id))
      expect(rivalRuns(MILE, c.id, rivalsIn(c.id))).toEqual(runs)
      for (const r of runs.flatMap((x) => x.runs)) {
        if (r === null) continue
        expect((r - MILE.passes!.startKmh) % MILE.passes!.stepKmh).toBe(0)
        expect(r).toBeLessThanOrEqual(passKmh(MILE, MILE.passes!.most))
      }
    }
  })

  it('ranks the fastest pass first', () => {
    const mine: ContestRun[] = [{ pace: 'steady', score: 90, broken: null, bottomOuts: 0, lost: 0 }]
    const rivals = [{ id: 'a', runs: [95] }, { id: 'b', runs: [null] }, { id: 'c', runs: [85] }]
    expect(contestStandings('topSpeed', mine, rivals, 1).map((r) => r.who)).toEqual(['a', 'you', 'c', 'b'])
    expect(bestOf([80, null, 95], 'topSpeed')).toBe(95)
  })
})

const FAIR = CONTESTS.jumpOff

function jump(cls: (typeof CLASSES)[number]['id'], kmh: number): ContestRun {
  const truck = buildTruck(stockBuild(cls))
  return scoreJump(runLaps(truck.ride, truck.wear, jumpRig(FAIR, kmh), courseSeed(FAIR, cls), { airTemp: fromCelsius(FAIR.airC), trace: false }), kmh)
}

describe('the jump contest', () => {
  it('jumps the tabletop once an attempt, at the speed called', () => {
    const rig = jumpRig(FAIR, 58)
    expect(rig.maxLaps).toBe(1)
    expect(rig.startSpeed * 3.6).toBeCloseTo(58, 9)
    expect(rig.pieces[0]!.table).toEqual(FAIR.course[0]!.table)
  })

  it('pays the landing plus the crowd\'s points for distance', () => {
    const r = jump('heavy', 54)
    expect(r.landing).toBeTruthy()
    expect(r.air).toBe(Math.round(r.landing!.flown * JUMP_OFF.perMetre))
    expect(r.score).toBe(r.landing!.score + r.air!)
  })

  it('flies further when faster, and lands worse past the slope', () => {
    const slow = jump('light4x4', 50)
    const fast = jump('light4x4', 66)
    expect(fast.landing!.flown).toBeGreaterThan(slow.landing!.flown)
    expect(fast.landing!.score).toBeLessThan(slow.landing!.score)
  })

  it('gives every stock truck the best jump the rivals are measured from', () => {
    for (const c of CLASSES) {
      const best = Math.max(...FAIR.speeds!.map((k) => jump(c.id, k).score ?? 0))
      expect(best, c.id).toBe(JUMP_OFF.stockBest[c.id])
    }
  }, SLOW)

  it('ranks the most points first, the same rivals every time', () => {
    const mine: ContestRun[] = [{ pace: 'steady', score: 110, broken: null, bottomOuts: 0, lost: 0 }]
    const rivals = [{ id: 'a', runs: [120] }, { id: 'b', runs: [null] }, { id: 'c', runs: [100] }]
    expect(contestStandings('judged', mine, rivals, 1).map((r) => r.who)).toEqual(['a', 'you', 'c', 'b'])
    expect(rivalRuns(FAIR, 'sxs', rivalsIn('sxs'))).toEqual(rivalRuns(FAIR, 'sxs', rivalsIn('sxs')))
  })
})

const PIT = CONTESTS.shortCourse

function heat(cls: (typeof CLASSES)[number]['id'], driver: 'veteran' | 'charger', pace: 'conserve' | 'steady' | 'push'): { run: ContestRun; peak: number[] } {
  const truck = buildTruck(stockBuild(cls))
  const speeds = courseSpeeds(PIT, truck, driver, pace)
  const laps = runLaps(truck.ride, truck.wear, courseRig(PIT, speeds), courseSeed(PIT, cls), { airTemp: fromCelsius(PIT.airC), trace: false })
  return { run: scoreRun(PIT, laps, speeds, driver, pace), peak: laps.laps.map((l) => Math.max(...l.peakTemp)) }
}

describe('the short course', () => {
  it('runs every lap of the course, and times them all', () => {
    const truck = buildTruck(stockBuild('heavy'))
    const speeds = courseSpeeds(PIT, truck, 'veteran', 'conserve')
    expect(courseRig(PIT, speeds).maxLaps).toBe(PIT.timed!.laps)
    const { run, peak } = heat('heavy', 'veteran', 'conserve')
    expect(peak.length).toBe(PIT.timed!.laps)
    const lap = PIT.course.reduce((sum, p, i) => sum + p.length / speeds[i]!, 0)
    expect(run.score!).toBeGreaterThan(lap * PIT.timed!.laps * 0.9)
  }, SLOW)

  it('takes every stock truck to the flag at Steady with the veteran', () => {
    for (const c of CLASSES) expect(heat(c.id, 'veteran', 'steady').run.broken, c.id).toBeNull()
  }, SLOW)

  it('adds up the heat lap by lap, and more of it on Push', () => {
    const steady = heat('sxs', 'veteran', 'steady').peak
    const push = heat('sxs', 'veteran', 'push').peak
    for (let i = 1; i < steady.length; i++) expect(steady[i]!).toBeGreaterThan(steady[i - 1]!)
    expect(push[push.length - 1]!).toBeGreaterThan(steady[steady.length - 1]!)
  }, SLOW)
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
    const mine: ContestRun[] = [{ pace: 'push', score: null, broken: null, bottomOuts: 0, lost: 0 }, { pace: 'steady', score: 130, broken: null, bottomOuts: 0, lost: 0 }]
    const rivals = [{ id: 'a', runs: [125, null] }, { id: 'b', runs: [null, null] }, { id: 'c', runs: [140, 135] }]
    expect(contestStandings('timed', mine, rivals, 1).map((r) => r.who)).toEqual(['a', 'c', 'you', 'b'])
    expect(contestStandings('timed', mine, rivals, 2).map((r) => r.who)).toEqual(['a', 'you', 'c', 'b'])
  })

  it('leaves the best rival within reach of a stock truck on Push with a quick driver', () => {
    const best = Math.min(...rivalRuns(HILL, 'light4x4', rivalsIn('light4x4')).map((r) => bestOf(r.runs) ?? Infinity))
    const push = climb('light4x4', 'charger', 'push')
    const steady = climb('light4x4', 'veteran', 'steady')
    expect(steady.score!).toBeGreaterThan(best)
    expect(push.score!).toBeLessThan(best * 1.05)
  }, SLOW)
})
