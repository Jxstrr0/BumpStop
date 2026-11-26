/**
 * Bump Stop's entry point. For now it shows one screen: a preview of the
 * "roadbook" look (plan PR 0) with the build screen (plan PR 3) and the shop's
 * three rigs and the report (plan PR 4), which test the truck on it. Then it
 * hides the loading screen.
 */
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/big-shoulders/latin-700.css'
import '@fontsource/big-shoulders/latin-800.css'
import '@fontsource/overpass-mono/latin-400.css'
import '@fontsource/overpass-mono/latin-600.css'
import './style.css'
import { t } from './data/strings'
import { buildPanel } from './ui/buildScreen'
import { makeBuildStore } from './ui/buildStore'
import { el } from './ui/dom'
import { bindLoadingScreen } from './ui/loading'
import { roadbookStrip } from './ui/preview'
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

function previewScreen(app: HTMLElement): void {
  const head = el('header', 'title')
  const h1 = el('h1')
  h1.append(el('span', 'hi', t('game.name')))
  head.append(el('p', 'kicker', t('preview.kicker')), h1, el('p', 'tagline', t('game.tagline')))
  const store = makeBuildStore()
  app.append(
    head,
    loopPanel(),
    buildPanel(store),
    shopPanel(store),
    roadbookStrip(),
    el('p', 'note', t('preview.note')),
    footer(),
  )
}

try {
  const app = document.getElementById('app')
  if (!app) throw new Error('No #app element')
  loading.progress(0.6)
  previewScreen(app)
  loading.done()
} catch (err) {
  console.error(err)
  loading.fail(t('boot.failed'))
}
