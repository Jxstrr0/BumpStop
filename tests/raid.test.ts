/**
 * The raid (plan PR 7): long stages that start from yesterday's wear, pace
 * calls, roadside fixes, the bivouac, rivals and the clips for the 3D
 * highlight.
 */
import { describe, expect, it } from 'vitest'
import { CLASS_WORK, DRIVERS, PACE_SPEED, RAID, RAIDS, ROADSIDE, STEADY_KMH, } from '../src/data/raids'
import { buildTruck, stockBuild } from '../src/sim/build'
import { CLIP, clipRecorder, type Clip } from '../src/sim/highlight'
import {
  advanceStage, bivouacJobs, checkJobs, closingTime, coolingTime, doJobs, driveStage, enterRaid, fatigueOf, finishStage,
  groundSpeed, leaveCheckpoint, parTime, raidTruck, stageLegs, standings, startStage, type Job, type RaidState,
} from '../src/sim/raid'
import { rivalStages, rivalsIn } from '../src/sim/rivals'
import { runStage, type StageSpec } from '../src/sim/stage'
import { fromCelsius } from '../src/sim/units'
import { newWearState, worstDamage } from '../src/sim/wear'

const AIR = fromCelsius(20)

describe('long stages for raids', { timeout: 60_000 }, () => {
  const truck = buildTruck(stockBuild('light4x4'))
  const spec: StageSpec = { airTemp: AIR, segments: [{ ground: 'rough', length: 12000, speed: 11 }, { ground: 'jumps', length: 6000, speed: 13 }] }

  it('recording clips only watches: the result is the same with or without', () => {
    const plain = runStage(truck.ride, spec, 4, 'sampled', truck.wear)
    const clips: Clip[] = []
    const watched = runStage(truck.ride, spec, 4, 'sampled', truck.wear, { clips: clipRecorder(clips, 0, 0) })
    expect(watched).toEqual(plain)
    expect(clips.length).toBeGreaterThan(0)
  })

  it('starts from carried-over wear and never changes the original', () => {
    const first = runStage(truck.ride, spec, 4, 'sampled', truck.wear)
    const carried = first.wear!.state
    const before = JSON.stringify(carried)
    const second = runStage(truck.ride, spec, 5, 'sampled', truck.wear, { wear: carried })
    expect(JSON.stringify(carried)).toBe(before)
    expect(worstDamage(second.wear!.state)).toBeGreaterThanOrEqual(worstDamage(carried))
    const fresh = runStage(truck.ride, spec, 5, 'sampled', truck.wear)
    expect(worstDamage(second.wear!.state)).toBeGreaterThan(worstDamage(fresh.wear!.state))
  })

  it('takes a separate oil temperature for each damper', () => {
    const hot = fromCelsius(110)
    const r = runStage(truck.ride, { airTemp: AIR, oilTemp: [hot, AIR, AIR, AIR], segments: [{ ground: 'graded', length: 300, speed: 20 }] }, 1)
    expect(r.peakTemp[0]).toBeGreaterThan(r.peakTemp[1]! + 50)
  })

  it('keeps a trace of the hottest oil and the worst wear along the stage', () => {
    const r = runStage(truck.ride, spec, 4, 'sampled', truck.wear)
    const tr = r.trace
    expect(tr.distance.length).toBeGreaterThan(10)
    expect(tr.oil.length).toBe(tr.distance.length)
    expect(tr.wear.length).toBe(tr.distance.length)
    for (let k = 1; k < tr.distance.length; k++) {
      expect(tr.distance[k]!).toBeGreaterThanOrEqual(tr.distance[k - 1]! - 1e-6)
      expect(tr.wear[k]!).toBeGreaterThanOrEqual(tr.wear[k - 1]! - 1e-9)
    }
    expect(tr.distance[tr.distance.length - 1]).toBeCloseTo(r.distance, 3)
    expect(Math.max(...tr.oil)).toBeCloseTo(Math.max(...r.peakTemp), 0)
  })
})

describe('clips for the 3D highlight', { timeout: 60_000 }, () => {
  it('each clip has the road under it, with room for the camera, and is about five seconds long', () => {
    const state = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const run = startStage(state, raidTruck(state), 'steady')
    driveStage(state, run, ['steady', 'steady', 'steady'])
    expect(run.clips.length).toBeGreaterThan(10)
    for (const c of run.clips) {
      const first = c.poses[0]!
      const last = c.poses[c.poses.length - 1]!
      expect(first.x).toBeGreaterThanOrEqual(CLIP.behind - 0.5)
      expect(last.x + CLIP.ahead).toBeLessThanOrEqual(c.road.length + 0.5)
      if (!c.broken) expect(last.t - first.t).toBeGreaterThan(CLIP.seconds * 0.9)
      expect(c.at).toBeGreaterThanOrEqual(0)
      expect(c.at).toBeLessThanOrEqual(run.at)
    }
    for (let k = 1; k < run.clips.length; k++) expect(run.clips[k]!.at).toBeGreaterThan(run.clips[k - 1]!.at)
  })
})

describe('stages, legs and speeds', () => {
  it('cuts each stage into three legs at the checkpoints, covering every metre', () => {
    for (const raid of Object.values(RAIDS)) {
      for (const stage of raid.stages) {
        const legs = stageLegs('light4x4', stage)
        expect(legs).toHaveLength(3)
        const total = stage.segments.reduce((s, x) => s + x.km, 0) * 1000
        expect(legs[0]!.from).toBe(0)
        expect(legs[2]!.to).toBe(total)
        for (const leg of legs) {
          expect(leg.segments.reduce((s, x) => s + x.length, 0)).toBeCloseTo(leg.to - leg.from, 6)
          expect(leg.to - leg.from).toBeGreaterThan(total / 5)
        }
        expect(legs.reduce((s, l) => s + l.par, 0)).toBeCloseTo(parTime('light4x4', stage.segments.map((x) => ({ ground: x.ground, length: x.km * 1000 }))), 6)
      }
    }
  })

  it('pushes faster and conserves slower; a hard driver goes faster on harsh ground only', () => {
    const truck = buildTruck(stockBuild('light4x4'))
    const steady = groundSpeed(truck, 'gravelAce', 'rough', 'steady')
    expect(groundSpeed(truck, 'gravelAce', 'rough', 'push') / steady).toBeCloseTo(PACE_SPEED.push, 9)
    expect(groundSpeed(truck, 'gravelAce', 'rough', 'conserve') / steady).toBeCloseTo(PACE_SPEED.conserve, 9)
    const hard = groundSpeed(truck, 'charger', 'rocks', 'steady') / DRIVERS.charger.speed
    const smooth = groundSpeed(truck, 'veteran', 'rocks', 'steady') / DRIVERS.veteran.speed
    expect(hard).toBeGreaterThan(smooth)
    const hardGraded = groundSpeed(truck, 'charger', 'graded', 'steady') / DRIVERS.charger.speed
    const smoothGraded = groundSpeed(truck, 'veteran', 'graded', 'steady') / DRIVERS.veteran.speed
    expect(hardGraded).toBeCloseTo(smoothGraded, 9)
    expect(steady).toBeCloseTo((STEADY_KMH.light4x4.rough / 3.6) * DRIVERS.gravelAce.speed, 9)
  })

  it('a stronger engine is quicker on fast ground, within limits', () => {
    const stock = buildTruck(stockBuild('light4x4'))
    const big = stockBuild('light4x4')
    big.parts.engine = 'petrolV8'
    const v8 = buildTruck(big)
    expect(groundSpeed(v8, 'gravelAce', 'graded', 'steady')).toBeGreaterThan(groundSpeed(stock, 'gravelAce', 'graded', 'steady'))
    expect(groundSpeed(v8, 'gravelAce', 'rocks', 'steady')).toBe(groundSpeed(stock, 'gravelAce', 'rocks', 'steady'))
    expect(groundSpeed(v8, 'gravelAce', 'graded', 'steady') / groundSpeed(stock, 'gravelAce', 'graded', 'steady')).toBeLessThanOrEqual(RAID.powerLimits[1] + 1e-9)
  })
})

/** A raid whose only stage is short, for quick tests. */
function shortRaid(spares: string, driver: 'veteran' | 'mechanic' = 'veteran'): RaidState {
  const b = stockBuild('light4x4')
  b.parts.spares = spares
  return enterRaid('summerSprint', b, driver)
}

describe('driving a stage', { timeout: 60_000 }, () => {
  it('stops at each checkpoint for the next pace call, then finishes', () => {
    const state = shortRaid('lightKit')
    const run = startStage(state, raidTruck(state), 'steady')
    let guard = 0
    while (run.status === 'driving' && guard++ < 100) advanceStage(state, run)
    expect(run.status).toBe('checkpoint')
    expect(run.at).toBeCloseTo(run.legs[0]!.to, 0)
    leaveCheckpoint(run, 'push')
    while (run.status === 'driving' && guard++ < 200) advanceStage(state, run)
    expect(run.status).toBe('checkpoint')
    leaveCheckpoint(run, 'conserve')
    while (run.status === 'driving' && guard++ < 300) advanceStage(state, run)
    expect(run.status).toBe('finished')
    expect(run.paces).toEqual(['steady', 'push', 'conserve'])
    expect(run.at).toBeCloseTo(run.legs[2]!.to, 0)
  })

  it('is the same every time for the same entry and pace calls', () => {
    const go = () => {
      const state = shortRaid('lightKit')
      const run = startStage(state, raidTruck(state), 'push')
      driveStage(state, run, ['push', 'steady', 'push'])
      return finishStage(state, run)
    }
    expect(go()).toEqual(go())
  })

  it('a clean stage takes the time the speeds say', () => {
    const state = shortRaid('lightKit')
    const truck = raidTruck(state)
    const run = startStage(state, truck, 'conserve')
    driveStage(state, run, ['conserve', 'conserve', 'conserve'])
    expect(run.stops).toEqual([])
    let expected = 0
    for (const leg of run.legs) {
      for (const s of leg.segments) {
        const line = DRIVERS.veteran.skill.includes(s.ground) ? DRIVERS.veteran.skillTime : 1
        expected += (s.length / groundSpeed(truck, 'veteran', s.ground, 'conserve')) * line
      }
    }
    expect(run.time).toBeCloseTo(expected, 3)
  })
})

describe('roadside fixes', { timeout: 60_000 }, () => {
  /** Drive a stage with a truck so fragile it's sure to break. */
  function fragile(spares: string, driver: 'veteran' | 'mechanic' = 'veteran') {
    const state = shortRaid(spares, driver)
    state.stage = 1 // Rock country: sharp rocks for the tires.
    const truck = raidTruck(state)
    for (const ax of [truck.wear.front, truck.wear.rear]) {
      ax.tire.pinchAt *= 0.6
      ax.tire.bruiseFrom *= 0.6
    }
    const run = startStage(state, truck, 'push')
    driveStage(state, run, ['push', 'push', 'push'])
    return { state, run }
  }

  it('fits a spare when there is one, then bodges', () => {
    const { run } = fragile('lightKit')
    const tires = run.stops.filter((s) => s.kind === 'tire')
    expect(tires.length).toBeGreaterThanOrEqual(2)
    expect(tires[0]!.fix).toBe('spare')
    expect(tires[0]!.lost).toBeCloseTo(ROADSIDE.tire.withSpare * 3600 * CLASS_WORK.light4x4, 6)
    expect(tires[1]!.fix).toBe('bodge')
    expect(tires[1]!.lost).toBeCloseTo(ROADSIDE.tire.bodge * 3600 * CLASS_WORK.light4x4, 6)
    expect(run.spares.tire).toBe(0)
  })

  it('the mechanic fixes things quicker', () => {
    const a = fragile('noSpares', 'veteran').run.stops[0]!
    const b = fragile('noSpares', 'mechanic').run.stops[0]!
    expect(b.lost / a.lost).toBeCloseTo(DRIVERS.mechanic.fixTime, 6)
  })

  it('eases off a pace call after each stop, and limps in after too many', () => {
    const { run } = fragile('noSpares')
    const firstLeg = run.stops.filter((s) => s.leg === 0)
    expect(firstLeg.length).toBeGreaterThan(0)
    expect(firstLeg.length).toBeLessThanOrEqual(RAID.maxStopsPerLeg)
    if (firstLeg.length === RAID.maxStopsPerLeg) expect(run.limped).toBe(true)
  })

  it('a faded damper is left to cool for as long as the physics says', () => {
    const state = shortRaid('noSpares')
    const run = startStage(state, raidTruck(state), 'steady')
    const d = run.truck.ride.front.damper
    run.oil = [d.redLine + 5, run.airTemp, run.airTemp, run.airTemp]
    const t = coolingTime(run)
    const hot = d.redLine + 5 - run.airTemp
    // Standing still, the oil heads for the air temperature, a fixed share closer each second.
    const physics = (d.heatCapacity / d.coolStill) * Math.log(hot / (d.warmFrom - run.airTemp))
    expect(t).toBeCloseTo(Math.max(RAID.coolMin, physics), 3)
    run.oil[0] = d.redLine + 60
    expect(coolingTime(run)).toBeGreaterThan(t)
  })

  it('a stage that runs past closing time is towed in with a penalty', () => {
    const state = shortRaid('noSpares')
    const run = startStage(state, raidTruck(state), 'steady')
    run.time = closingTime(run) + 1
    advanceStage(state, run)
    expect(run.status).toBe('finished')
    const rec = finishStage(state, run)
    expect(rec.late).toBe(true)
    expect(rec.time).toBeCloseTo(closingTime(run) + RAID.latePenalty, 6)
  })
})

describe('the bivouac', { timeout: 60_000 }, () => {
  function afterStage(spares: string): RaidState {
    const state = shortRaid(spares)
    const run = startStage(state, raidTruck(state), 'push')
    driveStage(state, run, ['push', 'push', 'push'])
    finishStage(state, run)
    // Make sure there's work to do.
    state.wear.tire[0]!.damage = 0.8
    state.wear.mount[2]!.damage = 0.5
    state.wear.frame[1]!.damage = 0.3
    return state
  }

  it('lists jobs for worn parts, worst first, with the class hours', () => {
    const state = afterStage('lightKit')
    const jobs = bivouacJobs(state)
    expect(jobs.length).toBeGreaterThan(0)
    for (let k = 1; k < jobs.length; k++) expect(jobs[k]!.damage).toBeLessThanOrEqual(jobs[k - 1]!.damage)
    for (const j of jobs) expect(j.damage).toBeGreaterThanOrEqual(RAID.jobFrom)
    const tire = jobs.filter((j) => j.part === 'tire' && j.index === 0)
    expect(tire.map((j) => j.kind).sort()).toEqual(['newTire', 'patchTire'])
  })

  it('checks hours, spares and one job per part', () => {
    const state = afterStage('noSpares')
    const jobs = bivouacJobs(state)
    const newTire = jobs.find((j) => j.kind === 'newTire')!
    expect(checkJobs(state, [newTire])).toEqual({ kind: 'spare', spare: 'tire' })
    const patch = jobs.find((j) => j.kind === 'patchTire' && j.index === 0)!
    expect(checkJobs(state, [patch, { ...patch }])).toEqual({ kind: 'twice', part: 'tire', index: 0 })
    const big: Job = { ...patch, hours: RAID.bivouacHours + 1 }
    expect(checkJobs(state, [big])?.kind).toBe('hours')
    expect(checkJobs(state, [patch])).toBeNull()
  })

  it('does the jobs: new parts start fresh, welds and patches leave some wear, spares get used', () => {
    const state = afterStage('lightKit')
    const jobs = bivouacJobs(state)
    const pick = [
      jobs.find((j) => j.kind === 'newTire' && j.index === 0)!,
      jobs.find((j) => j.kind === 'weldMount' && j.index === 2)!,
      jobs.find((j) => j.kind === 'weldFrame' && j.index === 1)!,
    ]
    const tiresBefore = state.spares.tire
    doJobs(state, pick)
    expect(fatigueOf(state.wear, 'tire', 0).damage).toBe(0)
    expect(fatigueOf(state.wear, 'mount', 2).damage).toBeCloseTo(0.5 * 0.3, 9)
    expect(fatigueOf(state.wear, 'frame', 1).damage).toBeCloseTo(0.3 * 0.4, 9)
    expect(state.spares.tire).toBe(tiresBefore - 1)
    expect(state.phase).toBe('morning')
  })

  it('what is left worn carries into the next stage', () => {
    const state = afterStage('noSpares')
    doJobs(state, [])
    const run = startStage(state, raidTruck(state), 'steady')
    expect(fatigueOf(run.wear, 'tire', 0).damage).toBe(0.8)
  })

  it('retuned settings drive the next stage, but the parts stay locked', () => {
    const state = shortRaid('lightKit')
    const other = stockBuild('light4x4')
    other.parts.engine = 'petrolV8'
    other.front.tirePressure += 40000
    const truck = raidTruck(state, other)
    expect(truck.build.parts.engine).toBe(state.entry.build.parts.engine)
    expect(truck.build.front.tirePressure).toBe(other.front.tirePressure)
    expect(raidTruck(state, stockBuild('heavy')).build.cls).toBe('light4x4')
  })
})

describe('rivals and standings', () => {
  it('every class has rivals, and their results are the same every time', () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      expect(rivalsIn(cls).length).toBeGreaterThanOrEqual(3)
      const a = rivalStages(cls, [3000, 3000, 3000], 100, 0.3, 9)
      expect(a).toEqual(rivalStages(cls, [3000, 3000, 3000], 100, 0.3, 9))
      for (const r of a) {
        expect(r.splits).toHaveLength(3)
        for (let k = 1; k < 3; k++) expect(r.splits[k]!).toBeGreaterThan(r.splits[k - 1]!)
        if (!r.late) expect(r.time).toBeCloseTo(r.splits[2]!, 6)
      }
    }
  })

  it('harsher stages bring more rival trouble', () => {
    let mild = 0
    let harsh = 0
    for (let seed = 0; seed < 200; seed++) {
      mild += rivalStages('light4x4', [3000, 3000, 3000], 100, 0.1, seed).filter((r) => r.trouble).length
      harsh += rivalStages('light4x4', [3000, 3000, 3000], 100, 0.5, seed).filter((r) => r.trouble).length
    }
    expect(harsh).toBeGreaterThan(mild * 2)
  })

  it('adds up the class standings over the stages', () => {
    const state = shortRaid('lightKit')
    const run = startStage(state, raidTruck(state), 'steady')
    driveStage(state, run, ['steady', 'steady', 'steady'])
    const rec = finishStage(state, run)
    const table = standings(state)
    expect(table).toHaveLength(rivalsIn('light4x4').length + 1)
    expect(table.find((s) => s.who === 'you')!.time).toBe(rec.time)
    for (let k = 1; k < table.length; k++) expect(table[k]!.time).toBeGreaterThanOrEqual(table[k - 1]!.time)
    expect(state.phase).toBe('bivouac')
  })

  it('a new raid starts with fresh parts and the spares kit', () => {
    const state = shortRaid('fullKit')
    expect(state.wear).toEqual(newWearState())
    expect(state.spares).toEqual({ tire: 2, shock: 2, cv: 2 })
  })
})
