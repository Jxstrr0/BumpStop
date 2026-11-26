// Offline play (plan PR 12): what the worker keeps, and that it only ever deletes this game's caches.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CACHE_PREFIX, cacheName, precacheList, staleCaches } from '../src/pwa/precache'

describe('offline cache', () => {
  it('names every cache with the bumpstop- prefix', () => {
    expect(CACHE_PREFIX).toBe('bumpstop-')
    expect(cacheName('0123456789abcdef')).toBe('bumpstop-0123456789')
  })

  it('keeps the game and the trucks, and leaves out the worker, CNAME, maps and old fonts', () => {
    const list = precacheList([
      'index.html',
      'sw.js',
      'CNAME',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/font-400.woff',
      'assets/font-400.woff2',
      'models/truck-heavy.glb.gz',
      'brand/longlight-logo-dark.svg',
    ])
    expect(list).toEqual([
      'assets/font-400.woff2',
      'assets/index-abc.js',
      'brand/longlight-logo-dark.svg',
      'index.html',
      'models/truck-heavy.glb.gz',
    ])
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
