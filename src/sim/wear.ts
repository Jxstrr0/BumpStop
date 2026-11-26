/**
 * Wear and breaks (plan PR 2). Runs alongside the ride model, one step at a
 * time, reading what each corner felt (`StepForces`) and adding up damage.
 *
 * Six ways to break, each from its own cause:
 *
 * - **Damper fade:** oil over its red line for `WEAR.fadeHold` seconds. The
 *   heat comes from the ride model's physics, never a dice roll.
 * - **Bottoming:** fatigue from metal-to-metal hits at the end of the
 *   wheel's travel (soft springs bottom more often), or one hit harder than
 *   the shock can take.
 * - **Cracked mount:** fatigue from the strut load swinging up and down, hit
 *   after hit, or one load bigger than the mount.
 * - **Snapped axle or CV:** the joint's torque against its strength, which
 *   drops as the joint works at an angle. A wheel that spins up in the air
 *   and lands slams the most torque through it, as much as the tire can
 *   grip the ground (less on ice and snow). Past its biggest angle the
 *   joint binds and snaps.
 * - **Cut tire:** squashed onto the rim over a sharp edge cuts it at once;
 *   smaller folds over sharp edges bruise the casing until it gives.
 * - **Frame crack:** fatigue in three zones (front, centre twist, rear).
 *
 * The whole state is plain numbers, so a run can be saved and carried on.
 */
import { GROUND } from '../data/ground'
import { SIM, type DamperSetup } from '../data/ride'
import { FRAME_ZONES, WEAR, type AxleWear, type FailureKind, type FatigueSpec, type FrameZone, type WearSetup } from '../data/wear'
import { detAtan } from './det'
import { heightAt, type Profile } from './ground'
import { CORNERS, emptyForces, emptyStats, enterSection, stepRide, type RideParams, type RideState, type RideStats, type StepForces } from './ride'
import { notePose, type PoseLog } from './poses'
import { newRecorder, record, type TraceRecorder } from './trace'

const DT = 1 / SIM.stepsPerSecond

/** One part's running fatigue count. */
export interface Fatigue {
  /** 0 = new, 1 = broken. */
  damage: number
  /** The load at the last turn (a peak or a valley). */
  lastTurn: number
  /** The furthest the load has gone since that turn. */
  extreme: number
  /** +1 while the load is rising, -1 while falling, 0 before the first move. */
  dir: number
  /** True until the first load arrives. */
  fresh: boolean
}

export function newFatigue(): Fatigue {
  return { damage: 0, lastTurn: 0, extreme: 0, dir: 0, fresh: true }
}

/**
 * Feed one load into a fatigue count. Each completed swing (low to high, or
 * high to low) is half a cycle and adds 0.5 × (range ÷ ultimate)^exponent,
 * if the range is above the endurance limit. A load beyond `ultimate` breaks
 * the part at once. Damage is capped at 1.
 */
export function feedFatigue(f: Fatigue, spec: FatigueSpec, load: number): void {
  if (f.fresh) {
    f.fresh = false
    f.lastTurn = load
    f.extreme = load
  }
  if ((load < 0 ? -load : load) >= spec.ultimate) f.damage = 1
  if (f.dir === 0) {
    // Before the first real move, wait for the load to leave the gate either way.
    if (load - f.lastTurn > spec.gate) f.dir = 1
    else if (f.lastTurn - load > spec.gate) f.dir = -1
    f.extreme = load
  } else if ((load - f.extreme) * f.dir > 0) {
    // Still going the same way: a new extreme.
    f.extreme = load
  } else if ((f.extreme - load) * f.dir > spec.gate) {
    // The load has turned back by more than the gate: the swing to the extreme is complete.
    halfCycle(f, spec, f.extreme - f.lastTurn)
    f.lastTurn = f.extreme
    f.extreme = load
    f.dir = -f.dir
  }
}

function halfCycle(f: Fatigue, spec: FatigueSpec, swing: number): void {
  const range = swing < 0 ? -swing : swing
  if (range < spec.endurance) return
  const r = range / spec.ultimate
  // r^exponent by repeated multiplying (exponents are whole numbers in the data; det.ts rules out Math.pow).
  let d = 0.5
  for (let k = 0; k < spec.exponent; k++) d *= r
  f.damage += d
  if (f.damage > 1) f.damage = 1
}

/** How a part broke, where, and the numbers that show why. */
export interface BreakEvent {
  kind: FailureKind
  /** The corner (0 front left, 1 front right, 2 rear left, 3 rear right), or -1 for the frame. */
  corner: number
  /** The frame zone, for a frame crack. */
  zone: FrameZone | null
  /** Seconds into the run. */
  t: number
  /** Metres into the run. */
  distance: number
  /** Road speed at the time (m/s). */
  speed: number
  /** The number that crossed the line: oil temperature (K), force (N), angle (rad), squash (m) or damage (0 to 1). */
  value: number
  /** The line it crossed, in the same units. */
  limit: number
  /** True if it broke from damage built up over time (fatigue) rather than a single hit. */
  fatigue: boolean
  /**
   * True if a long stage worked it out from its samples rather than driving
   * the moment it broke (see `src/sim/stage.ts`); such a break has no trace.
   */
  estimated: boolean
}

/** Everything about wear that changes step to step. Plain numbers, so it can be saved. */
export interface WearState {
  bottoming: Fatigue[]
  mount: Fatigue[]
  axle: Fatigue[]
  tire: Fatigue[]
  /** In `FRAME_ZONES` order: front, centre, rear. */
  frame: Fatigue[]
  /** How far each wheel has spun up past road speed, 0 to 1. */
  spin: number[]
  /** Seconds each damper has been over its red line without a break. */
  overRed: number[]
  /** Seconds and metres since the start of the run. */
  t: number
  distance: number
  /** The first thing that broke, or null. */
  broken: BreakEvent | null
}

export function newWearState(): WearState {
  const four = () => [newFatigue(), newFatigue(), newFatigue(), newFatigue()]
  return {
    bottoming: four(),
    mount: four(),
    axle: four(),
    tire: four(),
    frame: FRAME_ZONES.map(() => newFatigue()),
    spin: [0, 0, 0, 0],
    overRed: [0, 0, 0, 0],
    t: 0,
    distance: 0,
    broken: null,
  }
}

/** Fixed numbers for one truck's wear, worked out once. */
export interface WearParams {
  setup: WearSetup
  /** Per corner. */
  axle: AxleWear[]
  damper: DamperSetup[]
  footprint: number[]
  /** Half the track (m), for the frame's twist. */
  halfTrack: number
}

export function wearParams(setup: WearSetup, ride: RideParams): WearParams {
  return {
    setup,
    axle: [setup.front, setup.front, setup.rear, setup.rear],
    damper: ride.damper,
    footprint: ride.axle.map((a) => a.footprint),
    halfTrack: ride.setup.track / 2,
  }
}

/** What the wear model worked out on the last step, for the traces. Per corner unless noted. */
export interface WearReadings {
  /** Joint angle (rad). */
  jointAngle: number[]
  /** Torque through the axle or CV (N·m). */
  jointTorque: number[]
  /** Share of the joint's strength (at its angle) in use: 1 = it snaps. */
  strengthUse: number[]
  /** Steepness of the ground under the tire (rise per metre). */
  edge: number[]
  /** Front and rear strut loads added together (N), and the twist between them (N·m). */
  frameFront: number
  frameRear: number
  frameTwist: number
}

export function emptyReadings(): WearReadings {
  return {
    jointAngle: [0, 0, 0, 0],
    jointTorque: [0, 0, 0, 0],
    strengthUse: [0, 0, 0, 0],
    edge: [0, 0, 0, 0],
    frameFront: 0,
    frameRear: 0,
    frameTwist: 0,
  }
}

/** The steepest rise or drop under a tire's footprint (rise per metre). */
function edgeUnder(profile: Profile, corner: number, x: number, footprint: number): number {
  const track = corner % 2 === 0 ? profile.left : profile.right
  const half = footprint / 2
  const back = heightAt(track, profile.step, x - half)
  const mid = heightAt(track, profile.step, x)
  const front = heightAt(track, profile.step, x + half)
  const a = (mid - back) / half
  const b = (front - mid) / half
  const aa = a < 0 ? -a : a
  const bb = b < 0 ? -b : b
  return aa > bb ? aa : bb
}

/**
 * Add one step of wear, after `stepRide` has filled in `f`. Returns the break
 * if something let go on this step (also kept in `w.broken`). Once broken,
 * nothing more is added.
 */
export function stepWear(
  w: WearState,
  wp: WearParams,
  s: RideState,
  ride: RideParams,
  f: StepForces,
  profile: Profile,
  speed: number,
  readings?: WearReadings,
): BreakEvent | null {
  if (w.broken) return null
  w.t += DT
  w.distance += speed * DT
  let found: BreakEvent | null = null
  // How hard a tire can grip this ground: on ice a landing on a spinning wheel just spins, so the axle feels less.
  const ground = GROUND[profile.ground]
  const brk = (kind: FailureKind, corner: number, zone: FrameZone | null, value: number, limit: number, fatigue: boolean) => {
    if (!found) found = { kind, corner, zone, t: w.t, distance: w.distance, speed, value, limit, fatigue, estimated: false }
  }

  for (let i = 0; i < CORNERS; i++) {
    const aw = wp.axle[i] as AxleWear
    const dm = wp.damper[i] as DamperSetup

    // Damper fade: over the red line for long enough.
    const temp = s.oilTemp[i] as number
    if (temp > dm.redLine) {
      w.overRed[i] = (w.overRed[i] as number) + DT
      if ((w.overRed[i] as number) >= WEAR.fadeHold) brk('fade', i, null, temp, dm.redLine, false)
    } else {
      w.overRed[i] = 0
    }

    // Bottoming: every metal-to-metal hit knocks the shock; one too hard breaks it.
    const hard = f.hardStop[i] as number
    const bottom = w.bottoming[i] as Fatigue
    feedFatigue(bottom, aw.bottoming, hard)
    if (bottom.damage >= 1) brk('bottoming', i, null, hard, aw.bottoming.ultimate, hard < aw.bottoming.ultimate)

    // Mounts: fatigue from the strut load.
    const strut = f.strut[i] as number
    const mount = w.mount[i] as Fatigue
    feedFatigue(mount, aw.mount, strut)
    if (mount.damage >= 1) brk('mount', i, null, strut, aw.mount.ultimate, strut < aw.mount.ultimate)

    // Axle or CV: torque against strength at this angle.
    const ax = aw.axle
    const comp = f.compression[i] as number
    // The joint runs straight at `straightAt`; droop bends it more than bump does.
    const angleRaw = detAtan((comp - ax.straightAt) / ax.armLength)
    const angle = angleRaw < 0 ? -angleRaw : angleRaw
    const tire = f.tire[i] as number
    let spin = w.spin[i] as number
    let torque: number
    if (tire <= 0) {
      // In the air on the throttle: the wheel spins up.
      spin += ((1 - spin) * DT) / ax.spinUpTime
      torque = ax.driveTorque * (1 - spin)
    } else {
      const grip = (aw.tire.studded ? ground.studGrip : ground.grip) * tire * ax.wheelRadius
      if (spin > 0) {
        // Landing on a spinning wheel: the tire grabs, and the faster the wheel was spinning, the more of
        // the grip goes through the joint (a slipping tire grips harder the more it slips), until the spin stops.
        const slam = ax.driveTorque + (grip - ax.driveTorque) * spin
        torque = slam > ax.driveTorque ? slam : ax.driveTorque
        spin -= (grip * DT) / ax.spinMomentum
        if (spin < 0) spin = 0
      } else {
        torque = grip < ax.driveTorque ? grip : ax.driveTorque
      }
    }
    w.spin[i] = spin
    const a = angle / ax.maxAngle
    const strength = ax.strength * (1 - ax.angleLoss * (a > 1 ? 1 : a * a))
    const use = torque / strength
    const axle = w.axle[i] as Fatigue
    feedFatigue(axle, ax.fatigue, use)
    if (angle > ax.maxAngle) brk('axle', i, null, angle, ax.maxAngle, false)
    else if (axle.damage >= 1) brk('axle', i, null, use, 1, use < 1)

    // Tire: sharp edges only.
    const tw = aw.tire
    const edge = edgeUnder(profile, i, s.x + (ride.cornerX[i] as number), wp.footprint[i] as number)
    const squash = f.tireSquash[i] as number
    const sharp = edge > tw.sharpEdge
    const fold = sharp && squash > tw.bruiseFrom ? squash - tw.bruiseFrom : 0
    const bruise = w.tire[i] as Fatigue
    feedFatigue(bruise, tw.bruise, fold)
    if (sharp && squash >= tw.pinchAt) brk('tire', i, null, squash, tw.pinchAt, false)
    else if (bruise.damage >= 1) brk('tire', i, null, bruise.damage, 1, true)

    if (readings) {
      readings.jointAngle[i] = angle
      readings.jointTorque[i] = torque
      readings.strengthUse[i] = use
      readings.edge[i] = edge
    }
  }

  // Frame: front and rear crossmembers, and the twist between the axles.
  const s0 = f.strut[0] as number
  const s1 = f.strut[1] as number
  const s2 = f.strut[2] as number
  const s3 = f.strut[3] as number
  const front = s0 + s1
  const rear = s2 + s3
  // Each axle tries to roll the body its own way; the frame carries half the difference as twist.
  const twist = (((s0 - s1) - (s2 - s3)) * wp.halfTrack) / 2
  const loads = [front, twist, rear]
  for (let z = 0; z < FRAME_ZONES.length; z++) {
    const zone = FRAME_ZONES[z] as FrameZone
    const spec = wp.setup.frame[zone]
    const fat = w.frame[z] as Fatigue
    const load = loads[z] as number
    feedFatigue(fat, spec, load)
    const size = load < 0 ? -load : load
    if (fat.damage >= 1) brk('frame', -1, zone, size, spec.ultimate, size < spec.ultimate)
  }
  if (readings) {
    readings.frameFront = front
    readings.frameRear = rear
    readings.frameTwist = twist
  }

  if (found) w.broken = found
  return found
}

/** Each part's damage, 0 to 1. Per corner, or per frame zone (front, centre, rear). */
export interface DamageSnapshot {
  bottoming: number[]
  mount: number[]
  axle: number[]
  tire: number[]
  frame: number[]
}

export function damageOf(w: WearState): DamageSnapshot {
  return {
    bottoming: w.bottoming.map((f) => f.damage),
    mount: w.mount.map((f) => f.damage),
    axle: w.axle.map((f) => f.damage),
    tire: w.tire.map((f) => f.damage),
    frame: w.frame.map((f) => f.damage),
  }
}

/** The most worn part's damage, 0 to 1, for a quick look. */
export function worstDamage(w: WearState): number {
  let m = 0
  for (const list of [w.bottoming, w.mount, w.axle, w.tire, w.frame]) for (const f of list) if (f.damage > m) m = f.damage
  return m
}

/** Everything a ride-plus-wear run carries between sections: the wear, its numbers and scratch space. */
export interface WearRun {
  w: WearState
  wp: WearParams
  forces: StepForces
  readings: WearReadings
  /** The rolling trace, or null to skip it (the balance bot doesn't need it). */
  rec: TraceRecorder | null
}

export function newWearRun(setup: WearSetup, ride: RideParams, trace: boolean): WearRun {
  return {
    w: newWearState(),
    wp: wearParams(setup, ride),
    forces: emptyForces(),
    readings: emptyReadings(),
    rec: trace ? newRecorder() : null,
  }
}

/**
 * Drive one section at `speed` with wear, from the rear axle on its start to
 * the front axle on its end, or until something breaks. Adds to `stats`.
 * With a pose log, it also jots down the truck's pose for the 3D (read only).
 */
export function driveSectionWithWear(
  s: RideState,
  p: RideParams,
  run: WearRun,
  profile: Profile,
  speed: number,
  stats: RideStats = emptyStats(),
  poses: PoseLog | null = null,
): RideStats {
  enterSection(s, p, profile)
  const usable = profile.length - p.setup.cgToFront - p.setup.cgToRear
  const steps = speed > 0 ? Math.max(0, Math.floor(usable / (speed * DT))) : 0
  const { w, wp, forces, readings, rec } = run
  for (let n = 0; n < steps && !w.broken; n++) {
    stepRide(s, p, profile, speed, stats, forces)
    stepWear(w, wp, s, p, forces, profile, speed, readings)
    if (rec) {
      record(rec, s.oilTemp, forces, readings, w)
      if (w.broken && rec.tick !== 0) record(rec, s.oilTemp, forces, readings, w, true)
    }
    if (poses) notePose(poses, s, 0, w.distance, speed, 0, w.broken !== null)
  }
  return stats
}
