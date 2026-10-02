# Privacy and deployment boundaries

A compromised device or browser cannot be made confidential by this application. A privileged extension can read closed shadow roots, injected code can hook drawing/decoding/crypto/input APIs, and a trusted TLS interceptor can replace the document, policy and decoder. These changes reduce exposure to ordinary DOM observers and passive traffic collectors. They do not establish trust in the endpoint or defeat an active intermediary.

## Production build

From the repository root, run `npm ci` and `npm run build`. **Deploy only `build/site/`** as the application's root, on the same origin/path as the previous version to retain saves. `npm run build -- --out <directory>` chooses another output location. Do not publish the readable development tree, tests, source maps, debug pages or individual asset directories. Browser storage keys and world/Java/resource-pack upload/download formats are retained.

The output has neutral HTML shells and content-addressed `.bin` resources. The engine, workers, PeerJS library, default resource pack and fonts are bundled, minified where appropriate and gzip-compressed. The browser decodes the resource and runs local blob modules/workers. Routine engine, texture, model, font and sound requests no longer have separate URLs. The companion calculator uses the same packed canvas compositor and keeps its established URL and quick-hide/resume contract. Licenses are included in `third-party-notices.txt`.

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

References: [MDN closed roots](https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow), [MDN extension access](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/dom/openOrClosedShadowRoot), [MDN key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy).
