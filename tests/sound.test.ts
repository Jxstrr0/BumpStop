/**
 * Sound (plan PR 6): the engine voice built from the engine choice, the cues
 * that turn a run into sounds and buzzes, the short sounds themselves, and
 * the lap runner's hit counter that feeds them.
 */
import { describe, expect, it } from 'vitest'
import { breakCues, clatterLevel, lapCues, newCueState, type LapFrame } from '../src/audio/cues'
import { engineHarmonics, engineSpeed, engineSpeedFor, harmonicLevel } from '../src/audio/profile'
import { renderVoice, VOICE_NAMES } from '../src/audio/voices'
import { CLASSES } from '../src/data/classes'
import { FAILURES } from '../src/data/failures'
import { PARTS } from '../src/data/parts'
import { RIGS } from '../src/data/rigs'
import { BREAK_SOUND, ENGINE_SOUNDS, ENGINE_TONE, GEARBOXES, GAPS, type EngineSound } from '../src/data/sound'
import type { FailureKind } from '../src/data/wear'
import { buildTruck, stockBuild } from '../src/sim/build'
import { advanceLaps, emptyFeel, startLaps, takeFeel } from '../src/sim/laps'
import { fromCelsius } from '../src/sim/units'

const KMH = 1 / 3.6
const engines = PARTS.filter((p) => p.slot === 'engine')

describe('the engine voice', () => {
  it('every engine part has a sound, with a pulse for every cylinder', () => {
    for (const part of engines) {
      const s = ENGINE_SOUNDS[part.id]
      expect(s, part.id).toBeDefined()
      expect(s!.pulse.length).toBe(s!.firing.length)
      expect(s!.idle).toBeLessThan(s!.redline)
      for (const deg of s!.firing) expect(deg >= 0 && deg < 720).toBe(true)
    }
  })

  const levels = (s: EngineSound) => {
    const h = engineHarmonics(s, ENGINE_TONE.harmonics)
    return Array.from({ length: 25 }, (_, k) => harmonicLevel(h, k))
  }

  it('an even straight-six only sounds at multiples of six', () => {
    const l = levels(ENGINE_SOUNDS.petrolSix!)
    for (let k = 1; k <= 24; k++) {
      if (k % 6 === 0) expect(l[k]!).toBeGreaterThan(1e-3)
      else expect(l[k]!).toBeLessThan(1e-6)
    }
  })

  it('a V8’s uneven banks fill in the harmonics between (the burble), and a 270° twin lopes', () => {
    const v8 = levels(ENGINE_SOUNDS.petrolV8!)
    expect(v8[3]!).toBeGreaterThan(0.1)
    expect(v8[5]!).toBeGreaterThan(0.1)
    const twin = levels(ENGINE_SOUNDS.twin!)
    expect(twin[1]!).toBeGreaterThan(0.1)
    expect(twin[3]!).toBeGreaterThan(0.1)
  })

  it('every engine’s waveform is finite with its loudest harmonic at 1', () => {
    for (const [id, s] of Object.entries(ENGINE_SOUNDS)) {
      const h = engineHarmonics(s, ENGINE_TONE.harmonics)
      const all = Array.from({ length: ENGINE_TONE.harmonics + 1 }, (_, k) => harmonicLevel(h, k))
      expect(all.every(Number.isFinite), id).toBe(true)
      expect(Math.max(...all)).toBeCloseTo(1, 6)
      expect(all[0]).toBe(0)
    }
  })

  it('engine speed stays between idle and the red line, and the gears only go up as the truck speeds up', () => {
    for (const cls of CLASSES) {
      for (const part of engines.filter((p) => p.mass[cls.id] !== undefined)) {
        const s = ENGINE_SOUNDS[part.id]!
        let lastGear = 0
        let lastRpm = 0
        for (let kmh = 0; kmh <= 160; kmh += 5) {
          const { rpm, gear } = engineSpeed(s, GEARBOXES[cls.id], kmh * KMH)
          expect(rpm).toBeGreaterThanOrEqual(s.idle)
          expect(rpm).toBeLessThanOrEqual(s.redline)
          if (GEARBOXES[cls.id].kind === 'cvt') {
            expect(rpm).toBeGreaterThanOrEqual(lastRpm)
            lastRpm = rpm
          } else {
            expect(gear).toBeGreaterThanOrEqual(lastGear)
            lastGear = gear
          }
        }
      }
    }
  })

  it('the light 4x4 cruises in top gear at 100 km/h, and revs higher in the rock garden’s low gear', () => {
    const fast = engineSpeedFor('petrolSix', 'light4x4', 100 * KMH)
    expect(fast.gear).toBe(5)
    const slow = engineSpeedFor('petrolSix', 'light4x4', 24 * KMH)
    expect(slow.gear).toBeLessThan(3)
  })
})

describe('the cues', () => {
  const frame = (over: Partial<LapFrame> = {}): LapFrame => ({
    realDt: 1 / 60,
    skipping: false,
    feel: { ...emptyFeel(), time: 0.6 },
    ground: 'rough',
    speed: 20,
    heat: 0,
    heatCapacity: 2400,
    ...over,
  })
  let n = 0
  const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280)

  it('“Skip to the end” is silent until the break', () => {
    const c = lapCues(newCueState(), frame({ skipping: true, feel: { ...emptyFeel(), time: 1, bottomOuts: 3, bottomPeak: 30 } }), rand)
    expect(c.shots).toEqual([])
    expect(c.buzz).toBeNull()
    expect(c.clatter).toBe(0)
  })

  it('a bottom-out clunks and buzzes, but not twice inside the gap', () => {
    const state = newCueState()
    const hit = { ...emptyFeel(), time: 0.6, bottomOuts: 1, bottomPeak: 22 }
    const first = lapCues(state, frame({ feel: hit, ground: 'graded', speed: 0 }), rand)
    expect(first.shots.map((s) => s.voice)).toContain('clunk')
    expect(first.buzz).not.toBeNull()
    const second = lapCues(state, frame({ feel: hit, ground: 'graded', speed: 0, realDt: GAPS.clunk / 4 }), rand)
    expect(second.shots.map((s) => s.voice)).not.toContain('clunk')
  })

  it('a big strike in the rock garden clacks; a small one only adds to the clatter', () => {
    const big = lapCues(newCueState(), frame({ ground: 'rocks', feel: { ...emptyFeel(), time: 0.6, strikes: 2, strikePeak: 8 } }), rand)
    expect(big.shots.map((s) => s.voice)).toContain('rockStrike')
    const small = lapCues(newCueState(), frame({ ground: 'rocks', feel: { ...emptyFeel(), time: 0.6, strikes: 2, strikePeak: 2.6 } }), rand)
    expect(small.shots.map((s) => s.voice)).not.toContain('rockStrike')
  })

  it('rough gravel at speed rattles more than a graded road, and the rattles never pass their cap', () => {
    expect(clatterLevel(frame({ ground: 'rough', speed: 25 }))).toBeGreaterThan(clatterLevel(frame({ ground: 'graded', speed: 25 })))
    const state = newCueState()
    let ticks = 0
    for (let k = 0; k < 60; k++) {
      const c = lapCues(state, frame({ ground: 'washboard', speed: 30, feel: { ...emptyFeel(), time: 0.6, work: 1e9, strikes: 99 } }), rand)
      ticks += c.shots.filter((s) => s.voice === 'tick' || s.voice === 'knock').length
    }
    expect(ticks).toBeGreaterThan(5)
    expect(ticks).toBeLessThanOrEqual(23)
  })

  it('the hiss starts at the warm line', () => {
    expect(lapCues(newCueState(), frame({ heat: -0.4 }), rand).hiss).toBe(0)
    expect(lapCues(newCueState(), frame({ heat: 1.2 }), rand).hiss).toBeCloseTo(1.2)
  })

  it('every failure has its own break sound and a buzz', () => {
    for (const kind of Object.keys(FAILURES) as FailureKind[]) {
      const c = breakCues(kind)
      expect(VOICE_NAMES).toContain(c.shots[0]!.voice)
      expect(c.shots[0]!.voice).toBe(BREAK_SOUND[kind])
      expect(c.buzz).not.toBeNull()
    }
  })
})

describe('the short sounds', () => {
  it.each(VOICE_NAMES)('%s is finite, loud enough, never clips, and the same every time', (name) => {
    const a = renderVoice(name, 22050, 1)
    expect(a.length).toBeGreaterThan(100)
    let peak = 0
    for (const v of a) {
      expect(Number.isFinite(v)).toBe(true)
      peak = Math.max(peak, Math.abs(v))
    }
    expect(peak).toBeGreaterThan(0.5)
    expect(peak).toBeLessThanOrEqual(1)
    expect(renderVoice(name, 22050, 1)).toEqual(a)
    expect(renderVoice(name, 22050, 2)).not.toEqual(a)
  })
})

describe('the hit counter for the sound', { timeout: 60_000 }, () => {
  const truck = buildTruck(stockBuild('light4x4'))

  it('counts tire strikes, more of them in the rock garden than on the graded road, and its time adds up', () => {
    const r = startLaps(truck.ride, truck.wear, RIGS.tortureLoop, 3, { airTemp: fromCelsius(20) })
    const per = { rocks: { strikes: 0, time: 0 }, graded: { strikes: 0, time: 0 } }
    let time = 0
    let work = 0
    while (!r.done && r.lap < 4) {
      const ground = r.rig.pieces[r.piece]!.ground
      advanceLaps(r, 200)
      const f = takeFeel(r)
      time += f.time
      work += f.work
      if (ground === 'rocks' || ground === 'graded') {
        per[ground].strikes += f.strikes
        per[ground].time += f.time
      }
    }
    expect(time).toBeCloseTo(r.run.w.t, 6)
    expect(work).toBeGreaterThan(0)
    expect(per.rocks.strikes / per.rocks.time).toBeGreaterThan((per.graded.strikes / per.graded.time) * 2)
    expect(takeFeel(r)).toEqual(emptyFeel())
  })
})
