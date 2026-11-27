/**
 * The settings panel (plan PR 12): graphics and offline play.
 *
 * - Graphics: Auto, Lite, Full or Ultra (`src/render/tiers.ts`). Under the
 *   buttons, a line says what the 3D is drawing at now, so the player can
 *   see Auto step down.
 * - Works offline: whether this copy of the game opens with no signal
 *   (`src/pwa/register.ts`).
 * - Co-driver (27 November 2026): the radio calls on a raid stage, On,
 *   Words only or Off, and their volume (`src/audio/radio.ts`).
 */
import { TIERS, type GraphicsChoice } from '../data/graphics'
import { RADIO_CREDIT } from '../data/radio'
import { RECORDINGS } from '../data/recordings'
import { getRadio, RADIO_MODES } from '../audio/radio'
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

  // --- Co-driver ---
  const radio = getRadio()
  const rHead = el('h3', '', t('radio.title'))
  const rLead = el('p', 'small', t('radio.lead'))
  const rRow = el('div', 'btn-row chip-row')
  rRow.setAttribute('role', 'group')
  rRow.setAttribute('aria-label', t('radio.title'))
  const rNote = el('p', 'small')
  rNote.setAttribute('aria-live', 'polite')
  // A browser with no sound only offers the words.
  const modes = radio.canPlay ? RADIO_MODES : RADIO_MODES.filter((m) => m !== 'on')
  const rButtons = modes.map((m) => {
    const b = el('button', 'btn chip-btn', t(`radio.${m}` as StringKey))
    b.type = 'button'
    b.addEventListener('click', () => {
      radio.setMode(m)
      showRadio()
    })
    rRow.append(b)
    return b
  })
  const volLabel = el('label', 'radio-volume')
  const volName = el('span', '', t('radio.volume'))
  const vol = el('input')
  vol.type = 'range'
  vol.min = '0'
  vol.max = '100'
  vol.step = '5'
  const volValue = el('span', 'radio-volume-value')
  volLabel.append(volName, vol, volValue)
  vol.addEventListener('input', () => {
    radio.setVolume(Number(vol.value) / 100)
    showRadio()
  })
  function showRadio(): void {
    const m = radio.canPlay ? radio.mode() : 'captions'
    modes.forEach((id, i) => rButtons[i]!.setAttribute('aria-pressed', String(id === m)))
    rNote.textContent = radio.canPlay ? t(`radio.${m}Text` as StringKey) : t('radio.noSound')
    const pct = String(Math.round(radio.volume() * 100))
    vol.value = pct
    volValue.textContent = tf('radio.volumeValue', { pct })
    vol.setAttribute('aria-valuetext', volValue.textContent)
    volLabel.hidden = !radio.canPlay || m !== 'on'
  }
  showRadio()

  // Credits (plan PR 13): who made it and what it's made with. The full list is CREDITS.md.
  const cHead = el('h3', '', t('credits.title'))
  const credits = el('ul', 'small credit-list')
  for (const key of ['credits.made', 'credits.fonts', 'credits.code'] as const) credits.append(el('li', '', t(key)))
  // The sound: made in code, plus a credit for every real recording (src/data/recordings.ts).
  if (RECORDINGS.length === 0) {
    credits.append(el('li', '', t('credits.sound')))
  } else {
    const sound = el('li', '', t('credits.soundMixed'))
    const list = el('ul')
    // Two takes of the same sound share a title, so each title is listed once.
    const seen = new Set<string>()
    for (const rec of RECORDINGS) {
      if (seen.has(rec.title)) continue
      seen.add(rec.title)
      list.append(el('li', '', tf('credits.recording', { title: rec.title, author: rec.author, licence: rec.licence, source: rec.source })))
    }
    sound.append(list)
    credits.append(sound)
  }
  credits.append(el('li', '', tf('credits.radio', { voice: RADIO_CREDIT.voice, author: RADIO_CREDIT.author, source: RADIO_CREDIT.source })))
  box.append(gHead, gLead, row, now, reloadNote, tiers, oHead, oLine, rHead, rLead, rRow, rNote, volLabel, cHead, credits)
  return box
}
