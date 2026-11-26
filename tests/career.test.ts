/**
 * The career (plan PR 9a): the calendar, contracts, money, your own truck,
 * the rival teams who copy what wins, the soft landing when broke, the Long
 * One, and the career's place in the save (format 2).
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR, CAREER, CLASS_MONEY, TEAMS, TIERS, UPGRADES } from '../src/data/career'
import { CLASSES } from '../src/data/classes'
import type { TruckBuild } from '../src/data/kit'
import { SLOTS } from '../src/data/parts'
import { RAID, RAIDS, type RaidId } from '../src/data/raids'
import { SAVE } from '../src/data/save'
import { readSave, newSave } from '../src/persist/save'
import { changeCost, checkBuild, massAndCost, partIn, partsFor, stockBuild } from '../src/sim/build'
import {
  buyTruck, buyUpgrade, cheapestBuild, contractProblems, contractRaid, crewHours, driveAuto, enterOwn, entryProblems, eventSeed,
  fitOwn, isBroke, newCareer, nextEvent, offers, sellTruck, setContractBuild, settle, takeContract, truckPrice, truckValue,
  upgradeProblem, type CareerState,
} from '../src/sim/career'
import { enterRaid, type RaidState, type StageRecord } from '../src/sim/raid'
import { Rng } from '../src/sim/rng'
import { careerField, copyWinner, ratings, teamBudget, teamBuild, teamPace, teamsForYear } from '../src/sim/teams'

/** Sit out raids until the career reaches the `next` raid of `year`. */
function skipTo(c: CareerState, year: number, next = 0): void {
  while (c.year < year || (c.year === year && c.next < next)) settle(c, null)
}

/**
 * A finished raid without driving it: every stage done, the player's time
 * `mine` and each rival's `theirs`. For testing the pay-out quickly.
 */
function fakeDone(state: RaidState, mine: number, theirs: (id: string) => number): RaidState {
  const raid = RAIDS[state.entry.raid]
  const field = state.entry.field ?? []
  state.results = raid.stages.map((): StageRecord => ({
    time: mine, paces: ['steady', 'steady', 'steady'], stops: [], late: false, limped: false,
    rivals: field.map((r) => ({ id: r.id, splits: [1, 2, theirs(r.id)], time: theirs(r.id), trouble: null, late: false })),
  }))
  state.stage = raid.stages.length
  state.phase = 'done'
  return state
}

/** A build that passes a contract: the cheapest legal parts if the stock truck is over the budget. */
function fitContract(b: TruckBuild, budget: number, year: number): TruckBuild {
  return checkBuild(b, { year, budget }).length ? cheapestBuild(b, year) : b
}

describe('starting a career', () => {
  it('starts in 1985 with a little money, no truck, and the rival teams who race that year', () => {
    const c = newCareer(1)
    expect(c.year).toBe(1985)
    expect(c.money).toBe(CAREER.startMoney)
    expect(c.own).toBeNull()
    expect(nextEvent(c)).toBe(CALENDAR[0])
    expect(c.day).toBeLessThan(CALENDAR[0]!.day)
    expect(Object.keys(c.teams.brannigan)).toEqual(['light4x4'])
    expect(Object.keys(c.teams.hardpan)).toEqual(['heavy'])
    expect(Object.keys(c.teams.jackrabbit)).toEqual(['sxs'])
    expect(Object.keys(c.teams.highbank)).toEqual([])
  })

  it('has eight raids a year, in order: the Winter Sprint first and the Long One last', () => {
    expect(CALENDAR.length).toBe(8)
    expect(CALENDAR[0]!.raid).toBe('winterSprint')
    expect(RAIDS.winterSprint.stages.length).toBe(3)
    expect(CALENDAR.filter((e) => RAIDS[e.raid].season === 'winter').map((e) => e.raid)).toEqual(['winterSprint', 'winterRaid'])
    for (let i = 1; i < CALENDAR.length; i++) expect(CALENDAR[i]!.day).toBeGreaterThan(CALENDAR[i - 1]!.day + RAIDS[CALENDAR[i - 1]!.raid].stages.length)
    expect(CALENDAR.at(-1)!.raid).toBe('longOne')
    expect(RAIDS.longOne.stages.length).toBe(14)
  })
})

describe('prep contracts', () => {
  it('are the same for the same career, and the first is always open to anyone in a cheap class', () => {
    const a = newCareer(42)
    const b = newCareer(42)
    expect(offers(a)).toEqual(offers(b))
    for (let seed = 0; seed < 30; seed++) {
      const c = newCareer(seed)
      for (let e = 0; e < CALENDAR.length; e++) {
        const first = offers(c)[0]!
        expect(first.rep).toBe(0)
        expect(['light4x4', 'sxs']).toContain(first.cls)
        settle(c, null)
      }
    }
  })

  it('always leave room for a legal truck under the budget, from 1985 to 2025', () => {
    for (let seed = 0; seed < 25; seed++) {
      for (const year of [1985, 2025]) {
        const c = newCareer(seed)
        c.year = year
        for (let e = 0; e < CALENDAR.length; e++) {
          c.next = e
          for (const o of offers(c)) {
            const b = fitContract(stockBuild(o.cls), o.budget, year)
            expect(checkBuild(b, { year, budget: o.budget }), `${seed} ${year} ${o.id} ${o.cls} ${o.budget}`).toEqual([])
          }
        }
      }
    }
  })

  it('pay a fee and a bonus by result once the privateer has raced the truck', () => {
    const c = newCareer(7)
    const o = offers(c)[0]!
    takeContract(c, o)
    expect(() => takeContract(c, o)).toThrow()
    const over = { ...stockBuild(o.cls), parts: { ...stockBuild(o.cls).parts, engine: partsFor(o.cls, 'engine').at(-1)!.id } }
    setContractBuild(c, over)
    if (massAndCost(over).cost > o.budget) expect(contractProblems(c).some((p) => p.kind === 'overBudget')).toBe(true)
    setContractBuild(c, fitContract(stockBuild(o.cls), o.budget, c.year))
    expect(contractProblems(c)).toEqual([])
    const state = contractRaid(c)
    expect(state.entry.seed).toBe(eventSeed(c))
    expect(state.entry.driver).toBe(o.driver)
    expect(state.entry.field!.length).toBeGreaterThanOrEqual(3)
    driveAuto(state)
    const money = c.money
    const s = settle(c, state)
    expect(s.fee).toBe(o.fee)
    const earned = s.pos === 1 ? o.bonus.win : s.pos! <= 3 ? o.bonus.podium : s.finished ? o.bonus.finish : 0
    expect(s.bonus).toBe(earned)
    expect(s.repairs).toBe(0)
    expect(c.money).toBe(money + o.fee + earned)
    expect(c.job).toBeNull()
    expect(c.next).toBe(1)
    expect(c.day).toBe(CALENDAR[0]!.day + RAIDS.summerSprint.stages.length + 2)
    expect(c.stats.contracts).toBe(1)
    expect(c.news.some((n) => n.kind === 'result' && n.job === 'contract')).toBe(true)
  }, 60_000)

  it('need the reputation they ask for', () => {
    const c = newCareer(3)
    const picky = { ...offers(c)[0]!, rep: 50 }
    expect(() => takeContract(c, picky)).toThrow()
  })
})

describe('your own truck', () => {
  it('is bought at its stock price, sells for half, and upgrades cost the new part less half the old one', () => {
    const c = newCareer(1)
    expect(() => buyTruck(c, 'light4x4')).toThrow()
    c.money = 100_000
    buyTruck(c, 'light4x4')
    expect(c.money).toBe(100_000 - truckPrice(c, 'light4x4'))
    const own = c.own!
    const better = { ...own, parts: { ...own.parts, bumpStops: 'urethane' } }
    const before = c.money
    const cost = fitOwn(c, better)
    expect(cost).toBe(partIn(better, 'bumpStops').cost.light4x4! - partIn(own, 'bumpStops').cost.light4x4! * CAREER.resale)
    expect(cost).toBeGreaterThan(0)
    expect(c.money).toBe(before - cost)
    // Settings are free.
    expect(fitOwn(c, { ...c.own!, front: { ...c.own!.front, tirePressure: c.own!.front.tirePressure + 0.1e5 } })).toBe(0)
    // A part that isn't out yet can't be fitted, and a truck can't change class.
    expect(() => fitOwn(c, { ...c.own!, parts: { ...c.own!.parts, dampers: 'electronic' } })).toThrow()
    expect(() => fitOwn(c, stockBuild('sxs'))).toThrow()
    const value = truckValue(c.own!)
    const money = c.money
    sellTruck(c)
    expect(c.own).toBeNull()
    expect(c.money).toBe(money + value)
  })

  it('pays only for changed parts under the build rules, with money back for parts sold', () => {
    const a = stockBuild('heavy')
    const b = { ...a, parts: { ...a.parts, engine: 'dieselV8' } }
    expect(changeCost(a, a, 0.5)).toBe(0)
    expect(changeCost(a, b, 0.5)).toBe(55000 - 30000 * 0.5)
    expect(changeCost(b, a, 0.5)).toBe(30000 - 55000 * 0.5)
    expect(changeCost(a, b, 0.5, 0.25)).toBe(55000 * 0.75 - 30000 * 0.5)
    const rules = { year: 1985, budget: 10_000, owned: { build: a, resale: 0.5, discount: 0 } }
    expect(checkBuild(a, rules)).toEqual([])
    expect(checkBuild(b, rules).map((p) => p.kind)).toEqual(['overBudget'])
  })

  it('needs a truck, the reputation, the driver and the money to enter', () => {
    const c = newCareer(1)
    expect(entryProblems(c, 'veteran').map((p) => p.kind)).toEqual(['noTruck'])
    c.money = 40_000
    buyTruck(c, 'light4x4')
    expect(entryProblems(c, 'veteran')).toEqual([])
    expect(entryProblems(c, 'gravelAce').map((p) => p.kind)).toEqual(['driverRep'])
    const bench = { ...c.own!, parts: { ...c.own!.parts, bumpStops: 'urethane' } }
    expect(entryProblems(c, 'veteran', bench).map((p) => p.kind)).toEqual(['parts'])
    skipTo(c, 1985, CALENDAR.findIndex((e) => e.raid === 'nationalRaid'))
    expect(nextEvent(c).tier).toBe('national')
    expect(entryProblems(c, 'veteran').map((p) => p.kind)).toEqual(['rep'])
    c.rep = TIERS.national.rep
    c.money = 100
    expect(entryProblems(c, 'veteran').map((p) => p.kind)).toEqual(['money'])
  })

  it('enters with the fees paid, the sponsor paying in, the year roads and the crew hours', () => {
    const c = newCareer(9)
    c.money = 60_000
    buyTruck(c, 'sxs')
    c.rep = 12
    buyUpgrade(c, 'secondMechanic')
    const money = c.money
    const state = enterOwn(c, 'veteran')
    const fees = TIERS.regional.entryFee * CLASS_MONEY.sxs + 2000 * CLASS_MONEY.sxs - 1500 * CLASS_MONEY.sxs
    expect(c.money).toBeCloseTo(money - fees, 6)
    expect(c.job).toEqual({ kind: 'own', driver: 'veteran' })
    expect(state.entry.hours).toBe(RAID.bivouacHours + 2)
    expect(crewHours(c)).toBe(RAID.bivouacHours + 2)
    expect(state.entry.seed).toBe(eventSeed(c))
    expect(() => sellTruck(c)).toThrow()
    expect(() => fitOwn(c, c.own!)).toThrow()
  })

  it('pays prize money by place, then the repair bill', () => {
    const c = newCareer(5)
    c.money = 40_000
    buyTruck(c, 'light4x4')
    const state = enterOwn(c, 'veteran')
    state.wear.tire[0]!.damage = 1
    fakeDone(state, 100, () => 200)
    const money = c.money
    const s = settle(c, state)
    expect(s.pos).toBe(1)
    expect(s.prize).toBe(TIERS.regional.prizes[0])
    // A wrecked tire: a quarter of the tire set's price, times the repair share.
    expect(s.repairs).toBe(Math.round((partIn(state.entry.build, 'tires').cost.light4x4! / 4) * CAREER.repairShare))
    expect(c.money).toBe(money + s.prize - s.repairs - s.spares)
    expect(c.rep).toBe(TIERS.regional.repFor.win)
    expect(c.stats).toMatchObject({ raids: 1, wins: 1, podiums: 1 })
    expect(s.winners.light4x4).toBe('you')
  })

  it('retiring earns nothing and the rivals take the places', () => {
    const c = newCareer(5)
    c.money = 40_000
    buyTruck(c, 'light4x4')
    const state = enterOwn(c, 'veteran')
    const s = settle(c, state, true)
    expect(s.pos).toBeNull()
    expect(s.prize).toBe(0)
    expect(s.rep).toBe(0)
    expect(s.winners.light4x4).not.toBe('you')
  })
})

describe('the Long One', () => {
  it('needs a big reputation, and winning it goes in the record without ending the career', () => {
    const c = newCareer(11)
    c.money = 200_000
    buyTruck(c, 'light4x4')
    skipTo(c, 1985, CALENDAR.findIndex((e) => e.raid === 'longOne'))
    expect(nextEvent(c).raid).toBe('longOne')
    expect(entryProblems(c, 'veteran').map((p) => p.kind)).toEqual(['rep'])
    c.rep = TIERS.long.rep
    const state = enterOwn(c, 'veteran')
    fakeDone(state, 100, () => 200)
    const s = settle(c, state)
    expect(s.wonLongOne).toBe(true)
    expect(c.longOne).toEqual([1985])
    expect(c.news.some((n) => n.kind === 'longOne')).toBe(true)
    // On to the next season.
    expect(c.year).toBe(1986)
    expect(c.next).toBe(0)
  })
})

describe('the years', () => {
  it('roll on to 2025 and stay there while the seasons keep counting, with the news of new parts', () => {
    const c = newCareer(2)
    skipTo(c, 1988)
    expect(c.news.some((n) => n.kind === 'newParts' && n.year === 1988 && n.parts.includes('alloyWheels'))).toBe(true)
    skipTo(c, 2025)
    expect(c.season).toBe(40)
    for (let i = 0; i < CALENDAR.length; i++) settle(c, null)
    expect(c.year).toBe(2025)
    expect(c.season).toBe(41)
    // Every team races every class it joins by 2025.
    for (const team of Object.values(TEAMS)) expect(Object.keys(c.teams[team.id]).sort()).toEqual(team.classes.map((x) => x.cls).sort())
  }, 60_000)

  it('is the same for the same seed', () => {
    const a = newCareer(77)
    const b = newCareer(77)
    skipTo(a, 1990)
    skipTo(b, 1990)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  }, 30_000)
})

describe('rival teams', () => {
  it('rate a stock truck as stock, and a better truck as quicker and more reliable', () => {
    const stock = stockBuild('light4x4')
    expect(ratings(stock)).toEqual({ heat: 1, travel: 1, strength: 1, power: 1 })
    const better = { ...stock, parts: { ...stock.parts, dampers: 'bypass', axles: 'heavyDutyAxles', frame: 'boxedLadder' } }
    const a = teamPace(TEAMS.brannigan, stock)
    const b = teamPace(TEAMS.brannigan, better)
    expect(b.pace).toBeLessThan(a.pace)
    expect(b.risk).toBeLessThan(a.risk)
  })

  it('buy in their own way, inside their budget and the weight window, with parts that are out', () => {
    for (const year of [1985, 2000, 2025]) {
      for (const team of Object.values(TEAMS)) {
        for (const { cls } of team.classes) {
          const b = teamBuild(team, cls, year)
          const cl = CLASSES.find((x) => x.id === cls)!
          const { mass, cost } = massAndCost(b)
          expect(cost).toBeLessThanOrEqual(teamBudget(team, cls, year) + 1e-6)
          expect(mass).toBeGreaterThanOrEqual(cl.minMass)
          expect(mass).toBeLessThanOrEqual(cl.maxMass)
          for (const slot of SLOTS) expect(partIn(b, slot).year).toBeLessThanOrEqual(year)
        }
      }
    }
    // New money buys the newest dampers it can; by 2025 that's past the 1990s.
    expect(partIn(teamsForYear(2025).highbank.light4x4!, 'dampers').year).toBeGreaterThanOrEqual(2008)
    // The over-builders go for the strongest frame.
    expect(teamBuild(TEAMS.hardpan, 'heavy', 1985).parts.frame).toBe('boxedLadder')
  })

  it('copy what wins, slot by slot, only with parts that are out and fit their budget', () => {
    const teams = teamsForYear(1997)
    const before = structuredClone(teams.brannigan.light4x4!)
    const winner = { ...stockBuild('light4x4'), parts: { ...stockBuild('light4x4').parts, dampers: 'bypass', bumpStops: 'urethane', antiRoll: 'adjustableBars' } }
    const copied = new Set<string>()
    for (let k = 0; k < 20; k++) {
      const t = structuredClone(teams)
      for (const slot of copyWinner(t, 'brannigan', winner, 1997, new Rng(k))) {
        copied.add(slot)
        expect(t.brannigan.light4x4!.parts[slot]).toBe(winner.parts[slot])
      }
      expect(massAndCost(t.brannigan.light4x4!).cost).toBeLessThanOrEqual(teamBudget(TEAMS.brannigan, 'light4x4', 1997) + 1e-6)
    }
    expect(copied.size).toBeGreaterThan(0)
    expect(teams.brannigan.light4x4).toEqual(before)
    // Nothing from the future.
    const future = { ...winner, parts: { ...winner.parts, dampers: 'electronic' } }
    for (let k = 0; k < 20; k++) expect(copyWinner(structuredClone(teams), 'brannigan', future, 1997, new Rng(k))).not.toContain('dampers')
  })

  it('make up each raid field with the privateers, by tier', () => {
    const teams = teamsForYear(2010)
    const regional = careerField(teams, 'heavy', 'regional', 2010).map((r) => r.id)
    const national = careerField(teams, 'heavy', 'national', 2010).map((r) => r.id)
    expect(regional.some((id) => id.startsWith('hardpan'))).toBe(false)
    expect(national.some((id) => id.startsWith('hardpan'))).toBe(true)
    expect(national.filter((id) => id.startsWith('privateer')).length).toBe(3)
  })

  it('copy your truck when you win, and the news says so', () => {
    let found = false
    for (let seed = 0; seed < 12 && !found; seed++) {
      const c = newCareer(seed)
      c.money = 80_000
      buyTruck(c, 'light4x4')
      fitOwn(c, { ...c.own!, parts: { ...c.own!.parts, dampers: 'monotube', bumpStops: 'urethane', tires: 'heavyPly', wheels: 'beadlocks' } })
      const state = enterOwn(c, 'veteran')
      fakeDone(state, 100, () => 200)
      const s = settle(c, state)
      if (s.copies.some((x) => x.from === 'you' && x.team === 'brannigan')) found = true
    }
    expect(found).toBe(true)
  })
})

describe('broke: the soft landing', () => {
  it('stops spending and entering, but lets you sell up and take the open contract', () => {
    const c = newCareer(4)
    c.money = 40_000
    buyTruck(c, 'light4x4')
    fitOwn(c, { ...c.own!, parts: { ...c.own!.parts, engine: 'petrolV8', tires: 'heavyPly' } })
    const state = enterOwn(c, 'veteran')
    for (const part of ['tire', 'bottoming', 'axle', 'mount'] as const) for (const f of state.wear[part]) f.damage = 1
    for (const f of state.wear.frame) f.damage = 1
    c.money = 0
    fakeDone(state, 300, () => 200)
    settle(c, state)
    expect(isBroke(c)).toBe(true)
    expect(c.news.some((n) => n.kind === 'broke')).toBe(true)
    expect(entryProblems(c, 'veteran').map((p) => p.kind)).toContain('broke')
    expect(upgradeProblem(c, 'secondMechanic')).not.toBeNull()
    expect(() => fitOwn(c, { ...c.own!, parts: { ...c.own!.parts, wheels: 'beadlocks' } })).toThrow()
    // Selling parts down brings money back.
    const money = c.money
    const refund = -fitOwn(c, cheapestBuild(c.own!, c.year))
    expect(refund).toBeGreaterThan(0)
    expect(c.money).toBe(money + refund)
    expect(checkBuild(c.own!, { year: c.year, budget: Infinity })).toEqual([])
    // And there's always a contract anyone can take.
    expect(offers(c)[0]!.rep).toBe(0)
    takeContract(c, offers(c)[0]!)
  })
})

describe('the shop', () => {
  it('sells crew and tools in order, for reputation and money', () => {
    const c = newCareer(1)
    expect(upgradeProblem(c, 'secondMechanic')).toBe('rep')
    c.rep = 100
    expect(upgradeProblem(c, 'secondMechanic')).toBe('money')
    c.money = 1_000_000
    expect(upgradeProblem(c, 'thirdMechanic')).toBe('needs')
    for (const u of UPGRADES) buyUpgrade(c, u.id)
    expect(crewHours(c)).toBe(RAID.bivouacHours + 4)
    expect(upgradeProblem(c, 'press')).toBe('owned')
  })
})

describe('the career in the save (format 2)', () => {
  it('moves a format 1 save up with no career', () => {
    expect(SAVE.version).toBe(2)
    const old = { ...newSave(), v: 1 } as Record<string, unknown>
    delete old.career
    const read = readSave(old)
    expect(read.v).toBe(2)
    expect(read.career).toBeNull()
  })

  it('keeps a career, a contract on the bench and a career raid through a save', () => {
    const c = newCareer(21)
    c.money = 50_000
    buyTruck(c, 'light4x4')
    skipTo(c, 1986, 1)
    const save = newSave()
    save.career = c
    takeContract(c, offers(c)[0]!)
    expect(readSave(JSON.parse(JSON.stringify(save)))).toEqual(save)
    // An own raid in progress, with its field and hours.
    const c2 = newCareer(22)
    c2.money = 50_000
    buyTruck(c2, 'sxs')
    const s2 = newSave()
    s2.career = c2
    s2.raid = enterOwn(c2, 'veteran')
    expect(readSave(JSON.parse(JSON.stringify(s2)))).toEqual(s2)
  })

  it('drops an own-raid job that has no raid, and buys a damaged rival truck again', () => {
    const c = newCareer(23)
    c.money = 50_000
    buyTruck(c, 'light4x4')
    const save = newSave()
    save.career = c
    save.raid = enterOwn(c, 'veteran')
    const raw = JSON.parse(JSON.stringify({ ...save, raid: null }))
    raw.career.teams.brannigan.light4x4.parts.dampers = 'warpDrive'
    const read = readSave(raw)
    expect(read.career!.job).toBeNull()
    expect(read.career!.teams.brannigan.light4x4!.parts.dampers).toBe(teamsForYear(1985).brannigan.light4x4!.parts.dampers)
  })

  it('turns away a career that does not add up', () => {
    const bad = (mut: (c: Record<string, unknown>) => void): boolean => {
      const save = JSON.parse(JSON.stringify({ ...newSave(), career: newCareer(1) }))
      mut(save.career)
      try {
        readSave(save)
        return false
      } catch {
        return true
      }
    }
    expect(bad(() => {})).toBe(false)
    expect(bad((c) => (c.year = 1900))).toBe(true)
    expect(bad((c) => (c.next = CALENDAR.length))).toBe(true)
    expect(bad((c) => (c.money = 'lots'))).toBe(true)
    expect(bad((c) => (c.upgrades = ['jetpack']))).toBe(true)
    expect(bad((c) => (c.job = { kind: 'holiday' }))).toBe(true)
  })
})

describe('career raids get the truck home', () => {
  // The balance check for the career's new raids: a stock truck with a
  // light spares kit, Steady all the way, is never towed in.
  const check = (raid: RaidId, cls: 'light4x4' | 'heavy' | 'sxs') => {
    const b = stockBuild(cls)
    b.parts.spares = 'lightKit'
    const state = enterRaid(raid, b, 'veteran')
    driveAuto(state)
    expect(state.results.filter((r) => r.late).length, `${raid} ${cls}`).toBe(0)
  }
  it.each(['light4x4', 'heavy', 'sxs'] as const)('the Autumn Raid, %s', (cls) => check('autumnRaid', cls), 120_000)
  it('the Long One, light 4x4', () => check('longOne', 'light4x4'), 180_000)
})
