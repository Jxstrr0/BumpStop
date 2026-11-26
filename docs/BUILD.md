# Parts and the truck builder

How a player's build turns into a truck the sim can drive (plan PR 3). The
parts are in `src/data/parts.ts`, each class's settings, ranges and stock
build in `src/data/kit.ts`, and the builder in `src/sim/build.ts`.

## Twelve slots

Frame, front suspension, rear suspension, dampers, bump stops, anti-roll
bars, axles and CVs, wheels, tires, protection, engine and spares. Every
part lists its mass (kg, whole truck) and cost (antlers) for each class it
comes in, and the year it can first be bought. A part with no number for a
class doesn't come in that size: heavy trucks have no spaceframe, and
side-by-sides have their own tube frames, arms and engines.

The truck's weight is the class's base (body, cab, cage, seats, crew and
fuel) plus every part. Its cost is the parts.

## Parts are multipliers on the test mule

Each part's other numbers multiply the class's test mule
(`src/data/ride.ts`, `src/data/wear.ts`), so 1 means "the same as the mule".
Each class's stock build uses only "1" parts, so it drives like the mule the
balance bot was tuned on. For example, remote reservoir dampers hold 1.6
times the oil, shed 1.25 times the heat and take 10 °C more before they
fade; heavy-duty axles are 1.5 times as strong but make the wheels 8%
heavier.

Protection and spares are only weight for now: rock hits and the bivouac
arrive with the raids (plan PR 7). Engine power is shown but the rigs set
their own speed; the engine's torque already changes how hard a spinning
wheel lands.

## Settings

Front and rear apart: spring rate, preload, damper clicks (only the
adjusters that damper has), bump stop length, limit strap, tire pressure,
and the anti-roll bar position if the bars are adjustable. Each class has
its own ranges. Beadlock wheels allow lower tire pressure.

## Ride height comes from the spring

The suspension has a fixed total travel, from full droop to the hard limit.
The truck's weight squashes the spring part of the way in: the **sag**,
which is `load ÷ rate − preload`, measured up from full droop.

- Bump travel = total travel − sag. A softer spring sits lower and has less
  travel left before the bump stop.
- Droop = the sag, or the limit strap if that's shorter.
- Preload lifts the truck: more bump travel, less droop.
- The axle or CV joint runs straight at a fixed place in the stroke, so its
  angle at ride height follows the sag too.

This is what the balance bot asked for in `docs/WEAR.md`.

## Tire pressure sets tire stiffness

A quarter of a tire's stiffness comes from its casing and the rest from the
air, which follows the pressure. At the class's reference pressure it
matches the mule. Tougher casings fold and pinch later.

## The rules

`checkBuild` lists what keeps a build out of a raid: too heavy or too light
for the class, over budget, or a part that isn't out yet in that year.
Until the career (plan PR 9) brings real money, each class has a test
budget in the shop.

| Class | Stock weight | Window | Stock cost | Test budget |
| --- | --- | --- | --- | --- |
| Light 4x4 | 1,950 kg | 1,800–2,100 kg | 25,100 antlers | 40,000 antlers |
| Heavy truck | 9,200 kg | 8,500–10,000 kg | 87,200 antlers | 140,000 antlers |
| Side-by-side | 1,000 kg | 900–1,100 kg | 14,350 antlers | 22,000 antlers |

## What changed for the side-by-side

The test mule's side-by-side drooped 20 cm on a spring that only held 16 cm
of sag, so its coil fell loose for the last few centimetres. Built from the
spring, it now sits on its spring with about a third of its 45 cm of travel
as sag, as a real side-by-side does, which leaves 29 cm of bump travel. It
still fades its tiny dampers first, at 50 to 55 km/h. Its long travel soaks
up hits, so the balance bot's weak-spot builds for it (short bump stops,
weak mounts, soft frame) had to be weaker to break first
(`src/data/balance.ts`).

## The build screen

`src/ui/buildScreen.ts`, with the truck on the bench kept in
`src/ui/buildStore.ts` (one build per class, in memory until saves arrive in
plan PR 8). Class buttons and a year slider at the top; weight and money
pinned in a strip that stays in sight while scrolling, with the problems
listed under it; a row per slot that opens to its choices; then the front
and rear axle's sliders. Only the adjusters a part has get a slider. The
ride sim and break test on the preview page drive whatever is on the bench.

## Tests

`tests/build.test.ts`: every stock build is legal in 1985 and drives on its
mule's numbers; softer springs lose bump travel; preload lifts; straps cut
droop; pressure sets stiffness; clicks only work where a damper has an
adjuster; the rules catch weight, money and year. The balance bot
(`tests/balance.*.test.ts`) now drives the stock builds.
