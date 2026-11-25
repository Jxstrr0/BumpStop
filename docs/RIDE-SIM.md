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
graded road, washboard, whoops, rocks, jumps and frost heaves. Each recipe
has gentle random roughness plus its own features, picked from ranges by a
seeded random stream. The same recipe and seed always build the same road.

## Heat and fade

A damper resists speed: the faster the wheel moves, the harder it pushes
back, and all of that work becomes heat in its oil. Air flowing past cools
it, more at speed. Oil temperature sets how hard the damper damps
(`dampingMultiplier`): exactly as set at 40 °C, up to about twice as stiff on
a -30 °C morning, and softer as it heats up. Above the damper's aeration
temperature the oil foams and damping drops off further. That softening is
**fade**, and it comes from the heat, never a dice roll. The numbers are in
`DAMPER_OIL` and each damper's settings.

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
plan PR 4 should be designed with that in mind.

## Tests

- `tests/ride.test.ts`: rest, energy kept with the dampers off, every bit of
  a bounce turning into damper heat, bottoming, fade, cold oil.
- `tests/ground.test.ts`: same seed, same road; each ground looks like itself.
- `tests/stage.test.ts`: sampling against full detail, the 300 km stage.
- `tests/determinism.test.ts`: same seed, same result; save and carry on.
- `tests/simPurity.test.ts`: no `Math.random`, clock, DOM or browser maths
  in the sim.
