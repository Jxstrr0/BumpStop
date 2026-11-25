/**
 * The balance bot (plan PR 2): builds trucks and runs the rigs for one class.
 * Each class has its own test file so CI runs them side by side, and each
 * adds a table to the GitHub Actions run summary, so the results can be read
 * on a phone from the Actions tab.
 */
import { appendFileSync } from 'node:fs'
import { BOT_AIR_C, type BotBuild, type Tweak } from '../../src/data/balance'
import type { ClassId } from '../../src/data/classes'
import { RIGS, type RigId } from '../../src/data/rigs'
import { buildTruck, stockBuild } from '../../src/sim/build'
import { runLaps, type LapRun } from '../../src/sim/laps'
import { fromCelsius, msToKmh } from '../../src/sim/units'
import { combine, tweaked } from './tweak'

/** The class's stock build (plan PR 3), with the tweak on top, driven round a rig. */
export function botRun(id: ClassId, rig: RigId, tweak: Tweak, seed: number): LapRun {
  const stock = buildTruck(stockBuild(id))
  const { ride, wear } = tweaked(stock.ride, stock.wear, tweak)
  return runLaps(ride, wear, RIGS[rig], seed, { airTemp: fromCelsius(BOT_AIR_C), trace: false })
}

export function weakTweak(b: BotBuild, id: ClassId): Tweak {
  return b.classTweak?.[id] ?? b.tweak
}

export function fixTweak(b: BotBuild, id: ClassId): Tweak {
  return combine(weakTweak(b, id), b.fix)
}

/** The lap speed (km/h) a run broke at, or null if it lasted. */
export function breakKmh(run: LapRun): number | null {
  return run.broken ? Math.round(msToKmh(run.laps[run.laps.length - 1]!.speed)) : null
}

/** A short line for the summary: "mount, lap 5 at 50 km/h". */
export function describe(run: LapRun): string {
  if (!run.broken) return 'lasted every lap'
  return `${run.broken.kind}, lap ${run.brokenLap} at ${breakKmh(run)} km/h`
}

const rows: string[] = []

export function noteRow(cls: ClassId, build: string, rig: RigId, results: string[]): void {
  rows.push(`| ${cls} | ${build} | ${rig} | ${results.join(' · ')} |`)
}

/** Add this class's table to the Actions run summary (only in CI). */
export function writeSummary(cls: ClassId): void {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file || rows.length === 0) return
  const head = [`### Balance bot: ${cls}`, '', '| Class | Build | Rig | First break (one per seed) |', '| --- | --- | --- | --- |']
  appendFileSync(file, [...head, ...rows, '', ''].join('\n'))
}
