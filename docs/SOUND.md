# Sound and buzz

How Bump Stop sounds (plan PR 6). The code is in `src/audio/`; every number
is in `src/data/sound.ts`.

## No recordings (yet)

Every sound is made live in the browser from numbers and from what the sim
is doing. There are no sound files, so nothing to download and nothing to
credit. The plan pictured openly licensed recordings; none of the sound
libraries could be reached from the cloud machine that built this, and made
sounds can follow every hit and every degree of oil exactly. Recordings can
still be layered in later, each with a line in `CREDITS.md`.

## What you hear

| Sound | Made from | When |
| --- | --- | --- |
| Engine | The engine part's firing pattern, played at its engine speed | All through a lap run; idling quietly on the shaker |
| Diesel knock | A band of noise pulsed in time with the firing | Diesels, loudest when working least |
| Turbo | A whistle and a whoosh that rise with boost | Turbo engines, at high revs and load |
| Rattles | Short ticks and knocks, as many as the suspension is busy | All the time, busier on rough ground and fast |
| Tire strikes | A thump, or a sharp clack in the rock garden | The biggest hard hit in a moment, bigger is deeper |
| Bottom-out | A heavy metal clunk with a short ring | Every time a wheel hits its hard limit |
| Hot shocks | A hiss from the dampers' warm line to their red line, sputtering over it | As the oil heats up |
| Shaker hum | The posts' servo, rising with the beat | The shaker rig |
| Breaks | Fade: a long hiss that sputters out. Bottomed out: a big clang. Cracked mount: a crack and a rattle. Snapped axle or CV: a bang, a boom and a clatter. Cut tire: a pop and the air rushing out. Frame crack: a groan of steel, then a snap | The moment something lets go; the engine dies with it |

## The engine voice

The idea comes from Prairie Engine Works (an engine voice built from the
engine's specs); this is a fresh version, not copied code.

Each engine in `ENGINE_SOUNDS` lists where in the crank's two turns each
cylinder fires and how loud each pulse sounds. `engineHarmonics`
(`src/audio/profile.ts`) adds those pulses up into one repeating waveform,
which plays at the engine's speed:

- An even straight-six only has the notes at multiples of six: a smooth hum.
- A cross-plane V8's two banks fire unevenly, and the far bank sounds
  quieter and a little later, so the notes in between fill in: the burble.
- A 270° twin fires at 0° and 270°, then waits: the lope.

Engine speed comes from the road speed and the class's gearbox
(`GEARBOXES`). The light 4x4 (5 gears) and heavy truck (9 gears) hold the
highest gear that keeps the engine above about 40 to 50% of its red line, so
the revs climb lap by lap and drop at each shift. The side-by-side has a
belt (CVT): the revs jump up as it moves off and then hold, creeping up at
top speed. The grit and the tone filter open up with revs and load.

## Keeping it readable

The rigs play a run much faster than real time (a lap in about 4 seconds),
so one frame can hold dozens of hits. `src/audio/cues.ts` keeps it
readable:

- The rattles follow how busy the suspension is: the ground's own rattle at
  that speed or how hard the dampers are working, whichever is more, plus
  the strikes. Never more than 22 a second.
- Only the biggest tire strike in a frame gets its own sound, and strikes
  are at least 0.12 s apart (bottom-outs 0.16 s). Small strikes only add to
  the rattles.
- "Skip to the end" is silent until the break.

The lap runner counts the hits for this (`RunFeel` in `src/sim/laps.ts`:
tire strikes over 2.5 times the corner's resting load, bottom-outs, and the
dampers' work). Counting changes nothing in the run; the sound takes and
empties the count every frame.

## Buzz

On phones that can vibrate (most Android phones; iPhones can't from a web
page), there's a short buzz on big tire strikes, a harder one on every
bottom-out, and a long one when something breaks. Buzzes are at least 0.6 s
apart.

## Switches

"Sound: on" and "Buzz: on" sit under the start button in the shop (Buzz only
shows on phones that can). They're kept in `localStorage` as
`bumpstop.sound` and `bumpstop.buzz`. On an iPhone the silent switch mutes
the game too.

Browsers only allow sound after a tap, so the sound wakes up when you tap
to start a run. It pauses when the tab is hidden.

## Tests

`tests/sound.test.ts`: every engine part has a sound; the straight-six only
sounds at multiples of six, the V8 burbles and the twin lopes; engine speed
stays between idle and the red line and the gears only go up; the cues
(silent while skipping, clunk and buzz on a bottom-out but not twice in the
gap, clacks only for big strikes in the rocks, rattles capped, the hiss from
the warm line, a sound and buzz for every failure); every short sound is
finite, never clips and is the same every time; the hit counter finds more
strikes in the rock garden than on the graded road and its time adds up.
