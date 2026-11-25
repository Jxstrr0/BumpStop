/**
 * Bump Stop's entry point. For now it shows one screen: a preview of the
 * "roadbook" look (plan PR 0), then hides the loading screen. The ride sim
 * (plan PR 1) and the build screen (plan PR 3) replace it step by step.
 */
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/big-shoulders/latin-700.css'
import '@fontsource/big-shoulders/latin-800.css'
import '@fontsource/overpass-mono/latin-400.css'
import '@fontsource/overpass-mono/latin-600.css'
import './style.css'
import { CLASSES } from './data/classes'
import { t } from './data/strings'
import { el, num } from './ui/dom'
import { bindLoadingScreen } from './ui/loading'
import { roadbookStrip, tracePreview } from './ui/preview'

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

function classesPanel(): HTMLElement {
  const box = el('section', 'panel')
  box.append(el('h2', '', t('classes.title')))
  const grid = el('div', 'classes')
  for (const c of CLASSES) {
    const card = el('article', 'class-card')
    const weight = el('p', 'weight')
    weight.append(el('span', 'label', t('class.weight')), ` ${num(c.minMass)}–${num(c.maxMass)} kg`)
    card.append(el('h3', '', t(c.name)), el('p', '', t(c.blurb)), weight)
    grid.append(card)
  }
  box.append(grid)
  return box
}

function previewScreen(app: HTMLElement): void {
  const head = el('header', 'title')
  const h1 = el('h1')
  h1.append(el('span', 'hi', t('game.name')))
  head.append(el('p', 'kicker', t('preview.kicker')), h1, el('p', 'tagline', t('game.tagline')))
  app.append(
    head,
    loopPanel(),
    roadbookStrip(),
    tracePreview(),
    classesPanel(),
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
