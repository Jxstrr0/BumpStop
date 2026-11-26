# Bump Stop: names

**Status: proposed in PR 0.** Kelbo picked an English-flavoured north on
25 November 2026 (over two Finnish-flavoured options); the names below are
proposals in that style. **Birchland** is settled. Kelbo turned down the
antler and the first raid names, then on 26 November 2026 **picked the money
(cr.) and the raid names** (set A, below). Teams, drivers, sponsors and
privateers still use plain working names (see each section). Propose any new name
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
| Summer, day 130 | `summerSprint` (Summer Sprint) | **Blackfly Classic** | 3 stages, early summer |
| Summer, day 158 | `summerRaid` (Summer Raid) | **Washboard 800** | 5 stages, eskers, rock and haul roads |
| Summer, day 186 (national) | `nationalRaid` (National Raid) | **Dust Supper** | 7 stages across the middle of the country |
| Summer, day 216 | `midsummerSprint` (Midsummer Sprint) | **Gravel Pit Derby** | 3 quick stages |
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

Three or four rival teams with their own trucks and habits, who copy what
wins (plan, The career). Each starts in one class and spreads to the others.
Still proposed. The raids (plan PR 7) show them as placeholders, with
privateer entries known only by their race number (`team.*` in
`src/data/strings.ts`).

| Team | Starts in | Habit |
| --- | --- | --- |
| **Hardpan Haulage Works** | Heavy truck | A trucking firm's works team: slow, steady, never quits, over-builds everything |
| **Brannigan Brothers** | Light 4x4 | Privateers turned pros: push hard, break things, fix them by the roadside |
| **Jackrabbit Sport** | Side-by-side | Quick and light; their dampers cook in the heat |
| **Highbank Racing** | Light 4x4, later all three | New money: buys the newest parts the year they come out |

## Drivers

The hired drivers (plan PR 7) go by their trade until Kelbo picks names:
the veteran, the charger, the gravel ace and the mechanic
(`driver.*` in `src/data/strings.ts`).

## Sponsors (plan PR 9)

Unnamed for now: **a local sponsor**, **a regional sponsor** and **a works
deal** (`sponsor.*` in `src/data/strings.ts`). Privateers who bring prep
contracts are known by their race number.

## Still to name (later PRs)

Drivers, rival teams (still proposals), sponsors and parts makers, the crew
at the garage, privateer customers. The money and the raids are picked
(above). Each gets checked the same way and proposed to Kelbo first, before
1.0.
