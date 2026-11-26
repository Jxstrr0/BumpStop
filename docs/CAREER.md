# The career (plan PR 9)

How the career works, in plain words. The code is in `src/sim/career.ts`
(the calendar, contracts, money, your truck, the pay-out after each raid)
and `src/sim/teams.ts` (the rival teams and their trucks). Every number is
in `src/data/career.ts`.

Part 9a is the sim, the save and the tests. Part 9b adds the screens.

## The shape of it

You start on day 100 of 1985: a two-person garage with 8,000 in the bank
and no truck. Every year has six raids (`CALENDAR`), and at each one the
garage does **one job**:

1. **A prep contract.** A privateer brings a class, a budget and a driver.
   You build their truck on the bench, under their budget, with the parts
   that are out that year. They race it (the ride sim drives it; the
   privateer calls Steady all the way and the crew does the worst jobs
   first each night). You get a fee whatever happens, plus a bonus for the
   best of: finishing without a tow, a class podium, a class win.
2. **Your own entry.** Your own truck, an entry fee and a driver's fee
   (less your sponsor's money), then the raid as you know it. Prize money
   by place, then the repair bill for whatever wore out and the spares you
   used.
3. **Sitting it out.** The raid happens without you.

Then the career moves on by days to the next raid. After the last raid of
the year (the Long One) a new year starts: new parts come out, and the
rival teams buy for it.

## The calendar (all summer for now)

| Day | Raid (working name) | Stages | Size |
| --- | --- | --- | --- |
| 130 | Summer Sprint | 3 | regional |
| 158 | Summer Raid | 5 | regional |
| 186 | National Raid | 7 | national |
| 216 | Midsummer Sprint | 3 | regional |
| 244 | Autumn Raid | 5 | national |
| 268 | The Long One | 14 | the long one |

A raid takes a day a stage plus two days of travel. Winter raids join the
calendar with plan PR 10 (cold oil and ice); that's also when the career's
very first job can become the plan's three-stage winter raid. The National
Raid, the Autumn Raid and the Long One share a set of long stages (logging
roads, eskers, rock country, haul roads, the old burn, the mine roads and
long fast gravel), each on its own roads.

## Money

Money is the game's money, still shown as antlers until a new name is
picked (`docs/NAMES.md`). Part prices never change; the career gets harder
because the rivals' budgets grow and better parts come out.

- **Your truck** costs its class's stock price to buy. Changing a part
  costs the new part minus half what the old one cost (it's sold back);
  selling a part down to a cheaper one gives money back. Settings are free.
  The whole truck sells for half its parts' price.
- **Heavy trucks cost about 3.5 times a light 4x4, side-by-sides 0.6
  times** (`CLASS_MONEY`): parts, fees and prize money alike.
- **Entry fees and prize money** depend on the size of the raid (`TIERS`):
  a regional win in a light 4x4 pays 6,000, a national win 15,000, the Long
  One 40,000.
- **Drivers** charge a fee per raid, more for bigger raids. The charger and
  the gravel ace only drive for a garage with a name (`DRIVER_TERMS`).
- **Repairs:** after your own raid, each worn part costs 60% of its price
  times how worn it was (a quarter of the set for one corner), and every
  spare used is bought again.
- **Contracts:** the privateer's budget is 62% to 95% of the class's test
  budget (more at bigger raids). Your fee is 11% of it; the bonus is 30%,
  80% or 150% of the fee.

## Reputation

Results earn reputation (half as much for a contract). It opens:

| Reputation | What opens |
| --- | --- |
| 0 | Regional raids, light 4x4 and side-by-side contracts, the veteran and the mechanic |
| 5 | A second mechanic (two more bivouac hours) |
| 8 | The charger |
| 10 | A local sponsor (pays 1,500 a raid), a hydraulic press (cheaper repairs) |
| 12 | Heavy truck contracts |
| 15 | National raids with your own truck |
| 20 | The gravel ace |
| 30 | A third mechanic |
| 35 | A regional sponsor (4,000 a raid) |
| 40 | A welding bay (cheaper repairs again) |
| 60 | The Long One with your own truck |
| 80 | A works deal: 8,000 a raid and a quarter off parts |

Sponsors don't stack: the best one you qualify for is the one you have.

## Rival teams who copy what wins

Four teams (working names, `docs/NAMES.md`), each with its own habits:

| Team | Races | Buys | Copies the winner |
| --- | --- | --- | --- |
| Brannigan Brothers | light 4x4 (side-by-side from 2004) | power first | often (half the time, slot by slot) |
| Highbank Racing | light 4x4 from 1990, heavy from 1994, side-by-side from 1998 | the newest parts | sometimes |
| Hardpan Haulage Works | heavy (light 4x4 from 2000), national raids and the Long One only | the strongest parts | rarely |
| Jackrabbit Sport | side-by-side (light 4x4 from 1996) | the lightest parts | sometimes |

Plus three privateers per class on stock trucks.

Each team has a truck for each class it races, made from real parts. Every
new year it upgrades the slots on its list in its own way, inside a budget
that grows 4% of its first year's each year, so dearer parts come within
reach. After every raid, each team may copy the class winner's parts, slot
by slot, if they're out and fit its budget. **That includes you:** win with
bypass dampers and the news will say who copied them.

Rivals still don't go through the ride sim (a whole field would be too slow
on a phone). A team's truck gives it four ratings against the stock truck:
how much heat its dampers take, its wheel travel, its strength (frame,
axles, mounts, tires and bump stops) and its power for its weight. Those set
its pace and its chance of trouble on each stage (`teamPace`), and the
quick estimate in `rivals.ts` does the rest.

In classes you're not in, the raid is still run on the estimates, so every
class has a winner and the copying goes on everywhere.

## Broke: the soft landing

Money can go below zero after a repair bill. Then:

- you can't buy parts or upgrades, or enter your own truck;
- you can sell parts (fit cheaper ones and get the difference back; the
  sim offers `cheapestBuild`) or sell the truck;
- the first contract at every raid is always open to anyone, in a cheap
  class, and its budget always leaves room for a legal truck (a test checks
  every offer from 1985 to 2025).

There's no game over and no interest: one or two contracts get you going
again.

## The Long One

The last raid of every year: fourteen stages across the country. It needs a
reputation of 60 to enter your own truck. Win it and it goes in the record
(`longOne`); the career carries on. Making it the big finale (and its
balance across the classes) is plan PR 13.

## After 2025

The year stops at 2025 and the seasons keep counting, so the raids'
roads and the contracts keep changing.

## What's not here yet

- **The screens** (9b): the garage, the calendar, contracts, the bank and
  the news.
- **Winter raids** (plan PR 10).
- **Names** for the money, the raids, the sponsors, the drivers and the
  privateers: all working names until Kelbo picks.

## The tests

`tests/career.test.ts`: the calendar, contracts (the same offers for the
same career, the open first offer, a legal truck under every budget, the
pay-out), your truck (buying, upgrading, selling, settings for free), entry
rules, the pay-out and repair bill, retiring, the Long One, the years
rolling to 2025 and past, the same career for the same seed, the teams
(ratings, buying habits, copying, the field by tier, copying you), broke,
the shop, the save (format 1 moving up, careers and career raids round
trip, damaged team trucks, bad careers turned away), and the stock trucks
getting home on the Autumn Raid and the Long One.
