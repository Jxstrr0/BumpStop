/**
 * The six failures as the player will read them (plan PR 2; the report
 * screen in plan PR 4 shows them): a name, what its trace shows, and where
 * to fix it.
 *
 * `trace` lists the channels the break's trace keeps, from the last few
 * seconds before it let go (see `src/sim/trace.ts`). Corner channels are for
 * the corner that broke; frame channels are for the whole frame.
 *
 * `fixes` are the settings the report jumps to, best first (at most three).
 * `src/ui/fixes.ts` turns each into the part or slider it opens.
 */
import type { StringKey } from './strings'
import type { FailureKind } from './wear'

/** Trace channels recorded for each corner. */
export type CornerChannel =
  | 'oilTemp' // K
  | 'travel' // wheel travel from ride height, m (up positive)
  | 'load' // strut load, N
  | 'hardStop' // metal-to-metal force while bottomed, N
  | 'tireSquash' // m
  | 'edge' // steepness of the ground under the tire, rise per metre
  | 'jointAngle' // rad
  | 'jointTorque' // N·m
  | 'strengthUse' // share of the joint's strength in use, 1 = snaps
  | 'mountDamage' // 0 to 1
  | 'axleDamage' // 0 to 1
  | 'tireDamage' // 0 to 1

export const CORNER_CHANNELS: readonly CornerChannel[] = [
  'oilTemp',
  'travel',
  'load',
  'hardStop',
  'tireSquash',
  'edge',
  'jointAngle',
  'jointTorque',
  'strengthUse',
  'mountDamage',
  'axleDamage',
  'tireDamage',
]

/** Trace channels recorded for the frame. */
export type FrameChannel =
  | 'frameFront' // front crossmember load, N
  | 'frameTwist' // twist between the axles, N·m
  | 'frameRear' // rear crossmember load, N
  | 'frameDamageFront' // 0 to 1
  | 'frameDamageCentre' // 0 to 1
  | 'frameDamageRear' // 0 to 1

export const FRAME_CHANNELS: readonly FrameChannel[] = [
  'frameFront',
  'frameTwist',
  'frameRear',
  'frameDamageFront',
  'frameDamageCentre',
  'frameDamageRear',
]

/**
 * A setting the report can jump to (`src/ui/fixes.ts`). `rebound` (more) and
 * `lighterWheels` are for the shaker rig's report; `lessRebound` is softer
 * rebound for hot dampers. `spoolValve` is the position-sensitive dampers
 * (2017 on), which firm up near the end of the travel.
 */
export type FixTarget =
  | 'damperSize'
  | 'compression'
  | 'pace'
  | 'springRate'
  | 'bumpStops'
  | 'rideHeight'
  | 'mounts'
  | 'limitStraps'
  | 'axles'
  | 'tirePressure'
  | 'tireCasing'
  | 'beadlocks'
  | 'frame'
  | 'gussets'
  | 'rebound'
  | 'lessRebound'
  | 'lighterWheels'
  | 'spoolValve'

/**
 * The report's traces turn amber at this share of a limit, for channels
 * with no warm line of their own (damage, strength in use, joint angle).
 */
export const WARM_SHARE = 0.8

export interface FailureInfo {
  kind: FailureKind
  name: StringKey
  cause: StringKey
  /** What the trace shows, in a sentence. */
  traceText: StringKey
  corner: readonly CornerChannel[]
  frame: readonly FrameChannel[]
  /**
   * Best first. The report shows the first three that make sense for this
   * truck in this year (`fixUseful`), so a fix that needs a part not out yet
   * makes way for the next one.
   */
  fixes: readonly { target: FixTarget; text: StringKey }[]
}

export const FAILURES: Readonly<Record<FailureKind, FailureInfo>> = {
  fade: {
    kind: 'fade',
    name: 'fail.fade',
    cause: 'fail.fadeCause',
    traceText: 'fail.fadeTrace',
    corner: ['oilTemp', 'travel'],
    frame: [],
    fixes: [
      { target: 'damperSize', text: 'fix.damperSize' },
      { target: 'compression', text: 'fix.lessCompression' },
      // Rebound damping makes heat too: in 1985 it's the one fix the shocks on sale allow.
      { target: 'lessRebound', text: 'fix.lessRebound' },
      { target: 'pace', text: 'fix.slower' },
    ],
  },
  bottoming: {
    kind: 'bottoming',
    name: 'fail.bottoming',
    cause: 'fail.bottomingCause',
    traceText: 'fail.bottomingTrace',
    corner: ['travel', 'load', 'hardStop'],
    frame: [],
    fixes: [
      { target: 'springRate', text: 'fix.stifferSprings' },
      // Only once they're on sale (2017) and not already fitted; otherwise the report skips to the next one.
      { target: 'spoolValve', text: 'fix.spoolValve' },
      { target: 'bumpStops', text: 'fix.bumpStops' },
      { target: 'rideHeight', text: 'fix.rideHeight' },
    ],
  },
  mount: {
    kind: 'mount',
    name: 'fail.mount',
    cause: 'fail.mountCause',
    traceText: 'fail.mountTrace',
    corner: ['mountDamage', 'load'],
    frame: [],
    fixes: [
      { target: 'mounts', text: 'fix.mounts' },
      { target: 'bumpStops', text: 'fix.softerBumpStops' },
    ],
  },
  axle: {
    kind: 'axle',
    name: 'fail.axle',
    cause: 'fail.axleCause',
    traceText: 'fail.axleTrace',
    corner: ['jointAngle', 'jointTorque', 'strengthUse', 'travel'],
    frame: [],
    fixes: [
      { target: 'limitStraps', text: 'fix.limitStraps' },
      { target: 'axles', text: 'fix.axles' },
    ],
  },
  tire: {
    kind: 'tire',
    name: 'fail.tire',
    cause: 'fail.tireCause',
    traceText: 'fail.tireTrace',
    corner: ['tireSquash', 'edge', 'tireDamage'],
    frame: [],
    fixes: [
      { target: 'tirePressure', text: 'fix.tirePressure' },
      { target: 'tireCasing', text: 'fix.tireCasing' },
      { target: 'beadlocks', text: 'fix.beadlocks' },
    ],
  },
  frame: {
    kind: 'frame',
    name: 'fail.frame',
    cause: 'fail.frameCause',
    traceText: 'fail.frameTrace',
    corner: [],
    frame: ['frameDamageFront', 'frameDamageCentre', 'frameDamageRear', 'frameTwist'],
    fixes: [
      { target: 'frame', text: 'fix.frame' },
      { target: 'gussets', text: 'fix.gussets' },
    ],
  },
}
