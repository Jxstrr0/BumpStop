/**
 * Tuning numbers for wear and breaks (plan PR 2). SI units: N, N·m, m, s, rad.
 *
 * Every part adds up damage from the loads it sees, and some parts can also
 * break outright on one big hit. Damage runs from 0 (new) to 1 (broken).
 *
 * How fatigue works here (see `src/sim/wear.ts`): each time a load swings
 * from a low to a high and back, that swing (its "range") wears the part a
 * little. A swing as big as `ultimate` breaks the part in one go; half that
 * size takes 2^exponent swings; swings smaller than `endurance` do no harm at
 * all. That is how steel behaves: lots of small knocks are fine, a few big
 * ones add up fast.
 *
 * Each class has "test mule" parts here, to match the test mules in
 * `src/data/ride.ts`. The parts the player picks (plan PR 3,
 * `src/data/parts.ts`) are multipliers on these numbers.
 */
import type { ClassId } from './classes'

/** The six ways a truck can break, each with its own trace (plan: "How things break"). */
export type FailureKind = 'fade' | 'bottoming' | 'mount' | 'axle' | 'tire' | 'frame'

export const FAILURE_KINDS: readonly FailureKind[] = ['fade', 'bottoming', 'mount', 'axle', 'tire', 'frame']

/** The frame is split into three zones for its damage map. */
export type FrameZone = 'front' | 'centre' | 'rear'

export const FRAME_ZONES: readonly FrameZone[] = ['front', 'centre', 'rear']

export interface FatigueSpec {
  /** A load swing this big breaks the part in a single swing, and a load this big breaks it outright. */
  ultimate: number
  /** Swings smaller than this do no harm. */
  endurance: number
  /** How fast damage grows with the size of the swing: half the size lasts 2^exponent times as long. */
  exponent: number
  /** Wiggles smaller than this don't count as a turn in the load, so one big hit isn't split into small ones. */
  gate: number
}

export interface AxleWear {
  /** Shock and spring mounts: the strut load they carry (N). */
  mount: FatigueSpec
  /**
   * Bottoming: fatigue on the metal-to-metal force each time the wheel hits
   * the hard limit (N). Every bottom-out knocks the shock and bump stop cup
   * a little, harder hits much more; one hit of `ultimate` breaks it at once.
   */
  bottoming: FatigueSpec
  /** Axle shaft or CV joint. */
  axle: {
    /** Torque it takes when straight (N·m). */
    strength: number
    /** Fatigue on the share of its strength in use (0 to 1 and beyond), so these are fractions. */
    fatigue: FatigueSpec
    /** Distance from the joint to the wheel, which turns wheel travel into joint angle (m). */
    armLength: number
    /** Wheel travel where the joint runs straight (m, up from ride height); droop bends it the most. */
    straightAt: number
    /** The joint binds and snaps past this angle (rad). */
    maxAngle: number
    /** How much strength is lost at `maxAngle` (0 to 1): a joint working at an angle is weaker. */
    angleLoss: number
    /** Torque to keep the truck moving on rough ground, every wheel driven (N·m). */
    driveTorque: number
    /** Seconds in the air, on the throttle, for a wheel to spin up to full overspeed. */
    spinUpTime: number
    /** How much spin a landing has to stop: wheel inertia times its overspeed (N·m·s). */
    spinMomentum: number
    /** Rolling radius (m). */
    wheelRadius: number
  }
  tire: {
    /** The tire's sidewall starts to fold past this squash; hits beyond it bruise the casing (m). */
    bruiseFrom: number
    /** The rim pinches the tire against the ground at this squash: on a sharp edge, that cuts it (m). */
    pinchAt: number
    /** Ground steeper than this under the tire counts as a sharp edge (rise per metre). */
    sharpEdge: number
    /** Casing bruises: fatigue on the squash past `bruiseFrom`, on sharp ground only (m). */
    bruise: FatigueSpec
  }
}

export interface WearSetup {
  front: AxleWear
  rear: AxleWear
  /**
   * The frame's three zones. Front and rear carry the two corners' strut
   * loads added together (N); the centre carries the twist between the front
   * and rear axles (N·m), which is what cracks a soft frame.
   */
  frame: Record<FrameZone, FatigueSpec>
}

/** Fixed numbers for the whole wear model. */
export const WEAR = {
  /** A damper over its red line for this long has faded: damping has dropped and the wheels skip (s). */
  fadeHold: 2,
  /** Tire grip on gravel, which sets the torque a landing on a spinning wheel puts through the axle. */
  grip: 0.8,
  /** Trace samples per second kept for the break's trace. */
  traceRate: 100,
  /** Seconds of trace kept before a break. */
  traceSeconds: 3,
} as const

const mule = (a: AxleWear, frame: WearSetup['frame']): WearSetup => ({ front: a, rear: structuredClone(a), frame })

/**
 * The test mules' parts, one set per class. The numbers were set from what
 * the balance bot measured on the rigs (`src/data/rigs.ts`): each part's
 * breaking load sits above the biggest loads the mule sees in the first few
 * laps, so it lasts until about 50 to 70 km/h on the torture loop.
 */
export const MULE_WEAR: Readonly<Record<ClassId, WearSetup>> = {
  light4x4: mule(
    {
      mount: { ultimate: 420000, endurance: 70000, exponent: 6, gate: 4000 },
      bottoming: { ultimate: 160000, endurance: 40000, exponent: 4, gate: 5000 },
      axle: {
        strength: 9000,
        fatigue: { ultimate: 1, endurance: 0.35, exponent: 8, gate: 0.05 },
        armLength: 0.5,
        straightAt: 0.04,
        maxAngle: 0.45,
        angleLoss: 0.4,
        driveTorque: 300,
        spinUpTime: 0.25,
        spinMomentum: 120,
        wheelRadius: 0.4,
      },
      tire: {
        bruiseFrom: 0.055,
        pinchAt: 0.1,
        sharpEdge: 0.6,
        bruise: { ultimate: 0.055, endurance: 0.012, exponent: 6, gate: 0.002 },
      },
    },
    {
      front: { ultimate: 680000, endurance: 110000, exponent: 6, gate: 6000 },
      rear: { ultimate: 680000, endurance: 110000, exponent: 6, gate: 6000 },
      centre: { ultimate: 220000, endurance: 38000, exponent: 6, gate: 2000 },
    },
  ),
  heavy: mule(
    {
      mount: { ultimate: 2300000, endurance: 350000, exponent: 6, gate: 20000 },
      bottoming: { ultimate: 1100000, endurance: 200000, exponent: 4, gate: 30000 },
      axle: {
        strength: 52000,
        fatigue: { ultimate: 1, endurance: 0.35, exponent: 8, gate: 0.05 },
        armLength: 0.9,
        straightAt: 0.04,
        maxAngle: 0.26,
        angleLoss: 0.4,
        driveTorque: 2000,
        spinUpTime: 0.35,
        spinMomentum: 900,
        wheelRadius: 0.6,
      },
      tire: {
        bruiseFrom: 0.09,
        pinchAt: 0.24,
        sharpEdge: 0.6,
        bruise: { ultimate: 0.08, endurance: 0.016, exponent: 6, gate: 0.002 },
      },
    },
    {
      front: { ultimate: 3200000, endurance: 500000, exponent: 6, gate: 30000 },
      rear: { ultimate: 3200000, endurance: 500000, exponent: 6, gate: 30000 },
      centre: { ultimate: 1400000, endurance: 220000, exponent: 6, gate: 15000 },
    },
  ),
  sxs: mule(
    {
      mount: { ultimate: 80000, endurance: 13000, exponent: 6, gate: 1500 },
      bottoming: { ultimate: 18000, endurance: 3000, exponent: 4, gate: 600 },
      axle: {
        strength: 3500,
        fatigue: { ultimate: 1, endurance: 0.35, exponent: 8, gate: 0.05 },
        armLength: 0.45,
        straightAt: 0.05,
        maxAngle: 0.62,
        angleLoss: 0.4,
        driveTorque: 120,
        spinUpTime: 0.2,
        spinMomentum: 50,
        wheelRadius: 0.37,
      },
      tire: {
        bruiseFrom: 0.075,
        pinchAt: 0.125,
        sharpEdge: 0.6,
        bruise: { ultimate: 0.06, endurance: 0.014, exponent: 6, gate: 0.002 },
      },
    },
    {
      front: { ultimate: 220000, endurance: 36000, exponent: 6, gate: 2500 },
      rear: { ultimate: 220000, endurance: 36000, exponent: 6, gate: 2500 },
      centre: { ultimate: 22000, endurance: 3600, exponent: 6, gate: 300 },
    },
  ),
}
