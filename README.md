# Take Down

A 1v1 street fight game in plain JavaScript and Canvas, styled like 16-bit arcade fighters. It uses no libraries and has no build step. The fighters come from sprite sheets, which a Python tool cuts into animations.

The sprite sheets are ripped from commercial games (Capcom, Marvel, DC, Konami and others) by fans; see [Credits](#credits). The raw sheets in `sprite_assets/` stay local; the atlases cut from them (`assets/sprites/`, `assets/stages/`) are committed so the deployed game has its fighters.

## Run it

```
python3 tools/slice_sprites.py build      # once, and again after changing sprites
python3 tools/build_stages.py             # once, and again after changing stage art
```

Then open `index.html` in a browser. If your browser blocks local files, serve the folder instead with `python3 -m http.server 8000`. On phones, play in landscape; the touch controls appear automatically.

Both tools need `pillow`, `numpy` and `scipy`.

## Modes

- **Play vs Computer**: available, with Easy, Normal and Hard difficulty.
- **Play vs Friend**: planned. Every fighter is already driven through a `PlayerInput`, so a second keyboard or touch controller can drive player 2.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `A` `D` or arrow keys | slide the stick left / right |
| Jump | `W`, `Space` or `↑` | flick the stick up |
| Block (hold) | `S` or `↓` | pull the stick down |
| Jab / Punch / Hook | `J` / `K` / `L` | keep tapping PUNCH (jab → punch → hook → uppercut) |
| Uppercut / Kick | `I` / `U` | stick down + PUNCH / KICK |
| Special (½ power bar) | `O` | SUPER (glows cyan) |
| Super special (full power bar) | `P` | SUPER (glows gold) |
| Pause | `Esc` | ❚❚ |

Phones get a fixed stick on the left thumb and three buttons (PUNCH, KICK, SUPER) on the right. SUPER fires the biggest move the power bar can pay for.

- **Combos:** a hit that lands can be cancelled into a stronger move: jab → punch → hook → uppercut or kick. A special can be chained off any hit.
- **Counters:** hitting an opponent in the middle of their own attack is a counter and does +25% damage.
- **Air attack:** attacking while in the air does an air attack.
- **Rounds:** best of three. A K.O. wins the round; win two rounds to win the match. Health resets each round, power carries over.

## Roster and specials

| Fighter | Special (½ bar) | Super (full bar) |
| --- | --- | --- |
| Ryu | Hadouken | Shoryuken |
| Sagat | Tiger Shot | Tiger Uppercut |
| Zangief | Spinning Lariat | Spinning Piledriver |
| Fei Long | Rekka Ken | Shien Kyaku |
| T. Hawk | Rising Hawk | Storm Hammer |
| Toki | Hokuto Dash | Heavenly Leap |
| Komaku | Wind Claw | Pole Strike |
| Batman | Batarang | Grapple Strike |
| Superman | Heat Vision | Flying Fist |
| Wolverine | Berserker Barrage | Tornado Claw |
| Juggernaut | Juggernaut Charge | Unstoppable |
| Apocalypse | Drill Arm | Spike Burst |
| Catwoman | Whip Lash | Cat Pounce |
| Joker | Joker Bomb | Bang! Gun |
| Scarecrow | Fear Gas Gun | Terror Claws |
| Penguin | Umbrella Gun | Bird Copter |
| Clayface | Clay Brick | Mud Ball |

Only sheets with a full fighting set (idle, walk, punches or kicks, hit, knockdown) join the roster. Sheets in `sprite_assets/` that aren't used:
- Dagal looked bad in game.
- Moon Knight, Magneto, Hulk, Colossus, Hercules and the other Avengers Alliance heroes, plus Luffy and Zoro, come from turn-based games. They have no walk, hit or knockdown frames.
- The helmetless Magneto edit only has blasts, with no punches or kicks.
- Mario, Luigi and Sonic are platformer sprites with no real punches or kicks.
- The Batman & Robin thugs are generic goons.

## Stages

Each match picks one of three stages at random. All come from The Adventures of Batman & Robin backgrounds:
- **Cafe** (default, also the menu backdrop): a CAFE storefront on a Gotham street (Area 1-1).
- **Gotham:** a Gotham street with the skyline over a garage (Area 1-1).
- **Funhouse:** the Joker's funhouse and amusement park (Area 1-2A).

`python3 tools/build_stages.py` cuts the background sheets and writes `assets/stages/`. If those files are missing, the game falls back to a night alley painted in code.

## Announcer

Round calls, FIGHT, KNOCKOUT, fighter names and every special's name are voiced. The clips in `assets/voice/` are generated (no recordings of anyone) by `tools/build_voice.py` with the Piper neural TTS plus an arcade treatment in ffmpeg:

```
uv run --no-project --with piper-tts python tools/build_voice.py <piper-voice.onnx>
```

Re-run it after adding a character or renaming a special. Lines without a clip fall back to the browser's speech synthesizer where one is available.

Every special is one of three types:
- **Projectile:** the fighter throws or fires a shot that travels across the screen.
- **Rush:** the fighter dashes in with a multi-hit flurry.
- **Rising:** the fighter does a launching jump attack.

## Adding a character

1. Drop the sprite sheet into `sprite_assets/`.
2. Add an entry to `tools/characters.json` with the file name and its background colours. Use `"cells": true` for sheets that put each frame on its own coloured box, `"flip": true` if the art faces left (`false` if the facing guess gets it wrong), and `"target_h"` to set the fighter's height. Add `"scale2x": true` for small pixel art that gets blown up a lot (the Batman & Robin villains): the slicer smooths it with Scale2x before it is drawn.
3. Run `python3 tools/slice_sprites.py index <outdir> <id>`. It writes a preview image of the sheet with every frame numbered.
4. List frame numbers per animation under `anims` in the same entry. The animation names are: `idle walk jump block jab cross hook uppercut kick airkick hit hitBody fall lie getup ko win intro`. Also list your special's animation, and `projectile` frames if the special throws something. A special can name its own shot animation with `"shot"`; naming one that doesn't exist fires an energy ball.
5. Run `python3 tools/slice_sprites.py strips <outdir> <id>` to check each animation as a labelled row.
6. Run `python3 tools/slice_sprites.py build` to generate the game files.

What the slicer does automatically:
- It finds the box borders on a sheet and removes them.
- It removes dashed divider lines.
- It removes the floor shadows baked into the sprites.
- For each frame, it records the anchor point (body centre and feet) and how far the fist or foot reaches.

Hits in the game use that reach, so a punch connects where the art's fist actually is. Fighters without knockdown art tip their hit pose over when they fall.

## Code

| File | Role |
| --- | --- |
| `tools/slice_sprites.py` | Sheet slicer: frame detection, shadow and grid cleanup, atlas packing, preview strips |
| `tools/characters.json` | Per-character frame mapping and special-move config |
| `tools/build_stages.py` | Stage builder: cuts background sheets and composes the stage pictures |
| `tools/build_voice.py` | Announcer clips: Piper TTS + ffmpeg treatment, writes `assets/voice/` and `js/voice-data.js` |
| `js/sprite-data.js` | Generated frame data for every atlas |
| `js/sprites.js` | Atlas loading, drawing frames with pixel snapping, tinted silhouettes for hit flashes and afterimages |
| `js/moves.js` | Move frame data, plus the three special-move templates |
| `js/fighter.js` | Fighter state machine, physics, hit detection from sprite reach, choosing the animation frame, projectiles |
| `js/ai.js` | CPU opponent. It reacts to what it saw a few frames earlier and picks attacks that the character's reach can land |
| `js/game.js` | Fixed 60 Hz loop, hitstop, super freeze, slow-motion K.O., screen shake, DOM HUD |
| `js/stage.js` | Stages: the code-painted alley with its crowd, and the built stage pictures |
| `js/effects.js`, `js/audio.js`, `js/input.js`, `js/main.js` | Particles, synthesized sound, input, menus and character select |

The game renders at device resolution. 16-bit sprites (Ryu, Batman and others) are drawn with crisp pixels to keep the arcade look. High-detail art (Toki, Sagat and others) and the Scale2x-smoothed Batman & Robin villains are drawn smoothed.

## Credits

Sprite sheets were found on [The Spriters Resource](https://www.spriters-resource.com/). Credit to the fans who ripped them, as named on each sheet:

| Ripper | Sheets |
| --- | --- |
| Lord Zymeth (Final Destination Pixelation) | Ryu, Sagat, Zangief, Fei Long, T. Hawk (Super Street Fighter II, SNES) |
| Ultimecia | Batman, Catwoman, Scarecrow, The Joker (The Adventures of Batman & Robin, SNES); Superman (The Death and Return of Superman, SNES) |
| Deathbringer | Clayface (Batman & Robin), extra Joker frames, Apocalypse (X-Men: Mutant Apocalypse, SNES) |
| Frario / MichaFrar | The Penguin (Batman & Robin) |
| Cyrus Annihilator | Juggernaut (X-Men: Mutant Apocalypse) |
| Belial (a.k.a. Scorcher) | Wolverine (X-Men: Mutant Apocalypse) |
| Magma MK-II | Area 1-1 and Area 1-2A backgrounds (Batman & Robin), used for all three stages |
| not named on the sheet | Toki, Komaku (Fist of the North Star, arcade) |

Games and characters belong to their owners: Super Street Fighter II © Capcom; The Adventures of Batman & Robin © Konami / DC; The Death and Return of Superman © Sunsoft / DC; X-Men: Mutant Apocalypse © Capcom / Marvel; Fist of the North Star (arcade) © Arc System Works / Sega.

The announcer voice is generated with [Piper](https://github.com/rhasspy/piper). Fonts are Anton and Bangers from Google Fonts.

Take Down is a free fan project. It is not affiliated with or endorsed by any of these companies.

The game's title screen has a **Credits** page with the same list.
