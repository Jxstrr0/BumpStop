# The ride sim

How Bump Stop's truck physics works (plan PR 1). The code is in `src/sim/`,
every number it uses is in `src/data/`.

## The truck: seven moving parts

`src/sim/ride.ts` treats the truck as a body on four wheels. The body can
**bounce**, **pitch** (nose up and down) and **roll** (side to side), and each
**wheel** moves up and down on its own: seven moving parts in all. Between
body and wheel sit the spring, the bump stop, the limit strap, the anti-roll
bar and the damper. Between wheel and road sits the tire, which can only
push, so wheels can leave the ground.

It runs 500 steps a second. Each step works out every force, moves
everything a tiny bit, and turns the damper's work into heat.

Each class has a plain "test mule" in `src/data/ride.ts`: masses, spring
rates, damper settings, travel, tires. The parts a player picks (plan PR 3)
scale from it; see `docs/BUILD.md`.

## The ground

`src/sim/ground.ts` builds the road from recipes in `src/data/ground.ts`:
graded road, washboard, rough gravel, whoops, rocks, jumps, and the winter
grounds: frost heaves, ice road and packed snow (`docs/WINTER.md`). Each recipe
has gentle random roughness plus its own features, picked from ranges by a
seeded random stream. The same recipe and seed always build the same road.

## Heat and fade

A damper resists speed: the faster the wheel moves, the harder it pushes
back, and all of that work becomes heat in its oil. Air flowing past cools
it, more at speed. Oil temperature sets how hard the damper damps
(`dampingMultiplier`): exactly as set at 40 °C, stiffer when cold (below
freezing it thickens much faster: about 2.6 times as stiff on a -30 °C
morning, see `docs/WINTER.md`), and softer as it heats up. Above the damper's aeration
temperature the oil foams and damping drops off further. That softening is
**fade**, and it comes from the heat, never a dice roll. The numbers are in
`DAMPER_OIL` and each damper's settings.

## Spool-valve dampers (2017 on)

The Zed-Two spool-valve dampers meter their oil through ports in a sliding
spool instead of a stack of shims, which changes two things in the sim:

- **They damp by position** (`positionScale`, numbers in
  `DamperSetup.position`). Through the middle of the travel they run at 0.9
  of their setting. In the last 35% of the bump travel the compression
  damping climbs, on a smooth curve, to 3.5 times its setting at the bump
  stop, which catches a big landing before it bottoms out. In the last 35%
  of the droop the rebound damping does the same, so the wheel doesn't slam
  onto its limit strap. Rebound near full bump and compression near full
  droop stay soft, so the wheel can always get back to the middle.
- **Oil heat matters half as much** (`oilSense` 0.5): sharp-edged ports
  pass thin and thick oil nearly the same. Hot, they keep more of their
  damping (at 120 °C about 77% against a normal damper's 60%); on a -30 °C
  morning they damp about 1.6 times as hard as set, against 2.6 times for a
  normal damper. Because they keep
  damping when hot they also keep making heat, so they run a few degrees
  hotter than the electronic dampers late in a long run.

On the torture loop with the stock settings they bottom out less than the
electronic dampers (about 40% less on the light 4x4, 15% on the heavy truck)
and go a lap further on both. Firmer at the ends means the tires take more of a big
landing, so the run usually ends on a tire instead (`tests/lateParts.test.ts`).

## Bypass dampers (1996 on)

The bypass (1996) and internal bypass (2008) dampers have tubes, or holes in
an inner sleeve, that let oil slip past the piston through the middle of the
stroke. Going outwards the piston slides past each tube's last hole in turn,
that tube shuts, and the damping steps up (`bypassScale`, numbers in
`BYPASS_TUBES` in `src/data/parts.ts`):

| | Middle | Steps (share of the travel from ride height: times the setting) |
| --- | --- | --- |
| Bypass, three outside tubes | 0.85 | 45%: 1.2, 66%: 1.55, 85%: 2.1 |
| Internal bypass, two rows of holes | 0.9 | 62%: 1.2, 85%: 1.6 |

Each step eases in over 6% of the travel (the width of a hole), so the force
has no corner for the wheel to bounce off. Like the spool valves, compression
steps up towards full bump and rebound towards full droop, and the other way
stays soft so the wheel can always get back to the middle.

They are kept clearly apart from the spool valves: they start firming much
earlier (from 45% instead of 65%), hold flat between steps instead of
climbing smoothly, top out well short of 3.5 times, and their oil fades with
heat like any shim-stack damper. On the torture loop with stock settings the
tubes cut bottom-outs by about a quarter on the light 4x4 and a fifth on the
heavy truck against the same shocks without them, and the light 4x4 goes a
lap further; the spool valves still bottom out least
(`tests/bypass.test.ts`). Rival teams don't run the ride sim, so their pace from bypass
dampers is unchanged (`src/sim/teams.ts`).

## Long stages

A 300 km stage at 500 steps a second would be millions of steps. So
`src/sim/stage.ts` cuts a stage into chunks of up to 5 km. Each chunk drives
a short sample in full detail (300 m to 1 km, longer for ground with rare big
features), measures how much heat each damper makes, and works out the rest
with the exact formula for a heater in a draught. The tests check that this
matches driving every metre to within a few percent.

## The rules it keeps

- Pure: no screen, no three.js, no clock. Seeded randomness only.
- Its own maths (`det.ts`) so every phone gets exactly the same answer.
- The whole state is plain numbers, so a run can be saved and carried on
  exactly (there's a test for that).
- SI units inside (kg, m, s, N, W, J, kelvin); °C and km/h only on screen.

## Something the physics showed

Washboard is roughest at **low** speed: around 20 to 40 km/h the ripples
match the wheels' own bounce and they hop and heat up most. Faster, the
wheels skim and the dampers do less work, until the general roughness of the
road takes over again. Big features (whoops, jumps, frost heaves) are the
other way round: faster always means hotter. The washboard ladder rig in
plan PR 4 was designed with that in mind: it's mostly rough gravel now
(`docs/RIGS.md`), and the shaker rig finds the same wheel hop, at about
21 to 28 km/h on washboard.

## Tests

- `tests/ride.test.ts`: rest, energy kept with the dampers off, every bit of
  a bounce turning into damper heat, bottoming, fade, cold oil.
- `tests/ground.test.ts`: same seed, same road; each ground looks like itself.
- `tests/stage.test.ts`: sampling against full detail, the 300 km stage.
- `tests/determinism.test.ts`: same seed, same result; save and carry on.
- `tests/simPurity.test.ts`: no `Math.random`, clock, DOM or browser maths
  in the sim.
