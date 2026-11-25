# Wear and breaks

How Bump Stop's trucks wear out and break (plan PR 2). The code is in
`src/sim/wear.ts`, `src/sim/trace.ts`, `src/sim/laps.ts` and
`src/sim/stage.ts`; every number is in `src/data/` (`wear.ts`,
`failures.ts`, `rigs.ts`, `balance.ts`).

## How parts wear: fatigue

Steel doesn't mind lots of small knocks, but big ones add up fast. So each
part watches the load it carries, and every time that load swings from low
to high and back, the swing wears the part a little:

- a swing as big as the part's `ultimate` breaks it in one go;
- half that size takes 2^`exponent` swings (with 6, that's 64);
- swings smaller than its `endurance` do no harm at all.

Damage runs from 0 (new) to 1 (broken). A load bigger than `ultimate`
breaks the part outright. Small wiggles riding on a big swing (smaller than
the part's `gate`) don't count as turns, so one big hit isn't split into
lots of little ones.

## The six failures

Each has its own cause in the physics, its own trace and its own fixes
(`src/data/failures.ts`).

| Failure | What causes it | Its trace |
| --- | --- | --- |
| Damper fade | Oil over the damper's red line for 2 seconds. The heat comes from the ride sim, never a dice roll | Oil temperature, wheel travel |
| Bottoming | Metal-to-metal hits at the end of the wheel's travel; every hit knocks the shock and bump stop cup, harder hits much more | Wheel travel, load, the hard-stop force |
| Cracked mount | Fatigue in a shock and spring mount from the strut load | The mount's damage bar, load |
| Snapped axle or CV | Torque against strength. A joint working at an angle is weaker, and a wheel that spins up in the air and lands slams the most torque through it. Past its biggest angle (too much droop) the joint binds and snaps | Joint angle, torque, share of strength in use |
| Cut tire | Squashed all the way to the rim over a sharp edge cuts it at once; smaller folds over sharp edges bruise the casing until it gives | Tire squash, how sharp the ground was, casing damage |
| Frame crack | Fatigue in three zones: front, rear, and the twist between the axles in the middle | The damage map (three zones), twist |

## Traces

While the truck runs, `src/sim/trace.ts` keeps the last 3 seconds of every
channel, 100 samples a second, overwriting the oldest. When something
breaks, it cuts out the channels that failure's trace needs, for the corner
(or frame) that broke. The report in plan PR 4 draws them; for now the
preview page's break test shows the main one.

## The test mules' parts

Each class has one set of "test mule" parts in `src/data/wear.ts`, which the
real parts (plan PR 3, `docs/BUILD.md`) scale from, set from what the balance bot measured: each
part's breaking load sits above the biggest loads the mule sees in its first
few laps.

What each mule ends up doing on the rigs, which matches its character:

- **Light 4x4** lasts to about 60 to 75 km/h on the torture loop, then cuts a
  tire on the rocks; on the washboard ladder it bottoms out on the whoops.
- **Heavy truck** bottoms out at 55 to 75 km/h; its hard stops take a beating.
- **Side-by-side** fades its tiny dampers first, at 45 to 55 km/h.

## Lap runs

`src/sim/laps.ts` drives a test loop faster every lap until something breaks,
with heat and wear carried over. Every step runs in full detail, because a
break needs its exact moment and trace. The two loops in `src/data/rigs.ts`
are first drafts of the shop's rigs:

- **Washboard ladder:** 1.2 km of washboard and 600 m of whoops, from 40 km/h,
  5 km/h faster each lap. The whoops are there because washboard alone heats
  dampers most at 20 to 40 km/h (see `docs/RIDE-SIM.md`).
- **Torture loop:** whoops, a rock garden, a graded bit and jumps, from
  30 km/h.

## Long stages

With a wear setup, `runStage` adds up wear in full detail in each sample,
and scales each part's damage with distance over the rest of the chunk,
like heat. A part that reaches 1 in a worked-out stretch breaks part-way
along it (marked `estimated`, with no trace), and so does a damper whose
worked-out oil goes over its red line. The stage stops at the first break.
Rare big hits (bottoming on whoops) are the least accurate part of this: a
short sample can miss them. The tests check that on jumps the sampled wear lands within about a third of driving every metre.

## The balance bot

`tests/balance.*.test.ts` (one file per class, so CI runs them side by side)
checks every class on every pull request, on two roads each:

1. Each test mule lasts more than one lap on each rig and breaks inside its
   class's speed window (`MULE_WINDOWS`).
2. Each failure can happen: a build with one weak spot breaks there first
   (`BOT_BUILDS`: small dampers, short bump stops, weak mounts, long droop,
   low tire pressure, a soft frame).
3. The fix the report would suggest helps: the same build with it breaks a
   later lap, or some other way.

It writes a table of every run to the Actions run summary, so you can read
it on a phone from the Actions tab.

## Things the bot found

- **Softer springs alone didn't bottom harder.** In the ride sim, travel is
  measured from ride height, so a softer spring didn't lose any. A real
  softer spring sags more and sits lower, so the bot's builds now move the
  ride height with the sag (`tests/helpers/tweak.ts`). Plan PR 3 now builds
  each corner's travel from the stroke minus the sag, with the joint angles
  tied to the same place (`docs/BUILD.md`). Even then, soft springs bottom
  more often rather than harder, which is why bottoming adds up over hits.
- **A heavy truck slamming its hard stops cuts tires.** The force of the
  hit goes through the tire into the rocks. The bot's "short bump stops"
  build uses a milder cut for the heavy truck so it finds the bottoming.
- **On the washboard ladder, the light and heavy mules bottom out on the
  whoops before their dampers fade.** Plan PR 4 should tune the ladder (fewer
  or smaller whoops) so it finds fade, as its name says.
- **Tire pressure is a setting now** (plan PR 3): the tire's stiffness comes
  from its pressure (`docs/BUILD.md`). The bot still lowers the stiffness
  directly; the trace can show the pressure once the rigs use builds (plan
  PR 4).

## Tests

- `tests/wear.test.ts`: fatigue counting; each failure set off on its own;
  landing on a spinning wheel; the trace; lap runs; save and carry on; wear
  on long stages.
- `tests/balance.light4x4.test.ts`, `balance.heavy.test.ts`,
  `balance.sxs.test.ts`: the balance bot.
- `tests/simPurity.test.ts` scans the new sim files too.
