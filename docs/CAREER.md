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
    The card says what the privateer changed themselves (soft tires, say):
    their truck comes set up their way, which hurts it, so putting it right
    is part of the job. Build it until it's legal, then **Hand it over**: the privateer races
    it there and then, a stage at a time, and the results card shows the
    table, the fee and the bonus. **Give the contract back** (tap twice)
    lets it go.
  - **Enter your own truck:** pick a driver; the fees, the sponsor's money,
    the prize money and anything stopping you are listed. **Enter the raid**
    hands over to the Raids panel on the Raid tab, which runs it as usual. At the end
    (or if you retire), **Back to the garage** brings you back here to the
    results: prize money, the sponsor's money, the entry and driver fees,
    repairs, spares, and **All told**, which is how much the bank went up or
    down because of the raid, fees included (it left them out before the
    playtest of 26 November 2026).
  - **Sit this one out** (tap twice).
- **The calendar** for the year (folded away).
- **Your truck:** buy one (stock, at its price; tap twice), sell it (tap twice), and
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

You start on day 15 of 1985: a two-person garage with 10,000 in the bank
and no truck. Every year has six raids, two of them in winter (`CALENDAR`), and at each one the
garage does **one job**:

1. **A prep contract.** A privateer brings a class, a budget and a driver.
   You build their truck on the bench, under their budget, with the parts
   that are out that year. It arrives as they last ran it, with one of
   their own changes (two at the bigger raids) that hurts it; the first job
   comes as the factory set it. They race it (the ride sim drives it; the
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

## One-day events (after 1.33)

The four one-day events (`docs/NAMES.md`) each run a small series of three
rounds a year, in the summer gaps between the raids (`ROUNDS` in
`src/data/contests.ts`; the sums in `src/sim/careerEvents.ts`):

| Day | Round |
| --- | --- |
| 121, 142, 201 | Tailings Hill Climb |
| 128, 149, 208 | Gravel Pit Derby |
| 135, 172, 222 | The Rattle Mile |
| 179, 215, 236 | Sawbuck Fall Fair Jump-Off (the last is the fall fair itself) |

- Entering needs your own truck as it is on the bench (same parts; settings
  may differ), no job taken for the next raid, and the fees: 400 cr. entry
  for a light 4x4, plus a quarter of the driver's regional fee on a timed
  event (the hill climb and the derby; the crew drives the others). Times
  `CLASS_MONEY`, like every fee.
- Entering moves the career's day to the round: the rounds before it are
  passed. Going to the raid passes the rest before it.
- Prizes for the top three: 4,000, 2,500 and 1,500 cr.; reputation +2 for
  a win, +1 for a podium. Each run that broke costs a repair (1,500 cr. at
  the usual repair share, so the crew and tools make it cheaper).
- Series points 10, 6, 4, 3, 2, 1. Rounds you don't enter are run by the
  rivals alone (the regional field, every class), so they score too.
- At the end of the year each series has a champion. Win one in your class
  for 8,000 cr. and +3 reputation. The news says who won each series you
  scored in.
- The screens: the Raid tab's **One-day events** panel lists the rounds
  before the next raid (pick one, the driver on a timed event, the fees
  and prizes, the series table so far), then the runs as in free play,
  then what it paid and the series after it. "Leave the event" (two taps)
  settles the round as it stands. The career panel says which events come
  before the raid, with a button down to them; while an event is under way
  it says so and holds the raid's jobs back. The calendar lists the
  rounds; a raid's results card shows any series won at the end of the
  year (`src/ui/contest.ts`, `src/ui/career.ts`).
- A run's score is kept as it ends (`CareerState.events.live`), so a reload
  carries on mid-event. A save from before the events starts the series
  fresh, with no new save format.

## Money

Money is written "cr." after the number, "1,200 cr." (Kelbo's pick,
`docs/NAMES.md`). Part prices never change; the career gets harder
because the rivals' budgets grow and better parts come out.

- **Your truck** costs its class's stock price to buy. Changing a part
  costs the new part minus half what the old one cost (it's sold back);
  selling a part down to a cheaper one gives money back. Settings are free.
  The whole truck sells for 90% of its parts' price until its first raid,
  8% less after each raid, down to half (`CAREER.truckResale`); never more
  than you paid with a sponsor's discount.
- **Heavy trucks cost about 3.5 times a light 4x4, side-by-sides 0.6
  times** (`CLASS_MONEY`): parts, fees and prize money alike.
- **Entry fees and prize money** depend on the size of the raid (`TIERS`):
  a regional win in a light 4x4 pays 10,000 (third 5,000), a national win
  20,000, the finale 50,000. The fees (entry 1,000, 3,000 and 7,000, and
  drivers times 0.6, 1 and 2) are set so a podium in a stock truck about
  pays its way and a win pays well (`docs/BALANCE.md`).
- **Drivers** charge a fee per raid, more for bigger raids. The charger and
  the gravel ace only drive for a garage with a name (`DRIVER_TERMS`).
- **Repairs:** after your own raid, each worn part costs 45% of its price
  times how worn it was (a quarter of the set for one corner), and every
  spare used is bought again.
- **Contracts:** the privateer's budget is 62% to 95% of the class's test
  budget (more at bigger raids). Your fee is 8% of it; the bonus is 25%,
  60% or 100% of the fee. Their own changes (`QUIRKS`): tires let well
  down or pumped up hard, the shortest bump stops, or the softest springs
  with no preload. **Back to stock** on the build screen undoes them all.

## Reputation

Results earn reputation (half as much for a contract): a regional raid
gives 1 to finish, 3 for a podium and 5 for a win; a national raid 2, 4 and
7; the Whole Damn Country 3, 8 and 15 (`TIERS`). A podium at every raid
opens the Whole Damn Country in the third or fourth season (plan PR 13 slowed it from the
second). It opens:

| Reputation | What opens |
| --- | --- |
| 0 | Regional raids, light 4x4 contracts (side-by-side ones from 2005), the veteran and the mechanic |
| 5 | A second mechanic (two more bivouac hours) |
| 8 | The charger |
| 10 | A local sponsor, Two Pines Hardware or Loonlight Diner (pays 1,500 a raid), a hydraulic press (cheaper repairs) |
| 12 | Heavy truck contracts |
| 15 | National raids with your own truck |
| 20 | The gravel ace |
| 30 | A third mechanic |
| 35 | A regional sponsor, Muskeg Tire Co. or Hoarfrost Cola (4,000 a raid) |
| 40 | A welding bay (cheaper repairs again) |
| 50 | A bigger parts truck (35,000; two more tires, a shock and a CV joint on every raid) |
| 60 | The Whole Damn Country with your own truck |
| 70 | A shock dyno (45,000; shock oil tires a third slower) |
| 100 | A spring setting rig (40,000; springs sag 40% slower) |
| 120 | A works deal with Boreal Bolt & Nut or Ptarmigan Lard Oil: 8,000 a raid and a quarter off parts |
| 130 | A night shift (60,000, after the third mechanic; three more bivouac hours) |
| 160 | A machine shop (55,000, after the welding bay; cheaper repairs again) |

### Crew and tools late in a career

The last five upgrades (Kelbo asked, 26 November 2026) give late money
somewhere to go: before them a garage had bought everything by about the
fourth season and then just banked (a light 4x4 bot had about 294,000 after
eight). They cost 235,000 together and open from about the third season to
the seventh. They all help your own raids, never a privateer's contract:

- **A bigger parts truck** adds its spares to the truck's own at the start
  of each raid (`RaidEntry.extraSpares`). They're restocked after the raid
  like the rest.
- **A shock dyno** and **a spring setting rig** slow the bivouac wear
  (`RaidEntry.oilWear`, `RaidEntry.springSag`, used in `tireCondition`):
  the oil tires at 0.65 times the rate and the springs sag at 0.6 times.
  The bushings are unchanged.
- **A night shift** adds three hours a night and **a machine shop** takes
  0.07 more off the repair share (0.45 at the start, 0.08 with everything).

All three raid fields are left out when they don't apply, so raids saved
before them carry on as they were and the save format didn't change. The
Crew and tools list shows what you can buy now; the rest are folded under
"Later, with more reputation", and what you have is one line on top.

Sponsors don't stack: the best one you qualify for is the one you have.
Which of each pair a career gets comes from its seed (`sponsorName`), and
so do the drivers it hires: one from each trade's pool of four
(`driverName`, `docs/NAMES.md`).

## Rival teams who copy what wins

Four teams (Kelbo's names, `docs/NAMES.md`; the ids in the code are the old working names), each with its own habits:

| Team | Races | Buys | Copies the winner |
| --- | --- | --- | --- |
| Tundra Dogs (`brannigan`) | light 4x4 (side-by-side from 2010) | power first | often (half the time, slot by slot) |
| Goldpan Racing (`highbank`) | light 4x4 from 1990, heavy from 1994, side-by-side from 2008 | the newest parts | sometimes |
| Ironwood Brothers (`hardpan`) | heavy (light 4x4 from 2000), every raid since plan PR 13 (was national raids and the finale only) | the strongest parts | rarely |
| Jackrabbit Sport | light 4x4 from 1996, side-by-side from 2005 (its first love) | the lightest parts | sometimes |

Plus three privateers per class on stock trucks.

**Side-by-sides race from 2005** (real-history dates, Kelbo, 28 November
2026), as the real ones arrived in desert racing in the mid-2000s: before
then there's no side-by-side to buy, no side-by-side contract and no
side-by-side series at the one-day events (`TruckClass.from`, `classOut`).
A garage saved with a side-by-side from before that keeps it, races it and
keeps every part already on it; only new parts wait for their year (the
`kept` build in `BuildRules`). The heavy privateers are a
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

## After 2025: the hall of fame

The last raid of 2025 ends the career. Its results card says so ("That's
2025 done: the end of the road") with a button to **open the hall of
fame**. The year stops at 2025 and the seasons keep counting, so anyone who
wants more can carry on: the raids' roads and the contracts keep changing.

The hall of fame folds away at the foot of the career panel. Until the end
it's **The career so far**, so it's there to look at any time.

- **The record:** seasons, your own raids, wins, podiums, contracts, and the
  years the garage won the Whole Damn Country.
- **Best seasons:** the top three (`HALL.bestSeasons`): a Whole Damn Country
  win first, then wins, podiums and reputation. Each says the season's
  money, reputation and best result.
- **Biggest rival:** the rival team that finished ahead of your trucks most
  often (own entries and contract trucks both count; a retired truck counts
  as beaten). Most meetings breaks a tie.
- **Favourite truck:** from the truck logbooks (`docs/LOGBOOK.md`): the truck that raced most (then won most, then drove furthest), its years, raids, wins and kilometres, and the moment its logbook remembers (a Whole Damn Country win, else a win, else the latest).
- **Drivers you hired** for your own entries: how many raids, wins and
  podiums each, and the year they first drove for you.
- **The album:** in a career, photo mode has a **Keep for the album**
  button. The shot (1,280 pixels, as a JPEG, with the BUMP STOP mark) goes
  in this career's album, up to 24 photos (`HALL.albumMax`), captioned with
  the raid or the test track and the year. Tap a photo to see it bigger;
  **Remove** (tap twice) makes room.

How it's kept:

- The career's news only keeps 40 lines, so the hall keeps its own small
  record as the career goes (`src/sim/hall.ts`, in `CareerState.hall`): a
  line per season, a tally per rival team and per driver, and the season the
  career ended. `settle` adds to it after every raid.
- A career saved before the hall of fame has no record: it starts counting
  from the season it's in, and the hall of fame says which year. The
  totals (from the career's own record) are still the whole career. No new
  save format: the record is optional and a record that doesn't add up is
  dropped, never the save.
- The album isn't in the save: photos are too big. They live in the game's
  IndexedDB database (`bumpstop`, a second store `album`, database version
  2), by slot and by career (its seed), so a new career in the same slot
  gets a new album and deleting a slot deletes its photos
  (`src/persist/album.ts`). Save codes and backups leave them out; they stay
  on this phone. A browser without IndexedDB has no album, and says so.
- Screens: `src/ui/hall.ts`; photo mode reaches the album through
  `src/ui/album.ts`.

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

`tests/careerEvents.test.ts`: the rounds (in the gaps, three each),
entering one (fees, the day, rounds passed), why not, the pay-out and
series points, the rivals running rounds alone, the champions at the end
of the year, and the series through a save.

`tests/hall.test.ts`: the hall of fame's record (seasons, rivals, drivers,
best seasons), the end coming once after 2025, the record through a save
(and older careers without one), and the album's bookkeeping.
