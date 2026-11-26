import { describe, expect, it } from 'vitest'
import { CLASSES, type ClassId } from '../src/data/classes'
import { KITS, type TruckBuild } from '../src/data/kit'
import { PARTS, SLOTS } from '../src/data/parts'
import { TEST_MULES } from '../src/data/ride'
import { t } from '../src/data/strings'
import { MULE_WEAR } from '../src/data/wear'
import {
  buildTruck,
  checkBuild,
  clickScale,
  fitsClass,
  massAndCost,
  partsFor,
  shopRules,
  stockBuild,
  tidyBuild,
} from '../src/sim/build'

const IDS: readonly ClassId[] = CLASSES.map((c) => c.id)
const mm = 0.001
const kPa = 1000

/** The stock build with some changes. */
function withChange(cls: ClassId, change: (b: TruckBuild) => void): TruckBuild {
  const b = stockBuild(cls)
  change(b)
  return b
}

describe('the parts', () => {
  it('have unique ids, real strings, sensible years, and a size in at least one class', () => {
    const ids = PARTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PARTS) {
      expect(t(p.name), p.id).toBeTruthy()
      expect(t(p.text), p.id).toBeTruthy()
      expect(p.year).toBeGreaterThanOrEqual(1985)
      expect(p.year).toBeLessThanOrEqual(2025)
      expect(IDS.some((c) => fitsClass(p, c)), p.id).toBe(true)
      for (const c of IDS) expect(p.mass[c] === undefined, `${p.id} lists a mass but no cost for ${c}`).toBe(p.cost[c] === undefined)
    }
  })

  it('give every class a choice in every slot in 1985', () => {
    for (const c of IDS) {
      for (const slot of SLOTS) {
        const first = partsFor(c, slot).filter((p) => p.year <= 1985)
        expect(first.length, `${c} ${slot}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('the stock builds', () => {
  it.each(IDS)('%s: may race in 1985, under its weight window and budget', (c) => {
    expect(checkBuild(stockBuild(c), shopRules(c, 1985))).toEqual([])
  })

  it.each(IDS)('%s: weighs what its test mule weighs and leaves room to spend', (c) => {
    const mule = TEST_MULES[c]
    const { mass, cost } = massAndCost(stockBuild(c))
    expect(mass).toBeCloseTo(mule.sprungMass + 2 * mule.front.unsprungMass + 2 * mule.rear.unsprungMass, 6)
    expect(cost).toBeLessThan(KITS[c].budget * 0.75)
  })

  it.each(IDS)('%s: drives on the test mule’s numbers', (c) => {
    const truck = buildTruck(stockBuild(c))
    const mule = TEST_MULES[c]
    expect(truck.ride.sprungMass).toBeCloseTo(mule.sprungMass, 6)
    for (const end of ['front', 'rear'] as const) {
      const a = truck.ride[end]
      const m = mule[end]
      expect(a.springRate).toBe(m.springRate)
      expect(a.unsprungMass).toBeCloseTo(m.unsprungMass, 6)
      expect(a.tireRate).toBeCloseTo(m.tireRate, 3)
      expect(a.bumpStopLength).toBeCloseTo(m.bumpStopLength, 6)
      expect(a.damper).toEqual(m.damper)
      expect(truck.wear[end].mount).toEqual(MULE_WEAR[c][end].mount)
      expect(truck.wear[end].axle.strength).toBe(MULE_WEAR[c][end].axle.strength)
    }
    // The light 4x4 and heavy truck sit within 6 mm of the mule's ride height. The side-by-side
    // sits on its spring now (no loose coil at full droop), so it has more bump travel.
    if (c !== 'sxs') {
      for (const end of ['front', 'rear'] as const) {
        expect(Math.abs(truck.ride[end].bumpTravel - mule[end].bumpTravel)).toBeLessThan(6 * mm)
        expect(Math.abs(truck.ride[end].droopTravel - mule[end].droopTravel)).toBeLessThan(6 * mm)
      }
    }
  })

  it('come out the same every time', () => {
    for (const c of IDS) expect(buildTruck(stockBuild(c))).toEqual(buildTruck(stockBuild(c)))
  })
})

describe('studded tires (winter)', () => {
  it.each(IDS)('%s: come in two casings, a little heavier than plain, and pass the studs to the wear model', (c) => {
    const studded = partsFor(c, 'tires').filter((p) => p.slot === 'tires' && p.studded)
    expect(studded.length).toBe(2)
    const plain = stockBuild(c)
    const withStuds = { ...plain, parts: { ...plain.parts, tires: 'studdedRally' } }
    const a = buildTruck(plain)
    const b = buildTruck(withStuds)
    expect(b.mass).toBeGreaterThan(a.mass)
    expect(a.wear.front.tire.studded).toBe(false)
    expect(b.wear.front.tire.studded).toBe(true)
    expect(b.wear.rear.tire.studded).toBe(true)
  })
})

describe('ride height comes from the spring', () => {
  it('a softer spring sags more: less bump travel, more droop, the same total', () => {
    const stock = buildTruck(stockBuild('light4x4')).front
    const soft = buildTruck(withChange('light4x4', (b) => (b.front.springRate = 24000))).front
    expect(soft.sag).toBeGreaterThan(stock.sag)
    expect(soft.bumpTravel).toBeLessThan(stock.bumpTravel)
    expect(soft.droopTravel).toBeGreaterThan(stock.droopTravel)
    expect(soft.bumpTravel + soft.sag).toBeCloseTo(stock.bumpTravel + stock.sag, 9)
  })

  it('preload lifts the truck: more bump travel, less droop', () => {
    const stock = buildTruck(stockBuild('heavy')).rear
    const lifted = buildTruck(withChange('heavy', (b) => (b.rear.preload = 40 * mm))).rear
    expect(lifted.bumpTravel - stock.bumpTravel).toBeCloseTo(20 * mm, 9)
    expect(stock.droopTravel - lifted.droopTravel).toBeCloseTo(20 * mm, 9)
  })

  it('a limit strap cuts droop without lifting the truck, and moves the joint angle with it', () => {
    const stock = buildTruck(stockBuild('light4x4'))
    const strapped = buildTruck(withChange('light4x4', (b) => (b.front.droopLimit = 80 * mm)))
    expect(strapped.front.droopTravel).toBeCloseTo(80 * mm, 9)
    expect(strapped.front.bumpTravel).toBe(stock.front.bumpTravel)
    // Same place in the stroke, so the same straight point; less droop means less bend at full droop.
    expect(strapped.wear.front.axle.straightAt).toBe(stock.wear.front.axle.straightAt)
  })

  it('the joint runs straight at the same place in the stroke, wherever the truck sits', () => {
    const stock = buildTruck(stockBuild('sxs'))
    const soft = buildTruck(withChange('sxs', (b) => (b.front.springRate = 9000)))
    const extraSag = soft.front.sag - stock.front.sag
    expect(soft.wear.front.axle.straightAt).toBeCloseTo(stock.wear.front.axle.straightAt - extraSag, 9)
  })

  it('more travel from long-travel arms, less from leaf springs', () => {
    const stock = buildTruck(stockBuild('sxs')).front.travel
    expect(buildTruck(withChange('sxs', (b) => (b.parts.frontSusp = 'longArms'))).front.travel).toBeGreaterThan(stock)
    const light = buildTruck(stockBuild('light4x4')).rear.travel
    expect(buildTruck(withChange('light4x4', (b) => (b.parts.rearSusp = 'leafAxle'))).rear.travel).toBeLessThan(light)
  })
})

describe('tire pressure', () => {
  it('sets the tire stiffness: the reference pressure gives the mule’s, lower is softer', () => {
    const rate = (p: number) => buildTruck(withChange('light4x4', (b) => (b.front.tirePressure = p))).front.tireRate
    expect(rate(180 * kPa)).toBeCloseTo(TEST_MULES.light4x4.front.tireRate, 3)
    expect(rate(120 * kPa)).toBeLessThan(rate(180 * kPa))
    expect(rate(240 * kPa)).toBeGreaterThan(rate(180 * kPa))
    // The casing keeps some stiffness even at half the pressure.
    expect(rate(90 * kPa)).toBeGreaterThan(0.5 * rate(180 * kPa))
  })

  it('goes lower on beadlocks', () => {
    const plain = tidyBuild(withChange('light4x4', (b) => (b.front.tirePressure = 60 * kPa)))
    expect(plain.front.tirePressure).toBe(KITS.light4x4.ranges.tirePressure.min)
    const beadlocks = tidyBuild(
      withChange('light4x4', (b) => {
        b.parts.wheels = 'beadlocks'
        b.front.tirePressure = 60 * kPa
      }),
    )
    expect(beadlocks.front.tirePressure).toBe(60 * kPa)
  })
})

describe('damper clicks', () => {
  it('each click is 7% firmer or softer', () => {
    expect(clickScale(0)).toBe(1)
    expect(clickScale(1)).toBeCloseTo(1.07, 9)
    expect(clickScale(-2)).toBeCloseTo(1 / (1.07 * 1.07), 9)
  })

  it('only the adjusters a damper has do anything', () => {
    // Monotubes only adjust rebound.
    const mono = buildTruck(withChange('light4x4', (b) => Object.assign(b.front, { compLow: 3, rebound: 3 })))
    const stock = buildTruck(stockBuild('light4x4'))
    expect(mono.ride.front.damper.compLow).toBe(stock.ride.front.damper.compLow)
    expect(mono.ride.front.damper.rebLow).toBeGreaterThan(stock.ride.front.damper.rebLow)
    // Bypass shocks adjust everything, up to 4 clicks each way.
    const bypass = buildTruck(
      withChange('light4x4', (b) => {
        b.parts.dampers = 'bypass'
        Object.assign(b.front, { compLow: 9, compHigh: -2 })
      }),
    )
    expect(bypass.build.front.compLow).toBe(4)
    expect(bypass.ride.front.damper.compLow).toBeCloseTo(stock.ride.front.damper.compLow * clickScale(4), 6)
    expect(bypass.ride.front.damper.compHigh).toBeLessThan(stock.ride.front.damper.compHigh)
  })

  it('bigger dampers hold more oil and take more heat before they fade', () => {
    const stock = buildTruck(stockBuild('sxs')).ride.rear.damper
    const reservoir = buildTruck(withChange('sxs', (b) => (b.parts.dampers = 'remoteReservoir'))).ride.rear.damper
    expect(reservoir.heatCapacity).toBeGreaterThan(stock.heatCapacity)
    expect(reservoir.redLine).toBeGreaterThan(stock.redLine)
  })
})

describe('the rules', () => {
  it('flag a truck that is too heavy, with how much over', () => {
    const fat = withChange('light4x4', (b) => {
      b.parts.frame = 'boxedLadder'
      b.parts.protection = 'fullArmour'
      b.parts.spares = 'fullKit'
      b.parts.engine = 'petrolV8'
    })
    const problems = checkBuild(fat, shopRules('light4x4', 1985))
    const heavy = problems.find((p) => p.kind === 'tooHeavy')
    expect(heavy).toBeDefined()
    expect(massAndCost(fat).mass - 2100).toBe(heavy?.kind === 'tooHeavy' ? heavy.by : NaN)
  })

  it('flag going over budget', () => {
    const dear = withChange('sxs', (b) => {
      b.parts.dampers = 'electronic'
      b.parts.frame = 'chromolyTube'
      b.parts.engine = 'turboTwin'
    })
    expect(checkBuild(dear, shopRules('sxs', 2025)).map((p) => p.kind)).toContain('overBudget')
  })

  it('flag parts that are not out yet', () => {
    const early = withChange('heavy', (b) => (b.parts.dampers = 'bypass'))
    expect(checkBuild(early, shopRules('heavy', 1990))).toEqual([{ kind: 'notYet', slot: 'dampers', part: 'bypass', year: 1996 }])
    expect(checkBuild(early, shopRules('heavy', 1996))).toEqual([])
  })

  it('refuse a part from another class', () => {
    expect(() => buildTruck(withChange('sxs', (b) => (b.parts.frame = 'ladder')))).toThrow(RangeError)
  })

  it('keep settings inside their ranges', () => {
    const wild = tidyBuild(
      withChange('heavy', (b) => {
        b.front.springRate = 1e9
        b.front.preload = -1
        b.front.bumpStop = 0
        b.front.antiRoll = 5
      }),
    )
    const r = KITS.heavy.ranges
    expect(wild.front.springRate).toBe(r.springRate.max)
    expect(wild.front.preload).toBe(r.preload.min)
    expect(wild.front.bumpStop).toBe(r.bumpStop.min)
    // Fixed bars have no positions.
    expect(wild.front.antiRoll).toBe(0)
  })
})
