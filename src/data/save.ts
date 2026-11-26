/**
 * Every number the saves use (plan PR 8). How saves work: `docs/SAVES.md`.
 */
export const SAVE = {
  /** The newest save format. Older ones are moved up by `src/persist/save.ts`. */
  version: 1,
  /** Wait this long after the last change before writing the slot (ms), so a slider drag is one write. */
  autosaveDelayMs: 1200,
  /** Remind the player to make a backup after this many days without one. */
  backupReminderDays: 14,
  /** Anything longer than this can't be a save code (characters). Codes leave the rig ghosts out, so they stay small. */
  maxCodeChars: 200_000,
  /** A code may unpack to at most this many bytes, so a hand-made "zip bomb" can't fill the phone's memory. */
  maxInflatedBytes: 4_000_000,
  /** A truck build code is far smaller still (characters). */
  maxBuildCodeChars: 4_000,
} as const
