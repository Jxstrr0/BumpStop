/**
 * One-day events (Kelbo picked them, 28 November 2026), on the Raid tab
 * under the raids. One panel that moves through an event:
 *
 * 1. **Entry:** pick the event and (where it matters) the driver. The
 *    truck is the one on the build screen (it must pass the build rules).
 * 2. **A run:** on a hill climb, the pace call first. The truck drives the
 *    course through the ride sim, shown in 3D like the test track (full page
 *    or in the page, the same remembered pick), with how far up it is, or on
 *    a speed trial the pass and the hottest damper.
 * 3. **After a run:** the score (or what broke, with its trace and the fix
 *    buttons), and the standings so far. Between runs the truck can be
 *    changed on the Build tab: the next run takes whatever is on the bench.
 * 4. **The end:** the final standings, best run each.
 *
 * Free play only for now: in a career the events come later, with prizes.
 * Nothing here is saved; a reload goes back to the entry.
 */
import { makeSound } from '../audio/sound'
import { heatShare } from '../audio/cues'
import { CLASSES, type ClassId } from '../data/classes'
import { CONTEST_IDS, CONTESTS, type ContestId, type ContestKind } from '../data/contests'
import { FAILURES } from '../data/failures'
import { DRIVER_IDS, DRIVERS, PACES, type DriverId, type PaceId } from '../data/raids'
import { RIG_VIEW, VIEW_3D, type RigPiece } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import { checkBuild, type BuiltTruck } from '../sim/build'
import { driverName } from '../sim/career'
import {
  contestStandings, courseLength, courseSeed, eventRig, passKmh, rivalRuns, scoreEvent,
  type ContestRun, type RivalRuns,
} from '../sim/contest'
import { advanceLaps, lapResult, rollOut, startLaps, takeFeel, type LapRunner } from '../sim/laps'
import { rivalsIn } from '../sim/rivals'
import { fromCelsius, msToKmh } from '../sim/units'
import type { BuildStore } from './buildStore'
import { BAND_WORD, bandOf } from './charts'
import { el, num, reveal } from './dom'
import { endOf, jumpTo } from './fixes'
import { readFullPage, writeFullPage } from './fullPage'
import { entrantName, ordinal, type RaidCareer } from './raid'
import { crewNote, fixButtons, traceBlock, whereText } from './report'
import { rigView } from './rigView'

const STEPS_PER_SECOND = 500
const C0 = 273.15
/** A run plays in about this many real seconds at normal speed (the sim's own time is a few minutes). */
const RUN_SECONDS = 24

/** A score in words: a time (2:18.4) on a hill climb, a speed (80 km/h) on a speed trial. */
export function scoreText(kind: ContestKind, score: number): string {
  return kind === 'topSpeed' ? tf('contestUi.kmh', { n: num(score) }) : runClock(score)
}

/** A run's time: 2:18.4. */
export function runClock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const m = Math.floor(tenths / 600)
  const s = (tenths % 600) / 10
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function button(text: string, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, text)
  b.type = 'button'
  return b
}

/** A row of buttons where one is picked (aria-pressed). */
function picker<T extends string>(ids: readonly T[], label: (id: T) => string, current: () => T, pick: (id: T) => void): HTMLElement {
  const row = el('div', 'btn-row')
  const buttons = ids.map((id) => {
    const b = button(label(id))
    b.addEventListener('click', () => {
      pick(id)
      sync()
    })
    row.append(b)
    return { id, b }
  })
  const sync = () => {
    for (const { id, b } of buttons) b.setAttribute('aria-pressed', String(id === current()))
  }
  sync()
  return row
}

/** An event under way: what was picked at the entry, and the runs so far. */
interface Entry {
  contest: ContestId
  cls: ClassId
  driver: DriverId
  runs: ContestRun[]
  rivals: RivalRuns[]
}

/** A run being driven. */
interface Live {
  truck: BuiltTruck
  runner: LapRunner
  speeds: number[]
  pace: PaceId
  /** Sim steps the whole run takes, for the progress bar and the playing speed. */
  total: number
}

export function contestPanel(store: BuildStore, career?: Pick<RaidCareer, 'on'>): HTMLElement {
  const box = el('section', 'panel contest')
  box.id = 'contest'
  box.append(el('h2', '', t('contestUi.title')), el('p', 'lead', t('contestUi.lead')))
  const body = el('div', 'contest-body')
  box.append(body)

  let contestId: ContestId = CONTEST_IDS[0]!
  let driver: DriverId = 'veteran'
  let pace: PaceId = 'steady'
  let entry: Entry | null = null
  let live: Live | null = null
  let raf = 0
  let last = 0
  let carry = 0
  let fast = false
  let skipping = false
  let full = readFullPage()
  /** A full-page run has ended and its finish still has the screen. */
  let ended = false

  const sound = makeSound()

  // ── The live view (built once; it moves between screens) ──
  const liveBox = el('div', 'live')
  const view3d = rigView(() => layout())
  const headBox = el('div', 'live-headbox')
  const liveTop = el('div', 'live-top')
  const liveHead = el('p', 'live-head')
  const sizeBtn = button('', 'btn chip-btn size-btn')
  sizeBtn.addEventListener('click', () => {
    full = !full
    writeFullPage(full)
    layout()
    if (!full) liveBox.scrollIntoView({ behavior: 'auto', block: 'start' })
  })
  liveTop.append(liveHead, sizeBtn)
  const progress = el('div', 'live-progress')
  progress.setAttribute('role', 'progressbar')
  progress.setAttribute('aria-valuemin', '0')
  progress.setAttribute('aria-valuemax', '100')
  progress.setAttribute('aria-label', t('contestUi.progress'))
  const fill = el('div', 'live-fill')
  progress.append(fill)
  const clockLine = el('p', 'small frame-line')
  headBox.append(liveTop, progress, clockLine)
  const hud = el('div', 'live-hud')
  hud.append(headBox)
  const controls = el('div', 'btn-row controls')
  const fastBtn = button(t('shop.fast'))
  fastBtn.setAttribute('aria-pressed', 'false')
  fastBtn.addEventListener('click', () => {
    fast = !fast
    fastBtn.setAttribute('aria-pressed', String(fast))
  })
  const skipBtn = button(t('shop.skip'))
  skipBtn.addEventListener('click', () => {
    skipping = true
    skipBtn.disabled = true
    fastBtn.disabled = true
  })
  controls.append(fastBtn, skipBtn)
  // Full page, when the run ends: what happened, and the way back to the page.
  const endBar = el('div', 'end-bar')
  const endHead = el('p', 'end-head')
  const endGo = button(t('contestUi.seeResults'), 'btn end-report')
  endGo.addEventListener('click', () => {
    ended = false
    layout()
    body.querySelector<HTMLElement>('.contest-result')?.focus({ preventScroll: true })
    box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  })
  const endRow = el('div', 'btn-row controls')
  endRow.append(endGo)
  endBar.append(endHead, endRow)
  liveBox.append(view3d.element, hud, controls, endBar)

  function layout(): void {
    const on = full && (live !== null || ended) && view3d.works()
    liveBox.classList.toggle('full', on)
    sizeBtn.hidden = live === null || !view3d.works()
    sizeBtn.textContent = t(on ? 'shop.traces' : 'shop.fullPage')
    endBar.hidden = !(on && ended)
    controls.hidden = live === null
    // The run's numbers go once it's over, except over a full-page finish.
    hud.hidden = live === null && !(on && ended)
  }

  function show(...nodes: Node[]): void {
    body.replaceChildren(...nodes)
  }

  function stop(): void {
    cancelAnimationFrame(raf)
    sound.stop()
    live = null
  }

  // ── 1. Entry ──

  function entryScreen(): void {
    stop()
    entry = null
    ended = false
    view3d.reset()
    layout()
    if (career?.on()) {
      show(el('p', 'small', t('contestUi.careerNote')))
      return
    }
    const about = el('p', 'small')
    const courseLine = el('p', 'small')
    const driverText = el('p', 'small')
    const driverBox = el('div')
    const sync = () => {
      const c = CONTESTS[contestId]
      about.textContent = t(c.text)
      courseLine.textContent = c.passes
        ? tf('contestUi.passesLine', { km: num(courseLength(c) / 1000, 1), from: num(c.passes.startKmh), step: num(c.passes.stepKmh), runs: String(c.runs) })
        : tf('contestUi.courseLine', { km: num(courseLength(c) / 1000, 1), runs: String(c.runs) })
      // The speed trial is driven at the set speeds, so the driver makes no odds there.
      driverBox.hidden = c.kind === 'topSpeed'
      driverText.textContent = tf('driver.about', { trade: t(DRIVERS[driver].name), text: t(DRIVERS[driver].text) })
    }
    const contestRow = picker(CONTEST_IDS, (id) => t(CONTESTS[id].name), () => contestId, (id) => {
      contestId = id
      sync()
    })
    // Free play has no career, so it's the first of each trade's pool (`driverName`).
    const driverRow = picker(DRIVER_IDS, (id) => t(driverName(null, id)), () => driver, (id) => {
      driver = id
      sync()
    })
    driverBox.append(el('h3', 'raid-sub', t('raidUi.pickDriver')), driverRow, driverText)
    sync()
    const cls = CLASSES.find((c) => c.id === store.cls())!
    const truckLine = el('p', 'small', tf('contestUi.truckLine', { cls: t(cls.name).toLowerCase() }))
    const enter = button(t('contestUi.enter'), 'btn start-btn')
    const problem = buildProblem()
    const cant = el('p', 'small hot-text', problem)
    cant.hidden = problem === ''
    enter.disabled = problem !== ''
    enter.addEventListener('click', () => {
      const c = CONTESTS[contestId]
      const k = store.cls()
      entry = { contest: contestId, cls: k, driver, runs: [], rivals: rivalRuns(c, k, rivalsIn(k)) }
      betweenScreen()
    })
    show(
      el('h3', 'raid-sub', t('contestUi.pickEvent')), contestRow, about, courseLine,
      driverBox, truckLine, cant, enter,
    )
  }

  /** Why the truck on the bench can't go out, in words, or '' if it can. */
  function buildProblem(): string {
    const problems = checkBuild(store.truck().build, store.rules())
    if (!problems.length) return ''
    const what = problems.map((p) => p.kind === 'tooHeavy' ? t('build.tooHeavy') : p.kind === 'tooLight' ? t('build.tooLight') : p.kind === 'overBudget' ? t('build.overBudget') : t('raidUi.partNotYet')).join(', ').toLowerCase()
    return tf('raidUi.cantEnter', { what })
  }

  // ── 2. Before each run (and the results so far) ──

  function betweenScreen(lastRun?: { run: ContestRun; report: HTMLElement | null }): void {
    const e = entry
    if (!e) return entryScreen()
    const c = CONTESTS[e.contest]
    const nodes: Node[] = [el('h3', 'raid-sub', t(c.name))]
    if (lastRun) nodes.push(resultBlock(e, lastRun.run, lastRun.report))
    if (e.runs.length > 0) nodes.push(standingsBlock(e, e.runs.length === c.runs))
    if (e.runs.length >= c.runs) {
      const again = button(t('contestUi.again'), 'btn start-btn')
      again.addEventListener('click', () => entryScreen())
      show(...nodes, again)
      return
    }
    const n = e.runs.length + 1
    const paceText = el('p', 'small')
    const syncPace = () => {
      paceText.textContent = t(`contestUi.pace.${pace}` as StringKey)
    }
    const paceRow = picker(PACES, (id) => t(`pace.${id}` as StringKey), () => pace, (id) => {
      pace = id
      syncPace()
    })
    syncPace()
    const go = button(tf('contestUi.startRun', { n: String(n) }), 'btn start-btn')
    const problem = store.cls() !== e.cls ? t('contestUi.otherClass') : buildProblem()
    const cant = el('p', 'small hot-text', problem)
    cant.hidden = problem === ''
    go.disabled = problem !== ''
    go.addEventListener('click', () => {
      // The truck may have changed on the Build tab since this screen was drawn.
      const now = store.cls() !== e.cls ? t('contestUi.otherClass') : buildProblem()
      cant.textContent = now
      cant.hidden = now === ''
      if (now === '') begin()
    })
    const retire = button(t('contestUi.leave'), 'btn small-btn')
    retire.addEventListener('click', () => entryScreen())
    nodes.push(el('h3', 'raid-sub', tf('contestUi.runHead', { n: String(n), of: String(c.runs) })))
    if (n > 1) nodes.push(el('p', 'small', t('contestUi.tuneNote')))
    // The speed trial's speeds are set: no pace call, and every run starts with cold oil.
    if (c.kind === 'topSpeed') nodes.push(el('p', 'small', t('contestUi.coldStart')), cant, go, retire)
    else nodes.push(paceRow, paceText, cant, go, retire)
    show(...nodes)
  }

  /** What happened on the last run: the time, or what broke with its trace and the fixes. */
  function resultBlock(e: Entry, run: ContestRun, report: HTMLElement | null): HTMLElement {
    const block = el('div', 'contest-result')
    block.tabIndex = -1
    const n = e.runs.length
    const head = el('p', 'end-head')
    const c = CONTESTS[e.contest]
    const ev = run.broken
    if (c.kind === 'topSpeed') {
      // A speed trial always ends on something (usually the fade): the score is the pass before.
      if (run.score !== null) head.append(el('span', 'chip cool', t('trace.cool')), ' ', tf('contestUi.topPass', { n: String(n), kmh: num(run.score) }))
      else head.append(el('span', 'chip hot', t('trace.hot')), ' ', tf('contestUi.noCleanPass', { n: String(n) }))
      block.append(head)
      if (ev) {
        const pass = (run.score === null ? c.passes!.startKmh : run.score + c.passes!.stepKmh)
        block.append(el('p', 'small', tf('contestUi.endedOn', { kmh: num(pass), what: t(FAILURES[ev.kind].name).toLowerCase(), where: whereText(ev) })))
      } else block.append(el('p', 'small', t('contestUi.everyPass')))
    } else {
      if (run.score !== null) {
        head.append(el('span', 'chip cool', t('trace.cool')), ' ', tf('contestUi.madeIt', { n: String(n), time: runClock(run.score) }))
      } else {
        head.append(el('span', 'chip hot', t('trace.hot')), ' ', tf('contestUi.broke', { n: String(n), what: t(FAILURES[ev!.kind].name), where: whereText(ev!), m: num(ev!.distance) }))
      }
      block.append(head)
      if (run.bottomOuts > 0) block.append(el('p', 'small', tf('contestUi.bottomOuts', { n: String(run.bottomOuts), s: num(run.lost, 1) })))
      else if (run.score !== null) block.append(el('p', 'small', t('contestUi.noBottomOuts')))
    }
    if (report) block.append(report)
    return block
  }

  /** The standings: best run each so far, or the final ones. */
  function standingsBlock(e: Entry, final: boolean): HTMLElement {
    const kind = CONTESTS[e.contest].kind
    const rows = contestStandings(kind, e.runs, e.rivals, e.runs.length)
    const wrap = el('div')
    const table = el('table', 'raid-table')
    rows.forEach((row, k) => {
      const tr = el('tr', row.who === 'you' ? 'you' : '')
      tr.append(
        el('td', 'pos', row.best === null ? '–' : String(k + 1)),
        el('td', 'who', entrantName(row.who)),
        el('td', 'time', row.best === null ? t(kind === 'topSpeed' ? 'contestUi.noPass' : 'contestUi.noTime') : scoreText(kind, row.best)),
      )
      table.append(tr)
    })
    const place = rows.findIndex((r) => r.who === 'you') + 1
    const mine = rows[place - 1]!
    const line = mine.best === null
      ? t(final ? 'contestUi.finalNoTime' : 'contestUi.soFarNoTime')
      : tf(final ? 'contestUi.finalPlace' : 'contestUi.soFarPlace', { place: ordinal(place), of: String(rows.length) })
    wrap.append(el('h4', '', t(final ? 'contestUi.finalHead' : 'contestUi.soFarHead')), table, el('p', 'small', line))
    return wrap
  }

  // ── 3. A run ──

  function begin(): void {
    const e = entry
    if (!e) return
    cancelAnimationFrame(raf)
    sound.wake()
    const c = CONTESTS[e.contest]
    const truck = store.truck()
    const { rig, speeds } = eventRig(c, truck, e.driver, pace)
    const runner = startLaps(truck.ride, truck.wear, rig, courseSeed(c, e.cls), { airTemp: fromCelsius(c.airC), poses: VIEW_3D.poseSeconds })
    // A hill climb plays in about RUN_SECONDS; a speed trial a pass at a time like the test track's loops.
    const total = c.kind === 'topSpeed' ? 0 : rig.pieces.reduce((sum, p: RigPiece) => sum + p.length / p.pace, 0) * STEPS_PER_SECOND
    live = { truck, runner, speeds, pace, total }
    sound.startLaps(truck.build.parts.engine, e.cls)
    fast = false
    skipping = false
    carry = 0
    ended = false
    fastBtn.disabled = false
    skipBtn.disabled = false
    fastBtn.setAttribute('aria-pressed', 'false')
    show(liveBox)
    view3d.begin({ truck, road: runner.road, log: runner.poses!, finishText: t('contestUi.finished') })
    layout()
    drawLive()
    reveal(liveBox, { behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function tick(now: number): void {
    const l = live
    if (!l) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (skipping) {
      const until = performance.now() + RIG_VIEW.skipBudgetMs
      while (!l.runner.done && performance.now() < until) advanceLaps(l.runner, 2000)
    } else {
      carry += stepsPerSecond(l) * dt * (fast ? RIG_VIEW.fastFactor : 1)
      const n = Math.floor(carry)
      carry -= n
      advanceLaps(l.runner, n)
    }
    hear(l, dt)
    drawLive()
    if (l.runner.done) finish()
    else raf = requestAnimationFrame(tick)
  }

  /** Sim steps to play each real second at normal speed. */
  function stepsPerSecond(l: Live): number {
    if (l.total > 0) return l.total / RUN_SECONDS
    const r = l.runner
    const lap = r.rig.pieces.reduce((sum, p: RigPiece) => sum + p.length / (r.lapSpeed * p.pace), 0)
    return (lap * STEPS_PER_SECOND) / RIG_VIEW.secondsPerLap
  }

  function hear(l: Live, dt: number): void {
    const r = l.runner
    const piece = r.rig.pieces[r.piece] as RigPiece
    const ride = l.truck.ride
    let heat = -Infinity
    for (let i = 0; i < 4; i++) {
      const damper = (i < 2 ? ride.front : ride.rear).damper
      heat = Math.max(heat, heatShare(r.s.oilTemp[i] as number, damper.warmFrom, damper.redLine))
    }
    sound.lapFrame({ realDt: dt, skipping, feel: takeFeel(r), ground: piece.ground, speed: r.lapSpeed * piece.pace, heat, heatCapacity: ride.front.damper.heatCapacity })
  }

  function drawLive(): void {
    const l = live
    const e = entry
    if (!l || !e) return
    const r = l.runner
    const piece = r.rig.pieces[r.piece] as RigPiece
    const c = CONTESTS[e.contest]
    const len = courseLength(c)
    let share: number
    if (c.passes) {
      // The pass and its speed, and the hottest damper with its word: the fade is the whole event.
      liveHead.textContent = tf('contestUi.livePass', { n: String(e.runs.length + 1), pass: String(r.lap), kmh: num(passKmh(c, r.lap)) })
      share = Math.min(1, (r.lap - 1 + (r.run.w.distance - r.lapStart) / len) / c.passes.most)
      const ride = l.truck.ride
      let oil = -Infinity
      let band: ReturnType<typeof bandOf> = 'cool'
      for (let i = 0; i < 4; i++) {
        const d = (i < 2 ? ride.front : ride.rear).damper
        const temp = (r.s.oilTemp[i] as number) - C0
        if (temp > oil) {
          oil = temp
          band = bandOf(temp, d.warmFrom - C0, d.redLine - C0)
        }
      }
      clockLine.textContent = tf('contestUi.liveOil', { c: num(oil), word: BAND_WORD[band] })
    } else {
      liveHead.textContent = tf('contestUi.live', { n: String(e.runs.length + 1), ground: t(`ground.${piece.ground}` as StringKey), speed: num(msToKmh(piece.pace)) })
      share = Math.min(1, r.run.w.distance / len)
      clockLine.textContent = tf('contestUi.liveClock', { m: num(Math.min(r.run.w.distance, len)), of: num(len) })
    }
    fill.style.width = `${share * 100}%`
    progress.setAttribute('aria-valuenow', String(Math.round(share * 100)))
  }

  // ── 4. The run is over ──

  function finish(): void {
    cancelAnimationFrame(raf)
    const l = live
    const e = entry
    if (!l || !e) return
    const c = CONTESTS[e.contest]
    const result = lapResult(l.runner)
    const run = scoreEvent(c, result, l.speeds, e.driver, l.pace)
    e.runs.push(run)
    if (run.broken) sound.broke(run.broken.kind)
    else sound.stop()
    const done = !run.broken && view3d.works() ? { mine: rollOut(l.runner), ghost: [] } : null
    live = null
    // A break gets the same reading as the test track: the trace and up to three fixes, each a jump to the build screen.
    let report: HTMLElement | null = null
    if (run.broken) {
      const ev = run.broken
      const info = FAILURES[ev.kind]
      report = el('div', 'contest-break')
      report.append(el('p', 'cause', t(info.cause)), crewNote(t(c.kind === 'topSpeed' ? 'contestUi.crewFaded' : 'contestUi.crewBroke')))
      if (result.trace) report.append(traceBlock(ev, result.trace, null, l.truck))
      // The "slower pace" fix talks about the raids, so it's left off here.
      report.append(el('h4', '', t('report.fixes')), fixButtons(info.fixes.filter((f) => f.target !== 'pace').map((f) => ({ ...f, end: endOf(ev.corner) })), {
        truck: l.truck, year: store.rules().year, onFix: (jump) => { jumpTo(jump) },
      }))
    }
    betweenScreen({ run, report })
    // The 3D view stays on top of the results: the break again in slow motion, or the truck over the line.
    body.prepend(liveBox)
    if (liveBox.classList.contains('full') && view3d.works()) {
      ended = true
      const head = body.querySelector('.contest-result .end-head')
      endHead.replaceChildren(...(head ? [...head.childNodes].map((x) => x.cloneNode(true)) : []))
    }
    layout()
    view3d.finish(run.broken, done)
    if (ended) endGo.focus({ preventScroll: true })
    else body.querySelector<HTMLElement>('.contest-result')?.focus({ preventScroll: true })
  }

  // A change of class or build can make the entry's truck line out of date; redraw the entry when it's showing.
  store.onChange(() => {
    if (!entry && !live) entryScreen()
  })
  entryScreen()
  return box
}
