# Night stages

Kelbo picked it on 27 November 2026: "Night stages with lights: you choose
the light bar and spots, and hidden ruts only show up inside the beam."

The numbers live in `src/data/night.ts`, the maths in `src/sim/night.ts`, the
lamps themselves in `src/data/parts.ts` (`LightPart`), and the 3D lamps in
`src/render/lamps.ts`.

## Which stages run into the dark

`RaidStage.dark` is the share of a stage where it gets dark (0 is a stage
that starts in the dark). Summer raids run under the midnight sun and have
none.

| Raid | Stage | Dark from |
| --- | --- | --- |
| Polar Night Raid | days 1 to 5 | 75%, 60%, 45%, 30%, then the whole stage |
| Cold Start 300 | day 3 (the big lake) | halfway |
| Frozen Knuckle | day 4 (the tundra) | 40% |

The stage sim splits the road where it gets dark, the same way it splits
where the weather turns, so a stage drives in daylight up to that point and
under the lamps after it.

## The lamps

Every truck has its headlamps (60 m, a third of the road). Two new slots,
**Light bar** and **Spot lamps**, sit after the engine in the build. Both
start empty, so stock builds and old saves are unchanged (a save without
them loads with nothing fitted).

| Part | From | Reach | Spread | Draw | Mass (4x4 / heavy / SxS) | Cost (cr.) |
| --- | --- | --- | --- | --- | --- | --- |
| Halogen light bar | 1985 | 110 m | 0.75 | 520 W | 16 / 26 / 9 kg | 900 / 1,600 / 600 |
| LED light bar | 2008 | 170 m | 0.92 | 240 W | 9 / 15 / 5 kg | 2,600 / 4,200 / 1,700 |
| Halogen spots | 1985 | 190 m | 0.30 | 260 W | 7 / 12 / 4 kg | 500 / 900 / 350 |
| HID spots | 1996 | 280 m | 0.32 | 110 W | 6 / 10 / 3 kg | 1,800 / 3,000 / 1,200 |
| LED spots | 2012 | 360 m | 0.38 | 90 W | 4 / 7 / 2 kg | 2,400 / 3,800 / 1,500 |

The beam is the longest reach and the widest spread of everything fitted:
a bar lights wide, spots reach far, and the best night setup has both. The
lamps weigh something all the time (the ride and the load see it like any
other part) and take their draw off the engine's power in the dark.

## What the dark does

1. **The driver only goes as fast as they can stop in the beam.** Stopping
   distance is `v × 1 s + v² ÷ (2 × grip × g × 0.6)`. The driver keeps it
   inside the reach, and the pace call scales that speed like any other
   (Push drives past the lamps a little). On ice the truck takes much
   longer to stop, so the lamps matter most there; studs help.
2. **Hidden ruts.** Every ground has some washouts and cross-ruts per km
   (`RUTS_PER_KM`). By day the driver goes round them. In the dark they only
   see the share the beam's spread covers, and fewer still if they're going
   faster than they can stop in the beam. Every unseen rut goes into the
   road the ride sim drives as a real dip (`RUT_SHAPE`: a steep-sided,
   flat-bottomed washout 1.5 to 3.2 m long and 0.1 to 0.22 m deep across
   one track or both), so the hit, the heat and the wear come out of the
   physics like any bump. The ruts use their own random stream, so a road
   with none is the same road as before.
3. The air cools 4 °C once it's dark.
4. The rivals have decent lamps: the dark doesn't slow them, but their
   chance of trouble goes up to 1.3 times, scaled by how much of the stage
   is dark.

### What the sweep showed

- Light 4x4 with headlamps only, Polar Night Raid's all-dark day: graded
  gravel capped at 70 km/h instead of 86, about 14 minutes lost, and the
  worst part ended at 93% worn against 74% with a bar and spots.
- Heavy truck, same stage: headlamps only took 3.35 h with more stops for
  the sump, tank and diff; with lamps 2.24 h.
- Cold Start 300's big lake (dark from halfway): headlamps cap the ice at
  37 km/h instead of 56, about 22 minutes lost. A halogen bar brings that
  to about 3 minutes, and spots to nothing.
- Ruts on winter ground hardly wear the truck (snow and ice are soft); the
  cost there is time.

## The screens

- **The morning roadbook** marks "Dark from here: lamps on" where it gets
  dark, and an **After dark** box under the weather says what the lamps
  reach, where they'll slow the driver and by how much, and how many of the
  ruts the driver won't see (Normal, Warm or Over the limit, always with
  the word). **Look at the lamps** jumps to the Light bar slot.
- **The stage log** says when it gets dark.
- **The results** say how many ruts the lamps showed and how many were hit
  blind, with the same jump to the lamps.
- The **i** buttons on the two slots explain the trade.

## The 3D

At the dark point the stage's 3D view switches to night whatever the
phone's theme: dim moonlight, dark blue fog close in, the night sky (and the
northern lights where the scenery has them), and real spotlights hung on
the truck body. The road, the ruts and the trees only show where the beam
falls. There are two lights at most: one wide (the bar from the roof, or
the headlamps) and one long (the spots from the front). The Lite tier gets
one light that does both, so phones keep their frame rate. The numbers are
`NIGHT_LOOK` in `src/data/graphics.ts`.

The light bar and spots show on the truck models when fitted: a bar on the
roof of all three, spots on the pickup's bull bar, on the heavy truck's
bumper and on the side-by-side's front roof tube (`make-trucks.py`,
`light_bars` and `spot_lamps`).

## Tests

`tests/night.test.ts`: the lamp data, the sight speed against the stopping
distance, the unseen share, day roads unchanged and night ruts digging in,
the raid calendar's dark stages, the morning outlook, driving the big lake
with and without lamps, and saves.
