/**
 * Dev mode (27 November 2026): the switches stay on this phone, and Unlock
 * parts puts every part on sale for the player but never for rival teams.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { CAREER } from '../src/data/career'
import { checkBuild, partOnSale, setPartsUnlocked, shopRules, stockBuild } from '../src/sim/build'
import { buyTruck, fitOwn, newCareer } from '../src/sim/career'
import { applyDev, readDev, writeDev } from '../src/ui/devMode'
import { t } from '../src/data/strings'

/** A pretend localStorage. */
function memory(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

// Each test starts and ends with the normal rules.
afterEach(() => setPartsUnlocked(false))

describe('dev mode switches', () => {
  it('start off, and anything odd reads as off', () => {
    expect(readDev(memory())).toEqual({ on: false, unlockParts: false })
    expect(readDev(undefined)).toEqual({ on: false, unlockParts: false })
    const s = memory()
    s.setItem('bumpstop.dev', 'not json')
    expect(readDev(s)).toEqual({ on: false, unlockParts: false })
  })

  it('are kept under a bumpstop. key', () => {
    const s = memory()
    writeDev({ on: true, unlockParts: true }, s)
    expect(s.getItem('bumpstop.dev')).not.toBeNull()
    expect(readDev(s)).toEqual({ on: true, unlockParts: true })
  })

  it('Unlock parts only counts while dev mode is on', () => {
    const late = { year: 2023 }
    applyDev({ on: false, unlockParts: true })
    expect(partOnSale(late, 1985)).toBe(false)
    applyDev({ on: true, unlockParts: true })
    expect(partOnSale(late, 1985)).toBe(true)
    applyDev({ on: true, unlockParts: false })
    expect(partOnSale(late, 1985)).toBe(false)
  })

  it('has its words', () => {
    for (const k of ['dev.title', 'dev.on', 'dev.unlockParts', 'dev.unlockOn', 'dev.unlockOff', 'dev.buildBanner'] as const) {
      expect(t(k).length).toBeGreaterThan(0)
    }
  })
})

describe('Unlock parts', () => {
  const future = () => {
    const b = stockBuild('light4x4')
    return { ...b, parts: { ...b.parts, engine: 'twinTurboV6' } }
  }

  it('lets a 1985 shop build use a 2017 engine, and locks it again when off', () => {
    const b = future()
    expect(checkBuild(b, shopRules('light4x4', 1985)).some((p) => p.kind === 'notYet')).toBe(true)
    setPartsUnlocked(true)
    expect(checkBuild(b, shopRules('light4x4', 1985)).some((p) => p.kind === 'notYet')).toBe(false)
    setPartsUnlocked(false)
    expect(checkBuild(b, shopRules('light4x4', 1985)).some((p) => p.kind === 'notYet')).toBe(true)
  })

  it('lets your own career truck be fitted with it (money still counts)', () => {
    const c = newCareer(7)
    c.money = CAREER.startMoney * 20
    buyTruck(c, 'light4x4')
    expect(() => fitOwn(c, future())).toThrow(/isn't out yet/)
    setPartsUnlocked(true)
    expect(() => fitOwn(c, future())).not.toThrow()
    expect(c.own?.parts.engine).toBe('twinTurboV6')
  })
})
