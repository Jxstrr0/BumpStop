/**
 * Night stages (Kelbo, 27 November 2026): lamps you can buy, the speed the
 * beam allows, hidden ruts that only show up inside it, and the raid stages
 * that run into the dark.
 */
import { describe, expect, it } from 'vitest'
import { HEADLAMPS, RUTS_PER_KM } from '../src/data/night'
import { PARTS, type LightPart } from '../src/data/parts'
import { RAIDS } from '../src/data/raids'
import { CLEAR } from '../src/data/weather'
import { buildTruck, stockBuild } from '../src/sim/build'
import { buildProfile } from '../src/sim/ground'
import { beamOf, braking, darkFrom, sightSpeed, stopDistance, unseenShare } from '../src/sim/night'
import { driveStage, enterRaid, finishStage, nightOutlook, raidTruck, startStage, type RaidState, type StageRecord } from '../src/sim/raid'
import { Rng } from '../src/sim/rng'
import { readSave, newSave } from '../src/persist/save'

const lamp = (id: string) => PARTS.find((p) => p.id === id) as LightPart

describe('the lamps', () => {
  it('every truck starts with its headlamps only, so stock builds are unchanged', () => {
    for (const cls of ['light4x4', 'heavy', 'sxs'] as const) {
      const b = stockBuild(cls)
      expect(b.parts.lightBar).toBe('noLightBar')
      expect(b.parts.spots).toBe('noSpots')
      expect(buildTruck(b).beam).toEqual({ reach: HEADLAMPS.reach, spread: HEADLAMPS.spread, draw: 0 })
    }
  })

  it('a bar lights wide, spots reach far, and the beam takes the best of each', () => {
    const bar = lamp('halogenBar')
    const spots = lamp('halogenSpots')
    expect(bar.spread).toBeGreaterThan(spots.spread)
    expect(spots.reach).toBeGreaterThan(bar.reach)
    expect(beamOf(bar, spots)).toEqual({ reach: spots.reach, spread: bar.spread, draw: bar.draw + spots.draw })
  })

  it('newer lamps reach further and draw less, and every lamp weighs something', () => {
    expect(lamp('ledBar').reach).toBeGreaterThan(lamp('halogenBar').reach)
    expect(lamp('ledBar').draw).toBeLessThan(lamp('halogenBar').draw)
    expect(lamp('hidSpots').reach).toBeGreaterThan(lamp('halogenSpots').reach)
    expect(lamp('ledSpots').reach).toBeGreaterThan(lamp('hidSpots').reach)
    for (const p of PARTS.filter((x) => (x.slot === 'lightBar' || x.slot === 'spots') && (x as LightPart).reach > 0)) {
      for (const cls of ['light4x4', 'heavy', 'sxs'] as const) expect(p.mass[cls], `${p.id} ${cls}`).toBeGreaterThan(0)
    }
  })

  it('fitting lamps adds their weight to the truck', () => {
    const b = stockBuild('light4x4')
    const before = buildTruck(b).mass
    b.parts.lightBar = 'halogenBar'
    b.parts.spots = 'halogenSpots'
    expect(buildTruck(b).mass).toBe(before + (lamp('halogenBar').mass.light4x4 as number) + (lamp('halogenSpots').mass.light4x4 as number))
  })
})

describe('seeing in the dark', () => {
  it('the sight speed stops the truck exactly at the end of the beam', () => {
    for (const reach of [60, 110, 280]) {
      for (const brake of [braking('graded', false), braking('ice', false), braking('ice', true)]) {
        expect(stopDistance(sightSpeed(reach, brake), brake)).toBeCloseTo(reach, 6)
      }
    }
  })

  it('headlamps hold the driver back on fast gravel, and far more on ice; studs help', () => {
    const gravel = sightSpeed(HEADLAMPS.reach, braking('graded', false)) * 3.6
    const ice = sightSpeed(HEADLAMPS.reach, braking('ice', false)) * 3.6
    const iceStuds = sightSpeed(HEADLAMPS.reach, braking('ice', true)) * 3.6
    expect(gravel).toBeGreaterThan(60)
    expect(gravel).toBeLessThan(85)
    expect(ice).toBeLessThan(gravel * 0.6)
    expect(iceStuds).toBeGreaterThan(ice)
  })

  it('a wider beam shows more ruts, and so does slowing down', () => {
    const brake = braking('rough', false)
    const head = beamOf(lamp('noLightBar'), lamp('noSpots'))
    const bar = beamOf(lamp('halogenBar'), lamp('noSpots'))
    expect(unseenShare(bar, 15, brake)).toBeLessThan(unseenShare(head, 15, brake))
    // Too fast to stop in the beam: even the ruts in it come too late.
    expect(unseenShare(head, 30, brake)).toBeGreaterThan(unseenShare(head, 15, brake))
    expect(unseenShare(head, 10, brake)).toBeCloseTo(1 - HEADLAMPS.spread, 6)
  })
})

describe('hidden ruts in the road', () => {
  it('leave a daytime road exactly as it was', () => {
    const plain = buildProfile('rough', 300, new Rng(5))
    const clear = buildProfile('rough', 300, new Rng(5), { ...CLEAR })
    const noRuts = buildProfile('rough', 300, new Rng(5), { ...CLEAR, ruts: 0 })
    expect(Array.from(clear.left)).toEqual(Array.from(plain.left))
    expect(Array.from(noRuts.right)).toEqual(Array.from(plain.right))
  })

  it('dig dips into the road at night, and leave every other bump where it was', () => {
    const day = buildProfile('graded', 1000, new Rng(9))
    const night = buildProfile('graded', 1000, new Rng(9), { ...CLEAR, ruts: 8 })
    let deepest = 0
    let raised = 0
    for (let i = 0; i < day.left.length; i++) {
      for (const [d, n] of [[day.left[i]!, night.left[i]!], [day.right[i]!, night.right[i]!]] as const) {
        deepest = Math.max(deepest, d - n)
        if (n > d + 1e-12) raised++
      }
    }
    expect(deepest).toBeGreaterThan(0.08)
    expect(raised).toBe(0)
  })
})

describe('night stages in the raids', () => {
  it('the Polar Night Raid gets darker every day and ends with a stage all in the dark', () => {
    const darks = RAIDS.autumnRaid.stages.map((s) => s.dark)
    for (let i = 1; i < darks.length; i++) expect(darks[i]!).toBeLessThan(darks[i - 1]!)
    expect(darks.at(-1)).toBe(0)
  })

  it('summer raids run under the midnight sun; each winter raid has a stage that ends in the dark', () => {
    for (const id of ['summerSprint', 'summerRaid', 'midsummerSprint', 'nationalRaid', 'longOne'] as const) {
      expect(RAIDS[id].stages.every((s) => darkFrom(s) === null), id).toBe(true)
    }
    for (const id of ['winterSprint', 'winterRaid'] as const) {
      expect(RAIDS[id].stages.some((s) => darkFrom(s) !== null), id).toBe(true)
    }
  })

  it('the morning roadbook shows what headlamps cost on the big lake, and what lamps buy back', () => {
    const spec = RAIDS.winterSprint.stages[2]!
    const stock = buildTruck({ ...stockBuild('light4x4'), parts: { ...stockBuild('light4x4').parts, tires: 'studdedRally' } })
    const lit = buildTruck({ ...stock.build, parts: { ...stock.build.parts, lightBar: 'halogenBar', spots: 'halogenSpots' } })
    const a = nightOutlook(spec, stock, 'gravelAce', 'steady')!
    const b = nightOutlook(spec, lit, 'gravelAce', 'steady')!
    expect(a.lost).toBeGreaterThan(5 * 60)
    expect(a.slowed.some((x) => x.ground === 'ice')).toBe(true)
    expect(b.lost).toBeLessThan(a.lost / 5)
    expect(b.seen).toBeGreaterThan(a.seen * 1.8)
    expect(a.ruts).toBeCloseTo(b.ruts, 6)
    expect(nightOutlook(RAIDS.winterSprint.stages[0]!, stock, 'gravelAce', 'steady')).toBeNull()
  })

  /** Drive the Winter Sprint's big-lake stage (it gets dark halfway) with these lamps. */
  function bigLake(lightBar: string, spots: string): StageRecord {
    const b = stockBuild('light4x4')
    b.parts.tires = 'studdedRally'
    b.parts.lightBar = lightBar
    b.parts.spots = spots
    const state: RaidState = enterRaid('winterSprint', b, 'gravelAce')
    state.stage = 2
    const run = startStage(state, raidTruck(state), 'steady')
    driveStage(state, run, ['steady', 'steady', 'steady'])
    return finishStage(state, run)
  }

  it('in the dark, lamps make the stage quicker and show the driver more of the ruts', () => {
    const head = bigLake('noLightBar', 'noSpots')
    const lit = bigLake('halogenBar', 'halogenSpots')
    expect(head.night).toBeDefined()
    expect(head.night!.dark).toBeCloseTo(darkFrom(RAIDS.winterSprint.stages[2]!)!, 6)
    expect(lit.night!.unseen).toBeLessThan(head.night!.unseen / 2)
    expect(lit.night!.seen + lit.night!.unseen).toBeCloseTo(head.night!.seen + head.night!.unseen, 0)
    expect(lit.time).toBeLessThan(head.time - 5 * 60)
    // About as many ruts as the ground in the dark holds.
    const spec = RAIDS.winterSprint.stages[2]!
    const dark = darkFrom(spec)!
    let pos = 0
    let expected = 0
    for (const s of spec.segments) {
      const from = Math.max(pos, dark)
      pos += s.km * 1000
      if (pos > from) expected += (RUTS_PER_KM[s.ground] * (pos - from)) / 1000
    }
    expect(head.night!.seen + head.night!.unseen).toBeGreaterThan(expected * 0.8)
  }, 120_000)

  it('a daytime stage keeps no night record, and a save keeps a night one', () => {
    const state = enterRaid('winterSprint', stockBuild('light4x4'), 'gravelAce')
    const run = startStage(state, raidTruck(state), 'conserve')
    driveStage(state, run, ['conserve', 'conserve', 'conserve'])
    const rec = finishStage(state, run)
    expect(rec.night).toBeUndefined()
    // A raid with a night stage behind it goes through a save and back.
    state.results[0] = { ...rec, night: { dark: 50_000, seen: 12.5, unseen: 4.25 } }
    const save = { ...newSave(), raid: state }
    const back = readSave(JSON.parse(JSON.stringify(save)))
    expect(back.raid?.results[0]?.night).toEqual({ dark: 50_000, seen: 12.5, unseen: 4.25 })
  }, 60_000)

  it('an old build without lamps loads with none fitted', () => {
    const save = newSave() as unknown as { builds: Record<string, { parts: Record<string, string> }> }
    delete save.builds.light4x4!.parts.lightBar
    delete save.builds.light4x4!.parts.spots
    const back = readSave(JSON.parse(JSON.stringify(save)))
    expect(back.builds.light4x4.parts.lightBar).toBe('noLightBar')
    expect(back.builds.light4x4.parts.spots).toBe('noSpots')
  })
})
