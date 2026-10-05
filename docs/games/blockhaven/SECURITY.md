# Privacy and deployment boundaries

A compromised device or browser cannot be made confidential by this application. A privileged extension can read closed shadow roots, injected code can hook drawing/decoding/crypto/input APIs, and a trusted TLS interceptor can replace the document, policy and decoder. These changes reduce exposure to ordinary DOM observers and passive traffic collectors. They do not establish trust in the endpoint or defeat an active intermediary.

Both production pages use the existing graphing calculator's title and icon, including before the runtime loads and after quick-hide resumes. This changes public tab metadata only. It does not make the private application invisible to every extension, debugger, network inspector or endpoint agent. Software impersonating a legitimate monitoring product is assessed by its permissions and capabilities, not its name. No product-specific detection or bypass is claimed.

## Inspection coverage

| Vector | Reduction provided here | Remaining exposure |
| --- | --- | --- |
| Ordinary document selectors, DOM keyword scans, MutationObserver text/attribute/added-node inspection | Private layout is closed; public interface text and controls are absent; title and icon identify the calculator | Privileged shadow-root APIs and debugger DOM access can recover the private tree |
| Scripts injected before startup or into the page's MAIN world | CSP restricts ordinary page script loading; the application reference remains module-local | Extensions or endpoint agents can hook shadow creation, input, canvas drawing, decoding and crypto; drawing hooks read labels without screenshots |
| Extension debugger access | No website-controlled defense against an authorized privileged debugger | DOM, Runtime, Network, Storage, frame and worker inspection remain available subject to browser/administrator restrictions |
| Passive network or relay inspection | Opaque packed-resource paths and encrypted multiplayer application payloads | Bundles are reversible; destinations, routing, timing, sizes and signalling remain visible |
| Trusted root-certificate TLS interception or active key substitution | Resource digest checks reject changed bundles only when the original bootstrap is trusted | An active interceptor can replace the shell/CSP/hash or substitute unauthenticated ECDH keys |
| Downloads, local storage and deep system access | Production omits separate downloadable engine/assets; existing local saves and file formats are retained | Downloaded bundles, browser storage, native file operations and runtime memory remain readable to sufficiently privileged software |

Preventing the privileged vectors requires control outside this website: a trusted browser/device and administrator-enforced extension and certificate policies. A compromised operating system can undermine those policies too. A calculator shell, canvas-only renderer, encrypted bundle, worker, iframe or WebAssembly cannot enforce the requested absolute guarantee within a compromised endpoint.

## Production build

GitHub Pages must use **GitHub Actions**, not the legacy `main /docs` source.
The Blockhaven workflow tests the packed applications, stages the rest of `docs/`
without the calculator games' readable folders, and puts only the packed site
`build/games/` (the shared calculator plus each game) at the existing `games/` URLs. It then renders documentation and deploys that artifact.
Serving `/docs` directly exposes the readable HTML, modules and individual assets
before the compositor can hide anything. A production check should find a small
canvas shell plus content-addressed resources, and a 404 for `js/main.js`.
This deployment correction still cannot prevent privileged inspection or screen
monitoring. GoGuardian Teacher, for example, documents live screen viewing;
canvas pixels remain visible to that capability.

From the repository root, run `npm ci` and `npm run build:site`. **Deploy only `build/games/`** as the site root (the shared calculator at `calc.html`, Blockhaven at `blockhaven/`), on the same origin as the previous version to retain saves. `npm run build -- --out <directory>` builds Blockhaven alone into another location. Do not publish the readable development tree, tests, source maps, debug pages or individual asset directories. Browser storage keys and world/Java/resource-pack upload/download formats are retained.

The output has neutral HTML shells and content-addressed `.bin` resources. The engine, workers, PeerJS library, default resource pack and fonts are bundled, minified where appropriate and gzip-compressed. The browser decodes the resource and runs local blob modules/workers. Routine engine, texture, model, font and sound requests no longer have separate URLs. The shared calculator (`docs/games/calc.html`, one page for every calculator game) uses the same packed canvas compositor and keeps the quick-hide/resume contract; Blockhaven's quick-hide embeds it from `../calc.html`. Licenses are included in `third-party-notices.txt`.

The bootstrap verifies the full SHA-256 digest of each packed resource before decoding or executing it. This rejects altered resources when the bootstrap itself is trusted; it cannot authenticate a bootstrap replaced by an active intermediary.

Gzip, base64, minification and opaque paths are packaging/obfuscation, **not encryption**. Anyone who downloads a bundle can decode it. A TLS interceptor can inspect destinations, bundles, timing and size, or replace the loader. WebAssembly, IndexedDB and service-worker encoding would not fix that boundary. No VPN, Tor, SSH tunnel, system proxy or interception certificate is used.

## Canvas and DOM

Visible controls, menus, HUD, inventory, dialogs, previews and calculator controls render into canvas. The 3D scene and startup animation retain their existing canvas paths. The compositor keeps native controls in an invisible **closed shadow layout tree** for keyboard navigation, focus, IME, paste, accessibility, file pickers, scroll and existing input handlers. It does not eliminate that private tree or claim controls exist only as pixel buffers.

Ordinary document selectors, text scans and document-level MutationObservers do not traverse the tree. Labels, room codes, entered text and names are not mirrored into public DOM attributes or fallback canvas text. The application instance is no longer published as `window.blockhaven`. Privileged extensions, devtools, code that captured `attachShadow`, or instrumented APIs can still read content without screenshots. Browser/OS file dialogs and downloads remain native.

## Multiplayer

Application payloads use ephemeral P-256 ECDH, HKDF-SHA-256 and separate AES-256-GCM keys for each direction. Authenticated sequence numbers prevent replay and verify ordering. Nonces are unique counters under each directional key. Queues are bounded; malformed, tampered or plaintext packets fail closed. Both peers must reload the updated version; no plaintext downgrade is used. RTC and the reliable MQTT fallback use the same wrapper. Existing signalling and relay routing remain compatible with the servers; metadata and endpoint names remain observable.

**Key exchange is unauthenticated.** It protects against passive relay/traffic inspection, not active key substitution, malicious peers, injected scripts or compromised browsers. Hosts still receive shared world/player/chat content. It does not establish authenticated identities or resist a trusted TLS interceptor replacing the page. HTTPS/WSS remains necessary for real deployments. Custom HTTP/WS servers remain supported where browsers permit them; Web Crypto requires a secure context (HTTPS or trusted localhost).

## Other defenses and checks

Both source pages have early hashed CSP and `no-referrer`. Production shells allow their hashed bootstrap and local blob scripts. Inline handlers, `eval`, remote scripts, objects, injected base URLs and form submission are blocked. Blob imports are deliberately allowed for the packed runtime. Configurable multiplayer endpoints require broad `connect-src`; this is not an exfiltration firewall against executing code. Runtime styles and local/data/blob media remain supported. Messages validate sender window and exact origin.

Vercel output preserves the calculator root route and response headers disabling MIME sniffing, DNS prefetch, camera, microphone, geolocation, payment, USB and Topics. GitHub Pages cannot apply Vercel response headers; HTML CSP/referrer protections still apply. Embedding, clipboard, pointer lock, fullscreen and audio output remain supported.

Run `node docs/games/blockhaven/tools/stamp.mjs` after source edits, then `npm test`, `npm run build` and `npm run test:browser`. CSP hashing normalizes line endings as HTML parsers do. Browser checks exercise real input, world creation, survival/creative inventory, downloads, dialogs, calculator, resize, font loading, public-DOM exposure and production requests. Unit tests check crypto round trips and rejection, plus existing simulation/protocol behavior.

Browser checks also scan public added nodes and attributes, verify calculator metadata across quick-hide/resume, and deliberately demonstrate the privileged-access boundary: an early shadow hook and DevTools Protocol can access the closed layout, an injected canvas `fillText` hook reads labels without screenshots, and a downloaded packed resource can be decompressed. These are expected exposure demonstrations, not successful blocks. Test hooks are not shipped in production.

References: [MDN closed roots](https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow), [MDN extension access](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/dom/openOrClosedShadowRoot), [Chrome debugger access](https://developer.chrome.com/docs/extensions/reference/api/debugger), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [MDN key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy).
