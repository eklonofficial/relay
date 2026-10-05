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
- `conformance.test.mjs`: the compositor, quick-hide, dialogs, sealed channel, transport and Link stay identical to Blockhaven's; no globals on `window`; storage namespaced to `shockshellers`.
- `security.test.mjs` and `stamp.test.mjs`: CSP generation and cache stamps, as in Blockhaven.

Before pushing any change to `js/` or `index.html`, run `node docs/games/shockshellers/tools/stamp.mjs` (no flag) and commit the result. The same command synchronizes the CSP hashes in `index.html`, the shared `../calc.html` and the shared `../vercel.json`.

Debugging in the browser: F3 shows position, facing, tick, players, FPS and ping.
