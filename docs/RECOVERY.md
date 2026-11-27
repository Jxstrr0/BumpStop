# Getting stuck and the recovery kit

Kelbo picked it on 27 November 2026: a winch, traction boards and a jack that
get the truck unstuck instead of losing the stage, at the price of weight.

## Getting stuck

On a raid stage the truck can get stuck with nothing broken
(`src/sim/recovery.ts`, numbers in `src/data/recovery.ts`):

- **Bogged** in soft snow, in a whiteout's drifts, or in the gravel a thaw
  has softened. A heavier truck bogs more often (weight squared) and sinks
  deeper; lower tire pressure spreads the weight and bogs less. The heavy
  truck sinks most, the side-by-side floats.
- **Hung up** on rocks (and now and then on whoops, jumps and frost heaves).
  A truck riding low hangs up far more often (the same ride-height factor as
  the underside hits).
- Push gets stuck more often and deeper, Conserve less.

Each time has a **depth** from 0 to 1 (most are shallow). The crew uses the
quickest tool that reaches that deep:

| Tool | Bogged reach | Hung-up reach | Minutes at depth 0.5 (light 4x4) |
| --- | --- | --- | --- |
| Shovel (every truck) | 0.35 | 0.35 | 40 |
| Traction boards | 0.75 | 0.5 | 22 (nylon 16.5) |
| High-lift jack | 0.55 | 0.8 | 20 |
| Winch | 1 | 1 | 12 (rope 9.6) |

Times scale with depth, the class's work and the driver's fix time. If
nothing on the truck reaches, the crew waits for the **sweep truck**, which
tows it out: the stage counts as lost (closing time plus the late penalty,
like running out of time), and the crew has 3 hours less at that night's
bivouac. The driver eases off after each time stuck, like any stop.

The kit also gets a slid truck out of a snowbank quicker (12 minutes on
boards, 8 with a winch, 20 with the shovel as before), and a high-lift jack
makes roadside tire, shock and CV swaps take 85% of the time.

## The parts

A new part slot, **Recovery kit**, after Spares. Stock is "Shovel only"
(nothing, no weight), so old saves, build codes and every stock balance
test are unchanged.

| Part | Year | Light 4x4 kg / cr. | Has |
| --- | --- | --- | --- |
| Shovel only | 1985 | 0 / 0 | shovel |
| Sand ladders | 1985 | 22 / 600 | steel boards |
| Sand ladders and high-lift jack | 1985 | 37 / 1,100 | steel boards, jack |
| Winch, ladders and jack | 1985 | 75 / 3,200 | cable winch, steel boards, jack |
| Recovery boards and jack | 2005 | 26 / 1,700 | nylon boards, jack |
| Rope winch, boards and jack | 2005 | 52 / 5,600 | rope winch, nylon boards, jack |

The weight rides where it's carried (weight and balance, `docs/LOAD.md`):
the winch on the front bumper, the boards and the jack at the back.

On the 3D trucks: the winch sits in front of the bumper (light 4x4, under
the bull bar), under the bumper (heavy truck) or behind the bumper hoop
(side-by-side); steel ladders are grey, nylon boards orange; the boards go
on the bed's left side (light 4x4), both sides of the box (heavy truck, where
its always-on sand ladders used to be) or the roof (side-by-side), with the
red high-lift jack beside them.

## How often

From the stock trucks at Steady, clear weather: a summer stage gets a truck
stuck about one time in twenty, a winter stage about one in seven. With only
the shovel about half of those need the sweep truck, so a 5-stage summer
raid tows a truck with no kit out of a stage about one time in seven, and
the 4-stage winter raid about one in four. Sand ladders and a jack leave
about a third as many tows; a winch none.

## Where it shows

- The entry card (free play and career) says how often the raid gets the
  truck stuck and how many tows the kit (or the shovel) would leave.
- The morning card gives today's chance, and says if the forecast thaw or
  whiteout would soften the ground.
- Stops: "km 42.1: bogged down, properly stuck. Out on the traction boards.
  18 min lost." or the sweep truck's tow. The results jump to the Recovery
  kit slot after a tow or a shovel dig.
- The bivouac says when the sweep truck cut the night short.
- The logbook keeps "bogged down, out with the winch" or "towed out by the
  sweep truck"; a bog leaves mud (summer) or snow (winter) on the truck.
- The glossary has Recovery kit and Sweep truck; the slot has an "i" note.
