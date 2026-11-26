# The career (plan PR 9)

How the career works, in plain words. The code is in `src/sim/career.ts`
(the calendar, contracts, money, your truck, the pay-out after each raid)
and `src/sim/teams.ts` (the rival teams and their trucks). Every number is
in `src/data/career.ts`.

Part 9a is the sim, the save and the tests. Part 9b adds the screens
(`src/ui/career.ts`).

## The screens (9b)

The career lives in a save slot. **Start a career in 1985** (on the Career
panel under "The loop") turns the slot into a career: from then on the
year, the money and the raids follow it. Free-play trucks stay in the slot;
use another slot to keep playing free.

- **The first-job guide** (plan PR 11b): on the career's first raid, a box
  at the top walks through the first job step by step. See `docs/HELP.md`.
- **The status line:** the date, the money (red when broke), the
  reputation, the sponsor, and any wins at the Whole Damn Country.
- **Next raid:** its date, stages and size, then the garage's job:
  - **Prep a privateer's truck:** three offers (the ones you haven't the
    reputation for are greyed out). Take one and the build screen locks to
    their class and budget, with a line at the top saying whose truck it is.
    Build it until it's legal, then **Hand it over**: the privateer races
    it there and then, a stage at a time, and the results card shows the
    table, the fee and the bonus. **Give the contract back** (tap twice)
    lets it go.
  - **Enter your own truck:** pick a driver; the fees, the sponsor's money,
    the prize money and anything stopping you are listed. **Enter the raid**
    hands over to the Raids panel below, which runs it as usual. At the end
    (or if you retire), **Back to the garage** brings you back here to the
    results: prize money, repairs, spares and reputation.
  - **Sit this one out** (tap twice).
- **The calendar** for the year (folded away).
- **Your truck:** buy one (stock, at its price), sell it (tap twice), and
  when broke, sell its parts down to the cheapest for money back. Its
  **logbook** sits under it, and the trucks you sold under **Old trucks**
  (`docs/LOGBOOK.md`).
- **The shop:** crew and tools, with what each needs.
- **News:** your results, who copied whom, new parts, sponsors; and your
  record.

**The build screen in the career.** The class and the year are locked to
the truck on the bench:

- a **contract** truck is built against the privateer's budget;
- **your own truck:** settings are free and kept as you tune; changing a
  part shows what it costs (new part less half the old one's price) against
  the bank, with a **Buy these parts** button. You can't enter with parts you
  haven't bought. **Reset** puts your truck back as you own it.
- **no truck yet:** look at the parts, nothing to buy.

This goes through the build store's bench (`setBench` in
`src/ui/buildStore.ts`).

## The shape of it

You start on day 15 of 1985: a two-person garage with 8,000 in the bank
and no truck. Every year has six raids, two of them in winter (`CALENDAR`), and at each one the
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
the year (the Whole Damn Country) a new year starts: new parts come out, and the
rival teams buy for it.

## The calendar

Names picked by Kelbo on 26 November 2026 (`docs/NAMES.md`). The code still
uses the old working names as ids (`winterSprint` … `longOne`) so saves keep
working; the finale's tier is still called `long` in the code.

| Day | Raid | Id | Stages | Size |
| --- | --- | --- | --- | --- |
| 40 | Cold Start 300 | `winterSprint` | 3 | regional |
| 75 | Frozen Knuckle | `winterRaid` | 4 | regional |
| 158 | Washboard 800 | `summerRaid` | 5 | regional |
| 186 | Dust Supper | `nationalRaid` | 7 | national |
| 244 | Polar Night Raid | `autumnRaid` | 5 | national |
| 268 | The Whole Damn Country | `longOne` | 14 | the finale |

A raid takes a day a stage plus two days of travel (and the finale's rest day). A career starts on day
15 of 1985, so its first job is the three-stage Cold Start 300, as the plan
has it. The two winter raids (plan PR 10) bring cold oil, studs, snowbanks
and lake ice (`docs/WINTER.md`); rivals don't fade in winter. Dust
Supper, the Polar Night Raid and the Whole Damn Country share a set of long stages (logging
roads, eskers, rock country, haul roads, the old burn, the mine roads and
long fast gravel), each on its own roads.

## Money

Money is written "cr." after the number, "1,200 cr." (Kelbo's pick,
`docs/NAMES.md`). Part prices never change; the career gets harder
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

Results earn reputation (half as much for a contract): a regional raid
gives 1 to finish, 3 for a podium and 5 for a win; a national raid 2, 4 and
7; the Whole Damn Country 3, 8 and 15 (`TIERS`). A podium at every raid
opens the Whole Damn Country in the third or fourth season (plan PR 13 slowed it from the
second). It opens:

| Reputation | What opens |
| --- | --- |
| 0 | Regional raids, light 4x4 and side-by-side contracts, the veteran and the mechanic |
| 5 | A second mechanic (two more bivouac hours) |
| 8 | The charger |
| 10 | A local sponsor, Two Pines Hardware or Loonlight Diner (pays 1,500 a raid), a hydraulic press (cheaper repairs) |
| 12 | Heavy truck contracts |
| 15 | National raids with your own truck |
| 20 | The gravel ace |
| 30 | A third mechanic |
| 35 | A regional sponsor, Muskeg Tire Co. or Hoarfrost Cola (4,000 a raid) |
| 40 | A welding bay (cheaper repairs again) |
| 60 | The Whole Damn Country with your own truck |
| 120 | A works deal with Boreal Bolt & Nut or Ptarmigan Lard Oil: 8,000 a raid and a quarter off parts |

Sponsors don't stack: the best one you qualify for is the one you have.
Which of each pair a career gets comes from its seed (`sponsorName`), and
so do the drivers it hires: one from each trade's pool of four
(`driverName`, `docs/NAMES.md`).

## Rival teams who copy what wins

Four teams (Kelbo's names, `docs/NAMES.md`; the ids in the code are the old working names), each with its own habits:

| Team | Races | Buys | Copies the winner |
| --- | --- | --- | --- |
| Tundra Dogs (`brannigan`) | light 4x4 (side-by-side from 2004) | power first | often (half the time, slot by slot) |
| Goldpan Racing (`highbank`) | light 4x4 from 1990, heavy from 1994, side-by-side from 1998 | the newest parts | sometimes |
| Ironwood Brothers (`hardpan`) | heavy (light 4x4 from 2000), every raid since plan PR 13 (was national raids and the finale only) | the strongest parts | rarely |
| Jackrabbit Sport | side-by-side (light 4x4 from 1996) | the lightest parts | sometimes |

Plus three privateers per class on stock trucks. The heavy privateers are a
little quicker than the others (their trucks rarely break). How these numbers were
set: `docs/BALANCE.md`.

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

## The Whole Damn Country: the finale (plan PR 13)

The last raid of every year: fourteen stages across the whole country, with
a **rest day** at halfway (after stage 7), so the trip takes two weeks and
a bit. On the rest day the crew has a whole day in the bivouac, twice a
night's hours (`RAID.restDayHours`), to put the truck right for the second
week. It needs a reputation of 60 to enter your own truck.

- **The road to it:** the career's status line always shows how far off it
  is: the reputation it takes and a bar, then "open to your own truck",
  then the years you won it (`longOneRoad`).
- **The finale:** the first time your own truck wins its class, the results
  card opens with the finale: the year and the garage's season, the class
  and the driver, the record that got you there and the winning truck's
  parts. The career carries on after it.
- **The record:** that first win is kept in the career (`firstLongOne`, a
  `LongOneStory`) and shown under the news for good; later wins add their
  year to `longOne`. Saves from before have none and load as they were; a
  story that doesn't add up is dropped, never the save.

## After 2025

The year stops at 2025 and the seasons keep counting, so the raids'
roads and the contracts keep changing.

## What's not here yet

- **Names** for the privateers (known by race number) and parts makers.

## The tests

`tests/career.test.ts`: the calendar, contracts (the same offers for the
same career, the open first offer, a legal truck under every budget, the
pay-out), your truck (buying, upgrading, selling, settings for free), entry
rules, the pay-out and repair bill, retiring, the finale, the years
rolling to 2025 and past, the same career for the same seed, the teams
(ratings, buying habits, copying, the field by tier, copying you), broke,
the shop, the save (format 1 moving up, careers and career raids round
trip, damaged team trucks, bad careers turned away), and the stock trucks
getting home on the Polar Night Raid and the Whole Damn Country.
