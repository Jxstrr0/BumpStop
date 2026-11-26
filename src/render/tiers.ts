/**
 * Which graphics tier the 3D views draw at (plan PR 12), and Auto, which
 * steps it down on a slow phone. The numbers for each tier are in
 * `src/data/graphics.ts`.
 *
 * The player picks Auto, Lite, Full or Ultra on the settings panel. Auto
 * starts from a guess (Full on phones, Ultra on a big computer, Lite on a
 * phone with little memory) and, while a 3D view is moving, steps down a
 * tier whenever the median frame rate over a few seconds is under 45. It
 * never steps back up on its own (with the screen's refresh holding a fast
 * phone at 60 there is nothing to measure), but it remembers where it ended
 * up for next time. `?tier=lite|full|ultra` pins a tier for one visit.
 *
 * No three.js here, so the settings panel can use it without loading the 3D.
 * Adapted from Lombard src/render/perf.ts (26 November 2026).
 */
import { AUTO_TIER, TIER_IDS, TIERS, type GraphicsChoice, type TierId, type TierSettings } from '../data/graphics'

const CHOICE_KEY = 'bumpstop.graphics'
const AUTO_KEY = 'bumpstop.autoTier'

export function isTier(v: unknown): v is TierId {
  return v === 'lite' || v === 'full' || v === 'ultra'
}

function isChoice(v: unknown): v is GraphicsChoice {
  return v === 'auto' || isTier(v)
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

/** Where Auto starts on a device it hasn't measured yet. */
export function guessTier(coarsePointer: boolean, cores: number, memoryGb: number | undefined): TierId {
  if (memoryGb !== undefined && memoryGb <= 2) return 'lite'
  if (coarsePointer) return 'full'
  return cores >= 8 ? 'ultra' : 'full'
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/**
 * Auto's frame-rate watcher. Pure: feed it the time between frames while a
 * 3D view is moving, and it returns a lower tier when one window's median
 * frame rate is under the floor. The median ignores the odd hitch (a model
 * unzipping); frames over the stall limit are dropped.
 */
export class TierGovernor {
  private wait: number = AUTO_TIER.warmupS
  private elapsed = 0
  private deltas: number[] = []
  /** Median frame rate of the last finished window. */
  lastFps: number | null = null

  constructor(
    private tier: TierId,
    public enabled = true,
  ) {}

  get current(): TierId {
    return this.tier
  }

  /** Start measuring again at `tier` (after the player picks one, or a step down). */
  reset(tier: TierId): void {
    this.tier = tier
    this.wait = AUTO_TIER.warmupS
    this.elapsed = 0
    this.deltas = []
  }

  /** Returns the new tier when it steps down, else null. */
  sample(dt: number): TierId | null {
    if (dt <= 0 || dt > AUTO_TIER.stallS) return null
    if (this.wait > 0) {
      this.wait -= dt
      return null
    }
    this.elapsed += dt
    this.deltas.push(dt)
    if (this.elapsed < AUTO_TIER.windowS) return null
    const fps = 1 / median(this.deltas)
    this.lastFps = fps
    this.elapsed = 0
    this.deltas = []
    if (!this.enabled || fps >= AUTO_TIER.minFps) return null
    const i = TIER_IDS.indexOf(this.tier)
    if (i <= 0) return null
    const down = TIER_IDS[i - 1]!
    this.reset(down)
    return down
  }
}

// ── The tier in play ──

interface Start {
  choice: GraphicsChoice
  tier: TierId
  pinned: boolean
}

function start(): Start {
  const fromUrl = new URLSearchParams(location.search).get('tier')
  if (isTier(fromUrl)) return { choice: fromUrl, tier: fromUrl, pinned: true }
  const saved = read(CHOICE_KEY)
  const choice: GraphicsChoice = isChoice(saved) ? saved : 'auto'
  if (choice !== 'auto') return { choice, tier: choice, pinned: false }
  const last = read(AUTO_KEY)
  if (isTier(last)) return { choice, tier: last, pinned: false }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const memory = (navigator as { deviceMemory?: number }).deviceMemory
  return { choice, tier: guessTier(coarse, navigator.hardwareConcurrency ?? 4, memory), pinned: false }
}

let state: Start | null = null
let governor: TierGovernor | null = null
const listeners = new Set<(tier: TierId) => void>()

function ensure(): { state: Start; governor: TierGovernor } {
  if (!state || !governor) {
    state = start()
    governor = new TierGovernor(state.tier, state.choice === 'auto' && !state.pinned)
  }
  return { state, governor }
}

function setTier(tier: TierId): void {
  const g = ensure().governor
  g.reset(tier)
  for (const fn of listeners) fn(tier)
}

/** The tier the 3D views draw at now. */
export function currentTier(): TierId {
  return ensure().governor.current
}

export function tierSettings(): TierSettings {
  return TIERS[currentTier()]
}

/** What the player picked (Auto unless they chose a tier). */
export function graphicsChoice(): GraphicsChoice {
  return ensure().state.choice
}

/** True when `?tier=` pinned the tier for this visit. */
export function tierPinned(): boolean {
  return ensure().state.pinned
}

/** The player picked Auto or a tier on the settings panel. */
export function setGraphicsChoice(choice: GraphicsChoice): void {
  const { state: s, governor: g } = ensure()
  s.choice = choice
  s.pinned = false
  write(CHOICE_KEY, choice)
  g.enabled = choice === 'auto'
  if (choice === 'auto') {
    // Auto picks up where it last was (or the guess), and keeps measuring.
    const last = read(AUTO_KEY)
    setTier(isTier(last) ? last : s.tier)
  } else {
    setTier(choice)
  }
}

/** Call back when the tier changes. Returns a function that stops listening. */
export function onTierChange(fn: (tier: TierId) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Each 3D view calls this once a frame while it's moving, with the seconds since its last frame. */
export function frameTime(dt: number): void {
  const g = ensure().governor
  const down = g.sample(dt)
  if (!down) return
  console.info(`[graphics] under ${AUTO_TIER.minFps} fps, stepping down to ${down}`)
  write(AUTO_KEY, down)
  setTier(down)
}
