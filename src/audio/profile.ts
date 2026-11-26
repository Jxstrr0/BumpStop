/**
 * The engine voice's maths (plan PR 6), kept apart from the Web Audio code
 * so the tests can check it: the waveform an engine's firing pattern makes,
 * and how fast the engine turns at a road speed.
 *
 * The idea comes from Prairie Engine Works (an engine voice built from the
 * engine's specs); this is a fresh version for Bump Stop, not copied code.
 */
import type { ClassId } from '../data/classes'
import { ENGINE_SOUNDS, GEARBOXES, type EngineSound, type Gearbox } from '../data/sound'

/** The sound of an engine part, or the class's first engine if the id is unknown. */
export function engineSound(id: string): EngineSound {
  return ENGINE_SOUNDS[id] ?? (ENGINE_SOUNDS.petrolSix as EngineSound)
}

/**
 * The waveform of one engine cycle (two turns of the crank) as harmonics,
 * ready for `createPeriodicWave`: harmonic k plays at k × rpm / 120.
 *
 * Each firing is a short bump of pressure (a bell curve `pulseWidth` degrees
 * wide). A train of bumps at the firing angles, each as loud as its `pulse`,
 * adds up harmonic by harmonic: an evenly firing engine only has the
 * harmonics at multiples of its cylinder count; uneven firing or uneven
 * pulses fill in the ones between (the V8's burble, the twin's lope).
 *
 * Index 0 (the steady part) is always 0. The loudest harmonic is 1.
 */
export function engineHarmonics(sound: EngineSound, count: number): { real: Float32Array<ArrayBuffer>; imag: Float32Array<ArrayBuffer> } {
  const real = new Float32Array(count + 1)
  const imag = new Float32Array(count + 1)
  const width = (sound.pulseWidth / 720) * 2 * Math.PI
  let loudest = 0
  for (let k = 1; k <= count; k++) {
    // A bell-curve pulse's harmonics fall away as a bell curve too.
    const shape = Math.exp(-0.5 * (k * width) ** 2)
    let re = 0
    let im = 0
    sound.firing.forEach((deg, j) => {
      const angle = k * (deg / 720) * 2 * Math.PI
      const a = sound.pulse[j] ?? 1
      re += a * Math.cos(angle)
      im += a * Math.sin(angle)
    })
    real[k] = re * shape
    imag[k] = im * shape
    loudest = Math.max(loudest, Math.hypot(real[k] as number, imag[k] as number))
  }
  if (loudest > 0) {
    for (let k = 1; k <= count; k++) {
      real[k] = (real[k] as number) / loudest
      imag[k] = (imag[k] as number) / loudest
    }
  }
  return { real, imag }
}

/** How loud harmonic k is (0 to 1). */
export function harmonicLevel(h: { real: Float32Array<ArrayBuffer>; imag: Float32Array<ArrayBuffer> }, k: number): number {
  return Math.hypot(h.real[k] ?? 0, h.imag[k] ?? 0)
}

export interface EngineSpeed {
  /** Engine speed (rpm). */
  rpm: number
  /** The gear (1 = first), or 0 for a CVT. */
  gear: number
}

/** Engine speed at a road speed (m/s) for this class's gearbox. Always between idle and the red line. */
export function engineSpeed(sound: EngineSound, box: Gearbox, speed: number): EngineSpeed {
  const kmh = Math.max(0, speed * 3.6)
  const clamp = (rpm: number) => Math.min(sound.redline, Math.max(sound.idle, rpm))
  if (box.kind === 'cvt') {
    const engage = sound.redline * box.engageShare
    const hold = sound.redline * box.holdShare
    if (kmh <= 0) return { rpm: sound.idle, gear: 0 }
    // Up to the holding speed the belt lets the revs rise; after that they creep towards the red line.
    const rpm =
      kmh < box.holdFromKmh
        ? engage + (hold - engage) * (kmh / box.holdFromKmh)
        : hold + (sound.redline * 0.96 - hold) * Math.min(1, (kmh - box.holdFromKmh) / (box.topKmh - box.holdFromKmh))
    return { rpm: clamp(rpm), gear: 0 }
  }
  const top = box.ratios[box.ratios.length - 1] as number
  const lug = sound.redline * box.lugShare
  // The highest gear that keeps the engine above its lugging speed; first gear if none does.
  for (let g = box.ratios.length; g >= 1; g--) {
    const kmhPer1000 = box.topKmhPer1000 * (top / (box.ratios[g - 1] as number))
    const rpm = (kmh / kmhPer1000) * 1000
    if (rpm >= lug || g === 1) return { rpm: clamp(rpm), gear: g }
  }
  return { rpm: sound.idle, gear: 1 }
}

/** Engine speed for a class at a road speed, from the engine part's id. */
export function engineSpeedFor(engineId: string, cls: ClassId, speed: number): EngineSpeed {
  return engineSpeed(engineSound(engineId), GEARBOXES[cls], speed)
}
