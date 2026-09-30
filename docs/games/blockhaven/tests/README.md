# Blockhaven checks

Run the same checks as CI (`.github/workflows/blockhaven.yml`) from the repo root, with Node 22:

    node docs/games/blockhaven/tools/stamp.mjs --check                 # every import carries the same ?v= stamp
    node --test 'docs/games/blockhaven/tests/*.test.mjs'               # unit tests (node:test, no dependencies)

Before pushing any change to `js/` or `index.html`, run `node docs/games/blockhaven/tools/stamp.mjs` (no flag). It restamps every import so players never mix cached and fresh modules. Commit the result.
