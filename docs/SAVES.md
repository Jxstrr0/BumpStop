# Saves (plan PR 8)

How Bump Stop keeps your garage, in plain words. The code is in
`src/persist/`; every number is in `src/data/save.ts`.

## What gets saved

A **garage** is everything you'd be sad to lose:

- the build for each of the three classes (parts and every setting),
- the class on the bench and the year the parts list is set to,
- the raid in progress, saved each morning, each night at the bivouac and at
  the end (a reload in the middle of a stage starts that stage again),
- the last run on each rig, for the ghost line and Better/Same/Worse.

`src/persist/save.ts` says what a garage looks like (`GarageSave`) and
checks a stored or pasted one before the game trusts it (`readSave`). A part
that no longer exists goes back to the stock part, and every setting is
pulled back inside its range, so an old save never breaks the build screen.
Each save carries a format number (`v`); when the format changes, the
`migrate` step there moves old saves up, one version at a time.

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

## The tests

`tests/saves.test.ts`: a garage reads back as itself; a raid saved after a
stage carries on exactly as if it had never been saved; damaged, cut-off,
wrong-kind, newer and "zip bomb" codes are turned away with the right
message; build codes round-trip for each class; the slot fallback saves,
lists, deletes and shows a damaged slot; the reminder waits for progress and
14 days.
