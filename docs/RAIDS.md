# Raids

How a raid works (plan PR 7). The sim is in `src/sim/raid.ts` (stages,
pace calls, roadside fixes, the bivouac), `src/sim/rivals.ts` (the other
entries) and `src/sim/highlight.ts` (clips for the 3D); long stages run
through `src/sim/stage.ts`. Every number is in `src/data/raids.ts`.

Part 7a is the sim and its tests. Part 7b adds the screens
(`src/ui/raid.ts`, with the 3D highlight in `src/ui/raidView.ts`).

## The screens

The Raids panel sits under the shop and moves through the raid:

1. **Entry:** pick the raid and the driver. The truck is the one on the
   build screen and must pass the build rules; it says what spares are on
   board (and warns if there are none).
2. **Morning:** "Day 1 of 3", the stage's length, air temperature and par
   time; the roadbook (each piece of ground with its kilometre, and the two
   checkpoints); the truck's worn parts and spares; the pace call.
3. **The stage, a leg at a time.** The sim drives the leg (about a second on
   a phone), then its highlight plays: up to seven clips (every break, the
   rest spread along the leg), about half a minute. Clips play in 3D at
   true speed; a break plays in slow motion, closing in on the corner. Under
   the 3D: the leg, kilometre, ground and pace, a progress bar, and the live
   trace of the hottest oil or the most worn part filling in along the
   stage, with the stops listed as the highlight reaches them. "Skip"
   jumps to the checkpoint.
4. **Checkpoint card:** the clock, the place in class at this checkpoint,
   the hottest oil and the most worn part, and the pace call for the next leg.
5. **Results:** the stage time, each stop, the day's table and the overall
   table (rivals' trouble noted under their names).
6. **Bivouac:** the hours bar, the spares left, and a button for each job.
   One job per part; jobs that don't fit the hours or spares grey out and say
   why.
7. **Final results** after the last stage, then enter another raid.

"Retire from the raid" (tap twice) goes back to the entry. The raid is saved
each morning, after each stage and at the end (plan PR 8, `docs/SAVES.md`);
a reload in the middle of a stage drives it again from its morning.

## A raid day

1. **Morning.** The roadbook for the stage: its length, ground and air
   temperature. The settings can change (spring rate, clicks, pressures...);
   the parts are locked once the raid starts (`raidTruck`).
2. **The stage**, in three legs split by two checkpoints (a third and two
   thirds of the way, to the nearest kilometre). Each leg has its own pace
   call: **Conserve**, **Steady** or **Push**.
3. **Breakdowns stop the truck.** The crew fixes it at the roadside, then
   the driver eases off one pace call for the rest of the leg.
4. **The bivouac.** Eight mechanic hours and the spares left on the truck.
   Pick jobs; what's left worn carries into tomorrow.
5. **Results.** Stage time and the class standings against the rivals.

## How a stage is driven

Every piece of ground has a **Steady speed** for each class: about as fast
as the stock truck can go there all day. The pace call scales it
(Conserve 0.88, Steady 1, Push 1.12), and so does the driver. The ride sim
then drives the stage at those speeds, piece of ground by piece, from the
oil temperatures and the wear the truck already has (`runStage` with
`StageOptions.wear`). So heat, fade and wear all come out of the physics.

The stage clock is distance ÷ speed for each piece, plus the stops. A
driver's good ground saves a little time (better lines) without going any
faster, so it doesn't hit any harder.

### The Steady speeds (km/h)

| Ground | Light 4x4 | Heavy truck | Side-by-side |
| --- | --- | --- | --- |
| Graded road | 85 | 75 | 78 |
| Washboard | 68 | 62 | 64 |
| Rough gravel | 44 | 42 | 34 |
| Whoops | 27 | 25 | 24 |
| Rock garden | 30 | 48 | 26 |
| Jumps | 48 | 44 | 35 |

Winter ground (frost heaves, ice road, packed snow) has its own speeds, set
by grip: see `docs/WINTER.md`.

They came from a sweep: each stock truck on 10 km of each ground, 20 to
80 km/h, 20 °C. What it showed:

- **Rough gravel has a cliff.** The light 4x4's oil settles at 100 °C at
  40 km/h, 113 °C at 45, and fades at 50. Steady sits just under the cliff,
  so a long rough stretch at Push on a hot day is where dampers cook.
- **Washboard is the other way round.** Between 25 and 50 km/h the wheels
  hop on every ripple and the dampers fade within a few kilometres; above
  55 km/h the truck skims it and the oil stays cool. Drivers skim it fast.
- **Rocks cut tires** (light 4x4 and side-by-side) once you go much over
  30 km/h; the heavy truck's big tires don't mind.
- **Jumps wear axles and bump stops** as the speed goes up.

### Engine and drivers

- **Engine:** on fast ground (graded and washboard) the speed follows the
  truck's power-to-weight against the stock truck's, to the power 0.15,
  between 0.94 and 1.08. A bigger engine is quicker on the open road; a
  heavier truck is slower.
- **Drivers** (named by their trade until Kelbo picks names):

| Driver | Speed | On the kit | Good on | Roadside fixes |
| --- | --- | --- | --- | --- |
| The veteran | 0.97 | smooth (6% slower on harsh ground) | rocks (10% less time) | normal |
| The charger | 1.03 | hard (6% faster on harsh ground) | whoops and jumps (7% less time) | normal |
| The gravel ace | 1.01 | neither | graded, washboard and rough (2% less time) | normal |
| The mechanic | 0.99 | fairly smooth | nothing special | 30% quicker |

Harsh ground is rough gravel, whoops, rocks, jumps and frost heaves. In
winter the veteran is good on ice roads too, and the gravel ace on packed
snow. Driver fees and
drivers wanting better trucks arrive with the career and money (plan PR 9).

## Roadside fixes

When something breaks, the truck stops where it broke:

| What broke | With a spare | Without (a bodge) |
| --- | --- | --- |
| Cut tire | 0.4 h, new tire | 1.2 h, plugged: left 60% worn |
| Bottomed out (shock) | 0.9 h, new shock | 1.5 h: left 70% worn |
| Snapped axle | 1 h, new CV joint | 2 h: left 80% worn |
| Cracked mount | none | 1.2 h, strapped: left 60% worn |
| Cracked frame | none | 1.5 h, strapped: left 70% worn |
| Damper fade | none | wait for the oil to cool to its warm line |

Hours are times 1.5 on a heavy truck and 0.8 on a side-by-side. A bodged
part goes again sooner. A faded damper waits as long as the cooling
physics says (the oil heads for the air temperature, a fixed share closer
every second, from `coolStill` and the oil's heat capacity), and never less
than 10 minutes. The oil cools during every stop.

After four stops on one leg the crew limps to the checkpoint at a third of
the Steady speed, with nothing more breaking. A stage closes at twice its
par time (Steady, average driver, no stops); a truck still out is towed in
and gets the closing time plus two hours.

## The bivouac

Eight mechanic hours a night (more with the career's crew), and twice that on the
Long One's rest day at halfway (plan PR 13). Every part 5% worn or more gets jobs:

| Job | Hours | Uses | Wear left |
| --- | --- | --- | --- |
| Fit a new tire | 0.5 | a tire | none |
| Patch the tire | 0.75 | | half |
| Fit a new shock | 1.5 | a shock | none |
| Rebuild the shock | 1.25 | | half |
| Fit a new CV joint | 1.5 | a CV | none |
| Weld and plate the mount | 2 | | 30% |
| Weld and gusset the frame | 3 | | 40% |

Hours are times 1.5 on a heavy truck and 0.8 on a side-by-side. One job
per part per night. Spares come from the spares kit (`carries` on each
spares part in `src/data/parts.ts`): none, one of each, or two of each.
They are used up through the raid, at the roadside and at the bivouac.

## Rivals

Each class has three or four rival entries (team names are still proposed;
privateers go by their number). They aren't driven by the ride sim, which
would take too long on a phone for a whole field: each is a seeded
estimate. A clean run takes their pace times the stage's par time,
wandering a little either way; then a roll for trouble, likelier on long
and harsh stages and for teams that push, costs them a random slice of
time on one leg. They're towed in after closing time like anyone. The same
raid always gives the same rival results. The career (plan PR 9) gives them
real trucks and habits that change.

## The raids (working names)

| Raid | Stages | Length |
| --- | --- | --- |
| Summer Sprint | 3: logging roads, rock country, the old burn | about 100 km a day |
| Summer Raid | 5: logging roads, eskers, rock country, hot haul roads, the old burn | 160 to 190 km a day |
| Winter Sprint | 3: ice roads, frost heaves, the big lake | about 90 km a day |
| Winter Raid | 4: ice roads, frost heaves, the big lake, the tundra | 140 to 170 km a day |

The winter raids (plan PR 10b) bring cold oil, studs, corners you can slide
off and lake ice that can crack under a heavy truck: `docs/WINTER.md`.
Every entry drives the same roads (each raid has a fixed seed), so a second
go shows what a change did.

## Highlights for the 3D

A long stage drives a full-detail sample of each 5 km chunk and works out
the rest. Each sample is the real sim, so the highlight is made of them: a
pose log runs while each sample is driven, then the busiest five seconds
(where the wheels worked hardest) are cut out, with just the road under
them, plus room for the camera. If something broke in the sample, the clip
is the last 3.5 seconds before the break. Recording never changes a result;
a test checks it.

## The raid balance bot

`tests/raidBalance.test.ts` drives the Summer Sprint with each class's
stock truck, a light spares kit and the gravel ace, at each pace call, and
checks:

- Steady gets home: never towed in, no fade, at most one stop.
- Conserve is slower, runs cooler and stops no more often than Steady, and
  wears the truck less than Push. (Slower isn't always kinder on every
  part: a slower jump landing can hit an axle harder.)
- Push is quicker on a clean stage, runs hotter, and has more stops or
  more wear than Steady.

What the stock trucks did when the speeds were set (gravel ace, light
kit, the most the bivouac could fix each night):

| Summer Sprint | Conserve | Steady | Push |
| --- | --- | --- | --- |
| Light 4x4 | 5.1 h, 2nd | 4.4 h, 2nd | 5.6 h, 4th (two cut tires on day 2) |
| Heavy truck | 5.4 h, 3rd | 4.8 h, 2nd | 4.2 h, 1st |
| Side-by-side | 5.8 h, 5th | 5.1 h, 3rd | 5.9 h, 5th (two cut tires on day 2) |

## Career raids (plan PR 9)

The career (`docs/CAREER.md`) adds four raids to the data: Midsummer
Sprint (3 stages), the National Raid (7), the Autumn Raid (5) and the Long
One (14). The free-play panel offers the two summer raids and the two winter
raids (`FREE_RAID_IDS`). A career raid's entry also carries three things a
free-play raid leaves out: `seed` (this year's roads, so the same raid is a
new road each year), `field` (the rival teams with the trucks they have
that year, from `src/sim/teams.ts`) and `hours` (the garage's mechanic
hours at each bivouac, more with a bigger crew).
