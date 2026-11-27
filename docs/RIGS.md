# The rigs and the report

How the shop's rigs, the report and the ghost runs work (plan PR 4; the
jump ramp came in v1.22).
The sim is in `src/sim/laps.ts` and `src/sim/shaker.ts`; the screens are in
`src/ui/shop.ts`, `src/ui/report.ts`, `src/ui/charts.ts` and
`src/ui/fixes.ts`; every number is in `src/data/rigs.ts`.

## The rigs

| Rig | What it does | What it finds |
| --- | --- | --- |
| Shaker rig | Four posts shake the parked truck, slow to fast (0.6 to 18 bounces a second) | Where the body bounces most (about 1 to 1.3 a second) and where the wheels hop (about 7 to 10 a second). Nothing breaks |
| Washboard ladder | 600 m of washboard and 1.2 km of rough gravel, from 40 km/h, 5 km/h faster each lap | The speed where the dampers fade |
| Torture loop | Whoops, a rock garden, a graded bit and jumps, from 30 km/h, 5 km/h faster each lap | Bottoming, cracked mounts, snapped axles, cut tires, cracked frames |
| Jump ramp | One tabletop jump a lap, six jumps from 45 to 70 km/h | How cleanly the truck lands: a score out of 100 for each landing |

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

## The jump ramp

Added in v1.22 (Kelbo picked it, 27 November 2026). A 200 m lap with one
built tabletop on it (`RIGS.jumpRig` and `TableJump` in `src/data/rigs.ts`,
laid on the road by `stampTable` in `src/sim/ground.ts`): 90 m of run-up,
an 8 m entry curve that bends the road up to a straight face (slope 0.18),
a lip 1 m up, a 4 m flat top and a 12 m landing slope back down, then about
80 m of run-out for the truck to settle before it comes round again. The
first jump is at 45 km/h and each one is 5 km/h faster, up to 70. (Until
v1.28 the lap was 75 m with 20 m of run-up; Kelbo found it too short, and
the longer lap gives each lap 10 to 16 seconds on screen.)

The stock trucks land it best at about 45 to 55 km/h. Slower, they hardly
leave the top; faster, they fly further down the slope, land harder and
nose down more, and from about 65 km/h they clear the slope altogether and
come down on the flat, where every truck bottoms out.

**Nose dives come out of the physics.** The front wheels leave the lip a
moment before the rear, and the rear is still being pushed up the face, so
the truck rotates nose down in the air, more the faster it goes. More rebound
at the rear holds the tail down a little; the side-by-side, the lightest
in pitch, dives the most.

**The score** (`src/sim/landing.ts`, numbers in `LANDING`). The lap runner
hands each step on the jump to `watchLanding`, which only reads the sim. It
counts the take-off once all four wheels have been off for 0.06 s near the
lip, times the flight, and at touch-down notes where the first wheels came
down (short on the top, on the slope, or past it on the flat), which end
touched first and the body's angle against the ground under it. For 1.2 s
after that it watches each end's bump stops, every bottom-out, the body's
hardest jolt and any bounce (all four wheels off again). Each landing starts
at 100 and loses:

| What | Points |
| --- | --- |
| Nose or tail more than 4° off the ground's angle | 1.5 a degree past that |
| Each end that reached its bump stops | 4 |
| Each corner that bottomed out (up to 3) | 8 |
| Each bounce | 6 |
| The body's jolt past 3 g | 1.5 a g, up to 15 |
| Landing short on the top, or on the flat past the slope | 8 |

80 and up is **Clean** (cool blue), 50 and up **Firm** (amber), below that
**Hard** (red), always with the word. A stock light 4x4 scores about 96,
87, 79, 69, 29 and 16 from 45 to 70 km/h. Longer bump stops are the biggest
fix (69 to 78 at 60 km/h, 29 to 57 at 65), then softer springs (the lip
throws the truck less high) and more rebound. The harness
`scripts/harness/jumps.harness.ts` prints every landing for any tune.

**On screen** the jump ramp runs at true speed as **one unbroken side-on
shot** (v1.28, Kelbo asked for it smoother and more continuous). The other
rigs play short clips with cuts between camera angles; the jump ramp's view
instead follows the pose log a quarter of a second behind the sim, easing
its pace a touch to hold that gap, so it never catches up and stops
(`ClipStream` in `src/render/trackView.ts`, `VIEW_3D.streamLead`). The road
and scenery are laid once for the whole lap plus a margin each end; every
lap has the same land, so when the truck comes round the view puts it back
at the start of the same strip and nothing on screen jumps. The run no
longer stops after a landing: a line over the view gives each landing's
score as it comes, and the shop keeps each landing's moments (`keepLandings`
in `src/ui/shop.ts`).

**Slow-motion replays** are on the report: each landing has a **Watch in
slow motion** button that plays it again in the 3D view (0.3×): a dust puff where the wheels touch, an amber puff at a corner
when that end reaches its bump stops, a red one and a jolt for a
bottom-out, and the caption saying each as it comes ("Nose first: 11°
down against the slope", "Rear bump stops hit", "Bottomed out: rear left,
metal to metal"), then the verdict ("Clean landing: 87 out of 100"). The
replays work after Fast and Skip too.

**The report** (`src/ui/jumpReport.ts`) says how far up the speeds it landed
clean and the best landing, has a crew note on the worst habit (bottoming,
nose dives, bounces, or flying past the slope), and lists every landing with
its score and what happened. **Before and after:** beside each landing is
the same jump on the last run here (its scores are saved with the last-run
line, `landings` in the save's `ghosts` record) and, when racing a ghost
truck, the ghost's own landing, each with Better, Same or Worse (within 3
points is the same), and a count of each. Then up to three fixes (longer
bump stops and softer springs for bottoming, rear rebound for nose dives or
bounces), what broke if something did, and the pace check over the raids'
jump ground.

The ghost truck works on the jump ramp like on the loops: your best run is
the one that took the most jumps.

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
   Fixes that can't be done on this truck in this year are skipped and the
   next one takes their place (`fixUseful` in `src/ui/fixes.ts`, after
   Kelbo's playtest): a bigger shock or compression clicks need a shock
   that's on sale, and a slider that's already all the way doesn't count.
   So a 1985 fade offers fewer clicks of rebound (softer rebound makes less
   heat) and a slower pace.

The shaker's report opens with a verdict (Kelbo's playtest): Good, Fair or
Poor, with a chip for the body (Calm, Lively, Floaty) and the wheels
(Planted, Skipping, Hopping) in the trace rule's colours and a sentence on
what it means for a raid. The limits are per class in `SHAKER.verdict`
(`src/data/rigs.ts`), set so stock trucks are Fair, four more clicks of
rebound Good and four fewer Poor. Then it says where the body bounces and
the wheels hop, what that means on washboard, and jumps to the spring rate
(moves the bounce) and the rebound clicks (calms the hop; the dampers part
if they have no adjuster).

## What it means on a raid

Playtest, 26 November 2026: the rigs didn't predict the raids. The ladder
climbs 5 km/h a lap on short laps, so the oil never has time to settle:
a stock light 4x4 fades at 90 to 100 km/h there, while a raid drives rough
gravel at 44 km/h (Steady) for many kilometres at a time, with oil that
tires over the days. So under the washboard ladder's and the torture
loop's reports there's now a **pace check** (`docs/RAIDS.md`): the ride sim
drives 5 km of the raid ground the rig stands for (washboard and rough
gravel for the ladder; whoops, rocks and jumps for the torture loop) at
Conserve, Steady and Push speeds, in 20 °C, with this truck and an average
driver, and says how hot the shocks settle and how fast the worst part
wears at each. Same lines as the raid morning's.

## Ghost runs

The last finished run on each rig, for each class, is saved with the garage
(plan PR 8, `docs/SAVES.md`), so it survives a reload. A career keeps its
own last runs and best-run ghosts, filed under `career<seed>:` in front of
the key (`careerScope` in `src/persist/ghost.ts`), so free play's don't show
up in it; an old career's are dropped when a new one starts in the slot.
Friends' ghosts are shared. The next run draws it as a faint dashed line on
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

`tests/jumps.test.ts`: the tabletop's shape; one scored landing a jump for
every class; every stock truck clean on the slope at 50 km/h and on the flat,
bottoming, at 70; nose dives growing with speed; longer bump stops scoring
better; a run in pieces scoring the same as one all at once.

`tests/ghost.test.ts`: ghosts drive again exactly, best and race results,
ghost codes. `tests/rigs.test.ts`: step by step equals all at once; the history; the
trace ending on the breaking step; the ladder getting hotter every lap; the
shaker finding the bounce and the hop for every class, and stiffer springs
moving the bounce; every fix jumping somewhere the build screen has.
