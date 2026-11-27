/**
 * The radio co-driver's voice (Kelbo picked it, 27 November 2026), played
 * with the Web Audio API through a made-in-code helmet intercom: the band cut
 * to a radio's (no deep bass, no fizzy top), a touch of grit, and a click of
 * hiss as the mic keys up and lets go. The recordings themselves stay clean
 * (`public/radio/`, listed in `src/data/radio.ts`).
 *
 * - **On:** the voice, with the words on screen as captions.
 * - **Words only:** the captions, no voice (a phone on silent, a quiet room).
 * - **Off:** neither.
 * The pick and the volume are kept in localStorage (`bumpstop.radio`,
 * `bumpstop.radioVolume`), and Settings and the stage share one radio, so a
 * change in Settings is heard on the next call.
 *
 * One call at a time. A call that comes in while he's talking waits, and
 * only the newest waits: an old warning is worse than none, so a call that
 * waits too long is dropped. Trouble (a stop, the ice cracking) cuts in.
 * Browsers only allow sound after a tap, so the stage calls `wake()` from
 * the tap that starts it. Nothing here can stop the game: a file that won't
 * load just isn't heard, and its caption still shows.
 */
import { RADIO, RADIO_FILES, RADIO_LINES, type RadioLine } from '../data/radio'
import { t, type StringKey } from '../data/strings'

export type RadioMode = 'on' | 'captions' | 'off'
export const RADIO_MODES: readonly RadioMode[] = ['on', 'captions', 'off']

const MODE_KEY = 'bumpstop.radio'
const VOLUME_KEY = 'bumpstop.radioVolume'

/** The words for a call, as the captions show them: "Caution. Big jump. 50." */
export function captionFor(lines: readonly RadioLine[]): string {
  return lines.map((l) => t(`radio.line.${l}` as StringKey)).join(' ')
}

/** The saved pick, or On if there isn't one (or storage is blocked). */
export function readMode(): RadioMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'captions' || v === 'off' ? v : 'on'
  } catch {
    return 'on'
  }
}

/** The saved volume (0 to 1), or the default. */
export function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY))
    return localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : RADIO.defaultVolume
  } catch {
    return RADIO.defaultVolume
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private browsing or storage blocked: the pick still works until reload.
  }
}

export interface Radio {
  readonly canPlay: boolean
  mode(): RadioMode
  setMode(mode: RadioMode): void
  volume(): number
  setVolume(v: number): void
  /** Load the voice ahead of time (the raid's morning), so the first call is ready. Plays nothing. */
  prepare(): void
  /** Call from a tap: browsers only start sound after one. Starts loading the voice too, if it hasn't. */
  wake(): void
  /** Say a call. `urgent` cuts in over whatever he's saying. */
  say(lines: readonly RadioLine[], urgent?: boolean): void
  /** Stop talking and forget anything waiting (the stage was skipped or left). */
  hush(): void
  /** Resolves once he's finished talking, or after `maxMs` at most: the stage waits for "Three, two, one… go!". */
  quiet(maxMs: number): Promise<void>
  /** Hear the captions: the words of each call as it starts, and null when it's done. Returns a function that stops listening. */
  onCaption(fn: (text: string | null) => void): () => void
}

interface Waiting {
  lines: RadioLine[]
  asked: number
}

function makeRadio(): Radio {
  const Ctx: typeof AudioContext | undefined = typeof window !== 'undefined' ? window.AudioContext : undefined
  let mode = readMode()
  let volume = readVolume()
  let ctx: AudioContext | null = null
  let input: GainNode | null = null
  let master: GainNode | null = null
  let hiss: AudioBuffer | null = null
  const buffers = new Map<RadioLine, AudioBuffer>()
  let loading = false
  let talking: AudioScheduledSourceNode[] = []
  let busyUntil = 0
  let waiting: Waiting | null = null
  let timer = 0
  let clearTimer = 0
  const listeners = new Set<(text: string | null) => void>()

  const now = () => performance.now() / 1000
  const caption = (text: string | null) => listeners.forEach((fn) => fn(text))

  function setUp(): void {
    if (ctx || !Ctx) return
    try {
      ctx = new Ctx()
    } catch {
      return
    }
    // The helmet intercom: a band-pass and a little grit, then the volume.
    input = ctx.createGain()
    const low = ctx.createBiquadFilter()
    low.type = 'highpass'
    low.frequency.value = RADIO.lowCut
    const high = ctx.createBiquadFilter()
    high.type = 'lowpass'
    high.frequency.value = RADIO.highCut
    const grit = ctx.createWaveShaper()
    const curve = new Float32Array(new ArrayBuffer(1024 * 4))
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(RADIO.grit * x) / Math.tanh(RADIO.grit)
    }
    grit.curve = curve
    master = ctx.createGain()
    master.gain.value = RADIO.level * volume
    input.connect(low).connect(high).connect(grit).connect(master).connect(ctx.destination)
    // The squelch: a short burst of hiss that dies away.
    const n = Math.round(RADIO.squelch * ctx.sampleRate)
    hiss = ctx.createBuffer(1, n, ctx.sampleRate)
    const data = hiss.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * RADIO.squelchLevel * (1 - i / n)
  }

  function load(): void {
    if (loading || !ctx) return
    loading = true
    for (const line of RADIO_LINES) {
      void (async () => {
        try {
          const res = await fetch(new URL(RADIO_FILES[line], document.baseURI))
          if (!res.ok || !ctx) return
          buffers.set(line, await ctx.decodeAudioData(await res.arrayBuffer()))
        } catch {
          // Missing, offline before it ever loaded, or a format this browser can't read: the caption still shows.
        }
      })()
    }
  }

  function stopTalking(): void {
    for (const s of talking) {
      try {
        s.stop()
      } catch {
        // Already stopped.
      }
    }
    talking = []
    busyUntil = 0
  }

  /** Play a call now; returns how long it lasts (s). */
  function play(lines: readonly RadioLine[]): number {
    const voiced = mode === 'on' && ctx && input && hiss
    let length = 0
    if (voiced) {
      const c = ctx!
      let at = c.currentTime + 0.02
      const start = at
      const blip = (when: number) => {
        const s = c.createBufferSource()
        s.buffer = hiss
        s.connect(input!)
        s.start(when)
        talking.push(s)
      }
      blip(at)
      at += RADIO.squelch
      for (const line of lines) {
        const buf = buffers.get(line)
        if (!buf) continue
        const s = c.createBufferSource()
        s.buffer = buf
        s.connect(input!)
        s.start(at)
        talking.push(s)
        at += buf.duration + RADIO.gap
      }
      blip(at)
      length = at + RADIO.squelch - start
    }
    // Words only, or the voice hasn't loaded: show the words for about as long as they'd take to say.
    if (length <= RADIO.squelch * 2 + 0.05) length = 0.5 + 0.45 * lines.length
    return length
  }

  function next(): void {
    window.clearTimeout(timer)
    const w = waiting
    waiting = null
    if (!w) return
    if (now() - w.asked > RADIO.stale) return
    start(w.lines)
  }

  function start(lines: readonly RadioLine[]): void {
    const length = play(lines)
    busyUntil = now() + length
    window.clearTimeout(clearTimer)
    caption(captionFor(lines))
    clearTimer = window.setTimeout(() => caption(null), (length + RADIO.captionHold) * 1000)
    timer = window.setTimeout(next, length * 1000)
  }

  return {
    canPlay: Ctx !== undefined,
    mode: () => mode,
    setMode(m) {
      mode = m
      save(MODE_KEY, m)
      if (m !== 'on') stopTalking()
    },
    volume: () => volume,
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v))
      save(VOLUME_KEY, String(Math.round(volume * 100) / 100))
      if (master) master.gain.value = RADIO.level * volume
    },
    prepare() {
      // A sound player made before any tap starts paused, but it can already unpack the files.
      if (mode !== 'on') return
      setUp()
      load()
    },
    wake() {
      if (mode === 'off') return
      setUp()
      if (ctx?.state === 'suspended') void ctx.resume()
      load()
    },
    say(lines, urgent = false) {
      if (mode === 'off' || lines.length === 0) return
      if (urgent) {
        stopTalking()
        waiting = null
        window.clearTimeout(timer)
        start(lines)
        return
      }
      if (now() < busyUntil) {
        // Only the newest call waits.
        waiting = { lines: lines.slice(), asked: now() }
        return
      }
      start(lines)
    },
    hush() {
      stopTalking()
      waiting = null
      window.clearTimeout(timer)
      window.clearTimeout(clearTimer)
      caption(null)
    },
    quiet(maxMs) {
      const wait = Math.min(maxMs, Math.max(0, (busyUntil - now()) * 1000))
      return new Promise((done) => window.setTimeout(done, wait))
    },
    onCaption(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

let shared: Radio | null = null

/** The one radio, shared by the stage and Settings. */
export function getRadio(): Radio {
  shared ??= makeRadio()
  return shared
}
