/**
 * Loads the real recordings listed in `src/data/recordings.ts` and tidies
 * them up (one channel, evened-out loudness, a sensible length), so
 * `sound.ts` can play them in place of the made sounds.
 *
 * Nothing here can stop the game: a file that won't load is skipped, and the
 * made sound plays instead.
 */
import { RECORDING_PREP, RECORDINGS, type RecordedSound, type Recording } from '../data/recordings'

/** The break sounds get a little longer than the rattles and hits. */
const BREAKS: ReadonlySet<RecordedSound> = new Set(['hissOut', 'clang', 'crack', 'bang', 'pop', 'groan'])

/** Longest a recording of this sound may run (s). */
export function maxLength(sound: RecordedSound): number {
  if (sound === 'hissLoop') return RECORDING_PREP.maxLoop
  return BREAKS.has(sound) ? RECORDING_PREP.maxBreak : RECORDING_PREP.maxShort
}

/**
 * Turn a recording's channels into one tidy channel:
 * - mix the channels down to one;
 * - cut it to `maxSeconds`, fading out over the last bit (a loop instead
 *   blends its end into its start, so it goes round without a click);
 * - bring its loudest moment to `peak`.
 * Pure, so the tests can check it.
 */
export function prepareSamples(
  channels: readonly Float32Array[],
  rate: number,
  maxSeconds: number,
  loop: boolean,
): Float32Array<ArrayBuffer> {
  const length = Math.min(channels[0]?.length ?? 0, Math.round(maxSeconds * rate))
  const mono = new Float32Array(new ArrayBuffer(length * 4))
  for (const ch of channels) {
    for (let n = 0; n < length; n++) mono[n] = (mono[n] as number) + (ch[n] as number) / channels.length
  }
  const fadeN = Math.min(Math.round(RECORDING_PREP.fade * rate), Math.floor(length / 4))
  let out = mono
  if (loop && fadeN > 0) {
    // Blend the last bit into the first, then drop the last bit: the loop's end now runs into its start.
    out = new Float32Array(new ArrayBuffer((length - fadeN) * 4))
    out.set(mono.subarray(0, length - fadeN))
    for (let i = 0; i < fadeN; i++) {
      const k = i / fadeN
      out[i] = (mono[i] as number) * Math.sqrt(k) + (mono[length - fadeN + i] as number) * Math.sqrt(1 - k)
    }
  } else if (length < (channels[0]?.length ?? 0) && fadeN > 0) {
    // It was cut short: fade out so it doesn't end with a click.
    for (let i = 0; i < fadeN; i++) {
      const n = length - fadeN + i
      out[n] = (out[n] as number) * (1 - (i + 1) / fadeN)
    }
  }
  let loudest = 0
  for (let n = 0; n < out.length; n++) loudest = Math.max(loudest, Math.abs(out[n] as number))
  if (loudest > 1e-6) {
    const scale = RECORDING_PREP.peak / loudest
    for (let n = 0; n < out.length; n++) out[n] = (out[n] as number) * scale
  }
  return out
}

/** A recording, loaded and ready to play. */
export interface LoadedRecording {
  buffer: AudioBuffer
  gain: number
}

/**
 * Load every recording, calling `ready` as each one is done (so the first
 * ones play while the rest load). Files are found next to the page, so this
 * works at bumpstop.longlight.games and under any sub-path.
 */
export function loadRecordings(
  ctx: BaseAudioContext,
  ready: (sound: RecordedSound, loaded: LoadedRecording) => void,
  list: readonly Recording[] = RECORDINGS,
): void {
  for (const rec of list) {
    void loadOne(ctx, rec).then((loaded) => {
      if (loaded) ready(rec.sound, loaded)
    })
  }
}

async function loadOne(ctx: BaseAudioContext, rec: Recording): Promise<LoadedRecording | null> {
  try {
    const res = await fetch(new URL(rec.file, document.baseURI))
    if (!res.ok) return null
    const decoded = await ctx.decodeAudioData(await res.arrayBuffer())
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, k) => decoded.getChannelData(k))
    const samples = prepareSamples(channels, decoded.sampleRate, maxLength(rec.sound), rec.sound === 'hissLoop')
    if (samples.length === 0) return null
    const buffer = ctx.createBuffer(1, samples.length, decoded.sampleRate)
    buffer.copyToChannel(samples, 0)
    return { buffer, gain: rec.gain }
  } catch {
    // Missing, offline or a format this browser can't read: the made sound stays.
    return null
  }
}
