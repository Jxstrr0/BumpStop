# Weight and balance

Added in 1.21.0.0 (Kelbo picked it, 27 November 2026). Code: `src/sim/load.ts`,
the load parts of `buildTruck` in `src/sim/build.ts`, `rideParams` in
`src/sim/ride.ts`, and fuel stops in `src/sim/raid.ts`. Numbers:
`src/data/load.ts`. Screen: the **Load and balance** section at the bottom of
Tune (`src/ui/loadBlock.ts`).

## The idea

The spares kit and the tools have to ride somewhere, and the tank doesn't
have to be full. Where the weight sits decides which wheels carry it:

- **Front or back:** weight at one end makes that end sit lower, so it has
  less bump travel before the bump stop, and the other end rides higher.
  The truck sits nose up or nose down.
- **Left or right:** weight on one side leans the truck. The low side has
  less bump travel and reaches its bump stops first; the springs and the
  anti-roll bar share the lean, so a stiffer bar leans it less. On the
  road the stops on the low side push it back up, so the high side swings
  further too: both sides end up using about the same share of their
  travel, and the lean costs less than it looks.
- **Far from the middle:** a heavy spare on the tail is a long lever, so the
  body is slower to start nodding and slower to stop (more pitch inertia).
  The same goes for rolling with weight out at the sides. On fast whoops
  that calms the nodding: on the light 4x4 at 55 km/h with the full spares
  kit and the tools, the rear bottomed out about 96 times in 8 km with both
  behind the cab, about 75 with both on the rear carrier (despite sitting
  lower), and about 64 with both on the front, where the front then bottomed
  50% more. So there's a real choice, and the rigs show it.
- **Fuel** is the one thing that changes the weight. A quarter tank on a
  light 4x4 is about 67 kg lighter: a touch quicker on fast ground (power to
  weight), a little less sag, and more margin on lake ice. But when a stage
  is longer than the tank's range, the truck stops at a fuel point to fill
  back up to the same level: **two minutes each**, while the dampers cool.
  Every stage fits in a full tank, so a full tank never stops.

The class's weight window still weighs the truck as built, with a full tank
(`mass`). The sim, the engine and the ice use what it really weighs
(`runMass`).

## The stock load drives exactly as before

Every part's weight was already counted at the centre of mass. The stock
load is the spares kit and the tools **behind the cab** (right over the
centre of mass) and a **full tank**, so a build with no load, or the stock
load, gives the same ride setup to the last digit. Every balance test passes
unchanged. Saves and build codes from before have no load, which reads as
the stock load; there's no save format change.

## Spots

Three rows (front, behind the cab, rear) by three columns (left, middle,
right), measured from the test mule's centre of mass:

| Class | Front row | Rear row | Sides | Tools | Full tank | Tank sits | Range |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light 4x4 | 1.6 m ahead | 2.2 m behind | 0.6 m | 40 kg | 90 kg | rear right, ahead of the axle | 360 km |
| Heavy truck | 2.5 m ahead | 3.1 m behind | 0.85 m | 150 kg | 340 kg | left saddle tank, under the cab | 640 km |
| Side-by-side | 1.3 m ahead | 1.5 m behind | 0.5 m | 20 kg | 28 kg | under the passenger seat (right) | 240 km |

Each weight is treated as a point at its spot.

## How it works

`loadShift` (`src/sim/load.ts`) sums each weight against the stock load: the
change in mass, the new centre of mass (forward `dx`, left `dy`) and the
change in pitch and roll inertia about the new centre (parallel axis).

`buildTruck` moves the centre of mass (`cgToFront`, `cgToRear`), so each
axle's sag comes from its own share, adds the inertia, and puts a sideways
offset in the ride setup as `cgLeft`.

`rideParams` splits each axle's weight left and right by `cgLeft`. The
difference is held by the springs and the anti-roll bar together:
`twist = ΔF / (spring + 2 × bar)`. The bar starts the run already wound up
by that twist (`barRest`), each corner's static spring squash comes from what
the spring alone holds, and each corner gets its own bump and droop travel
(`bumpTravel`, `droopTravel`, the low side less bump, more droop). A truck
with no sideways offset skips all of this, so its numbers don't change.

`balance` on the built truck has what the screen shows: the front and left
shares, the tilt against the same truck with the stock load (springs and
tires), and each corner's tire load and bump travel. The 3D truck on the
build screen and the rigs lean by that roll (`Stance.roll`), on top of the
front and rear ride heights it already showed.

## On the screen

The section shows the truck from above, front at the top. Pick **Spares
kit** or **Tools**, then tap a spot. Beside each wheel is the weight on that
tire. The tank is drawn where it sits, filled to the fuel level. Under it:
the fuel slider (with the range), the front and left shares against the
stock load, two bars that tip ten times further than the truck does (one
seen from the side, one from behind), the tilt in degrees, each corner's
bump travel, and the running weight. The heading's chip says **Even**,
**Nose heavy**, **Tail heavy** or **Leans left/right**, amber once it's a lot.
Each part has an "i" note.

In a raid, the morning card says the fuel level, its range and the fuel
stops today (it follows a retune made in Tune). The results list the fuel
stops and the time they took.
