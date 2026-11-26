import { describe, expect, it } from 'vitest'
import { TAB_IDS, readTab, writeTab } from '../src/ui/tabs'
import { t, type StringKey } from '../src/data/strings'

/** A pretend localStorage. */
function memory(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

describe('bottom tabs', () => {
  it('a new player starts on the career', () => {
    expect(readTab(memory())).toBe('career')
    expect(readTab(undefined)).toBe('career')
  })

  it('the phone remembers the last tab under a bumpstop. key', () => {
    const s = memory()
    writeTab('raid', s)
    expect(s.getItem('bumpstop.tab')).toBe('raid')
    expect(readTab(s)).toBe('raid')
  })

  it('anything else saved there opens the career', () => {
    const s = memory()
    s.setItem('bumpstop.tab', 'garage')
    expect(readTab(s)).toBe('career')
  })

  it('storage that throws (private mode) still opens the career', () => {
    const broken = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(readTab(broken)).toBe('career')
    expect(() => writeTab('build', broken)).not.toThrow()
  })

  it('every tab has a label', () => {
    for (const id of TAB_IDS) expect(t(`tabs.${id}` as StringKey)).toBeTruthy()
  })
})
