# Balance across the three classes (plan PR 13)

How the career's numbers were set so each class is a fair road to the Long
One, in plain words. (The Long One was the finale's working name when this
was written; since PR 13c it's the Whole Damn Country, id `longOne`.) The numbers live in `src/data/career.ts` (rival teams,
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
