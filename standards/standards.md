# Calculator-launched games: the standard

Attach this file when asking an AI to build or change a game on this site. Every game launched
through the graphing calculator must follow it, so that many games can live side by side on one
origin without colliding, and every game has the same canvas rendering, packing, privacy limits and
checks as **Blockhaven**, the reference implementation (`docs/games/blockhaven/`).

When this document and Blockhaven disagree, Blockhaven's current code wins. Read the referenced
Blockhaven files before you write the matching file for a new game. Don't work from memory of how
the pattern "usually" goes.

**Copy, don't reinvent.** Blockhaven's compositor, packing, security and multiplayer code reached
its current shape through a lot of trial and error, and not every reason it works is understood.
Copy those files and change only names, slugs and game logic. When something in a new game breaks,
first make it *more* like Blockhaven before trying anything clever.

Words used below:

- **`<slug>`**: the game's folder and namespace name. Lowercase letters and digits only, for
  example `blockhaven` or `tilerush`. It must be unique under `docs/games/`.
- **Source tree**: `docs/games/<slug>/` as committed. It's readable and is used only for development.
- **Production output**: what `tools/build.mjs` writes. It's the only thing that gets deployed.
- **Compositor**: `js/surface.js`. It paints the game's HTML interface into one canvas.

---

## 1. What every game must be

1. **A calculator from the outside.** The tab title is `Graphing Calculator` and the icon is the
   calculator's blue curve icon. This is true from the first byte of HTML, while loading, during
   play and after quick-hide. **One calculator serves every game**: the site root (`/`) serves the
   shared calculator `docs/games/calc.html`, and each game opens only when someone types *that
   game's* secret expression into it and presses Enter.
2. **A canvas interface.** Everything visible is pixels in a `<canvas>`: menus, HUD, dialogs, text
   and tooltips. The public DOM holds no readable text, no controls and no attributes carrying game
   content. The real HTML interface exists only inside a **closed shadow root** at opacity 0, where
   it handles focus, keyboard, IME, paste, file pickers and accessibility. The compositor paints it.
3. **Packed for production.** Production is a tiny neutral HTML shell plus one content-addressed,
   gzip-compressed `.bin` per page. A hashed bootstrap verifies the `.bin`'s SHA-256 before running
   it. There are no readable modules, separate asset URLs, source maps, tests or debug pages in the
   deployment.
4. **Locked down by CSP.** Every page has an early `<meta>` Content-Security-Policy that pins its
   inline scripts by hash. `no-referrer` is set. There are no inline handlers, `eval`, remote
   scripts, CDNs, analytics or remote fonts.
5. **Quick-hide.** Pressing `J` swaps the game for the calculator instantly, in the same tab. Typing
   the secret into that calculator and pressing Enter resumes the game.
6. **Honest about its limits.** The game ships a `SECURITY.md` that states the same boundaries as
   Blockhaven's. These measures reduce exposure to ordinary DOM observers and passive traffic
   inspection. They do **not** defeat privileged extensions, debuggers, injected scripts, TLS
   interception, endpoint agents or screen viewing. Never claim otherwise in code comments, docs,
   commit messages or UI.

---

## 2. Folder layout

Each game is self-contained. One game never imports from, writes to or depends on another game's
folder at runtime. The only shared runtime piece is the calculator, which lives beside the games:

```
docs/games/
  calc.html           THE calculator for every game; its GAMES table maps each secret to a game (section 4)
  vercel.json         root route -> calc.html plus security headers for the whole site (generated, section 7)
  tools/security.mjs  shared CSP policy + calculator/vercel.json sync (each game's security.mjs uses it)
  tools/build.mjs     packs every game, then the calculator, into build/games/ (section 6)
  tests/calc.test.mjs secrets unique, each opens an existing game, no per-game calculators (section 9)
```

Each game's source tree mirrors Blockhaven:

```
docs/games/<slug>/
  index.html          dev source page: one <style>, the interface markup, then <script type="module" src="js/main.js?v=...">
  SECURITY.md         Blockhaven's SECURITY.md with names and paths changed (section 10)
  js/
    main.js           entry: imports './page.js' FIRST, then the rest; calls registerApp(app) last
    page.js           dev adapter that mounts index.html's markup and CSS into the compositor
    surface.js        compositor: a VERBATIM copy of Blockhaven's js/surface.js
    veil.js           quick-hide: Blockhaven's js/veil.js, unchanged apart from import stamps
    dialog.js         canvas-rendered ask()/tell(): Blockhaven's js/dialog.js
    ...               the game's own modules (any sub-folders)
  fonts/  assets/  vendor/      bundled resources, each with its LICENSE file
  tools/
    build.mjs         packs production (section 6)
    stamp.mjs         cache-busting ?v= stamps plus CSP sync (section 7)
    security.mjs      CSP generation for index.html, then the shared sync: a copy of Blockhaven's
    surface-check.mjs compositor vs. native rendering fixture (section 9)
    browser-check.mjs end-to-end checks against the packed output (section 9)
  tests/
    *.test.mjs        node:test unit tests, no dependencies
    security.test.mjs Blockhaven's, adapted to the slug
    conformance.test.mjs   required: shared files stay identical to Blockhaven's (section 9)
    README.md         how to run the checks
```

Development-only pages such as Blockhaven's `devtest.html` are allowed in the source tree. They must
never be copied into the production output.

---

## 3. Namespacing: how games avoid colliding

All games are served from **one origin** (GitHub Pages, `…/games/<slug>/`). Everything that is
per-origin is therefore shared between games and must be namespaced by slug:

| Shared thing | Rule | Blockhaven's values |
| --- | --- | --- |
| `localStorage` / `sessionStorage` keys | Prefix `<slug>.`; version the key if its format changes. Never call `.clear()`. Never read or remove keys you don't own. | `blockhaven.settings.v2`, `blockhaven.net` |
| IndexedDB database names | `<slug>` or `<slug>-<purpose>`. Never `deleteDatabase` anything else. | `blockhaven`, `blockhaven-packs` |
| Cache Storage, BroadcastChannel and lock names | `<slug>-<purpose>` | none |
| Multiplayer room, peer or topic prefixes | `<slug>-v<n>-`, `<slug>/v<n>` | `blockhaven-v1-`, `blockhaven/v1` |
| Downloaded and imported file extensions | `.<slug-ish>` such as `.bhworld`. Unique per game. | `.bhworld` |
| Font family names in packed CSS | Renamed to short opaque names at build time; unique only within the game's own bundle | `Minecraft` → `p`, `Pixelify Sans` → `q` |
| Globals on `window` | **None.** Don't publish the app (`window.<slug>`), state or helpers. Keep the app object module-local. | `registerApp(app)`; never `window.blockhaven` |
| Custom elements, global CSS class names | None in the public document. Everything lives in the closed shadow tree. | none |
| `npm` scripts in the root `package.json` | `build:<slug>`, `test:<slug>`, `test:browser:<slug>`. Don't change Blockhaven's unsuffixed `build`, `test` and `test:browser`. | unsuffixed (legacy) |
| Build output directory | `build/games/<slug>/`, chosen with `--out` | `build/games/blockhaven/` |
| Browser-check captures | `build/checks/<slug>/` | `build/checks/` (legacy) |

Once a storage key, database name or file format has shipped, keep it. Players' saves depend on it.
Add migrations instead of renaming.

---

## 4. The calculator and the secret expression

`docs/games/calc.html` is a working graphing calculator: expressions, sliders, implicit curves, pan
and zoom, undo, settings and help. It is the cover page **and** the launcher for **every** game.
There is one calculator and one website; games do not have their own `calc.html`.

- **All secrets live in one line**: `const GAMES = { '<secret>': '<slug>', ... };` in
  `docs/games/calc.html`. Adding a game means adding one entry. Don't write a secret anywhere else:
  not in game code, tests, tools, docs, comments, commit messages or this file. Ask the owner what
  the secret should be.
- Anything else that needs a secret reads it from that table at run time. For example, a browser
  check parses `GAMES` and picks the entry whose value is its own slug, then types that key.
- Input is compared after `toLowerCase()` and stripping whitespace and `*`; table keys are stored
  already normalised. A secret must look like ordinary calculator input and be unique.
  `docs/games/tests/calc.test.mjs` enforces this and that every slug has a `docs/games/<slug>/index.html`.
- Not embedded: Enter on a secret fades to black and navigates to `<slug>/index.html`.
- Embedded (a game's quick-hide): Enter removes the secret row. If the secret is the embedding
  game's own (the parent page's folder), it posts `{ bh: 'resume' }`; otherwise it posts
  `{ bh: 'open', game: '<slug>' }` and the game's `veil.js` navigates to `../<slug>/index.html`.
  The `bh` key, the `show`/`resume` contract and the exact origin and source checks are unchanged.
- Everything else in the calculator (markup, CSS, math, the `launch()` veil transition) is shared:
  change it once, for every game, and run every game's browser checks.

### Quick-hide (`js/veil.js`)

Copy Blockhaven's `veil.js`. It creates a hidden full-window `<iframe src="../calc.html">` on load.
Pressing `J` (no modifiers, not repeating, and not while a text field has focus) does the following:

- shows the iframe;
- sets the title and icon to the calculator's;
- exits pointer lock;
- clears held keys;
- suspends audio;
- focuses the calculator.

`resume` from that iframe restores everything; `open` switches to another game in the same tab.
The game provides the app object it expects:

```js
registerApp({
  keys,                 // anything with .clear(): held-key state, cleared so nothing stays pressed
  sound: { ctx },       // the game's AudioContext (optional); suspended while hidden, resumed after
  /* ...the rest of the app stays private... */
});
```

Call `registerApp` once, at the end of `main.js`. Don't add a second hide key, and don't change `J`.
Every game behaves the same way.

---

## 5. Rendering: the compositor contract

`js/surface.js` is shared infrastructure. **Copy it verbatim and don't fork it.** If a game needs a
compositor fix, make the fix in Blockhaven's copy first, check it against Blockhaven's browser
suite, and then copy the file to every game. The conformance test (section 9) enforces this.

How it works, so you can write a game that suits it:

- `js/page.js` (dev) or the build's replacement (production) calls `mount(markup, css)`. The
  markup is parsed into a `<template>` *before* it's connected, so document observers never see
  it. It goes inside a closed shadow root at opacity 0. `:root` and `html, body` in the CSS are
  rewritten to the host and the layout. `@font-face` rules are loaded through the `FontFace` API.
- One `<canvas>` above the layout gets everything painted into it whenever something changed. A
  MutationObserver plus input, focus and scroll events set `dirty`. When only CSS animations, a
  caret or opacity changed, just their area is repainted.
- **`<canvas id="game">`** is special. It's moved *out* of the shadow tree into the real body, so
  pointer lock, raw input and WebGL work natively. Put your 3D or 2D world there. Interface
  overlays go in the markup.
- `<div id="boot">` is also kept outside the layout, for a startup splash.
- `title="..."` attributes are captured and removed. The compositor paints them as delayed hover
  tooltips, so the text never sits in an attribute.

### Rules for game code

1. **Use the facade document.** Every module that touches the interface imports
   `import { surfaceDocument as document } from './surface.js?v=...';`. Use `globalThis.document`
   only for what must be native: `title`, the icon `<link>`, `requestFullscreen` on
   `documentElement`, `exitPointerLock`. Never put game text into the native document.
2. **Use what the compositor can paint.** It paints:
   - block boxes with backgrounds, borders, `border-radius`, `box-shadow`, gradients, `url()`
     images, masks and `border-image` (complex visuals are rasterised once through SVG
     `foreignObject` and cached);
   - text nodes (with wrapping, `text-shadow`, `letter-spacing` and transforms);
   - `<img>`, `<canvas>` and inline `<svg>`;
   - `<input>` and `<textarea>` text, placeholder, selection and caret;
   - checkboxes;
   - `::before` and `::after` boxes;
   - opacity, transforms, `z-index`, `overflow` clipping and scrollbars, `filter`, `mix-blend-mode`.

   It does **not** paint `<select>`, `<video>`, native range sliders (draw your own face, as
   Blockhaven does), iframes, or text in pseudo-element `content`. Don't use them. If you need
   something new, extend the compositor in Blockhaven first (see above).
3. **No native browser UI with text.** Don't use `alert`, `confirm` or `prompt`. Use `ask()` and
   `tell()` from `js/dialog.js`. File pickers and downloads stay native. That's expected and
   documented.
4. **Don't change the DOM every frame.** Each DOM change makes a full repaint. Update HUD text only
   when its value changes. Draw per-frame things (crosshair motion, particles, minimaps) in the game
   canvas or a `<canvas>` inside the layout. Run CSS animations only while their element
   is shown. An animation on an element hidden only by `opacity: 0` keeps running and forces
   repaints forever.
5. **Never draw straight to a low-latency canvas.** If the game canvas uses
   `desynchronized: true`, render offscreen and present each frame whole in one final pass.
   Otherwise players see half-drawn frames flicker.
6. **No secrets in public attributes.** Names, room codes, chat and typed text must never be
   mirrored into `data-*`, `aria-*` or `title` on the public document, or drawn as fallback text
   outside the compositor.
7. Size the interface from the window. Blockhaven sets CSS variables such as `--gs` (GUI scale)
   on `document.documentElement` (the shadow host).

---

## 6. Production build (`tools/build.mjs`)

Start from Blockhaven's `tools/build.mjs`. Keep these parts **identical in behaviour**:

1. The `--out <dir>` and `--dependencies <dir>` arguments. The default output is
   `build/games/<slug>/`.
2. Read `index.html`. Extract the `<style>`, strip comments, rename font families to opaque
   letters, and inline font files as `data:font/woff2;base64,...`. Extract the `<body>` markup,
   with scripts and comments stripped.
3. Bundle `js/main.js` with **esbuild** (`bundle`, `minify`, `format: 'esm'`, `target: 'es2022'`,
   `sourcemap: false`, `legalComments: 'none'`). Use a plugin that does the following:
   - strips `?v=` from import paths;
   - replaces `page.js` with
     `import {mount} from './surface.js';mount(<markup JSON>,<css JSON>);`;
   - inlines every worker, vendor script and asset that the source loads by URL. Workers and
     scripts become blob URLs through the `__resource` helper. Binary assets become `data:` URLs.
   **Always pass replacer functions to `String.replace`**, never replacement strings. Minified code
   contains `$&` and similar sequences, and a replacement string corrupts them.
4. Gzip the bundle at level 9, SHA-256 it, and write `<first 24 hex>.bin`.
5. Write `index.html` as exactly Blockhaven's shell: `<canvas>` only. Include the calculator's
   `<title>` and icon, copied out of `../calc.html`, a CSP, `no-referrer`, the viewport meta, the black
   full-window style, and the one inline `<script type="module">` bootstrap. The bootstrap fetches
   the `.bin` with `credentials:'omit'`, checks the digest, decompresses it with
   `DecompressionStream`, and imports it as a blob module. On any failure it paints
   `Unable to open. Please reload.` on the canvas.
6. Don't pack the calculator in the game's build. `docs/games/tools/build.mjs` runs every game's
   build into `build/games/<slug>/`, then packs `calc.html` the same way (markup and CSS mounted
   through `surface.js`, its script in an IIFE with `surfaceDocument as document`, its own `.bin`)
   into `build/games/calc.html`, and writes `build/games/vercel.json`.
7. Production CSP, exactly:
   `default-src 'none'; script-src blob: <boot hashes>; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'self' data: https: wss: http: ws:; worker-src blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`.
   If the game has no networking, you may narrow `connect-src` to `'self' data:`. Don't widen
   anything.
8. Write `third-party-notices.txt` from every bundled LICENSE (the shared build writes `vercel.json`). Delete **only** the temporary `.entry.mjs`, never a computed directory.

When a production page is loaded, it must make exactly these requests: `index.html`, `../calc.html` and
`<hex>.bin` files. Nothing else.

Add `esbuild` and `playwright` only through the root `package.json` (already pinned). Don't add
per-game `package.json` files or new build dependencies without asking.

---

## 7. Cache stamps and CSP sync (`tools/stamp.mjs`, `tools/security.mjs`)

- Every relative import and `new URL('./x.js', import.meta.url)` in `js/`, and every `<script src>`
  in `index.html`, carries the same `?v=<version>` stamp. Run `node docs/games/<slug>/tools/stamp.mjs`
  after **any** change to `js/` or either HTML page, and commit the result. `--check` is read-only and
  fails on unstamped or mixed stamps. If you have a splash, keep `data-modules` up to date as well.
- `stamp.mjs` also runs `syncSecurity()` from `security.mjs`. That recomputes the game page's CSP
  `<meta>` (sha256 of each inline script, with line endings normalised), then the shared
  calculator's `<meta>` and the `docs/games/vercel.json` headers (which carry every page's hashes).
  `node docs/games/tools/security.mjs [--check]` does just the shared part. Source CSP: `script-src 'self' <hashes>`, with no `unsafe-inline`, `unsafe-eval`, `blob:`,
  `data:` or `https:` in `script-src`. The `<meta>` CSP and `no-referrer` come right after
  `<meta charset>`, before any `<script>` or `<link>`.
- `docs/games/vercel.json` (the Vercel project's root directory is `docs/games`): keep the
  `{ "src": "^/$", "dest": "/calc.html" }` route, so the root is the calculator. Games don't have
  their own `vercel.json`. Keep the continuing header route with `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`
  and `X-DNS-Prefetch-Control: off`.

---

## 8. Deployment (CI)

GitHub Pages deploys from **one** workflow, `.github/workflows/blockhaven.yml`, through GitHub
Actions. It never deploys from the legacy `main /docs` source, because that serves the readable tree.
**Don't create a second Pages-deploying workflow.** Two would overwrite each other. To add a game,
extend that workflow:

1. In `check`, add these steps for the game:
   - `stamp.mjs --check`
   - `node --test 'docs/games/<slug>/tests/*.test.mjs'`
   - `npm run test:browser:<slug>` (after the existing `npm run build:site`, which builds every game
     listed in the calculator's `GAMES` table)
2. In **Stage website**, add `--exclude='games/<slug>/'` to the `rsync`. The packed `build/games/`
   (calculator plus every game) is copied over `games/` in one step.
3. Keep the URL path stable once it ships. Saves are tied to origin and path.

You may rename the workflow file and job names in a separate change, but keep it to one deploy job.

A production check should find a small canvas shell plus content-addressed `.bin` files, and a
**404 for `js/main.js`**.

---

## 9. Required checks

A game isn't done until all of these pass locally and in CI.

**Unit tests** (`tests/*.test.mjs`, `node:test`, no dependencies):
- `security.test.mjs`: adapt Blockhaven's. Both pages have an early, exact hashed CSP and one
  `no-referrer`. The `vercel.json` policies and root route are right. Generation is idempotent and
  detects changed scripts.
- `conformance.test.mjs`: **required for every game other than Blockhaven.** It asserts that:
  - `js/surface.js` equals `docs/games/blockhaven/js/surface.js` byte for byte;
  - `js/veil.js` and `js/dialog.js` equal Blockhaven's after stripping `?v=...` stamps;
  - the game has no `calc.html` or `vercel.json`, and `veil.js` embeds `../calc.html`
    (secret uniqueness lives in `docs/games/tests/calc.test.mjs`);
  - `js/` assigns nothing to `window.` or `globalThis.` apart from what the compositor needs, and
    doesn't call `alert(`, `confirm(`, `prompt(`, `eval(`, `new Function(` or `localStorage.clear(`;
  - every `localStorage` key and `indexedDB.open` name literal starts with `<slug>`.
- The game's own logic tests (simulation, rules, protocol, crypto round trips if networked).

**Browser checks** (Playwright Chromium, with real input; adapt Blockhaven's two files):
- `surface-check.mjs` compares a fixture of the game's own UI drawn by the compositor with native
  CSS at the same coordinates. Changed pixels must be under 1.5% and the mean error under 2. It
  also checks clicks, text input, keyboard focus and click-through to `#game`.
- `browser-check.mjs` runs against the **packed** output and asserts the following:
  - the public `document.body.innerText` is `''`, with zero `button`, `input`, `select` and
    `textarea` elements;
  - `'<slug>' in window` is false;
  - the title is `Graphing Calculator` and the icon is the calculator `data:` SVG, before and after
    quick-hide;
  - a document MutationObserver never sees private strings (player-typed text, menu words);
  - real gameplay works through real input: the game state actually changes, not just "an event
    fired";
  - saves, downloads and dialogs work, and packed fonts load;
  - `J` shows the calculator, typing the secret (read from the `GAMES` table, never a literal) plus
    Enter resumes, and the title and icon are
    restored;
  - every request matches `/(index\.html|calc\.html|[a-f0-9]{24}\.bin)$/` (serve `build/games/`
    and open `/<slug>/index.html`, so `../calc.html` resolves);
  - there are no page errors or console errors;
  - a tampered `.bin` shows the failure canvas and nothing else.

  Also keep Blockhaven's **boundary demonstrations**: an early `attachShadow` hook and CDP can read
  the closed tree, a `fillText` hook reads labels, and the `.bin` decompresses. These document
  exposure. They are not blocks, and test hooks are never shipped.
- Poll readiness with `waitForFunction(..., { polling: 100 })`, not on animation frames. Software
  rendering in CI can starve rAF. Write captures to `build/checks/<slug>/`.

Run order, from the repo root:

```
node docs/games/<slug>/tools/stamp.mjs
node --test 'docs/games/<slug>/tests/*.test.mjs'
npm run build:<slug>
npm run test:browser:<slug>
```

---

## 10. `SECURITY.md` and wording

Copy Blockhaven's `SECURITY.md` and change the names and paths. Don't write the secret in it. Remove sections that don't
apply, such as Multiplayer when the game has no networking. Keep every limitation statement. In
particular:

- Gzip, base64, minification and opaque paths are **packaging/obfuscation, not encryption**.
- The closed shadow tree isn't a security boundary against extensions, devtools or instrumented
  APIs.
- Digest checks only help when the bootstrap itself is trusted.
- Canvas pixels remain visible to screen viewing.
- No product-specific detection or bypass is claimed.

Comments in code follow the same rule. Describe what a measure reduces, never that it "hides from"
or "defeats" something.

### Multiplayer (only if the game is networked)

Reuse Blockhaven's `js/net/sealed.js` wrapper unchanged:
- ephemeral P-256 ECDH;
- HKDF-SHA-256;
- AES-256-GCM per direction;
- authenticated sequence numbers;
- bounded queues;
- fail closed on malformed or plaintext packets;
- no plaintext downgrade.

State plainly that the key exchange is unauthenticated. Namespace rooms and topics by slug
(section 3). Networking defaults must use TLS (`https:`/`wss:`). Read `docs/games/blockhaven/MULTIPLAYER.md`
and the relay in `blockhaven-relay/` before sharing relay infrastructure, and don't change the relay's
protocol for one game without keeping Blockhaven compatible.

---

## 11. Code and commit conventions

- Plain browser ES modules (ES2022), no framework and no TypeScript, with no runtime dependencies
  beyond vendored, licensed files in `vendor/`. Every asset is local and licensed. Record credits in
  `third-party-notices.txt` via the build.
- Write code like Blockhaven's: compact, with comments that explain *why*, and named exports.
  Avoid allocating per frame in hot loops (reuse scratch arrays). Do heavy work in module workers,
  which the build inlines as blob workers.
- Use `try/catch` around every storage access. Storage can throw or come back empty.
- Commits are titled `<Game>: <what the player notices>`, for example
  `Blockhaven: snow settles and water freezes`. The body is bullets explaining what changed and why.
  Restamp in the same commit as the code it covers.

---

## 12. Checklist for a new game

- [ ] `docs/games/<slug>/` created with the section 2 layout; slug unique.
- [ ] `index.html`: calculator title and icon, one `<style>`, markup with `<canvas id="game">`,
      module entry `js/main.js`.
- [ ] `surface.js`, `veil.js` and `dialog.js` copied from Blockhaven; one entry added to the shared
      calculator's `GAMES` table, with a unique secret written only there.
- [ ] `main.js` imports `./page.js` first, uses `surfaceDocument`, and calls `registerApp({ keys,
      sound })` last; nothing published on `window`.
- [ ] Every storage key, database, room and file extension is namespaced by slug.
- [ ] No `alert`/`confirm`/`prompt`/`eval`/`<select>`/`<video>`; no per-frame DOM churn.
- [ ] `tools/` (build, stamp, security, surface-check, browser-check) adapted; build writes
      `build/games/<slug>/`.
- [ ] Root `package.json`: `build:<slug>`, `test:<slug>`, `test:browser:<slug>`.
- [ ] Multiplayer: the game's topic root is added to `blockhaven-relay/server.js`'s `PREFIXES`.
- [ ] Tests: security, conformance and game logic; browser checks pass against the packed output.
- [ ] Workflow extended (checks plus staging); still exactly one Pages deploy.
- [ ] `SECURITY.md`, `tests/README.md` and licenses written; stamped; all checks green.
