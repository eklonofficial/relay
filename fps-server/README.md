# Arcade FPS multiplayer server

WebSocket server for online matches in the arcade's 3D shooter (`docs/games/three-fps`).
It relays player positions and shots, and keeps health, kills and respawns on the server.

## Deploy (Render, free)

`render.yaml` at the repo root describes the service. In Render: **New → Blueprint**, pick this repo, **Apply**.
Then put the service's address in `docs/games/three-fps/config.js`, using `wss://`:

```js
window.FPS_SERVER_URL = "wss://your-service.onrender.com";
```

Free Render services sleep after ~15 minutes idle; the game's menu wakes it, which can take up to a minute.

Settings (environment variables): `PORT`, `MAX_PLAYERS` (default 16), `ALLOWED_ORIGINS`
(comma-separated page origins allowed to connect; `*` for any; the blueprint sets `https://eklonofficial.github.io`).

## Run locally

```sh
npm install
PORT=8090 node server.js
```

Then open the game with `?server=ws://localhost:8090` appended to its URL.

## Rebuilding the game client

The shipped game is a production build of [three-fps](https://github.com/mohsenheydari/three-fps)
at commit `625a18c` with `three-fps-multiplayer.patch` applied:

```sh
git clone https://github.com/mohsenheydari/three-fps && cd three-fps
git checkout 625a18c && git apply ../three-fps-multiplayer.patch
git clone --depth 1 https://github.com/kripken/ammo.js ../ammojs   # the patch points ammo.js at ../ammojs
npm install && npx webpack --mode production
```

Copy `build/` into `docs/games/three-fps/` along with `src/fonts/` (the Libre Barcode font
`LibreBarcode39Text-Regular.ttf` comes from google/fonts), and keep `config.js`.
