# Credits

Bump Stop is made by Kelbo / Longlight Interactive. Every third-party file
the game ships is listed here. Only CC0, CC BY or SIL Open Font License
assets are used, and each one gets a line.

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

Every sound (plan PR 6) is made live in the browser by the game's own code
(`src/audio/`). Real recordings can stand in for the short sounds and the
hiss (`src/data/recordings.ts`, files in `public/sounds/`); there are none
yet. Each one added gets a line in this table: the file name, its title,
author, licence and the page it came from.
