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
- Colours: the top of `src/style.css`.
- The plan: `docs/BUMP-STOP-PLAN.md`. Where it's up to: `docs/STATUS.md`.
- Names: `docs/NAMES.md`.

Every change goes on a branch and a pull request. The **deploy** check runs
lint, tests and a build; when it's green, merging publishes the game.

## On a computer

```
npm ci
npm run dev     # play it locally
npm run test    # run the tests
npm run build   # build what goes live
```

© 2026 Kelbo / [Longlight Interactive](https://longlight.games/)
