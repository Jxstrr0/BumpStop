import { describe, expect, it } from 'vitest'
import { FAILURES } from '../src/data/failures'
import { RIGS } from '../src/data/rigs'
import { SIM, TEST_MULES } from '../src/data/ride'
import { MULE_WEAR, WEAR, type FatigueSpec } from '../src/data/wear'
import { buildProfile, type Profile } from '../src/sim/ground'
import { runLaps } from '../src/sim/laps'
import { emptyForces, enterSection, restingState, rideParams, stepRide, type StepForces } from '../src/sim/ride'
import { Rng } from '../src/sim/rng'
import { runStage, type StageSpec } from '../src/sim/stage'
import { fromCelsius } from '../src/sim/units'
import {
  emptyReadings,
  feedFatigue,
  newFatigue,
  newWearState,
  stepWear,
  wearParams,
  type WearState,
} from '../src/sim/wear'
import { flatRoad } from './helpers/flat'
import { tweaked } from './helpers/tweak'

const SPEC: FatigueSpec = { ultimate: 100, endurance: 20, exponent: 4, gate: 2 }
const AIR = fromCelsius(20)

/** Feed `cycles` clean swings between `lo` and `hi`, `perCycle` samples each. */
function swing(spec: FatigueSpec, lo: number, hi: number, cycles: number, wiggle = 0): number {
  const f = newFatigue()
  const perCycle = 40
  for (let n = 0; n <= cycles * perCycle; n++) {
    const u = (n % perCycle) / perCycle
    const tri = u < 0.5 ? u * 2 : 2 - u * 2 // 0 → 1 → 0
    const noise = wiggle * (n % 2 === 0 ? 1 : -1)
    feedFatigue(f, spec, lo + (hi - lo) * tri + noise)
  }
  return f.damage
}

describe('fatigue', () => {
  it('adds (range ÷ ultimate)^exponent per full swing', () => {
    // 20 swings of 50: each is (50/100)^4 = 0.0625, so about 1.25 in all, capped at 1;
    // 10 swings make 0.625, give or take the half swing still open at the end.
    expect(swing(SPEC, 0, 50, 10)).toBeCloseTo(0.625, 1)
    expect(swing(SPEC, 0, 50, 20)).toBe(1)
  })

  it('ignores swings below the endurance limit, however many', () => {
    expect(swing(SPEC, 0, 19, 500)).toBe(0)
  })

  it('does not split one big swing into small ones because of a little wiggle', () => {
    const clean = swing(SPEC, 0, 60, 6)
    const noisy = swing(SPEC, 0, 60, 6, 0.8) // wiggles smaller than the gate
    expect(noisy).toBeCloseTo(clean, 2)
  })

  it('breaks at once on a load as big as its ultimate', () => {
    const f = newFatigue()
    feedFatigue(f, SPEC, 30)
    expect(f.damage).toBe(0)
    feedFatigue(f, SPEC, -100)
    expect(f.damage).toBe(1)
  })
})

/** Run stepWear on hand-made forces, so each failure can be set off on its own. */
function bench(cls: keyof typeof TEST_MULES = 'light4x4') {
  const p = rideParams(TEST_MULES[cls])
  const wp = wearParams(MULE_WEAR[cls], p)
  const s = restingState(AIR)
  const w = newWearState()
  const f = emptyForces()
  // A quiet corner: resting loads, tires down.
  const settle = () => {
    for (let i = 0; i < 4; i++) {
      f.strut[i] = 4000
      f.hardStop[i] = 0
      f.tire[i] = 5000
      f.tireSquash[i] = 0.02
      f.compression[i] = 0
    }
  }
  settle()
  const step = (road: Profile = flatRoad(), speed = 10) => stepWear(w, wp, s, p, f, road, speed, emptyReadings())
  return { p, wp, s, w, f, step, settle }
}

describe('each failure has its own cause', () => {
  it('damper fade: over the red line for the fade hold, not a moment less', () => {
    const b = bench()
    b.s.oilTemp[2] = b.wp.damper[2]!.redLine + 5
    const holdSteps = WEAR.fadeHold * SIM.stepsPerSecond
    for (let n = 0; n < holdSteps - 2; n++) expect(b.step()).toBeNull()
    let ev = null
    for (let n = 0; n < 4 && !ev; n++) ev = b.step()
    expect(ev?.kind).toBe('fade')
    expect(ev?.corner).toBe(2)
  })

  it('bottoming: one hit at the shock’s limit breaks it', () => {
    const b = bench()
    b.f.hardStop[1] = MULE_WEAR.light4x4.front.bottoming.ultimate
    expect(b.step()?.kind).toBe('bottoming')
  })

  it('cracked mount: one load bigger than the mount', () => {
    const b = bench()
    b.f.strut[3] = MULE_WEAR.light4x4.rear.mount.ultimate * 1.01
    const ev = b.step()
    expect(ev?.kind).toBe('mount')
    expect(ev?.fatigue).toBe(false)
  })

  it('snapped CV: past its biggest angle at full droop', () => {
    const b = bench()
    const ax = MULE_WEAR.light4x4.front.axle
    b.f.compression[0] = ax.straightAt - ax.armLength * 0.6 // atan(0.6) ≈ 0.54 rad, past the 0.45 limit
    expect(b.step()?.kind).toBe('axle')
  })

  it('landing on a spinning wheel puts far more torque through the axle than landing on a still one', () => {
    const peakLanding = (airSteps: number) => {
      const b = bench()
      const r = emptyReadings()
      b.f.tire[0] = 0
      for (let n = 0; n < airSteps; n++) stepWear(b.w, b.wp, b.s, b.p, b.f, flatRoad(), 10, r)
      b.f.tire[0] = 20000 // a hard landing
      let peak = 0
      for (let n = 0; n < 50; n++) {
        stepWear(b.w, b.wp, b.s, b.p, b.f, flatRoad(), 10, r)
        peak = Math.max(peak, r.jointTorque[0]!)
      }
      return peak
    }
    expect(peakLanding(250)).toBeGreaterThan(3 * peakLanding(1))
  })

  it('cut tire: squashed to the rim over a sharp edge, but not on smooth ground', () => {
    const pinch = MULE_WEAR.light4x4.front.tire.pinchAt
    const smooth = bench()
    smooth.f.tireSquash[0] = pinch + 0.01
    expect(smooth.step()).toBeNull()

    // A 10 cm step right under the front left tire.
    const road = flatRoad(40)
    const x = smooth.s.x + smooth.p.cornerX[0]!
    for (let i = 0; i < road.left.length; i++) if (i * road.step >= x) road.left[i] = 0.1
    const sharp = bench()
    sharp.f.tireSquash[0] = pinch + 0.01
    const ev = sharp.step(road)
    expect(ev?.kind).toBe('tire')
    expect(ev?.corner).toBe(0)
  })

  it('cracked frame: front and rear axles twisting it opposite ways, again and again', () => {
    const b = bench()
    let ev = null
    for (let n = 0; n < 4000 && !ev; n++) {
      const k = Math.floor(n / 25) % 2 === 0 ? 1 : -1 // flip the twist every 25 steps
      b.f.strut[0] = 4000 + k * 40000
      b.f.strut[1] = 4000 - k * 40000
      b.f.strut[2] = 4000 - k * 40000
      b.f.strut[3] = 4000 + k * 40000
      ev = b.step()
    }
    expect(ev?.kind).toBe('frame')
    expect(ev?.zone).toBe('centre')
    expect(ev?.fatigue).toBe(true)
  })

  it('stops adding wear once something has broken', () => {
    const b = bench()
    b.f.hardStop[0] = 1e9
    expect(b.step()).not.toBeNull()
    const before = JSON.stringify(b.w)
    expect(b.step()).toBeNull()
    expect(JSON.stringify(b.w)).toBe(before)
  })
})

describe('the ride model with wear watching', () => {
  it('reporting the forces changes nothing about the ride', () => {
    const p = rideParams(TEST_MULES.heavy)
    const road = buildProfile('whoops', 200, new Rng(3))
    const a = restingState(AIR)
    const b = restingState(AIR)
    enterSection(a, p, road)
    enterSection(b, p, road)
    const f = emptyForces()
    for (let n = 0; n < 4000; n++) {
      stepRide(a, p, road, 14)
      stepRide(b, p, road, 14, undefined, f)
    }
    expect(b).toEqual(a)
  })
})

describe('lap runs and traces', () => {
  const light = () => runLaps(TEST_MULES.light4x4, MULE_WEAR.light4x4, RIGS.tortureLoop, 11, { airTemp: AIR })

  it('runs the same twice with the same seed, trace and all', () => {
    expect(light()).toEqual(light())
  })

  it('keeps the last few seconds of that failure’s channels, ending at the break', () => {
    const run = light()
    expect(run.broken).not.toBeNull()
    const trace = run.trace!
    expect(trace.t.length).toBe(WEAR.traceRate * WEAR.traceSeconds)
    expect(trace.t.at(-1)!).toBeLessThanOrEqual(run.broken!.t)
    expect(run.broken!.t - trace.t.at(-1)!).toBeLessThan(1 / WEAR.traceRate + 1e-9)
    expect(trace.t.at(-1)! - trace.t[0]!).toBeCloseTo(WEAR.traceSeconds - 1 / WEAR.traceRate, 6)
    const info = FAILURES[run.broken!.kind]
    const wanted = run.broken!.corner >= 0 ? [...info.corner, ...info.frame] : info.frame
    expect(Object.keys(trace.channels).sort()).toEqual([...wanted].sort())
    for (const series of Object.values(trace.channels)) expect(series.length).toBe(trace.t.length)
  })

  it('heats up and wears more every lap', () => {
    const run = light()
    const worst = (k: number) => {
      const d = run.laps[k]!.damage
      return Math.max(...d.bottoming, ...d.mount, ...d.axle, ...d.tire, ...d.frame)
    }
    for (let k = 1; k < run.laps.length; k++) {
      expect(run.laps[k]!.speed).toBeGreaterThan(run.laps[k - 1]!.speed)
      expect(worst(k)).toBeGreaterThanOrEqual(worst(k - 1))
    }
  })

  it('a wear state saved mid-run carries on exactly the same', () => {
    const p = rideParams(TEST_MULES.sxs)
    const wp = wearParams(MULE_WEAR.sxs, p)
    const road = flatRoad()
    const loads = (n: number, f: StepForces) => {
      for (let i = 0; i < 4; i++) {
        f.strut[i] = 2000 + 30000 * ((n * (i + 3)) % 17) / 17
        f.tire[i] = n % 40 < 5 ? 0 : 3000
        f.compression[i] = 0.05 * (((n * (i + 1)) % 9) / 9 - 0.5)
      }
    }
    const run = (w: WearState, from: number, to: number) => {
      const s = restingState(AIR)
      const f = emptyForces()
      for (let n = from; n < to; n++) {
        loads(n, f)
        stepWear(w, wp, s, p, f, road, 12)
      }
    }
    const straight = newWearState()
    run(straight, 0, 3000)
    const first = newWearState()
    run(first, 0, 1200)
    const loaded = JSON.parse(JSON.stringify(first)) as WearState
    run(loaded, 1200, 3000)
    expect(loaded).toEqual(straight)
  })
})

describe('wear on long stages', () => {
  const jumps = (length: number): StageSpec => ({ airTemp: AIR, segments: [{ ground: 'jumps', length, speed: 16 }] })

  it('a stage without a wear setup has no wear', () => {
    expect(runStage(TEST_MULES.light4x4, jumps(3000), 1).wear).toBeNull()
  })

  it('sampled wear lands near the full-detail wear', () => {
    // Tougher shocks, so nothing breaks and the whole stage counts.
    const { ride, wear } = tweaked(TEST_MULES.light4x4, MULE_WEAR.light4x4, { shockStrength: 2 })
    let sampled = 0
    let full = 0
    for (const seed of [1, 2, 3]) {
      const a = runStage(ride, jumps(15000), seed, 'sampled', wear)
      const b = runStage(ride, jumps(15000), seed, 'full', wear)
      expect(a.wear!.broken).toBeNull()
      expect(b.wear!.broken).toBeNull()
      sampled += Math.max(...a.wear!.damage.mount) + Math.max(...a.wear!.damage.axle)
      full += Math.max(...b.wear!.damage.mount) + Math.max(...b.wear!.damage.axle)
    }
    expect(full).toBeGreaterThan(0.1)
    expect(sampled / full).toBeGreaterThan(0.7)
    expect(sampled / full).toBeLessThan(1.4)
  })

  it('stops the stage at the first break, worked out between samples if need be', () => {
    const { ride, wear } = tweaked(TEST_MULES.light4x4, MULE_WEAR.light4x4, { mountStrength: 0.55, shockStrength: 2 })
    const r = runStage(ride, jumps(60000), 4, 'sampled', wear)
    const b = r.wear!.broken
    expect(b?.kind).toBe('mount')
    expect(r.distance).toBeLessThan(60000)
    expect(b!.distance).toBeCloseTo(r.distance, 0)
  })
})
