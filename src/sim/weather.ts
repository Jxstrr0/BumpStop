/**
 * Weather that changes mid-stage (Kelbo, 26 November 2026). The numbers and
 * what each kind does are in `src/data/weather.ts`; this works out, for one
 * stage of one raid, what the forecast says and what really happens.
 *
 * Everything comes from a seeded roll on the raid's seed and the stage, so
 * the same raid always has the same weather: a second go shows what a change
 * to the truck did, not what the sky did.
 */
import type { ClassId } from '../data/classes'
import type { GroundId } from '../data/ground'
import type { RaidStage, Season } from '../data/raids'
import { FORECAST_WORDS, WEATHER, WEATHER_IDS, WEATHER_ROLL, type GroundMod, type WeatherId } from '../data/weather'
import { hashString, Rng } from './rng'

/** A stage's weather: the forecast in the morning, and what really happens. */
export interface StageWeather {
  kind: WeatherId
  /** The forecast's chance it comes (0 to 1). */
  chance: number
  /** The forecast's window: it may come in between these (m from the start). */
  from: number
  to: number
  /** Whether it really comes. */
  comes: boolean
  /** Where it turns, if it comes (m from the start; always inside the window). */
  at: number
}

/**
 * The weather for stage `stage` of a raid running on `seed`, or null for a
 * clear day. `km` is the stage's length.
 */
export function stageWeather(seed: number, stage: number, spec: RaidStage, season: Season, km: number): StageWeather | null {
  const rng = new Rng(hashString(`${seed}:${stage}:weather`))
  if (!rng.chance(WEATHER_ROLL.forecast)) return null
  const kinds = WEATHER_IDS.filter((id) => {
    const w = WEATHER[id]
    return w.season === season && spec.airC >= w.airC[0] && spec.airC <= w.airC[1]
  })
  if (!kinds.length) return null
  const kind = rng.pick(kinds)
  const chance = rng.pick(WEATHER_ROLL.chances)
  const total = km * 1000
  const at = rng.range(WEATHER_ROLL.from, WEATHER_ROLL.to) * total
  const width = WEATHER_ROLL.window * total
  // The window sits somewhere round the real place, so the forecast is honest but not exact.
  const from = Math.max(0, at - rng.range(0, width))
  const to = Math.min(total, from + width)
  const comes = rng.chance(chance)
  return { kind, chance, from, to, comes, at }
}

/** The forecast's word for its chance: possible, likely or expected. */
export function forecastWord(chance: number): 'possible' | 'likely' | 'expected' {
  return (FORECAST_WORDS.find((f) => chance < f.below) ?? FORECAST_WORDS[FORECAST_WORDS.length - 1]!).word
}

/**
 * The forecast as it stands at `at` metres, for a checkpoint: the chance
 * moves part of the way towards what will really happen (honest, but still
 * not a promise), and once inside the window it starts from here. Only for
 * weather that hasn't come in yet.
 */
export function forecastAt(w: StageWeather, at: number): { chance: number; from: number; to: number } {
  const inside = at >= w.from
  const share = WEATHER_ROLL.update.inside * (inside ? 1 : WEATHER_ROLL.update.ahead)
  const chance = w.chance + ((w.comes ? 1 : 0) - w.chance) * share
  return { chance, from: inside ? at : w.from, to: w.to }
}

/** Is the weather on at this place (m from the start)? */
export function weatherOn(w: StageWeather | null, at: number): boolean {
  return !!w && w.comes && at >= w.at - 0.5
}

/** Does this weather change this ground? */
export function changesGround(kind: WeatherId, ground: GroundId): boolean {
  return WEATHER[kind].ground.includes(ground)
}

/** The ground change for this weather on this ground, or undefined if it leaves it alone. */
export function groundMod(kind: WeatherId, ground: GroundId): GroundMod | undefined {
  return changesGround(kind, ground) ? WEATHER[kind].mod : undefined
}

/** The driver's speed on this ground in this weather, as a share of a clear day's (1 if it leaves the ground alone). */
export function weatherSpeed(kind: WeatherId, cls: ClassId, ground: GroundId): number {
  return changesGround(kind, ground) ? WEATHER[kind].speed[cls] : 1
}

/** The share of a piece of ground (`length` metres from `start` metres on) that's past the turn, in weather that comes. */
export function weatherShare(w: StageWeather | null, start: number, length: number): number {
  if (!w || !w.comes) return 0
  const end = start + length
  if (end <= w.at) return 0
  return (end - Math.max(start, w.at)) / length
}
