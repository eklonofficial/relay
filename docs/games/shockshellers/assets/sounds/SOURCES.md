# Sound sources

The movement, bounce and alert effects (`cluck*`, `step*`, `jump`, `land`, `bounce*`, `bolt`, `dud`, `pop`,
`alarm`) are built by `tools/sounds.py` from these recordings: cut, layered, pitched, equalised and
levelled for the game.

The numbered `effect_*.mp3` files come from the imported asset pack that also supplies
`assets/imported/` (weapons, hands, egg, hats, stamps). They are not covered by the licences below.

| Library | Licence |
|---|---|
| The Free Firearm Sound Library, by the Free Firearm SFX team ([opengameart.org/content/the-free-firearm-sound-library](https://opengameart.org/content/the-free-firearm-sound-library)) | CC0 1.0 |
| Impact Sounds, Interface Sounds and RPG Audio, by Kenney ([kenney.nl](https://kenney.nl)) | CC0 1.0 |
| "Chicken Sound Effect" by IMadeIt ([opengameart.org/content/chicken-sound-effect](https://opengameart.org/content/chicken-sound-effect)) | CC BY 3.0 ([licence](https://creativecommons.org/licenses/by/3.0/)), changed: cut into syllables, re-levelled and pitched |

To rebuild: download and unpack the three Kenney packs (as `kenney_impact-sounds/`,
`kenney_interface-sounds/`, `kenney_rpg-audio/`), the firearm library (`Prepared SFX Library/`)
and the chicken effect (`chicken/`) into one folder, then run
`python3 docs/games/shockshellers/tools/sounds.py <that folder>`.
