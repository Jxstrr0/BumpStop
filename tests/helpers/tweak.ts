import type { Tweak } from '../../src/data/balance'
import type { RideSetup } from '../../src/data/ride'
import type { FatigueSpec, WearSetup } from '../../src/data/wear'

/** Two tweaks on top of each other: their multipliers multiply. */
export function combine(a: Tweak, b: Tweak): Tweak {
  const out: Tweak = { ...a }
  for (const [k, v] of Object.entries(b) as [keyof Tweak, number][]) out[k] = (out[k] ?? 1) * v
  return out
}

function scaleFatigue(f: FatigueSpec, k: number): void {
  f.ultimate *= k
  f.endurance *= k
  f.gate *= k
}

/** A copy of a test mule (ride and wear) with the tweak's numbers scaled. */
export function tweaked(ride: RideSetup, wear: WearSetup, t: Tweak): { ride: RideSetup; wear: WearSetup } {
  const r = structuredClone(ride)
  const w = structuredClone(wear)
  const g = 9.81
  const a = r.cgToFront
  const b = r.cgToRear
  const sag: number[] = []
  for (const ax of [r.front, r.rear]) {
    // A different spring with the same shock sags a different amount, which moves the ride height:
    // a softer spring sits lower, so the wheel has less travel up to the bump stop and more down.
    const cornerLoad = (r.sprungMass * g * (ax === r.front ? b : a)) / (a + b) / 2
    const sagBefore = cornerLoad / ax.springRate
    ax.springRate *= t.springRate ?? 1
    const extraSag = cornerLoad / ax.springRate - sagBefore
    ax.bumpTravel -= extraSag
    ax.droopTravel += extraSag
    sag.push(extraSag)
    const d = ax.damper
    const damping = t.damping ?? 1
    d.compLow *= damping
    d.compHigh *= damping
    d.rebLow *= damping
    d.rebHigh *= damping
    // A bigger damper holds more oil and has more outside to shed heat from (area grows as size^(2/3)).
    const size = t.damperSize ?? 1
    d.heatCapacity *= size
    d.coolStill *= Math.pow(size, 2 / 3)
    d.coolPerSpeed *= Math.pow(size, 2 / 3)
    ax.bumpStopLength *= t.bumpStopLength ?? 1
    ax.droopTravel *= t.droopTravel ?? 1
    ax.tireRate *= t.tireRate ?? 1
  }
  for (const [k, aw] of [w.front, w.rear].entries()) {
    // The axle or CV runs straight at the same place in the shock's stroke, which is now nearer the new ride height.
    aw.axle.straightAt -= sag[k] as number
    scaleFatigue(aw.bottoming, t.shockStrength ?? 1)
    scaleFatigue(aw.mount, t.mountStrength ?? 1)
    aw.axle.strength *= t.axleStrength ?? 1
    aw.tire.bruiseFrom *= t.casing ?? 1
    aw.tire.pinchAt *= t.casing ?? 1
  }
  for (const zone of ['front', 'centre', 'rear'] as const) scaleFatigue(w.frame[zone], t.frameStrength ?? 1)
  return { ride: r, wear: w }
}
