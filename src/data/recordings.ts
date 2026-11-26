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

/** The licences Bump Stop may use (CLAUDE.md, Content rules). */
export type Licence = 'CC0' | 'CC BY 3.0' | 'CC BY 4.0'

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

/** Every recording in the game. Empty: every sound is still made in code. */
export const RECORDINGS: readonly Recording[] = []

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
