/**
 * The raid screens (plan PR 7b). One panel that moves through a raid:
 *
 * 1. **Entry:** pick a raid and a driver; the truck is the one on the build
 *    screen (it must pass the build rules).
 * 2. **Morning:** the stage's roadbook, the truck's wear and spares, and the
 *    pace call for the first leg.
 * 3. **The stage**, a leg at a time: the sim drives the leg (about a second
 *    on a phone), then its highlight plays: clips in 3D at true speed (a
 *    break in slow motion), with the live trace of the hottest oil or the
 *    most worn part filling in along the stage, and each stop as it comes.
 *    At each checkpoint: the clock, the place in class, and the next pace call.
 * 4. **Results:** the day's times and the overall standings.
 * 5. **The bivouac:** pick jobs for the night within the hours and spares.
 * 6. **Final results** after the last stage.
 *
 * Saves (plan PR 8): the raid goes into the garage each morning, after each
 * stage and at the end, so a reload comes back to that screen. A reload in
 * the middle of a stage starts that stage again from its morning.
 */
import { CLASSES } from '../data/classes'
import { SPARE_IDS, type SpareId } from '../data/parts'
import { DRIVER_IDS, DRIVERS, FREE_RAID_IDS, JOBS, PACES, RAID, RAIDS, RIVALS, type DriverId, type PaceId, type RaidId, type Rival } from '../data/raids'
import { t, tf, type StringKey } from '../data/strings'
import { COND_PARTS, type CondPart } from '../data/condition'
import { checkBuild, partIn } from '../sim/build'
import { conditionEffect } from '../sim/condition'
import { driverName } from '../sim/career'
import { legHighlights, type Clip } from '../sim/highlight'
import {
  advanceStage, bivouacHours, bivouacJobs, checkJobs, currentPace, doJobs, enterRaid, finishStage, iceAtPace, isCondPart, isRestDay, leaveCheckpoint,
  partsBudget, partsMoney, parTime, raidOf, raidTruck, stageKm, standings, startStage,
  type IceNote, type Job, type RaidState, type StageRecord, type StageRun, type Stop,
} from '../sim/raid'
import type { BuildStore } from './buildStore'
import { BAND_WORD, bandOf, lineChart, type LineChart } from './charts'
import { el, num } from './dom'
import { BREAK_RATE, raidView } from './raidView'

const C0 = 273.15
/** Clips shown per leg: about half a minute of highlight. */
const CLIPS_PER_LEG = 7
/** A break holds on screen this long after its slow-motion replay (s). */
const BREAK_HOLD = 1.8

// ── Words for numbers ──

/** A clock time: 1:04:09. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** A gap: +4:12 or +1:04:09. */
export function gap(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 3600) return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return `+${clock(s)}`
}

/** 1st, 2nd, 3rd, 4th... (11th, 12th and 13th too). */
export function ordinal(n: number): string {
  const tens = n % 100
  const ones = n % 10
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

/** A name for an entry in the standings: you, or a rival from the raid's field (the career's teams) or the usual list. */
export function entrantName(who: string, field?: readonly Rival[]): string {
  if (who === 'you') return t('raidUi.you')
  const r = (field ?? RIVALS).find((x) => x.id === who) ?? RIVALS.find((x) => x.id === who)
  return r ? tf('raidUi.rivalName', { team: t(r.team), n: String(r.number) }) : who
}

/** A results table: place, who (with any trouble noted) and the gap to the leader. `you` names the player's line. */
export function raidTable(rows: { who: string; time: number }[], rec: StageRecord | null, field?: readonly Rival[], you?: string): HTMLElement {
  const table = el('table', 'raid-table')
  const lead = rows[0]?.time ?? 0
  rows.forEach((row, k) => {
    const tr = el('tr', row.who === 'you' ? 'you' : '')
    const rival = rec?.rivals.find((x) => x.id === row.who)
    const name = el('td', 'who', row.who === 'you' && you ? you : entrantName(row.who, field))
    if (rival?.trouble) name.append(el('span', 'small rival-note', tf('raidUi.rivalTrouble', { what: t(`raidUi.trouble.${rival.trouble.kind}` as StringKey), lost: gap(rival.trouble.lost).slice(1) })))
    if (rival?.late) name.append(el('span', 'small rival-note', t('raidUi.rivalLate')))
    tr.append(el('td', 'pos', String(k + 1)), name, el('td', 'time', k === 0 ? clock(row.time) : gap(row.time - lead)))
    table.append(tr)
  })
  return table
}

const money = (n: number) => tf('career.money', { n: num(Math.round(n)) })

function partName(part: Job['part'], index: number): string {
  if (isCondPart(part)) return tf(`raidUi.part.${part}` as StringKey, { axle: t(`axleName.${index}` as StringKey) })
  if (part === 'frame') return tf('raidUi.part.frame', { zone: t(`zone.${['front', 'centre', 'rear'][index] ?? 'centre'}` as StringKey) })
  return tf(`raidUi.part.${part}` as StringKey, { corner: t(`cornerName.${index}` as StringKey) })
}

/** What tired oil, cracked bushings or sagged springs do to the truck, in plain words. */
function effectText(part: CondPart, value: number): string {
  const e = conditionEffect(part, value)
  if (part === 'oil') return tf('raidUi.effect.oil', { pct: num(e.damping * 100), k: num(e.fadeSooner) })
  if (part === 'bushing') return tf('raidUi.effect.bushing', { pct: num(e.mount * 100) })
  return tf('raidUi.effect.spring', { pct: num(e.travel * 100) })
}

function sparesList(spares: Record<SpareId, number>): string {
  return SPARE_IDS.map((s) => `${spares[s]} ${spares[s] === 1 ? t(`raidUi.spare.${s}` as StringKey) : t(`raidUi.spares.${s}` as StringKey)}`).join(', ')
}

/** One line about a roadside stop: where, what, what the crew did and the time it cost. */
function stopText(st: Stop): string {
  if (st.kind === 'ice') return tf('raidUi.iceStop', { km: num(st.at / 1000, 1), lost: gap(st.lost).slice(1) })
  if (st.kind === 'slide') return tf('raidUi.slideStop', { km: num(st.at / 1000, 1), lost: gap(st.lost).slice(1) })
  const where = st.kind === 'frame' ? `, ${t(`zone.${st.zone ?? 'centre'}` as StringKey)}` : `, ${t(`corner.${st.corner}` as StringKey)}`
  const text = tf('raidUi.stopLine', {
    km: num(st.at / 1000, 1),
    what: t(`fail.${st.kind}` as StringKey),
    where: st.kind === 'fade' ? '' : where,
    fix: t(`raidUi.fix.${st.fix}` as StringKey),
    lost: gap(st.lost).slice(1),
  })
  return text + (st.estimated ? t('raidUi.stopLater') : '')
}

/** One line about the ice creaking but holding. */
function iceNoteText(n: IceNote): string {
  return tf('raidUi.iceCreak', { km: num(n.at / 1000, 1), pct: num(n.use * 100) })
}

/** The ice band in the trace rule's colours: quiet is normal, creaking is warm, cracking is over the limit. */
const ICE_CLASS = { quiet: 'cool-text', creaking: 'warm-text', cracks: 'hot-text' } as const

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

/** What the raid needs from the garage: the saved raid, and who to tell when it moves on. */
export interface RaidSaves {
  raid: RaidState | null
  onRaid(raid: RaidState | null): void
}

/**
 * The career's side of the raid panel (plan PR 9b). While a career is on,
 * raids start from the career panel (`start`), and when one ends (or you
 * retire) the career is told so it can pay out.
 */
export interface RaidCareer {
  on(): boolean
  /** The raid is over: `retired` if you pulled out. */
  finish(state: RaidState, retired: boolean): void
  /** The raid panel hands over its way to start a career raid. */
  register(start: (state: RaidState) => void): void
}

export function raidPanel(store: BuildStore, saves?: RaidSaves, career?: RaidCareer): HTMLElement {
  const box = el('section', 'panel raid')
  box.id = 'raid'
  box.append(el('h2', '', t('raidUi.title')), el('p', 'lead', t('raidUi.lead')))
  const body = el('div', 'raid-body')
  box.append(body)

  let raidId: RaidId = 'summerSprint'
  let driver: DriverId = 'veteran'
  let state: RaidState | null = null
  /** The stage being driven and its highlight, if any. */
  let run: StageRun | null = null
  let timer = 0
  let raf = 0
  const view3d = raidView()
  /** Hand the garage a copy, so a stage driven after this can't change what's saved. */
  const saveRaid = () => saves?.onRaid(state ? structuredClone(state) : null)

  function stopTimers(): void {
    window.clearTimeout(timer)
    cancelAnimationFrame(raf)
    view3d.stop()
  }

  function show(...nodes: Node[]): void {
    body.replaceChildren(...nodes)
  }

  /** True while putting a saved raid back on screen at page load: no focus jump or scroll then. */
  let restoring = false

  function focusHead(node: HTMLElement): void {
    if (restoring) return
    node.tabIndex = -1
    node.focus({ preventScroll: true })
    box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }

  // ── 1. Entry ──

  function entryScreen(): void {
    stopTimers()
    const hadRaid = state !== null
    state = null
    if (hadRaid) saveRaid()
    run = null
    if (career?.on()) {
      // In the career, raids start from the garage above (contracts and your own entries).
      show(el('p', 'small', t('raidUi.careerNote')))
      return
    }
    const raidText = el('p', 'small')
    const studsText = el('p', 'small warm-text', t('raidUi.winterNoStuds'))
    const driverText = el('p', 'small')
    const syncText = () => {
      const raid = RAIDS[raidId]
      raidText.textContent = `${t(raid.text)} ${tf('raidUi.stagesLine', { n: String(raid.stages.length), km: num(raid.stages.reduce((s, st) => s + stageKm(st), 0)) })}`
      studsText.hidden = raid.season !== 'winter' || partIn(store.truck().build, 'tires').studded
      driverText.textContent = tf('driver.about', { trade: t(DRIVERS[driver].name), text: t(DRIVERS[driver].text) })
    }
    const raidRow = picker(FREE_RAID_IDS, (id) => t(RAIDS[id].name), () => raidId, (id) => {
      raidId = id
      syncText()
    })
    // Free play has no career, so it's the first of each trade's pool (`driverName`).
    const driverRow = picker(DRIVER_IDS, (id) => t(driverName(null, id)), () => driver, (id) => {
      driver = id
      syncText()
    })
    syncText()

    const truck = store.truck()
    const cls = CLASSES.find((c) => c.id === store.cls())!
    const carries = partIn(truck.build, 'spares').carries
    const truckLines = el('div')
    truckLines.append(
      el('p', 'small', tf('raidUi.truckLine', { cls: t(cls.name).toLowerCase() })),
      el('p', 'small', tf('raidUi.sparesLine', { list: sparesList({ ...carries }) })),
    )
    if (SPARE_IDS.every((s) => carries[s] === 0)) truckLines.append(el('p', 'small warm-text', t('raidUi.noSparesWarn')))
    const problems = checkBuild(truck.build, store.rules())
    const enter = button(t('raidUi.enter'), 'btn start-btn')
    if (problems.length) {
      enter.disabled = true
      const what = problems.map((p) => p.kind === 'tooHeavy' ? t('build.tooHeavy') : p.kind === 'tooLight' ? t('build.tooLight') : p.kind === 'overBudget' ? t('build.overBudget') : t('raidUi.partNotYet')).join(', ').toLowerCase()
      truckLines.append(el('p', 'small hot-text', tf('raidUi.cantEnter', { what })))
    }
    enter.addEventListener('click', () => {
      state = enterRaid(raidId, store.build(), driver)
      morningScreen()
    })
    show(
      el('h3', 'raid-sub', t('raidUi.pickRaid')), raidRow, raidText, studsText,
      el('h3', 'raid-sub', t('raidUi.pickDriver')), driverRow, driverText,
      truckLines, enter,
    )
  }

  // ── 2. Morning ──

  function retireButton(): HTMLButtonElement {
    const b = button(t('raidUi.retire'), 'btn small-btn retire-btn')
    let armed = false
    let disarm = 0
    b.addEventListener('click', () => {
      if (armed) {
        window.clearTimeout(disarm)
        if (career?.on() && state) career.finish(state, true)
        entryScreen()
        return
      }
      armed = true
      b.textContent = t('raidUi.retireSure')
      disarm = window.setTimeout(() => {
        armed = false
        b.textContent = t('raidUi.retire')
      }, 3000)
    })
    return b
  }

  function conditionList(s: RaidState): HTMLElement {
    const list = el('ul', 'raid-list')
    const worn: { part: Job['part']; index: number; damage: number }[] = []
    for (const part of ['tire', 'bottoming', 'axle', 'mount'] as const) s.wear[part].forEach((f, index) => worn.push({ part, index, damage: f.damage }))
    s.wear.frame.forEach((f, index) => worn.push({ part: 'frame', index, damage: f.damage }))
    const shown = worn.filter((w) => w.damage >= RAID.jobFrom).sort((a, b) => b.damage - a.damage)
    // Bivouac breakdowns: tired oil, cracked bushings and sagged springs, per axle, with what each does.
    const tired: { part: CondPart; index: number; value: number }[] = []
    for (const part of COND_PARTS) s.cond[part].forEach((value, index) => tired.push({ part, index, value }))
    const tiredShown = tired.filter((c) => c.value >= RAID.jobFrom).sort((a, b) => b.value - a.value)
    if (!shown.length && !tiredShown.length) list.append(el('li', 'small', t('raidUi.allGood')))
    for (const w of shown) {
      const li = el('li', `${bandOf(w.damage, 0.5, 0.85)}-text`, tf('raidUi.wornLine', { part: partName(w.part, w.index), pct: num(w.damage * 100) }))
      list.append(li)
    }
    for (const c of tiredShown) {
      const li = el('li', `${bandOf(c.value, 0.5, 0.85)}-text`, tf('raidUi.tiredLine', {
        part: partName(c.part, c.index), pct: num(c.value * 100), state: t(`raidUi.state.${c.part}` as StringKey),
      }))
      li.append(el('span', 'small cond-effect', effectText(c.part, c.value)))
      list.append(li)
    }
    return list
  }

  function morningScreen(): void {
    stopTimers()
    saveRaid()
    const s = state!
    const raid = raidOf(s)
    const spec = raid.stages[s.stage]!
    const truck = raidTruck(s, store.build())
    const cls = truck.build.cls
    const head = el('h3', 'raid-day', `${tf('raidUi.day', { n: String(s.stage + 1), total: String(raid.stages.length) })} · ${t(spec.tag)}`)
    const par = parTime(cls, spec.segments.map((x) => ({ ground: x.ground, length: x.km * 1000 })))
    const facts = el('p', 'readout-line', tf('raidUi.stageFacts', { km: num(stageKm(spec)), air: num(spec.airC), par: clock(par) }))

    // The roadbook: each piece of ground with its distance, and the checkpoints.
    const total = stageKm(spec)
    const cps = RAID.checkpoints.map((share) => Math.round(total * share))
    const book = el('ol', 'rb-rows raid-book')
    let km = 0
    let cp = 0
    const row = (at: number, text: string, cls2 = '') => {
      const li = el('li', `rb-row ${cls2}`)
      const dist = el('div', 'rb-km')
      dist.append(el('span', 'rb-num', num(at)), el('span', 'rb-unit', t('roadbook.km')))
      li.append(dist, el('p', 'rb-note', text))
      book.append(li)
    }
    for (const seg of spec.segments) {
      while (cp < cps.length && (cps[cp] as number) <= km) {
        row(cps[cp] as number, tf('raidUi.checkpoint', { n: String(cp + 1) }), 'rb-cp')
        cp++
      }
      row(km, tf('raidUi.segment', { ground: t(`ground.${seg.ground}` as StringKey), km: num(seg.km) }))
      km += seg.km
    }
    row(total, t('raidUi.finish'), 'rb-cp')

    // Lake ice: how it reads for this truck at each pace call.
    const iceBox = el('div')
    if (spec.ice) {
      const list = el('ul', 'raid-list')
      for (const p of PACES) {
        const r = iceAtPace(spec, truck, s.entry.driver, p)!
        list.append(el('li', ICE_CLASS[r.band], tf('raidUi.iceLine', { pace: t(`pace.${p}` as StringKey), pct: num(r.use * 100), word: t(`raidUi.ice.${r.band}` as StringKey) })))
      }
      iceBox.append(
        el('h4', 'raid-sub', t('raidUi.iceHead')),
        el('p', 'small', tf('raidUi.iceFacts', { cm: num(spec.ice.cm), t: num(truck.mass / 1000, 1) })),
        list,
        el('p', 'small', t('raidUi.iceNote')),
      )
    }

    const settings = el('p', 'small', store.cls() === s.entry.build.cls ? t('raidUi.settingsNote') : t('raidUi.otherClass'))
    let pace: PaceId = 'steady'
    const paceText = el('p', 'small')
    const syncPace = () => (paceText.textContent = t(`raidUi.pace.${pace}` as StringKey))
    const paceRow = picker(PACES, (id) => t(`pace.${id}` as StringKey), () => pace, (id) => {
      pace = id
      syncPace()
    })
    syncPace()
    const start = button(t('raidUi.start'), 'btn start-btn')
    start.addEventListener('click', () => {
      run = startStage(s, raidTruck(s, store.build()), pace)
      stageScreen()
    })
    show(
      head, facts,
      el('h4', 'raid-sub', t('raidUi.roadbook')), book, iceBox,
      el('h4', 'raid-sub', t('raidUi.condition')), conditionList(s),
      el('p', 'small', tf('raidUi.sparesLine', { list: sparesList(s.spares) })), settings,
      el('h4', 'raid-sub', t('raidUi.paceCall')), paceRow, paceText, start, retireButton(),
    )
    focusHead(head)
  }

  // ── 3. The stage ──

  function stageScreen(): void {
    stopTimers()
    const s = state!
    const r = run!
    const raid = raidOf(s)
    const totalM = stageKm(r.spec) * 1000
    const head = el('h3', 'raid-day', `${tf('raidUi.day', { n: String(r.stage + 1), total: String(raid.stages.length) })} · ${t(r.spec.tag)}`)
    const liveHead = el('p', 'live-head')
    liveHead.setAttribute('aria-live', 'off')
    const progress = el('div', 'live-progress')
    const fill = el('div', 'live-fill')
    progress.append(fill)
    let channel: 'oil' | 'wear' = 'oil'
    const chTitle = el('h4', 'sim-chart-title')
    const chartHolder = el('div', 'sim-chart')
    const readout = el('p', 'readout-line')
    const channelRow = picker(['oil', 'wear'] as const, (c) => t(c === 'oil' ? 'live.oil' : 'live.wear'), () => channel, (c) => {
      channel = c
      chart = null
      draw(shownTo)
    })
    const log = el('ul', 'raid-log')
    log.setAttribute('aria-live', 'polite')
    const skip = button(t('raidUi.skip'))
    const card = el('div', 'raid-card')
    const ride = r.truck.ride
    const warm = Math.min(ride.front.damper.warmFrom, ride.rear.damper.warmFrom) - C0
    const red = Math.min(ride.front.damper.redLine, ride.rear.damper.redLine) - C0

    let chart: LineChart | null = null
    let chartLen = -1
    let shownTo = 0
    let logged = 0
    let creaks = 0

    /** Draw the trace up to `upTo` metres (rebuilt when the sim adds to it). */
    function draw(upTo: number): void {
      shownTo = upTo
      const tr = r.trace
      if (!chart || chartLen !== tr.distance.length) {
        chartLen = tr.distance.length
        const xs = tr.distance.map((d) => d / 1000)
        const ys = channel === 'oil' ? tr.oil.map((k) => k - C0) : tr.wear.map((w) => w * 100)
        // Ticks at the start and the two checkpoints; the finish is the right-hand edge.
        const ticks = [0, ...RAID.checkpoints.map((c) => Math.round((totalM * c) / 1000))]
        chTitle.textContent = t(channel === 'oil' ? 'raidUi.chOil' : 'raidUi.chWear')
        chart = lineChart({
          series: { x: xs, y: ys },
          warm: channel === 'oil' ? warm : 50,
          limit: channel === 'oil' ? red : 100,
          xMin: 0,
          xMax: totalM / 1000,
          xTicks: ticks.map((x) => ({ x, label: num(x) })),
          xLabel: t('raidUi.axis'),
          yInclude: channel === 'oil' ? [r.airTemp - C0, warm] : [0, 50],
          alt: t('raidUi.view'),
        })
        chartHolder.replaceChildren(chart.svg)
      }
      const at = chart.reveal(upTo / 1000)
      const value = `${num(at.value)}${channel === 'oil' ? ' °C' : '%'} · ${BAND_WORD[at.band]}`
      readout.textContent = value
      chart.svg.setAttribute('aria-label', tf('raidUi.alt', { channel: t(channel === 'oil' ? 'raidUi.chOil' : 'raidUi.chWear').toLowerCase(), value }))
      fill.style.width = `${Math.min(100, (upTo / totalM) * 100)}%`
      // Stops come into the log as the highlight passes them.
      while (logged < r.stops.length && (r.stops[logged] as Stop).at <= upTo + 1) addStop(r.stops[logged++] as Stop)
      while (creaks < r.iceNotes.length && (r.iceNotes[creaks] as IceNote).at <= upTo + 1) {
        log.append(el('li', 'warm-text', iceNoteText(r.iceNotes[creaks++] as IceNote)))
      }
    }

    function addStop(st: Stop): void {
      log.append(el('li', 'hot-text', stopText(st)))
    }

    function headline(km: number, ground: string, pace: PaceId): void {
      liveHead.textContent = tf('raidUi.liveHead', {
        leg: String(r.leg + 1), km: num(km / 1000), total: num(totalM / 1000), ground, pace: t(`pace.${pace}` as StringKey),
      })
    }

    /** Drive the current leg in the sim, a piece of ground per tick so the page keeps drawing. */
    function driveLeg(): void {
      card.replaceChildren()
      skip.hidden = true
      const legStart = r.at
      liveHead.textContent = tf('raidUi.driving', { n: String(r.leg + 1) })
      const step = () => {
        advanceStage(s, r)
        if (r.status === 'driving') {
          timer = window.setTimeout(step, 0)
          return
        }
        void playLeg(legStart)
      }
      timer = window.setTimeout(step, 30)
    }

    /** Play the leg's highlight, then the checkpoint or the finish. */
    async function playLeg(legStart: number): Promise<void> {
      const leg = r.leg
      const legEnd = r.at
      const clips: Clip[] = legHighlights(r.clips, leg, CLIPS_PER_LEG)
      skip.textContent = t(r.status === 'finished' ? 'raidUi.skipFinish' : 'raidUi.skip')
      skip.hidden = false
      await view3d.setLeg(r.truck, clips)
      if (run !== r) return
      let i = 0
      let clipStart = 0
      let duration = 0
      const pace = r.paces[leg] as PaceId
      const begin = () => {
        const c = clips[i]
        if (!c) {
          endLeg()
          return
        }
        view3d.show(i)
        const span = c.poses[c.poses.length - 1]!.t - c.poses[0]!.t
        duration = c.broken ? span / BREAK_RATE + BREAK_HOLD : span
        clipStart = performance.now()
        const eased = r.stops.filter((st) => st.leg === leg && st.at <= c.at).length
        headline(c.at, t(`ground.${c.ground}` as StringKey), PACES[Math.max(0, PACES.indexOf(pace) - Math.min(RAID.easeSteps, eased))] as PaceId)
      }
      const frame = (now: number) => {
        if (run !== r) return
        const c = clips[i]
        if (!c) return
        const span = c.poses[c.poses.length - 1]!.t - c.poses[0]!.t
        const played = Math.min(span, ((now - clipStart) / 1000) * (c.broken ? BREAK_RATE : 1))
        draw(Math.max(shownTo, c.at + played * c.speed))
        if ((now - clipStart) / 1000 >= duration) {
          i++
          begin()
        }
        if (clips[i]) raf = requestAnimationFrame(frame)
      }
      const endLeg = () => {
        cancelAnimationFrame(raf)
        draw(legEnd)
        const lastSeg = r.legs[leg]?.segments.at(-1)
        headline(legEnd, lastSeg ? t(`ground.${lastSeg.ground}` as StringKey) : '', currentPace(r))
        if (r.status === 'checkpoint') checkpointCard()
        else finishCard()
      }
      skip.onclick = () => {
        cancelAnimationFrame(raf)
        clips.length = i
        endLeg()
      }
      if (!clips.length) {
        draw(legStart)
        endLeg()
        return
      }
      begin()
      raf = requestAnimationFrame(frame)
    }

    function checkpointCard(): void {
      skip.hidden = true
      const n = r.leg + 1
      const mine = r.time
      const field = [mine, ...r.rivals.map((x) => x.splits[r.leg] as number)].sort((a, b) => a - b)
      const pos = field.indexOf(mine) + 1
      const oil = Math.max(...r.oil) - C0
      const wear = Math.max(...r.trace.wear.slice(-1))
      const h = el('h4', 'raid-sub', tf('raidUi.atCheckpoint', { n: String(n) }))
      let pace: PaceId = r.paces[r.leg] as PaceId
      const paceText = el('p', 'small')
      const syncPace = () => (paceText.textContent = t(`raidUi.pace.${pace}` as StringKey))
      const row = picker(PACES, (id) => t(`pace.${id}` as StringKey), () => pace, (id) => {
        pace = id
        syncPace()
      })
      syncPace()
      const go = button(t('raidUi.goOn'), 'btn start-btn')
      go.addEventListener('click', () => {
        leaveCheckpoint(r, pace)
        driveLeg()
      })
      const notes = el('div')
      if (r.limped && r.stops.filter((st) => st.leg === r.leg).length >= RAID.maxStopsPerLeg) notes.append(el('p', 'small hot-text', t('raidUi.limped')))
      card.replaceChildren(
        h,
        el('p', 'readout-line', tf('raidUi.cpTime', { time: clock(mine), place: tf('raidUi.cpPlace', { pos: ordinal(pos), n: String(field.length) }) })),
        el('p', 'readout-line', tf('raidUi.cpOil', { oil: num(oil), band: oil < 0 ? t('raidUi.coldOil') : BAND_WORD[bandOf(oil, warm, red)], wear: num(wear * 100) })),
        notes,
        el('p', 'small', tf('raidUi.nextPace', { n: String(n + 1) })), row, paceText, go,
      )
      go.focus({ preventScroll: true })
      card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' })
    }

    function finishCard(): void {
      skip.hidden = true
      const late = r.late
      const rec = finishStage(s, r)
      run = null
      resultsScreen(rec, late)
    }

    view3d.element.hidden = true
    show(head, view3d.element, liveHead, progress, channelRow, chTitle, chartHolder, readout, log, skip, card)
    draw(0)
    focusHead(head)
    driveLeg()
  }

  // ── 4. Results ──

  function standingsTable(rows: { who: string; time: number }[], rec: StageRecord | null): HTMLElement {
    return raidTable(rows, rec, state?.entry.field, state ? t('raidUi.you') : undefined)
  }

  function resultsScreen(rec: StageRecord, late: boolean): void {
    stopTimers()
    saveRaid()
    const s = state!
    const n = s.results.length
    const day = standings(s, n - 1)
    const pos = day.findIndex((x) => x.who === 'you') + 1
    const head = el('h3', 'raid-day', tf('raidUi.stageDone', { n: String(n) }))
    const lines = el('div')
    lines.append(el('p', 'readout-line', tf('raidUi.stageTime', { time: clock(rec.time), pos: ordinal(pos), n: String(day.length) })))
    if (late) lines.append(el('p', 'small hot-text', t('raidUi.towed')))
    if (!rec.stops.length) lines.append(el('p', 'small', t('raidUi.noStops')))
    else {
      const stops = el('ul', 'raid-log')
      for (const st of rec.stops) stops.append(el('li', 'hot-text', stopText(st)))
      lines.append(stops)
    }
    for (const n of rec.iceNotes ?? []) lines.append(el('p', 'small warm-text', iceNoteText(n)))
    if (rec.limped) lines.append(el('p', 'small hot-text', t('raidUi.limped')))
    const next = button(t(s.phase === 'done' ? 'raidUi.toFinal' : 'raidUi.toBivouac'), 'btn start-btn')
    next.addEventListener('click', () => (s.phase === 'done' ? finalScreen() : bivouacScreen()))
    show(
      head, lines,
      el('h4', 'raid-sub', t('raidUi.stageTable')), standingsTable(day, rec),
      el('h4', 'raid-sub', t('raidUi.overallTable')), standingsTable(standings(s), null),
      next,
    )
    focusHead(head)
  }

  // ── 5. The bivouac ──

  function bivouacScreen(): void {
    stopTimers()
    const s = state!
    // The Long One's halfway rest day (plan PR 13): a whole day in the bivouac.
    const rest = isRestDay(s)
    const head = el('h3', 'raid-day', rest ? t('raidUi.restDay') : tf('raidUi.bivouac', { n: String(s.stage) }))
    const jobs = bivouacJobs(s)
    const picked = new Set<Job>()
    const hoursLine = el('p', 'readout-line')
    const hoursBar = el('div', 'live-progress')
    const hoursFill = el('div', 'live-fill')
    hoursBar.append(hoursFill)
    const sparesLine = el('p', 'small')
    const moneyLine = el('p', 'small')
    const inCareer = s.entry.budget !== undefined
    const list = el('ul', 'job-list')
    const rows = jobs.map((job) => {
      const li = el('li')
      const b = button('', 'fix-btn job-btn')
      const what = el('span', 'fix-what', `${t(JOBS[job.kind].name)}: ${partName(job.part, job.index)}`)
      const meta = el('span', 'fix-where')
      b.append(what, meta)
      b.addEventListener('click', () => {
        if (picked.has(job)) picked.delete(job)
        else {
          for (const other of picked) if (other.part === job.part && other.index === job.index) picked.delete(other)
          picked.add(job)
        }
        sync()
      })
      li.append(b)
      list.append(li)
      return { job, b, meta }
    })
    function sync(): void {
      const chosen = [...picked]
      const used = chosen.reduce((sum, j) => sum + j.hours, 0)
      hoursLine.textContent = tf('raidUi.hoursUsed', { used: num(used, 2).replace(/\.?0+$/, ''), total: num(bivouacHours(s)) })
      hoursFill.style.width = `${Math.min(100, (used / bivouacHours(s)) * 100)}%`
      const left = { ...s.spares }
      for (const j of chosen) if (j.spare) left[j.spare]--
      sparesLine.textContent = tf('raidUi.sparesLine', { list: sparesList(left) })
      const cashLeft = partsMoney(s) - chosen.reduce((sum, j) => sum + j.cost, 0)
      moneyLine.textContent = inCareer
        ? tf('raidUi.moneyCareer', { left: money(cashLeft) })
        : tf('raidUi.moneyLine', { left: money(cashLeft), total: money(partsBudget(s)) })
      for (const { job, b, meta } of rows) {
        const on = picked.has(job)
        b.setAttribute('aria-pressed', String(on))
        const others = chosen.filter((j) => j !== job && !(j.part === job.part && j.index === job.index))
        const problem = on ? null : checkJobs(s, [...others, job])
        b.disabled = problem !== null
        const hours = num(job.hours, 2).replace(/\.?0+$/, '')
        let text = isCondPart(job.part)
          ? tf('raidUi.condJobLine', { hours, pct: num(job.damage * 100), after: num(job.after * 100), state: t(`raidUi.state.${job.part}` as StringKey) })
          : tf('raidUi.jobLine', { hours, pct: num(job.damage * 100), after: num(job.after * 100) })
        if (job.spare) text += tf('raidUi.jobSpare', { spare: t(`raidUi.spare.${job.spare}` as StringKey) })
        if (job.cost > 0) text += tf('raidUi.jobCost', { n: money(job.cost) })
        if (problem?.kind === 'spare') text = tf('raidUi.jobNoSpare', { spare: t(`raidUi.spare.${problem.spare}` as StringKey) })
        if (problem?.kind === 'hours') text = `${text} · ${t('raidUi.jobNoHours')}`
        if (problem?.kind === 'money') text = `${text} · ${t('raidUi.jobNoMoney')}`
        meta.textContent = text
      }
    }
    const done = button(t('raidUi.doneNight'), 'btn start-btn')
    done.addEventListener('click', () => {
      doJobs(s, [...picked])
      morningScreen()
    })
    sync()
    show(
      head,
      el('p', 'small', tf(rest ? 'raidUi.restDayLead' : 'raidUi.bivouacLead', { hours: num(bivouacHours(s)) })),
      hoursLine, hoursBar, sparesLine, moneyLine,
      el('p', 'small', t('raidUi.slowWearNote')),
      jobs.length ? list : el('p', 'small', t('raidUi.noJobs')),
      done, retireButton(),
    )
    focusHead(head)
  }

  // ── 6. Final results ──

  function finalScreen(): void {
    stopTimers()
    const s = state!
    const table = standings(s)
    const pos = table.findIndex((x) => x.who === 'you') + 1
    const mine = table[pos - 1]!.time
    const head = el('h3', 'raid-day', tf('raidUi.final', { raid: t(raidOf(s).name) }))
    const inCareer = career?.on() ?? false
    const again = button(t(inCareer ? 'raidUi.toGarage' : 'raidUi.again'), 'btn start-btn')
    again.addEventListener('click', () => {
      if (inCareer) career!.finish(s, false)
      entryScreen()
    })
    show(head, el('p', 'readout-line', tf('raidUi.finalPlace', { pos: ordinal(pos), n: String(table.length), time: clock(mine) })), standingsTable(table, null), again)
    focusHead(head)
  }

  // A new class or part on the build screen changes what the entry screen shows.
  store.onChange(() => {
    if (!state) entryScreen()
  })

  career?.register((next) => {
    stopTimers()
    run = null
    state = next
    raidId = next.entry.raid
    driver = next.entry.driver
    morningScreen()
  })

  // Back to where the saved raid was: the morning, the bivouac, or the final results.
  if (saves?.raid) {
    restoring = true
    state = saves.raid
    raidId = state.entry.raid
    driver = state.entry.driver
    if (state.phase === 'morning') morningScreen()
    else if (state.phase === 'bivouac') bivouacScreen()
    else finalScreen()
    restoring = false
  } else entryScreen()
  return box
}
