/**
 * Page-wide events between panels that otherwise don't know each other.
 *
 * - `SHOP_EVENT`: the shop tells the page a rig run finished or a report's
 *   fix was tapped. The first-job guide (plan PR 11b) listens.
 * - `DEV_EVENT`: a dev mode switch changed (`devMode.ts`). The build screen
 *   and the career redraw.
 */
import type { ClassId } from '../data/classes'
import type { ShopRigId } from '../data/rigs'

export const SHOP_EVENT = 'bumpstop:shop'
export const DEV_EVENT = 'bumpstop:dev'

export interface ShopEvent {
  kind: 'run' | 'fix'
  cls: ClassId
  rig: ShopRigId
}
