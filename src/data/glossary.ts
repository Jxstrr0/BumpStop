/**
 * The help's glossary (plan PR 11): the real suspension and rally-raid words
 * the game uses, each with a plain-words meaning in `strings.ts`
 * (`glossary.<id>` and `glossary.<id>Text`). Where the build screen has the
 * part or slider, `see` names it as a fix target, and the help turns that
 * into a "Show me" jump (the same way the report's fixes jump).
 *
 * The help sorts them A to Z by the word itself, so the order here doesn't matter.
 */
import type { FixTarget } from './failures'

export interface GlossaryEntry {
  id: string
  /** Where it lives on the build screen, if anywhere. */
  see?: FixTarget
}

export const GLOSSARY = [
  { id: 'antiRoll' },
  { id: 'beadlock', see: 'beadlocks' },
  { id: 'bivouac' },
  { id: 'bottoming', see: 'bumpStops' },
  { id: 'bumpStop', see: 'bumpStops' },
  { id: 'bypass', see: 'damperSize' },
  { id: 'clicks', see: 'rebound' },
  { id: 'coil' },
  { id: 'compression', see: 'compression' },
  { id: 'cv', see: 'axles' },
  { id: 'damper', see: 'damperSize' },
  { id: 'droop', see: 'limitStraps' },
  { id: 'fade', see: 'damperSize' },
  { id: 'fatigue' },
  { id: 'foaming' },
  { id: 'frame', see: 'frame' },
  { id: 'frostHeave' },
  { id: 'gusset', see: 'gussets' },
  { id: 'highLow', see: 'compression' },
  { id: 'independent' },
  { id: 'leaf' },
  { id: 'limitStrap', see: 'limitStraps' },
  { id: 'monotube', see: 'damperSize' },
  { id: 'mount', see: 'mounts' },
  { id: 'paceCall' },
  { id: 'packing', see: 'rebound' },
  { id: 'preload', see: 'rideHeight' },
  { id: 'privateer' },
  { id: 'rebound', see: 'rebound' },
  { id: 'redLine' },
  { id: 'reservoir', see: 'damperSize' },
  { id: 'rideHeight', see: 'rideHeight' },
  { id: 'roadbook' },
  { id: 'sag', see: 'springRate' },
  { id: 'solidAxle' },
  { id: 'springRate', see: 'springRate' },
  { id: 'spoolValve', see: 'spoolValve' },
  { id: 'sprung', see: 'lighterWheels' },
  { id: 'stage' },
  { id: 'studs', see: 'tireCasing' },
  { id: 'tirePressure', see: 'tirePressure' },
  { id: 'travel' },
  { id: 'washboard' },
  { id: 'wheelHop' },
  { id: 'whoops' },
] as const satisfies readonly GlossaryEntry[]

export type GlossaryId = (typeof GLOSSARY)[number]['id']
