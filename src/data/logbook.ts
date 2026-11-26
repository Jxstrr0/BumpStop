/**
 * The garage logbook: every truck the career's garage owns keeps a history
 * (raids, wins, kilometres, breakdowns, parts swapped, and a few moments
 * worth telling). The logic is in `src/sim/logbook.ts`; how it works for
 * players and Kelbo is in `docs/LOGBOOK.md`.
 */
export const LOGBOOK = {
  /** Most moments kept for one truck, newest first. Older ones drop off the end. */
  moments: 12,
  /** Most moments the logbook list on the career screen shows before "and more". */
  shown: 6,
  /** Most old trucks the garage keeps on the wall, newest first (a very long career sells a lot of trucks). */
  oldTrucks: 30,
} as const
