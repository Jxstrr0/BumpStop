/**
 * The help (plan PR 11a): the lessons' quarter car shows what each lesson
 * says it shows, and every glossary word has its words and a jump that works.
 */
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { GLOSSARY } from '../src/data/glossary'
import { LESSON_DIALS, LESSON_ROADS } from '../src/data/lessons'
import { t, type StringKey } from '../src/data/strings'
import { stockBuild } from '../src/sim/build'
import { factorySetup, roadHeight, runLesson, type LessonClip } from '../src/sim/lesson'
import { fixJump } from '../src/ui/fixes'

const factory = factorySetup()
const bob = (c: LessonClip) => {
  const tail = c.body.slice(Math.floor(c.body.length * 0.6))
  return Math.max(...tail) - Math.min(...tail)
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('the damper lessons', () => {
  it('draw the same clip every time', () => {
    const a = runLesson(LESSON_ROADS.washboard, factory)
    const b = runLesson(LESSON_ROADS.washboard, factory)
    expect(a).toEqual(b)
  })

  it('build their roads from smooth bumps', () => {
    const r = LESSON_ROADS.oneBump
    expect(roadHeight(r, 0)).toBe(0)
    expect(roadHeight(r, r.lead + r.length / 2)).toBeCloseTo(r.height, 6)
    expect(roadHeight(r, r.lead + r.length + 0.1)).toBe(0)
  })

  it('lesson 1: with no damping the body keeps bouncing and the tire skips; as set it settles', () => {
    const none = runLesson(LESSON_ROADS.oneBump, { ...factory, compression: 0, rebound: 0 })
    const asSet = runLesson(LESSON_ROADS.oneBump, factory)
    const tooMuch = runLesson(LESSON_ROADS.oneBump, { ...factory, compression: factory.compression * 5, rebound: factory.rebound * 5 })
    expect(bob(none)).toBeGreaterThan(0.05)
    expect(bob(asSet)).toBeLessThan(0.005)
    expect(none.airShare).toBeGreaterThan(asSet.airShare * 3)
    expect(none.heat).toBe(0)
    // Too much damping: the bump goes straight into the body.
    expect(tooMuch.peakJolt).toBeGreaterThan(asSet.peakJolt * 1.4)
  })

  it('lesson 2: too much rebound packs the wheel up into its travel on washboard', () => {
    const d = LESSON_DIALS.rebound
    const sitting = d.factors.map((k) => {
      const c = runLesson(LESSON_ROADS.washboard, { ...factory, rebound: factory.rebound * k })
      return avg(c.travel.slice(Math.floor(c.travel.length / 2)))
    })
    // More rebound, further up the travel, every step of the dial.
    for (let i = 1; i < sitting.length; i++) expect(sitting[i]!).toBeGreaterThan(sitting[i - 1]!)
    expect(sitting[sitting.length - 1]!).toBeGreaterThan(0.25)
    expect(Math.abs(sitting[-d.min]!)).toBeLessThan(0.1)
  })

  it('lesson 4: the factory corner just keeps off the hard limit; soft springs or short stops bottom out', () => {
    const sp = LESSON_DIALS.spring
    const bs = LESSON_DIALS.bumpStop
    const asSet = runLesson(LESSON_ROADS.bigHit, factory)
    expect(asSet.bottomOuts).toBe(0)
    expect(asSet.peakTravel).toBeGreaterThan(0.85)
    const soft = runLesson(LESSON_ROADS.bigHit, { ...factory, springRate: factory.springRate * sp.factors[0]! })
    expect(soft.bottomOuts).toBeGreaterThan(0)
    const short = runLesson(LESSON_ROADS.bigHit, { ...factory, bumpStopLength: bs.lengths[0]! })
    expect(short.bottomOuts).toBeGreaterThan(0)
    const stiff = runLesson(LESSON_ROADS.bigHit, { ...factory, springRate: factory.springRate * sp.factors[sp.factors.length - 1]! })
    expect(stiff.peakTravel).toBeLessThan(asSet.peakTravel)
  })

  it('have a factor for every step of every dial', () => {
    const d = LESSON_DIALS
    expect(d.damping.factors).toHaveLength(d.damping.max - d.damping.min + 1)
    expect(d.rebound.factors).toHaveLength(d.rebound.max - d.rebound.min + 1)
    expect(d.spring.factors).toHaveLength(d.spring.max - d.spring.min + 1)
    expect(d.bumpStop.lengths).toHaveLength(d.bumpStop.max - d.bumpStop.min + 1)
    // Step 0 is always the factory setting.
    expect(d.damping.factors[-d.damping.min]).toBe(1)
    expect(d.rebound.factors[-d.rebound.min]).toBe(1)
    expect(d.spring.factors[-d.spring.min]).toBe(1)
    expect(d.bumpStop.lengths[-d.bumpStop.min]).toBe(factory.bumpStopLength)
  })
})

describe('the glossary', () => {
  it('has words and a meaning for every entry, once each', () => {
    const ids = GLOSSARY.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(t(`glossary.${id}` as StringKey), id).toBeTruthy()
      expect(t(`glossary.${id}Text` as StringKey)?.length, id).toBeGreaterThan(30)
    }
  })

  it('jumps somewhere real for every class', () => {
    for (const g of GLOSSARY) {
      if (!('see' in g)) continue
      for (const c of CLASSES) expect(fixJump(g.see, 'front', stockBuild(c.id)), `${g.id} in ${c.id}`).not.toBeNull()
    }
  })

  it('uses Canadian spelling', () => {
    const text = GLOSSARY.map((g) => `${t(`glossary.${g.id}` as StringKey)} ${t(`glossary.${g.id}Text` as StringKey)}`).join(' ')
    expect(text).not.toMatch(/\b(color|center|meter|tyre|defense|liter)\b/i)
  })
})
