# Security and privacy boundaries

This is a browser application, not a confidential execution environment. **It cannot hide
content from software that controls the device, browser, injected scripts, or a trusted TLS
interception certificate.** Do not use it to store sensitive information on a compromised device.

## Protections in this release

- An early Content Security Policy (CSP) on both HTML pages permits local scripts and the exact
  hashes of their shipped inline scripts. Other inline scripts, event-handler attributes,
  `javascript:` URLs, `eval`, remote scripts, plugins, injected base URLs, and form submissions
  are blocked by a conforming, uncompromised browser. CSP is defense in depth, not protection
  against a privileged extension or an attacker who can replace the document/policy itself.
- Fonts, images, audio, and embedded pages cannot load from unrelated remote origins. Data/blob
  media, resource-pack uploads, download URLs, local workers, and the network keepalive worker
  remain supported. Runtime styles are intentionally allowed because the UI depends on them.
- HTML referrer policy is `no-referrer`. App-owned pack/health/diagnostic fetches also omit
  credentials and referrers explicitly. This does **not** hide the destination, origin, IP
  address, traffic timing, or WebSocket handshakes; browsers can send WebSocket cookies.
- On Vercel, response headers additionally disable MIME sniffing, DNS prefetching, camera,
  microphone, geolocation, payment, USB, and Topics access. File uploads/downloads, clipboard,
  fullscreen, pointer lock, graphics, and audio output are not disabled.
- Calculator/game messages validate both the sender window and its exact origin.
- CI checks CSP hashes along with cache-busting stamps. Run `node tools/stamp.mjs` after edits
  to regenerate both; do not fix a CSP failure by adding `unsafe-inline` to `script-src` or
  `unsafe-eval`.

GitHub Pages receives the HTML CSP/referrer protections. The Vercel-only response headers cannot
be installed on GitHub Pages through `vercel.json` or HTML metadata. Existing embedding remains
supported: this release does not add `frame-ancestors` or X-Frame-Options restrictions.

## Residual risks, especially multiplayer

The default network servers use HTTPS/WSS. Custom/local HTTP/WS endpoints remain permitted for
compatibility; use TLS for real deployments. `connect-src` permits those protocols because users
can configure their own servers. It is **not** an allowlist against data exfiltration by code
that already runs on the page. No third-party CSP reporting/telemetry endpoint was added.

Multiplayer is opt-in. Opening its screen wakes the configured relay; hosting/joining or running
diagnostics contacts configured PeerJS, MQTT and STUN/TURN services. Those services can learn
connection metadata. Direct peers may learn each other's IP addresses. The current MQTT fallback
sends application messages through public brokers without application-layer end-to-end encryption;
operators and other subscribers with access to those topics can observe messages. HTTPS/WSS is
transport encryption, not protection from the relay operator. Do not share private information in
chat or shared worlds. This release does not change the other agent's multiplayer protocol or
claim that its relay traffic is private.

Worlds, settings, and imported packs remain in browser storage until exported/shared through the
existing features. Browser storage is not encrypted storage isolated from local malware; another
same-origin page, an XSS vulnerability, or a privileged extension may access it. This deployment
shares an origin with other hosted pages. A dedicated origin reduces that cross-app risk, but
moving origins also requires migrating existing browser saves and is not done here.

## Why content disguise is not a security boundary

Canvas-only UI would hide text from a basic DOM text scanner, but injected code can intercept
`fillText`, canvas/WebGL APIs, asset decoding, and input before rendering; screenshots are not
required. Removing accessible DOM controls also harms keyboard, screen-reader, text-input, and
mobile behavior, so the existing UI is retained.

Base64/XOR, opaque URLs, blob execution, minification, WebAssembly, and IndexedDB do not encrypt
content against its executing browser. A service worker operates inside that browser, not outside
its inspection boundary; the original document and bootstrap still have to arrive, and a TLS
interceptor can read or replace them. Extra in-page encryption cannot solve this when the attacker
can replace the decoder or capture its keys/plaintext.

For the stated deep-compromise threat, use a known-clean device/browser, remove untrusted
extensions and root certificates, and recover/reinstall a compromised OS as appropriate. A site
cannot repair that trust boundary. No VPN, Tor, SSH tunnel, traffic camouflage, or anti-inspection
loader is introduced here.

References: [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP),
[OWASP HTML5 security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).
