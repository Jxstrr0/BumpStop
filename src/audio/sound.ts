/**
 * The sound and the buzz (plan PR 6), played with the Web Audio API.
 *
 * Everything is made live, nothing is downloaded:
 * - **Engine:** the waveform of the engine's firing pattern (`profile.ts`),
 *   played at its speed in the gear the truck would be in, through a bit of
 *   grit and a tone filter that opens up with revs and load. Diesels add a
 *   knock in time with the firing; turbos a whistle and a whoosh.
 * - **Suspension:** rattles as busy as the suspension is, a thump or a clack
 *   for big tire strikes, and a clunk for every bottom-out (`cues.ts`).
 * - **Hot shocks:** a hiss that rises from the dampers' warm line to their red
 *   line, and sputters over it.
 * - **Breaks:** a sound for each failure (`voices.ts`), and the engine dies.
 * - **Buzz:** a short vibration on big hits and a long one on a break, on
 *   phones that can.
 *
 * Browsers only allow sound after a tap, so the shop calls `wake()` from its
 * buttons. Sound and buzz can each be switched off; the choice is kept in
 * localStorage (`bumpstop.sound`, `bumpstop.buzz`).
 */
import type { ClassId } from '../data/classes'
import type { FailureKind } from '../data/wear'
import { ENGINE_TONE, HISS, MIX, SHAKER_HUM } from '../data/sound'
import { breakCues, lapCues, newCueState, shakerClatter, type CueState, type Cues, type LapFrame } from './cues'
import { engineHarmonics, engineSound, engineSpeedFor } from './profile'
import { renderVoice, VOICE_NAMES, type VoiceName } from './voices'

const SOUND_KEY = 'bumpstop.sound'
const BUZZ_KEY = 'bumpstop.buzz'
/** Versions of each short sound, so repeats don't all sound the same. */
const TAKES = 3

export interface Sound {
  /** Whether this browser can play sound at all. */
  readonly canPlay: boolean
  /** Whether this phone can vibrate. */
  readonly canBuzz: boolean
  soundOn(): boolean
  buzzOn(): boolean
  setSound(on: boolean): void
  setBuzz(on: boolean): void
  /** Call from a tap: browsers only start sound after one. */
  wake(): void
  /** A lap run starts: the engine fires up. */
  startLaps(engineId: string, cls: ClassId): void
  /** The shaker starts: the engine idles and the rig hums. */
  startShaker(engineId: string, cls: ClassId): void
  /** One frame of a lap run. */
  lapFrame(frame: LapFrame): void
  /** One frame of the shaker: its beat (Hz) and how much the wheels move compared with the posts. */
  shakerFrame(realDt: number, beat: number, wheel: number, minBeat: number, maxBeat: number): void
  /** Something let go. */
  broke(kind: FailureKind): void
  /** The run is over (or stopped): fade it all out. */
  stop(): void
}

function readSetting(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off'
  } catch {
    return true
  }
}

function writeSetting(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // Private browsing or storage blocked: the switch still works until reload.
  }
}

/** The live sounds of one run; thrown away when it ends. */
interface RunVoices {
  nodes: AudioNode[]
  sources: AudioScheduledSourceNode[]
  engine: { osc: OscillatorNode; drive: GainNode; tone: BiquadFilterNode; gain: GainNode; level: number } | null
  knock: { pulse: OscillatorNode; depth: GainNode } | null
  turbo: { whistle: OscillatorNode; whistleGain: GainNode; whooshGain: GainNode } | null
  hiss: { gain: GainNode; sputter: GainNode } | null
  hum: { osc: OscillatorNode; gain: GainNode } | null
  engineId: string
  cls: ClassId
  cues: CueState
}

export function makeSound(): Sound {
  const Ctx: typeof AudioContext | undefined = typeof window !== 'undefined' ? window.AudioContext : undefined
  const canBuzz = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  let soundOn = readSetting(SOUND_KEY)
  let buzzOn = readSetting(BUZZ_KEY)
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  const buffers = new Map<VoiceName, AudioBuffer[]>()
  let run: RunVoices | null = null
  let take = 0

  /** Off-the-shelf randomness is fine here: it only varies the rattles, never the sim. */
  const rand = () => Math.random()

  function setUp(): void {
    if (ctx || !Ctx) return
    ctx = new Ctx()
    master = ctx.createGain()
    master.gain.value = soundOn ? MIX.master : 0
    // A gentle limiter, so a bang on top of a busy run never clips.
    const limit = ctx.createDynamicsCompressor()
    limit.threshold.value = -10
    limit.knee.value = 8
    limit.ratio.value = 6
    limit.attack.value = 0.003
    limit.release.value = 0.2
    master.connect(limit).connect(ctx.destination)

    // Two seconds of noise, looped, for the hiss, the diesel knock and the turbo.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let n = 0; n < data.length; n++) data[n] = Math.random() * 2 - 1

    for (const name of VOICE_NAMES) {
      const takes: AudioBuffer[] = []
      for (let k = 0; k < TAKES; k++) {
        const samples = renderVoice(name, ctx.sampleRate, k + 1)
        const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate)
        buf.copyToChannel(samples, 0)
        takes.push(buf)
      }
      buffers.set(name, takes)
    }

    // Pause the sound with the tab, so it never plays in the background.
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return
      if (document.hidden) void ctx.suspend()
      else if (run) void ctx.resume()
    })
  }

  function now(): number {
    return ctx ? ctx.currentTime : 0
  }

  function loopNoise(c: AudioContext, r: RunVoices): AudioBufferSourceNode {
    const src = c.createBufferSource()
    src.buffer = noise
    src.loop = true
    // Start each loop somewhere different so the layers don't line up.
    src.start(0, Math.random() * 2)
    r.sources.push(src)
    return src
  }

  function startRun(engineId: string, cls: ClassId, parked: boolean): void {
    stopNow()
    setUp()
    if (!ctx || !master || !noise) return
    const c = ctx
    const r: RunVoices = { nodes: [], sources: [], engine: null, knock: null, turbo: null, hiss: null, hum: null, engineId, cls, cues: newCueState() }
    const keep = <T extends AudioNode>(n: T): T => {
      r.nodes.push(n)
      return n
    }
    const t = now()

    // ── Engine ──
    const sound = engineSound(engineId)
    const { real, imag } = engineHarmonics(sound, ENGINE_TONE.harmonics)
    const osc = keep(c.createOscillator())
    osc.setPeriodicWave(c.createPeriodicWave(real, imag))
    osc.frequency.value = sound.idle / 120
    const drive = keep(c.createGain())
    drive.gain.value = 0.6
    const shaper = keep(c.createWaveShaper())
    shaper.curve = softClip()
    const tone = keep(c.createBiquadFilter())
    tone.type = 'lowpass'
    tone.Q.value = 0.8
    tone.frequency.value = ENGINE_TONE.cutoffIdle
    const level = parked ? MIX.engineParked : MIX.engine
    const gain = keep(c.createGain())
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(level * 0.6, t + 0.35)
    osc.connect(drive).connect(shaper).connect(tone).connect(gain).connect(master)
    osc.start()
    r.sources.push(osc)
    r.engine = { osc, drive, tone, gain, level }

    if (sound.fuel === 'diesel') {
      // Diesel knock: a band of noise, pulsed in time with the firing.
      const band = keep(c.createBiquadFilter())
      band.type = 'bandpass'
      band.frequency.value = ENGINE_TONE.knockBand
      band.Q.value = 1.5
      const knockGain = keep(c.createGain())
      knockGain.gain.value = 0
      const pulse = keep(c.createOscillator())
      pulse.setPeriodicWave(narrowPulse(c))
      pulse.frequency.value = (sound.idle / 120) * sound.firing.length
      const depth = keep(c.createGain())
      depth.gain.value = MIX.dieselClatter
      pulse.connect(depth).connect(knockGain.gain)
      loopNoise(c, r).connect(band).connect(knockGain).connect(gain)
      pulse.start()
      r.sources.push(pulse)
      r.knock = { pulse, depth }
    }
    if (sound.turbo) {
      const whistle = keep(c.createOscillator())
      whistle.type = 'sine'
      whistle.frequency.value = 1200
      const whistleGain = keep(c.createGain())
      whistleGain.gain.value = 0
      whistle.connect(whistleGain).connect(master)
      whistle.start()
      r.sources.push(whistle)
      const whooshBand = keep(c.createBiquadFilter())
      whooshBand.type = 'bandpass'
      whooshBand.frequency.value = 1800
      whooshBand.Q.value = 0.9
      const whooshGain = keep(c.createGain())
      whooshGain.gain.value = 0
      loopNoise(c, r).connect(whooshBand).connect(whooshGain).connect(master)
      r.turbo = { whistle, whistleGain, whooshGain }
    }

    // ── Hot-shock hiss, with a sputter over the red line ──
    const hissBand = keep(c.createBiquadFilter())
    hissBand.type = 'highpass'
    hissBand.frequency.value = 3500
    const hissGain = keep(c.createGain())
    hissGain.gain.value = 0
    loopNoise(c, r).connect(hissBand).connect(hissGain).connect(master)
    const lfo = keep(c.createOscillator())
    lfo.type = 'square'
    lfo.frequency.value = HISS.sputterHz
    const sputter = keep(c.createGain())
    sputter.gain.value = 0
    lfo.connect(sputter).connect(hissGain.gain)
    lfo.start()
    r.sources.push(lfo)
    r.hiss = { gain: hissGain, sputter }

    // ── The shaker's servo hum ──
    if (parked) {
      const humOsc = keep(c.createOscillator())
      humOsc.type = 'sawtooth'
      humOsc.frequency.value = SHAKER_HUM.low
      const humTone = keep(c.createBiquadFilter())
      humTone.type = 'lowpass'
      humTone.frequency.value = 700
      const humGain = keep(c.createGain())
      humGain.gain.setValueAtTime(0, t)
      humGain.gain.linearRampToValueAtTime(MIX.shakerHum, t + 0.5)
      humOsc.connect(humTone).connect(humGain).connect(master)
      humOsc.start()
      r.sources.push(humOsc)
      r.hum = { osc: humOsc, gain: humGain }
    }
    run = r
  }

  /** Move a level smoothly towards a target, so nothing clicks. */
  function glide(param: AudioParam, value: number, time: number = ENGINE_TONE.follow): void {
    param.setTargetAtTime(value, now(), time)
  }

  /** Set the engine to a road speed (m/s), with how hard it's working (0 to 1). */
  function driveEngine(r: RunVoices, speed: number, load: number, mute: boolean): void {
    if (!r.engine) return
    const sound = engineSound(r.engineId)
    const { rpm } = engineSpeedFor(r.engineId, r.cls, speed)
    const share = (rpm - sound.idle) / (sound.redline - sound.idle)
    const cycle = rpm / 120
    glide(r.engine.osc.frequency, cycle)
    glide(r.engine.drive.gain, 0.6 + (ENGINE_TONE.drive - 0.6) * load)
    glide(r.engine.tone.frequency, ENGINE_TONE.cutoffIdle + ENGINE_TONE.cutoffSpan * share * (0.4 + 0.6 * load))
    glide(r.engine.gain.gain, mute ? 0 : r.engine.level * (0.55 + 0.45 * load), mute ? 0.05 : 0.25)
    if (r.knock) {
      glide(r.knock.pulse.frequency, cycle * sound.firing.length)
      // Diesels knock loudest when they're working least.
      glide(r.knock.depth.gain, MIX.dieselClatter * (1.1 - 0.6 * load))
    }
    if (r.turbo) {
      const boost = Math.max(0, Math.min(1, (rpm / sound.redline - ENGINE_TONE.boostFrom) / (1 - ENGINE_TONE.boostFrom))) * load
      glide(r.turbo.whistle.frequency, 1200 + (ENGINE_TONE.whistleTop - 1200) * boost)
      glide(r.turbo.whistleGain.gain, mute ? 0 : MIX.turboWhistle * boost)
      glide(r.turbo.whooshGain.gain, mute ? 0 : MIX.turboWhoosh * boost)
    }
  }

  function setHiss(r: RunVoices, heat: number): void {
    if (!r.hiss) return
    const level = MIX.hiss * Math.min(1, Math.max(0, heat)) ** 1.5
    glide(r.hiss.gain.gain, level, 0.3)
    glide(r.hiss.sputter.gain, heat > 1 ? level * 0.7 : 0, 0.3)
  }

  function play(cues: Cues): void {
    if (!ctx || !master) return
    for (const shot of cues.shots) {
      const takes = buffers.get(shot.voice)
      if (!takes) continue
      const src = ctx.createBufferSource()
      src.buffer = takes[take++ % takes.length] as AudioBuffer
      src.playbackRate.value = shot.rate
      const g = ctx.createGain()
      g.gain.value = shot.gain
      src.connect(g).connect(master)
      src.start(now() + shot.delay)
    }
    if (cues.buzz && buzzOn && canBuzz) navigator.vibrate([...cues.buzz])
  }

  /** Fade the run's sounds out over `fade` seconds, then let them go. */
  function release(fade: number): void {
    const r = run
    run = null
    if (!r || !ctx) return
    const t = now()
    for (const n of r.nodes) {
      if (n instanceof GainNode) {
        n.gain.cancelScheduledValues(t)
        n.gain.setValueAtTime(n.gain.value, t)
        n.gain.linearRampToValueAtTime(0, t + fade)
      }
    }
    for (const s of r.sources) {
      try {
        s.stop(t + fade + 0.05)
      } catch {
        // Already stopped.
      }
    }
    window.setTimeout(() => {
      for (const n of r.nodes) n.disconnect()
      for (const s of r.sources) s.disconnect()
    }, (fade + 0.2) * 1000)
  }

  function stopNow(): void {
    release(0.05)
  }

  function wake(): void {
    if (!soundOn) return
    setUp()
    if (ctx && ctx.state !== 'running') void ctx.resume()
  }

  return {
    canPlay: Ctx !== undefined,
    canBuzz,
    soundOn: () => soundOn,
    buzzOn: () => buzzOn,
    setSound(on) {
      soundOn = on
      writeSetting(SOUND_KEY, on)
      if (on) wake()
      if (ctx && master) master.gain.setTargetAtTime(on ? MIX.master : 0, now(), 0.05)
    },
    setBuzz(on) {
      buzzOn = on
      writeSetting(BUZZ_KEY, on)
      if (on && canBuzz) navigator.vibrate([...BUZZ_TEST])
    },
    wake,
    startLaps(engineId, cls) {
      if (!soundOn) return
      startRun(engineId, cls, false)
    },
    startShaker(engineId, cls) {
      if (!soundOn) return
      startRun(engineId, cls, true)
    },
    lapFrame(frame) {
      const r = run
      if (!r) {
        // Sound off: still buzz.
        if (buzzOn && canBuzz && !frame.skipping) {
          const cues = lapCues(buzzOnly, frame, rand)
          if (cues.buzz) navigator.vibrate([...cues.buzz])
        }
        return
      }
      const cues = lapCues(r.cues, frame, rand)
      const load = Math.min(1, ENGINE_TONE.loadIdle + (1 - ENGINE_TONE.loadIdle) * (frame.speed / ENGINE_TONE.loadFullSpeed))
      driveEngine(r, frame.speed, load, frame.skipping)
      setHiss(r, cues.hiss)
      play(cues)
    },
    shakerFrame(realDt, beat, wheel, minBeat, maxBeat) {
      const r = run
      if (!r) return
      driveEngine(r, 0, ENGINE_TONE.loadIdle, false)
      if (r.hum) {
        const share = Math.log(beat / minBeat) / Math.log(maxBeat / minBeat)
        glide(r.hum.osc.frequency, SHAKER_HUM.low + (SHAKER_HUM.high - SHAKER_HUM.low) * share, 0.2)
      }
      // The rattles follow the wheels: they swell where the wheels hop.
      const clatter = shakerClatter(wheel)
      r.cues.tickCarry += 18 * clatter * realDt
      const shots: Cues['shots'] = []
      while (r.cues.tickCarry >= 1) {
        r.cues.tickCarry -= 1
        shots.push({ voice: rand() < 0.5 ? 'knock' : 'tick', gain: MIX.tick * clatter, rate: 0.85 + 0.3 * rand(), delay: rand() * realDt })
      }
      play({ shots, clatter, hiss: 0, buzz: null })
    },
    broke(kind) {
      const cues = breakCues(kind)
      const r = run
      if (r && ctx) {
        // The engine dies: its speed sags and it fades.
        const t = now()
        if (r.engine) r.engine.osc.frequency.setTargetAtTime(engineSound(r.engineId).idle / 160, t, 0.35)
        release(1.6)
        play(cues)
      } else if (cues.buzz && buzzOn && canBuzz) {
        navigator.vibrate([...cues.buzz])
      }
    },
    stop() {
      release(0.4)
    },
  }
}

/** The cues' memory when the sound is off but the buzz is on. */
const buzzOnly: CueState = newCueState()
/** A short buzz when the buzz is switched on, so the player feels it works. */
const BUZZ_TEST = [20] as const

/** A soft clip curve for the engine's grit. */
function softClip(): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6)
  }
  return curve
}

/** A narrow pulse: equal harmonics, for the diesel knock's timing. */
function narrowPulse(c: AudioContext): PeriodicWave {
  const n = 14
  const real = new Float32Array(n + 1)
  const imag = new Float32Array(n + 1)
  for (let k = 1; k <= n; k++) real[k] = 1 - k / (n + 1)
  return c.createPeriodicWave(real, imag)
}
