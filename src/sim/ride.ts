/**
 * The ride model (plan PR 1): a full-car model with seven moving parts.
 *
 * The body can bounce (up and down), pitch (nose up and down) and roll (side
 * to side). Each of the four wheels can move up and down on its own. That is
 * seven "degrees of freedom". Between body and wheel sit the spring, the
 * bump stop, the limit strap, the anti-roll bar and the damper; between wheel
 * and road sits the tire, which can leave the ground.
 *
 * Every step (500 a second) it works out each force, moves everything a
 * little, and turns the damper's work into heat in its oil. Hot oil damps
 * less (fade), cold oil damps more: that comes out of `dampingMultiplier`,
 * never a dice roll.
 *
 * Conventions: x is distance along the road, z is up. Pitch is positive nose
 * up, roll is positive left side up. Corners are numbered 0 front left,
 * 1 front right, 2 rear left, 3 rear right. "Compression" is how far the
 * wheel has moved up towards the body from ride height (negative = droop).
 * Positions are measured from where the truck sits at rest on flat ground.
 */
import { LEAN } from '../data/load'
import { BUMP_STOP, DAMPER_OIL, SIM, type AxleSetup, type BypassZones, type DamperSetup, type PositionDamping, type RideSetup } from '../data/ride'
import { detExp } from './det'
import { heightAt, type Profile } from './ground'

export const CORNERS = 4
const DT = 1 / SIM.stepsPerSecond
const G = SIM.gravity

/** Everything that changes from step to step. Plain numbers, so it can be saved and restored exactly. */
export interface RideState {
  /** Seconds simulated. */
  t: number
  /** Where the centre of mass is along the current section (m). */
  x: number
  /** Body bounce (m) and its speed (m/s). */
  z: number
  vz: number
  /** Body pitch (rad, nose up) and its rate (rad/s). */
  pitch: number
  vPitch: number
  /** Body roll (rad, left up) and its rate (rad/s). */
  roll: number
  vRoll: number
  /** Each wheel's height (m) and speed (m/s). */
  wheelZ: number[]
  wheelV: number[]
  /** Road height under each wheel last step, to work out how fast the road is pushing it (m). */
  roadPrev: number[]
  /** Damper oil temperature per corner (K). */
  oilTemp: number[]
  /** Whether each corner has hit its hard limit and not yet come back off the bump stop, to count each bottoming once. */
  bottomed: boolean[]
  /** Outside air (K). */
  airTemp: number
}

/** Fixed numbers for one truck, worked out once from its setup. Arrays are per corner. */
export interface RideParams {
  setup: RideSetup
  sprungMass: number
  pitchInertia: number
  rollInertia: number
  /** Corner position forward of the centre of mass (m). */
  cornerX: number[]
  /** Corner position left of the centre line (m). */
  cornerY: number[]
  axle: AxleSetup[]
  damper: DamperSetup[]
  /** Spring compression at rest (the sag) (m). */
  staticCompression: number[]
  /** Tire squash at rest (m). */
  staticTire: number[]
  /**
   * Each corner's bump and droop travel from its own ride height (m). Both
   * corners of an axle match unless the load leans the truck (`cgLeft`):
   * then the low side has less bump travel and more droop.
   */
  bumpTravel: number[]
  droopTravel: number[]
  /**
   * The anti-roll bar's twist at rest (m of left-minus-right travel): a
   * leaning truck sits with its bars already wound up a little, holding
   * part of the lean. 0 on a truck loaded evenly.
   */
  barRest: number[]
  /** Where the bump stop starts, as compression (m). */
  bumpStopStart: number[]
  /** The bump stop's extra stiffness that grows with squash (N/m²). */
  bumpStopRise: number[]
}

/** Running totals for a stretch of driving. */
export interface RideStats {
  steps: number
  time: number
  distance: number
  /** Heat each damper made (J). */
  damperEnergy: number[]
  peakTemp: number[]
  /** Lowest damping multiplier seen (1 = as set, below 1 = fading). */
  minDamping: number[]
  /** Times each corner hit its hard limit. */
  bottomOuts: number[]
  /** Most compression seen (m). */
  peakCompression: number[]
  /** Most droop seen, as a positive number (m). */
  peakDroop: number[]
  /** Biggest push between body and wheel: spring, bump stop and hard limit (N). */
  peakLoad: number[]
  /** Time with all four tires off the ground (s). */
  airTime: number
}

export interface TraceSample {
  t: number
  x: number
  oilTemp: number[]
  compression: number[]
}

/**
 * What each corner felt on one step, for the wear model (`src/sim/wear.ts`).
 * Filled in by `stepRide` when asked; arrays are per corner.
 */
export interface StepForces {
  /** Spring, bump stop, hard limit, strap, anti-roll bar and damper together: what the mounts carry (N, positive = squashing). */
  strut: number[]
  /** The metal-to-metal part of that, only while bottomed out (N). */
  hardStop: number[]
  /** Tire pushing up on the wheel (N, 0 = in the air). */
  tire: number[]
  /** How far the tire is squashed (m). */
  tireSquash: number[]
  /** Wheel travel from ride height (m, positive = up towards the body). */
  compression: number[]
}

export function emptyForces(): StepForces {
  return { strut: [0, 0, 0, 0], hardStop: [0, 0, 0, 0], tire: [0, 0, 0, 0], tireSquash: [0, 0, 0, 0], compression: [0, 0, 0, 0] }
}

export function axleOf(setup: RideSetup, corner: number): AxleSetup {
  return corner < 2 ? setup.front : setup.rear
}

export function rideParams(setup: RideSetup): RideParams {
  const a = setup.cgToFront
  const b = setup.cgToRear
  const w = setup.track / 2
  const y = setup.cgLeft ?? 0
  const axle = [setup.front, setup.front, setup.rear, setup.rear]
  // Each front corner carries the body's weight times b / (a + b), split two ways; the rear the rest.
  const axleCorner = [0, 1, 2, 3].map((i) => (setup.sprungMass * G * (i < 2 ? b : a)) / (a + b) / 2)
  // A centre of mass off to the left puts more on the left wheels: each axle's share leans by y / w.
  const lean = axleCorner.map((f, i) => (i % 2 === 0 ? 1 : -1) * ((f * y) / w))
  const cornerLoad = axleCorner.map((f, i) => f + (lean[i] as number))
  // The springs and the anti-roll bar share the lean between them: the bar takes k_bar·twist each side.
  const twist = axle.map((ax, i) => (2 * (lean[i] as number)) / (ax.springRate + 2 * ax.antiRollRate))
  // (A level truck keeps its travel exactly as set.)
  const lift = (base: number, i: number, sign: number) => {
    const d = twist[i] as number
    return d === 0 ? base : Math.max(LEAN.minTravel, base + (sign * d) / 2)
  }
  const bumpTravel = axle.map((ax, i) => lift(ax.bumpTravel, i, -1))
  const droopTravel = axle.map((ax, i) => lift(ax.droopTravel, i, 1))
  return {
    setup,
    sprungMass: setup.sprungMass,
    pitchInertia: setup.pitchInertia,
    rollInertia: setup.rollInertia,
    cornerX: [a, a, -b, -b],
    cornerY: [w - y, -w - y, w - y, -w - y],
    axle,
    damper: axle.map((ax) => ax.damper),
    staticCompression: axle.map((ax, i) => ((cornerLoad[i] as number) - ax.antiRollRate * (twist[i] as number)) / ax.springRate),
    staticTire: axle.map((ax, i) => ((cornerLoad[i] as number) + ax.unsprungMass * G) / ax.tireRate),
    bumpTravel,
    droopTravel,
    barRest: twist,
    bumpStopStart: axle.map((ax, i) => (bumpTravel[i] as number) - ax.bumpStopLength),
    bumpStopRise: axle.map((ax) => (ax.bumpStopRate * (ax.bumpStopProgression - 1)) / (2 * ax.bumpStopLength)),
  }
}

/** A truck at rest on flat ground, oil at `oilTemp` (defaults to the air temperature). */
export function restingState(airTemp: number, oilTemp = airTemp): RideState {
  return {
    t: 0,
    x: 0,
    z: 0,
    vz: 0,
    pitch: 0,
    vPitch: 0,
    roll: 0,
    vRoll: 0,
    wheelZ: [0, 0, 0, 0],
    wheelV: [0, 0, 0, 0],
    roadPrev: [0, 0, 0, 0],
    oilTemp: [oilTemp, oilTemp, oilTemp, oilTemp],
    bottomed: [false, false, false, false],
    airTemp,
  }
}

export function cloneState(s: RideState): RideState {
  return {
    ...s,
    wheelZ: s.wheelZ.slice(),
    wheelV: s.wheelV.slice(),
    roadPrev: s.roadPrev.slice(),
    oilTemp: s.oilTemp.slice(),
    bottomed: s.bottomed.slice(),
  }
}

export function emptyStats(): RideStats {
  return {
    steps: 0,
    time: 0,
    distance: 0,
    damperEnergy: [0, 0, 0, 0],
    peakTemp: [0, 0, 0, 0],
    minDamping: [Infinity, Infinity, Infinity, Infinity],
    bottomOuts: [0, 0, 0, 0],
    peakCompression: [0, 0, 0, 0],
    peakDroop: [0, 0, 0, 0],
    peakLoad: [0, 0, 0, 0],
    airTime: 0,
  }
}

/**
 * How hard a damper damps at this oil temperature, compared with how it was
 * set (1 at 40 °C). Below 1 is fade; above 1 is cold, stiff oil.
 */
export function dampingMultiplier(oilTemp: number, damper: DamperSetup): number {
  // A spool valve's ports care less how thick the oil is (`oilSense` below 1).
  const sense = damper.oilSense ?? 1
  let m = detExp(-DAMPER_OIL.viscositySlope * sense * (oilTemp - DAMPER_OIL.referenceTemp))
  // Below freezing the oil thickens faster (winter, plan PR 10).
  if (oilTemp < DAMPER_OIL.coldFrom) m *= detExp(DAMPER_OIL.coldSlope * sense * (DAMPER_OIL.coldFrom - oilTemp))
  const foam = (oilTemp - damper.aerationTemp) / DAMPER_OIL.aerationSpan
  if (foam > 0) m *= 1 - (1 - DAMPER_OIL.aerationFloor) * (foam > 1 ? 1 : foam)
  if (m > DAMPER_OIL.maxMultiplier) m = DAMPER_OIL.maxMultiplier
  if (m < DAMPER_OIL.minMultiplier) m = DAMPER_OIL.minMultiplier
  return m
}

/** Damper force for a shaft speed (m/s, compression positive), before the oil temperature. */
export function damperForce(speed: number, d: DamperSetup): number {
  if (speed >= 0) return speed <= d.knee ? d.compLow * speed : d.compLow * d.knee + d.compHigh * (speed - d.knee)
  const s = -speed
  return -(s <= d.knee ? d.rebLow * s : d.rebLow * d.knee + d.rebHigh * (s - d.knee))
}

/**
 * Position-sensitive damping: how hard the damper damps at this point in the
 * travel, as a share of its setting. `c` is compression from ride height (m,
 * + is up), `v` the shaft speed (+ is compression). 1 for a damper that damps
 * the same all the way through.
 *
 * Two kinds, both firming compression near the bump end and rebound near the
 * droop end:
 * - spool valves (`DamperSetup.position`): a smooth climb (the square of how
 *   far into the end zone the wheel is), so there is no sudden step for the
 *   wheel to bounce off;
 * - bypass tubes (`DamperSetup.zones`): flat steps, one per tube, each with a
 *   short ramp as the piston slides over the tube's last port (`bypassScale`).
 */
export function positionScale(c: number, v: number, d: DamperSetup, bumpTravel: number, droopTravel: number): number {
  const pd = d.position
  const z = d.zones
  if (!pd && !z) return 1
  // How far out the wheel is, as a share of the travel on the side that firms up for this stroke.
  let out = 0
  if (v > 0) out = bumpTravel > 0 ? c / bumpTravel : 0
  else if (v < 0) out = droopTravel > 0 ? -c / droopTravel : 0
  if (z) return bypassScale(out, z)
  // Spool valve (pd is set here).
  const p = pd as PositionDamping
  if (p.zone <= 0) return p.mid
  let into = (out - (1 - p.zone)) / p.zone
  if (into <= 0) return p.mid
  if (into > 1) into = 1
  return p.mid + (p.end - p.mid) * into * into
}

/**
 * Bypass damping at `out`, the share of the travel from ride height (0) to the
 * end (1, and beyond on the bump stop). Starts at `mid`; each tube's step eases
 * in over `port` (smoothstep, so the force has no corner) and then holds.
 */
export function bypassScale(out: number, z: BypassZones): number {
  let k = z.mid
  for (const step of z.steps) {
    let t = z.port > 0 ? (out - step.from) / z.port : out >= step.from ? 1 : 0
    if (t <= 0) break
    if (t > 1) t = 1
    k += (step.scale - k) * t * t * (3 - 2 * t)
    if (t < 1) break
  }
  return k
}

/** Heat each damper sheds per kelvin above the air at this road speed (W/K). */
export function coolingRate(d: DamperSetup, speed: number): number {
  return d.coolStill + d.coolPerSpeed * speed
}

/** The road under a corner's wheel track. */
function trackOf(profile: Profile, corner: number): Float64Array {
  return corner % 2 === 0 ? profile.left : profile.right
}

/**
 * The road as a tire feels it at distance x: the average of the heights at
 * the back, middle and front of its footprint, so it partly swallows bumps
 * shorter than the footprint.
 */
export function roadUnder(profile: Profile, corner: number, x: number, footprint: number): number {
  const track = trackOf(profile, corner)
  const half = footprint / 2
  return (
    (heightAt(track, profile.step, x - half) + heightAt(track, profile.step, x) + heightAt(track, profile.step, x + half)) / 3
  )
}

/** Put the truck at the start of a section: rear axle on the first metre, the road under each wheel noted. */
export function enterSection(s: RideState, p: RideParams, profile: Profile): void {
  s.x = p.setup.cgToRear
  for (let i = 0; i < CORNERS; i++) {
    s.roadPrev[i] = roadUnder(profile, i, s.x + (p.cornerX[i] as number), (p.axle[i] as AxleSetup).footprint)
  }
}

// Scratch space for one step, reused so the hot loop makes no garbage.
const comp = [0, 0, 0, 0]
const compSpeed = [0, 0, 0, 0]

/**
 * Move the truck one step (1/500 s) along `profile` at `speed` (m/s).
 * Changes `s` in place. Adds to `stats` if given, and fills in `forces` if given.
 */
export function stepRide(
  s: RideState,
  p: RideParams,
  profile: Profile,
  speed: number,
  stats?: RideStats,
  forces?: StepForces,
): void {
  // Where each corner of the body is, and how fast it moves.
  for (let i = 0; i < CORNERS; i++) {
    const cx = p.cornerX[i] as number
    const cy = p.cornerY[i] as number
    const bodyZ = s.z + cx * s.pitch + cy * s.roll
    const bodyV = s.vz + cx * s.vPitch + cy * s.vRoll
    comp[i] = (s.wheelZ[i] as number) - bodyZ
    compSpeed[i] = (s.wheelV[i] as number) - bodyV
  }

  let bodyForce = 0
  let pitchMoment = 0
  let rollMoment = 0
  let wheelsDown = 0

  for (let i = 0; i < CORNERS; i++) {
    const ax = p.axle[i] as AxleSetup
    const dm = p.damper[i] as DamperSetup
    const c = comp[i] as number
    const v = compSpeed[i] as number
    const bump = p.bumpTravel[i] as number
    const droop = p.droopTravel[i] as number

    // Spring: pushes while it is still compressed at all (a coil can fall loose at full droop).
    const springLen = (p.staticCompression[i] as number) + c
    let load = springLen > 0 ? ax.springRate * springLen : 0
    // Limit strap at full droop pulls the wheel back up.
    if (c < -droop) load -= ax.limitStrapRate * (-droop - c)
    // Bump stop: soft at first touch, stiffer as it squashes.
    const e = c - (p.bumpStopStart[i] as number)
    if (e > 0) {
      load += ax.bumpStopRate * e + (p.bumpStopRise[i] as number) * e * e
      // A hydraulic stop also damps while it's being squashed, biting fully once the piston is `engage` in.
      const bsd = ax.bumpStopDamping ?? 0
      if (bsd > 0 && v > 0) load += bsd * v * (e < BUMP_STOP.engage ? e / BUMP_STOP.engage : 1)
    }
    // Hard limit: metal to metal. Bottoming out.
    const hard = c - bump
    const hardForce = hard > 0 ? ax.hardStopRate * hard : 0
    if (hard > 0) {
      load += hardForce
      if (!s.bottomed[i]) {
        s.bottomed[i] = true
        if (stats) stats.bottomOuts[i] = (stats.bottomOuts[i] as number) + 1
      }
    } else if (s.bottomed[i] && e < 0) {
      // Count the next bottoming only once the wheel has come back off the bump stop,
      // so one hard landing that rattles on the limit counts once.
      s.bottomed[i] = false
    }
    // Anti-roll bar: resists the left and right wheels on one axle moving differently
    // (plus any twist it holds at rest on a leaning truck).
    const other = i % 2 === 0 ? i + 1 : i - 1
    const bar = ax.antiRollRate * (c - (comp[other] as number) + (p.barRest[i] as number))

    // Damper: force from shaft speed, scaled by how thin the oil is right now.
    const temp = s.oilTemp[i] as number
    const mult = dampingMultiplier(temp, dm)
    // Spool-valve and bypass dampers also damp by where the wheel is in its travel.
    const damp =
      damperForce(v, dm) * mult * (dm.position || dm.zones ? positionScale(c, v, dm, bump, droop) : 1)
    const power = damp * v // always >= 0: a damper only ever turns motion into heat

    const strut = load + bar + damp // pushes the body up and the wheel down

    // Tire: a stiff spring that can only push, so the wheel can leave the ground.
    const road = roadUnder(profile, i, s.x + (p.cornerX[i] as number), ax.footprint)
    const roadV = (road - (s.roadPrev[i] as number)) / DT
    s.roadPrev[i] = road
    const squash = (p.staticTire[i] as number) + road - (s.wheelZ[i] as number)
    let tire = 0
    if (squash > 0) {
      tire = ax.tireRate * squash + ax.tireDamping * (roadV - (s.wheelV[i] as number))
      if (tire < 0) tire = 0
      wheelsDown++
    }

    // Wheel: tire pushes up, strut pushes down, gravity pulls down.
    const wheelAcc = (tire - strut) / ax.unsprungMass - G
    s.wheelV[i] = (s.wheelV[i] as number) + wheelAcc * DT

    bodyForce += strut
    pitchMoment += strut * (p.cornerX[i] as number)
    rollMoment += strut * (p.cornerY[i] as number)

    // Heat: the damper's work goes into the oil; air flowing past takes some away.
    const cool = coolingRate(dm, speed) * (temp - s.airTemp)
    s.oilTemp[i] = temp + ((power - cool) * DT) / dm.heatCapacity

    if (forces) {
      forces.strut[i] = strut
      forces.hardStop[i] = hardForce
      forces.tire[i] = tire
      forces.tireSquash[i] = squash > 0 ? squash : 0
      forces.compression[i] = c
    }

    if (stats) {
      stats.damperEnergy[i] = (stats.damperEnergy[i] as number) + power * DT
      if (temp > (stats.peakTemp[i] as number)) stats.peakTemp[i] = temp
      if (mult < (stats.minDamping[i] as number)) stats.minDamping[i] = mult
      if (c > (stats.peakCompression[i] as number)) stats.peakCompression[i] = c
      if (-c > (stats.peakDroop[i] as number)) stats.peakDroop[i] = -c
      if (load > (stats.peakLoad[i] as number)) stats.peakLoad[i] = load
    }
  }

  // Body: semi-implicit Euler (new speeds first, then positions from the new speeds), which stays stable at 500 Hz.
  s.vz += (bodyForce / p.sprungMass - G) * DT
  s.vPitch += (pitchMoment / p.pitchInertia) * DT
  s.vRoll += (rollMoment / p.rollInertia) * DT
  s.z += s.vz * DT
  s.pitch += s.vPitch * DT
  s.roll += s.vRoll * DT
  for (let i = 0; i < CORNERS; i++) s.wheelZ[i] = (s.wheelZ[i] as number) + (s.wheelV[i] as number) * DT

  s.x += speed * DT
  s.t += DT

  if (stats) {
    stats.steps++
    stats.time += DT
    stats.distance += speed * DT
    if (wheelsDown === 0) stats.airTime += DT
  }
}

export interface DriveOptions {
  /** Road speed (m/s). */
  speed: number
  /** Record a trace sample every this many steps (0 or missing = no trace). */
  traceEvery?: number
}

export interface DriveResult {
  stats: RideStats
  trace: TraceSample[]
}

/** Drive one whole section, from the rear axle on its start to the front axle on its end. */
export function driveSection(s: RideState, p: RideParams, profile: Profile, opts: DriveOptions): DriveResult {
  enterSection(s, p, profile)
  const stats = emptyStats()
  const trace: TraceSample[] = []
  const usable = profile.length - p.setup.cgToFront - p.setup.cgToRear
  const steps = opts.speed > 0 ? Math.max(0, Math.floor(usable / (opts.speed * DT))) : 0
  const every = opts.traceEvery ?? 0
  for (let n = 0; n < steps; n++) {
    stepRide(s, p, profile, opts.speed, stats)
    if (every > 0 && n % every === 0) {
      trace.push({ t: s.t, x: s.x, oilTemp: s.oilTemp.slice(), compression: comp.slice() })
    }
  }
  for (let i = 0; i < CORNERS; i++) if (stats.minDamping[i] === Infinity) stats.minDamping[i] = 1
  return { stats, trace }
}

/**
 * Mechanical energy (J): movement, height, and everything springy (springs,
 * bump stops, straps, anti-roll bars, tires). Heat is not included, so with
 * the dampers working this only ever drains away. Used by the energy tests.
 */
export function rideEnergy(s: RideState, p: RideParams, profile: Profile): number {
  let e =
    0.5 * p.sprungMass * s.vz * s.vz +
    0.5 * p.pitchInertia * s.vPitch * s.vPitch +
    0.5 * p.rollInertia * s.vRoll * s.vRoll +
    p.sprungMass * G * s.z
  const c: number[] = []
  for (let i = 0; i < CORNERS; i++) {
    c[i] = (s.wheelZ[i] as number) - (s.z + (p.cornerX[i] as number) * s.pitch + (p.cornerY[i] as number) * s.roll)
  }
  for (let i = 0; i < CORNERS; i++) {
    const ax = p.axle[i] as AxleSetup
    const ci = c[i] as number
    const wv = s.wheelV[i] as number
    e += 0.5 * ax.unsprungMass * wv * wv + ax.unsprungMass * G * (s.wheelZ[i] as number)
    const len = (p.staticCompression[i] as number) + ci
    if (len > 0) e += 0.5 * ax.springRate * len * len
    const droop = p.droopTravel[i] as number
    if (ci < -droop) e += 0.5 * ax.limitStrapRate * (-droop - ci) * (-droop - ci)
    const bs = ci - (p.bumpStopStart[i] as number)
    if (bs > 0) e += 0.5 * ax.bumpStopRate * bs * bs + ((p.bumpStopRise[i] as number) * bs * bs * bs) / 3
    const hard = ci - (p.bumpTravel[i] as number)
    if (hard > 0) e += 0.5 * ax.hardStopRate * hard * hard
    if (i % 2 === 0) {
      const diff = ci - (c[i + 1] as number) + (p.barRest[i] as number)
      e += 0.5 * ax.antiRollRate * diff * diff
    }
    const road = roadUnder(profile, i, s.x + (p.cornerX[i] as number), ax.footprint)
    const squash = (p.staticTire[i] as number) + road - (s.wheelZ[i] as number)
    if (squash > 0) e += 0.5 * ax.tireRate * squash * squash
  }
  return e
}
