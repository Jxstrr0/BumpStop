/**
 * The radio co-driver (Kelbo picked it, 27 November 2026): short voice calls
 * over the intercom during a raid stage, warning of what's ahead ("Caution.
 * Big jump. 50."). How the calls are picked is in `src/audio/pacenotes.ts`;
 * how they're played is in `src/audio/radio.ts`; the words on screen are in
 * `src/data/strings.ts` (`radio.line.*`).
 *
 * Every line is one take made for Bump Stop with ElevenLabs' text to speech
 * (the "Joe English" voice from its voice library, a Northern English voice
 * for Birchland's English-flavoured north), then trimmed, made mono and
 * shrunk for the web. The files live in `public/radio/` and go into the
 * offline copy like the rest of the game.
 *
 * Adding a line:
 * 1. Put the file in `public/radio/` (MP3, short, under 40 KB).
 * 2. Add its id below, its file in `RADIO_FILES` and its words in strings.ts.
 * 3. Add it to the table in `CREDITS.md`.
 * `tests/radio.test.ts` checks all of it lines up.
 */
import type { GroundId } from './ground'

/** Every line the co-driver can say. */
export type RadioLine =
  // The ground ahead: said when the road changes.
  | 'flat' | 'washboard' | 'rough' | 'ice' | 'snow'
  // Something to hit, with "Caution" when it's a big one. A distance usually follows.
  | 'whoops' | 'whoopsBig' | 'rocks' | 'rocksBig' | 'jump' | 'jumpBig' | 'heave' | 'heaveStep'
  // How far to it (m).
  | 'd30' | 'd50' | 'd80' | 'd100' | 'd200'
  // The weather turning.
  | 'thaw' | 'whiteout' | 'dust'
  // The stage itself: the start, off again after a checkpoint, into a checkpoint, the finish.
  | 'go' | 'goOn' | 'checkpoint' | 'finish'
  // Trouble: a stop, the shocks cooked, a rock underneath, into a snowbank, the ice cracking, the ice creaking, the oil warming up.
  | 'stop' | 'cool' | 'under' | 'slide' | 'crack' | 'creak' | 'hot'

/** Each line's file, under `public/`. */
export const RADIO_FILES: Readonly<Record<RadioLine, string>> = {
  flat: 'radio/flat.mp3',
  washboard: 'radio/washboard.mp3',
  rough: 'radio/rough.mp3',
  ice: 'radio/ice.mp3',
  snow: 'radio/snow.mp3',
  whoops: 'radio/whoops.mp3',
  whoopsBig: 'radio/whoops-big.mp3',
  rocks: 'radio/rocks.mp3',
  rocksBig: 'radio/rocks-big.mp3',
  jump: 'radio/jump.mp3',
  jumpBig: 'radio/jump-big.mp3',
  heave: 'radio/heave.mp3',
  heaveStep: 'radio/heave-step.mp3',
  d30: 'radio/d30.mp3',
  d50: 'radio/d50.mp3',
  d80: 'radio/d80.mp3',
  d100: 'radio/d100.mp3',
  d200: 'radio/d200.mp3',
  thaw: 'radio/thaw.mp3',
  whiteout: 'radio/whiteout.mp3',
  dust: 'radio/dust.mp3',
  go: 'radio/go.mp3',
  goOn: 'radio/go-on.mp3',
  checkpoint: 'radio/checkpoint.mp3',
  finish: 'radio/finish.mp3',
  stop: 'radio/stop.mp3',
  cool: 'radio/cool.mp3',
  under: 'radio/under.mp3',
  slide: 'radio/slide.mp3',
  crack: 'radio/crack.mp3',
  creak: 'radio/creak.mp3',
  hot: 'radio/hot.mp3',
}

/** Every line, in the order above. */
export const RADIO_LINES = Object.keys(RADIO_FILES) as RadioLine[]

/** Who made the voice, for the credits (Settings and CREDITS.md). */
export const RADIO_CREDIT = {
  voice: 'Joe English',
  author: 'ElevenLabs',
  licence: 'Made for Bump Stop',
  source: 'https://elevenlabs.io/text-to-speech',
} as const

/** The distances the co-driver can call (m), with their lines. */
export const RADIO_DISTANCES: readonly { m: number; line: RadioLine }[] = [
  { m: 30, line: 'd30' },
  { m: 50, line: 'd50' },
  { m: 80, line: 'd80' },
  { m: 100, line: 'd100' },
  { m: 200, line: 'd200' },
]

/**
 * How the co-driver spots something to hit in the road ahead of a clip
 * (`src/audio/pacenotes.ts`). He looks along both wheel tracks for a stretch
 * of `window` metres whose highest and lowest points are more than `min`
 * apart: that's a whoop, a rock, a jump or a heave. If the biggest one there
 * is `big` or more, it gets a "Caution". Weather that roughens the ground
 * (a thaw) makes the same bumps bigger, so it gets more of them; in a dust
 * storm the unseen ruts are in the road too, so he calls those.
 *
 * The heights come from the ground recipes in `src/data/ground.ts`: whoops
 * are 12 to 30 cm, rocks 3 to 16 cm, jumps 0.5 to 1.1 m, frost heaves 6 to
 * 22 cm. `stepUp` is how sharp a rise in one sample (2.5 cm along the road)
 * counts as a crack edge facing the truck, for "Heave, step up".
 */
export interface RadioSpot {
  /** What he calls it, and what he calls a big one. */
  line: RadioLine
  bigLine: RadioLine
  /** How long a stretch he looks at once (m). */
  window: number
  /** Highest minus lowest point in that stretch that counts as something to hit (m). */
  min: number
  /** ...and as a big one (m). */
  big: number
  /** A rise this sharp in one sample (m) is a crack edge facing the truck. */
  stepUp?: number
}

export const RADIO_SPOT: Partial<Record<GroundId, RadioSpot>> = {
  whoops: { line: 'whoops', bigLine: 'whoopsBig', window: 6, min: 0.1, big: 0.24 },
  rocks: { line: 'rocks', bigLine: 'rocksBig', window: 1.5, min: 0.08, big: 0.13 },
  jumps: { line: 'jump', bigLine: 'jumpBig', window: 12, min: 0.35, big: 0.85 },
  // Heaves don't get a "big": the one to warn about is a crack edge facing the truck, which the tire hits square on.
  iceHeaves: { line: 'heave', bigLine: 'heave', window: 6, min: 0.1, big: Infinity, stepUp: 0.025 },
}

/** What he says when the road turns into this ground (and there's nothing in particular to hit). */
export const GROUND_LINE: Readonly<Record<GroundId, RadioLine>> = {
  graded: 'flat',
  washboard: 'washboard',
  rough: 'rough',
  whoops: 'whoops',
  rocks: 'rocks',
  jumps: 'jump',
  iceHeaves: 'heave',
  ice: 'ice',
  snow: 'snow',
}

/** Timing and the sound of the intercom. Only the show: none of it changes a result. */
export const RADIO = {
  /** Something closer than this (m) gets its name only: no time to say a distance. */
  minDistance: 16,
  /** He starts looking this far ahead of the truck's middle (m): anything nearer is already under the front wheels. */
  skipNear: 2,
  /** The co-driver looks this far past where the clip ends (m), so a jump just after it still gets its call. */
  lookPast: 10,
  /** Gap between the hazard and its distance (s). */
  gap: 0.06,
  /** A call that hasn't started this long after it was asked for (s) is out of date, and is dropped. */
  stale: 2.5,
  /** The words stay on screen this long after the voice stops (s). */
  captionHold: 1.6,
  /** The intercom's band (Hz): no deep bass, no fizzy top, like a helmet radio. */
  lowCut: 320,
  highCut: 3600,
  /** A touch of grit (0 = clean). */
  grit: 2.2,
  /** The click and hiss when the mic keys up and lets go (s, and loudness 0 to 1). */
  squelch: 0.05,
  squelchLevel: 0.12,
  /** The voice's loudness at 100% volume. */
  level: 0.9,
  /** Volume when the player hasn't picked one (0 to 1). */
  defaultVolume: 0.8,
} as const
