/**
 * The short sounds (plan PR 6): rattles, tire strikes, bottom-outs and the
 * sound of each failure letting go. Each is worked out sample by sample from
 * a few building blocks (noise, filters, ringing tones, a thump), so there
 * are no sound files to download or credit.
 *
 * Pure: the same name, sample rate and seed always give the same samples, so
 * the tests can check them. `sound.ts` turns them into Web Audio buffers once.
 */

/** Every short sound. The break sounds' names match `BREAK_SOUND` in `src/data/sound.ts`. */
export type VoiceName =
  | 'tick'
  | 'knock'
  | 'strike'
  | 'rockStrike'
  | 'clunk'
  | 'hissOut'
  | 'clang'
  | 'crack'
  | 'bang'
  | 'pop'
  | 'groan'

export const VOICE_NAMES: readonly VoiceName[] = [
  'tick', 'knock', 'strike', 'rockStrike', 'clunk', 'hissOut', 'clang', 'crack', 'bang', 'pop', 'groan',
]

/** A small, fast, seeded noise maker (not for the sim: the sim has its own RNG). */
function noiseMaker(seed: number): () => number {
  let x = (seed * 2654435761) >>> 0 || 1
  return () => {
    // xorshift32
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return (x / 4294967296) * 2 - 1
  }
}

/** A two-pole band-pass filter (the usual "biquad" recipe), run over samples in place. */
function bandPass(buf: Float32Array, rate: number, freq: number, q: number): void {
  const w = (2 * Math.PI * freq) / rate
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const b2 = -alpha / a0
  const a1 = (-2 * Math.cos(w)) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let n = 0; n < buf.length; n++) {
    const x = buf[n] as number
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    buf[n] = y
  }
}

/** A one-pole low-pass filter, in place. */
function lowPass(buf: Float32Array, rate: number, freq: number): void {
  const k = 1 - Math.exp((-2 * Math.PI * freq) / rate)
  let y = 0
  for (let n = 0; n < buf.length; n++) {
    y += k * ((buf[n] as number) - y)
    buf[n] = y
  }
}

/** A one-pole high-pass filter, in place. */
function highPass(buf: Float32Array, rate: number, freq: number): void {
  const k = 1 - Math.exp((-2 * Math.PI * freq) / rate)
  let low = 0
  for (let n = 0; n < buf.length; n++) {
    low += k * ((buf[n] as number) - low)
    buf[n] = (buf[n] as number) - low
  }
}

class Voice {
  readonly out: Float32Array<ArrayBuffer>
  private readonly noise: () => number
  constructor(
    readonly rate: number,
    seconds: number,
    seed: number,
  ) {
    this.out = new Float32Array(Math.ceil(rate * seconds))
    this.noise = noiseMaker(seed)
  }

  /** Noise starting at `at` seconds, shaped by a band, fading with time constant `decay` (s). */
  noiseBurst(at: number, length: number, decay: number, gain: number, band: { kind: 'band'; freq: number; q: number } | { kind: 'low' | 'high'; freq: number }): void {
    const buf = new Float32Array(Math.ceil(this.rate * length))
    const attack = Math.max(1, Math.floor(this.rate * 0.0008))
    for (let n = 0; n < buf.length; n++) {
      const t = n / this.rate
      buf[n] = this.noise() * Math.exp(-t / decay) * Math.min(1, n / attack)
    }
    if (band.kind === 'band') bandPass(buf, this.rate, band.freq, band.q)
    else if (band.kind === 'low') lowPass(buf, this.rate, band.freq)
    else highPass(buf, this.rate, band.freq)
    this.mix(buf, at, gain)
  }

  /** Noise that swells in and fades out over `length` seconds, its band sliding from `from` to `to` Hz (a hiss going out). */
  hiss(at: number, length: number, gain: number, from: number, to: number, flutter: number): void {
    const buf = new Float32Array(Math.ceil(this.rate * length))
    const step = Math.max(1, Math.floor(this.rate / 200))
    // Filter in short blocks so the band can slide.
    for (let start = 0; start < buf.length; start += step) {
      const end = Math.min(buf.length, start + step)
      const block = new Float32Array(end - start)
      for (let n = 0; n < block.length; n++) block[n] = this.noise()
      const share = start / buf.length
      bandPass(block, this.rate, from + (to - from) * share, 1.4)
      for (let n = 0; n < block.length; n++) {
        const t = (start + n) / this.rate
        const env = Math.min(1, t / 0.04) * (1 - share) ** 1.6
        const wobble = 1 - flutter * 0.5 * (1 + Math.sin(2 * Math.PI * 9 * t))
        buf[start + n] = (block[n] as number) * env * wobble
      }
    }
    this.mix(buf, at, gain)
  }

  /** Ringing metal: tones at `freqs` Hz, each fading with its own time (s). */
  ring(at: number, freqs: readonly number[], decays: readonly number[], gain: number): void {
    const longest = Math.max(...decays) * 5
    const buf = new Float32Array(Math.ceil(this.rate * longest))
    freqs.forEach((f, i) => {
      const d = decays[i] ?? decays[0] ?? 0.2
      const amp = 1 / (i + 1) ** 0.6
      for (let n = 0; n < buf.length; n++) {
        const t = n / this.rate
        buf[n] = (buf[n] as number) + amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d)
      }
    })
    this.mix(buf, at, gain / freqs.length ** 0.5)
  }

  /** A low thump: a tone falling from `from` to `to` Hz, gone in about `length` seconds. */
  thump(at: number, from: number, to: number, length: number, gain: number): void {
    const buf = new Float32Array(Math.ceil(this.rate * length))
    let phase = 0
    for (let n = 0; n < buf.length; n++) {
      const share = n / buf.length
      const f = from * (to / from) ** share
      phase += (2 * Math.PI * f) / this.rate
      const env = Math.min(1, n / (this.rate * 0.002)) * (1 - share) ** 2
      buf[n] = Math.sin(phase) * env
    }
    this.mix(buf, at, gain)
  }

  /** A clatter that slows and fades after a break: bits settling. */
  knockTail(at: number, count: number, spacing: number): void {
    for (let k = 0; k < count; k++) {
      const when = at + spacing * k * (1 + k * 0.12)
      const gain = 0.35 * (1 - k / count)
      this.noiseBurst(when, 0.05, 0.01, gain, { kind: 'band', freq: 1100 + ((k * 397) % 900), q: 2 })
    }
  }

  private mix(buf: Float32Array, at: number, gain: number): void {
    const start = Math.floor(at * this.rate)
    for (let n = 0; n < buf.length && start + n < this.out.length; n++) {
      this.out[start + n] = (this.out[start + n] as number) + (buf[n] as number) * gain
    }
  }

  /** Scale so the loudest sample is `peak`, with a short fade at the very end so nothing clicks. */
  finish(peak: number): Float32Array<ArrayBuffer> {
    let max = 0
    for (const v of this.out) max = Math.max(max, Math.abs(v))
    const k = max > 0 ? peak / max : 0
    const fade = Math.min(this.out.length, Math.floor(this.rate * 0.01))
    for (let n = 0; n < this.out.length; n++) {
      const tail = this.out.length - n
      this.out[n] = (this.out[n] as number) * k * (tail < fade ? tail / fade : 1)
    }
    return this.out
  }
}

/**
 * Work out one short sound. The seed varies the noise, so a few versions of
 * the same rattle don't sound like a machine gun.
 */
export function renderVoice(name: VoiceName, rate: number, seed = 1): Float32Array<ArrayBuffer> {
  switch (name) {
    case 'tick': {
      // A loose bit of metal tapping: a short, bright tick.
      const v = new Voice(rate, 0.06, seed)
      v.noiseBurst(0, 0.05, 0.006, 1, { kind: 'band', freq: 2400 + (seed % 5) * 260, q: 3 })
      v.ring(0, [3100 + (seed % 3) * 170], [0.008], 0.25)
      return v.finish(0.9)
    }
    case 'knock': {
      // A bush or a bump stop: a dull knock.
      const v = new Voice(rate, 0.09, seed)
      v.noiseBurst(0, 0.08, 0.018, 1, { kind: 'low', freq: 500 })
      v.thump(0, 170, 110, 0.06, 0.6)
      return v.finish(0.9)
    }
    case 'strike': {
      // A tire landing hard: a deep thump with a bit of grit.
      const v = new Voice(rate, 0.22, seed)
      v.thump(0, 95, 48, 0.18, 1)
      v.noiseBurst(0, 0.12, 0.025, 0.45, { kind: 'low', freq: 900 })
      return v.finish(0.95)
    }
    case 'rockStrike': {
      // Rubber on rock: a sharp clack over a thump.
      const v = new Voice(rate, 0.2, seed)
      v.noiseBurst(0, 0.05, 0.007, 1, { kind: 'band', freq: 1900, q: 1.6 })
      v.ring(0, [930, 1470, 2280], [0.02, 0.014, 0.01], 0.5)
      v.thump(0.002, 110, 55, 0.14, 0.7)
      return v.finish(0.95)
    }
    case 'clunk': {
      // Bottoming out: metal hitting metal, a heavy clunk with a short ring.
      const v = new Voice(rate, 0.5, seed)
      v.thump(0, 72, 36, 0.2, 1)
      v.noiseBurst(0, 0.06, 0.008, 0.6, { kind: 'band', freq: 1500, q: 1.2 })
      v.ring(0, [312, 497, 743, 1131], [0.09, 0.07, 0.05, 0.035], 0.55)
      return v.finish(0.98)
    }
    case 'hissOut': {
      // Damper fade: hot oil foaming, a long hiss that sputters out.
      const v = new Voice(rate, 1.4, seed)
      v.hiss(0, 1.35, 1, 4200, 1800, 0.6)
      v.knockTail(0.05, 7, 0.14)
      return v.finish(0.8)
    }
    case 'clang': {
      // Bottomed out for good: a big clang that rings on.
      const v = new Voice(rate, 1.4, seed)
      v.thump(0, 64, 30, 0.3, 1)
      v.noiseBurst(0, 0.08, 0.01, 0.7, { kind: 'band', freq: 1300, q: 1 })
      v.ring(0, [233, 389, 571, 862, 1240], [0.32, 0.26, 0.2, 0.14, 0.1], 0.8)
      return v.finish(0.98)
    }
    case 'crack': {
      // A mount cracking: a sharp crack, a ring, then a rattle.
      const v = new Voice(rate, 0.9, seed)
      v.noiseBurst(0, 0.03, 0.004, 1, { kind: 'high', freq: 1200 })
      v.ring(0, [640, 1020, 1690], [0.06, 0.045, 0.03], 0.6)
      v.knockTail(0.08, 6, 0.09)
      return v.finish(0.98)
    }
    case 'bang': {
      // An axle or CV letting go: a bang, a boom and a clatter.
      const v = new Voice(rate, 1.5, seed)
      v.noiseBurst(0, 0.04, 0.005, 1, { kind: 'high', freq: 600 })
      v.thump(0, 85, 32, 0.35, 1)
      v.ring(0.002, [620, 1710, 2930], [0.25, 0.16, 0.1], 0.45)
      v.knockTail(0.18, 9, 0.11)
      return v.finish(1)
    }
    case 'pop': {
      // A tire cut: a pop, then the air rushing out.
      const v = new Voice(rate, 1.3, seed)
      v.noiseBurst(0, 0.03, 0.004, 1, { kind: 'band', freq: 900, q: 0.8 })
      v.thump(0, 140, 60, 0.08, 0.6)
      v.hiss(0.02, 1.25, 0.55, 3200, 900, 0)
      return v.finish(0.95)
    }
    case 'groan': {
      // The frame cracking: a deep groan of steel, then a snap.
      const v = new Voice(rate, 1.2, seed)
      v.ring(0, [96, 141, 187], [0.18, 0.14, 0.1], 0.6)
      v.noiseBurst(0.18, 0.04, 0.005, 1, { kind: 'high', freq: 900 })
      v.ring(0.18, [181, 263, 412, 690], [0.3, 0.22, 0.15, 0.09], 0.7)
      v.thump(0.18, 60, 28, 0.3, 0.8)
      return v.finish(0.98)
    }
  }
}
