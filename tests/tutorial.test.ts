/**
 * The first-job guide (plan PR 11b): the career's first job is always a
 * privateer's light 4x4 that can afford studs, and the guide's steps tick
 * off in order as the job gets done.
 */
import { describe, expect, it } from 'vitest'
import { CONTRACTS } from '../src/data/career'
import { RAIDS } from '../src/data/raids'
import { checkBuild } from '../src/sim/build'
import { contractRules, driveAuto, contractRaid, isFirstRaid, newCareer, nextEvent, offers, settle, takeContract } from '../src/sim/career'
import { freshProgress, guideActive, guideSteps, type GuideStep } from '../src/ui/tutorial'

const nowOf = (steps: GuideStep[]) => steps.find((s) => s.state === 'now')?.id

describe('the first job', () => {
  it('is always a privateer’s light 4x4 with room in the budget for studded tires', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const c = newCareer(seed)
      const first = offers(c)[0]!
      expect(first.cls).toBe(CONTRACTS.firstJob.cls)
      expect(first.rep).toBe(0)
      takeContract(c, first)
      const job = c.job!
      if (job.kind !== 'contract') throw new Error('no contract')
      const studded = { ...job.build, parts: { ...job.build.parts, tires: 'studdedRally' } }
      expect(checkBuild(studded, contractRules(c, first)), `seed ${seed}`).toEqual([])
    }
  })

  it('only changes the very first offer of the career', () => {
    // Later raids still roll the first offer's class, so some are side-by-sides.
    const classes = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const c = newCareer(seed)
      settle(c, null)
      expect(isFirstRaid(c)).toBe(false)
      classes.add(offers(c)[0]!.cls)
    }
    expect(classes.has('sxs')).toBe(true)
  })
})

describe('the first-job guide', () => {
  it('ticks off each step in turn, through to the results', () => {
    const c = newCareer(7)
    const p = freshProgress(c.seed)
    const winter = RAIDS[nextEvent(c).raid].season === 'winter'
    expect(guideActive(c)).toBe(true)
    expect(nowOf(guideSteps(c, p, null))).toBe('take')
    expect(guideSteps(c, p, null).map((s) => s.id)).toContain(winter ? 'studs' : 'test')

    takeContract(c, offers(c)[0]!)
    if (winter) {
      expect(nowOf(guideSteps(c, p, null))).toBe('studs')
      const job = c.job!
      if (job.kind !== 'contract') throw new Error('no contract')
      job.build = { ...job.build, parts: { ...job.build.parts, tires: 'studdedRally' } }
    }
    expect(nowOf(guideSteps(c, p, null))).toBe('test')
    p.runs = 1
    expect(nowOf(guideSteps(c, p, null))).toBe('fix')
    p.runs = 2
    expect(nowOf(guideSteps(c, p, null))).toBe('hand')

    const state = contractRaid(c)
    driveAuto(state)
    const paid = settle(c, state)
    expect(guideActive(c)).toBe(false)
    const end = guideSteps(c, freshProgress(c.seed), paid)
    expect(nowOf(end)).toBe('results')
    expect(end.filter((s) => s.state === 'done')).toHaveLength(end.length - 1)
  })

  it('steps aside for the player’s own entry or after sitting the raid out', () => {
    const c = newCareer(3)
    c.job = { kind: 'own', driver: 'veteran' }
    expect(guideActive(c)).toBe(false)
    const d = newCareer(3)
    settle(d, null)
    expect(guideActive(d)).toBe(false)
  })
})
