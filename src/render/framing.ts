/**
 * How the test track's camera and pixels fit the shape of its canvas
 * (Kelbo asked for the test track as a whole page, 27 November 2026).
 *
 * The 3D view used to be one small 16:10 box. Full page it can be a tall
 * portrait phone or a wide computer window, so two things follow its shape:
 *
 * - The lens. The cameras stand where they always did (the scenery keeps a
 *   lane clear for them), so on a tall screen the lens opens up to keep the
 *   whole truck in the picture, up to a limit where it would start to look
 *   stretched.
 * - The pixels. A canvas the size of a big monitor is drawn a little softer
 *   so it stays smooth.
 *
 * Pure maths, no three.js, so the tests can use it. The numbers are in
 * `src/data/graphics.ts`.
 */
import { TRACK_CAMERA } from '../data/graphics'

const RAD = Math.PI / 180

/**
 * The camera's top-to-bottom angle (degrees) for a canvas this shape
 * (`aspect` is width over height). At the shape the shots were framed for,
 * or wider, it's the plain lens. Narrower, it opens up so the picture stays
 * as wide as it was, until the limit.
 */
export function trackFov(aspect: number): number {
  const { fov, designAspect, maxFov } = TRACK_CAMERA
  if (!(aspect > 0) || aspect >= designAspect) return fov
  const halfWidth = Math.tan((fov / 2) * RAD) * designAspect
  return Math.min(maxFov, (2 * Math.atan(halfWidth / aspect)) / RAD)
}

/**
 * Pixels drawn per CSS pixel for a canvas `width` × `height` CSS pixels: the
 * screen's own, capped by the tier, and less again if that would be more
 * pixels in all than the tier's budget.
 */
export function pixelRatioFor(width: number, height: number, devicePixelRatio: number, cap: number, maxPixels: number): number {
  const ratio = Math.min(devicePixelRatio || 1, cap)
  const area = width * height
  if (!(area > 0)) return ratio
  return Math.min(ratio, Math.sqrt(maxPixels / area))
}
