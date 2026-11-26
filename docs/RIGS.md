# The rigs and the report

How the shop's three rigs, the report and the ghost runs work (plan PR 4).
The sim is in `src/sim/laps.ts` and `src/sim/shaker.ts`; the screens are in
`src/ui/shop.ts`, `src/ui/report.ts`, `src/ui/charts.ts` and
`src/ui/fixes.ts`; every number is in `src/data/rigs.ts`.

## The three rigs

| Rig | What it does | What it finds |
| --- | --- | --- |
| Shaker rig | Four posts shake the parked truck, slow to fast (0.6 to 18 bounces a second) | Where the body bounces most (about 1 to 1.3 a second) and where the wheels hop (about 7 to 10 a second). Nothing breaks |
| Washboard ladder | 600 m of washboard and 1.2 km of rough gravel, from 40 km/h, 5 km/h faster each lap | The speed where the dampers fade |
| Torture loop | Whoops, a rock garden, a graded bit and jumps, from 30 km/h, 5 km/h faster each lap | Bottoming, cracked mounts, snapped axles, cut tires, cracked frames |

Each class and rig always drives the same road, so running again after a
fix shows exactly what the fix changed.

### Why the ladder is mostly rough gravel

The first draft (plan PR 2) was washboard plus whoops. Two things showed up:

- **Washboard alone hardly heats the dampers above 40 km/h.** On a lap of
  pure washboard the light 4x4's oil settled at about 45 °C whatever the
  speed. All the heat was coming from the whoops.
- **The whoops bottomed the light 4x4 and the heavy truck out** before
  their dampers faded (`docs/WEAR.md`).

So the ladder now uses a new ground, **rough gravel** (`rough` in
`src/data/ground.ts`): short chop all over with nothing big enough to bottom
on. Chop works the dampers harder the faster you go, so every lap is hotter
than the last. What the stock builds do on it now:

| Class | Fades at | Bigger dampers (1.6×) |
| --- | --- | --- |
| Light 4x4 | 90 to 100 km/h | lasts all 16 laps |
| Heavy truck | 85 to 90 km/h | lasts all 16 laps |
| Side-by-side | 65 km/h | 90 to 95 km/h |

The balance bot now checks that every stock build fades first on the ladder.

### The shaker

The posts are a flat road that moves up and down under the parked truck, so
it's the same ride model the loops drive. At each beat the truck settles,
then the rig measures how far the body (over each axle) and each wheel move,
compared with the posts. The report turns the wheel hop into a washboard
speed (beats a second × 0.8 m, typical washboard crest to crest): for the
light 4x4 that's about 28 km/h, right where `docs/RIDE-SIM.md` found the
wheels hop and the dampers work hardest.

## Live

`startLaps` sets a run up and `advanceLaps` drives it a few hundred steps at
a time, so the shop shows it as it happens. `runLaps` (the balance bot's) is
the same thing with no limit, and a test checks that a run in small pieces
ends exactly like one run all at once.

At normal speed each lap takes about 4 seconds on screen; **Fast** is four
times quicker, **Skip to the end** works it out as fast as the phone can,
and **Stop** ends it early. While it runs the screen shows:

- the lap, its speed and the ground under the truck, with how far round the lap;
- each corner's oil temperature (with its word: Normal, Warm, Over the
  limit), the most bump travel it has used this lap, and its worst wear;
- a live trace of the whole run: the hottest oil, the most travel used, or
  the most worn part. It comes from the run's history, a few numbers every
  20 m (`RunHistory`).

## The report

One screen at the end of every run, laid out for a 360 px phone:

1. What let go, where, on which lap and at what speed, in one sentence.
2. Why, in plain words, and a note from the crew chief.
3. One big trace of the last 3 seconds, played back in slow motion (40% of
   real speed) with a dot and a readout under it. The bands behind it say
   Normal, Warm and Over the limit, and the limit is a red dashed line.
   Chips switch between that failure's other channels. The trace now ends
   on the very step it broke, so the readout shows the number that crossed
   the line.
4. How it went against the last run on this rig: Better, Same or Worse.
5. Up to three fixes. Each is a button that scrolls up to the part or the
   slider (front or rear, whichever broke), opens it and outlines it. A bar
   at the bottom of the screen then offers to run the rig again. "A slower
   pace" has nowhere to go yet: the pace calls come with the raids.

The shaker's report says where the body bounces and the wheels hop, what
that means on washboard, and jumps to the spring rate (moves the bounce) and
the rebound clicks (calms the hop; the dampers part if they have no
adjuster).

## Ghost runs

The last finished run on each rig, for each class, is saved with the garage
(plan PR 8, `docs/SAVES.md`), so it survives a reload. The next run draws it as a faint dashed line on
the live trace and on the report's trace (when it broke the same way), and
the report compares the two.

## Ghost trucks

Added after 1.0 (Kelbo asked, 26 November 2026). On the washboard ladder
and the torture loop your **best run** for each class becomes a ghost
truck you can race; a friend's run can be raced the same way. The shaker
has nothing to race, so it has no ghost. The dashed line above is still
the *last* run; the ghost truck is the *best* (or a friend's).

- **What a ghost is.** Just the build and what happened: how far it got,
  how many laps, what broke and where (`src/sim/ghost.ts`). No recording.
  The sim is deterministic (seeded roads, no clocks, its own maths in
  `det.ts`), so the same build on the same loop drives exactly the same
  run on any phone. A test checks a ghost read back from its code drives
  the very same run, and that one driven beside another truck ends where it
  ended alone.
- **Best.** A finished run (not stopped) that goes further than the best so
  far replaces it; a tie keeps the old one. The report says "New best here".
- **Racing.** Pick No ghost, Your best or Friend's ghost under the start
  button (it starts on your best). The shop starts the ghost's own run
  beside yours and steps it exactly as many steps as yours each frame, so
  both are always at the same moment of the run. Every truck drives the
  same speeds on a loop (the rig sets them), so the race is about lasting:
  whoever keeps going longer wins. A line under the chart says when the
  ghost is out, and the report says who went further and by how much.
- **In 3D.** The ghost is a second copy of the truck with its own parts and
  ride height, tinted blue and see-through, drawn over everything like an
  X-ray (it's usually almost exactly where your truck is, so it would
  otherwise hide inside it). Its own pose log is handed to the view with
  each clip. Once it breaks it stays where it stopped, showing the flat or
  the flopped wheel, and drops out of the picture behind you. Colours in
  `GHOST_LOOK` (`src/data/rigs.ts`).
- **Sharing.** Share my best ghost turns it into a `BMPG1:` code (see
  `docs/SAVES.md`) and opens the share sheet, or copies it. Paste a
  friend's under Share or race a friend's ghost: it's kept for its class
  and loop, and put on the bench if the career allows that class.
- **Saved** with the garage, in the save's `ghosts` record under
  `best:<class>:<rig>` and `friend:<class>:<rig>` (`src/persist/ghost.ts`),
  so the save format didn't change. Save codes leave them out, like the
  last-run lines.

## Tests

`tests/ghost.test.ts`: ghosts drive again exactly, best and race results,
ghost codes. `tests/rigs.test.ts`: step by step equals all at once; the history; the
trace ending on the breaking step; the ladder getting hotter every lap; the
shaker finding the bounce and the hop for every class, and stiffer springs
moving the bounce; every fix jumping somewhere the build screen has.
