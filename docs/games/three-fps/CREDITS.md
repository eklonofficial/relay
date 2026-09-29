# Credits

Production build of [three-fps](https://github.com/mohsenheydari/three-fps) by Mohsen Heydari, MIT License (see `LICENSE`).

## Changes from upstream
- Fixed an import path whose letter case didn't match the file on disk (`Mutant Punch.fbx` → `mutant punch.fbx`) so it builds on case-sensitive systems.
- Replaced the Google Fonts `<link>` with a locally bundled copy of Libre Barcode 39 Text so the game makes no external requests.
- Added online multiplayer: other players appear as the mutant with name tags, hits are reported to
  the server in `fps-server/`, plus a scoreboard, kill feed and respawns. The menu has **Play online**
  and **Play vs AI**; the server address lives in `config.js`. Full diff: `fps-server/three-fps-multiplayer.patch`.
- Built with webpack in production mode; source maps omitted.

## Third-party code
- [ammo.js](https://github.com/kripken/ammo.js) (Bullet physics), zlib License — see `LICENSE-ammo.js.txt`.
- three.js and three-pathfinding, MIT — notices in `main.*.js.LICENSE.txt`.

## Art assets
- [Ak47](https://skfb.ly/6UEL9) by [kursat_sokmen](https://sketchfab.com/kursat_sokmen), licensed under CC BY 4.0.
- [Metal Ammo Box](https://skfb.ly/6UAQY) by [TheoClarke](https://sketchfab.com/TheoClarke), licensed under CC BY 4.0.
- [Veld Fire](https://polyhaven.com/a/veld_fire) HDRI by Greg Zaal, CC0.
- Mutant character and animations from Adobe Mixamo, used within the game under Mixamo's terms.
- Libre Barcode 39 Text font by Lasse Fister, SIL Open Font License — see `fonts/OFL.txt`.
