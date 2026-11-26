# Bump Stop: names

**Status: proposed in PR 0.** Kelbo picked an English-flavoured north on
25 November 2026 (over two Finnish-flavoured options); the names below are
proposals in that style. **Birchland** is settled. Kelbo turned down the
antler and the first raid names, then on 26 November 2026 **picked the money
(cr.) and the raid names** (set A, below). On the same day he picked the rival teams, the drivers and the sponsors.
Privateers are still known by their race number. Propose any new name
to Kelbo before using it, and add it here.

Every name the game shows lives in `src/data/strings.ts`, so a new pick is
a one-line swap there (plus this file).

Every name was checked against section 8 of `.github/LONGLIGHT-STUDIO.md`,
the name lists in each game's profile there, and Mainline's `docs/NAMES.md`
on 25 November 2026:

- No country starting with V, and nothing from Velmark, Valmere, Tarnovia,
  Mostograd, Ardesia or Aqsor.
- None of the clashing names (Kestrel, Harbourline, Hollis, Corvid,
  Tidewater, Northwind, "Prairie", Nimbus), and no "North-" names next to
  Northwind and Northlight.
- Prairie Engine Works already uses English prairie names (Kettle Butte,
  Static Moose, Moose Jaw Speed, Coldwater, Copperkettle in Frontier Lab), so
  Bump Stop stays off moose, kettles and copper.
- No real raids, rallies or their nicknames, and no real brands. The names
  are invented; they weren't checked against every real hamlet, but none is
  a well-known place.

## The setting

A made-up northern country of boreal forest, lakes, eskers, muskeg and
tundra, 1985 to 2025. It sounds a bit like the Canadian north without being
it: plain English names, a little dry humour, frontier-town grit. Real
suspension words are used as they are.

| What | Proposed name | Other options |
| --- | --- | --- |
| Country | **Birchland** (the Republic of Birchland), after the birch woods that cover the south; it matches the game's birch-white roadbook paper | Tamarack; Hollowfell |
| Money | **cr.** (Kelbo, 26 November 2026), written after the number: "1,200 cr." | ~~the antler~~ (turned down); spruce, pike and tamarack (offered, not picked) |

The money is written "cr." after the number, never as a symbol on its own,
so it can't be mixed up with h for hours at the bivouac, hp for engine
power or M for millions.

## Places

| What | Name | Notes |
| --- | --- | --- |
| Capital, on the southern lakes | **Larchport** | A lake port: ferries in summer, an ice road in winter. The Cold Start 300 starts here. |
| The big lake that freezes | **Great Larch Lake** | The Frozen Knuckle crosses it on the ice road |
| Logging town in the middle of the country | **Sawbuck** | Mill town and base of the Washboard 800; the career's garage is here |
| Mining town in the north | **Gritstone** | Rock gardens and haul roads |
| Settlement on the tundra, the far end of the country | **Ptarmigan Point** | Where the Whole Damn Country finishes |

## Raids

**Picked by Kelbo on 26 November 2026** (set A, "rough and funny"). The
names live in `raid.*.name` in `src/data/strings.ts`; the ids in the code
stay the old working names, so saves keep working.

| When | Id in the code (old working name) | Name | Shape |
| --- | --- | --- | --- |
| Winter, day 40 (the career's first raid) | `winterSprint` (Winter Sprint) | **Cold Start 300** | 3 stages, thin ice, down to -28 °C |
| Winter, day 75 | `winterRaid` (Winter Raid) | **Frozen Knuckle** | 4 stages, longer lakes and the tundra |
| Free play only (left the career on 26 November 2026) | `summerSprint` (Summer Sprint) | **Blackfly Classic** | 3 stages, early summer |
| Summer, day 158 | `summerRaid` (Summer Raid) | **Washboard 800** | 5 stages, eskers, rock and haul roads |
| Summer, day 186 (national) | `nationalRaid` (National Raid) | **Dust Supper** | 7 stages across the middle of the country |
| Not in the game for now (left the career on 26 November 2026) | `midsummerSprint` (Midsummer Sprint) | **Gravel Pit Derby** | 3 quick stages |
| End of the season, day 244 (national) | `autumnRaid` (Autumn Raid) | **Polar Night Raid** | 5 cold stages as the nights draw in |
| The finale, day 268 | `longOne` (The Long One) | **The Whole Damn Country** | 14 stages and a rest day, end to end |

The Polar Night Raid stays at the end of the summer season (the last raid
before the finale), where the nights get long; the winter slots took Cold
Start 300 and Frozen Knuckle. Stages are described, not named ("Logging
roads", "Rock country", "The old burn", "Eskers and washboard", "Hot haul
roads", "The mine roads", "Long fast gravel", "Ice roads over the lakes",
"Frost-heaved forest roads", "Across the big lake", "Wind-scoured tundra").

Offered and not picked (set B): Whiteout 300, Ice Road Run, Gravel Moon,
Muskeg Marathon, Esker Dash, Firebreak Raid, Aurora Raid, Coast to Coast.
Turned down earlier: the Frostbite 300, the Esker Run, the Long Night Raid,
the Muskeg 800, the Birchland Traverse.

## Rival teams

**Picked by Kelbo on 26 November 2026.** Four teams with their own trucks
and habits, who copy what wins (plan, The career). Each starts in one class
and spreads to the others. The names live in `team.*` and `habit.*` in
`src/data/strings.ts`; the ids in the code stay the old working names, so
saves keep working. Privateer entries are known by their race number.

| Team | Id (old working name) | Starts in | Habit |
| --- | --- | --- | --- |
| **Ironwood Brothers** | `hardpan` (Hardpan Haulage Works) | Heavy truck | Two brothers and a welder: slow, steady, never quits, over-builds everything |
| **Tundra Dogs** | `brannigan` (Brannigan Brothers) | Light 4x4 | Scrappy privateers: push hard, break things, copy whatever won last |
| **Jackrabbit Sport** | `jackrabbit` | Side-by-side | Quick and light; their dampers cook in the heat |
| **Goldpan Racing** | `highbank` (Highbank Racing) | Light 4x4, later all three | Rich and flashy: buys the newest parts the year they come out |

Offered and not used: Northline Works ("North-" names clash with Northwind
and Northlight) and Kettle Rock Racing (Bump Stop stays off kettles).

## Drivers

**Picked by Kelbo on 26 November 2026:** a pool of four for each trade, and
each career hires one from each pool (`driverName` in `src/sim/career.ts`,
from the career's seed), so replays meet new faces. Free play has the first
of each. Names in `driverName.*` in `src/data/strings.ts`; the trade
(`driver.*`) shows under the name.

| Trade | Pool |
| --- | --- |
| The veteran | Arne Lindqvist, Bud Halloran, "Old Mac" Tierney, Gus Brekke |
| The charger | Dee Rask, Rory Swift, Kit Marchetti, Nell Dagger |
| The gravel ace | Sami Rautio, Benny Stone, Ida Grimsrud, Lou Cobble |
| The mechanic | Ozzie Wrenn, Hank Ratchet, Fran Holt, Doc Pelletier |

Jo "Flatout" Kessler was offered as a charger, but Scrapline already has a
rival called Rudi Kessler, so Dee Rask (from Kelbo's first round of picks)
took the place. Also offered in that first round: Hal "Gramps" Okerlund, Mo
Tallis, Pat Fennimore.

## Sponsors

**Picked by Kelbo on 26 November 2026:** two for each level, and each career
gets one of the pair (`sponsorName` in `src/sim/career.ts`). Names in
`sponsor.*` in `src/data/strings.ts`.

| Level | Reputation | Pair |
| --- | --- | --- |
| Local | 10 | Two Pines Hardware, Loonlight Diner |
| Regional | 35 | Muskeg Tire Co., Hoarfrost Cola |
| The works deal (a quarter off parts) | 120 | Boreal Bolt & Nut, Ptarmigan Lard Oil |

Northern Lard Oil was offered and became Ptarmigan Lard Oil (no "North-"
names).

## Parts

Parts are named by what they are ("Bypass dampers", "Turbo diesel"), with
one exception:

- **Zed-Two spool-valve dampers** (Kelbo, 26 November 2026), the 2017
  spool-valve shocks: a nod to the factory spool-valve shocks on a
  well-known off-road pickup. "Zed-Two" is Z-2 said the Canadian way; the
  real truck's and shock maker's names are trademarks and stay out of the
  game.

## Still to name

Parts makers, the crew at the garage, privateer customers (known by race
number for now). Each gets checked the same way and proposed to Kelbo first.
