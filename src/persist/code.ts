// Adapted from Lombard src/game/save/code.ts (26 November 2026)
/**
 * Save codes and truck build codes (plan PR 8): a whole garage, or one
 * truck, as a line of text the player can paste into notes or a message.
 *
 *   BMP1:<payload>.<checksum>     a garage (no rig ghosts)
 *   BMPT1:<payload>.<checksum>    one truck build, to share a setup
 *
 * - payload: "z" + base64url (no padding) of the raw-deflated JSON. The
 *   browser's own CompressionStream does the squashing, so there's nothing
 *   to download. On a browser without it, "p" + the plain JSON in base64url
 *   (longer, but it still works everywhere).
 * - checksum: FNV-1a (32 bit) of the prefix and payload, base36, always 7
 *   characters. A cut-off or edited paste fails the checksum instead of
 *   loading garbage.
 *
 * Decoding is forgiving about what chat and notes apps do to pasted text
 * (spaces, line breaks, smart dashes, words around the code) but strict
 * about the content: anything that doesn't check out throws SaveCodeError,
 * whose `key` is a message in `src/data/strings.ts` that's safe to show.
 *
 * Players' codes are their own data: they're only ever decoded here, on
 * the device. No DOM; works the same in Node (the tests) and browsers.
 */
import type { TruckBuild } from '../data/kit'
import { SAVE } from '../data/save'
import type { StringKey } from '../data/strings'
import { leanSave, readBuild, readSave, SaveFormatError, type GarageSave } from './save'

export const SAVE_CODE_PREFIX = 'BMP1:'
export const BUILD_CODE_PREFIX = 'BMPT1:'
const CHECKSUM_LEN = 7

export class SaveCodeError extends Error {
  constructor(
    readonly key: StringKey,
    options?: { cause?: unknown },
  ) {
    super(key, options)
    this.name = 'SaveCodeError'
  }
}

// ── base64url, by hand, so it works the same in Node and browsers ──

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]))

export function toBase64Url(bytes: Uint8Array): string {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    const n = (b0 << 16) | (b1 << 8) | b2
    out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63))
    if (i + 1 < bytes.length) out.push(B64.charAt((n >> 6) & 63))
    if (i + 2 < bytes.length) out.push(B64.charAt(n & 63))
  }
  return out.join('')
}

/** Throws on characters outside the base64url alphabet or an impossible length. */
export function fromBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error('bad length')
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    let n = 0
    const chunk = Math.min(4, text.length - i)
    for (let j = 0; j < 4; j++) {
      const v = j < chunk ? B64_INDEX[text.charAt(i + j)] : 0
      if (v === undefined) throw new Error('bad character')
      n = (n << 6) | v
    }
    out[o++] = (n >> 16) & 255
    if (chunk > 2) out[o++] = (n >> 8) & 255
    if (chunk > 3) out[o++] = n & 255
  }
  return out
}

// ── checksum ──

/** FNV-1a 32-bit over the text (it's plain ASCII), base36, zero-padded to 7 characters. */
export function checksum(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(CHECKSUM_LEN, '0')
}

// ── squashing, with the browser's own deflate ──

const canSquash = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

async function squash(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Unsquash, giving up once the output passes `limit` bytes. */
async function unsquash(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) {
      await reader.cancel()
      throw new Error('too large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// ── one code format for both kinds ──

async function encode(prefix: string, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const payload = canSquash() ? `z${toBase64Url(await squash(bytes))}` : `p${toBase64Url(bytes)}`
  return `${prefix}${payload}.${checksum(prefix + payload)}`
}

/** Undo what messaging and notes apps do to a pasted code. */
function sanitize(input: string): string {
  return input
    .replace(new RegExp('[\\s\\u200B-\\u200D\\u2060\\uFEFF]+', 'g'), '') // spaces, line breaks, zero-width characters
    .replace(new RegExp('[\\u2010-\\u2015\\u2212]', 'g'), '-') // smart dashes back to a hyphen
}

interface Kind {
  prefix: string
  /** The other kind's prefix, to say "that's a build code, not a save code". */
  other: string
  maxChars: number
  errors: { empty: StringKey; long: StringKey; notCode: StringKey; otherKind: StringKey }
}

async function decode(code: string, kind: Kind): Promise<unknown> {
  const e = kind.errors
  if (typeof code !== 'string') throw new SaveCodeError(e.empty)
  const text = sanitize(code)
  if (text.length === 0) throw new SaveCodeError(e.empty)
  if (text.length > kind.maxChars) throw new SaveCodeError(e.long)

  // Quotes, brackets or a sentence before the code are skipped by searching for the prefix.
  const upper = text.toUpperCase()
  const start = upper.indexOf(kind.prefix)
  if (start < 0) throw new SaveCodeError(upper.includes(kind.other) ? e.otherKind : e.notCode)

  const rest = text.slice(start + kind.prefix.length)
  const dot = rest.indexOf('.')
  if (dot < 0) throw new SaveCodeError('code.cutOff')
  const payload = rest.slice(0, dot)
  const given = rest.slice(dot + 1, dot + 1 + CHECKSUM_LEN).toLowerCase()
  if (given.length < CHECKSUM_LEN) throw new SaveCodeError('code.cutOff')
  if (checksum(kind.prefix + payload) !== given) throw new SaveCodeError('code.damaged')

  let json: string
  try {
    const bytes = fromBase64Url(payload.slice(1))
    if (payload.startsWith('p')) {
      if (bytes.length > SAVE.maxInflatedBytes) throw new Error('too large')
      json = new TextDecoder().decode(bytes)
    } else if (payload.startsWith('z')) {
      if (!canSquash()) throw new SaveCodeError('code.noUnsquash')
      json = new TextDecoder().decode(await unsquash(bytes, SAVE.maxInflatedBytes))
    } else throw new Error('unknown payload')
  } catch (cause) {
    if (cause instanceof SaveCodeError) throw cause
    throw new SaveCodeError('code.unpack', { cause })
  }
  try {
    return JSON.parse(json)
  } catch (cause) {
    throw new SaveCodeError('code.unpack', { cause })
  }
}

// ── save codes ──

const SAVE_KIND: Kind = {
  prefix: SAVE_CODE_PREFIX,
  other: BUILD_CODE_PREFIX,
  maxChars: SAVE.maxCodeChars,
  errors: { empty: 'code.empty', long: 'code.tooLong', notCode: 'code.notSave', otherKind: 'code.isBuild' },
}

/** The garage as a save code (without the rig ghosts). */
export function encodeSaveCode(save: GarageSave): Promise<string> {
  return encode(SAVE_CODE_PREFIX, leanSave(save))
}

/** A pasted save code back into a garage. Throws SaveCodeError with a message to show. */
export async function decodeSaveCode(code: string): Promise<GarageSave> {
  const raw = await decode(code, SAVE_KIND)
  try {
    return readSave(raw)
  } catch (cause) {
    if (cause instanceof SaveFormatError && cause.kind === 'future') throw new SaveCodeError('code.future', { cause })
    throw new SaveCodeError('code.notValid', { cause })
  }
}

// ── truck build codes ──

const BUILD_KIND: Kind = {
  prefix: BUILD_CODE_PREFIX,
  other: SAVE_CODE_PREFIX,
  maxChars: SAVE.maxBuildCodeChars,
  errors: { empty: 'buildCode.empty', long: 'buildCode.tooLong', notCode: 'buildCode.notBuild', otherKind: 'buildCode.isSave' },
}

/** One truck as a build code: its class, parts and settings. */
export function encodeBuildCode(build: TruckBuild): Promise<string> {
  return encode(BUILD_CODE_PREFIX, { v: 1, build })
}

/** A pasted build code back into a build, tidied to fit today's parts. Throws SaveCodeError. */
export async function decodeBuildCode(code: string): Promise<TruckBuild> {
  const raw = await decode(code, BUILD_KIND)
  try {
    const box = raw as { v?: unknown; build?: unknown }
    if (typeof box.v !== 'number' || box.v > 1) throw new SaveFormatError('future', 'newer build code')
    return readBuild(box.build)
  } catch (cause) {
    if (cause instanceof SaveFormatError && cause.kind === 'future') throw new SaveCodeError('buildCode.future', { cause })
    throw new SaveCodeError('buildCode.notValid', { cause })
  }
}

