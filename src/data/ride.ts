/**
 * Tuning numbers for the ride sim (plan PR 1). SI units throughout: kg, m, s,
 * N, W, J and kelvin. Convert only for display (see `src/sim/units.ts`).
 *
 * Each class gets one "test mule": a plain truck with sensible springs and
 * dampers. The parts the player picks (plan PR 3, `src/data/parts.ts`) are
 * multipliers on these numbers, and `src/sim/build.ts` puts them together.
 *
 * How to read a corner:
 * - "Wheel rate" is the spring's stiffness measured at the wheel (N per metre
 *   of wheel travel).
 * - "Bump travel" is how far the wheel can rise from ride height before it
 *   hits the hard limit; the bump stop takes the last `bumpStopLength` of it.
 * - "Droop travel" is how far the wheel can drop before the limit strap.
 * - A damper resists speed, not distance: the faster the wheel moves, the
 *   harder it pushes back, and all of that work turns into heat in its oil.
 */
import type { ClassId } from './classes'

/** Fixed numbers for the whole sim. */
export const SIM = {
  /** The ride model's fixed time step: 500 steps a second. */
  stepsPerSecond: 500,
  /** m/s² */
  gravity: 9.81,
  /** Distance between road profile samples (m). */
  profileStep: 0.025,
  /** The ground fades in and out over this distance at each end of a section, so sections join smoothly (m). */
  profileTaper: 6,
  /** 0 °C in kelvin. */
  zeroCelsius: 273.15,
} as const

/**
 * How damper oil thins out as it heats up.
 *
 * Damping scales by exp(-viscositySlope × (T − referenceTemp)), so it is 1 at
 * the reference temperature, more than 1 when cold (stiff) and less than 1
 * when hot (fade). Above a damper's `aerationTemp` the oil starts to foam and
 * damping falls off further, down to `aerationFloor` of what it was.
 *
 * Below freezing the oil thickens much faster (plan PR 10, winter): each
 * kelvin under `coldFrom` adds `coldSlope` more. So a damper on a -30 °C
 * morning damps about 2.6 times as hard as set, until its own work warms
 * the oil up. Summer never gets near it.
 */
export const DAMPER_OIL = {
  /** K: damping is exactly as set at 40 °C. */
  referenceTemp: 313.15,
  /** Per kelvin. */
  viscositySlope: 0.0065,
  /** K: below 0 °C the oil thickens faster. */
  coldFrom: 273.15,
  /** Per kelvin below `coldFrom`, on top of `viscositySlope`. */
  coldSlope: 0.017,
  /** Never stiffer than this when stone cold. */
  maxMultiplier: 3.2,
  /** Never softer than this, however hot. */
  minMultiplier: 0.2,
  /** K above the aeration temperature where the foaming is complete. */
  aerationSpan: 40,
  /** Fraction of damping left once the oil is fully foamed. */
  aerationFloor: 0.55,
} as const

export interface DamperSetup {
  /** Compression damping below the knee (N·s/m). */
  compLow: number
  /** Compression damping above the knee (N·s/m): the "blow-off" for sharp hits. */
  compHigh: number
  /** Rebound damping below the knee (N·s/m). */
  rebLow: number
  /** Rebound damping above the knee (N·s/m). */
  rebHigh: number
  /** Shaft speed where low-speed damping hands over to high-speed (m/s). */
  knee: number
  /** Heat the oil and damper body soak up per kelvin (J/K). Bigger = slower to cook. */
  heatCapacity: number
  /** Heat shed per kelvin above the air when parked (W/K). */
  coolStill: number
  /** Extra heat shed per kelvin for each m/s of air flowing past (W/K per m/s). */
  coolPerSpeed: number
  /** Oil starts to foam above this (K). */
  aerationTemp: number
  /** Over-the-limit temperature for the traces (K). */
  redLine: number
  /** Traces turn amber from here (K). */
  warmFrom: number
  /**
   * Spool-valve dampers only (2017 on): damping that follows where the wheel
   * is in its travel. Soft through the middle, firming up near each end.
   * Missing means the damper damps the same all the way through.
   */
  position?: PositionDamping
  /**
   * Bypass dampers only (1996 on): tubes along the body let oil slip past the
   * piston through the middle of the stroke, and close off one by one towards
   * each end, so the damping firms up in steps. Missing means no bypass tubes.
   */
  zones?: BypassZones
  /**
   * How much the oil's temperature changes the damping, as a share of a
   * normal damper's (1). A spool valve meters the oil through sharp-edged
   * ports, where thin or thick oil flows nearly the same, so it fades less
   * when hot and is less stiff on a frozen morning. Missing means 1.
   */
  oilSense?: number
}

/**
 * Position-sensitive damping (spool-valve dampers). Through the middle of the
 * travel the damper runs at `mid` of its setting. In the last `zone` share of
 * the bump travel the compression damping climbs to `end` times its setting
 * at the bump stop and beyond, which catches a big hit before it bottoms out.
 * In the last `zone` share of the droop travel the rebound damping climbs the
 * same way, so the wheel doesn't slam onto its limit strap.
 */
export interface PositionDamping {
  /** Damping through the middle of the travel, as a share of the setting. */
  mid: number
  /** Share of the bump (and droop) travel at each end where it firms up. */
  zone: number
  /** Damping at the very end, as a share of the setting. */
  end: number
}

/**
 * Bypass tubes (bypass and internal bypass dampers). Through the middle of the
 * travel every tube is open and the damper runs at `mid` of its setting. Going
 * outwards, the piston slides past each tube's last port in turn: from there
 * on that tube is shut and the damping steps up to its `scale`. Compression
 * steps up towards full bump and rebound towards full droop; rebound near
 * full bump and compression near full droop stay at `mid`, so the wheel can
 * always get back to the middle (each tube has a one-way valve).
 *
 * Unlike a spool valve's smooth climb (`PositionDamping`), these are plateaus
 * with a short ramp (`port`) between them, they start firming earlier, and
 * they stop well short of a spool valve's 3.5 times at the very end.
 */
export interface BypassZones {
  /** Damping through the middle, with every tube open, as a share of the setting. */
  mid: number
  /**
   * One step per tube, from the middle outwards: `from` is the share of the
   * bump (or droop) travel, measured from ride height, where the piston passes
   * that tube's last port; `scale` is the damping from there on.
   */
  steps: readonly { from: number; scale: number }[]
  /** Share of the travel a port takes to close as the piston slides over it: the ramp between steps. */
  port: number
}

export interface AxleSetup {
  /** Wheel, tire, hub, brake and half the arms or axle, per corner (kg). */
  unsprungMass: number
  /** Spring wheel rate per corner (N/m). */
  springRate: number
  /** Wheel travel up from ride height to the hard limit (m). */
  bumpTravel: number
  /** Wheel travel down from ride height to the limit strap (m). */
  droopTravel: number
  /** The bump stop starts this far before the hard limit (m). */
  bumpStopLength: number
  /** Bump stop stiffness at first touch (N/m). */
  bumpStopRate: number
  /** How many times stiffer the bump stop is when fully squashed. */
  bumpStopProgression: number
  /** Stiffness of the metal-to-metal hard limit: bottoming out (N/m). */
  hardStopRate: number
  /** Stiffness of the limit strap at full droop (N/m). */
  limitStrapRate: number
  /** Anti-roll bar, as N per metre of difference between left and right travel. */
  antiRollRate: number
  /** Tire vertical stiffness (N/m). */
  tireRate: number
  /** Tire vertical damping (N·s/m). */
  tireDamping: number
  /**
   * Length of the tire's contact patch (m). A tire swallows bumps shorter
   * than this, so it feels the road averaged over its footprint.
   */
  footprint: number
  damper: DamperSetup
}

export interface RideSetup {
  /** Everything the springs hold up (kg). */
  sprungMass: number
  /** Resistance to nodding nose up and down (kg·m²). */
  pitchInertia: number
  /** Resistance to rolling side to side (kg·m²). */
  rollInertia: number
  /** Centre of mass to the front axle (m). */
  cgToFront: number
  /** Centre of mass to the rear axle (m). */
  cgToRear: number
  /** Distance between left and right wheels (m). */
  track: number
  front: AxleSetup
  rear: AxleSetup
}

const C = SIM.zeroCelsius

/** The test mules, one per class. Total mass = sprung + 4 × unsprung, inside each class window. */
export const TEST_MULES: Readonly<Record<ClassId, RideSetup>> = {
  // About 1,950 kg: nimble and fragile, with medium dampers.
  light4x4: {
    sprungMass: 1650,
    pitchInertia: 2500,
    rollInertia: 600,
    cgToFront: 1.3,
    cgToRear: 1.5,
    track: 1.65,
    front: {
      unsprungMass: 75,
      springRate: 32000,
      bumpTravel: 0.17,
      droopTravel: 0.13,
      bumpStopLength: 0.06,
      bumpStopRate: 250000,
      bumpStopProgression: 8,
      hardStopRate: 5e6,
      limitStrapRate: 1e6,
      antiRollRate: 15000,
      tireRate: 280000,
      tireDamping: 300,
      footprint: 0.25,
      damper: {
        compLow: 2600, compHigh: 900, rebLow: 4200, rebHigh: 1500, knee: 0.15,
        heatCapacity: 2400, coolStill: 3, coolPerSpeed: 0.25,
        aerationTemp: C + 150, redLine: C + 130, warmFrom: C + 90,
      },
    },
    rear: {
      unsprungMass: 75,
      springRate: 30000,
      bumpTravel: 0.17,
      droopTravel: 0.13,
      bumpStopLength: 0.06,
      bumpStopRate: 250000,
      bumpStopProgression: 8,
      hardStopRate: 5e6,
      limitStrapRate: 1e6,
      antiRollRate: 8000,
      tireRate: 280000,
      tireDamping: 300,
      footprint: 0.25,
      damper: {
        compLow: 2400, compHigh: 850, rebLow: 4000, rebHigh: 1400, knee: 0.15,
        heatCapacity: 2400, coolStill: 3, coolPerSpeed: 0.25,
        aerationTemp: C + 150, redLine: C + 130, warmFrom: C + 90,
      },
    },
  },
  // About 9,200 kg: big oil volume, slow to heat-soak, heavy axles.
  heavy: {
    sprungMass: 7600,
    pitchInertia: 30000,
    rollInertia: 6000,
    cgToFront: 2.1,
    cgToRear: 1.9,
    track: 2.1,
    front: {
      unsprungMass: 400,
      springRate: 130000,
      bumpTravel: 0.16,
      droopTravel: 0.12,
      bumpStopLength: 0.06,
      bumpStopRate: 1.2e6,
      bumpStopProgression: 8,
      hardStopRate: 4e7,
      limitStrapRate: 5e6,
      antiRollRate: 60000,
      tireRate: 1.4e6,
      tireDamping: 1500,
      footprint: 0.35,
      damper: {
        compLow: 11000, compHigh: 4000, rebLow: 18000, rebHigh: 6500, knee: 0.12,
        heatCapacity: 12000, coolStill: 14, coolPerSpeed: 0.9,
        aerationTemp: C + 150, redLine: C + 130, warmFrom: C + 90,
      },
    },
    rear: {
      unsprungMass: 400,
      springRate: 140000,
      bumpTravel: 0.16,
      droopTravel: 0.12,
      bumpStopLength: 0.06,
      bumpStopRate: 1.2e6,
      bumpStopProgression: 8,
      hardStopRate: 4e7,
      limitStrapRate: 5e6,
      antiRollRate: 40000,
      tireRate: 1.4e6,
      tireDamping: 1500,
      footprint: 0.35,
      damper: {
        compLow: 11500, compHigh: 4200, rebLow: 19000, rebHigh: 6800, knee: 0.12,
        heatCapacity: 12000, coolStill: 14, coolPerSpeed: 0.9,
        aerationTemp: C + 150, redLine: C + 130, warmFrom: C + 90,
      },
    },
  },
  // About 1,000 kg: huge travel, tiny dampers that cook fast.
  sxs: {
    sprungMass: 820,
    pitchInertia: 700,
    rollInertia: 200,
    cgToFront: 1.15,
    cgToRear: 1.2,
    track: 1.6,
    front: {
      unsprungMass: 45,
      springRate: 13000,
      bumpTravel: 0.25,
      droopTravel: 0.2,
      bumpStopLength: 0.07,
      bumpStopRate: 120000,
      bumpStopProgression: 8,
      hardStopRate: 1.5e6,
      limitStrapRate: 5e5,
      antiRollRate: 5000,
      tireRate: 110000,
      tireDamping: 120,
      footprint: 0.2,
      damper: {
        compLow: 1300, compHigh: 450, rebLow: 2000, rebHigh: 700, knee: 0.18,
        heatCapacity: 700, coolStill: 1.4, coolPerSpeed: 0.1,
        aerationTemp: C + 140, redLine: C + 125, warmFrom: C + 85,
      },
    },
    rear: {
      unsprungMass: 45,
      springRate: 12500,
      bumpTravel: 0.25,
      droopTravel: 0.2,
      bumpStopLength: 0.07,
      bumpStopRate: 120000,
      bumpStopProgression: 8,
      hardStopRate: 1.5e6,
      limitStrapRate: 5e5,
      antiRollRate: 2500,
      tireRate: 110000,
      tireDamping: 120,
      footprint: 0.2,
      damper: {
        compLow: 1250, compHigh: 430, rebLow: 1900, rebHigh: 680, knee: 0.18,
        heatCapacity: 700, coolStill: 1.4, coolPerSpeed: 0.1,
        aerationTemp: C + 140, redLine: C + 125, warmFrom: C + 85,
      },
    },
  },
}

/**
 * Long stages (plan: "a 300 km stage resolves in under a second").
 *
 * A stage is cut into chunks. Each chunk runs a short sample section in full
 * detail at 500 Hz (its length is set per ground, `sampleLength` in
 * `src/data/ground.ts`), measures how much heat each damper made per second, and
 * then works out the rest of the chunk's heating and cooling with the exact
 * formula for a heater in a draught (see `src/sim/stage.ts`).
 */
export const LONG_STAGE = {
  /** Longest stretch one sample stands for (m). */
  chunkLength: 5000,
  /**
   * Hot oil damps less, so a fading damper also makes a bit less heat. Over
   * the worked-out stretch, heat scales by (damping now ÷ damping in the
   * sample) to this power. Measured from the sim on PR 1's grounds: about 0.1
   * on jumps and rocks, 0.8 on washboard; 0.4 sits in the middle.
   */
  heatFollowsDamping: 0.4,
  /** Pieces the worked-out stretch is split into, so the heat can follow the damping. */
  restSteps: 8,
} as const
