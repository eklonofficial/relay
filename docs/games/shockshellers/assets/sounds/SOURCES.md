# Sound sources

Every effect in this folder is built by `tools/sounds.py` from these recordings: cut, layered,
pitched, equalised and levelled for the game. Nothing here comes from any other game.

| Library | Licence | Used for |
|---|---|---|
| The Free Firearm Sound Library, by the Free Firearm SFX team ([opengameart.org/content/the-free-firearm-sound-library](https://opengameart.org/content/the-free-firearm-sound-library)) | CC0 1.0 | every gunshot (AK-47, PPSh, AR-15, SKS, Mosin Nagant, Benelli Nova, Walther PPQ, Springfield 1917) and the explosions |
| Impact Sounds, Interface Sounds and RPG Audio, by Kenney ([kenney.nl](https://kenney.nl)) | CC0 1.0 | egg cracks and splats, reloads, swaps, the whisk, footsteps, pickups, menu sounds and stingers |
| "Chicken Sound Effect" by IMadeIt ([opengameart.org/content/chicken-sound-effect](https://opengameart.org/content/chicken-sound-effect)) | CC BY 3.0 ([licence](https://creativecommons.org/licenses/by/3.0/)), changed: cut into syllables, re-levelled and pitched | grenade clucks, squawks and the spatula "bawk" |

To rebuild: download and unpack the three Kenney packs (as `kenney_impact-sounds/`,
`kenney_interface-sounds/`, `kenney_rpg-audio/`), the firearm library (`Prepared SFX Library/`)
and the chicken effect (`chicken/`) into one folder, then run
`python3 docs/games/shockshellers/tools/sounds.py <that folder>`.
