/**
 * The little "i" notes on the build screen (Kelbo asked, 27 November 2026):
 * one for each Tune slider and one for each part slot. Each says, in plain
 * words, what it does and when to change it. The words live in `strings.ts`
 * (`info.setting.<key>` and `info.slot.<slot>`).
 *
 * Where the help's glossary has the same word, `term` names it, and the note
 * gets a "More in the help" button that opens the glossary there.
 */
import type { GlossaryId } from './glossary'
import type { AxleSettings } from './kit'
import type { SlotId } from './parts'
import type { StringKey } from './strings'

export interface InfoNote {
  text: StringKey
  /** The glossary word to open for more, if there is one. */
  term?: GlossaryId
}

export const SETTING_INFO: Readonly<Record<keyof AxleSettings, InfoNote>> = {
  springRate: { text: 'info.setting.springRate', term: 'springRate' },
  preload: { text: 'info.setting.preload', term: 'preload' },
  bumpStop: { text: 'info.setting.bumpStop', term: 'bumpStop' },
  droopLimit: { text: 'info.setting.droopLimit', term: 'limitStrap' },
  tirePressure: { text: 'info.setting.tirePressure', term: 'tirePressure' },
  compLow: { text: 'info.setting.compLow', term: 'highLow' },
  compHigh: { text: 'info.setting.compHigh', term: 'highLow' },
  rebound: { text: 'info.setting.rebound', term: 'rebound' },
  antiRoll: { text: 'info.setting.antiRoll', term: 'antiRoll' },
}

export const SLOT_INFO: Readonly<Record<SlotId, InfoNote>> = {
  frame: { text: 'info.slot.frame', term: 'frame' },
  frontSusp: { text: 'info.slot.frontSusp', term: 'independent' },
  rearSusp: { text: 'info.slot.rearSusp', term: 'solidAxle' },
  dampers: { text: 'info.slot.dampers', term: 'damper' },
  bumpStops: { text: 'info.slot.bumpStops', term: 'bumpStop' },
  antiRoll: { text: 'info.slot.antiRoll', term: 'antiRoll' },
  axles: { text: 'info.slot.axles', term: 'cv' },
  wheels: { text: 'info.slot.wheels', term: 'beadlock' },
  tires: { text: 'info.slot.tires', term: 'studs' },
  protection: { text: 'info.slot.protection' },
  engine: { text: 'info.slot.engine' },
  spares: { text: 'info.slot.spares' },
}
