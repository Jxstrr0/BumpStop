// Truck, X-ray or Both (Kelbo asked, 27 November 2026): the remembered pick and its words.
import { describe, expect, it } from 'vitest'
import { SEE_THROUGH, TRUCK_LOOKS } from '../src/data/graphics'
import { SLOTS } from '../src/data/parts'
import { t, type StringKey } from '../src/data/strings'
import { readTruckLook, writeTruckLook } from '../src/ui/truckLook'

/** A pretend localStorage. */
function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

describe('truck, X-ray or both', () => {
  it('starts on the truck as built', () => {
    expect(readTruckLook(memory())).toBe('truck')
    expect(readTruckLook(undefined)).toBe('truck')
  })

  it('remembers the pick, and ignores anything it does not know', () => {
    const store = memory()
    for (const look of TRUCK_LOOKS) {
      writeTruckLook(look, store)
      expect(readTruckLook(store)).toBe(look)
    }
    store.setItem('bumpstop.truckLook', 'wireframe')
    expect(readTruckLook(store)).toBe('truck')
  })

  it('keeps going when the phone will not store anything', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readTruckLook(broken)).toBe('truck')
    expect(() => writeTruckLook('xray', broken)).not.toThrow()
  })

  it('has a label and a longer line for every look', () => {
    for (const look of TRUCK_LOOKS) {
      expect(t(`look.${look}` as StringKey)).toBeTruthy()
      expect(t(`look.${look}Title` as StringKey)).toBeTruthy()
    }
  })

  it('only takes real slots off with the body, never the suspension', () => {
    for (const slot of SEE_THROUGH.bodySlots) expect(SLOTS).toContain(slot)
    for (const slot of ['dampers', 'springs', 'frontSusp', 'rearSusp', 'frame', 'engine', 'bumpStops', 'antiRoll']) {
      expect(SEE_THROUGH.bodySlots as readonly string[]).not.toContain(slot)
    }
  })
})
