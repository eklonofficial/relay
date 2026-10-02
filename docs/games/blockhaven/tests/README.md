# Blockhaven checks

Install repository-root tooling with `npm ci`, run `npm run build`, then `npm run test:browser`.
Windows uses installed Edge; other platforms use Playwright Chromium (`npx playwright install chromium`).
Deploy only `build/site/`; see `../SECURITY.md`. Browser captures go to `build/checks/`.

The browser suite first compares canvas output against native rendering of the
same UI fixture, including a rotated label, bordered panel, text input and
percentage-sized crosshair. It checks click-through and keyboard focus too.
The full application checks actual walking displacement and camera direction;
relative mouse samples are injected through the locked canvas because headless
absolute mouse injection can produce net-zero pointer-lock recenter events.
Run the lightweight fixture in Firefox with
`SURFACE_BROWSER=firefox node docs/games/blockhaven/tools/surface-check.mjs`.

Browser checks verify calculator title/icon metadata, public text, controls, added nodes and attributes. They also deliberately demonstrate privileged inspection through early shadow capture, debugger access, canvas text hooks and bundle decompression. Those assertions document remaining exposure; they do not claim malicious extensions are blocked. Test instrumentation is excluded from production.

Run the same checks as CI (`.github/workflows/blockhaven.yml`) from the repo root, with Node 22:

    node docs/games/blockhaven/tools/stamp.mjs --check                 # every import carries the same ?v= stamp
    node --test 'docs/games/blockhaven/tests/*.test.mjs'               # unit tests (node:test, no dependencies)

Before pushing any change to `js/` or `index.html`, run `node docs/games/blockhaven/tools/stamp.mjs` (no flag). It restamps every import so players never mix cached and fresh modules. Commit the result.

The same command synchronizes CSP hashes in `index.html`, `calc.html`, and Vercel response headers.
Run it after changing either page's inline scripts too. CI's `--check` rejects stale policies.
See `SECURITY.md` for the protections, compatibility allowances, and compromised-device limits.
