# Credits

Bump Stop is made by Kelbo / Longlight Interactive. Every third-party file
the game ships is listed here. Only CC0, CC BY or SIL Open Font License
assets are used (plus the sounds made for Bump Stop with ElevenLabs, below),
and each one gets a line.

## Fonts

| Font | Where | Licence |
| --- | --- | --- |
| Big Shoulders (The Big Shoulders Project Authors) | Headings, via `@fontsource/big-shoulders` | SIL Open Font License 1.1 |
| Overpass Mono (The Overpass Project Authors) | Numbers and readouts, via `@fontsource/overpass-mono` | SIL Open Font License 1.1 |
| Space Grotesk (Florian Karsten) | Studio pieces only (credit line), via `@fontsource/space-grotesk` | SIL Open Font License 1.1 |

## Code libraries

| Library | Where | Licence |
| --- | --- | --- |
| three.js (the three.js authors) | The 3D views, via `three` from npm (loaded only when a 3D view comes on screen) | MIT |

## Studio pieces

| File | Source |
| --- | --- |
| `public/brand/longlight-logo-dark.svg`, `longlight-logo-light.svg` | Longlight Interactive press kit (`Jxstrr0/Kelbo.Website` `assets/press/`) |

## Code adapted from other Longlight games

Each copied file says where it came from in its first line
(`// Adapted from <Repo> <path> (<date>)`).

## Sound and art

| File | Source |
| --- | --- |
| `public/models/truck-*.glb` | Made for Bump Stop by `scripts/blender/make-trucks.py` (no outside assets) |
| `public/icon.svg`, `icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Made for Bump Stop (the PNGs are drawn from `icon.svg`) |

The engine, turbo, diesel knock and shaker hum (plan PR 6) are made live in
the browser by the game's own code (`src/audio/`). The short sounds and the
hot-shock hiss use the recordings below (`src/data/recordings.ts`, files in
`public/sounds/`), with the made sounds as a fallback. Each one gets a line:
the file name, its title, author, licence and the page it came from.

Downloaded recordings must be CC0 or CC BY. The ones marked "Made for Bump
Stop" were made for this game with ElevenLabs' sound-effect maker (Kelbo
approved them on 26 November 2026), then cut, made mono and shrunk for the
web.

| File in `public/sounds/` | Title | Author | Licence | Page |
| --- | --- | --- | --- | --- |
| `tick-1.mp3`, `tick-2.mp3` | Suspension tick | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `knock-1.mp3`, `knock-2.mp3` | Suspension knock | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `strike-1.mp3`, `strike-2.mp3` | Tire strike | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `rock-strike-1.mp3`, `rock-strike-2.mp3` | Rock strike | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `clunk-1.mp3`, `clunk-2.mp3` | Bump stop clunk | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `hiss-out.mp3` | Damper fade | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `clang.mp3` | Bottom-out clang | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `crack.mp3` | Mount crack | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `bang.mp3` | Axle snap | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `pop.mp3` | Tire cut | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `groan.mp3` | Frame groan | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |
| `hiss-loop.mp3` | Hot shock hiss | ElevenLabs | Made for Bump Stop | https://elevenlabs.io/sound-effects |

### The radio co-driver

The co-driver's calls on a raid stage (Kelbo picked them, 27 November 2026;
`src/data/radio.ts`, files in `public/radio/`). Each line is one take made
for Bump Stop with ElevenLabs' text to speech, in the "Joe English" voice
from the ElevenLabs voice library, then trimmed, made mono and shrunk for
the web. The intercom sound is added live by the game (`src/audio/radio.ts`).

| File in `public/radio/` | Line | Voice | Licence | Page |
| --- | --- | --- | --- | --- |
| `flat.mp3` | Flat out. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `washboard.mp3` | Washboard. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `rough.mp3` | Rough gravel. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `ice.mp3` | Ice. Easy on it. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `snow.mp3` | Deep snow. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `whoops.mp3` | Whoops. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `whoops-big.mp3` | Caution. Big whoops. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `rocks.mp3` | Rocks. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `rocks-big.mp3` | Caution. Rocks. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `jump.mp3` | Jump. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `jump-big.mp3` | Caution. Big jump. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `heave.mp3` | Frost heave. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `heave-step.mp3` | Caution. Heave, step up. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `d30.mp3` | Thirty. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `d50.mp3` | Fifty. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `d80.mp3` | Eighty. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `d100.mp3` | One hundred. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `d200.mp3` | Two hundred. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `thaw.mp3` | Here comes the thaw. It's going soft. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `whiteout.mp3` | Whiteout! Can't see a thing. Ease off. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `dust.mp3` | Dust storm coming in. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `go.mp3` | Three, two, one... go! | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `go-on.mp3` | Right. Off we go. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `checkpoint.mp3` | Into the checkpoint. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `finish.mp3` | Flying finish! Nicely done. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `stop.mp3` | We're stopping. Let's sort it. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `cool.mp3` | Shocks are cooked. Let them cool. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `under.mp3` | Hit something underneath. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `slide.mp3` | Into the bank! Dig us out. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `crack.mp3` | The ice is going! Shore track! | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `creak.mp3` | Ice is creaking. Easy now. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
| `hot.mp3` | Shocks are getting hot. | Joe English (ElevenLabs) | Made for Bump Stop | https://elevenlabs.io/text-to-speech |
