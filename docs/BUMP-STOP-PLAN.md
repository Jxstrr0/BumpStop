# Bump Stop plan

25 November 2026 · for Kelbo / Longlight Interactive

> **Plan of record.** Copied into the repo in PR 0. Where it and `CLAUDE.md` disagree, `CLAUDE.md` wins. Progress lives in `docs/STATUS.md`, names in `docs/NAMES.md`.

## Pitch

Bump Stop is a rally-raid truck builder: build the truck, run it on the test track until the suspension gives up, read why, tune it, and then send it into a multi-day raid where damage stacks from stage to stage. One test lap takes about a minute, so the loop fits a short break.

**Tagline (draft):** Build a rally truck, find the speed where it breaks, then go racing.

**The loop**

1. **Build it.** Pick frame, springs, dampers, bump stops, axles, tires and protection under the class weight and your budget.
2. **Break it.** The test track speeds up lap by lap until a damper overheats and fades, the springs bottom out, or an axle snaps. The failure plays back in slow motion with its trace.
3. **Tune it.** The report says what let go, why, and jumps to the setting that fixes it: damper clicks, spring rate, ride height, tire pressure. Run it again with the last run as a ghost.
4. **Prove it.** Enter a raid. Your driver drives, you call the pace per stage, and you patch the truck at the bivouac each night with limited hours and spares.

**Pillars**

- **The failure is the show.** Every break has a cause the player can read, a trace that shows it, and a jump to where to fix it.
- **Heat is the enemy.** Dampers turn bumps into heat. Fast over rough ground means hot oil, and hot oil means fade. Most tuning is managing that.
- **Real suspension words, explained.** Compression, rebound, bottoming, bypass, unsprung mass: used as they are, with a glossary.
- **Nobody gets hurt.** Trucks break and stop; crews are always fine.

## Your decisions

Five choices were put to you as cards in the thread. The plan below uses the recommended answer for each one you haven't answered yet, and I'll rework any section you answer differently.

| Choice | Plan uses for now | Other options | Your answer |
| --- | --- | --- | --- |
| Setting | A made-up northern country, summer and winter raids | Hot desert; a world series of raids | Waiting |
| Era | 1985 to 2025 | 2026 to 2050; no dates | Waiting |
| Who drives | A hired driver, you call the pace | You drive; driver in raids, you on the test track | Waiting |
| Career pace | A raid calendar, about six raids a year | One-raid roguelike runs; open sandbox | Waiting |
| First classes | Light 4x4, heavy truck and side-by-side at launch | Light 4x4 first, more later | Three classes from day one |

I've made two smaller calls myself, which you can overrule: the game is built like Mainline (TypeScript, Vite, three.js), and its UI is styled like a rally roadbook (see Look).

## World

A made-up northern country of boreal forest, lakes and tundra, 1985 to 2025. Its rally raids run on logging roads, eskers, rock and muskeg in summer, and on frozen lakes and ice roads in winter. Its name, money and towns get picked in PR 0 and checked against the studio's list of names already taken (no V names, nothing from another Longlight world).

**Two seasons, two tunes**

| Season | Ground | What it does to the truck |
| --- | --- | --- |
| Summer | Washboard gravel, rock gardens, whoops, river crossings, dust | Dampers run hot; rocks cut tires; landings bottom the springs |
| Winter | Ice roads, packed snow, frost heaves, -30 °C mornings | Cold oil makes dampers stiff until they warm up; studs or not; ice cracks under heavy trucks |
| Spring thaw (later) | Mud and soft ground | Weight and ground clearance matter most |

**Raids (working names, to check in PR 0)**

- A regional winter raid: 3 stages, where the career starts.
- A summer gravel raid: 4 to 5 stages.
- National raids: 6 to 8 stages, rival works teams.
- The long one: a two-week raid across the whole country, the career's finale.

**Tone:** dusty, cold, hands-on and a bit funny, like PEW's shop. Fictional teams, sponsors and parts makers; real suspension terms. No real raids, brands or places.

## The truck

The player builds one truck at a time from about 12 part slots, under the class's minimum and maximum weight and the money in the bank. Every part has mass, cost, strength and the year it becomes available. All numbers live in data tables, not code.

**Classes**

| Class | Arrives | Weight | Character |
| --- | --- | --- | --- |
| Light 4x4 | At launch | about 1,800 to 2,100 kg | Nimble, fragile, cheap to fix; where the career starts |
| Heavy truck | At launch | about 8,500 to 10,000 kg | Big, slow to heat-soak, brutal on axles and ice |
| Side-by-side | At launch | about 900 to 1,100 kg | Huge travel, tiny dampers that cook fast |

**Part slots** (shown for the Light 4x4; the heavy truck and side-by-side use the same slots with their own sizes)

| Slot | Options over the years | What it trades |
| --- | --- | --- |
| Frame | Ladder frame, boxed ladder, tube spaceframe (1990s+) | Mass, stiffness, crack resistance |
| Front suspension | Solid axle on leaves, solid axle on coils, double wishbone (1990s+) | Travel, unsprung mass, strength |
| Rear suspension | Leaf springs, coil and link, trailing arm | Travel, axle control, cost |
| Springs | Leaf packs, coils, coil-over, dual-rate coils | Rate (N/mm), preload, sag |
| Dampers | Twin-tube, monotube, remote reservoir, bypass (1990s+), internal bypass, electronic (2015+) | Oil volume (how long before fade), cooling, adjustability |
| Bump stops | Rubber, urethane, hydraulic (2000s+) | How hard the last few cm of travel hit |
| Anti-roll bars | None, fixed, adjustable | Body roll against articulation |
| Axles and CV joints | Standard, heavy duty, gun-drilled chromoly | Strength against unsprung mass |
| Wheels | Steel, alloy, beadlock | Mass, and whether a flat stays on the rim |
| Tires | Sizes and casings; studded for winter | Grip, cut resistance, pressure range |
| Protection | Skid plates, rock sliders, diff guards | Mass against rock damage |
| Engine | 3 or 4 choices, petrol and diesel | Power, mass, heat; kept simple on purpose |
| Spares carried | Shocks, CVs, tires, leaf packs | Weight on board against what you can fix at night |

The settings players tune live on the parts: damper clicks (low-speed and high-speed compression, rebound), spring preload, ride height, bump stop length, tire pressure.

## Break it and tune it

The shop has three rigs, and each one ends when something breaks or the player stops it. One run takes 30 seconds to 2 minutes.

**The rigs**

| Rig | What it does | What it finds |
| --- | --- | --- |
| Shaker rig | Four posts shake the parked truck through a sweep of bump speeds | Where the body and wheels bounce most; a quick check, no damage |
| Washboard ladder | A test loop that gets 5 km/h faster every lap | The speed where the dampers fade, and how long they last |
| Torture loop | Whoops, a rock garden and a jump, faster each lap | Bottoming, cracked mounts, snapped axles, cut tires |

**How things break** (each with its own trace)

| Failure | Cause | The trace | Where to fix it |
| --- | --- | --- | --- |
| Damper fade | Oil too hot, so damping drops and the wheels skip | Oil temperature crossing the red line, then wheel travel going wild | Bigger damper or reservoir, less compression, slower pace |
| Bottoming | Springs and bump stops run out of travel | Wheel travel hitting the stop, with a spike in load | Stiffer springs, longer or hydraulic bump stops, more ride height |
| Cracked mount | Repeated hard hits wear out a shock or spring mount | A damage bar filling up over the laps | Stronger mounts, softer bump stops |
| Snapped axle or CV | Too much angle or a landing with the wheel spinning | Joint angle and torque at the moment it let go | Less travel, stronger axle, limit straps |
| Cut tire | A rock hit at low pressure | Pressure and hit size | More pressure, stronger casing, beadlocks |
| Frame crack | Fatigue in a soft frame | Damage map on the frame | Stiffer frame, gussets |

**The report**

Every run ends on a one-screen report: what let go first, the trace at that moment in slow motion, and up to three suggested fixes, each a tap that jumps to the right slider. The next run shows the last one as a ghost line, so the player sees whether the fix worked. A short note in a crew member's voice adds colour ("rear shocks were hot enough to fry an egg by lap 6").

## Prove it: raids and the career

A raid is the test the player didn't design: long stages, mixed ground, and damage that carries over to the next day.

**A raid day**

1. **Morning:** read the roadbook for the stage (distance, ground mix, weather) and set the truck up.
2. **Pace call:** Conserve, Steady or Push, changeable at two checkpoints. Push is faster and heats everything; Conserve saves the truck and loses time.
3. **The stage:** watch a 1 to 2 minute highlight of the stage in 3D, with the live traces down the side. Breakdowns stop the truck; the crew does a roadside fix or loses time.
4. **Bivouac night:** a set number of mechanic hours and the spares you carried. Choose what to fix, swap or leave. What's left broken carries into tomorrow.
5. **Results:** stage time, overall place, and the rival teams.

**The driver** has traits that matter to tuning: smooth or hard on the kit, quick or steady, good on ice or on rock. Better drivers cost more and want better trucks.

**The career (1985 to 2025)**

- **Start:** a two-person garage in 1985, prepping a privateer's old 4x4 for a three-stage winter raid.
- **Money:** prep contracts from privateer drivers first (they pay; you build to their budget), then your own entry, then sponsors and a works deal.
- **Calendar:** about six raids a year, winter and summer. Between raids the player builds, tests and takes contracts; time moves by days, not weeks.
- **Upgrades:** new parts arrive with their year (bypass shocks in the 1990s, hydraulic bump stops in the 2000s, electronic dampers in the 2010s). The shop gains tools and crew, but stays one garage and a truck that travels.
- **Rivals:** three or four rival teams with their own trucks and habits, who copy what wins.
- **Ending:** win the long one, the two-week national raid. The career can go on after.
- **Broke:** a soft landing like Laminar's: sell parts and take a contract to get going again.

## Look, sound and controls

**Look: "Roadbook."** The UI borrows from a rally roadbook: paper strips with turn diagrams, distances and pencil notes, light first, with a dark mode for night stages. Birch-white paper, graphite ink, and one highlighter accent in fluorescent magenta, which no other Longlight game uses. Traces follow one colour rule everywhere: cool blue for normal, amber for warm, red for over the limit, always with a label so colour is never the only signal. Fonts to confirm in PR 0, both unused elsewhere in the studio: Big Shoulders for headings and Overpass Mono for numbers, self-hosted.

**3D:** the truck on a strip of terrain, with the suspension visibly working: wheels cycling, shocks compressing, dust and snow spray. The model is built in Blender by script, like Mainline's trains. When something breaks, the camera slows down and zooms to the part. Lite, Full and Ultra graphics, stepping down on slow phones.

**Sound:** the engine voice built from the engine choice (PEW's idea, rewritten), plus suspension clatter, rock strikes, the hiss of a hot shock, and a bang when something lets go. Openly licensed recordings with a credit line each.

**Controls:** portrait first, one thumb. Tap to build, sliders and click wheels to tune, tap the pace call. No steering. Haptics on hits and breaks.

## Tech and rules

**Stack:** the Mainline shape. TypeScript (strict), Vite with `base: './'`, three.js 0.187 from npm, plain DOM UI, Vitest. Pages from Actions; a GitHub Release for every `VERSION` bump so the studio site shows the right version.

**The sim** (`src/sim/`, `src/data/`) is pure and deterministic: no DOM or three.js, seeded named RNG streams, its own `det.ts` maths, SI units inside, a fixed time step. Every number lives in `src/data/`.

- **Ride model:** a full-car model with seven moving parts (the body's bounce, pitch and roll, plus four wheels), stepped at 500 Hz. Cheap enough for a phone.
- **Ground:** road profiles built from seeded recipes: washboard (wavelength and height), whoops, rocks, jumps, ice heaves.
- **Heat:** each damper turns its work into heat; oil temperature sets how hard it damps, so fade comes out of the physics rather than a dice roll. Cold oil damps harder until it warms.
- **Wear:** each part adds up damage from every load cycle, plus outright breaks on a single big hit.
- **Long stages:** a 300 km stage isn't simulated metre by metre. The sim runs full detail on sample sections and scales heat and wear between them, so a stage resolves in under a second.
- **Tests:** determinism (same seed, same result), energy sanity, a check that bans `Math.random` and `Date.now` in the sim, and a balance bot that builds trucks and runs the rigs.

**Saves:** keys `bumpstop.*`, IndexedDB `bumpstop` with three slots, caches `bumpstop-`, save code `BMP1:` (compressed, with a checksum), backup file `bump-stop-backup-YYYY-MM-DD.txt`, `persist()`, and a reminder after 14 days. Truck build codes `BMPT1:` so players can share a setup.

**Home:** repo `BumpStop`, address `bumpstop.longlight.games` (one line in the studio DNS file, with your OK). Hidden on the studio site until the first playable, like the other new games.

**Names:** every person, team, sponsor, place and parts maker in `docs/NAMES.md`, checked against the studio catalogue first. The catalogue gets a Bump Stop profile once the repo exists.

**Reuse (copied and marked `// Adapted from ...`):** Mainline's TypeScript setup, `det.ts` and RNG streams; Lombard's save code and save-safety screen; PEW's engine-voice idea and results card; Scrapline's sparks and flying parts; Lombard's screenshot tour for self-review.

## Staged PRs

Fourteen PRs, 0 to 13, from an empty repo to 1.0. The build, break, tune loop is playable in plain graphs at PR 4, and the whole game is first playable at PR 8. All three classes are in from PR 3, as you picked; that adds about two PRs over a one-class start.

| PR | What it adds | Version |
| --- | --- | --- |
| 0 | Repo, CLAUDE.md, this plan, NAMES.md (country, money, raids, teams), Vite skeleton, CI checks, Pages deploy, fonts | 0.1.0.0 |
| 1 | Ride sim: the seven-part truck model, ground recipes, damper heat and fade, determinism tests | 0.2 |
| 2 | Wear and breaks: fatigue, bottoming, mounts, axles and CVs, tires, frame; the balance bot | 0.3 |
| 3 | Parts data for Light 4x4, heavy truck and side-by-side; the build screen with weight and budget limits | 0.4 |
| 4 | The three rigs with live traces, the report with fix jumps, ghost runs. **The loop is playable in 2D.** | 0.5 |
| 5 | 3D: three truck models made by Blender script, terrain strip, suspension animation, slow-motion breaks | 0.6 |
| 6 | Sound: engine voice, suspension clatter, hits and breaks | 0.7 |
| 7 | The raid: roadbook, pace calls, driver traits, stage highlights, bivouac repairs, rivals in each class | 0.8 |
| 8 | Saves, save codes, backup files, truck build codes. **First playable**; listed on the studio site if you want | 0.9 |
| 9 | Career 1985 to 2025: contracts, calendar, money, parts arriving by year, rival teams | 0.10 |
| 10 | Winter: cold oil, ice roads, studs, frost heaves, ice that cracks under a heavy truck | 0.11 |
| 11 | Help: the first job as a tutorial, glossary, short lessons on what dampers do | 0.12 |
| 12 | Offline service worker, graphics tiers, a shareable truck card and photo mode | 0.13 |
| 13 | Balance across the three classes, the long one as the finale, final polish | 1.0.0.0 |

Each PR is small enough to read on a phone, merges on green, and ends with a plain-language summary and how to test it on your phone.

## Risks and open questions

| Risk | Why it matters | Plan |
| --- | --- | --- |
| Traces are hard to read on a phone | The whole game is reading why it broke | Design the report screen first in PR 4, with one big trace and a plain sentence on top; test it on a 360 px screen |
| Three classes at once spreads balance thin | Each class needs its own parts ranges and rivals | The balance bot runs every class in CI from PR 2; tuning numbers stay in data tables |
| Watching without steering could feel passive | No driving means the stage must still be tense | Short stage highlights, live traces, pace calls at checkpoints, slow-motion breaks |
| Long stages vs a 500 Hz sim | A 300 km stage can't run in full detail | Sample sections in full detail and scale heat and wear between them (PR 1 proves it) |
| Three truck models plus terrain | Art is the slowest part | Blender-by-script trucks sharing one parts kit; terrain from the same seeded recipes as the sim |

**Open questions**

- [ ] The country's name, its money and the raid names (PR 0, checked against the studio list).
- [ ] Is it OK to add `bumpstop.longlight.games` to the studio's DNS file when the repo is set up?
- [ ] Should the studio site list Bump Stop at the first playable (PR 8), or wait for 1.0?
- [ ] Crumple next: once Bump Stop is underway, I can plan it the same way.
