/**
 * Damage you can see (Kelbo, 27 November 2026): how muddy, dusty and snowy
 * the truck is at a moment of a raid, how chipped its paint is, and where
 * it's dented. Only the 3D view reads it; it changes nothing in the sim.
 * The numbers and the reasons for them: `src/data/grime.ts`.
 *
 * It's worked out fresh from what the raid already keeps (the stages driven,
 * the pace calls, the weather, the stops and the dents under the truck), so
 * nothing new goes into a save and an old save shows the right truck.
 *
 * Pure maths on plain numbers, like the rest of the sim.
 */
import type { GroundId } from '../data/ground'
import { GRIME, type GrimeKind } from '../data/grime'
import type { PaceId, Season } from '../data/raids'
import { UNDER_PARTS, type UnderPart } from '../data/underside'
import { detExp } from './det'
import { raidOf, raidWeather, stageLegs, type Leg, type RaidState, type StageRun, type Stop } from './raid'
import type { Underside } from './underside'
import { changesGround, type StageWeather } from './weather'

/** Where a dent is: the nose, a wheel arch (by corner, 0 to 3), or a part under the truck. */
export type DentPlace = 'nose' | 'arch0' | 'arch1' | 'arch2' | 'arch3' | UnderPart

export interface Dent {
  where: DentPlace
  /** How deep it looks, 0 to 1. */
  amount: number
}

/** How the truck looks at a moment of a raid. Every share is 0 (clean) to 1. */
export interface Grime {
  mud: number
  dust: number
  snow: number
  chips: number
  /** Fresh mud from a thaw today, which shines (0 or 1). */
  wet: number
  /** Winter grime is grey slush rather than brown mud. */
  season: Season
  dents: Dent[]
}

/** A clean truck, as it leaves the garage. */
export function cleanGrime(season: Season = 'summer'): Grime {
  return { mud: 0, dust: 0, snow: 0, chips: 0, wet: 0, season, dents: [] }
}

type Loads = Record<GrimeKind, number>

const KINDS: readonly GrimeKind[] = ['mud', 'dust', 'snow', 'chips']
const noLoad = (): Loads => ({ mud: 0, dust: 0, snow: 0, chips: 0 })

/** Add a stretch of ground's load: `metres` of `ground` at `pace`, in `weather` if it had turned there. */
function addGround(load: Loads, season: Season, ground: GroundId, metres: number, pace: PaceId, weather: StageWeather | null, turned: boolean): void {
  const km = metres / 1000
  const base = GRIME.perKm[season][ground]
  const w = turned && weather && changesGround(weather.kind, ground) ? GRIME.weather[weather.kind] : null
  for (const k of KINDS) {
    let perKm = base[k] ?? 0
    if (w) perKm = (k === 'dust' ? perKm * w.dust : perKm) + (w.add[k] ?? 0)
    load[k] += perKm * km * GRIME.pace[pace][k]
  }
}

/** Add the load of a stage's legs up to `upTo` metres, with the pace call for each leg. */
function addStage(load: Loads, season: Season, legs: readonly Leg[], paces: readonly PaceId[], weather: StageWeather | null, upTo: number): void {
  legs.forEach((leg, i) => {
    const pace = paces[i]
    if (!pace) return
    let at = leg.from
    for (const s of leg.segments) {
      const a = at
      const b = Math.min(at + s.length, upTo)
      at += s.length
      if (b <= a) continue
      // Split the piece where the weather turned, if it turned inside it.
      const turn = weather?.comes ? weather.at : Infinity
      if (turn > a && turn < b) {
        addGround(load, season, s.ground, turn - a, pace, weather, false)
        addGround(load, season, s.ground, b - turn, pace, weather, true)
      } else {
        addGround(load, season, s.ground, b - a, pace, weather, a >= turn)
      }
    }
  })
}

/** Stops: snow from a snowbank or slush from the ice, mud or snow from digging out of a bog, and the dents they leave on the body. */
function addStops(load: Loads, dents: Map<DentPlace, number>, stops: readonly Stop[], upTo: number, season: Season): void {
  for (const st of stops) {
    if (st.at > upTo + 1) continue
    if (st.kind === 'slide' || st.kind === 'ice') {
      const extra = GRIME.stops[st.kind]
      for (const k of KINDS) load[k] += extra[k] ?? 0
    }
    if (st.kind === 'bogged') {
      const extra = GRIME.bogged[season]
      for (const k of KINDS) load[k] += extra[k] ?? 0
    }
    if (st.kind === 'slide') knock(dents, 'nose', GRIME.dents.slide)
    else if (st.corner >= 0 && (GRIME.archKinds as readonly string[]).includes(st.kind)) {
      knock(dents, `arch${st.corner}` as DentPlace, GRIME.dents.corner)
    }
  }
}

function knock(dents: Map<DentPlace, number>, where: DentPlace, amount: number): void {
  const had = dents.get(where) ?? 0
  dents.set(where, had > 0 ? Math.min(1, had + amount * GRIME.dents.again) : amount)
}

/** Turn a day's load into what's on the truck: share = 1 - (1 - share) × e^(-load). */
function apply(g: Grime, load: Loads): void {
  for (const k of KINDS) g[k] = 1 - (1 - g[k]) * detExp(-load[k])
}

/**
 * How the truck looks partway through a raid: after the stages already
 * driven (and their bivouac nights), and `at` metres into the stage being
 * driven now (`run`). Without a run it's the truck as it stands between
 * stages, at the bivouac or on the morning of the next stage.
 */
export function raidGrime(state: RaidState, run: StageRun | null = null, at = 0): Grime {
  const raid = raidOf(state)
  const season = raid.season
  const cls = state.entry.build.cls
  const g = cleanGrime(season)
  const dents = new Map<DentPlace, number>()
  const done = Math.min(state.results.length, run ? run.stage : state.stage)

  for (let i = 0; i < done; i++) {
    const spec = raid.stages[i]
    const rec = state.results[i]
    if (!spec || !rec) continue
    const load = noLoad()
    const weather = rec.weather === undefined ? raidWeather(state, i) : rec.weather
    addStage(load, season, stageLegs(cls, spec), rec.paces, weather, Infinity)
    addStops(load, dents, rec.stops, Infinity, season)
    load.chips += (rec.guardHits ?? 0) * GRIME.guardHitChips
    apply(g, load)
    // The night at the bivouac after it (the rest day after `restAfter` stages).
    const keep = raid.restAfter === i + 1 ? GRIME.restDay : GRIME.overnight
    for (const k of KINDS) g[k] *= keep[k]
  }

  let under: Underside = state.under
  if (run) {
    const load = noLoad()
    addStage(load, season, run.legs, run.paces, run.weather, at)
    addStops(load, dents, run.stops, at, season)
    // The guards' rocks have no place on the stage: spread them over the distance driven so far.
    if (run.at > 0) load.chips += run.guardHits * Math.min(1, at / run.at) * GRIME.guardHitChips
    apply(g, load)
    if (run.weather?.kind === 'thaw' && run.weather.comes && at >= run.weather.at) g.wet = 1
    // Dents under the truck: as the stage started, plus each part a rock has dented by now.
    const hit = new Set(run.stops.filter((s) => s.at <= at + 1).map((s) => s.kind))
    under = { ...state.under }
    for (const p of UNDER_PARTS) if (hit.has(p)) under[p] = Math.max(under[p], run.under[p])
  }
  for (const p of UNDER_PARTS) if (under[p] >= GRIME.underMin) dents.set(p, Math.min(1, under[p]))

  // The deepest first, as many as the look can draw.
  g.dents = [...dents].map(([where, amount]) => ({ where, amount })).sort((a, b) => b.amount - a.amount).slice(0, GRIME.maxDents)
  return g
}
