# Sound and buzz

How Bump Stop sounds (plan PR 6). The code is in `src/audio/`; every number
is in `src/data/sound.ts`.

## Made sounds, and recordings on top

Every sound is made live in the browser from numbers and from what the sim
is doing, so the game never needs a sound file to make noise. Recordings
stand in for the short sounds and the hot-shock hiss (since v1.2.0.0, 17
made with ElevenLabs); see "Recordings" below. `?sound=made` plays only the
made sounds, to compare. The engine always stays made in code, because it
follows every engine part's firing pattern and speed exactly.

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

## Recordings

A real recording can take the place of any short sound (the rattles, tire
strikes, bottom-outs and the six break sounds) or of the hot-shock hiss.
They're listed in `src/data/recordings.ts`; the files live in
`public/sounds/`, and each one gets a line in `CREDITS.md`.

- The game loads them in the background when the sound first wakes up.
  Until a file arrives, or if it's missing, can't be read or the phone was
  offline, the made sound plays. A recording can never leave the game silent.
- Each one is tidied as it loads (`src/audio/recordings.ts`): mixed down to
  one channel, its loudest moment brought to the same level as every other
  recording, and cut with a fade if it runs long (1.2 s for rattles and
  hits, 3.5 s for breaks, 6 s for the hiss loop, whose end is blended into
  its start so it goes round without a click). Its `gain` then turns it up
  or down against the made sound.
- Two or more recordings for the same sound take turns, and the cues still
  vary their pitch a little, so repeats don't all sound alike.
- Downloaded recordings must be CC0 or CC BY (CLAUDE.md, Content rules).
  Sounds made for Bump Stop with ElevenLabs' sound-effect maker are allowed
  too (Kelbo, 26 November 2026), with the licence `Made for Bump Stop`. The
  Settings panel's Credits lists every recording with its author, licence
  and page.

### What's in now (v1.2.0.0)

17 sounds made with ElevenLabs (in the Bump Stop flow in Kelbo's
ElevenLabs workspace): two takes each of the tick, knock, tire strike, rock
strike and bump-stop clunk, one of each of the six breaks, and a 6-second
hot-shock hiss loop. They were made as one joined file with a second of
silence between them, then cut apart on the silences and saved mono,
22.05 kHz, 48 kbps MP3 (248 KB for all 17; the offline copy fetches them
up front with everything else). To remake one, cut it the same way:

```
ffmpeg -ss <start> -t <length> -i joined.mp3 -af "afade=t=in:d=0.005,afade=t=out:st=<length-0.04>:d=0.04,aresample=22050" \
  -ac 1 -c:a libmp3lame -b:a 48k -map_metadata -1 public/sounds/<name>-v2.mp3
```

(the hiss loop without the fades: the game blends its end into its start).
Give a changed file a new name, so phones don't keep the old copy.
- Add `?sound=made` to the address to hear the made sounds only, for a
  side-by-side.

### Adding one

1. Put the file in `public/sounds/`, named for the sound it replaces
   (`clunk-1.mp3`, `clunk-2.mp3`, `hiss-loop.ogg`...). MP3 or OGG, under
   300 KB.
2. Add its line to `RECORDINGS` in `src/data/recordings.ts`: which sound,
   the file, its title, author, licence and page, and a gain of 1 to start.
3. Add its line to `CREDITS.md` under "Sound and art".

`tests/recordings.test.ts` turns red if a listed file is missing or too
big, isn't credited, or if a file sits in `public/sounds/` without a line.

| Sound | What a good recording sounds like |
| --- | --- |
| `tick`, `knock` | Small metal rattles and knocks: a loose bracket, chain links, a spanner tapped on a frame |
| `strike` | A dull thump: a tire hitting a pothole edge, a heavy bag dropped on a floor |
| `rockStrike` | A sharp clack: a rock hitting steel, a stone on a skid plate |
| `clunk` | A heavy metal clunk with a short ring: suspension bottoming out, a hammer on an anvil, a car door slammed hard |
| `hissOut` | A long hiss that sputters out: air or steam escaping |
| `clang` | A big steel clang |
| `crack` | A crack and a rattle: metal snapping, a branch breaking |
| `bang` | A loud bang and clatter: something mechanical letting go |
| `pop` | A tire burst and the air rushing out |
| `groan` | Steel groaning or creaking under load, then a snap |
| `hissLoop` | A steady hiss with no start or end: steam, a leaking air line |

## The radio co-driver

Kelbo picked it on 27 November 2026. On a raid stage a co-driver talks over
the helmet intercom, rally style: short calls warning of what's ahead.

**What he says.** As each highlight clip starts, he reads that clip's real
road ahead of the truck (`src/audio/pacenotes.ts`). Whoops, rocks, jumps
and frost heaves are spotted by looking down both wheel tracks for a
stretch whose highest and lowest points are far enough apart
(`RADIO_SPOT` in `src/data/radio.ts`): 10 cm for whoops, 8 cm for rocks,
35 cm for jumps, 10 cm for heaves. The first one ahead gets its name, with
"Caution" when the biggest one there is big (whoops 24 cm, rocks 13 cm,
jumps 85 cm), and its distance rounded to 30, 50, 80, 100 or 200 m if
it's at least 16 m off ("Caution. Big jump. 30."). A heave with a crack
edge facing the truck is "Caution. Heave, step up." The thaw and the dust
storm make the same bumps bigger, so he says "Caution" more often in them.
Plain ground (graded, washboard, rough gravel, ice, snow) gets its name when
the road turns into it, and not again until it changes. To give him time,
clips now start up to two seconds before their busiest stretch
(`CLIP.lead` in `src/sim/highlight.ts`).

He also calls the start ("Three, two, one… go!"), off again after a
checkpoint, into the checkpoint, the finish (unless the truck was towed in
late), each stop as the highlight reaches it (a breakdown, cooked shocks, a
rock underneath, a snowbank, the ice cracking), the ice creaking, the
weather turning, and the first time the hottest oil goes past the warm
line. Nothing he says changes a result: he only reads what the sim did.

**How it sounds** (`src/audio/radio.ts`). One call at a time. A call that
comes while he's talking waits, but only the newest waits, and it's dropped
if it waits more than 2.5 s, since an old warning is worse than none.
Trouble cuts in. Skipping hushes him, and what flew past goes in the log
without a call. The recordings are clean; the intercom is made live: a
band from 320 to 3,600 Hz, a touch of grit, and a click of hiss as the mic
keys up and lets go. Numbers in `RADIO`.

**The voice.** 32 lines, one take each, made for Bump Stop with ElevenLabs'
text to speech in the "Joe English" voice from its voice library (a
Northern English voice, for Birchland's English-flavoured north), then
trimmed, made mono 22 kHz and shrunk to 48 kbps: about 300 KB in all, in
`public/radio/`, which the offline copy keeps like everything else. They
cost about 600 ElevenLabs credits. "One fifty" was skipped, so 150 m
rounds to 100 or 200.

**Captions and settings.** His words show over the picture on a
highlighter slip while he talks ("CO-DRIVER Caution. Big jump. 30."), so
the calls work on a phone on silent too. Settings has **On** (voice and
words), **Words only** and **Off**, and a volume slider for his voice. The
pick is kept in `bumpstop.radio` and `bumpstop.radioVolume`. A browser with
no sound offers words only. He has his own switch, apart from the test
track's Sound switch.

## Tests

`tests/sound.test.ts`: every engine part has a sound; the straight-six only
sounds at multiples of six, the V8 burbles and the twin lopes; engine speed
stays between idle and the red line and the gears only go up; the cues
(silent while skipping, clunk and buzz on a bottom-out but not twice in the
gap, clacks only for big strikes in the rocks, rattles capped, the hiss from
the warm line, a sound and buzz for every failure); every short sound is
finite, never clips and is the same every time; the hit counter finds more
strikes in the rock garden than on the graded road and its time adds up.

`tests/recordings.test.ts`: every short sound can have a recording; every
listed file is there, under 300 KB, CC0 or CC BY and credited in
`CREDITS.md`; every file in `public/sounds/` is listed; the tidy-up mixes
to one channel, evens out the loudness, cuts and fades long recordings,
blends a loop's ends and leaves silence silent.

`tests/radio.test.ts`: every co-driver line has a file under 40 KB in
`public/radio/`, its words and a credit, and every file there is a line;
captions read like a roadbook; distances round to the nearest call and none
is said for something right under the truck; a jump is called with its
distance, a big one gets a Caution, a set of whoops is called by its
tallest, a step-up crack is told from a plain heave; plain ground is called
once when it changes; and on real seeded roads the rough grounds get calls
and the smooth ones none.
