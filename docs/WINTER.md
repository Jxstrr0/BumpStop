# Winter

Plan PR 10. Part 10a (this part) is the sim: cold oil, the winter ground,
studded tires and lake ice. Part 10b puts it on the road: winter raids,
the speeds on ice and snow, and what happens when the ice cracks.

## Cold oil

Damper oil thickens as it cools. Above freezing it follows the same curve
as before, so summer is untouched. Below 0 °C it thickens much faster
(`DAMPER_OIL.coldFrom` and `coldSlope` in `src/data/ride.ts`):

| Oil | Damping, as set at 40 °C = 1 |
| --- | --- |
| 40 °C | 1 |
| 0 °C | 1.3 |
| -10 °C | 1.6 |
| -30 °C | 2.6 |

A winter morning starts with the oil at the air temperature, and only the
damper's own work warms it. That's all physics: nothing in the code says
"it's winter, damp harder".

### What the sweep showed

Each stock truck on 10 km of each winter ground, 20 to 90 km/h, at -25 °C
and at +20 °C, with wear (`runStage`, sampled):

- **Ice road and packed snow barely warm the oil.** On ice the light 4x4's
  oil goes from -25 °C to about -16 °C at 80 km/h; on snow to about -11 °C.
  So on those roads the dampers stay stiff all day.
- **Frost heaves warm it up.** At 40 km/h the oil gets to about 20 to 35 °C;
  at 70 km/h, 50 to 75 °C. Nothing fades in the cold: the hottest any stock
  truck got at -25 °C was about 93 °C (the side-by-side at 90 km/h). The same
  runs at +20 °C fade the side-by-side.
- **Stiff is kinder on broad lumps.** The stock dampers are set soft for
  summer heat, so cold, stiff oil actually rides the big heaves better:
  fewer bottom-outs and smaller loads (the heavy truck bottomed out at
  50 km/h on heaves at +20 °C, and took 16% wear at -25 °C).
- **Stiff is harsher on sharp edges.** On a rock garden at -25 °C the
  light 4x4 cut a tire within 100 m at 50 km/h; at +5 °C it lasted 2.2 km.
  The dampers can't get the wheel out of the way of a sharp hit, so the tire
  takes it. The same goes for a frost-heave crack that steps up into the
  tire (`stepUp` on the heaves recipe).

So a winter tune is a different tune: fade is not the worry; sharp frozen
edges, ice and grip are.

## The winter ground

In `src/data/ground.ts`; the code builds them like any other ground.

| Ground | What it is | Grip | With studs |
| --- | --- | --- | --- |
| Frost heaves | A frozen forest road pushed up into lumps, with a crack edge that steps down or (half the time) up | 0.30 | 0.36 |
| Ice road | Ploughed lake ice: glass, with a low pressure ridge about every 100 m | 0.12 | 0.18 |
| Packed snow | A ploughed and rolled snow road with soft chatter and ruts | 0.30 | 0.36 |

Gravel, rock and dirt have a grip of 0.8, studded or not.

**Grip** is new for every ground. It sets how much torque a landing on a
spinning wheel can slam through the axle (`src/sim/wear.ts`): on ice the
wheel just spins, so the axle feels about a seventh of what it would on
gravel. Before PR 10 this was a single number for gravel (`WEAR.grip`,
now gone; every summer ground keeps 0.8, so nothing changed there). In PR
10b grip also sets how fast the driver dares to go on winter ground.

## Studded tires

Two new tires, in every class: **Studded rally tires** and **Studded
heavy-ply tires**. They're the same casings as the plain ones, a few
kilograms heavier and dearer, and they grip harder on ice and snow (the
`studGrip` column above). On gravel they're just heavier tires. In 3D
they share their plain twin's model (the studs are too small to see): the
Blender script names those tire nodes for both parts.

## Lake ice

`src/sim/ice.ts`, numbers in `src/data/winter.ts`. Does the ice hold the
truck up? No dice: the same truck at the same speed on the same ice always
gets the same answer.

- **Thickness.** Ice carries a load that grows with its thickness squared
  (Gold's rule, which real ice-road crews use). Here 40 cm of good ice holds
  about 11 t before it cracks; 60 cm holds about 25 t.
- **The wave.** A truck pushes a slow wave through the water under the ice.
  Near the wave's own speed (20 to 50 km/h, slower on a shallow lake) the
  truck rides the wave it makes and the ice bends as if the truck were up to
  about half as heavy again. That's why real ice roads have speed limits.
  Past the peak it stays at the peak.
- **The reading:** the load against what the ice holds. Under 85% the ice
  is quiet; from 85% it booms and creaks; at 100% it cracks under the truck.

What that means for the stock trucks on 40 cm of ice with a 35 km/h wave:

| Truck | Weight | At a crawl | Near the wave |
| --- | --- | --- | --- |
| Side-by-side | about 1 t | 9% | 14% |
| Light 4x4 | about 2 t | 17% | 27% |
| Heavy truck | about 9.2 t | 82%, quiet | 125%: cracks |

So it's the heavy truck that has to think about the ice: on that sheet it
must stay under about 18 km/h (`safeSpeed` works that out), or come lighter
(fewer spares, lighter parts), or wait for thicker ice later in the winter.
Nobody ever goes through: when the ice cracks the crew backs off onto thick
ice and takes the shore track (PR 10b).

## Winter raids (plan PR 10b)

Two winter raids join the Raids panel (names picked by Kelbo on 26 November 2026):

| Raid | Stages | Air | Lake ice |
| --- | --- | --- | --- |
| Cold Start 300 (`winterSprint`, early winter) | 3: ice roads over the lakes, frost-heaved forest roads, across the big lake; about 90 km a day | -18 to -28 °C | 44 and 46 cm |
| Frozen Knuckle (`winterRaid`, late winter) | 4: the same three, longer, then the wind-scoured tundra; 140 to 170 km a day | -15 to -30 °C | 45 to 65 cm |

The rules are in `src/sim/raid.ts`, the numbers in `src/data/winter.ts`
(`CORNERS`, `ICE_ROAD`) and `src/data/raids.ts`.

### Steady speeds on winter ground (km/h)

| Ground | Light 4x4 | Heavy truck | Side-by-side |
| --- | --- | --- | --- |
| Frost heaves | 58 | 50 | 48 |
| Ice road | 50 | 40 | 48 |
| Packed snow | 62 | 55 | 58 |

Frost heaves are set the way the summer speeds were, just under where the
stock truck starts to suffer. Ice and snow are set by grip instead (below).

### Corners and the snowbank

The fastest a truck can take a corner follows the square root of the grip.
Each piece of winter ground has one tightest corner, somewhere between 15%
and 85% of the way along. Steady on plain tires takes it with 10% in hand.
Push is 12% faster, so on plain tires the truck slides wide into the
snowbank there. Nobody is hurt and nothing breaks, but the crew spends 20
minutes digging it out and the driver eases off one pace call for the rest
of the leg, so it happens once a leg at most.

Studs raise the corner speed by the square root of their extra grip (22% on
ice, 10% on snow and frost heaves). Drivers use only part of it to go faster
(about 10% on ice and 5% on snow) and keep the rest in hand, so with studs
Push stays on the road. On summer ground studs change nothing.

### Ice on a raid

The roadbook gives each stage's ice thickness and the speed of the wave
under it, and the morning screen reads the ice for your truck at each pace
call (Normal: quiet, Warm: booms and creaks, Over the limit: it cracks).
The truck drives to the thinnest place on each stretch of ice, somewhere
between 20% and 80% of the way along (the roadbook doesn't say where):

- **Creaking:** noted in the log, nothing more. It's the warning.
- **Cracks:** the truck stops. The crew backs off onto thick ice (30
  minutes) and takes the shore track, packed snow 1.6 times as far, for the
  rest of that stretch, and the driver eases off one pace call.

### What the stock trucks did (Cold Start 300, gravel ace, light spares kit)

| | Plain tires, Steady | Plain, Push | Studs, Steady | Studs, Push |
| --- | --- | --- | --- | --- |
| Light 4x4 | 4.95 h, 2nd | 7.9 h, last (9 slides) | 4.6 h, 1st | 4.1 h, 1st |
| Heavy truck | 5.8 h, 3rd | 8.9 h (slides, cracked ice) | 7.1 h (cracked ice 3 times on day 1) | 7.0 h (cracked ice) |
| Side-by-side | 5.3 h, 3rd | 8.2 h, last (9 slides) | 4.95 h, 2nd | 4.4 h, 1st |

So studs are worth fitting, Push without them is a trap, and the heavy
truck on early-winter ice has to call Conserve on the ice legs (6.1 h on
studs, no cracks). Studs at Push are harder on the truck on the frost
heaves and frozen rocks (about 40% worst wear on the light 4x4 on day 2),
because stiff cold oil is harsh on sharp edges. Nothing faded.

Rivals don't fade in winter either: that kind of trouble becomes a
snowbank. Winter ground counts as 0.3 of harsh ground for their chance of
trouble.

## Tests

- `tests/ride.test.ts`: summer damping unchanged; about 2.6 times as stiff
  at -30 °C; colder is always stiffer; a -30 °C morning warms up as it drives.
- `tests/ground.test.ts`: the winter grounds look like themselves; frost
  heave cracks step both ways; grip is low on winter ground and studs only
  bite there.
- `tests/wear.test.ts`: on ice a spinning wheel lands with far less torque
  through the axle; studs grip harder on ice and change nothing on gravel.
- `tests/ice.test.ts`: Gold's rule, the wave curve, a heavy truck cracking
  40 cm of ice near the wave speed while the light classes don't, creaking
  before cracking, and the safe speed.
- `tests/build.test.ts`: two studded tires per class, heavier than plain, and
  the studs reach the wear model.
- `tests/winterRaid.test.ts`: studs are faster only on winter ground; plain
  Steady makes the tightest corner and plain Push doesn't, while studded
  Push does; a slide happens once a leg at most; the light classes never
  crack the ice; a heavy truck at Push cracks it and takes the shore track
  while Conserve holds (and creaks) and finishes sooner; no rival fades in
  winter; and on the Cold Start 300, studs at Push are clean and quickest
  while plain Push is slower than plain Steady.
