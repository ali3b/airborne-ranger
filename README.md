# Solitary Strike

An isometric commando game in Phaser 3: one soldier, three supply pods and twelve missions behind enemy lines. Every
sprite, tileset and map was made with the [Synty Sprite Generator](https://github.com/ali3b/synty-sprite-generator)
through its `ssg` CLI and MCP tools, from Synty POLYGON 3D models.

**▶ [Play in your browser](https://ali3b.github.io/solitary-strike/)** (desktop keyboard and mouse, or touch on phones and tablets) ·
**[Gallery](https://ali3b.github.io/solitary-strike/gallery/)**: the documentary *FROM NOTHING*, gameplay video, screenshots, map previews, every sprite animated live, tilesets.

The local folder and the generator project still use the earlier name (`airborne-ranger`, "Airborne Ranger") so map paths keep working.

![Mission 4: the pump station at dusk](docs/screenshots/mission4-station.png)

## Controls

| | |
|---|---|
| Move | `W` `A` `S` `D` or arrow keys (8 directions) |
| Run | `Shift` |
| Prone / crawl | `X` |
| Aim | the mouse: the commando faces the cursor and fires toward it (keyboard only: he fires the way he faces) |
| Strafe | with the mouse, walk or run any way while you aim: his legs face the way he walks, his upper body turns to the cursor and fires, throws and launches from there |
| Shoot / use the selected weapon | left click (hold to keep firing) or `Space` |
| Grenade | right click (lands at the cursor, up to 8 m) or `G` |
| Sound on/off | `M` |
| Weapons and items | `1`–`6` carbine, grenade, LAW, time bomb, knife, first aid; `Q` cycles; `R` reload; `H` first aid |
| Camera (mission 9) | `C`: hold while the prototype is in view |
| Overview map | `Tab` or `O` |
| Call the plane (extraction zone, objective done) | `C` |
| Crosshair | turns red where the selected weapon doesn't reach; its centre dot is green while a grenade reaches. With the grenade or LAW selected a ring on the ground shows the range (LAW rockets fly toward the cursor, up to 30 m) |
| Menus | `↑` `↓` and `Enter`; `1`–`6` picks a commando; on the mission select `1`–`9`, then `0` `-` `=` for missions 10–12, `D` difficulty, `C` campaign |

On phones and tablets (best held sideways): drag on the left half for a stick (push to the edge to run), and use the
FIRE, GRENADE and PRONE buttons on the right, with the item bar (rifle, grenade, LAW, bomb, knife, first aid, and CAMERA in mission 9) beside them, a MAP button under the compass and a CALL PLANE button under it in the extraction zone. In menus, tap a row; tap an empty slot twice to enlist, hold a row to
retire. `?touch=1` forces the touch controls on a desktop, `?touch=0` turns them off.

## The game

A plane drops one commando and three supply pods behind enemy lines. Complete the objective and reach the extraction zone
before the timer runs out, then call the plane and hold out until it picks you up. Machine-gun nests, hidden
minefields, trenches, tanks (only a LAW or a time bomb stops them) and alerts that spread into an alarm stand in the
way, on every mission. Escorted people (the officer, the prisoners, the hostages) draw enemy fire too, but an enemy round only wounds them: they take 5 hits on Easy, 4 on Normal and 3 on Hard, with 1.5 s after each hit in which more rounds do nothing (they flash red and blink), and once hurt a row of pips over them shows the hits left. Your own bullets and blasts still kill them outright. Play Easy, Normal or Hard, single missions or the campaign (the missions in order with one commando). Merit earns promotions (PFC to COL) and medals for a persistent roster of six commandos.
Each mission area is 128×256 m (drop in the south, objective in the far north), and before the drop you pack the
supply pods: magazines, grenades, first aid, LAW rockets and time bombs, up to 21 items and a weight limit.
Missions 5–8 have their own objectives: walk up to the code book to take it; get close to the enemy officer and he
surrenders and follows you (don't shoot him); blow the P.O.W. camp's gate or stand at it to cut the wire, then lead
the prisoners out (they follow you; the debriefing counts the rescued).

| Mission | Climate | |
|---|---|---|
| 1 · Destroy a Munitions Depot | temperate | ![](docs/screenshots/mission.png) |
| 2 · Knock Out Enemy Radar Array | desert | ![](docs/screenshots/mission2.png) |
| 3 · Disable Enemy Aircraft | arctic | ![](docs/screenshots/mission3.png) |
| 4 · Cut a Pipeline | jungle, dusk | ![](docs/screenshots/mission4.png) |
| 5 · Steal a Code Book | temperate | ![](docs/screenshots/g8-mission5-codebook.png) |
| 6 · Capture an Enemy Officer | arctic | ![](docs/screenshots/g8-mission6-escort.png) |
| 7 · Disable SAM Site | desert | ![](docs/screenshots/g8-mission7-sam.png) |
| 8 · Liberate a P.O.W. Camp | jungle, dusk | ![](docs/screenshots/g8-mission8-prisoners.png) |
| 9 · Photograph an Experimental Aircraft: get the prototype in view unseen and hold the camera | arctic | ![](docs/screenshots/g8-mission9.png) |
| 10 · Free the Hostages: blow the stockade gate, lead the hostages out alive | desert | ![](docs/screenshots/g8-mission10.png) |
| 11 · Create a Diversion: hold fire until the buzzer, wreck the garrison, be at the border when the plane lands | temperate | ![](docs/screenshots/g8-mission11.png) |
| 12 · Delayed Sabotage: time bombs on the fuel dump, long fuses, never seen there | jungle, dusk | ![](docs/screenshots/g8-mission12.png) |

| Roster | Drop | Debriefing |
|---|---|---|
| ![](docs/screenshots/title-roster.png) | ![](docs/screenshots/mission-drop.png) | ![](docs/screenshots/mission-debrief.png) |
| **Truck patrol** | **Truck wrecked** | **Map preview from the generator's MCP** |
| ![](docs/screenshots/mission4-road.png) | ![](docs/screenshots/mission4-truck.png) | ![](docs/screenshots/mcp-mission4-preview.png) |
| **Machine-gun nest** | **Tank firing** | **The plane at the extraction** |
| ![](docs/screenshots/g9-nest.png) | ![](docs/screenshots/g9-tank.png) | ![](docs/screenshots/g9-plane.png) |
| **Mines spotted (prone)** | **In a trench** | **Difficulty and campaign** |
| ![](docs/screenshots/g9-mines.png) | ![](docs/screenshots/g9-trench.png) | ![](docs/screenshots/g9-missions.png) |
| **Strafing: legs walk east, torso aims north** | **Mouse aim and the grenade's range** | |
| ![](docs/screenshots/g14-strafe.png) | ![](docs/screenshots/g12-mouse-aim.png) | |

## How it's made

The game is a test customer for the generator: it may only use it through `ssg` and the MCP tools (see `CLAUDE.md`), and
every gap it hits is logged in `FEEDBACK.md`, fixed in the generator, then re-tested here.

- **Sprites** are declared in `ssg.assets.json` and built with `ssg sprite apply`: real scale locked to the 64×32 tile
  (1 m per tile), isometric 8-direction views, collision footprints, object states (intact → destroyed) and looping props.
- **Tilesets**: declared terrains with Wang corner transitions, shores, cliffs and junction tiles, exported as Tiled `.tsj`.
- **Maps** are authored with MCP `edit_map` operations (`maps/*.ops.json`) and exported as Tiled `.tmj`.
- **Engine**: Phaser 3.80, TypeScript, Vite; procedural WebAudio sound.

## Running it locally

The generated assets (`public/assets/`) aren't committed; they're rebuilt from the declarations with the generator running.

```sh
npm install
npm run assets   # needs the Synty Sprite Generator (ssg) and its server
npm run dev      # http://localhost:5195
npm run check    # Playwright load check of every scene
node scripts/deploy-pages.mjs   # build the game + gallery and publish to GitHub Pages (gh-pages branch)
```

## Credits

Solitary Strike is an original game made to test the Synty Sprite Generator. 3D models © Synty Studios, rendered into
sprites.

- **The name *Solitary Strike*:** Tony.
- **Head of Pointing Out the Obvious:** Tony (playtesting, jank detection, and the discovery that the C key calls the plane).
