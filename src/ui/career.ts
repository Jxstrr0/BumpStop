/**
 * The career screens (plan PR 9b): the garage's panel at the top of the
 * game, once a career is started in this slot.
 *
 * - **The status line:** the date, the money, the reputation and the sponsor.
 * - **The next raid** and the garage's job for it: pick a privateer's
 *   contract, enter your own truck, or sit it out. A contract truck is built
 *   on the build screen under the privateer's budget, then handed over: the
 *   privateer races it here, a stage at a time, and the results card shows
 *   what it paid. Your own entry hands over to the Raids panel below, which
 *   comes back here when the raid ends.
 * - **Your truck:** buy one, sell it, and (when broke) sell its parts down.
 *   Upgrades happen on the build screen, with "Buy these parts".
 * - **The shop:** crew and tools.
 * - **News:** results, winners, who copied whom, new parts, sponsors.
 *
 * - **The first-job guide** (plan PR 11b, `src/ui/tutorial.ts`): on the
 *   career's first raid, a list of steps at the top walks through the job.
 * - **The hall of fame** (after 1.2, `src/ui/hall.ts`): "The career so far"
 *   at the foot of the panel, the Hall of fame once 2025 is done. This
 *   panel also tells photo mode where the career's album is (`album.ts`).
 *
 * The career's numbers and rules are all in `src/sim/career.ts`; this file
 * only shows them and calls it. The build screen is locked to the career's
 * truck and year through the build store's bench (`setBench`).
 */
import { CALENDAR, CAREER, CLASS_MONEY, SPONSORS, TEAMS, TIERS, UPGRADES, type Tier } from '../data/career'
import { CLASSES, type ClassId } from '../data/classes'
import type { TruckBuild } from '../data/kit'
import { SLOTS } from '../data/parts'
import { DRIVER_IDS, DRIVERS, RAIDS, type DriverId } from '../data/raids'
import { t, tf, type StringKey } from '../data/strings'
import { changeCost, checkBuild, findPart, partIn, shopRules, stockBuild, tidyBuild, type BuildProblem } from '../sim/build'
import {
  buyTruck, buyUpgrade, cheapestBuild, contractProblems, contractRaid, contractRules, discountOf, driveAutoStage, driverFee, driverName,
  dropContract, entryFee, entryProblems, enterOwn, eventDays, fitOwn, isBroke, longOneRoad, newCareer, nextEvent, offers, ownRules,
  sellTruck, setContractBuild, settle, sponsorName, sponsorOf, sponsorPay, takeContract, truckPrice, truckValue, upgradeProblem,
  type CareerState, type Contract, type EntryProblem, type LongOneStory, type NewsItem, type Settlement,
} from '../sim/career'
import { ownLog } from '../sim/logbook'
import { raidOf, standings, type RaidState } from '../sim/raid'
import { keepPhoto } from '../persist/album'
import type { SlotNo } from '../persist/slots'
import { setAlbumHook } from './album'
import { hallBlock, type HallBlock } from './hall'
import type { GlossaryId } from '../data/glossary'
import type { BuildStore } from './buildStore'
import { el, num } from './dom'
import { ordinal, raidTable, type RaidCareer } from './raid'
import { farewellText, logbookBlock, oldTrucksBlock } from './logbook'
import { firstJobGuide } from './tutorial'

/** What the career needs from the garage: the saved career, and who to tell when it changes. */
export interface CareerSaves {
  career: CareerState | null
  onCareer(career: CareerState | null): void
  /** The slot the career is in: its photo album is kept under it. */
  slot?: SlotNo
}

// ── Words for the career ──

/** "10 May" for a day of the year. */
export function dateText(year: number, day: number): string {
  const d = new Date(Date.UTC(year, 0, day))
  return `${d.getUTCDate()} ${d.toLocaleDateString('en-CA', { month: 'long', timeZone: 'UTC' })}`
}

const money = (n: number) => tf('career.money', { n: num(Math.round(n)) })
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : `+${money(n)}`)
const className = (cls: ClassId) => t(CLASSES.find((c) => c.id === cls)!.name)
const tierName = (tier: Tier) => t(`career.tier.${tier}` as StringKey)

/** A rival's name from its id (`brannigan7`, `privateer31`), or "your truck". */
export function whoName(who: string, privateer?: number): string {
  if (who === 'you') return privateer !== undefined ? tf('career.privateerTruck', { n: String(privateer) }) : t('raidUi.you')
  const n = who.replace(/^\D+/, '')
  const team = Object.values(TEAMS).find((x) => who.startsWith(x.id))
  return tf('raidUi.rivalName', { team: t(team ? team.name : 'team.privateer'), n })
}

/** The parts the finale names on the winning truck. */
const FINALE_SLOTS = ['frame', 'frontSusp', 'rearSusp', 'dampers', 'bumpStops', 'tires', 'engine'] as const

function partList(ids: readonly string[]): string {
  return ids.map((id) => {
    const p = findPart(id)
    return p ? t(p.name).toLowerCase() : id
  }).join(', ')
}

/** A news line in words. `career` names this career's sponsor (each career has its own); without one, the first of the pair. */
export function newsText(n: NewsItem, career?: CareerState): string {
  switch (n.kind) {
    case 'result': {
      const who = t(n.job === 'own' ? 'career.news.yours' : 'career.news.contract')
      const place = n.pos === null ? t('career.news.retired') : tf('career.news.place', { pos: ordinal(n.pos), of: String(n.of) })
      return tf('career.news.result', { raid: t(RAIDS[n.raid].name), who, cls: className(n.cls).toLowerCase(), place, money: signed(n.money), rep: String(n.rep) })
    }
    case 'winner':
      return tf('career.news.winner', { raid: t(RAIDS[n.raid].name), cls: className(n.cls).toLowerCase(), who: whoName(n.who) })
    case 'copied': {
      const slots = n.slots.map((s) => t(`slot.${s}` as StringKey).toLowerCase()).join(', ')
      return tf(n.from === 'you' ? 'career.news.copiedYou' : 'career.news.copied', {
        team: t(TEAMS[n.team].name), slots, cls: className(n.cls).toLowerCase(), from: whoName(n.from),
      })
    }
    case 'newParts':
      return tf('career.news.newParts', { year: String(n.year), parts: partList(n.parts) })
    case 'sponsor': {
      const s = SPONSORS[n.sponsor]
      return s ? tf('career.news.sponsor', { who: t(career ? sponsorName(career, s) : s.names[0]!), pay: money(s.pay) }) : ''
    }
    case 'broke':
      return t('career.news.broke')
    case 'longOne':
      return tf('career.news.longOne', { year: String(n.year) })
    case 'skipped':
      return tf('career.news.skipped', { raid: t(RAIDS[n.raid].name) })
  }
}

function buildProblemText(p: BuildProblem): string {
  switch (p.kind) {
    case 'tooHeavy':
      return tf('build.tooHeavyText', { by: num(p.by), limit: num(p.limit) })
    case 'tooLight':
      return tf('build.tooLightText', { by: num(p.by), limit: num(p.limit) })
    case 'overBudget':
      return tf('build.overBudgetText', { by: num(p.by), budget: num(p.budget) })
    case 'notYet':
      return tf('career.notYet', { slot: t(`slot.${p.slot}` as StringKey), year: String(p.year) })
  }
}

function entryProblemText(p: EntryProblem): string {
  switch (p.kind) {
    case 'busy':
      return t('career.why.busy')
    case 'noTruck':
      return t('career.why.noTruck')
    case 'broke':
      return t('career.why.broke')
    case 'rep':
      return tf('career.why.rep', { need: String(p.need) })
    case 'driverRep':
      return tf('career.why.driverRep', { need: String(p.need) })
    case 'money':
      return tf('career.why.money', { need: money(p.need) })
    case 'parts':
      return t('career.why.parts')
    case 'build':
      return p.problems.map(buildProblemText).join(' ')
  }
}

function button(text: string, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, text)
  b.type = 'button'
  return b
}

/** A button that asks "Sure?" first: tap twice within three seconds. */
function sureButton(text: string, sure: string, run: () => void, cls = 'btn small-btn'): HTMLButtonElement {
  const b = button(text, cls)
  let armed = false
  let timer = 0
  b.addEventListener('click', () => {
    if (armed) {
      window.clearTimeout(timer)
      run()
      return
    }
    armed = true
    b.textContent = sure
    timer = window.setTimeout(() => {
      armed = false
      b.textContent = text
    }, 3000)
  })
  return b
}

function sameParts(a: TruckBuild, b: TruckBuild): boolean {
  return a.cls === b.cls && SLOTS.every((s) => a.parts[s] === b.parts[s])
}

// ── The panel ──

export interface CareerPanel {
  element: HTMLElement
  /** Hand this to the Raids panel. */
  raid: RaidCareer
}

export function careerPanel(store: BuildStore, saves?: CareerSaves, showTerm: (id: GlossaryId) => void = () => {}): CareerPanel {
  const box = el('section', 'panel career')
  box.id = 'career'
  const body = el('div', 'career-body')
  const guide = firstJobGuide(showTerm)
  box.append(el('h2', '', t('career.title')), guide.element, body)

  let c: CareerState | null = saves?.career ?? null
  /** The raid panel's way in, once it registers. */
  let startRaid: ((s: RaidState) => void) | null = null
  /** The last raid's pay-out, shown until the player moves on. */
  let shown: { settlement: Settlement; table: HTMLElement | null } | null = null
  /** A contract raid being driven here, a stage at a time. */
  let driving: { state: RaidState; timer: number } | null = null
  /** Which truck the bench holds, so a new job puts its truck on and a reload keeps unbought changes. */
  let benchKey = ''
  let firstSync = true
  /** The driver picked for your own entry. */
  let driver: DriverId = 'veteran'
  /** The goodbye line after selling a truck, shown until the next change. */
  let farewell = ''

  const save = () => saves?.onCareer(c ? structuredClone(c) : null)
  /** The hall of fame at the foot of the panel, drawn again with the rest. */
  let hall: HallBlock | null = null

  // Photo mode keeps shots in this career's album (`album.ts`), when there's a career and a slot to keep them under.
  const slot = saves?.slot
  setAlbumHook(slot === undefined ? null : {
    caption(where) {
      if (!c) return null
      const place = where === 'raid' && c.job?.kind === 'own' ? t(RAIDS[nextEvent(c).raid].name) : t(where === 'raid' ? 'album.raid' : 'album.track')
      return tf('album.caption', { where: place, year: String(c.year) })
    },
    keep(picture, caption) {
      if (!c) return Promise.resolve('failed')
      return keepPhoto({ slot, career: c.seed, year: c.year, caption, takenAt: Date.now(), picture })
    },
  })

  // ── The bench: the build screen follows the career's job ──

  function syncBench(): void {
    if (!c) {
      if (store.bench()) store.setBench(null)
      benchKey = ''
      return
    }
    const career = c
    const job = career.job
    if (job?.kind === 'contract') {
      const key = `contract:${job.contract.id}`
      store.setBench({
        kind: 'contract',
        cls: job.contract.cls,
        year: career.year,
        rules: () => contractRules(career, job.contract),
        label: tf('career.benchContract', { n: String(job.contract.number), cls: className(job.contract.cls).toLowerCase(), budget: money(job.contract.budget) }),
        reset: () => stockBuild(job.contract.cls),
      }, key !== benchKey ? job.build : undefined)
      benchKey = key
    } else if (career.own) {
      const own = career.own
      const key = `own:${own.cls}`
      // At page load, keep the bench as saved (it may hold parts you haven't bought yet).
      const keep = firstSync && store.builds()[own.cls].cls === own.cls
      store.setBench({
        kind: 'own',
        cls: own.cls,
        year: career.year,
        rules: () => ownRules(career),
        label: tf('career.benchOwn', { cls: className(own.cls).toLowerCase() }),
        reset: () => career.own ?? own,
        note: (b) => ownNote(career, b),
        log: () => ownLog(career),
      }, key !== benchKey && !keep ? own : undefined)
      benchKey = key
    } else {
      store.setBench({
        kind: 'shop',
        cls: null,
        year: career.year,
        rules: (b) => shopRules(b.cls, career.year),
        label: t('career.benchShop'),
      })
      benchKey = 'shop'
    }
    firstSync = false
  }

  /** Under the money line on the build screen: what the changes to your truck cost, and the button to buy them. */
  function ownNote(career: CareerState, b: TruckBuild): { text: string; button?: { text: string; run(): void } } | null {
    if (!career.own || sameParts(career.own, b)) return null
    if (career.job?.kind === 'own') return { text: t('career.partsLocked') }
    const cost = changeCost(career.own, b, CAREER.resale, discountOf(career))
    const problems = checkBuild(b, ownRules(career)).filter((p) => p.kind === 'overBudget' || p.kind === 'notYet')
    if (problems.length) return { text: t('career.cantBuy') }
    return {
      text: cost >= 0 ? tf('career.buyText', { cost: money(cost) }) : tf('career.sellText', { cost: money(-cost) }),
      button: {
        text: t(cost >= 0 ? 'career.buy' : 'career.sell'),
        run: () => {
          fitOwn(career, store.build())
          save()
          store.setBench(store.bench(), career.own!)
          render()
        },
      },
    }
  }

  // Changes on the bench: a contract truck is kept with the contract; settings on your own truck are free, so they're kept too.
  store.onChange((change) => {
    if (!c || change === 'bench' || change === 'class' || change === 'year') return
    const b = store.build()
    if (c.job?.kind === 'contract' && b.cls === c.job.contract.cls) {
      setContractBuild(c, b)
      save()
      renderJob()
    } else if (c.own && !c.job && sameParts(c.own, b)) {
      c.own = tidyBuild(b)
      save()
      renderJob()
    } else if (c.own) renderJob()
  })

  // ── Not started ──

  function startScreen(): void {
    const start = button(t('career.start'), 'btn start-btn')
    start.addEventListener('click', () => {
      c = newCareer(Date.now() >>> 0)
      save()
      syncBench()
      render()
      box.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    body.replaceChildren(el('p', 'lead', t('career.lead')), el('p', 'small', t('career.startNote')), start)
  }

  // ── The status line ──

  function statusBlock(career: CareerState): HTMLElement {
    const wrap = el('div', 'career-status')
    const line = el('p', 'readout-line')
    line.append(
      el('span', 'label', dateText(career.year, career.day)), ' ', String(career.year), ' · ',
      el('span', `chip ${isBroke(career) ? 'hot' : 'cool'}`, money(career.money)), ' · ',
      tf('career.rep', { n: String(career.rep) }),
    )
    wrap.append(line)
    const sponsor = sponsorOf(career)
    wrap.append(el('p', 'small', sponsor
      ? tf(sponsor.discount ? 'career.sponsorWorks' : 'career.sponsor', { who: t(sponsorName(career, sponsor)), pay: money(sponsor.pay), off: num(sponsor.discount * 100) })
      : t('career.noSponsor')))
    wrap.append(roadBlock(career))
    if (isBroke(career)) {
      const warn = el('div', 'career-broke')
      warn.append(el('p', 'hot-text', t('career.brokeTitle')), el('p', 'small', t('career.brokeText')))
      wrap.append(warn)
    }
    return wrap
  }

  /**
   * The road to the Long One (plan PR 13): the career's goal, always in
   * sight. A bar of reputation until your own truck may enter, then a line
   * saying it's open, then the years you won it.
   */
  function roadBlock(career: CareerState): HTMLElement {
    const road = longOneRoad(career)
    const wrap = el('div', 'career-road')
    if (road.won.length) {
      wrap.append(el('p', 'small', tf('career.longOneWins', { years: road.won.join(', ') })))
    } else if (road.open) {
      wrap.append(el('p', 'small cool-text', t('career.roadOpen')))
    } else {
      wrap.append(el('p', 'small', tf('career.road', { need: String(road.need), rep: String(road.rep) })))
      // The words above carry the numbers; the bar is just a picture of them.
      const bar = el('div', 'live-progress')
      bar.setAttribute('aria-hidden', 'true')
      const fill = el('div', 'live-fill')
      fill.style.width = `${Math.min(100, (road.rep / road.need) * 100)}%`
      bar.append(fill)
      wrap.append(bar)
    }
    return wrap
  }

  // ── The next raid and the job ──

  const jobHolder = el('div', 'career-job')

  function renderJob(): void {
    guide.update(c, shown?.settlement ?? null)
    if (!c || driving) return
    const career = c
    jobHolder.replaceChildren()
    if (shown) {
      jobHolder.append(resultsCard(shown.settlement, shown.table))
      return
    }
    const e = nextEvent(career)
    const raid = RAIDS[e.raid]
    const head = el('h3', 'raid-sub', tf('career.next', { raid: t(raid.name) }))
    const facts = el('p', 'small', tf('career.nextFacts', {
      date: dateText(career.year, e.day), stages: String(raid.stages.length), days: String(eventDays(e)), tier: tierName(e.tier),
    }))
    jobHolder.append(head, facts, el('p', 'small', t(raid.text)))
    const job = career.job
    if (job?.kind === 'contract') jobHolder.append(contractCard(career, job.contract))
    else if (job?.kind === 'own') {
      const go = button(t('career.toRaid'))
      go.addEventListener('click', () => document.getElementById('raid')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      jobHolder.append(el('p', 'small', t('career.raidOn')), go)
    } else {
      jobHolder.append(offersBlock(career), ownEntryBlock(career), skipBlock(career))
    }
  }

  function contractLine(o: Contract): string {
    return tf('career.offer', {
      n: String(o.number), cls: className(o.cls).toLowerCase(), budget: money(o.budget), fee: money(o.fee),
      driver: c ? t(driverName(c, o.driver)) : t(DRIVERS[o.driver].name), win: money(o.bonus.win), podium: money(o.bonus.podium), finish: money(o.bonus.finish),
    })
  }

  function offersBlock(career: CareerState): HTMLElement {
    const wrap = el('div')
    wrap.append(el('h4', 'raid-sub', t('career.offers')), el('p', 'small', t('career.offersLead')))
    const list = el('ul', 'job-list')
    for (const o of offers(career)) {
      const li = el('li')
      const b = button('', 'fix-btn job-btn')
      b.append(el('span', 'fix-what', tf('career.offerHead', { n: String(o.number), cls: className(o.cls) })), el('span', 'fix-where', contractLine(o)))
      if (career.rep < o.rep) {
        b.disabled = true
        b.append(el('span', 'fix-where', tf('career.offerRep', { n: String(o.rep) })))
      }
      b.addEventListener('click', () => {
        takeContract(career, o)
        save()
        syncBench()
        render()
        document.querySelector('.panel.build')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      li.append(b)
      list.append(li)
    }
    wrap.append(list)
    return wrap
  }

  function contractCard(career: CareerState, o: Contract): HTMLElement {
    const card = el('div', 'raid-card')
    card.append(el('h4', 'raid-sub', tf('career.onBench', { n: String(o.number), cls: className(o.cls).toLowerCase() })), el('p', 'small', contractLine(o)))
    const problems = contractProblems(career)
    if (problems.length) {
      const ul = el('ul', 'problems')
      for (const p of problems) ul.append(el('li', '', buildProblemText(p)))
      card.append(el('p', 'small', t('career.buildIt')), ul)
    } else card.append(el('p', 'small cool-text', t('career.readyToHand')))
    const hand = button(t('career.handOver'), 'btn start-btn')
    hand.disabled = problems.length > 0
    hand.addEventListener('click', () => driveContract(career, o))
    const giveBack = sureButton(t('career.giveBack'), t('career.giveBackSure'), () => {
      dropContract(career)
      save()
      syncBench()
      render()
    })
    card.append(hand, giveBack)
    return card
  }

  /** The privateer races the truck: a stage at a time, so the page keeps drawing. */
  function driveContract(career: CareerState, o: Contract): void {
    const state = contractRaid(career)
    const total = raidOf(state).stages.length
    const line = el('p', 'readout-line')
    line.setAttribute('aria-live', 'polite')
    const bar = el('div', 'live-progress')
    const fill = el('div', 'live-fill')
    bar.append(fill)
    jobHolder.replaceChildren(el('h3', 'raid-sub', tf('career.racing', { n: String(o.number), raid: t(raidOf(state).name) })), line, bar)
    driving = { state, timer: 0 }
    const step = () => {
      line.textContent = tf('career.racingDay', { n: String(Math.min(total, state.stage + 1)), total: String(total) })
      fill.style.width = `${(state.stage / total) * 100}%`
      driving!.timer = window.setTimeout(() => {
        if (!driveAutoStage(state)) {
          step()
          return
        }
        const table = raidTable(standings(state), null, state.entry.field, whoName('you', o.number))
        driving = null
        finished(settle(career, state), table)
      }, 30)
    }
    step()
  }

  function ownEntryBlock(career: CareerState): HTMLElement {
    const wrap = el('div')
    wrap.append(el('h4', 'raid-sub', t('career.ownEntry')))
    if (!career.own) {
      wrap.append(el('p', 'small', t('career.why.noTruck')))
      return wrap
    }
    const cls = career.own.cls
    const tier = nextEvent(career).tier
    const row = el('div', 'btn-row')
    for (const id of DRIVER_IDS) {
      const b = button(t(driverName(career, id)))
      b.setAttribute('aria-pressed', String(id === driver))
      b.addEventListener('click', () => {
        driver = id
        renderJob()
      })
      row.append(b)
    }
    const fees = entryFee(career, cls) + driverFee(career, driver, cls)
    const pay = sponsorPay(career, cls)
    const lines = el('div')
    lines.append(
      el('p', 'small', tf('driver.about', { trade: t(DRIVERS[driver].name), text: t(DRIVERS[driver].text) })),
      el('p', 'small', tf('career.fees', { entry: money(entryFee(career, cls)), driver: money(driverFee(career, driver, cls)) })),
    )
    if (pay > 0) lines.append(el('p', 'small', tf('career.sponsorPays', { pay: money(pay) })))
    lines.append(el('p', 'readout-line', tf('career.entryTotal', { n: money(fees - pay) })))
    const prizes = TIERS[tier].prizes.map((p) => money(p * CLASS_MONEY[cls])).join(' · ')
    lines.append(el('p', 'small', tf('career.prizes', { list: prizes })))
    // A winter raid on plain tires is allowed, just slower: say so before the fees are paid.
    if (RAIDS[nextEvent(career).raid].season === 'winter' && !partIn(store.build(), 'tires').studded) {
      lines.append(el('p', 'small warm-text', t('raidUi.winterNoStuds')))
    }
    const problems = entryProblems(career, driver, store.build())
    const enter = button(t('career.enter'), 'btn start-btn')
    enter.disabled = problems.length > 0 || !startRaid
    if (problems.length) {
      const ul = el('ul', 'problems')
      for (const p of problems) ul.append(el('li', '', entryProblemText(p)))
      lines.append(ul)
    }
    enter.addEventListener('click', () => {
      const state = enterOwn(career, driver, store.build())
      save()
      render()
      startRaid?.(state)
    })
    wrap.append(el('p', 'small', t('career.pickDriver')), row, lines, enter)
    return wrap
  }

  function skipBlock(career: CareerState): HTMLElement {
    const wrap = el('div', 'career-skip')
    wrap.append(sureButton(t('career.skip'), t('career.skipSure'), () => finished(settle(career, null), null)))
    return wrap
  }

  function finished(settlement: Settlement, table: HTMLElement | null): void {
    shown = { settlement, table }
    save()
    syncBench()
    render()
    box.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function resultsCard(s: Settlement, table: HTMLElement | null): HTMLElement {
    const card = el('div', 'raid-card career-results')
    const head = el('h3', 'raid-sub', tf('career.resultsHead', { raid: t(RAIDS[s.raid].name) }))
    card.append(head)
    if (s.careerEnd) card.append(endBlock())
    if (s.story) card.append(finaleBlock(s.story))
    else if (s.wonLongOne) card.append(el('p', 'career-win', t('career.wonLongOne')))
    if (s.job) {
      card.append(el('p', 'readout-line', s.pos === null ? t('career.retired') : tf('career.place', { pos: ordinal(s.pos), of: String(s.of) })))
      const ul = el('ul', 'raid-list')
      const add = (key: StringKey, n: number) => {
        if (n !== 0) ul.append(el('li', 'small', tf(key, { n: money(n) })))
      }
      add('career.paid.fee', s.fee)
      add('career.paid.bonus', s.bonus)
      add('career.paid.prize', s.prize)
      add('career.paid.repairs', s.repairs)
      add('career.paid.spares', s.spares)
      add('career.paid.bivouac', s.bivouac)
      ul.append(el('li', 'readout-line', tf('career.paid.total', { n: signed(s.money) })))
      ul.append(el('li', 'small', tf('career.paid.rep', { n: String(s.rep) })))
      card.append(ul)
      if (table) card.append(table)
    } else card.append(el('p', 'small', t('career.satOut')))
    const winners = el('ul', 'raid-list')
    for (const cls of CLASSES) {
      const who = s.winners[cls.id]
      if (who) winners.append(el('li', 'small', tf('career.winnerLine', { cls: t(cls.name), who: whoName(who) })))
    }
    card.append(el('h4', 'raid-sub', t('career.winners')), winners)
    if (s.copies.length) {
      const list = el('ul', 'raid-list')
      for (const n of s.copies) list.append(el('li', 'small', newsText(n)))
      card.append(el('h4', 'raid-sub', t('career.copies')), list)
    }
    const next = button(t('career.onward'), 'btn start-btn')
    next.addEventListener('click', () => {
      shown = null
      render()
    })
    card.append(next)
    return card
  }

  /** The end of 2025: the career is over, and the hall of fame opens. */
  function endBlock(): HTMLElement {
    const wrap = el('section', 'career-finale career-end')
    wrap.setAttribute('aria-label', t('hall.endHead'))
    const go = button(t('hall.open'), 'btn start-btn')
    go.addEventListener('click', () => hall?.open())
    wrap.append(el('p', 'career-win', t('hall.endHead')), el('p', '', t('hall.endText')), go)
    return wrap
  }

  /** The finale (plan PR 13): the garage's first Long One win, and how it got there. */
  function finaleBlock(story: LongOneStory): HTMLElement {
    const wrap = el('section', 'career-finale')
    wrap.setAttribute('aria-label', t('career.finaleHead'))
    const s = story.stats
    wrap.append(
      el('p', 'career-win', t('career.finaleHead')),
      el('p', '', tf('career.finaleLead', {
        year: String(story.year), nth: ordinal(story.seasons), cls: className(story.cls).toLowerCase(), driver: c ? t(driverName(c, story.driver)) : t(DRIVERS[story.driver].name).toLowerCase(),
      })),
      el('p', 'small', tf('career.finaleRecord', { raids: String(s.raids), wins: String(s.wins), podiums: String(s.podiums), contracts: String(s.contracts) })),
      el('p', 'small', tf('career.finaleTruck', { parts: partList(FINALE_SLOTS.map((slot) => story.parts[slot])) })),
      el('p', 'small', t('career.finaleOn')),
    )
    return wrap
  }

  // ── Your truck ──

  function truckBlock(career: CareerState): HTMLElement {
    const wrap = el('div')
    wrap.append(el('h3', 'raid-sub', t('career.truck')))
    const own = career.own
    if (farewell) wrap.append(el('p', 'logbook-farewell', farewell))
    farewell = ''
    const old = oldTrucksBlock(career)
    if (!own) {
      wrap.append(el('p', 'small', t('career.noTruck')))
      const row = el('div', 'btn-row')
      for (const cls of CLASSES) {
        const price = truckPrice(career, cls.id)
        const b = button(tf('career.buyTruck', { cls: t(cls.name), price: money(price) }))
        b.disabled = career.money < price || career.job?.kind === 'own'
        b.addEventListener('click', () => {
          buyTruck(career, cls.id)
          save()
          syncBench()
          render()
        })
        row.append(b)
      }
      wrap.append(row)
      if (old) wrap.append(old)
      return wrap
    }
    wrap.append(el('p', 'small', tf('career.truckLine', { cls: className(own.cls), value: money(truckValue(own)) })))
    const log = logbookBlock(career)
    if (log) wrap.append(log)
    if (old) wrap.append(old)
    if (career.job?.kind === 'own') return wrap
    if (isBroke(career)) {
      const cheap = cheapestBuild(own, career.year)
      const back = -changeCost(own, cheap, CAREER.resale, discountOf(career))
      if (back > 0) {
        const b = button(tf('career.sellDown', { n: money(back) }))
        b.addEventListener('click', () => {
          fitOwn(career, cheap)
          save()
          store.setBench(store.bench(), career.own!)
          render()
        })
        wrap.append(b)
      }
    }
    wrap.append(sureButton(tf('career.sellTruck', { n: money(truckValue(own)) }), t('career.sellTruckSure'), () => {
      const sold = ownLog(career)
      sellTruck(career)
      if (sold) farewell = farewellText(sold)
      save()
      syncBench()
      render()
    }))
    return wrap
  }

  // ── The shop ──

  function shopBlock(career: CareerState): HTMLElement {
    const wrap = el('div')
    wrap.append(el('h3', 'raid-sub', t('career.shop')))
    const list = el('ul', 'job-list')
    for (const u of UPGRADES) {
      const problem = upgradeProblem(career, u.id)
      const li = el('li')
      const b = button('', 'fix-btn job-btn')
      const why = problem === 'owned' ? t('career.upgrade.owned')
        : problem === 'rep' ? tf('career.upgrade.rep', { n: String(u.rep) })
          : problem === 'needs' ? tf('career.upgrade.needs', { what: t(UPGRADES.find((x) => x.id === u.needs)!.name).toLowerCase() })
            : problem === 'money' || isBroke(career) ? tf('career.upgrade.cost', { n: money(u.cost) }) : tf('career.upgrade.buy', { n: money(u.cost) })
      b.append(el('span', 'fix-what', t(u.name)), el('span', 'fix-where', `${t(u.text)} ${why}`))
      b.disabled = problem !== null
      b.setAttribute('aria-pressed', String(problem === 'owned'))
      b.addEventListener('click', () => {
        buyUpgrade(career, u.id)
        save()
        render()
      })
      li.append(b)
      list.append(li)
    }
    wrap.append(list)
    return wrap
  }

  // ── News and the record ──

  function newsBlock(career: CareerState): HTMLElement {
    const wrap = el('div')
    wrap.append(el('h3', 'raid-sub', t('career.news')))
    const list = el('ul', 'raid-log')
    const items = career.news.filter((n) => n.kind !== 'winner').slice(0, 10)
    if (!items.length) list.append(el('li', 'small', t('career.noNews')))
    for (const n of items) list.append(el('li', 'small', `${n.year}: ${newsText(n, career)}`))
    const s = career.stats
    const first = career.firstLongOne
    if (first) wrap.append(el('p', 'small', tf('career.firstLongOne', { year: String(first.year), cls: className(first.cls).toLowerCase(), nth: ordinal(first.seasons) })))
    wrap.append(list, el('p', 'small', tf('career.record', { raids: String(s.raids), wins: String(s.wins), podiums: String(s.podiums), contracts: String(s.contracts) })))
    return wrap
  }

  function calendarBlock(career: CareerState): HTMLElement {
    const wrap = el('details', 'career-calendar')
    wrap.append(el('summary', '', tf('career.calendar', { year: String(career.year) })))
    const list = el('ol', 'raid-list')
    CALENDAR.forEach((e, k) => {
      const li = el('li', `small${k === career.next ? ' cool-text' : k < career.next ? ' done' : ''}`,
        tf('career.calendarLine', { date: dateText(career.year, e.day), raid: t(RAIDS[e.raid].name), stages: String(RAIDS[e.raid].stages.length), tier: tierName(e.tier), rep: String(TIERS[e.tier].rep) }))
      list.append(li)
    })
    wrap.append(list)
    return wrap
  }

  function render(): void {
    if (!c) {
      startScreen()
      return
    }
    renderJob()
    const wasOpen = hall?.element.open ?? false
    hall = hallBlock(c, { slot })
    body.replaceChildren(statusBlock(c), jobHolder, calendarBlock(c), truckBlock(c), shopBlock(c), newsBlock(c), hall.element)
    // Keep it open if it was (opening it draws it).
    if (wasOpen) hall.element.open = true
  }

  syncBench()
  render()

  return {
    element: box,
    raid: {
      on: () => c !== null,
      finish(state, retired) {
        if (!c || c.job?.kind !== 'own') return
        const table = retired ? null : raidTable(standings(state), null, state.entry.field)
        finished(settle(c, state, retired), table)
      },
      register(start) {
        startRaid = start
        renderJob()
      },
    },
  }
}
