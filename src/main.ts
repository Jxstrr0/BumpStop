/**
 * Bump Stop's entry point. It opens the garage slot from last time (plan
 * PR 8), then shows one screen: the "roadbook" look (plan PR 0) with the
 * career (plan PR 9), the build screen (plan PR 3), the shop's three rigs
 * and the report (plan PR 4), which test the truck, the raids (plan PR 7),
 * which race it, and the saves and backups. Then it hides the loading screen.
 */
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/big-shoulders/latin-700.css'
import '@fontsource/big-shoulders/latin-800.css'
import '@fontsource/overpass-mono/latin-400.css'
import '@fontsource/overpass-mono/latin-600.css'
import './style.css'
import { t } from './data/strings'
import { buildPanel } from './ui/buildScreen'
import { careerPanel } from './ui/career'
import { el } from './ui/dom'
import { openGarage, type Garage } from './ui/garage'
import { bindLoadingScreen } from './ui/loading'
import { roadbookStrip } from './ui/preview'
import { raidPanel } from './ui/raid'
import { backupReminder, savesPanel } from './ui/saves'
import { shopPanel } from './ui/shop'

const loading = bindLoadingScreen()

/** The studio credit line and version (a studio piece: Space Grotesk, plain link). */
function footer(): HTMLElement {
  const foot = el('footer', 'foot')
  const studio = el('a', 'studio', t('footer.studio'))
  studio.href = 'https://longlight.games/'
  foot.append('© 2026 Kelbo / ', studio, el('br'), `v${__GAME_VERSION__} · ${__BUILD_SHA__} · ${__BUILD_DATE__}`)
  return foot
}

function loopPanel(): HTMLElement {
  const box = el('section', 'panel')
  box.append(el('h2', '', t('loop.title')))
  const list = el('ol', 'loop')
  const steps = [
    ['loop.build', 'loop.buildText'],
    ['loop.break', 'loop.breakText'],
    ['loop.tune', 'loop.tuneText'],
    ['loop.prove', 'loop.proveText'],
  ] as const
  for (const [name, text] of steps) {
    const li = el('li')
    li.append(el('strong', '', t(name)), el('span', '', t(text)))
    list.append(li)
  }
  box.append(list)
  return box
}

function gameScreen(app: HTMLElement, garage: Garage): void {
  const head = el('header', 'title')
  const h1 = el('h1')
  h1.append(el('span', 'hi', t('game.name')))
  head.append(el('p', 'kicker', t('preview.kicker')), h1, el('p', 'tagline', t('game.tagline')))
  const store = garage.store
  const reminder = backupReminder(garage)
  // The career goes first: it sets the bench (the build screen's truck and year) before the build screen draws.
  const career = careerPanel(store, garage.career)
  app.append(
    head,
    ...(reminder ? [reminder] : []),
    loopPanel(),
    career.element,
    buildPanel(store),
    shopPanel(store, garage.shop),
    raidPanel(store, garage.raid, career.raid),
    savesPanel(garage),
    roadbookStrip(),
    el('p', 'note', t('preview.note')),
    footer(),
  )
}

async function boot(): Promise<void> {
  try {
    const app = document.getElementById('app')
    if (!app) throw new Error('No #app element')
    loading.progress(0.4)
    const garage = await openGarage()
    loading.progress(0.6)
    gameScreen(app, garage)
    loading.done()
  } catch (err) {
    console.error(err)
    loading.fail(t('boot.failed'))
  }
}

void boot()
