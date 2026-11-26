# Offline play and graphics tiers (plan PR 12a)

## Offline play

After the first visit, Bump Stop opens with no signal: on a plane, at a
cabin, out on the lake ice.

- **The worker** is `src/pwa/sw.js`. The build (`bumpStopServiceWorker` in
  `vite.config.ts`) copies it to `dist/sw.js` with two lines in front: this
  build's cache name and the list of files to keep.
- **What it keeps** (`src/pwa/precache.ts`): every built file, the three
  zipped trucks included (about 600 KB together), so a truck you've never
  looked at still shows offline. Left out: the worker itself, `CNAME`,
  source maps and the older `.woff` fonts.
- **Cache names** start `bumpstop-` plus 10 characters of a hash of every
  kept file, so any change to the game makes a new cache. The worker only
  ever deletes caches that start `bumpstop-`: other Longlight games can
  share the address `jxstrr0.github.io`, and their offline copies are theirs.
  A test checks every delete sits behind that prefix check.
- **New versions never swap in mid-run.** When a new deploy is downloaded, a
  bar at the bottom says so: **Later** hides it, **Reload** saves the
  garage first (`garage.flush()`), then lets the new version take over.
  A long-open game checks for a new version at most once an hour, when it
  comes back to the front.
- **Escape hatch:** add `?nosw` to the address. It removes this game's
  worker and its caches (only `bumpstop-` ones) and runs straight from the
  network. Saves are never touched.
- The settings panel says whether this copy works offline: yes, getting
  ready (open once more), or not on this browser (private mode, say).
- The visit counter (Cloudflare Web Analytics) is never cached or touched.

Adapted from Laminar's offline worker.

## Graphics tiers

Three tiers, every number in `src/data/graphics.ts`:

| | Lite | Full | Ultra |
| --- | --- | --- | --- |
| Pixels per CSS pixel (most) | 1 | 2 | 3 |
| Smooth edges | off | on | on |
| Sun's shadow | off | 1024 map | 2048 map, softer edge |
| Tree rows each side | 1 | 3 | 4 |
| Dust | 40% | 100% | 140% |
| Road rows every | 15 cm | 10 cm | 7 cm |

Full is how the game looked before PR 12. The trucks are 35,000 to 50,000
triangles each since the Blender pass (PR 5c), and with the sun's shadow on
every truck is drawn twice (once for the shadow), so Lite turning the
shadow off is the biggest saving; drawing fewer pixels is the next.

**Auto** (`src/render/tiers.ts`) is the default. It starts from a guess:
Full on a phone, Lite on a phone with 2 GB of memory or less, Ultra on a
computer with 8 or more cores. While a 3D view is moving (the garage
turning, a rig run, a raid highlight), it measures the frame rate: after a
2-second warm-up, if the median over 4 seconds is under 45 frames a second,
it steps down one tier. It never steps back up on its own, and it remembers
where it ended up (`bumpstop.autoTier`) for next time.

The player can pick a tier on the settings panel (`bumpstop.graphics`);
Auto then stops measuring. Pixels, shadows, trees, dust and road change at
once; smooth edges are set when a 3D view is made, so they change the next
time the game opens (the panel says so).

`?tier=lite`, `?tier=full` or `?tier=ultra` in the address pins a tier for
one visit, for testing.
