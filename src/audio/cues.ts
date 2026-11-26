/**
 * What to play, frame by frame (plan PR 6). Pure, so the tests can check it:
 * it takes what the run did since the last frame and says which short sounds
 * to play, how busy the clatter and how loud the hiss should be, and whether
 * to buzz. `sound.ts` does the playing.
 *
 * The rigs play a run much faster than real time (a lap in about 4 seconds),
 * so a frame can hold dozens of hits. The cues keep it readable: the clatter
 * follows how busy the suspension is, only the biggest hit in a frame gets
 * its own sound, and hits are spaced out (`GAPS`), so the big ones still
 * stand out.
 */
import type { GroundId } from '../data/ground'
import type { FailureKind } from '../data/wear'
import { BREAK_SOUND, BUZZ, CLATTER, GAPS, HIT_SIZE, MIX } from '../data/sound'
import type { RunFeel } from '../sim/laps'
import type { VoiceName } from './voices'

/** One short sound: which, how loud (0 to 1), how fast (1 = as made; lower is deeper), and how far into the frame (s). */
export interface Shot {
  voice: VoiceName
  gain: number
  rate: number
  delay: number
}

export interface Cues {
  shots: Shot[]
  /** How busy the suspension sounds (0 to 1). */
  clatter: number
  /** The hot-shock hiss: 0 at the warm line, 1 at the red line, more over it. */
  hiss: number
  /** A vibration pattern, or null. */
  buzz: readonly number[] | null
}

/** What the cues remember between frames. */
export interface CueState {
  /** Real seconds since the run started. */
  time: number
  lastStrike: number
  lastClunk: number
  lastBuzz: number
  /** Rattles owed from earlier frames (a part of one). */
  tickCarry: number
}

export function newCueState(): CueState {
  return { time: 0, lastStrike: -Infinity, lastClunk: -Infinity, lastBuzz: -Infinity, tickCarry: 0 }
}

/** One frame of a lap run. */
export interface LapFrame {
  /** Real seconds since the last frame. */
  realDt: number
  /** "Skip to the end": no hits, no clatter, just the break at the end. */
  skipping: boolean
  /** What the truck felt since the last frame (`takeFeel`). */
  feel: RunFeel
  ground: GroundId
  /** Road speed (m/s). */
  speed: number
  /** The hottest damper's oil: 0 at its warm line, 1 at its red line. */
  heat: number
  /** One damper's heat capacity (J/K), to turn the dampers' work into heating. */
  heatCapacity: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** How busy the suspension is (0 to 1): the ground's own rattle or the dampers' work, whichever is more, plus the strikes. */
export function clatterLevel(f: LapFrame): number {
  if (f.feel.time <= 0) return 0
  const ground = CLATTER.ground[f.ground] * clamp01(f.speed / CLATTER.fullSpeed)
  const heating = f.feel.work / f.feel.time / 4 / f.heatCapacity
  const work = clamp01(heating / CLATTER.fullHeating)
  const strikes = clamp01(f.feel.strikes / f.feel.time / CLATTER.fullStrikes)
  return clamp01(Math.max(ground, work) + 0.5 * strikes)
}

/** The cues for one frame of a lap run. `rand` gives 0 to 1 (it only varies the rattles). */
export function lapCues(state: CueState, f: LapFrame, rand: () => number): Cues {
  state.time += f.realDt
  if (f.skipping) {
    state.tickCarry = 0
    return { shots: [], clatter: 0, hiss: 0, buzz: null }
  }
  const shots: Shot[] = []
  let buzz: readonly number[] | null = null
  const clatter = clatterLevel(f)

  // Rattles: more of them the busier it is, spread across the frame.
  state.tickCarry += CLATTER.ticksPerSecond * clatter * f.realDt
  const soft = f.ground === 'whoops' || f.ground === 'jumps'
  while (state.tickCarry >= 1) {
    state.tickCarry -= 1
    shots.push({
      voice: soft && rand() < 0.6 ? 'knock' : 'tick',
      gain: MIX.tick * clatter * (0.45 + 0.55 * rand()),
      rate: 0.8 + 0.45 * rand(),
      delay: rand() * f.realDt,
    })
  }

  // A bottom-out: the clunk, and a buzz. They're rare, so each one gets heard.
  if (f.feel.bottomOuts > 0 && state.time - state.lastClunk >= GAPS.clunk) {
    state.lastClunk = state.time
    const size = clamp01(f.feel.bottomPeak / HIT_SIZE.clunkFull)
    shots.push({ voice: 'clunk', gain: MIX.clunk * (0.6 + 0.4 * size), rate: 1.05 - 0.15 * size, delay: 0 })
    if (state.time - state.lastBuzz >= GAPS.buzz) {
      state.lastBuzz = state.time
      buzz = BUZZ.hardHit
    }
  } else if (f.feel.strikes > 0 && f.feel.strikePeak >= HIT_SIZE.strikeMin && state.time - state.lastStrike >= GAPS.strike) {
    // The frame's biggest tire strike: on rocks a sharp clack, elsewhere a thump. Bigger is deeper.
    state.lastStrike = state.time
    const size = clamp01((f.feel.strikePeak - HIT_SIZE.strikeMin) / (HIT_SIZE.strikeFull - HIT_SIZE.strikeMin))
    shots.push({
      voice: f.ground === 'rocks' ? 'rockStrike' : 'strike',
      gain: MIX.strike * (0.35 + 0.65 * size),
      rate: 1.15 - 0.3 * size,
      delay: rand() * f.realDt * 0.5,
    })
    if (size >= BUZZ.minSize && state.time - state.lastBuzz >= GAPS.buzz) {
      state.lastBuzz = state.time
      buzz = BUZZ.hit
    }
  }

  return { shots, clatter, hiss: Math.max(0, f.heat), buzz }
}

/** The sound and buzz when something lets go. */
export function breakCues(kind: FailureKind): Cues {
  return { shots: [{ voice: BREAK_SOUND[kind], gain: MIX.bang, rate: 1, delay: 0 }], clatter: 0, hiss: 0, buzz: BUZZ.break }
}

/** The hot-shock hiss for an oil temperature (K): 0 at the warm line, 1 at the red line. */
export function heatShare(oil: number, warmFrom: number, redLine: number): number {
  return (oil - warmFrom) / (redLine - warmFrom)
}

/** The shaker rig's clatter from how much the wheels move compared with the posts (1 = as much). */
export function shakerClatter(wheel: number): number {
  return clamp01((wheel - 1) / 2.5)
}
