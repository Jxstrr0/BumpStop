/**
 * The truck's lamps on a night stage (Kelbo, 27 November 2026): real
 * spotlights hung on the body, so the road, the ruts and the trees only show
 * where the beam falls. They follow what the build has fitted
 * (`src/sim/night.ts`): the headlamps always, a wide light bar from the roof,
 * and a pair of long, narrow spots from the front.
 *
 * Two lights at most, so a phone can draw them: one wide (the headlamps or
 * the bar) and one long (the spots). The lite graphics tier gets one light
 * that does both jobs. (Visible beams in the air were tried: as solid cones
 * they read as flat triangles from the side, so the lit road does the job.)
 */
import * as THREE from 'three'
import { HEADLAMPS } from '../data/night'
import { NIGHT_LOOK } from '../data/graphics'
import type { TruckModel } from './truckModel'
import { tierSettings } from './tiers'

/** What the 3D needs to know about the build's lamps. */
export interface NightLamps {
  /** The beam's reach (m) and spread (0 to 1), as the sim has them. */
  reach: number
  spread: number
  /** A light bar on the roof: its reach and spread, or null. */
  bar: { reach: number; spread: number } | null
  /** Spot lamps: their reach and spread, or null. */
  spots: { reach: number; spread: number } | null
}

/** A light's half-angle for a spread of the road (radians): a third of the road is a narrow beam, all of it a wide one. */
function halfAngle(spread: number): number {
  return NIGHT_LOOK.angle[0] + (NIGHT_LOOK.angle[1] - NIGHT_LOOK.angle[0]) * spread
}

export class TruckLamps {
  readonly group = new THREE.Group()
  private lights: THREE.SpotLight[] = []
  private ground = 0

  constructor(truck: TruckModel, lamps: NightLamps) {
    const box = truck.bodyBounds()
    // The road, in the body's own space: just under the body's lowest point.
    this.ground = box.min.y - NIGHT_LOOK.groundBelow
    const nose = box.max.x
    const height = box.max.y - box.min.y
    const headlamps = { x: nose, y: box.min.y + height * NIGHT_LOOK.headlampHeight }
    const roof = { x: nose - height * 0.25, y: box.max.y }
    const tier = tierSettings()

    // The wide light: the bar if there is one (from the roof), else the headlamps.
    const wide = lamps.bar ?? { reach: HEADLAMPS.reach, spread: HEADLAMPS.spread }
    const widePlace = lamps.bar ? roof : headlamps
    // The long light: the spots, from the front.
    const long = lamps.spots
    if (tier.liteModels || !long) {
      // One light does it all: as far as the longest lamp, as wide as the widest.
      this.add(widePlace, Math.max(wide.reach, long?.reach ?? 0), Math.max(wide.spread, long?.spread ?? 0), 1)
    } else {
      this.add(widePlace, wide.reach, wide.spread, NIGHT_LOOK.wideShare)
      this.add(headlamps, long.reach, long.spread, 1)
    }
    truck.attach(this.group)
  }

  /** One spotlight, `reach` m down the road, its beam as wide as `spread`. */
  private add(at: { x: number; y: number }, reach: number, spread: number, share: number): void {
    const angle = halfAngle(spread)
    const light = new THREE.SpotLight(NIGHT_LOOK.colour, NIGHT_LOOK.intensity * share * (reach / HEADLAMPS.reach), reach * NIGHT_LOOK.distance, angle, NIGHT_LOOK.penumbra, NIGHT_LOOK.decay)
    light.position.set(at.x, at.y, 0)
    // Aimed down at the road a share of the reach ahead, so the pool of light runs from near the bumper to the reach.
    const aim = reach * NIGHT_LOOK.aim
    light.target.position.set(at.x + aim, this.ground, 0)
    this.group.add(light, light.target)
    this.lights.push(light)
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const l of this.lights) l.dispose()
  }
}
