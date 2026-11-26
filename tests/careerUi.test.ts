/**
 * The career screens' words (plan PR 9b): dates, rival names and every kind
 * of news line, so a career save never shows a blank or a raw key.
 */
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../src/data/classes'
import { newCareer, settle } from '../src/sim/career'

describe('the career screens', () => {
  it('write dates, rival names and news in words', async () => {
    const { dateText, newsText, whoName } = await import('../src/ui/career')
    expect(dateText(1985, 1)).toBe('1 January')
    expect(dateText(1985, 130)).toBe('10 May')
    expect(whoName('brannigan7')).toBe('Brannigan Brothers #7')
    expect(whoName('privateer31')).toBe('Privateer #31')
    expect(whoName('you')).toBe('Your truck')
    expect(whoName('you', 44)).toContain('#44')
    const c = newCareer(5)
    while (c.year < 1990) settle(c, null)
    const kinds = new Set(c.news.map((n) => n.kind))
    expect(kinds.has('winner')).toBe(true)
    for (const n of c.news) {
      const text = newsText(n)
      expect(text.length, n.kind).toBeGreaterThan(10)
      expect(text).not.toMatch(/\{|career\.|undefined/)
    }
    const samples = [
      newsText({ kind: 'result', year: 1985, raid: 'summerSprint', cls: CLASSES[0]!.id, job: 'own', pos: 2, of: 5, money: -300, rep: 3 }),
      newsText({ kind: 'result', year: 1985, raid: 'longOne', cls: 'sxs', job: 'contract', pos: null, of: 5, money: 0, rep: 0 }),
      newsText({ kind: 'copied', year: 1990, team: 'highbank', cls: 'light4x4', slots: ['dampers', 'tires'], from: 'you' }),
      newsText({ kind: 'newParts', year: 1990, parts: ['remoteReservoir'] }),
      newsText({ kind: 'sponsor', year: 1990, sponsor: 0 }),
      newsText({ kind: 'broke', year: 1990 }),
      newsText({ kind: 'longOne', year: 1999 }),
      newsText({ kind: 'skipped', year: 1990, raid: 'autumnRaid' }),
    ]
    for (const text of samples) expect(text).not.toMatch(/\{|career\.|undefined/)
    expect(samples[0]).toContain('2nd of 5')
    expect(samples[2]).toContain('copied your dampers, tires')
  })
})
