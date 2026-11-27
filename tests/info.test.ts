/**
 * The "i" notes on the build screen: every slider and every part slot has
 * one, each note's "More in the help" opens a real glossary word, and the
 * words keep to Canadian spelling.
 */
import { describe, expect, it } from 'vitest'
import { GLOSSARY } from '../src/data/glossary'
import { LOAD_INFO, SETTING_INFO, SLOT_INFO } from '../src/data/info'
import { SLOTS } from '../src/data/parts'
import { t } from '../src/data/strings'
import { stockBuild } from '../src/sim/build'

const notes = [...Object.values(SETTING_INFO), ...Object.values(SLOT_INFO), ...Object.values(LOAD_INFO)]

describe('the build screen info notes', () => {
  it('cover every Tune setting and every part slot', () => {
    for (const key of Object.keys(stockBuild('light4x4').front)) expect(SETTING_INFO).toHaveProperty(key)
    for (const slot of SLOTS) expect(SLOT_INFO).toHaveProperty(slot)
  })

  it('are short enough to read at a glance', () => {
    for (const n of notes) {
      const words = t(n.text).split(/\s+/).length
      expect(words).toBeGreaterThan(10)
      expect(words).toBeLessThan(60)
    }
  })

  it('only point to glossary words that exist', () => {
    const ids = new Set<string>(GLOSSARY.map((g) => g.id))
    for (const n of notes) if (n.term) expect(ids.has(n.term)).toBe(true)
  })

  it('use Canadian spelling', () => {
    const us = /\b(color|center|meter|tyre|defense|organiz\w*|armor)\b/i
    for (const n of notes) expect(t(n.text)).not.toMatch(us)
  })
})
