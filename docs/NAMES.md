# Bump Stop: names

**Status: proposed in PR 0.** Kelbo picked an English-flavoured north on
25 November 2026 (over two Finnish-flavoured options); the names below are
proposals in that style. **Birchland** is settled. Kelbo **turned down the
antler and the raid names** below; new ones are still to pick, so the game
uses plain working names for now (see each section). Propose any new name
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
| Money | ~~the antler~~ (turned down; still shown on the build screen until a new name is picked) | the tally |

The money is written out in full rather than as a symbol, because the short
forms clash with things the game already shows (h for hours at the
bivouac, hp for engine power, M for millions).

## Places

| What | Name | Notes |
| --- | --- | --- |
| Capital, on the southern lakes | **Larchport** | A lake port: ferries in summer, an ice road in winter. The Frostbite 300 starts here. |
| The big lake that freezes | **Great Larch Lake** | The Long Night Raid crosses it on the ice road |
| Logging town in the middle of the country | **Sawbuck** | Mill town and base of the Esker Run; the career's garage is here |
| Mining town in the north | **Gritstone** | Rock gardens and haul roads |
| Settlement on the tundra, the far end of the country | **Ptarmigan Point** | Where the Traverse finishes |

## Raids

**Turned down.** The game uses working names until new ones are picked:
**Summer Sprint** (3 stages) and **Summer Raid** (5 stages), in
`raid.*.name` in `src/data/strings.ts` (plan PR 7). Stages are described,
not named ("Logging roads", "Rock country", "The old burn", "Eskers and
washboard", "Hot haul roads"). The first proposals, for the record:

| Plan's working name | Proposed name (turned down) | Shape |
| --- | --- | --- |
| Regional winter raid (career start) | **the Frostbite 300** | 3 stages around Larchport, winter, about 300 km |
| Summer gravel raid | **the Esker Run** | 4 to 5 stages from Sawbuck along the eskers, summer |
| National raid, winter | **the Long Night Raid** | 6 to 8 stages, frozen lakes and ice roads in the dark weeks of winter |
| National raid, summer | **the Muskeg 800** | 6 to 8 stages, bog, gravel and rock, about 800 km |
| The long one (the finale) | **the Birchland Traverse**, which everyone calls **the Long One** | Two weeks, Larchport to Ptarmigan Point |

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

## Still to name (later PRs)

The money and the raids (above), drivers, sponsors and parts makers (plan
PR 3 and PR 9), the crew at the garage, privateer customers. Each gets
checked the same way and proposed to Kelbo first.
