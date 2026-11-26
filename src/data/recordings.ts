/**
 * Real sound recordings, layered over the made sounds (see docs/SOUND.md,
 * "Recordings").
 *
 * Every short sound in `src/audio/voices.ts` is made by the game's own code.
 * A recording listed here takes its place: the game loads the file when the
 * sound first wakes up, evens out its loudness, and plays it instead. If a
 * file is missing, can't be read or the phone is offline before it ever
 * loaded, the made sound plays as before, so a recording can never leave the
 * game silent.
 *
 * Two or more recordings for the same sound take turns, so repeats don't all
 * sound alike. The engine stays made in code: it follows every engine part's
 * firing pattern and speed exactly, which one recording can't.
 *
 * Adding one:
 * 1. Put the file in `public/sounds/` (MP3 or OGG, short, under 300 KB).
 * 2. Add a line below.
 * 3. Add its line to `CREDITS.md` ("Sound and art"), with the same file name.
 * `tests/recordings.test.ts` checks all three line up.
 */

/** The sounds a recording can stand in for. All but `hissLoop` match `VoiceName` in `src/audio/voices.ts` (a test checks). */
export type RecordedSound =
  /** A small rattle in the suspension. */
  | 'tick'
  /** A deeper knock in the suspension. */
  | 'knock'
  /** A tire hitting something hard: a thump. */
  | 'strike'
  /** A tire hitting a rock: a sharp clack. */
  | 'rockStrike'
  /** A wheel hitting its bump stop: a heavy metal clunk. */
  | 'clunk'
  /** Break: a damper fades (a long hiss that sputters out). */
  | 'hissOut'
  /** Break: bottomed out once too often (a big clang). */
  | 'clang'
  /** Break: a shock mount cracks. */
  | 'crack'
  /** Break: an axle or CV joint snaps. */
  | 'bang'
  /** Break: a tire is cut (a pop and the air rushing out). */
  | 'pop'
  /** Break: the frame cracks (a groan of steel, then a snap). */
  | 'groan'
  /** Hot shocks: a steady hiss, looped, getting louder as the oil heats up. */
  | 'hissLoop'

/** Every sound a recording can stand in for, in the order above. */
export const RECORDED_SOUNDS: readonly RecordedSound[] = [
  'tick', 'knock', 'strike', 'rockStrike', 'clunk', 'hissOut', 'clang', 'crack', 'bang', 'pop', 'groan', 'hissLoop',
]

/**
 * The licences Bump Stop may use: downloaded recordings must be CC0 or CC BY
 * (CLAUDE.md, Content rules). `Made for Bump Stop` is a sound made for this
 * game with ElevenLabs' sound-effect maker, which Kelbo approved on
 * 26 November 2026.
 */
export type Licence = 'CC0' | 'CC BY 3.0' | 'CC BY 4.0' | 'Made for Bump Stop'

/** Every licence above, for the test and the credits. */
export const LICENCES: readonly Licence[] = ['CC0', 'CC BY 3.0', 'CC BY 4.0', 'Made for Bump Stop']

export interface Recording {
  /** Which sound it stands in for. */
  sound: RecordedSound
  /** The file, under `public/` (so `sounds/clunk-1.mp3`). */
  file: string
  /** What the recording is called where it came from. */
  title: string
  /** Who recorded it, as they want to be credited. */
  author: string
  licence: Licence
  /** The page it came from. */
  source: string
  /** Loudness after evening out (1 = as loud as the made sound it replaces). Turn down a recording that sounds too big. */
  gain: number
}

/** Made for Bump Stop with ElevenLabs (all 17 share these). */
const ELEVENLABS = { author: 'ElevenLabs', licence: 'Made for Bump Stop', source: 'https://elevenlabs.io/sound-effects' } as const

/**
 * Every recording in the game: 17 sounds made for Bump Stop with ElevenLabs
 * (26 November 2026). Two takes each for the sounds that repeat a lot.
 * `gain` is a first guess by ear: the rattles a touch quieter so they don't
 * crowd the engine, the quiet crack and tire cut a little louder, the hiss
 * loop well down because it plays for a long time.
 */
export const RECORDINGS: readonly Recording[] = [
  { sound: 'tick', file: 'sounds/tick-1.mp3', title: 'Suspension tick', gain: 0.8, ...ELEVENLABS },
  { sound: 'tick', file: 'sounds/tick-2.mp3', title: 'Suspension tick', gain: 0.8, ...ELEVENLABS },
  { sound: 'knock', file: 'sounds/knock-1.mp3', title: 'Suspension knock', gain: 0.8, ...ELEVENLABS },
  { sound: 'knock', file: 'sounds/knock-2.mp3', title: 'Suspension knock', gain: 0.8, ...ELEVENLABS },
  { sound: 'strike', file: 'sounds/strike-1.mp3', title: 'Tire strike', gain: 1, ...ELEVENLABS },
  { sound: 'strike', file: 'sounds/strike-2.mp3', title: 'Tire strike', gain: 1, ...ELEVENLABS },
  { sound: 'rockStrike', file: 'sounds/rock-strike-1.mp3', title: 'Rock strike', gain: 1, ...ELEVENLABS },
  { sound: 'rockStrike', file: 'sounds/rock-strike-2.mp3', title: 'Rock strike', gain: 1, ...ELEVENLABS },
  { sound: 'clunk', file: 'sounds/clunk-1.mp3', title: 'Bump stop clunk', gain: 1, ...ELEVENLABS },
  { sound: 'clunk', file: 'sounds/clunk-2.mp3', title: 'Bump stop clunk', gain: 1, ...ELEVENLABS },
  { sound: 'hissOut', file: 'sounds/hiss-out.mp3', title: 'Damper fade', gain: 1, ...ELEVENLABS },
  { sound: 'clang', file: 'sounds/clang.mp3', title: 'Bottom-out clang', gain: 1, ...ELEVENLABS },
  { sound: 'crack', file: 'sounds/crack.mp3', title: 'Mount crack', gain: 1.3, ...ELEVENLABS },
  { sound: 'bang', file: 'sounds/bang.mp3', title: 'Axle snap', gain: 1, ...ELEVENLABS },
  { sound: 'pop', file: 'sounds/pop.mp3', title: 'Tire cut', gain: 1.2, ...ELEVENLABS },
  { sound: 'groan', file: 'sounds/groan.mp3', title: 'Frame groan', gain: 1, ...ELEVENLABS },
  { sound: 'hissLoop', file: 'sounds/hiss-loop.mp3', title: 'Hot shock hiss', gain: 0.6, ...ELEVENLABS },
]

/** How each recording is tidied when it loads. */
export const RECORDING_PREP = {
  /** The loudest moment of every recording is brought to this (0 to 1), so they all start equal. */
  peak: 0.9,
  /** Longest a short sound may run (s); longer ones are cut with a fade. The breaks get longer. */
  maxShort: 1.2,
  maxBreak: 3.5,
  /** The hiss loop may be up to this long (s). */
  maxLoop: 6,
  /** The fade at a cut (s). */
  fade: 0.06,
} as const
