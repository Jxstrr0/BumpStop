# Saves (plan PR 8)

How Bump Stop keeps your garage, in plain words. The code is in
`src/persist/`; every number is in `src/data/save.ts`.

## What gets saved

A **garage** is everything you'd be sad to lose:

- the build for each of the three classes (parts and every setting),
- the class on the bench and the year the parts list is set to,
- the raid in progress, saved each morning, each night at the bivouac and at
  the end (a reload in the middle of a stage starts that stage again),
- the last run on each rig, for the ghost line and Better/Same/Worse,
- the career, if you've started one (format 2, plan PR 9: `docs/CAREER.md`; format 3 since the year went to six raids).

`src/persist/save.ts` says what a garage looks like (`GarageSave`) and
checks a stored or pasted one before the game trusts it (`readSave`). A part
that no longer exists goes back to the stock part, and every setting is
pulled back inside its range, so an old save never breaks the build screen.
Each save carries a format number (`v`); when the format changes, the
`migrate` step there moves old saves up, one version at a time.

| Format | From | What changed |
| --- | --- | --- |
| 1 | PR 8a | The first garage format. |
| 2 | PR 9a | The career (`career`, null in an older garage). A career raid also keeps its year's road seed, the rivals entered and the crew's bivouac hours. A rival team's truck that can't be read is bought again for its year rather than failing the save, and an own-raid job with no raid saved is dropped. |
| 3 | PR 13d | Six raids a year instead of eight. The career's `next` (its place in the calendar) moves onto the new calendar: the same raid where it's still there, otherwise the next one that is (`SAVE.calendarV2`). A job already under way at a raid that left the calendar carries on and is settled at that next raid. |

Added without a new format number (so it never clashes with other work on
the save format): since 1.4.0.0 a raid keeps its truck's condition (`cond`:
shock oil, bushings and springs per axle), the money spent on parts at the
bivouacs (`spent`) and, for a career raid, the money it had for parts
(`entry.budget`). A raid saved before that reads back with a fresh truck and
nothing spent, in `readRaid`.

## Three slots

Each phone keeps three garages (`src/persist/slots.ts`): IndexedDB database
`bumpstop`, store `slots`, one record per slot. Where IndexedDB won't open
(some private windows) the same records go to localStorage as
`bumpstop.slot.1` to `.3`. A slot that can't be read shows as damaged with
a Delete button; nothing is ever thrown away without asking. Every key
starts `bumpstop.`, and nothing outside it is ever cleared.

## Save codes: `BMP1:`

A save code is the whole garage (minus the rig ghosts, which are big) as one
line of text (`src/persist/code.ts`, adapted from Lombard's):

    BMP1:z<squashed garage>.<7 check letters>

The garage is squashed with the browser's own deflate (no download needed),
written in URL-safe letters, and ends with a checksum, so a code that got cut
off or changed in a message is turned away with a clear message instead of
loading garbage. Spaces, line breaks, smart dashes and words around the code
are ignored. A code that would unpack to more than 4 MB is refused. Codes are
only ever read on your own phone.

## Truck build codes: `BMPT1:`

One truck (class, parts and settings) in the same format, about 400
characters, to share a setup with a friend. Parts that don't exist in their
version go back to stock.

## Backups

`src/persist/safety.ts`, adapted from Lombard's:

- asks the browser to keep the game's storage (`navigator.storage.persist()`)
  once there's progress worth keeping;
- remembers when you last backed up (`bumpstop.lastBackup`, this phone only)
  and reminds you after **14 days** without one;
- saves a backup file, `bump-stop-backup-YYYY-MM-DD.txt`, holding a save
  code: through the share sheet (on an iPhone, "Save to Files"), or as a
  download;
- reads a backup file back in.

## On screen (8b)

- **Saves and backups**, a panel under the raids: the three slots (what's in
  each, when it was saved, Open, Start a garage here, Delete with a second
  tap), a line saying when this slot last saved, whether the browser has
  promised to keep the saves, **Copy save code** and **Save a backup file**
  (both count as a backup), and **Load a garage** from a pasted code or a
  backup file (it replaces the open slot, with a second tap).
- **Autosave** (`src/ui/garage.ts`): every change asks for a save; the slot
  is written 1.2 seconds after the last one, and straight away when the page
  is hidden or closed. An empty slot stays empty until something changes.
  Opening another slot saves this one and reloads into that one. A slot that
  can't be read is never written over. Two tabs on the same slot: the last
  one to save wins.
- **The raid** saves each morning, after each stage and at the end, and a
  reload goes back to that screen (the bivouac, if it was mid-results). A
  reload in the middle of a stage drives it again from its morning.
- **The rig ghosts** come back after a reload, so Better/Same/Worse still
  compares against the last run. A ghost that doesn't check out is dropped.
- **The reminder**: a quiet bar under the title when there's progress and
  no backup yet, or none in 14 days. Back up now jumps to Copy save code;
  Later hides it until next time.
- **Share this build**, at the foot of the build screen: Copy build code, or
  paste one in to replace that class's build.

## The tests

`tests/saves.test.ts`: a garage reads back as itself; a raid saved after a
stage carries on exactly as if it had never been saved; damaged, cut-off,
wrong-kind, newer and "zip bomb" codes are turned away with the right
message; build codes round-trip for each class; the slot fallback saves,
lists, deletes and shows a damaged slot; the reminder waits for progress and
14 days.
