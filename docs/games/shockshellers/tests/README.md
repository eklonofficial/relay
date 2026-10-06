# Shock Shellers checks

Deploy only `build/games/` (from `npm run build:site`); see `../SECURITY.md`. Browser captures go to `build/checks/shockshellers/`.

From the repository root:

    node docs/games/shockshellers/tools/stamp.mjs --check              # every import carries the same ?v= stamp; CSP hashes in sync
    node --test 'docs/games/shockshellers/tests/*.test.mjs'           # unit tests (node:test, no dependencies)
    npm run build:site                                                # packs the calculator and every calculator game
    npm run test:browser:shockshellers                                # compositor fixture + packed-site browser check
    npm run test:relay                                                # includes a real-relay multiplayer join (needs blockhaven-relay deps)

What the unit tests cover:

- `sim.test.mjs`: movement, jumps, stairs and ladders, hit-angle damage, bloom recovery, reload timings, bursts, grenade charge, projectile flight, spawn shield, regeneration, streak power-ups, pickups, explosions and determinism, all against the GDD's numbers.
- `bots.test.mjs`: nav coverage, fights without idling, skill deciding outcomes, skill ranges and per-bot variety, spatula play, and situational hopping.
- `render.test.mjs`: the Auto Detail ladder (drops after two seconds under 45 fps, never climbs back above a rung it left), the quality rungs (each costs at least the one below; Low has no bloom, MSAA, extra lights or reflections; nothing renders above 1.5 device pixels per CSS pixel), dynamic resolution within a rung, the GPU tiers that pick the starting rung (software rendering and Chromebooks start low), iron sights landing on the eye line, the hip pose converging on the crosshair, and the first-person springs settling without ringing.
- `feel.test.mjs`: aim assist (only near the crosshair, only on visible enemies, friction capped, tracking only part of a target's drift and only while the player is giving input; on by default for Chromebooks and gamepads), the cosmetics catalogue (every pattern, stamp, hat and gun skin the shop offers can be drawn; unknown values from the network fall back to defaults; bots wear free items) and every gun's attachment points.
- `conformance.test.mjs`: the compositor, quick-hide, dialogs, sealed channel, transport and Link stay identical to Blockhaven's; no globals on `window`; storage namespaced to `shockshellers`.
- `security.test.mjs` and `stamp.test.mjs`: CSP generation and cache stamps, as in Blockhaven.

Before pushing any change to `js/` or `index.html`, run `node docs/games/shockshellers/tools/stamp.mjs` (no flag) and commit the result. The same command synchronizes the CSP hashes in `index.html`, the shared `../calc.html` and the shared `../vercel.json`.

Debugging in the browser: F3 shows position, facing, tick, players, FPS and ping, ammo and whether aim assist is on a target, plus the graphics rung with its current resolution, the GPU tier, draw calls (shadow pass included) and triangles. (The ammo count, frame rate and ping are drawn in the 3D canvas, so `tools/browser-check.mjs` reads the ammo from F3.)
