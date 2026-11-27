import { describe, expect, it } from 'vitest'
import { CLASSES, type ClassId } from '../src/data/classes'
import type { TruckBuild } from '../src/data/kit'
import { CLASS_LOAD, FUEL_STOP, SPOT_IDS, STOCK_LOAD, type TruckLoad } from '../src/data/load'
import { RAIDS } from '../src/data/raids'
import { SIM } from '../src/data/ride'
import { buildTruck, stockBuild, tidyBuild } from '../src/sim/build'
import { fuelRangeKm, fuelStops, loadShift } from '../src/sim/load'
import { driveStage, enterRaid, powerFactor, raidTruck, stageKm, startStage } from '../src/sim/raid'
import { enterSection, rideEnergy, rideParams, restingState, stepRide } from '../src/sim/ride'
import { fromCelsius } from '../src/sim/units'
import { readBuild } from '../src/persist/save'
import { balanceChip, fuelWords } from '../src/ui/loadBlock'
import { t } from '../src/data/strings'
import { FUEL_STEPS } from '../src/data/load'
import { flatRoad } from './helpers/flat'

const AIR = fromCelsius(20)

function loaded(cls: ClassId, load: Partial<TruckLoad>, kit = 'fullKit'): TruckBuild {
  const b = stockBuild(cls)
  return { ...b, parts: { ...b.parts, spares: kit }, load: { ...STOCK_LOAD, ...load } }
}

describe('weight and balance', () => {
  it.each(CLASSES)('$id with the stock load drives exactly as a build with no load', (c) => {
    const bare = { ...stockBuild(c.id), parts: { ...stockBuild(c.id).parts, spares: 'fullKit' } }
    const plain = buildTruck(bare)
    const stock = buildTruck({ ...bare, load: { ...STOCK_LOAD } })
    expect(stock.ride).toEqual(plain.ride)
    expect(stock.runMass).toBe(plain.mass)
    expect(stock.balance.pitch).toBeCloseTo(0, 12)
    expect(stock.balance.roll).toBe(0)
  })

  it.each(CLASSES)('$id: spares on the tail sit the rear down and the nose up', (c) => {
    const mid = buildTruck(loaded(c.id, {}))
    const tail = buildTruck(loaded(c.id, { spares: 'rear-centre' }))
    expect(tail.rear.sag).toBeGreaterThan(mid.rear.sag)
    expect(tail.front.sag).toBeLessThan(mid.front.sag)
    expect(tail.rear.bumpTravel).toBeLessThan(mid.rear.bumpTravel)
    expect(tail.balance.pitch).toBeGreaterThan(0)
    expect(tail.balance.front).toBeLessThan(tail.balance.stockFront)
    // A long lever: slower to start nodding.
    expect(tail.ride.pitchInertia).toBeGreaterThan(mid.ride.pitchInertia)
    expect(tail.runMass).toBe(mid.runMass)
  })

  it.each(CLASSES)('$id: tools on the left lean it left, so the left corners have less bump travel', (c) => {
    const t = buildTruck(loaded(c.id, { tools: 'mid-left', spares: 'mid-left' }))
    expect(t.ride.cgLeft).toBeGreaterThan(0)
    expect(t.balance.roll).toBeLessThan(0) // left side down
    expect(t.balance.left).toBeGreaterThan(0.5)
    const [fl, fr, rl, rr] = t.balance.corners
    expect(fl!.bumpTravel).toBeLessThan(fr!.bumpTravel)
    expect(rl!.bumpTravel).toBeLessThan(rr!.bumpTravel)
    expect(fl!.tireLoad).toBeGreaterThan(fr!.tireLoad)
    // The corners add up to the whole truck.
    const sum = t.balance.corners.reduce((s, k) => s + k.tireLoad, 0)
    expect(sum).toBeCloseTo(t.runMass * SIM.gravity, 6)
    // The ride model agrees with the screen on each corner's travel.
    const p = rideParams(t.ride)
    t.balance.corners.forEach((k, i) => expect(p.bumpTravel[i]).toBeCloseTo(k.bumpTravel, 9))
  })

  it.each(CLASSES)('$id sits still at rest on flat ground with a lopsided load', (c) => {
    const t = buildTruck(loaded(c.id, { spares: 'rear-right', tools: 'front-left', fuel: 0.25 }))
    const p = rideParams(t.ride)
    const s = restingState(AIR)
    const road = flatRoad()
    enterSection(s, p, road)
    for (let n = 0; n < 2500; n++) stepRide(s, p, road, 0)
    expect(Math.abs(s.z)).toBeLessThan(1e-9)
    expect(Math.abs(s.pitch)).toBeLessThan(1e-9)
    expect(Math.abs(s.roll)).toBeLessThan(1e-9)
    for (const w of s.wheelZ) expect(Math.abs(w)).toBeLessThan(1e-9)
  })

  it('keeps its energy with the dampers off when leaning', () => {
    const t = buildTruck(loaded('light4x4', { tools: 'rear-left', spares: 'rear-left' }))
    const setup = structuredClone(t.ride)
    for (const ax of [setup.front, setup.rear]) {
      ax.damper = { ...ax.damper, compLow: 0, compHigh: 0, rebLow: 0, rebHigh: 0 }
      ax.tireDamping = 0
    }
    const p = rideParams(setup)
    const s = restingState(AIR)
    const road = flatRoad()
    enterSection(s, p, road)
    s.vz = 0.3
    s.vRoll = 0.2
    s.vPitch = 0.1
    const e0 = rideEnergy(s, p, road)
    for (let n = 0; n < 1000; n++) stepRide(s, p, road, 0)
    expect(Math.abs(rideEnergy(s, p, road) - e0) / e0).toBeLessThan(0.02)
  })

  it.each(CLASSES)('$id: a quarter tank is lighter and a touch quicker on fast ground', (c) => {
    const full = buildTruck(loaded(c.id, {}))
    const quarter = buildTruck(loaded(c.id, { fuel: 0.25 }))
    expect(quarter.runMass).toBeCloseTo(full.runMass - 0.75 * CLASS_LOAD[c.id].fuelFull, 9)
    // The class rules weigh it full, so the weight window doesn't move.
    expect(quarter.mass).toBe(full.mass)
    expect(powerFactor(quarter)).toBeGreaterThan(powerFactor(full))
    expect(quarter.rear.sag + quarter.front.sag).toBeLessThan(full.rear.sag + full.front.sag)
  })

  it('counts fuel stops: one each time the tank runs out before the finish', () => {
    const r = fuelRangeKm('light4x4', 0.25) * 1000
    expect(fuelStops('light4x4', 0.25, r)).toBe(0)
    expect(fuelStops('light4x4', 0.25, r + 1)).toBe(1)
    expect(fuelStops('light4x4', 0.25, 2 * r + 1)).toBe(2)
  })

  it('every raid stage fits in a full tank, in every class', () => {
    for (const raid of Object.values(RAIDS)) {
      for (const stage of raid.stages) {
        for (const c of CLASSES) expect(fuelStops(c.id, 1, stageKm(stage) * 1000)).toBe(0)
      }
    }
  })

  it('a raid stage on a quarter tank stops for fuel; on a full one it does not', () => {
    const run = (fuel: number) => {
      const state = enterRaid('summerSprint', loaded('light4x4', { fuel }, 'lightKit'), 'veteran')
      const r = startStage(state, raidTruck(state), 'steady')
      driveStage(state, r, ['steady', 'steady', 'steady'])
      return { r, km: stageKm(RAIDS.summerSprint.stages[0]!) }
    }
    const full = run(1)
    expect(full.r.fuelStops).toBe(0)
    const quarter = run(0.25)
    const n = fuelStops('light4x4', 0.25, quarter.km * 1000)
    expect(n).toBeGreaterThan(0)
    expect(quarter.r.fuelStops).toBe(n)
    expect(quarter.r.fuel).toBe(n * FUEL_STOP)
  })

  it('a morning retune changes the load on the raid truck', () => {
    const state = enterRaid('summerSprint', stockBuild('light4x4'), 'veteran')
    const t = raidTruck(state, { ...stockBuild('light4x4'), load: { ...STOCK_LOAD, fuel: 0.5 } })
    expect(t.load.fuel).toBe(0.5)
  })

  it('loadShift is zero for the stock load and keeps the centre where the weights balance', () => {
    expect(loadShift('heavy', undefined, 500, 7000)).toEqual({ dMass: 0, dx: 0, dy: 0, dPitch: 0, dRoll: 0 })
    const s = loadShift('heavy', { ...STOCK_LOAD, spares: 'front-centre' }, 500, 7000)
    expect(s.dx).toBeCloseTo((500 * CLASS_LOAD.heavy.rowX.front) / 7000, 9)
    expect(s.dy).toBe(0)
  })
})

describe('saves keep the load', () => {
  it('a build without a load reads back without one', () => {
    const b = readBuild(JSON.parse(JSON.stringify(stockBuild('sxs'))))
    expect(b.load).toBeUndefined()
  })

  it('a build with a load reads back the same', () => {
    const b = loaded('sxs', { spares: 'rear-left', tools: 'front-right', fuel: 0.75 })
    expect(readBuild(JSON.parse(JSON.stringify(b)))).toEqual(tidyBuild(b))
  })

  it('a load with junk in it goes back to stock where it has to', () => {
    const raw = { ...stockBuild('heavy'), load: { spares: 'roof', tools: 'rear-left', fuel: 0.6 } }
    const b = readBuild(JSON.parse(JSON.stringify(raw)))
    expect(b.load).toEqual({ spares: STOCK_LOAD.spares, tools: 'rear-left', fuel: 0.5 })
    expect(SPOT_IDS).toContain(b.load!.tools)
  })
})

describe('the Load section reads the balance', () => {
  it('calls the stock load even, and names a tail-heavy or leaning load', () => {
    expect(balanceChip(buildTruck(loaded('light4x4', {}))).word).toBe('load.chipEven')
    expect(balanceChip(buildTruck(loaded('light4x4', { spares: 'rear-centre' }))).word).toBe('load.chipTail')
    expect(balanceChip(buildTruck(loaded('light4x4', { spares: 'front-centre' }))).word).toBe('load.chipNose')
    expect(balanceChip(buildTruck(loaded('sxs', { spares: 'mid-right', tools: 'mid-right' }))).word).toBe('load.chipRight')
  })

  it('has words for every fuel step', () => {
    for (const f of FUEL_STEPS) expect(t(`load.fuel${Math.round(f * 100)}` as never)).toBeTruthy()
    expect(fuelWords(0.5)).toBe('Half a tank')
  })
})
