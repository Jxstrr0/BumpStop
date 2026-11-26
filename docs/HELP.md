# The help (plan PR 11)

How the help works, in plain words. Part 11a adds the Help panel (damper
lessons and the glossary). Part 11b turns the career's first job into a
tutorial.

## Where it is

A **Help** panel near the bottom of the page, under Saves and backups, with
two folding sections. The loop panel at the top has an **Open the help**
button that scrolls down to it.

## Damper lessons (11a)

Four short lessons, one at a time, with **Back** and **Next lesson**:

| Lesson | What it shows | The slider | The chart |
| --- | --- | --- | --- |
| 1. What a damper does | A spring alone keeps bouncing; the damper turns bounce into heat; too much sends every bump into the body | Damping, from none at all to far too much | Body height over one 10 cm bump at 30 km/h |
| 2. Compression and rebound | Too much rebound packs the wheel up into its travel on fast ripples; too little lets the body bob | Rebound | Wheel travel used on washboard at 40 km/h |
| 3. Hot oil, cold oil | Hot oil thins, then foams (fade); cold oil is stiff | none: it draws **your own dampers** | How hard your dampers damp at each oil temperature, with Normal, Warm and Over the limit |
| 4. Running out of travel | Bump stops, and bottoming out metal to metal | Spring rate and bump stop length | Wheel travel used over an 18 cm whoop at 55 km/h |

Under each chart a line of numbers says the same thing in words (still
bouncing or settled, how long the tire was off the ground, the biggest
jolt, the heat in the oil, how much travel was left), so colour is never
the only signal. The dashed line is always the damper as the factory set
it. Each lesson ends with **Try it on your truck**: buttons that jump to the
part or slider on the build screen, like the report's fixes.

**How lessons 1, 2 and 4 work.** They don't use the game's truck. They
drive a toy: one corner of a light 4x4, two weights (the body and the
wheel) on a spring, a damper with a knee (it softens on sharp hits like the
real ones), a bump stop that stiffens as it squashes, a hard limit, a limit
strap and a tire that can leave the ground. It's in `src/sim/lesson.ts`,
with its numbers and roads in `src/data/lessons.ts`. A clip takes a
millisecond or two, so the chart follows the slider live. It never changes
anything in the game.

**Lesson 3** uses the real thing: the sim's own `dampingMultiplier` for the
front dampers on the build screen, so changing dampers changes the chart.

## Glossary (11a)

44 words, A to Z: suspension words (anti-roll bar to whoops) and the
rally-raid words the game uses (bivouac, pace call, privateer, roadbook,
stage). A search box filters them as you type. Where the build screen has
the part or slider, **Show me** jumps to it. The list is
`src/data/glossary.ts`; the words are `glossary.<id>` and
`glossary.<id>Text` in `src/data/strings.ts`.

## The first-job guide (11b)

The career's very first job is a tutorial. While the garage is on its first
raid (the Cold Start 300 since PR 10c), a **Your first job** box sits at the
top of the Career panel with the steps, each ticking itself off when it's
done, in any order:

1. **Take privateer #n's job.** The career's first offer is always an old
   light 4x4 with 85% of the class's test budget, enough for studded tires
   (`CONTRACTS.firstJob` in `src/data/career.ts`). Every other offer is as
   it was.
2. **Fit studded tires** (only when the first raid is a winter one).
3. **Break it on the test track:** any finished rig run with their truck.
4. **Read the report, fix it, run it again:** a second finished run.
5. **Hand it over.**
6. **Read the results**, with a last word on what comes next.

Only the step being done now opens up, with its words, a **Show me** that
scrolls to the right button and a **What does "..." mean?** that opens the
glossary at the word. **Hide the guide** folds it to one button. Taking your
own truck to the first raid, or sitting it out, puts the guide away.

The guide sits in the Career panel, so it's out of sight while you work on
the build screen or in the shop. When a step ticks off there, a note pops
up at the top of the screen (Done: the step, Now: the next one, and **Back
to the guide**); it goes by itself after nine seconds. If the guide is on
screen the ticked step just flashes, and a hidden guide stays quiet
(Kelbo's playtest, 26 November 2026).

How far you got (runs, the privateer's number, hidden or not) is kept in
the browser under `bumpstop.guide`, tied to the career's seed. It isn't in
the save or the save code: losing it only means the run steps tick again.
The shop tells the page about finished runs and tapped fixes with an event
(`src/ui/events.ts`); the guide is `src/ui/tutorial.ts`.

## Tests

`tests/help.test.ts` checks the toy shows what each lesson says (no damping
keeps bouncing and the tire skips; more rebound sits the wheel higher on
washboard at every step; the factory corner just keeps off the hard limit
while soft springs or a short bump stop bottom out), that every dial step
has a number, and that every glossary word has its words and a jump that
works in every class.

`tests/tutorial.test.ts` checks the first job is always a light 4x4 that can
afford studded tires (60 careers), that later raids still roll their own
first offer, and that the guide's steps tick off in order through to the
results and step aside for your own entry or a skipped raid.
