/**
 * Real recordings (docs/SOUND.md, "Recordings"): every listed file is there,
 * small, openly licensed and credited; every file in public/sounds/ is
 * listed; and the tidy-up evens out loudness and length without clicks.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { maxLength, prepareSamples } from '../src/audio/recordings'
import { VOICE_NAMES } from '../src/audio/voices'
import { LICENCES, RECORDED_SOUNDS, RECORDING_PREP, RECORDINGS } from '../src/data/recordings'

const PUBLIC = new URL('../public/', import.meta.url)
const credits = readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8')

describe('the recordings list', () => {
  it('covers every made short sound, plus the hiss loop', () => {
    expect([...RECORDED_SOUNDS].sort()).toEqual([...VOICE_NAMES, 'hissLoop'].sort())
  })

  it('every recording is in public/sounds/, small, openly licensed and credited in CREDITS.md', () => {
    for (const rec of RECORDINGS) {
      expect(rec.file, rec.file).toMatch(/^sounds\/[a-z0-9-]+\.(mp3|ogg)$/)
      const path = new URL(rec.file, PUBLIC)
      expect(existsSync(path), `${rec.file} is missing`).toBe(true)
      expect(statSync(path).size, `${rec.file} is over 300 KB`).toBeLessThanOrEqual(300 * 1024)
      expect(RECORDED_SOUNDS).toContain(rec.sound)
      expect(LICENCES).toContain(rec.licence)
      expect(rec.source, rec.file).toMatch(/^https:\/\//)
      expect(rec.title.length && rec.author.length, rec.file).toBeGreaterThan(0)
      expect(rec.gain > 0 && rec.gain <= 2, rec.file).toBe(true)
      const line = credits.split('\n').find((l) => l.includes(rec.file.replace('sounds/', '')))
      expect(line, `${rec.file} needs a line in CREDITS.md`).toBeDefined()
      expect(line, rec.file).toContain(rec.author)
      expect(line, rec.file).toContain(rec.licence)
    }
  })

  it('only the approved licences: CC0, CC BY, or made for Bump Stop', () => {
    expect([...LICENCES]).toEqual(['CC0', 'CC BY 3.0', 'CC BY 4.0', 'Made for Bump Stop'])
  })

  it('every file in public/sounds/ is listed, so nothing ships uncredited', () => {
    const dir = new URL('sounds/', PUBLIC)
    const files = existsSync(dir) ? readdirSync(dir) : []
    const listed = new Set(RECORDINGS.map((r) => r.file))
    for (const f of files) expect(listed.has(`sounds/${f}`), `public/sounds/${f} is not in src/data/recordings.ts`).toBe(true)
  })
})

describe('tidying a recording', () => {
  const rate = 8000
  const tone = (seconds: number, amp: number) =>
    Float32Array.from({ length: Math.round(seconds * rate) }, (_, n) => amp * Math.sin((2 * Math.PI * 220 * n) / rate))
  const peak = (s: Float32Array) => s.reduce((m, x) => Math.max(m, Math.abs(x)), 0)

  it('mixes stereo to one channel and brings the loudest moment to the same level', () => {
    const quiet = prepareSamples([tone(0.5, 0.1), tone(0.5, 0.1)], rate, 2, false)
    const loud = prepareSamples([tone(0.5, 0.99)], rate, 2, false)
    expect(quiet.length).toBe(4000)
    expect(peak(quiet)).toBeCloseTo(RECORDING_PREP.peak, 3)
    expect(peak(loud)).toBeCloseTo(RECORDING_PREP.peak, 3)
  })

  it('cuts a long recording to length and fades it out, so it never ends on a click', () => {
    const out = prepareSamples([tone(5, 0.5)], rate, 1.2, false)
    expect(out.length).toBe(Math.round(1.2 * rate))
    expect(Math.abs(out[out.length - 1]!)).toBeLessThan(1e-6)
  })

  it('a loop blends its end into its start and comes out a fade shorter', () => {
    const out = prepareSamples([tone(2, 0.5)], rate, 6, true)
    expect(out.length).toBe(2 * rate - Math.round(RECORDING_PREP.fade * rate))
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('silence stays silent, and an empty file comes out empty', () => {
    const silent = prepareSamples([new Float32Array(800)], rate, 1, false)
    expect(peak(silent)).toBe(0)
    expect(prepareSamples([new Float32Array(0)], rate, 1, false).length).toBe(0)
  })

  it('the breaks may run longer than the rattles, and the hiss loop longest', () => {
    expect(maxLength('tick')).toBe(RECORDING_PREP.maxShort)
    expect(maxLength('bang')).toBe(RECORDING_PREP.maxBreak)
    expect(maxLength('hissLoop')).toBe(RECORDING_PREP.maxLoop)
  })
})
