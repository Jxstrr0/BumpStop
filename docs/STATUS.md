# Bump Stop: status

The plan of record is `docs/BUMP-STOP-PLAN.md`. Each PR adds a line here.

| PR | Version | What changed |
| --- | --- | --- |
| 0 | 0.1.0.0 | Repo scaffold copied from Mainline (TypeScript, Vite, three.js 0.187, Vitest, ESLint with the `src/sim/` bans), the deploy check and Pages deploy, release publishing, Dependabot, loading screen with the Longlight logo and © line, a one-screen preview of the proposed "Roadbook" look (Big Shoulders and Overpass Mono, self-hosted; magenta highlighter; the cool, warm, hot trace rule), the three classes as data, seeded RNG and deterministic maths, the plan in `docs/`, proposed names in `docs/NAMES.md` (English-flavoured north, Kelbo's pick). |
| 1 | 0.2.0.0 | Ride sim: the seven-part truck model (bounce, pitch, roll and four wheels) at 500 Hz, with springs, progressive bump stops, limit straps, anti-roll bars and tires that can leave the ground; a test mule for each class; seeded ground recipes (graded, washboard, whoops, rocks, jumps, frost heaves); damper heat from the damper's own work, fade from hot oil and foaming, stiff cold oil; long stages from full-detail samples plus exact heating and cooling in between (a 300 km stage in about half a second); tests for determinism, save-and-carry-on, energy, sampling against full detail, and the purity bans (now also any `Date` and `crypto`). The preview page's sample trace is now a live test stage you can run for each class. How it works: `docs/RIDE-SIM.md`. |
