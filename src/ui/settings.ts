/**
 * The settings panel (plan PR 12): graphics and offline play.
 *
 * - Graphics: Auto, Lite, Full or Ultra (`src/render/tiers.ts`). Under the
 *   buttons, a line says what the 3D is drawing at now, so the player can
 *   see Auto step down.
 * - Works offline: whether this copy of the game opens with no signal
 *   (`src/pwa/register.ts`).
 */
import { TIERS, type GraphicsChoice } from '../data/graphics'
import { t, tf, type StringKey } from '../data/strings'
import { offlineState } from '../pwa/register'
import { currentTier, graphicsChoice, onTierChange, setGraphicsChoice, tierPinned } from '../render/tiers'
import { el } from './dom'

const CHOICES: readonly GraphicsChoice[] = ['auto', 'lite', 'full', 'ultra']

export function settingsPanel(): HTMLElement {
  const box = el('section', 'panel settings')
  box.append(el('h2', '', t('settings.title')))

  // --- Graphics ---
  const gHead = el('h3', '', t('graphics.title'))
  const gLead = el('p', 'small', t('graphics.lead'))
  const row = el('div', 'btn-row chip-row')
  row.setAttribute('role', 'group')
  row.setAttribute('aria-label', t('graphics.title'))
  const buttons = CHOICES.map((c) => {
    const b = el('button', 'btn chip-btn', t(`graphics.${c}` as StringKey))
    b.type = 'button'
    b.addEventListener('click', () => {
      setGraphicsChoice(c)
      show()
    })
    row.append(b)
    return b
  })
  const now = el('p', 'small')
  now.setAttribute('aria-live', 'polite')
  // Smooth edges are set when a 3D view is made: say so when a pick changes them.
  const startAntialias = TIERS[currentTier()].antialias
  const reloadNote = el('p', 'small', t('graphics.reload'))

  function show(): void {
    const choice = graphicsChoice()
    CHOICES.forEach((c, i) => buttons[i]!.setAttribute('aria-pressed', String(c === choice)))
    const tier = t(`graphics.${currentTier()}` as StringKey)
    now.textContent = tierPinned()
      ? tf('graphics.pinned', { tier })
      : choice === 'auto'
        ? tf('graphics.nowAuto', { tier })
        : tf('graphics.now', { tier })
    reloadNote.hidden = TIERS[currentTier()].antialias === startAntialias
  }
  onTierChange(show)
  show()

  const tiers = el('ul', 'small tier-list')
  for (const id of ['lite', 'full', 'ultra'] as const) {
    const li = el('li')
    li.append(el('strong', '', t(`graphics.${id}`)), ' ', t(`graphics.${id}Text`))
    tiers.append(li)
  }

  // --- Offline ---
  const oHead = el('h3', '', t('offline.title'))
  const oLine = el('p', 'small', t(`offline.${offlineState()}`))

  // Credits (plan PR 13): who made it and what it's made with. The full list is CREDITS.md.
  const cHead = el('h3', '', t('credits.title'))
  const credits = el('ul', 'small credit-list')
  for (const key of ['credits.made', 'credits.fonts', 'credits.code', 'credits.sound'] as const) credits.append(el('li', '', t(key)))
  box.append(gHead, gLead, row, now, reloadNote, tiers, oHead, oLine, cHead, credits)
  return box
}
