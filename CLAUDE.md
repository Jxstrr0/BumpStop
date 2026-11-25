# CLAUDE.md: Bump Stop

A Longlight Interactive game. A rally-raid truck builder: build the truck,
run it on the test track until the suspension gives up, read why, tune it,
then send it into a multi-day raid where damage stacks from stage to stage.

- **Plan of record:** `docs/BUMP-STOP-PLAN.md`. Work through its Staged PRs
  (0 to 13) in order. Don't start a later PR's features early.
- **Progress:** `docs/STATUS.md`. Add a line in every PR.
- **Names:** `docs/NAMES.md` and section 8 of `.github/LONGLIGHT-STUDIO.md`
  before inventing any name.
- This file wins over the plan and the studio catalogue where they disagree.

## Working with Kelbo

- Use the name Kelbo only. No real name, initials or email anywhere in the
  repo, a commit, a PR or a log.
- Kelbo is a beginner-plus coder who tests on his phone from the live site.
  End every task with a plain-language summary and how to test it on a phone.
- Canadian spelling in everything players and Kelbo read: colour, centre,
  metre, tire, defence, organize.
- Branch, PR, merge when the **deploy** check passes: squash merge on green
  is fine. Never push to `main`. Keep each PR small enough to read on a
  phone; split a plan PR into parts (1a, 1b…).
- The plan pitches; Kelbo decides. Ask when unsure about a real design question.
- Commits are authored as Kelbo's GitHub account: `git config user.name "Jxstrr0"`,
  `git config user.email "322161611+Jxstrr0@users.noreply.github.com"`.
- **Anything that costs money needs a quote and Kelbo's explicit yes first,
  every time.** Never retry a paid generation in a loop.

## Decisions (Kelbo, 25 November 2026)

- Name **Bump Stop**. Repo `Jxstrr0/BumpStop`.
- **Three classes from day one:** light 4x4, heavy truck and side-by-side
  (all in from plan PR 3).
- **An English-flavoured north** for the made-up country (not Finnish). The
  proposed names in `docs/NAMES.md` still wait on Kelbo's OK.
- Address **`https://bumpstop.longlight.games/`**, approved for the studio
  DNS file. Chosen in PR 0 and **never to move** (a new address strands
  players' saves).
- Still open, using the plan's defaults until Kelbo says otherwise: a
  made-up northern country with summer and winter raids; the era 1985 to
  2025; a hired driver while you call the pace; a raid calendar of about six
  raids a year.
- **Design and watch only**, no steering. **Nobody gets hurt:** trucks
  break and stop; crews are always fine.

## Stack (fixed; ask before changing)

- TypeScript (strict), Vite (`base: './'`), three.js from npm (0.187) in its
  own chunk. UI is plain DOM and CSS. No framework. Copied from Mainline.
- Vitest for the sim. ESLint plus `tsc`.
- Hosting: GitHub Pages from Actions.
- No backend, accounts, ads or API keys. No analytics except the cookieless
  Cloudflare Web Analytics beacon at the end of `index.html`, which counts
  visits and load speed like every Longlight game. It shares Scrapline's Web
  Analytics site; visits are told apart by address.

## Folders

```
src/sim/      pure maths: ride model, ground, heat, wear, raids   (PR 1+)
src/data/     every tuning number and all player-facing text
src/render/   three.js scenes            (PR 5)
src/ui/       DOM screens, traces, the report
src/audio/    engine voice and hits      (PR 6)
src/persist/  saves, save code, safety   (PR 8)
scripts/      bundle check, release title, harnesses
tests/        Vitest tests
docs/         the plan, NAMES.md, STATUS.md
```

## Rules for the sim

- `src/sim/` and `src/data/` import nothing from three.js, the DOM, `render`,
  `ui`, `audio` or `persist`. ESLint enforces it.
- No `Math.random`, `Date.now` or `performance.now` in the sim. Seeded RNG
  only (`src/sim/rng.ts`; `rng.fork('name')` for a named stream per system).
- No `Math.sin`, `Math.exp`, `Math.pow` and friends in the sim: use
  `src/sim/det.ts`. `tests/simPurity.test.ts` scans for all of these.
- Every tuning number lives in a table in `src/data/`, never inline.
- SI units inside the sim (kg, m, s, N, W, J, K); convert only for display.
- A fixed time step (the ride model runs at 500 Hz). Long stages run full
  detail on sample sections and scale heat and wear between them.
- Every failure gets a cause the player can read in a trace and a "where to
  fix it" jump. Fade comes out of the damper heat physics, never a dice roll.
- Player-facing text lives in `src/data/strings.ts`.

## Look ("Roadbook"; proposed in the plan, Kelbo confirms)

A rally roadbook: paper strips with tulip diagrams, distances and pencil
notes. Light first, with a dark "night stage" mode that follows the phone.
Every colour is a CSS variable at the top of `src/style.css`.

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#F4F1E8` (birch paper) | `#17181B` |
| `--panel` / `--panel-2` | `#FBFAF5` / `#ECE8DC` | `#202125` / `#292A2F` |
| `--line` | `#D4CEBF` | `#3A3B41` |
| `--ink` / `--muted` | `#25272B` (graphite) / `#5B5D61` | `#ECE9E1` / `#A9A69F` |
| `--accent` (highlighter fill, ink text on it) | `#FF4FB2` | `#FF5CBF` |
| `--accent-text` | `#C2127A` | `#FF5CBF` |
| `--cool` / `--warm` / `--hot` | `#1F65A8` / `#9A5B00` / `#C0262D` | `#6FB3EE` / `#F0AE45` / `#FF6E6E` |

- **The trace rule, everywhere:** cool blue for normal, amber for warm, red
  for over the limit, always with a word too (the chips say Normal, Warm,
  Over the limit). Colour is never the only signal.
- Fonts, self-hosted from `@fontsource`: **Big Shoulders** (headings) and
  **Overpass Mono** (numbers). Body text uses the phone's own font. No other
  Longlight game uses Big Shoulders, Overpass Mono or magenta.
- Text colours pass 4.5:1 on the paper and panels in both modes.
- Phone first, portrait first, one thumb. Works down to 360 px wide. Tap
  targets at least 44 px.

## Versions

- Four numbers, Major.Minor.Patch.Build, in the root `VERSION` file.
  `vite.config.ts` reads it and the build fails if it isn't four numbers.
- Shown in the footer as `v0.1.0.0 · <sha> · <date>`.
- Bump `VERSION` in the PR that makes the change, and add a line to `docs/STATUS.md`.
- Title each PR `PR <n>: <summary> — v<version>`: `publish-release.yml`
  makes a GitHub Release from it when `VERSION` changes on `main`, and the
  studio site reads that.
- `package.json` keeps its own three-part number; players never see it.

## Storage (from plan PR 8)

- localStorage keys start `bumpstop.`; IndexedDB database `bumpstop` (three
  slots); cache names start `bumpstop-`; save code `BMP1:`; truck build codes
  `BMPT1:`; backup file `bump-stop-backup-YYYY-MM-DD.txt`. All checked free
  in studio section 5 on 25 November 2026.
- Never clear or delete anything outside those prefixes. No `localStorage.clear()`.
- Players' save codes are their personal data: decode them locally only.

## Branding

Bump Stop keeps its own look. The Longlight brand applies only to studio
pieces: the loading splash, the credit line, the studio link and the studio
block on a credits screen.

- Logo: the official files in `public/brand/`. Never redraw, recolour or
  replace the letters with live text.
- Studio colours: clay `#D97757`, purple `#7B3FC4`, slate `#141413`, ivory
  `#FAF9F5`, lilac `#B48CE8`. Studio font: Space Grotesk, self-hosted.
- Always "Longlight Interactive" in full. Credit line:
  `© 2026 Kelbo / Longlight Interactive`. Studio link: https://longlight.games/

## Content rules

- Fictional people, teams, sponsors, parts makers, raids and places. Real
  suspension terms used as they are (compression, rebound, bottoming,
  bypass, unsprung mass). No real raids, brands or places.
- Add every new name to `docs/NAMES.md` and propose it to Kelbo first.
- Copied code gets `// Adapted from <Repo> <path> (<date>)`. Never import
  across repos or hotlink. Never change another Longlight repo.
- CC0 and CC BY assets only; every third-party file gets a line in `CREDITS.md`.

## Commands

- `npm run dev`: Vite dev server
- `npm run lint`: ESLint and type check
- `npm run test`: Vitest
- `npm run build`: production build to `dist/`, then the first-load budget check (15 MiB)

The PR check is the `deploy` workflow: lint, test, build. Merging to `main`
publishes to Pages.

## Studio catalogue

`.github/LONGLIGHT-STUDIO.md` covers every Longlight game. Don't edit the
copy here; the master lives in `Jxstrr0/Kelbo.Website`.
