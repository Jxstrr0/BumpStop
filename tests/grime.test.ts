/**
 * Damage you can see (Kelbo, 27 November 2026): mud, dust and snow build up
 * over a raid from what it really did, the bivouac knocks some off, and
 * dents sit where things went wrong. It's only a look: the sim never reads it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRIME } from '../src/data/grime'
import { TIERS } from '../src/data/graphics'
import { stockBuild } from '../src/sim/build'
import { raidGrime } from '../src/sim/grime'
import { driveStage, enterRaid, finishStage, raidTruck, startStage, type RaidState, type StageRecord, type Stop } from '../src/sim/raid'
import type { PaceId } from '../src/data/raids'
import type { StageWeather } from '../src/sim/weather'

/** A finished stage, made up: the pace calls, the stops and the weather. */
function record(paces: PaceId[], stops: Partial<Stop>[] = [], weather: StageWeather | null = null, guardHits = 0): StageRecord {
  return {
    time: 3600, paces, late: false, limped: false, rivals: [], weather, guardHits, leak: 0,
    stops: stops.map((s) => ({ leg: 0, at: 1000, kind: 'tire', corner: 0, zone: null, lost: 60, fix: 'spare', estimated: false, ...s })),
  }
}

function raidAfter(raid: 'summerSprint' | 'winterSprint' | 'longOne', recs: StageRecord[]): RaidState {
  const s = enterRaid(raid, stockBuild('light4x4'), 'veteran')
  s.results.push(...recs)
  s.stage = recs.length
  s.phase = 'morning'
  return s
}

const steady: PaceId[] = ['steady', 'steady', 'steady']

describe('grime: what builds up', () => {
  it('a new raid starts with a clean truck', () => {
    const g = raidGrime(enterRaid('summerSprint', stockBuild('heavy'), 'veteran'))
    expect([g.mud, g.dust, g.snow, g.chips, g.wet]).toEqual([0, 0, 0, 0, 0])
    expect(g.dents).toEqual([])
  })

  it('summer stages throw dust and some mud; winter stages pack snow and no dust', () => {
    const summer = raidAfter('summerSprint', [record(steady)])
    const winter = raidAfter('winterSprint', [record(steady)])
    const s = raidGrime(summer)
    const w = raidGrime(winter)
    expect(s.dust).toBeGreaterThan(0.1)
    expect(s.dust).toBeGreaterThan(s.mud)
    expect(s.snow).toBe(0)
    expect(w.snow).toBeGreaterThan(0.02)
    expect(w.dust).toBe(0)
    expect(w.season).toBe('winter')
  })

  it('every share stays between 0 and 1, even after the whole Long One at Push', () => {
    const push: PaceId[] = ['push', 'push', 'push']
    const s = raidAfter('longOne', Array.from({ length: 14 }, () => record(push, [], null, 5)))
    const g = raidGrime(s)
    for (const v of [g.mud, g.dust, g.snow, g.chips]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('Push throws more than Steady, and Conserve less', () => {
    const at = (p: PaceId) => raidGrime(raidAfter('summerSprint', [record([p, p, p])]))
    expect(at('push').dust).toBeGreaterThan(at('steady').dust)
    expect(at('conserve').dust).toBeLessThan(at('steady').dust)
    expect(at('push').chips).toBeGreaterThan(at('steady').chips)
  })

  it('it builds up along the stage being driven, and the night at the bivouac knocks some off', () => {
    const state = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const run = startStage(state, raidTruck(state), 'steady')
    run.paces = [...steady]
    const early = raidGrime(state, run, 5_000)
    const late = raidGrime(state, run, 60_000)
    const end = raidGrime(state, run, Infinity)
    expect(late.dust).toBeGreaterThan(early.dust)
    expect(end.dust).toBeGreaterThanOrEqual(late.dust)
    // The morning after (the same day's weather: this stage has a thaw): less than at the finish.
    const morning = raidGrime(raidAfter('summerSprint', [record(steady, [], run.weather)]))
    expect(morning.dust).toBeLessThan(end.dust)
    expect(morning.dust).toBeCloseTo(end.dust * GRIME.overnight.dust, 6)
  })

  it('the rest day washes more than a normal night', () => {
    const recs = Array.from({ length: 7 }, () => record(steady))
    const restDay = raidGrime(raidAfter('longOne', recs))
    const normal = raidGrime(raidAfter('longOne', recs.slice(0, 6)))
    expect(restDay.mud).toBeLessThan(normal.mud)
  })

  it('a thaw turns it to mud (fresh and shiny), a whiteout to snow', () => {
    const thaw: StageWeather = { kind: 'thaw', chance: 1, from: 0, to: 1000, comes: true, at: 500 }
    const clear = raidGrime(raidAfter('summerSprint', [record(steady)]))
    const wet = raidGrime(raidAfter('summerSprint', [record(steady, [], thaw)]))
    expect(wet.mud).toBeGreaterThan(clear.mud * 2)
    expect(wet.dust).toBeLessThan(clear.dust)

    const state = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const run = startStage(state, raidTruck(state), 'steady')
    run.paces = [...steady]
    run.weather = thaw
    expect(raidGrime(state, run, 400).wet).toBe(0)
    expect(raidGrime(state, run, 20_000).wet).toBe(1)

    const whiteout: StageWeather = { kind: 'whiteout', chance: 1, from: 0, to: 1000, comes: true, at: 500 }
    const snowy = raidGrime(raidAfter('winterSprint', [record(steady, [], whiteout)]))
    expect(snowy.snow).toBeGreaterThan(raidGrime(raidAfter('winterSprint', [record(steady, [], null)])).snow)
  })

  it('works it out the same every time', () => {
    const s = raidAfter('summerSprint', [record(steady, [{ kind: 'slide', corner: -1 }])])
    expect(raidGrime(s)).toEqual(raidGrime(s))
  })
})

describe('grime: dents', () => {
  it('a snowbank dents the nose; a corner that broke hard knocks its arch; a faded damper leaves none', () => {
    const s = raidAfter('winterSprint', [record(steady, [{ kind: 'slide', corner: -1 }, { kind: 'bottoming', corner: 2 }, { kind: 'fade', corner: 1 }])])
    const where = raidGrime(s).dents.map((d) => d.where)
    expect(where).toContain('nose')
    expect(where).toContain('arch2')
    expect(where).not.toContain('arch1')
  })

  it('a dent in the oil pan shows until the crew patches it', () => {
    const s = raidAfter('summerSprint', [record(steady)])
    s.under.sump = 0.5
    expect(raidGrime(s).dents.map((d) => d.where)).toContain('sump')
    s.under.sump = 0
    expect(raidGrime(s).dents.map((d) => d.where)).not.toContain('sump')
  })

  it('on the stage, an underside dent shows from where the rock hit', () => {
    const state = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const run = startStage(state, raidTruck(state), 'steady')
    run.paces = [...steady]
    run.under.diff = 0.4
    run.stops.push({ leg: 0, at: 9_000, kind: 'diff', corner: -1, zone: null, lost: 60, fix: 'patch', estimated: false })
    expect(raidGrime(state, run, 8_000).dents.map((d) => d.where)).not.toContain('diff')
    expect(raidGrime(state, run, 9_500).dents.map((d) => d.where)).toContain('diff')
  })

  it('never more dents than the look can draw', () => {
    const stops: Partial<Stop>[] = [0, 1, 2, 3].map((corner) => ({ kind: 'tire', corner }))
    const s = raidAfter('winterSprint', [record(steady, [...stops, { kind: 'slide', corner: -1 }])])
    Object.assign(s.under, { sump: 0.5, diff: 0.5, tank: 0.5 })
    expect(raidGrime(s).dents.length).toBe(GRIME.maxDents)
  })
})

describe('grime: only a look', () => {
  it('a driven stage gives a grimy truck, and the raid comes out the same as before', () => {
    const drive = () => {
      const state = enterRaid('summerSprint', stockBuild('sxs'), 'veteran')
      const run = startStage(state, raidTruck(state), 'steady')
      driveStage(state, run, steady)
      return { state, rec: finishStage(state, run) }
    }
    const a = drive()
    const before = JSON.stringify(a.state)
    expect(raidGrime(a.state).dust).toBeGreaterThan(0)
    // Working out the grime changes nothing in the raid.
    expect(JSON.stringify(a.state)).toBe(before)
    expect(drive().rec.time).toBe(a.rec.time)
  })

  it('nothing in the sim or the saves reads it', () => {
    for (const dir of ['src/sim', 'src/persist']) {
      for (const f of readdirSync(dir)) {
        if (f === 'grime.ts') continue
        expect(readFileSync(`${dir}/${f}`, 'utf8'), `${dir}/${f}`).not.toMatch(/from '\.\/grime'|from '\.\.\/sim\/grime'/)
      }
    }
  })

  it('the Lite tier draws the simpler version', () => {
    expect(TIERS.lite.grimeDetail).toBe(false)
    expect(TIERS.full.grimeDetail).toBe(true)
    expect(TIERS.ultra.grimeDetail).toBe(true)
  })
})
