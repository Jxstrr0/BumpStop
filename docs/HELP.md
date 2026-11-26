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

## Tests

`tests/help.test.ts` checks the toy shows what each lesson says (no damping
keeps bouncing and the tire skips; more rebound sits the wheel higher on
washboard at every step; the factory corner just keeps off the hard limit
while soft springs or a short bump stop bottom out), that every dial step
has a number, and that every glossary word has its words and a jump that
works in every class.
