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
