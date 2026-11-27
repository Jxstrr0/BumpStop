/**
 * The radio co-driver (27 November 2026): every line has its file, its words
 * and its credit; every file in public/radio/ is a line; and the calls he
 * picks match the road the truck is about to drive.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clipCall, distanceLine, spotAhead } from '../src/audio/pacenotes'
import { captionFor } from '../src/audio/radio'
import { GROUND_IDS, type GroundId } from '../src/data/ground'
import { GROUND_LINE, RADIO, RADIO_CREDIT, RADIO_FILES, RADIO_LINES, RADIO_SPOT } from '../src/data/radio'
import { SIM } from '../src/data/ride'
import { t, type StringKey } from '../src/data/strings'
import { buildProfile, type Profile } from '../src/sim/ground'
import { Rng } from '../src/sim/rng'

const PUBLIC = new URL('../public/', import.meta.url)
const credits = readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8')

describe('the co-driver’s lines', () => {
  it('every line has a small file in public/radio/, its words, and a credit', () => {
    for (const line of RADIO_LINES) {
      const file = RADIO_FILES[line]
      expect(file).toMatch(/^radio\/[a-z0-9-]+\.mp3$/)
      const path = new URL(file, PUBLIC)
      expect(existsSync(path), `${file} is missing`).toBe(true)
      expect(statSync(path).size, `${file} is over 40 KB`).toBeLessThanOrEqual(40 * 1024)
      expect(t(`radio.line.${line}` as StringKey).length, line).toBeGreaterThan(0)
      const row = credits.split('\n').find((l) => l.includes(file.replace('radio/', '')))
      expect(row, `${file} needs a line in CREDITS.md`).toBeDefined()
      expect(row).toContain(RADIO_CREDIT.licence)
    }
  })

  it('every file in public/radio/ is a line, so nothing ships uncredited', () => {
    const listed = new Set(Object.values(RADIO_FILES))
    for (const f of readdirSync(new URL('radio/', PUBLIC))) expect(listed.has(`radio/${f}`), `public/radio/${f} is not in src/data/radio.ts`).toBe(true)
  })

  it('every ground has something to say, and every spotted thing a line', () => {
    for (const g of GROUND_IDS) expect(RADIO_LINES).toContain(GROUND_LINE[g])
    for (const spot of Object.values(RADIO_SPOT)) {
      expect(RADIO_LINES).toContain(spot.line)
      expect(RADIO_LINES).toContain(spot.bigLine)
    }
  })

  it('captions read like a roadbook', () => {
    expect(captionFor(['jumpBig', 'd50'])).toBe('Caution. Big jump. 50.')
    expect(captionFor(['washboard'])).toBe('Washboard.')
  })
})

describe('distances', () => {
  it('rounds to the nearest call, and says none when it is right there', () => {
    expect(distanceLine(5)).toBeNull()
    expect(distanceLine(RADIO.minDistance - 1)).toBeNull()
    expect(distanceLine(28)).toBe('d30')
    expect(distanceLine(47)).toBe('d50')
    expect(distanceLine(72)).toBe('d80')
    expect(distanceLine(110)).toBe('d100')
    expect(distanceLine(170)).toBe('d200')
    expect(distanceLine(Number.NaN)).toBeNull()
  })
})

/** A flat road with bumps of the given height and length stamped in at given places, on both tracks. */
function road(ground: GroundId, length: number, bumps: { at: number; h: number; len: number }[]): Profile {
  const step = SIM.profileStep
  const n = Math.floor(length / step) + 1
  const left = new Float64Array(n)
  for (const b of bumps) {
    for (let i = 0; i < n; i++) {
      const u = (i * step - b.at) / b.len
      if (u >= 0 && u <= 1) left[i] = (left[i] as number) + b.h * (0.5 - 0.5 * Math.cos(2 * Math.PI * u))
    }
  }
  return { ground, step, length: (n - 1) * step, left, right: left.slice() }
}

describe('reading the road', () => {
  it('finds a jump and says how far it is', () => {
    const r = road('jumps', 200, [{ at: 95, h: 0.6, len: 14 }])
    const spotted = spotAhead(r, 'jumps', 40, 160)
    expect(spotted).not.toBeNull()
    expect(spotted!.ahead).toBeGreaterThan(40)
    expect(spotted!.ahead).toBeLessThan(70)
    expect(clipCall({ ground: 'jumps', road: r, from: 40, to: 150 }, null)?.lines).toEqual(['jump', 'd50'])
  })

  it('a big one gets a Caution', () => {
    const r = road('jumps', 200, [{ at: 75, h: 1.0, len: 14 }])
    expect(clipCall({ ground: 'jumps', road: r, from: 40, to: 150 }, null)?.lines).toEqual(['jumpBig', 'd30'])
  })

  it('something right under the truck gets its name only', () => {
    const r = road('rocks', 120, [{ at: 45, h: 0.15, len: 0.5 }])
    expect(clipCall({ ground: 'rocks', road: r, from: 40, to: 90 }, null)?.lines).toEqual(['rocksBig'])
  })

  it('a set of whoops is called by its tallest', () => {
    const set = [0, 1, 2, 3, 4].map((k) => ({ at: 80 + 7 * k, h: k === 3 ? 0.28 : 0.14, len: 7 }))
    const r = road('whoops', 200, set)
    expect(clipCall({ ground: 'whoops', road: r, from: 40, to: 150 }, null)?.lines).toEqual(['whoopsBig', 'd50'])
  })

  it('a frost heave with a crack edge facing the truck is a step up', () => {
    const r = road('iceHeaves', 150, [{ at: 80, h: 0.12, len: 5 }])
    const up = r.left.slice()
    const crack = Math.round(83 / r.step)
    for (let i = crack; i < crack + 40; i++) up[i] = (up[i] as number) + 0.05
    const stepped: Profile = { ...r, left: up, right: up.slice() }
    expect(clipCall({ ground: 'iceHeaves', road: r, from: 40, to: 120 }, null)?.lines[0]).toBe('heave')
    expect(clipCall({ ground: 'iceHeaves', road: stepped, from: 40, to: 120 }, null)?.lines[0]).toBe('heaveStep')
  })

  it('plain ground is called once, when it changes, and nothing is called twice for nothing', () => {
    const r = road('washboard', 150, [])
    expect(clipCall({ ground: 'washboard', road: r, from: 40, to: 100 }, null)).toEqual({ lines: ['washboard'], ground: 'washboard' })
    expect(clipCall({ ground: 'washboard', road: r, from: 40, to: 100 }, 'washboard')).toBeNull()
    expect(clipCall({ ground: 'graded', road: { ...r, ground: 'graded' }, from: 40, to: 100 }, 'washboard')?.lines).toEqual(['flat'])
  })

  it('a stretch of whoops with none in sight is just called by name when it starts', () => {
    const r = road('whoops', 150, [])
    expect(clipCall({ ground: 'whoops', road: r, from: 40, to: 100 }, 'graded')?.lines).toEqual(['whoops'])
    expect(clipCall({ ground: 'whoops', road: r, from: 40, to: 100 }, 'whoops')).toBeNull()
  })

  it('on the real seeded roads, every rough ground gets a call most of the time, and smooth ground none', () => {
    const rng = new Rng(2026)
    for (const g of ['whoops', 'rocks', 'jumps', 'iceHeaves'] as const) {
      let found = 0
      for (let k = 0; k < 20; k++) {
        const p = buildProfile(g, 200, rng.fork(`${g}-${k}`))
        if (spotAhead(p, g, 40, 160)) found++
      }
      expect(found, g).toBeGreaterThanOrEqual(g === 'jumps' || g === 'whoops' ? 10 : 16)
    }
    for (const g of ['graded', 'washboard', 'rough', 'ice', 'snow'] as const) {
      const p = buildProfile(g, 200, rng.fork(g))
      expect(spotAhead(p, g, 40, 160), g).toBeNull()
    }
  })
})
