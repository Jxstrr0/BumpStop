# Underside hits

Added in 1.14.0.0 (Kelbo, 27 November 2026). Code: `src/sim/underside.ts`
and `undersideHits` in `src/sim/raid.ts`. Numbers: `src/data/underside.ts`
and the three underside jobs in `JOBS` (`src/data/raids.ts`).

## The idea

Until now the Protection slot (no guards, skid plates, full armour) only
added weight and cost, because nothing ever hit the underside. Now on rough
ground rocks reach the bottom of the truck. The guards take most of them;
one that gets through dents the **oil pan**, the **diff** or the **fuel
tank**. That costs time twice:

1. **A roadside patch** at the place it hit: 12, 15 or 9 minutes for the oil
   pan, diff and fuel tank on a light 4x4 (times the class's work, 1.5 for
   the heavy truck and 0.8 for the side-by-side, and the driver's fix time).
   A part that was already dented takes longer, up to twice as long.
2. **Leaks** from then on: the crew stops to top up oil or fuel. A fully
   dented oil pan costs 2 seconds a kilometre, the diff and tank 1.5, in
   proportion to the dent. They go on, stage after stage, until the
   bivouac fixes the part.

At the bivouac each dent has a job: weld up the oil pan (1 h, 140 cr.),
straighten and reseal the diff cover (1¼ h, 220 cr.) or patch the fuel tank
(¾ h, 110 cr.), times the class's hours and money. A job fixes it fully. In
the career, dents left at the end go on the repair bill like everything else.

Like a roadside breakdown, each patch stop makes the driver ease off one
pace call for the rest of the leg and counts towards the four stops that
end a leg in a limp.

## How many rocks

    strikes = rate(ground) × (km × pace × ride height + bottom-outs × 2)

| Ground | Rocks per km at Steady (before the guards) |
| --- | --- |
| Rocks | 0.06 |
| Whoops | 0.015 |
| Rough gravel | 0.012 |
| Jumps | 0.008 |
| Frost heaves | 0.004 |
| Graded, washboard, ice, snow | none |

- **Pace:** Conserve 0.6 times as many, Push 1.7 times.
- **Ride height:** (the class's stock bump travel ÷ this truck's) to the
  power 1.5, kept between 0.6 and 2.5. The softest springs sit about 40%
  lower and get about twice as many; full preload sits higher and gets
  about a quarter fewer. It's the truck as it stands, so sagged springs
  (bivouac breakdowns) and the guards' own weight count too.
- **Bottoming out:** each hard bottom-out the ride sim counts on the piece
  adds as many rocks as 2 km of that ground. The stock trucks hardly ever
  bottom; a truck on soft springs or short bump stops does.

Then each strike is the seeded dice: the guards take it (**skid plates 65%,
full armour 93%**, no guards none), or it dents one part (oil pan 40%, diff
35%, fuel tank 25%) by 35% to 60%.

The morning card says how many rocks the day's stage should get past the
guards at Steady, and the entry card (free play and career) says the same
for the whole raid, or that it's smooth enough to leave the guards off.
After the stage the results say what the guards took, what the leaks cost,
and offer a jump to the Protection slot.

## The sweep

Stock trucks, the veteran, four seeds, Steady all the way with the bot's
bivouac jobs (`scripts/harness/underside.harness.ts`). "Through" is rocks
that got past the guards over the whole raid; the time is patches plus
leaks.

| Raid | Light 4x4: none / plates / armour | Heavy: none / plates / armour | Side-by-side: none / plates / armour |
| --- | --- | --- | --- |
| Summer Raid (5 stages, rocky) | 2.3 / 0.8 / 0.3 | 3.0 / 1.0 / 0.3 | 2.0 / 0.5 / 0.3 |
| National (rocky) | 3.8 / 1.0 / 0.8 | 3.5 / 0.8 / 0.8 | 2.3 / 0.3 / 0.5 |
| The Long One | 7.5 / 2.3 / 0.5 | 7.3 / 2.3 / 0.5 | 6.3 / 1.3 / 0.3 |
| Midsummer Sprint (fast) | 0.5 / 0.3 / 0.3 | 0.8 / 0.8 / 0.3 | 0.3 / 0 / 0 |
| Winter Raid | 0.5 / 0 / 0 | 1.3 / 0.3 / 0 | 0.5 / 0 / 0 |

On the Summer Raid no guards cost the light 4x4 about 40 minutes in
patches and leaks, skid plates about 12 and full armour about 3. On the
Long One with skid plates the leaks add up (about 40 minutes) if the crew
leaves dents for later. Push roughly doubles the rocks that get through.

Every balance test still passes (Steady gets the stock truck home on every
raid; Conserve is slower and stops no more often). The career bot (one
seed, eight seasons, stock skid plates) won a few fewer raids on the light
4x4 (3 of 40 against 6) and side-by-side (11 against 13), the heavy truck
the same; the banks ended about where they did.

The guards' weight matters through the physics too: a heavier truck sits a
little lower and works its dampers harder. Their real cost is the class's
weight window and the budget.

The rival teams are unchanged: their trouble on harsh ground was already
part of their estimate (`src/sim/rivals.ts`).

## Saves

No new save format. A raid saved before this has no dents (`under` is
filled in fresh); stage results without `guardHits` or `leak` read as
none. The logbook gained a moment, "a rock holed the oil pan" and the like,
for a raid whose costliest stop was a rock.
