/**
 * The shop (plan PR 4): the three rigs, run live, ending on the report.
 *
 * Pick a rig and start it. The sim runs a few hundred steps every frame
 * (`advanceLaps` / `advanceShaker`), so the screen shows the run as it
 * happens: the lap and its speed, each corner's oil, travel and wear, and a
 * live trace of the whole run so far, with the last run on this rig as a
 * faint dashed ghost. "Fast" plays it quicker, "Skip to the end" works it out
 * as fast as the phone can, and "Stop" ends it early.
 *
 * When something breaks (or the run ends) the report appears underneath
 * (`report.ts`). Its fix buttons jump up to the build screen, and a bar at
 * the bottom of the screen brings the player back to run it again.
 *
 * Each class and rig always drives the same road, so a re-run after a fix
 * shows exactly what the fix changed. The truck is copied when the run
 * starts: changing the build mid-run changes the next run, not this one.
 *
 * Sound (plan PR 6): each frame hands what the truck felt to the sound
 * (`src/audio/sound.ts`), which plays the engine, the clatter, the hits and
 * the hiss, and the break when something lets go. Sound and Buzz switches
 * sit under the start button.
 *
 * Ghost trucks (Kelbo asked, 26 November 2026): on the two loops the run can
 * race a ghost, your best run there or a friend's (`ghostRace.ts`). The
 * ghost's own run is driven again step for step beside yours, shown as a
 * see-through truck in 3D, and the report says who lasted longer.
 */
import { heatShare } from '../audio/cues'
import { makeSound } from '../audio/sound'
import { CLASSES, type ClassId } from '../data/classes'
import { WARM_SHARE } from '../data/failures'
import { RIGS, RIG_VIEW, SHAKER, SHOP_RIGS, VIEW_3D, type RigId, type RigPiece, type ShopRigId } from '../data/rigs'
import { t, tf, type StringKey } from '../data/strings'
import { buildTruck, type BuiltTruck } from '../sim/build'
import { ghostFromRun } from '../sim/ghost'
import { advanceLaps, lapLength, lapResult, startLaps, takeFeel, type LapRunner, type RunHistory } from '../sim/laps'
import { advanceShaker, shakerSteps, startShaker, type ShakerPoint, type ShakerRunner } from '../sim/shaker'
import { fromCelsius, msToKmh } from '../sim/units'
import type { BuildStore } from './buildStore'
import { BAND_WORD, bandOf, ghostLegend, lineChart, shakerChart, type Band, type Series } from './charts'
import { el, num } from './dom'
import { SHOP_EVENT, type ShopEvent } from './events'
import { jumpTo, type Jump } from './fixes'
import { distanceText, ghostRace, raceText, type GhostPick } from './ghostRace'
import { lapReport, shakerReport, type LapGhost } from './report'
import { rigView } from './rigView'

const AIR = fromCelsius(20)
const C0 = 273.15
const STEPS_PER_SECOND = 500

type LiveChannel = 'oil' | 'travel' | 'wear'
const LIVE_CHANNELS: readonly LiveChannel[] = ['oil', 'travel', 'wear']
const LIVE_LABEL: Record<LiveChannel, StringKey> = { oil: 'live.oil', travel: 'live.travel', wear: 'live.wear' }
const LIVE_TITLE: Record<LiveChannel, StringKey> = { oil: 'live.chOil', travel: 'live.chTravel', wear: 'live.chWear' }

/** The last run on a rig, kept for the ghost line and the report's comparison, and saved with the garage (plan PR 8). */
type LapGhostRun = LapGhost & { history: RunHistory }
type Ghost = LapGhostRun | { kind: 'shaker'; points: ShakerPoint[] }

/** What the shop needs from the garage: the saved ghosts, and who to tell when one changes. */
export interface ShopSaves {
  ghosts: Record<string, unknown>
  onGhosts(ghosts: Record<string, unknown>): void
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number')

/**
 * A saved ghost, checked enough that the charts and the report can't trip
 * over it. Anything odd is dropped: a ghost is only there for comparing.
 */
function readGhost(raw: unknown): Ghost | null {
  if (!isObj(raw)) return null
  if (raw.kind === 'shaker') {
    const ok = Array.isArray(raw.points) && raw.points.every((p) => isObj(p) && typeof p.freq === 'number' && isNums(p.body) && p.body.length === 2 && isNums(p.wheel) && p.wheel.length === 2)
    return ok ? (raw as Ghost) : null
  }
  if (raw.kind !== 'laps') return null
  const h = raw.history
  if (!isObj(h) || !(['distance', 'lap', 'oil', 'travel', 'wear'] as const).every((k) => isNums(h[k]))) return null
  if (![raw.brokenLap, raw.laps, raw.lastSpeed].every((x) => typeof x === 'number') || typeof raw.stopped !== 'boolean') return null
  if (raw.broken !== null && !isObj(raw.broken)) return null
  const tr = raw.trace
  if (tr !== null && !(isObj(tr) && isNums(tr.t) && isNums(tr.distance) && isObj(tr.channels))) return null
  return raw as Ghost
}

/** A ghost truck racing this run: the ghost, its truck, and its own run driven step for step with yours. */
interface Race {
  pick: GhostPick
  truck: BuiltTruck
  runner: LapRunner
  /** What the race line says now, so it only changes when something happens. */
  said: string
}

type Active =
  | { kind: 'laps'; rig: RigId; cls: ClassId; truck: BuiltTruck; runner: LapRunner; ghost: LapGhostRun | null; race: Race | null }
  | { kind: 'shaker'; cls: ClassId; truck: BuiltTruck; runner: ShakerRunner; ghost: ShakerPoint[] | null; total: number; taken: number }

/** Each class and rig drives its own road, the same every run, so a re-run shows exactly what a fix changed. */
function seedFor(cls: ClassId, rig: ShopRigId): number {
  return (CLASSES.findIndex((c) => c.id === cls) + 1) * 100 + SHOP_RIGS.indexOf(rig) + 1
}

/** Steps one lap takes at this lap's speed. */
function lapSteps(r: LapRunner): number {
  return r.rig.pieces.reduce((sum: number, piece: RigPiece) => sum + piece.length / (r.lapSpeed * piece.pace), 0) * STEPS_PER_SECOND
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A corner's worst damage across its parts (0 to 1). */
function cornerWear(r: LapRunner, i: number): number {
  const w = r.run.w
  return Math.max(w.bottoming[i]!.damage, w.mount[i]!.damage, w.axle[i]!.damage, w.tire[i]!.damage)
}

export function shopPanel(store: BuildStore, saves?: ShopSaves): HTMLElement {
  const box = el('section', 'panel shop')
  box.id = 'shop'
  box.append(el('h2', '', t('shop.title')), el('p', 'lead', t('shop.lead')))

  const ghosts = new Map<string, Ghost>()
  const ghostKey = (cls: ClassId, rig: ShopRigId) => `${cls}:${rig}`
  // Ghosts from the saved garage, only for a class and rig that exist.
  for (const c of CLASSES) {
    for (const r of SHOP_RIGS) {
      const g = readGhost(saves?.ghosts[ghostKey(c.id, r)])
      if (g) ghosts.set(ghostKey(c.id, r), g)
    }
  }
  // The ghost trucks (best runs and friends' ghosts) are kept beside the last-run lines, under their own keys.
  const ghostsChanged = () => saves?.onGhosts({ ...Object.fromEntries(ghosts), ...race.stored() })
  const race = ghostRace({
    saved: saves?.ghosts ?? {},
    onChange: () => ghostsChanged(),
    onFriend(g) {
      // Put the friend's class and loop on the bench, if nothing's running and the career allows the class.
      if (active) return
      store.setClass(g.cls)
      if (store.cls() !== g.cls) return
      rig = g.rig
      channel = g.rig === 'tortureLoop' ? 'wear' : 'oil'
      reset()
    },
  })
  let rig: ShopRigId = 'washboardLadder'
  let active: Active | null = null
  let raf = 0
  let last = 0
  let carry = 0
  let fast = false
  let skipping = false
  let channel: LiveChannel = 'oil'
  let lastChartDraw = 0
  let lastChartSamples = -1

  // --- Picking a rig ---
  const testing = el('p', 'small testing')
  const rigRow = el('div', 'btn-row')
  const rigButtons = SHOP_RIGS.map((id) => {
    const b = el('button', 'btn', t(`rig.${id}` as StringKey))
    b.type = 'button'
    b.addEventListener('click', () => {
      if (active) return
      rig = id
      channel = id === 'tortureLoop' ? 'wear' : 'oil'
      reset()
    })
    rigRow.append(b)
    return { id, b }
  })
  const rigText = el('p', 'small rig-text')
  const lastLine = el('p', 'small')
  const start = el('button', 'btn start-btn')
  start.type = 'button'
  start.addEventListener('click', () => begin())

  // --- Sound and buzz switches ---
  const sound = makeSound()
  const soundRow = el('div', 'btn-row chip-row sound-row')
  const toggle = (label: StringKey, on: () => boolean, set: (on: boolean) => void) => {
    const b = el('button', 'btn chip-btn')
    b.type = 'button'
    const show = () => {
      b.textContent = tf(on() ? 'sound.on' : 'sound.off', { what: t(label) })
      b.setAttribute('aria-pressed', String(on()))
    }
    b.addEventListener('click', () => {
      set(!on())
      show()
    })
    show()
    soundRow.append(b)
  }
  if (sound.canPlay) toggle('sound.sound', sound.soundOn, sound.setSound)
  if (sound.canBuzz) toggle('sound.buzz', sound.buzzOn, sound.setBuzz)

  // --- The live view ---
  const live = el('div', 'live')
  live.hidden = true
  const liveHead = el('p', 'live-head')
  const progress = el('div', 'live-progress')
  progress.setAttribute('role', 'progressbar')
  progress.setAttribute('aria-valuemin', '0')
  progress.setAttribute('aria-valuemax', '100')
  const progressFill = el('div', 'live-fill')
  progress.append(progressFill)

  const corners = el('div', 'corners')
  const cornerCells = [0, 1, 2, 3].map((i) => {
    const cell = el('div', 'corner')
    const name = el('span', 'corner-name', t(`cornerName.${i}` as StringKey))
    const oil = el('span', 'corner-oil')
    const chip = el('span', 'chip cool')
    const travel = el('span', 'corner-line')
    const wear = el('span', 'corner-line')
    cell.append(name, oil, chip, travel, wear)
    corners.append(cell)
    return { cell, oil, chip, travel, wear }
  })
  const frameLine = el('p', 'small frame-line')

  const channelRow = el('div', 'btn-row chip-row')
  const channelButtons = LIVE_CHANNELS.map((ch) => {
    const b = el('button', 'btn chip-btn', t(LIVE_LABEL[ch]))
    b.type = 'button'
    b.addEventListener('click', () => {
      channel = ch
      lastChartSamples = -1
      drawLive(true)
    })
    channelRow.append(b)
    return { ch, b }
  })
  const chartTitle = el('h3', 'sim-chart-title')
  const chartHolder = el('div', 'sim-chart')
  const legendHolder = el('div')
  const ghostNote = el('p', 'small')
  const raceLine = el('p', 'small race-line')
  raceLine.setAttribute('aria-live', 'polite')

  const controls = el('div', 'btn-row controls')
  const fastBtn = el('button', 'btn', t('shop.fast'))
  fastBtn.type = 'button'
  fastBtn.setAttribute('aria-pressed', 'false')
  fastBtn.addEventListener('click', () => {
    fast = !fast
    fastBtn.setAttribute('aria-pressed', String(fast))
  })
  const skipBtn = el('button', 'btn', t('shop.skip'))
  skipBtn.type = 'button'
  skipBtn.addEventListener('click', () => {
    skipping = true
    skipBtn.disabled = true
    fastBtn.disabled = true
  })
  const stopBtn = el('button', 'btn', t('shop.stop'))
  stopBtn.type = 'button'
  stopBtn.addEventListener('click', () => finish(true))
  controls.append(fastBtn, skipBtn, stopBtn)

  // The 3D view of the run (plan PR 5). It moves into the report when the run ends, so the slow-motion replay is in sight.
  const view3d = rigView()
  live.append(view3d.element, liveHead, progress, corners, frameLine, channelRow, chartTitle, chartHolder, legendHolder, ghostNote, raceLine, controls)
  const reportHolder = el('div', 'report-holder')

  // --- The bar that brings the player back after a fix jump ---
  const rerun = el('div', 'rerun-bar')
  rerun.hidden = true
  const rerunGo = el('button', 'btn rerun-go')
  rerunGo.type = 'button'
  const rerunClose = el('button', 'btn rerun-close', '×')
  rerunClose.type = 'button'
  rerunClose.setAttribute('aria-label', t('rerun.close'))
  rerun.append(rerunGo, rerunClose)
  rerunClose.addEventListener('click', () => {
    rerun.hidden = true
  })
  rerunGo.addEventListener('click', () => {
    rerun.hidden = true
    box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
    begin()
  })
  // Once the shop is back on screen the bar isn't needed.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) rerun.hidden = true
    }, { threshold: 0.35 }).observe(start)
  }

  function onFix(jump: Jump): void {
    if (!jumpTo(jump)) return
    // The first-job guide (plan PR 11b) listens for this.
    document.dispatchEvent(new CustomEvent<ShopEvent>(SHOP_EVENT, { detail: { kind: 'fix', cls: store.cls(), rig } }))
    rerunGo.textContent = tf('rerun.go', { rig: t(`rig.${rig}` as StringKey).toLowerCase() })
    // Let the scroll start before the bar appears, so the observer doesn't hide it straight away.
    window.setTimeout(() => {
      rerun.hidden = false
    }, 600)
  }

  function lastRunText(): string {
    const g = ghosts.get(ghostKey(store.cls(), rig))
    if (!g) return ''
    if (g.kind === 'shaker') return ''
    if (g.broken) return tf('report.lastBroke', { what: t(`fail.${g.broken.kind}` as StringKey), lap: String(g.brokenLap), speed: num(msToKmh(g.lastSpeed)) })
    return g.stopped ? tf('report.lastStopped', { lap: String(g.laps) }) : tf('report.lastLasted', { laps: String(g.laps) })
  }

  /** Back to the start: no run, no report. */
  function reset(): void {
    cancelAnimationFrame(raf)
    sound.stop()
    active = null
    live.hidden = true
    view3d.reset()
    reportHolder.replaceChildren()
    sync()
  }

  function sync(): void {
    const cls = CLASSES.find((c) => c.id === store.cls())!
    testing.textContent = tf('build.testing', { cls: t(cls.name) })
    for (const { id, b } of rigButtons) {
      b.setAttribute('aria-pressed', String(id === rig))
      b.disabled = active !== null
    }
    rigText.textContent = t(`rig.${rig}Text` as StringKey)
    lastLine.textContent = lastRunText()
    start.textContent = t(rig === 'shaker' ? 'shop.startShaker' : 'shop.start')
    start.disabled = active !== null
    race.sync(store.cls(), rig, active !== null)
    for (const { ch, b } of channelButtons) b.setAttribute('aria-pressed', String(ch === channel))
  }

  function begin(): void {
    cancelAnimationFrame(raf)
    // Every way in here is a tap, which is when browsers let sound start.
    sound.wake()
    const cls = store.cls()
    const truck = store.truck()
    const ghost = ghosts.get(ghostKey(cls, rig)) ?? null
    if (rig === 'shaker') {
      const runner = startShaker(truck.ride, AIR, VIEW_3D.poseSeconds)
      active = { kind: 'shaker', cls, truck, runner, ghost: ghost?.kind === 'shaker' ? ghost.points : null, total: shakerSteps(runner), taken: 0 }
      sound.startShaker(truck.build.parts.engine, cls)
    } else {
      const runner = startLaps(truck.ride, truck.wear, RIGS[rig], seedFor(cls, rig), { airTemp: AIR, poses: VIEW_3D.poseSeconds })
      // The ghost drives the very same road from the same start, so step for step it's exactly where its run was.
      const pick = race.pick(cls, rig)
      let rival: Race | null = null
      if (pick) {
        const ghostTruck = buildTruck(pick.ghost.build)
        const ghostRunner = startLaps(ghostTruck.ride, ghostTruck.wear, RIGS[rig], seedFor(cls, rig), { airTemp: AIR, poses: VIEW_3D.poseSeconds, trace: false })
        rival = { pick, truck: ghostTruck, runner: ghostRunner, said: '' }
      }
      active = { kind: 'laps', rig, cls, truck, runner, ghost: ghost?.kind === 'laps' ? ghost : null, race: rival }
      sound.startLaps(truck.build.parts.engine, cls)
    }
    fast = false
    skipping = false
    carry = 0
    fastBtn.disabled = false
    skipBtn.disabled = false
    fastBtn.setAttribute('aria-pressed', 'false')
    controls.hidden = false
    rerun.hidden = true
    reportHolder.replaceChildren()
    const laps = active.kind === 'laps'
    for (const n of [corners, frameLine, channelRow]) n.hidden = !laps
    ghostNote.textContent = active.ghost ? t('shop.ghostNote') : ''
    raceLine.textContent = ''
    live.prepend(view3d.element)
    if (active.kind === 'laps') {
      const r = active.race
      const ghostRun = r ? { truck: r.truck, log: r.runner.poses!, broken: () => r.runner.run.w.broken } : null
      view3d.begin({ truck, road: active.runner.road, log: active.runner.poses!, ghost: ghostRun })
    } else {
      const sr = active.runner
      view3d.begin({ truck, road: null, log: sr.poses!, beat: () => sr.freqs[Math.min(sr.index, sr.freqs.length - 1)] as number })
    }
    live.hidden = false
    lastChartSamples = -1
    sync()
    drawLive(true)
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function tick(now: number): void {
    const a = active
    if (!a) return
    // A long pause (the tab was hidden) shouldn't jump the run ahead.
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (skipping) {
      const until = performance.now() + RIG_VIEW.skipBudgetMs
      while (!a.runner.done && performance.now() < until) step(a, 2000)
    } else {
      const perSecond =
        a.kind === 'laps' ? lapSteps(a.runner) / RIG_VIEW.secondsPerLap : a.total / RIG_VIEW.shakerSeconds
      carry += perSecond * dt * (fast ? RIG_VIEW.fastFactor : 1)
      const n = Math.floor(carry)
      carry -= n
      step(a, n)
    }
    hear(a, dt)
    drawLive(false)
    if (a.runner.done) finish(false)
    else raf = requestAnimationFrame(tick)
  }

  /** Tell the sound what the truck did this frame. */
  function hear(a: Active, dt: number): void {
    if (a.kind === 'shaker') {
      const r = a.runner
      const beat = r.freqs[Math.min(r.index, r.freqs.length - 1)] as number
      const latest = r.points[r.points.length - 1]
      sound.shakerFrame(dt, beat, latest ? Math.max(...latest.wheel) : 1, SHAKER.minFreq, SHAKER.maxFreq)
      return
    }
    const r = a.runner
    const piece = r.rig.pieces[r.piece] as RigPiece
    const ride = a.truck.ride
    let heat = -Infinity
    for (let i = 0; i < 4; i++) {
      const damper = (i < 2 ? ride.front : ride.rear).damper
      heat = Math.max(heat, heatShare(r.s.oilTemp[i] as number, damper.warmFrom, damper.redLine))
    }
    sound.lapFrame({
      realDt: dt,
      skipping,
      feel: takeFeel(r),
      ground: piece.ground,
      speed: r.lapSpeed * piece.pace,
      heat,
      heatCapacity: ride.front.damper.heatCapacity,
    })
  }

  function step(a: Active, n: number): void {
    if (a.kind === 'laps') {
      const taken = advanceLaps(a.runner, n)
      // The ghost takes exactly as many steps, so the two stay side by side in time.
      if (a.race && !a.race.runner.done) advanceLaps(a.race.runner, taken)
    } else a.taken += advanceShaker(a.runner, n)
  }

  /** The line under the chart while racing a ghost: who it is, and what happened to it. */
  function drawRace(a: Extract<Active, { kind: 'laps' }>): void {
    const r = a.race
    if (!r) return
    const g = r.runner
    const broke = g.run.w.broken
    const who = t(r.pick.source === 'best' ? 'ghost.whoBest' : 'ghost.whoFriend')
    let text: string
    if (broke) text = tf('ghost.liveBroke', { who, what: t(`fail.${broke.kind}` as StringKey).toLowerCase(), lap: String(g.laps.length) })
    else if (g.done) text = tf('ghost.liveLasted', { who })
    else text = tf('ghost.liveRacing', { who })
    if (text !== r.said) {
      r.said = text
      raceLine.textContent = text
    }
  }

  function drawLive(force: boolean): void {
    const a = active
    if (!a) return
    if (a.kind === 'shaker') {
      const r = a.runner
      const freq = r.freqs[Math.min(r.index, r.freqs.length - 1)] as number
      liveHead.textContent = tf('live.shaking', { hz: num(freq, 1) })
      setProgress(a.taken / a.total, 'live.shakerProgress')
      if (force || r.points.length !== lastChartSamples) {
        lastChartSamples = r.points.length
        chartTitle.textContent = t('shaker.title')
        chartHolder.replaceChildren(shakerChart(series(r.points), a.ghost ? series(a.ghost) : null, SHAKER.minFreq, SHAKER.maxFreq,
          tf('shaker.alt', { min: num(SHAKER.minFreq, 1), max: num(SHAKER.maxFreq) })))
        legendHolder.replaceChildren(el('p', 'axis', t('shaker.axis')))
      }
      return
    }
    const r = a.runner
    const piece = r.rig.pieces[r.piece] as RigPiece
    liveHead.textContent = tf('live.lap', { lap: String(r.lap), speed: num(msToKmh(r.lapSpeed)), ground: t(`ground.${piece.ground}` as StringKey) })
    setProgress((r.run.w.distance - r.lapStart) / lapLength(r.rig), 'live.progress')

    const ride = a.truck.ride
    for (let i = 0; i < 4; i++) {
      const axle = i < 2 ? ride.front : ride.rear
      const c = cornerCells[i]!
      const oil = (r.s.oilTemp[i] as number) - C0
      const band = bandOf(oil, axle.damper.warmFrom - C0, axle.damper.redLine - C0)
      c.oil.textContent = `${num(oil)} °C`
      setChip(c.chip, band)
      const travel = (r.stats.peakCompression[i] as number) / axle.bumpTravel
      c.travel.textContent = tf('live.cornerTravel', { pct: num(Math.max(0, travel) * 100) })
      c.travel.className = `corner-line ${bandOf(travel, 1 - axle.bumpStopLength / axle.bumpTravel, 1)}-text`
      const wear = cornerWear(r, i)
      c.wear.textContent = tf('live.cornerWear', { pct: num(wear * 100) })
      c.wear.className = `corner-line ${bandOf(wear, WARM_SHARE, 1)}-text`
      c.cell.dataset.band = band
    }
    frameLine.textContent = tf('live.frame', { pct: num(Math.max(...r.run.w.frame.map((f) => f.damage)) * 100) })
    drawRace(a)

    // The chart only needs redrawing when there's a new sample, and not more than a few times a second.
    const now = performance.now()
    const samples = r.history.distance.length
    if (force || (samples !== lastChartSamples && now - lastChartDraw > 150) || r.done) {
      lastChartSamples = samples
      lastChartDraw = now
      drawLapChart(a)
    }
  }

  function drawLapChart(a: Extract<Active, { kind: 'laps' }>): void {
    for (const { ch, b } of channelButtons) b.setAttribute('aria-pressed', String(ch === channel))
    const r = a.runner
    const ride = a.truck.ride
    const h = r.history
    const pick = (hist: RunHistory): Series => {
      const ys = channel === 'oil' ? hist.oil.map((k) => k - C0) : channel === 'travel' ? hist.travel.map((v) => v * 100) : hist.wear.map((v) => v * 100)
      return { x: hist.distance, y: ys }
    }
    const lines =
      channel === 'oil'
        ? { warm: ride.front.damper.warmFrom - C0, limit: ride.front.damper.redLine - C0, include: [AIR - C0] }
        : channel === 'travel'
          ? { warm: Math.min(...[ride.front, ride.rear].map((x) => (1 - x.bumpStopLength / x.bumpTravel) * 100)), limit: 100, include: [0] }
          : { warm: WARM_SHARE * 100, limit: 100, include: [0] }
    const now = pick(h)
    const ghost = a.ghost ? pick(a.ghost.history) : null
    const lapLen = lapLength(r.rig)
    const xMax = Math.max(lapLen, h.distance[h.distance.length - 1] ?? 0, ghost?.x[ghost.x.length - 1] ?? 0)
    // A tick at the start of each lap, labelled with its number; every other one if they'd crowd.
    const every = (lapLen / xMax) * 290 < 16 ? 2 : 1
    const starts = [0, ...r.laps.map((l) => l.endDistance)]
    const total = Math.max(r.lap, a.ghost?.laps ?? 0)
    const xTicks: { x: number; label: string }[] = []
    for (let lap = 1; lap <= total; lap++) {
      const x = starts[lap - 1] ?? (lap - 1) * lapLen
      if ((lap - 1) % every === 0 && x < xMax * 0.88) xTicks.push({ x, label: String(lap) })
    }
    const value = now.y[now.y.length - 1] ?? 0
    chartTitle.textContent = t(LIVE_TITLE[channel])
    const chart = lineChart({
      series: now,
      ghost,
      warm: lines.warm,
      limit: lines.limit,
      xMin: 0,
      xMax,
      xTicks,
      xLabel: t('live.axis'),
      yInclude: lines.include,
      alt: tf('live.alt', { channel: t(LIVE_TITLE[channel]).toLowerCase(), value: `${num(value)} · ${BAND_WORD[bandOf(value, lines.warm, lines.limit)]}` }),
    })
    chartHolder.replaceChildren(chart.svg)
    legendHolder.replaceChildren(...[ghostLegend(ghost !== null)].filter((n): n is SVGSVGElement => n !== null))
  }

  function setProgress(share: number, label: StringKey): void {
    const pct = Math.max(0, Math.min(1, share)) * 100
    progressFill.style.width = `${pct}%`
    progress.setAttribute('aria-valuenow', String(Math.round(pct)))
    progress.setAttribute('aria-label', t(label))
  }

  function setChip(chip: HTMLElement, band: Band): void {
    chip.className = `chip ${band}`
    chip.textContent = BAND_WORD[band]
  }

  function series(points: readonly ShakerPoint[]) {
    return {
      freq: points.map((p) => p.freq),
      body: points.map((p) => Math.max(...p.body)),
      wheel: points.map((p) => Math.max(...p.wheel)),
    }
  }

  function finish(stopped: boolean): void {
    cancelAnimationFrame(raf)
    const a = active
    if (!a) return
    active = null
    controls.hidden = true
    if (a.kind === 'laps' && a.runner.run.w.broken && !stopped) sound.broke(a.runner.run.w.broken.kind)
    else sound.stop()
    drawLive(true)
    const ctx = { rig, cls: a.cls, truck: a.truck, onFix, onRunAgain: () => begin() }
    let report: HTMLElement
    if (a.kind === 'shaker') {
      report = shakerReport(a.runner.points, a.ghost, ctx)
      if (!stopped && a.runner.points.length > 0) ghosts.set(ghostKey(a.cls, 'shaker'), { kind: 'shaker', points: a.runner.points })
    } else {
      const run = lapResult(a.runner)
      report = lapReport(run, stopped, a.ghost, ctx)
      if (!stopped) raceVerdict(report, a, ghostFromRun(a.cls, a.rig, a.truck.build, run))
      const lastLap = run.laps[run.laps.length - 1]
      ghosts.set(ghostKey(a.cls, a.rig), {
        kind: 'laps',
        broken: run.broken,
        brokenLap: run.brokenLap,
        laps: run.laps.length,
        lastSpeed: lastLap?.speed ?? 0,
        stopped,
        trace: run.trace,
        history: run.history,
      })
    }
    ghostsChanged()
    // The first-job guide (plan PR 11b) listens for this: a finished run, not a stopped one.
    if (!stopped) document.dispatchEvent(new CustomEvent<ShopEvent>(SHOP_EVENT, { detail: { kind: 'run', cls: a.cls, rig: a.kind === 'laps' ? a.rig : 'shaker' } }))
    reportHolder.replaceChildren(report)
    sync()
    const head = report.querySelector<HTMLElement>('.report-head')
    head?.after(view3d.element)
    view3d.finish(a.kind === 'laps' ? a.runner.run.w.broken : null)
    head?.focus({ preventScroll: true })
    report.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }

  /**
   * The report's ghost lines: how the run went against the ghost (if it
   * raced one), and whether it's a new best (which becomes the ghost).
   */
  function raceVerdict(report: HTMLElement, a: Extract<Active, { kind: 'laps' }>, mine: ReturnType<typeof ghostFromRun>): void {
    const lines: string[] = []
    const r = a.race
    if (r) {
      // The ghost's own run as driven here; if yours ended first, the rest of its run is what it did before.
      const g = r.runner
      const lastLap = g.laps[g.laps.length - 1]
      const theirs = g.done ? { distance: lastLap?.endDistance ?? 0 } : r.pick.ghost
      lines.push(tf(r.pick.source === 'best' ? 'ghost.againstBest' : 'ghost.againstFriend', { how: raceText(mine, theirs) }))
    }
    if (race.record(mine)) lines.push(tf('ghost.newBest', { dist: distanceText(mine.distance) }))
    if (lines.length === 0) return
    const box = el('div', 'ghost-verdict')
    for (const l of lines) box.append(el('p', '', l))
    const head = report.querySelector('.report-head')
    if (head) head.after(box)
    else report.prepend(box)
  }

  store.onChange((change) => {
    // A new class is a new truck: drop the run in progress. Part and setting changes wait for the next run.
    if (change === 'class' || change === 'bench') reset()
  })

  box.append(testing, rigRow, rigText, lastLine, start, race.element, soundRow, live, reportHolder, rerun)
  sync()
  return box
}
