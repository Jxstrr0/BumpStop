# Bivouac breakdowns

Added in 1.3.0.0 (Kelbo picked it from the post-1.0 ideas, 26 November
2026). Code: `src/sim/condition.ts` and the bivouac in `src/sim/raid.ts`.
Numbers: `src/data/condition.ts` and `JOBS` in `src/data/raids.ts`.

## The idea

Parts that break (tires, shocks, axles, mounts, the frame) already carried
their damage from day to day. Now the truck also **wears in** slowly, in
three ways that never stop it by themselves but make the next day's truck
worse. They're kept per axle, front and rear, because that's how a crew
services them.

| Wear | Comes from | What it does to the truck |
| --- | --- | --- |
| **Shock oil** gets tired | Every bit of heat the dampers make; oil run hot (warm line up to the red line) tires up to twice as fast | Damps up to 30% less, and foams and fades up to 18 °C sooner |
| **Springs** sag | Rough kilometres (rough gravel, whoops, rocks, jumps, frost heaves) and bottom-outs | Sits lower: up to 30% less travel before the bump stop (it moves to droop), and 8% softer |
| **Bushings** crack | Rough kilometres and bottom-outs | The mounts get up to 15% weaker, so they crack sooner |

The ride sim drives the worn truck (`wornTruck`), so a fade still comes out
of the heat physics: tired oil just gives up at a lower temperature.

## The bivouac

Each night the crew has its hours, the spares on the truck, and now
**money for parts**:

- A free-play raid has 1,500 cr. for parts for the whole raid, times the
  class's money (heavy truck 5,250 cr., side-by-side 900 cr.).
- A career raid spends the garage's own money (whatever it has after the
  fees; nothing when broke). It's settled after the raid and shown on the
  results card as "Parts at the bivouacs". Wear left at the end goes on the
  repair bill like the other parts.

New jobs, each for a whole axle:

| Job | Hours | Money (light 4x4) | Leaves |
| --- | --- | --- | --- |
| Fresh oil and seals | 1 | 120 cr. | fresh oil |
| Press in new bushings | 1.5 | 180 cr. | new bushings |
| Reset the spring preload | 0.5 | free | half the sag |
| Fit new springs | 2 | 450 cr. | new springs |

The old jobs cost a little too: a patch 25 cr., a shock rebuild 150 cr.,
welds 40 to 80 cr. Jobs that fit a spare cost nothing more (the spare is
paid for already). Hours scale by class as before; money by `CLASS_MONEY`.

A new or rebuilt shock, at the roadside or the bivouac, goes in with fresh
oil, so that axle's oil is half as tired (the other shock is still old).

## How it was tuned

The stock trucks of each class drove the Washboard 800 (five days) and
Frozen Knuckle on Steady, with the crew fixing only the old parts:

- After one day the hotter axle's oil is about a fifth tired, the springs
  and bushings about a tenth.
- With nothing serviced, the oil is worn out by day four or five, and the
  last day brings a fade (heavy truck), a cracked mount (side-by-side) or
  more cut tires (light 4x4) that a fresh truck didn't have.
- With everything serviced each night the stages run clean, but a full
  service of a well-worn truck takes about 9 hours (a night has 8) and a
  whole free-play allowance, so the crew can't do it all.

The raid balance bot (`tests/raidBalance.test.ts`) still passes: Steady
gets every stock truck through the Blackfly Classic. Tests for this part:
`tests/bivouac.test.ts`.

## Saves

A raid now keeps `cond` (oil, bushings, springs, front and rear, 0 to 1),
`spent`, and for a career raid `entry.budget`. A raid saved before this
reads back with a fresh truck and nothing spent (`readRaid` in
`src/persist/save.ts`), with no new save format number.
