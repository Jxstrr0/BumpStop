/**
 * Every number behind the sound and the buzz (plan PR 6).
 *
 * Nothing here is a recording: every sound is made live in the browser from
 * these numbers and from what the sim is doing (`src/audio/`). Real
 * recordings that can stand in for the short sounds are listed in
 * `recordings.ts`. How it all works: `docs/SOUND.md`.
 *
 * `FEEL` is the only part the sim reads (`src/sim/laps.ts` counts the hits
 * with it). The rest is for `src/audio/`.
 */
import type { ClassId } from './classes'
import type { GroundId } from './ground'
import type { FailureKind } from './wear'

/** How the lap runner spots hits for the sound. Changes nothing in the run. */
export const FEEL = {
  /** A tire hit counts when the tire pushes this many times its resting load... */
  strikeAt: 2.5,
  /** ...and the next one counts once it has dropped back under this. */
  strikeRearm: 1.3,
} as const

// ── The engine voice ──
//
// PEW's idea, rewritten: every engine has a firing pattern (where in the
// crank's two turns each cylinder fires, and how hard each pulse sounds). The
// voice is that pulse train, turned into a waveform and played at the engine's
// speed. An even straight-six hums; a V8's two banks don't sound alike, which
// gives it its burble; a 270° twin lopes.

export interface EngineSound {
  /** Crank angle (degrees, 0 to 720) where each cylinder fires, in firing order. */
  firing: readonly number[]
  /** How loud each of those pulses sounds (1 = full). */
  pulse: readonly number[]
  /** How sharp each pulse is (degrees of crank, the bell curve's spread). Sharper sounds harder and brighter. */
  pulseWidth: number
  fuel: 'petrol' | 'diesel'
  turbo: boolean
  /** Engine speeds (rpm). */
  idle: number
  redline: number
}

/** Evenly spaced firing for `n` cylinders over two turns of the crank. */
const even = (n: number): number[] => Array.from({ length: n }, (_, k) => (720 / n) * k)
const ones = (n: number): number[] => Array.from({ length: n }, () => 1)
// A cross-plane V8 fires L R R L R L L R (firing order 1-8-4-3-6-5-7-2, odd cylinders on the left).
// Each bank's pulses come unevenly, and the far bank's are quieter and arrive a little later
// (a longer pipe), so the two never line up: that's the burble.
const V8_LEFT = [true, false, false, true, false, true, true, false]
const V8_FIRING = V8_LEFT.map((left, k) => k * 90 + (left ? 0 : 14))
const V8_BANKS = V8_LEFT.map((left) => (left ? 1 : 0.75))

/** One entry per engine part in `src/data/parts.ts` (a test checks none is missing). */
export const ENGINE_SOUNDS: Readonly<Record<string, EngineSound>> = {
  petrolSix: { firing: even(6), pulse: ones(6), pulseWidth: 8, fuel: 'petrol', turbo: false, idle: 750, redline: 5500 },
  dieselFour: { firing: even(4), pulse: [1, 0.92, 0.97, 0.9], pulseWidth: 5, fuel: 'diesel', turbo: false, idle: 800, redline: 4200 },
  petrolV8: { firing: V8_FIRING, pulse: V8_BANKS, pulseWidth: 8, fuel: 'petrol', turbo: false, idle: 700, redline: 5800 },
  turboDiesel: { firing: even(4), pulse: [1, 0.94, 0.97, 0.92], pulseWidth: 5, fuel: 'diesel', turbo: true, idle: 800, redline: 4400 },
  // A 60° V6 fires evenly, every 120°: smoother than the four, smaller than the V8.
  twinTurboV6: { firing: even(6), pulse: [1, 0.9, 0.97, 0.92, 0.99, 0.91], pulseWidth: 8, fuel: 'petrol', turbo: true, idle: 750, redline: 6200 },
  dieselSix: { firing: even(6), pulse: [1, 0.95, 0.98, 0.94, 1, 0.96], pulseWidth: 5, fuel: 'diesel', turbo: false, idle: 600, redline: 2400 },
  turboDieselSix: { firing: even(6), pulse: [1, 0.96, 0.98, 0.95, 1, 0.97], pulseWidth: 5, fuel: 'diesel', turbo: true, idle: 600, redline: 2500 },
  dieselV8: { firing: V8_FIRING, pulse: V8_BANKS, pulseWidth: 5, fuel: 'diesel', turbo: false, idle: 550, redline: 2300 },
  twinTurboDieselSix: { firing: even(6), pulse: [1, 0.97, 0.99, 0.96, 1, 0.98], pulseWidth: 5, fuel: 'diesel', turbo: true, idle: 600, redline: 2600 },
  // A 270° parallel twin fires at 0° and 270°, then waits 450°: the lope.
  twin: { firing: [0, 270], pulse: [1, 0.95], pulseWidth: 11, fuel: 'petrol', turbo: false, idle: 1300, redline: 7500 },
  triple: { firing: even(3), pulse: [1, 0.96, 0.93], pulseWidth: 10, fuel: 'petrol', turbo: false, idle: 1200, redline: 8000 },
  turboTwin: { firing: [0, 270], pulse: [1, 0.95], pulseWidth: 10, fuel: 'petrol', turbo: true, idle: 1300, redline: 8000 },
}

/**
 * How road speed turns into engine speed for each class.
 * - Gears: the truck holds the highest gear that keeps the engine above
 *   `lugShare` of its red line (rally drivers keep the revs up off-road).
 * - CVT (side-by-sides): the belt holds the engine near `holdShare` of its
 *   red line once moving, creeping up towards the red line at top speed.
 */
export type Gearbox =
  | { kind: 'gears'; topKmhPer1000: number; ratios: readonly number[]; lugShare: number }
  | { kind: 'cvt'; engageShare: number; holdShare: number; holdFromKmh: number; topKmh: number }

export const GEARBOXES: Readonly<Record<ClassId, Gearbox>> = {
  light4x4: { kind: 'gears', topKmhPer1000: 40, ratios: [3.9, 2.3, 1.45, 1, 0.82], lugShare: 0.38 },
  heavy: { kind: 'gears', topKmhPer1000: 48, ratios: [12, 8.8, 6.45, 4.73, 3.47, 2.54, 1.86, 1.36, 1], lugShare: 0.5 },
  sxs: { kind: 'cvt', engageShare: 0.3, holdShare: 0.72, holdFromKmh: 35, topKmh: 120 },
}

// ── The mix ──

/** How loud each part is at its loudest (0 to 1, before the master). */
export const MIX = {
  master: 0.8,
  engine: 0.24,
  /** The shaker rig's engine idles quieter: the truck is parked. */
  engineParked: 0.16,
  dieselClatter: 0.09,
  turboWhistle: 0.025,
  turboWhoosh: 0.05,
  tick: 0.22,
  strike: 0.5,
  clunk: 0.7,
  hiss: 0.12,
  shakerHum: 0.06,
  bang: 0.95,
} as const

/** How the engine's tone follows its speed and load. */
export const ENGINE_TONE = {
  /** Harmonics in the waveform (of the crank's two-turn cycle). */
  harmonics: 96,
  /** How quickly the engine's speed and tone follow the truck (s). */
  follow: 0.12,
  /** The tone filter: this much at idle, plus this much more at the red line, scaled by load. */
  cutoffIdle: 380,
  cutoffSpan: 3400,
  /** How hard the waveshaper drives at full load (1 = clean). */
  drive: 2.4,
  /** Load is this at a standstill and full at this speed (m/s). */
  loadIdle: 0.35,
  loadFullSpeed: 30,
  /** The turbo starts to spool at this share of the red line. */
  boostFrom: 0.35,
  /** Diesel knock: the band of the clatter (Hz). */
  knockBand: 2600,
  /** Turbo whistle at full boost (Hz). */
  whistleTop: 5200,
} as const

/** How busy the suspension sounds: the bigger of the ground's own rattle and how hard the dampers work, plus the strikes. */
export const CLATTER = {
  /** Damper heating (kelvin a second, per damper) that counts as flat out. */
  fullHeating: 0.5,
  /** Each ground's own rattle at `fullSpeed` and above (0 to 1); slower is quieter. */
  ground: { graded: 0.06, washboard: 0.55, rough: 0.45, whoops: 0.25, rocks: 0.5, jumps: 0.12, iceHeaves: 0.2, ice: 0.03, snow: 0.12 } satisfies Record<GroundId, number>,
  fullSpeed: 20,
  /** Rattles a second at flat out, and never more than this however fast the run plays. */
  ticksPerSecond: 22,
  /** Tire strikes per sim second that add a full share on top. */
  fullStrikes: 6,
} as const

/** Smallest gaps between one-shots (real seconds), so a fast run doesn't turn into noise. */
export const GAPS = {
  strike: 0.12,
  clunk: 0.16,
  buzz: 0.6,
} as const

/** How the hit sizes (tire force over resting load) map to loudness. */
export const HIT_SIZE = {
  /** Strikes softer than this only add to the clatter; this hard or more is full size. */
  strikeMin: 3.5,
  strikeFull: 9,
  /** A bottom-out this hard is full size (the strut's push over the corner's resting load; about 20 on a big landing). */
  clunkFull: 25,
} as const

/** The hot-shock hiss starts at the damper's warm line and is full at its red line. */
export const HISS = {
  /** Over the red line it sputters this many times a second. */
  sputterHz: 6,
} as const

/** The shaker rig's servo hum: pitch at the slowest and fastest beat (Hz). */
export const SHAKER_HUM = { low: 70, high: 240 } as const

// ── The buzz (phones that can vibrate) ──

/** Vibration patterns (ms on, off, on...). */
export const BUZZ = {
  /** Tire strikes at least this share of full size buzz (`hit`); every bottom-out buzzes harder (`hardHit`). */
  minSize: 0.8,
  hit: [14],
  hardHit: [28],
  break: [40, 60, 140],
} as const

/** The sound each failure makes when it lets go. */
export const BREAK_SOUND: Readonly<Record<FailureKind, 'hissOut' | 'clang' | 'crack' | 'bang' | 'pop' | 'groan'>> = {
  fade: 'hissOut',
  bottoming: 'clang',
  mount: 'crack',
  axle: 'bang',
  tire: 'pop',
  frame: 'groan',
}
