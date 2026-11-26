# The garage logbook

Every truck the career's garage owns keeps a history, so an old truck has a
story and selling one feels like a moment. Kelbo picked it on 26 November
2026 (idea 5 of six post-1.0 ideas).

## What a logbook keeps

For each of the garage's own trucks (contract trucks belong to the
privateers, so they don't get one):

- **Raids** entered, **finished** (classified), **wins**, **podiums**, Whole
  Damn Country wins, and raids it **didn't finish**.
- Its **best finish**.
- **Kilometres** of raids driven (only stages it actually drove; the test
  track doesn't count).
- **Roadside stops**: breakdowns, slides into a snowbank and cracking ice.
- **Parts swapped** since it was bought (settings don't count).
- **Moments**: after each raid, up to two lines written like a roadbook,
  newest first, the last 12 kept:
  - how it went: "Washboard 800 ’91: won it", "2nd place", "first raid,
    7th place", "didn’t finish", "won the Long One";
  - the stop that cost it the most time: "Frozen Knuckle ’91: snapped the
    rear left axle", "slid into a snowbank", "cracked the ice and took the
    shore track".

Trucks break and stop; nobody gets hurt, so there are no crashes or
rollovers in the logbook.

## Where you see it

- **Career panel, Your truck:** the logbook of the truck you have, open, and
  **Old trucks** (folded away): every truck you sold, with the years you
  had it and its whole logbook. Selling a truck shows a goodbye line with its
  raids and kilometres.
- **Truck card** (build screen), when your own career truck is on the
  bench: the picture is a little shorter, and under the weight it adds
  "Truck No. 2 · Raids 14 · Wins 3 · 6,120 km" and the newest moment.
  Free play and contract trucks keep the card as it was.

## In the code

- `src/sim/logbook.ts`: the `TruckLog` and `TruckMoment` shapes, and the
  calls `career.ts` makes when the garage buys a truck (`logBought`), sells
  it (`logSold`), fits parts (`logParts`) and settles its own raid
  (`logRaid`). `favouriteTruck` (most raids, then wins, then kilometres) is
  there for the career's recap.
- `src/data/logbook.ts`: how many moments and old trucks are kept.
- `src/ui/logbook.ts`: the words and the blocks; `src/ui/truckCard.ts`
  draws the two card lines. The build screen gets the log through the
  career's bench (`Bench.log`).
- **Saves:** `CareerState.trucks`, oldest first; the truck you have is the
  last one not sold. No new save format: a save from before logbooks gets a
  fresh, empty logbook for the truck it has, starting that year. A log or
  moment that doesn't add up is dropped rather than failing the save.
- Tests: `tests/logbook.test.ts`.
