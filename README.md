# Bump Stop

A Longlight Interactive game: build a rally truck, find the speed where it
breaks, then go racing. Build it, break it on the test track, read why,
tune it, and send it into a multi-day raid where damage stacks up.

Live at https://bumpstop.longlight.games/ (once the address is set up).

## Editing on your phone

- Words players read: `src/data/strings.ts`.
- The three classes and their weight limits: `src/data/classes.ts`.
- The ride sim's numbers (test trucks, damper heat, long stages):
  `src/data/ride.ts`. The ground recipes: `src/data/ground.ts`. How the sim
  works, in plain words: `docs/RIDE-SIM.md`.
- How strong the test trucks' parts are, and how wear adds up:
  `src/data/wear.ts`. What each failure is called and where to fix it:
  `src/data/failures.ts`. The balance bot's checks: `src/data/balance.ts`.
  In plain words: `docs/WEAR.md`.
- The shop's three rigs (and how fast they play on screen):
  `src/data/rigs.ts`. The crew chief's notes and the report's words:
  `src/data/strings.ts`. In plain words: `docs/RIGS.md`.
- The 3D trucks and every part you can bolt on: `scripts/blender/make-trucks.py`
  builds them (sizes, colours, bodies, parts) into `public/models/`. Run it again after a change; how
  is at the top of the script and in `docs/3D.md`.
- How it sounds (engine voices, gears, how loud each sound is, the buzz
  patterns): `src/data/sound.ts`. In plain words: `docs/SOUND.md`.
- Raids (Steady speeds per ground, pace calls, drivers, roadside fixes,
  bivouac jobs, the raids' stages and the rival entries):
  `src/data/raids.ts`. Raid, driver and team names: `src/data/strings.ts`.
  In plain words: `docs/RAIDS.md`.
- The career (calendar, money, prize money, contracts, reputation,
  sponsors, the shop's upgrades, the rival teams and their habits):
  `src/data/career.ts`. In plain words: `docs/CAREER.md`.
- Graphics tiers (Lite, Full, Ultra: pixels, shadows, trees, dust, road
  detail, and when Auto steps down): `src/data/graphics.ts`. Offline play
  and graphics in plain words: `docs/OFFLINE.md`. If the game ever acts
  stale, open it with `?nosw` on the end of the address.
- Colours: the top of `src/style.css`.
- The plan: `docs/BUMP-STOP-PLAN.md`. Where it's up to: `docs/STATUS.md`.
- Names: `docs/NAMES.md`.

Every change goes on a branch and a pull request. The **deploy** check runs
lint, tests (including the balance bot) and a build; when it's green,
merging publishes the game. The balance bot's results are in each run's
summary on the Actions tab.

## On a computer

```
npm ci
npm run dev     # play it locally
npm run test    # run the tests
npm run build   # build what goes live
```

© 2026 Kelbo / [Longlight Interactive](https://longlight.games/)
