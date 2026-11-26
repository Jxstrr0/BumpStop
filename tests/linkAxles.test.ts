import { describe, expect, it } from 'vitest'
import { makeBuildStore, readLinkAxles, withSetting, writeLinkAxles } from '../src/ui/buildStore'
import { stockBuild } from '../src/sim/build'

describe('link front and rear', () => {
  it('unlinked, a slider changes only its own axle', () => {
    const b = stockBuild('light4x4')
    const next = withSetting(b, 'front', 'tirePressure', 150_000, false)
    expect(next.front.tirePressure).toBe(150_000)
    expect(next.rear).toEqual(b.rear)
  })

  it('linked, a slider sets both axles and leaves the other settings alone', () => {
    const b = stockBuild('heavy')
    const next = withSetting(b, 'rear', 'springRate', b.rear.springRate + 5000, true)
    expect(next.front.springRate).toBe(b.rear.springRate + 5000)
    expect(next.rear.springRate).toBe(b.rear.springRate + 5000)
    expect(next.front.preload).toBe(b.front.preload)
    expect(next.rear.preload).toBe(b.rear.preload)
  })

  it('linked values survive the store tidying them, and unlinking keeps them', () => {
    const store = makeBuildStore()
    store.setBuild(withSetting(store.build(), 'front', 'tirePressure', 180_000, true), 'setting')
    const linkedFront = store.build().front.tirePressure
    expect(store.build().rear.tirePressure).toBe(linkedFront)
    // Unlinked again: one end moves, the other keeps the linked value.
    store.setBuild(withSetting(store.build(), 'front', 'tirePressure', 200_000, false), 'setting')
    expect(store.build().rear.tirePressure).toBe(linkedFront)
  })

  it('remembers the choice under a bumpstop. key, and survives a storage that refuses', () => {
    const kept = new Map<string, string>()
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) }
    expect(readLinkAxles(storage)).toBe(false)
    writeLinkAxles(true, storage)
    expect([...kept.keys()].every((k) => k.startsWith('bumpstop.'))).toBe(true)
    expect(readLinkAxles(storage)).toBe(true)
    writeLinkAxles(false, storage)
    expect(readLinkAxles(storage)).toBe(false)
    const refuses = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(readLinkAxles(refuses)).toBe(false)
    expect(() => writeLinkAxles(true, refuses)).not.toThrow()
    expect(readLinkAxles(undefined)).toBe(false)
  })
})
