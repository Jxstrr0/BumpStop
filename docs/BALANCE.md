# Balance across the three classes (plan PR 13)

How the career's numbers were set so each class is a fair road to the Long
One, in plain words. (The Long One was the finale's working name when this
was written; since PR 13c it's the Whole Damn Country, id `longOne`. The
teams were renamed after this too: Brannigan is now the Tundra Dogs, Highbank
Goldpan Racing and Hardpan the Ironwood Brothers.) The numbers live in `src/data/career.ts` (rival teams,
privateers, reputation, sponsors) and `src/data/parts.ts`.

## The tools

Three harnesses in `scripts/harness/` play the game without a person and
print what happened. They're slow (minutes, not seconds), so they aren't
part of `npm run test`; run one on a computer with

```
npx vitest run --config vitest.harness.config.ts career-light4x4
```

- **The career bot** (`careerBot.ts`, one file per class): plays a whole
  career in one class the way a steady player might. Contracts until it can
  buy a truck, then its own entries with the best driver its reputation
  brings, crew and tools when there's money, and part upgrades a slot at a
  time (dampers first; it leaves armour and engines stock because it can't
  judge their weight). `BOT_POLICY=steady` calls Steady all the way;
  `smart` calls Push once the dampers are better than stock. It writes a
  line per raid and a summary per career to `/tmp/careerbot-<class>.txt`.
  `BOT_SEEDS`, `BOT_SEASONS` and `BOT_POLICY` choose what it plays.
- **Pace** (`pace.harness.ts`, `best.harness.ts`): the player's time against
  par for a stock truck and for an upgraded one, by driver and pace call.
  Rivals' `pace` is the same ratio, so this is what their numbers are set
  against. `teams.harness.ts` prints each team's pace and trouble by year.
- **Part traps** (`culprit.harness.ts`): every part, one at a time, on the
  stock truck with factory settings: no part should break far more than
  stock (cheap parts like twin-tube dampers and all-terrain tires are meant
  to be worse).

## What the bot found, and what changed

**Before** (8 seasons a class, Steady):

- **Heavy truck: far too easy.** It won about 2 raids in 5 and the Long One
  in its third season, and banked over a million: no team races heavy
  trucks at regional raids before 1994, and the stock heavy truck almost
  never breaks.
- **Light 4x4 and side-by-side: nearly unwinnable.** A handful of wins in
  60 raids, never the Long One. Brannigan (light) and Jackrabbit
  (side-by-side) ran at 0.86 and 0.91 of par from 1985, while a player's
  best clean Push run is about 0.89 and a stock truck on Steady is about
  1.1 with its stops.
- **Reputation came too fast:** the Long One opened in the second season
  and the works deal straight after.
- **A trap:** the 1990s double wishbones and trailing arms snapped an axle
  every few kilometres on their factory settings, so buying the newest
  suspension made the truck far worse.

**Changes:**

| What | Before | Now | Why |
| --- | --- | --- | --- |
| Team drivers' pace (Brannigan, Highbank, Hardpan, Jackrabbit) | 0.91, 0.94, 0.96, 0.90 | 0.95, 0.96, 0.94, 0.935 | Beatable on Push with a good truck, not by a stock truck on Steady |
| How much a team's engine helps it (`paceFromPower`) | 0.15 | 0.07 | Your engine only helps on fast ground, and never more than 8% quicker; theirs helped everywhere |
| Quickest a team can get (`paceLimits`) | 0.80 | 0.85 | A clean Push run is about 0.89 of par |
| Hardpan Haulage Works | national raids and the Long One | every raid | A team to beat in heavy regionals from 1985 |
| Heavy privateers' pace | 1.00, 1.04, 1.08 | 0.96, 1.00, 1.04 | Their trucks hardly break, so they were no race for a heavy truck |
| Reputation for finish, podium, win | regional 1/3/5, national 2/5/9, Long One 4/10/20 | 1/2/4, 2/4/7, 3/8/15 | The Long One opens in the third or fourth season |
| Works deal | 80 reputation | 120 | A couple of seasons after the Long One opens |
| Axle joint's straight point | moved with the part's travel | the same for every part | Longer travel only adds angle at the ends of the stroke |
| Double wishbone | arm 0.8, biggest angle 0.9 | arm 0.9, biggest angle 0.95 | Still more fragile than a solid axle, no longer a trap |

**After** (8 seasons, 1985 to 1992; two careers a class where there's
time, wins out of the bot's own entries):

| Class | Steady all the way | Push once the dampers are better than stock |
| --- | --- | --- |
| Light 4x4 | 7 and 14 wins in 57; Long One never, and 1987 | 21 and 30 wins; Long One 1990 and 1987 |
| Heavy truck | 4 wins in 50; Long One 1991 | 18 wins; Long One 1990 |
| Side-by-side | 15 and 23 wins in 58; Long One never, and 1989 | 22 wins; Long One 1990 |

So every class can win the Long One, a player who pushes a well-prepared
truck wins it sooner (usually in the career's third to sixth season), and
a Steady-only stock-minded player may never win it. The Long One opens in
the third season in every class. Heavy trucks still bank the most money,
but it's 3.5 times the money for 3.5 times the parts, so it buys about the
same.

The bot is a plain player: it never retunes the settings, never fits
studs, and calls one pace for the whole raid. A person does better.

## The checks in CI

`tests/careerBalance.test.ts` keeps the shape from drifting: every class
has a rival quicker than par at every raid, every year; the quickest team
in each class stays between 0.85 and 0.98 of par; reputation opens the Long
One in the third or fourth season of podiums, and the works deal later; the
wishbones and trailing arms snap no more axles than the stock truck. The
Long One test (`tests/longOne.test.ts`) checks every class's stock truck
gets home.

## Six raids a year (PR 13d)

Kelbo cut the year from eight raids to six on 26 November 2026 (the
Blackfly Classic and the Gravel Pit Derby left the career). With two fewer
regional raids a season, a podium at a regional raid went back to 3
reputation (from 2) so the finale still opens in the third or fourth season.
The bot again (one career a class, Push once the dampers are better than
stock, 1985 to 1992):

| Class | Wins | Finale open to its own truck | Finale won |
| --- | --- | --- | --- |
| Light 4x4 | 15 in 40 | fourth season | fourth season (1988) |
| Heavy truck | 12 in 35 | fourth season | fifth season (1989) |
| Side-by-side | 19 in 42 | third season | eighth season (1992), second three times before |

## Money and Push after the playtest (26 November 2026)

Kelbo's playtest found four money and balance problems. What was measured
and what changed (`scripts/harness/money.harness.ts`, `quirks.harness.ts`
and `push.harness.ts`; five seeds unless it says otherwise, the veteran
driving, Steady):

**Your own truck lost money even on a podium.** Before, a stock light 4x4
at a regional raid paid 3,500 in fees (1,500 entry, 2,000 for the veteran)
for a third place worth 2,000, then the repair bill: places 3, 2, 1, 2, 5 at
the Cold Start 300 still averaged −1,500, and the Washboard 800 −4,900.
Now the fees are lower and the prizes bigger, and repairs cost 45% of a
part's price per unit of wear (it was 60%):

| Raid size | Entry | Driver × | Prizes (light 4x4) |
| --- | --- | --- | --- |
| Regional | 1,500 → 1,000 | 1 → 0.6 | 6,000 / 3,500 / 2,000 → 10,000 / 7,000 / 5,000 |
| National | 4,000 → 3,000 | 1.6 → 1 | 15,000 / 9,000 / 5,000 / 2,500 → 20,000 / 13,000 / 8,500 / 4,500 |
| The finale | 9,000 → 7,000 | 3 → 2 | 40,000 / 22,000 / 12,000 / 6,000 / 3,000 → 50,000 / 30,000 / 18,000 / 9,000 / 4,500 |

So a stock truck's third place about pays its way on a five-stage raid
(light 4x4 at the Washboard 800: 5,000 against 2,200 in fees and a bill of
about 2,750) and does better on short ones; a win pays well; fourth and
below still cost money. The garage starts with 10,000 (was 8,000), because
contracts pay less (below). `tests/career.test.ts` keeps third place above
the fees and a fair bill at every size of raid.

**"All told" left out the fees.** It now counts the entry and driver
fees and the sponsor's money, so it's the change in the bank.

**Untouched stock contract trucks finished on the podium for full pay.**
A stock contract truck handed over untouched paid 5,000 to 7,000 at a
regional raid, more than your own truck's podium. Two changes:

- **Privateers bring their truck as they last ran it**, with up to two of
  their own changes that hurt it in that season (`QUIRKS`), named on the
  offer. The sweep (four seeds, stock trucks, each change at its extreme):

  | Change | Light 4x4 summer / winter | Heavy summer / winter | Side-by-side summer / winter |
  | --- | --- | --- | --- |
  | Tires let right down | 1.78 (6 tows) / 1.21 | 1.12 / no change | 1.49 / 1.21 |
  | Tires pumped hard | 1.27 (35 stops) / no change | 1.13 / no change | 1.20 / no change |
  | Shortest bump stops | 1.60 (4 tows) / no change | 1.27 / no change | 1.75 (6 tows) / no change |
  | Softest springs, no preload | 1.33 / 1.27 | 1.96 (9 tows) / 1.50 | no change |

  (Time against par for the whole raid; factory settings were 1.22 and
  1.04 for the light 4x4, 1.08 and 1.03 heavy, 1.14 and 1.04 side-by-side,
  on the Washboard 800 and the Cold Start 300.) With two changes at Dust
  Supper, the untouched light 4x4 and side-by-side came last in class in
  all five runs (the heavy truck 4th or 5th); put back to the factory
  settings they were mostly 2nd or 3rd. The first job comes as the
  factory set it, so the guide is unchanged.
- **Smaller pay:** the fee is 8% of the privateer's budget (was 11%), and
  the bonus 25%, 60% or 100% of it (was 30%, 80%, 150%).

**Buying a truck** takes two taps now, and a truck sells back for 90% of
its parts' price until its first raid, 8% less after each, down to half.

**Push was always right.** The sim mostly agrees for a good truck on long
summer raids: on Dust Supper a light 4x4 with 1986's best dampers and
tires was about 10% quicker on Push. But on the Washboard 800 Push was no
quicker (its cut tires and fades ate the gain), and on the Cold Start 300
Push on plain tires was slower (snowbanks). What was missing was a way to
tell and a cost that lasts, so: harsh kilometres now age the springs and
bushings 1.7 times as fast at Push (0.6 at Conserve), and a **pace check**
before each stage, and under the ladder's and torture loop's reports,
says what each pace call does to this truck (`docs/RAIDS.md`). With the
new repair share, Push cost about 30% more in repairs and bivouac parts on
Dust Supper (2,490 against 1,910).

The career bot afterwards (one career a class, Push once the dampers are
better than stock, 1985 to 1992), against the same bot on 1.8.2.0:

| Class | Wins | Finale open | Finale won | Bank at the end |
| --- | --- | --- | --- | --- |
| Light 4x4 | 13 in 40 (13 before) | fourth season (same) | eighth season (same) | 293,659 (55,006) |
| Heavy truck | 12 in 34 | fifth season | fifth season | 1,230,557 |
| Side-by-side | 14 in 42 (15 in 41) | third season (fourth) | not in eight (same) | 119,310 (16,275) |

Winning is about where it was; the money isn't. The garage now ends the
eighth season well off, where before it was scraping by, because own
entries pay. The bot spends on every part it can, so the spare money is
what the parts can't use. On the finale the bot on Steady came 2nd to 4th
every year and never won; on Push it won once (light 4x4).

## Late crew and tools (1.11, 26 November 2026)

Five more crew and tools (`UPGRADES`, `docs/CAREER.md`) give that spare
money somewhere to go. The light 4x4 bot (seed 1, Steady, ten seasons)
before and after:

| | Wins | Finale open | Bank at the end |
| --- | --- | --- | --- |
| Before (1.10) | 7 in 52 | fourth season | 326,872 |
| After (1.11) | 7 in 52 | fourth season | 88,145 |

The bot buys each one as its reputation opens it, so the bank stays low
until about the eighth season and then climbs again. The upgrades help on
the road (more spares and hours, slower oil and spring wear) but don't
change the bot's results on Steady: they make a long raid kinder to a
truck rather than faster. The heavy truck's money is about 3.5 times a
light 4x4's and the upgrades cost the same for every class, so a heavy
garage still buys them all early.
