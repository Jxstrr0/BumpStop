/**
 * Weather that changes mid-stage (Kelbo, 26 November 2026): the forecast is
 * honest, clear days are untouched, and once the weather turns the stage is
 * slower, rougher and, in a whiteout, Push slides at the tightest corner.
 */
import { describe, expect, it } from 'vitest'
import type { ClassId } from '../src/data/classes'
import { RAID_IDS, RAIDS, type PaceId } from '../src/data/raids'
import { CLEAR, WEATHER, WEATHER_ROLL, type WeatherId } from '../src/data/weather'
import { readSave, newSave, SaveFormatError } from '../src/persist/save'
import { stockBuild } from '../src/sim/build'
import { buildProfile } from '../src/sim/ground'
import { airNow, driveStage, enterRaid, finishStage, raidTruck, raidWeather, stageKm, stageLegs, startStage, type StageRun } from '../src/sim/raid'
import { Rng } from '../src/sim/rng'
import { forecastWord, stageWeather, weatherOn, type StageWeather } from '../src/sim/weather'

describe('the forecast', () => {
  it('fits the season and the air, and its window holds the place it turns', () => {
    let forecasts = 0
    let days = 0
    let came = 0
    let expected = 0
    for (let seed = 1; seed <= 300; seed++) {
      for (const id of RAID_IDS) {
        const raid = RAIDS[id]
        raid.stages.forEach((spec, i) => {
          days++
          const km = stageKm(spec)
          const w = stageWeather(seed, i, spec, raid.season, km)
          expect(stageWeather(seed, i, spec, raid.season, km)).toEqual(w)
          if (!w) return
          forecasts++
          const spec2 = WEATHER[w.kind]
          expect(spec2.season).toBe(raid.season)
          expect(spec.airC).toBeGreaterThanOrEqual(spec2.airC[0])
          expect(spec.airC).toBeLessThanOrEqual(spec2.airC[1])
          expect(WEATHER_ROLL.chances).toContain(w.chance)
          expect(w.from).toBeLessThanOrEqual(w.at)
          expect(w.at).toBeLessThanOrEqual(w.to)
          expect(w.from).toBeGreaterThanOrEqual(0)
          expect(w.to).toBeLessThanOrEqual(km * 1000)
          expect(w.at).toBeGreaterThanOrEqual(WEATHER_ROLL.from * km * 1000 - 1)
          if (w.comes) came++
          expected += w.chance
        })
      }
    }
    // About the share the roll says, and it comes about as often as the forecasts say.
    expect(forecasts / days).toBeGreaterThan(WEATHER_ROLL.forecast - 0.05)
    expect(forecasts / days).toBeLessThan(WEATHER_ROLL.forecast + 0.05)
    expect(Math.abs(came - expected) / forecasts).toBeLessThan(0.05)
  })

  it('has a word for every chance', () => {
    expect(WEATHER_ROLL.chances.map(forecastWord)).toEqual(['possible', 'likely', 'expected'])
  })

  it('is the same for every entry of the same raid', () => {
    const a = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const b = enterRaid('summerSprint', stockBuild('sxs'), 'charger')
    expect(raidWeather(a)).toEqual(raidWeather(b))
  })
})

describe('the ground in the weather', () => {
  it('a clear day builds exactly the road it always did', () => {
    for (const g of ['graded', 'washboard', 'rocks', 'jumps', 'iceHeaves', 'snow'] as const) {
      expect(buildProfile(g, 400, new Rng(9), CLEAR)).toEqual(buildProfile(g, 400, new Rng(9)))
    }
  })

  it('a dust storm makes the same rocks hit bigger; a thaw softens the grip', () => {
    const clear = buildProfile('rocks', 400, new Rng(4))
    const dust = buildProfile('rocks', 400, new Rng(4), WEATHER.dust.mod)
    const top = (p: typeof clear) => Math.max(...p.left, ...p.right)
    expect(top(dust)).toBeGreaterThan(top(clear) * 1.2)
    expect(buildProfile('graded', 400, new Rng(4), WEATHER.thaw.mod).grip).toBe(WEATHER.thaw.mod.grip)
    expect(clear.grip).toBeUndefined()
  })
})

/** A raid stage with the weather set by hand: turning at `at` metres, or a clear day. */
function stageWith(raid: 'summerSprint' | 'winterSprint', cls: ClassId, stage: number, kind: WeatherId | null, at = 0, studs = false): { run: StageRun; state: ReturnType<typeof enterRaid> } {
  const b = stockBuild(cls)
  b.parts.spares = 'lightKit'
  if (studs) b.parts.tires = cls === 'heavy' ? 'studdedPly' : 'studdedRally'
  const state = enterRaid(raid, b, 'gravelAce')
  state.stage = stage
  const run = startStage(state, raidTruck(state), 'steady')
  const w: StageWeather | null = kind ? { kind, chance: 1, from: 0, to: at, comes: true, at } : null
  run.weather = w
  return { run, state }
}

describe('a stage when the weather turns', { timeout: 120_000 }, () => {
  it('the Summer Sprint’s first day: a thaw comes in, the par and the rivals slow down, and the record keeps it', () => {
    const state = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const w = raidWeather(state)!
    expect(w.kind).toBe('thaw')
    expect(w.comes).toBe(true)
    const run = startStage(state, raidTruck(state), 'steady')
    const clearPar = stageLegs('light4x4', RAIDS.summerSprint.stages[0]!).reduce((s, l) => s + l.par, 0)
    expect(run.legs.reduce((s, l) => s + l.par, 0)).toBeGreaterThan(clearPar)
    expect(weatherOn(run.weather, w.at - 10)).toBe(false)
    expect(weatherOn(run.weather, w.at)).toBe(true)
    driveStage(state, run, ['steady', 'steady', 'steady'])
    // The trace has a point right at the turn: the piece of ground was cut there.
    expect(run.trace.distance.some((d) => Math.abs(d - w.at) < 1)).toBe(true)
    const rec = finishStage(state, run)
    expect(rec.weather).toEqual(w)
  })

  it('every kind costs time against a clear day on the same road', () => {
    const cases: [WeatherId, 'summerSprint' | 'winterSprint', number][] = [['thaw', 'summerSprint', 0], ['dust', 'summerSprint', 0], ['whiteout', 'winterSprint', 1]]
    for (const [kind, raid, stage] of cases) {
      const clear = stageWith(raid, 'heavy', stage, null, 0, raid === 'winterSprint')
      const wet = stageWith(raid, 'heavy', stage, kind, 0, raid === 'winterSprint')
      driveStage(clear.state, clear.run, ['steady', 'steady', 'steady'])
      driveStage(wet.state, wet.run, ['steady', 'steady', 'steady'])
      expect(wet.run.time, kind).toBeGreaterThan(clear.run.time * 1.1)
    }
  })

  it('the air changes once it turns: hot in a dust storm, colder in a whiteout and a thaw', () => {
    const dust = stageWith('summerSprint', 'light4x4', 0, 'dust', 5000)
    expect(airNow(dust.run)).toBe(dust.run.airTemp)
    dust.run.at = 6000
    expect(airNow(dust.run)).toBe(dust.run.airTemp + WEATHER.dust.airK)
    expect(WEATHER.dust.airK).toBeGreaterThan(0)
    expect(WEATHER.whiteout.airK).toBeLessThan(0)
    expect(WEATHER.thaw.airK).toBeLessThan(0)
  })

  it('in a whiteout Push slides into the snowbank on studs; Steady stays on the road', () => {
    const drive = (pace: PaceId) => {
      const { run, state } = stageWith('winterSprint', 'light4x4', 1, 'whiteout', 0, true)
      run.paces[0] = pace
      driveStage(state, run, [pace, pace, pace])
      return run.stops.filter((s) => s.kind === 'slide').length
    }
    expect(drive('push')).toBeGreaterThan(0)
    expect(drive('steady')).toBe(0)
    // On a clear day studs keep Push on the road (plan PR 10b).
    const { run, state } = stageWith('winterSprint', 'light4x4', 1, null, 0, true)
    run.paces[0] = 'push'
    driveStage(state, run, ['push', 'push', 'push'])
    expect(run.stops.filter((s) => s.kind === 'slide')).toEqual([])
  })
})

describe('saves', () => {
  it('turn away a stage result with broken weather', () => {
    const s = newSave()
    s.raid = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const run = startStage(s.raid, raidTruck(s.raid), 'steady')
    driveStage(s.raid, run, ['steady', 'steady', 'steady'])
    finishStage(s.raid, run)
    const good = JSON.parse(JSON.stringify(s))
    expect(readSave(good).raid!.results[0]!.weather?.kind).toBe('thaw')
    const bad = JSON.parse(JSON.stringify(s))
    bad.raid.results[0].weather.kind = 'hail'
    expect(() => readSave(bad)).toThrow(SaveFormatError)
    // Saves from before the weather have none, and load.
    const old = JSON.parse(JSON.stringify(s))
    delete old.raid.results[0].weather
    expect(readSave(old).raid!.results[0]!.weather).toBeUndefined()
  })
})
