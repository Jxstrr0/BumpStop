// Offline play (plan PR 12): what the worker keeps, and that it only ever deletes this game's caches.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CACHE_PREFIX, cacheName, isFullTruckModel, precacheList, staleCaches } from '../src/pwa/precache'

describe('offline cache', () => {
  it('names every cache with the bumpstop- prefix', () => {
    expect(CACHE_PREFIX).toBe('bumpstop-')
    expect(cacheName('0123456789abcdef')).toBe('bumpstop-0123456789')
  })

  it('keeps the game and the lite trucks, and leaves out the full trucks, the worker, CNAME, maps and old fonts', () => {
    const list = precacheList([
      'index.html',
      'sw.js',
      'CNAME',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/font-400.woff',
      'assets/font-400.woff2',
      'models/truck-heavy.glb.gz',
      'models/truck-heavy-lite.glb.gz',
      'models/scenery.glb.gz',
      'brand/longlight-logo-dark.svg',
    ])
    expect(list).toEqual([
      'assets/font-400.woff2',
      'assets/index-abc.js',
      'brand/longlight-logo-dark.svg',
      'index.html',
      'models/scenery.glb.gz',
      'models/truck-heavy-lite.glb.gz',
    ])
    // The full models are kept the first time the game loads them instead (src/pwa/sw.js).
    expect(isFullTruckModel('models/truck-heavy.glb.gz')).toBe(true)
    expect(isFullTruckModel('models/truck-light4x4.glb.gz')).toBe(true)
    expect(isFullTruckModel('models/truck-light4x4-lite.glb.gz')).toBe(false)
    expect(isFullTruckModel('models/scenery.glb.gz')).toBe(false)
  })

  it("deletes only this game's old caches, never another game's", () => {
    const names = ['bumpstop-aaaa', 'bumpstop-bbbb', 'laminar-1', 'mainline-2', 'longlight-3']
    expect(staleCaches(names, 'bumpstop-bbbb')).toEqual(['bumpstop-aaaa'])
  })

  it('the worker source keeps the same prefix and guards every delete', () => {
    const src = readFileSync(new URL('../src/pwa/sw.js', import.meta.url), 'utf8')
    expect(src).toContain(`const PREFIX = '${CACHE_PREFIX}'`)
    expect(src.match(/caches\.delete/g)).toHaveLength(1)
    expect(src).toMatch(/n\.startsWith\(PREFIX\)[^\n]*caches\.delete/)
  })

  it('the register code never clears storage wholesale', () => {
    const src = readFileSync(new URL('../src/pwa/register.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('localStorage.clear')
    expect(src).toMatch(/startsWith\(CACHE_PREFIX\)\) await caches\.delete/)
  })
})
