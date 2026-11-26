/**
 * The first-job guide (plan PR 11b): the career's very first job, walked
 * through as a tutorial. It sits at the top of the Career panel while the
 * garage is on its first raid, as a short list of steps that tick
 * themselves off as the player does them, in any order:
 *
 * 1. Take the privateer's job (always an old light 4x4, `CONTRACTS.firstJob`).
 * 2. Fit studded tires (only when the first raid is a winter one).
 * 3. Break it on the test track (a finished rig run with their truck).
 * 4. Read the report, fix it and run it again (a second run).
 * 5. Hand it over.
 * 6. Read the results, then a last word on what comes next.
 *
 * Each step has a "Show me" that scrolls to the right place, and a word or
 * two that open the help's glossary. "Hide the guide" folds it to one
 * button. How far the player got lives in localStorage (`bumpstop.guide`),
 * tied to the career's seed, so it isn't part of the save: losing it only
 * means the run steps tick again.
 */
import type { GlossaryId } from '../data/glossary'
import { RAIDS } from '../data/raids'
import { t, tf, type StringKey } from '../data/strings'
import { partIn } from '../sim/build'
import { isFirstRaid, nextEvent, offers, type CareerState, type Settlement } from '../sim/career'
import { el } from './dom'
import { jumpTo } from './fixes'
import { SHOP_EVENT, type ShopEvent } from './events'

/** How far the player got with the guide, for one career. */
export interface GuideProgress {
  seed: number
  /** Finished rig runs with the contract truck. */
  runs: number
  /** Fixes tapped on a report. */
  fixes: number
  hidden: boolean
  /** The privateer's race number once the job is taken, so the pay-out card still names them. */
  number?: number
}

export type GuideStepId = 'take' | 'studs' | 'test' | 'fix' | 'hand' | 'results'
export type GuideStepState = 'done' | 'now' | 'later'

export interface GuideStep {
  id: GuideStepId
  state: GuideStepState
}

const KEY = 'bumpstop.guide'

export function freshProgress(seed: number): GuideProgress {
  return { seed, runs: 0, fixes: 0, hidden: false }
}

/** True while the career is on its first job and that job is a privateer's (or not picked yet). */
export function guideActive(c: CareerState | null): boolean {
  return c !== null && isFirstRaid(c) && c.job?.kind !== 'own'
}

/**
 * The steps and where each one stands. `settled` is the pay-out card for the
 * first job, once it's on screen. The first step not done is "now".
 */
export function guideSteps(c: CareerState, p: GuideProgress, settled: Settlement | null): GuideStep[] {
  const job = c.job?.kind === 'contract' ? c.job : null
  // After the pay-out the calendar has moved on, so the winter step is judged by the raid that was run.
  const raid = settled ? RAIDS[settled.raid] : RAIDS[nextEvent(c).raid]
  const done: [GuideStepId, boolean][] = [
    ['take', job !== null || settled !== null],
    ...(raid.season === 'winter' ? [['studs', settled !== null || (job !== null && partIn(job.build, 'tires').studded)] as [GuideStepId, boolean]] : []),
    ['test', settled !== null || p.runs >= 1],
    ['fix', settled !== null || p.runs >= 2],
    ['hand', settled !== null],
    ['results', false],
  ]
  let nowGiven = false
  return done.map(([id, isDone]) => {
    if (isDone) return { id, state: 'done' }
    if (nowGiven) return { id, state: 'later' }
    nowGiven = true
    return { id, state: 'now' }
  })
}

function readProgress(seed: number): GuideProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GuideProgress> | null
    if (raw && raw.seed === seed) {
      return { seed, runs: Number(raw.runs) || 0, fixes: Number(raw.fixes) || 0, hidden: raw.hidden === true, ...(Number(raw.number) > 0 ? { number: Number(raw.number) } : {}) }
    }
  } catch {
    // Private windows and blocked storage: the guide just starts again.
  }
  return freshProgress(seed)
}

function writeProgress(p: GuideProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Not kept: fine, it's only the guide.
  }
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function flash(node: Element | null): void {
  if (!(node instanceof HTMLElement)) return
  node.scrollIntoView({ behavior: smooth(), block: 'center' })
  node.classList.remove('jumped')
  void node.offsetWidth
  node.classList.add('jumped')
  window.setTimeout(() => node.classList.remove('jumped'), 2400)
}

/** The glossary words each step offers. */
const WORDS: Record<GuideStepId, readonly GlossaryId[]> = {
  take: ['privateer'],
  studs: ['studs'],
  test: ['washboard', 'fade'],
  fix: ['redLine'],
  hand: ['stage', 'bivouac'],
  results: [],
}

const MARK: Record<GuideStepState, string> = { done: '✓', now: '▸', later: '○' }

export interface Guide {
  element: HTMLElement
  /** Redraw for the career as it stands, and the first job's pay-out card if it's showing. */
  update(c: CareerState | null, settled: Settlement | null): void
}

export function firstJobGuide(showTerm: (id: GlossaryId) => void): Guide {
  const box = el('section', 'guide')
  box.setAttribute('aria-labelledby', 'guide-title')
  box.hidden = true
  let career: CareerState | null = null
  let settled: Settlement | null = null
  let p: GuideProgress | null = null

  // Runs and fixes in the shop count for the guide only with the privateer's truck on the bench.
  document.addEventListener(SHOP_EVENT, (ev) => {
    const d = (ev as CustomEvent<ShopEvent>).detail
    if (!p || !career || !guideActive(career) || career.job?.kind !== 'contract' || d.cls !== career.job.contract.cls) return
    if (d.kind === 'run') p.runs++
    else p.fixes++
    writeProgress(p)
    draw()
  })

  function stepWords(id: GuideStepId, c: CareerState): { head: string; text: string } {
    const raidId = settled ? settled.raid : nextEvent(c).raid
    const raid = t(RAIDS[raidId].name)
    const n = String(c.job?.kind === 'contract' ? c.job.contract.number : p?.number ?? offers(c)[0]?.number ?? '')
    const vars = { n, raid }
    return { head: tf(`guide.${id}` as StringKey, vars), text: tf(`guide.${id}Text` as StringKey, vars) }
  }

  function showMe(id: GuideStepId): void {
    switch (id) {
      case 'take':
        flash(document.querySelector('#career .job-list .job-btn'))
        break
      case 'studs':
        jumpTo({ kind: 'slot', slot: 'tires' })
        break
      case 'test':
        flash(document.querySelector('#shop .start-btn'))
        break
      case 'fix':
        flash(document.querySelector('#shop .report-holder .fix-btn') ?? document.querySelector('#shop .start-btn'))
        break
      case 'hand':
        flash(document.querySelector('#career .raid-card .start-btn'))
        break
      case 'results':
        flash(document.querySelector('#career .career-results'))
        break
    }
  }

  function draw(): void {
    const c = career
    if (!c || !p) {
      box.replaceChildren()
      box.hidden = true
      return
    }
    box.hidden = false
    if (p.hidden) {
      const show = el('button', 'btn small-btn', t('guide.showAgain'))
      show.type = 'button'
      show.addEventListener('click', () => {
        p!.hidden = false
        writeProgress(p!)
        draw()
        box.querySelector<HTMLElement>('h3')?.focus()
      })
      box.className = 'guide folded'
      box.replaceChildren(show)
      return
    }
    box.className = 'guide'
    const title = el('h3', 'guide-title', t('guide.title'))
    title.id = 'guide-title'
    title.tabIndex = -1
    const list = el('ol', 'guide-steps')
    for (const step of guideSteps(c, p, settled)) {
      const li = el('li', `guide-step ${step.state}`)
      if (step.state === 'now') li.setAttribute('aria-current', 'step')
      const words = stepWords(step.id, c)
      const head = el('p', 'guide-head')
      head.append(el('span', 'guide-mark', MARK[step.state]), ' ', el('span', 'guide-state', t(`guide.state.${step.state}` as StringKey)), ' ', words.head)
      li.append(head)
      // Only the step being done now opens up with its words and buttons, so the list stays short on a phone.
      if (step.state === 'now') {
        li.append(el('p', 'small', words.text))
        const row = el('div', 'btn-row')
        if (step.id !== 'results') {
          const go = el('button', 'btn small-btn', t('guide.showMe'))
          go.type = 'button'
          go.addEventListener('click', () => showMe(step.id))
          row.append(go)
        }
        for (const id of WORDS[step.id]) {
          const word = el('button', 'btn small-btn word-btn', tf('guide.whatIs', { word: t(`glossary.${id}` as StringKey).toLowerCase() }))
          word.type = 'button'
          word.addEventListener('click', () => showTerm(id))
          row.append(word)
        }
        li.append(row)
      }
      list.append(li)
    }
    const children: HTMLElement[] = [title, el('p', 'small', t('guide.lead')), list]
    if (settled) children.push(el('p', 'guide-finished', t('guide.finished')))
    const hide = el('button', 'btn small-btn', t('guide.hide'))
    hide.type = 'button'
    hide.addEventListener('click', () => {
      p!.hidden = true
      writeProgress(p!)
      draw()
    })
    children.push(hide)
    box.replaceChildren(...children)
  }

  return {
    element: box,
    update(c, firstPayOut) {
      // The guide is for the first job: while it's on, and on its pay-out card after.
      const show = guideActive(c) || (c !== null && firstPayOut?.job === 'contract' && c.season === 0 && c.next === 1 && c.stats.contracts === 1 && c.stats.raids === 0)
      career = show ? c : null
      settled = show && !guideActive(c) ? firstPayOut : null
      if (career && (!p || p.seed !== career.seed)) p = readProgress(career.seed)
      if (!career) p = null
      if (p && career?.job?.kind === 'contract' && p.number !== career.job.contract.number) {
        p.number = career.job.contract.number
        writeProgress(p)
      }
      draw()
    },
  }
}
