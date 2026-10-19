# Airborne Ranger remake: design

This design comes from the original (MicroProse, 1988, IBM PC). Reverse-engineering notes are in the local, git-ignored
`decoded/ANALYSIS.md`, and the rendered originals are in `decoded/images/` (terrain blocks, sprite sheets and menus).
Use them as reference for layout and feel. Never ship them.

## The game in one paragraph
You choose a mission. A plane drops one Ranger and three supply pods behind enemy lines. The Ranger crosses a
scrolling terrain of enemy soldiers, bunkers, pillboxes, wire, mines, trenches, huts and rivers. He picks up pods to
restock, completes the objective, and reaches the extraction point before the timer runs out and the plane leaves.
He can run, crawl (prone) and shoot. His weapons are a carbine, grenades, LAW rockets, time bombs and a knife.
Merit points earn promotions and medals for a persistent roster of Rangers.

## Content from the original
- **Missions (12 + campaign):** Destroy a Munitions Depot, Steal a Code Book, Disable Enemy Aircraft, Capture an Enemy
  Officer, Cut a Pipeline, Knock Out Enemy Radar Array, Disable SAM Site, Liberate a P.O.W. Camp, Photograph an
  Experimental Aircraft, Free the Hostages, Create a Diversion, Delayed Sabotage. Each is tied to one terrain.
- **Terrains:** desert, temperate, arctic. They share tile shapes with per-terrain colour remaps, the same idea as
  palette-tinted Synty textures.
- **Terrain building blocks:** each 64×64-pixel cell is a whole feature (tent, bunker, hut, river piece, tree, sandbag
  wall), with a matching black/white collision mask. In the remake this becomes object sprites with footprints and
  collision polygons on an iso tilemap.
- **Supply pod loadout:** carbine magazines, grenades, first-aid kits, LAW rockets and time bombs, limited by weight
  and a 21-item capacity. Three pods per mission.
- **Scoring:** merit for the objective, troops and installations, minus a penalty for an early alert.
- **Ranks:** PFC → COL (12 ranks).
- **Medals:** COM1, COM2, Bronze Star, Silver Star, DSC, CMH. Death gives a posthumous promotion. Capture is tracked.
- **Roster:** six Rangers are saved, with name, rank, score and medals.

## The remake
- **Engine:** Phaser 3, in isometric 2:1 with 64×32 tiles. Sprites come from the generator's `iso8` view under tile
  lock (`--tile 64x32 --metres-per-tile 1`, 45.25 px/m), so characters and props share one scale. At 1 m per tile a
  soldier is ~80 px tall, about 1/9 of a 720 px view: close to the original, where a ~20 px soldier filled about 1/10
  of the 200-line screen.
- **Synty sources (to try first):**
  - POLYGON_War: American and German soldiers, weapons, helmets, bunkers, sandbags, wire, tanks and wrecks.
  - BattleRoyale and Apocalypse: huts, tents, containers.
  - Generic: rocks and trees.
  - Particle_FX: explosions and smoke.
- **Arctic:** no snow pack exists, so tinted textures stand in for it: the `arctic` tileset's snow is Palm City's
  `Sand_01` tinted `#eef4ff` (Fantasy Village's own `Snow_01` reads green-grey), its ice is `Generic_Water` tinted pale
  blue and its rock is a grey-tinted `Generic_Rock`. Snow-covered pines and rocks come from POLYGON_Adventure_Pack.

## Original-scale maps (G6)
The original scrolls over a long area: drop in the south, objective far north, extraction elsewhere, with a map
screen. Missions 1–4 are now **128 × 256 m** (128 × 256 tiles at 1 m), up from 48 × 40.

- **Layout** (map cells; the iso view puts cell (0, 0), the top corner, at world north): the drop zone near the south
  corner, the objective in the north, the extraction east (missions 1, 2) or west (3, 4). Between them: a river or
  frozen river with fords, roads and tracks, rock ridges with passes (desert, arctic), trench lines with wire,
  bunker nests (`bunker_nest` stamp) and outposts (`outpost` stamp: tent, supplies, sandbags, two guards) at the
  crossings, patrols along roads, banks and trenches, and the three supply pods spread along the way.

| | objective (targets) | extraction | objects | enemies | shortest route | clock |
|---|---|---|---|---|---|---|
| 1 temperate | munitions depot in the north corner, wired, tower (11) | east | 977 | 27 | 395 m | 10:00 |
| 2 desert | radar compound with 2 towers, 4 dishes (6) | east | 541 | 28 | 372 m | 10:00 |
| 3 arctic | airfield: runway, hangar, 4 aircraft, fuel truck (5) | west | 686 | 27 | 442 m | 11:00 |
| 4 jungle, dusk | pump station across the north: pipeline, 4 valves, 4 searchlights, comm dish (4) | west | 1 099 | 24 + 2 trucks | 469 m | 12:00 |

- **Authoring:** staged `edit_map` batches over MCP (`maps/g6/<mission>/stage*.json`: terrain, then installations
  and zones, then scatters), applied together by `scripts/g6-stages.mjs`, which also writes their sum to
  `maps/<mission>.ops.json` for `scripts/build-maps.mjs`. The maps were made again at the new size under the same
  names (FB-063: no resize; `build-maps.mjs --resize`). Mission 4's trucks use the zone `vehicle` / `speed` fields.
- **Balance:** `scripts/route-check.mjs` finds the shortest walkable route (A* over collision and prop footprints with
  a cell of clearance) drop → objective → extraction: 372–469 m, 2:12–2:47 at a flat-out run, 5:05–6:24 walking;
  `--walk <url>` runs it in the game (unhurtable) through the real colliders. With the objective's targets, pods,
  stealth (prone crawl is 0.6 m/s) and fights a mission takes about 6–10 minutes; the clocks are 10–12 minutes.
- **Overview map** (Tab / O, the MAP touch button; tap or the key again to return): the whole area in the game's iso
  orientation (north up), drawn from the exported map (each ground tile's average colour, objects darker; FB-064),
  with the Ranger and his facing, the objective (filled until done), the pods left, the drop and the extraction.
  The action pauses while it's open; the mission clock runs on.
- **HUD compass:** north up, an arrow to the objective (to the extraction once it's done) and the distance in metres.
- **Performance:** only the played mission's map is loaded; tile layers are culled to the camera analytically
  (`src/world.ts` `isoCull`; Phaser's iso cull tests all 32 768 tiles per layer every frame) and the empty decoration
  layer isn't drawn; props are in a screen-space grid (`PropGrid`) for collision, sight lines, bullets and depth
  sorting; props off camera are hidden and inactive (no animation updates); enemies farther than 36 m sleep (no AI,
  no animation) until the Ranger is within 32 m; vehicles farther than 45 m stop. Measured with
  `scripts/perf-check.mjs` (the Ranger running through each map for 15–20 s, hardware GL on an Intel UHD iGPU):
  1280×720: 58.6–60 fps, 1.5–3.0 ms CPU per frame; emulated phone (915×412, DPR 2.6, CPU throttled 4×):
  54–60 fps, 4.5–7.6 ms per frame. With the culling and sleep switched off (`--nocull`) the phone needs
  12.4–14.3 ms per frame (50.8–56.3 fps).

- **Screenshots:** the generator's previews of each map (`docs/screenshots/g6-mission<N>-map.png`) and objective
  (`g6-mission<N>-objective.png`, an MCP `map_preview` region), the in-game overview (`g6-mission<N>-overview.png`,
  `g6-mission4-overview-phone.png`), the compass (`g6-compass.png`, `g6-mission4-phone.png`).

## Objectives: missions 9–12 (G8, lane g8b)
A mission's goal beyond "destroy every target" is an **objective kind** (`src/objectives/index.ts`: `start`, `update`
→ pending / done / failed with a reason, `hud`, `marker` for the compass, `stats` for the end screen);
`MissionConfig.objective` names it. Missions 9–12 register theirs in `src/objectives/g8b.ts`. Done opens the
extraction as before; failed ends the mission with the reason. The maps are 128 × 256 m like G6's, built over MCP in
`maps/g6/mission<N>/stage*.json` (`scripts/g6-stages.mjs`), objective in the north.

| | objective (the original's briefing) | the rules here | map | route | clock |
|---|---|---|---|---|---|
| 9 arctic | Photograph an Experimental Aircraft: "sneak into the hangar; do not be seen entering it" | the prototype (`prototype_rocket`, the V-2 at the hangar) within 16 m and in sight; C / CAMERA: the Ranger kneels with the camera (`ranger_ops` camera_kneel_shoot) and holds still 1.5 s (letting go of C, losing sight spoil it). Seen inside the hangar zone before that, or the prototype destroyed: failed | hangar compound with searchlights and towers north, frozen river, ridges; extraction east | 342 m | 11:00 |
| 10 desert | Free the Hostages: "blow open the door on the prison … defend the hostages" | five hostages (`hostage`) sit in a stockade (`stockade`, `prison_hut`); its gate (`stockade_gate`) gives only to explosives. Then they come out through the gap and follow in a file (`src/objectives/hostages.ts`); enemy bullets and blasts kill them, alerted soldiers shoot at them. Done on reaching the extraction with at least one near; all dead: failed. The end screen counts the rescued | stockade north, guarded by towers, barracks and a loop patrol; extraction west | 360 m | 12:00 |
| 11 temperate | Create a Diversion: "no combat until the buzzer; shoot whenever it sounds; the aircraft can't be recalled early" | entering the garrison starts an 8 s HOLD (combat there before the buzzer: failed); the buzzer sounds the alarm (`alarm_pole`s flash, the garrison is alerted) and opens a 35 s window: kills there score 1, wrecks 2; another buzzer after 15 s until 6 points. The plane then lands at the border 60 s later, not before | garrison of tents, trucks, a tank, containers north; a river with fords; the "border" extraction east | 360 m | 12:00 |
| 12 jungle, night | Delayed Sabotage: "plant a time bomb at the aviation fuel dump … not be seen in its vicinity" | a time bomb (set with `kneel_place`, `ranger_ops` plant_kneel_place) within 2.5 m of a fuel target (`fuel_tank` ×2, `fuel_bowser`) gets a 150 s fuse; every target charged: done. Seen inside the fuel dump: failed (the charges are found). The end screen says when they go off | airfield with hangar, planes and a fuel dump behind sandbags and wire, searchlights; river with fords; extraction west | 381 m | 12:00 |

- **Shared hooks:** `Mission.touchExtras` (item-bar entries an objective adds, e.g. CAMERA), `Field.extraItems()` /
  `itemAction()`; `Mission.failReason`. The objectives read the scene's protected parts through
  `src/objectives/g8b-view.ts`.
- **Checks:** `node scripts/load-check.mjs <url> mission9` … `mission12` play each objective through the game's own
  actions (`scripts/g8b-checks.mjs`), including the failure rules (seen at the hangar, premature contact);
  `scripts/route-check.mjs` (mission 10's objective zone names an `approach` cell outside the stockade);
  `scripts/g8b-shots.mjs` writes `docs/screenshots/g8-mission<N>.png` and the touch CAMERA shot.
- **Sprites (ssg.assets.json):** `prototype_rocket`, `hostage` (unarmed idle/walk/run, sit, death_fall), `prison_hut`,
  `stockade`, `stockade_gate`, `fuel_tank`, `fuel_bowser`, `alarm_pole`, `ranger_ops` (camera and plant clips with
  per-template held items). Gaps: FB-085–087.

## Living battlefield (G5)
- **Mission 4, Cut a Pipeline (jungle, dusk):** authored over MCP (first at 48×40 in `maps/mcp4/stage*.json`; G6 rebuilt it at 128×256 in `maps/g6/mission4/`, see above) on
  the `jungle` tileset (tinted moss, mud, water, road). A river with a mud ford, a road, a pipeline of
  POLYGON_Apocalypse pipes (a `path` with objects every 6 m) and three destructible valves (the targets), a guard
  tower, searchlights, a comm post with a spinning dish, palms, ferns and bushes. Dusk is a game-side wash (FB-060).
- **Vehicles:** a patrol zone with a `vehicle` property (FB-059) is driven there and back by that sprite (`truck_drive`,
  the `drive` template in 8 directions) at `speed` m/s; its hull for the current direction is its collider. It waits
  when the Ranger is in its way (and knocks him after 1.5 s). A grenade swaps it to `truck_wreck`'s
  `intact_to_destroyed` in the same facing (FB-056), then fire and smoke.
- **Animated props:** sprites whose only move is a looping template (`searchlight`: `turret_sweep` after its head part
  was given the `turret` role; `radar_spin`: `spin`) loop wherever the map places them.

## Roster, merit, promotions and medals (G4)
The rules live in `src/roster.ts` (constants `RANK_POINTS`, `MERIT`, `MEDAL_POINTS`); this is what they say.

**Flow:** title + Ranger select (six roster slots) → mission select → mission → end screen → debriefing → mission
select (or the roster after a KIA / capture). The roster is saved in localStorage (`ar.roster.v1`): per Ranger the
name, rank, career score, medals (counts), status (active, KIA, captured), missions flown and missions accomplished.
A vacant slot enlists a new PFC (type a name); Delete twice retires a Ranger and frees the slot. Only active Rangers
can fly. A mission entered by URL (`?scene=mission&mission=…`) is flown by an unsaved guest.

**Mission merit** (never below 0):
| | points |
|---|---|
| objective destroyed | 500 × difficulty (mission 1: 1.0, 2: 1.2, 3: 1.4, 4: 1.6) |
| extraction (objective done, reached the zone) | +200 |
| each enemy soldier killed | +25 |
| each installation destroyed (targets and any other destructible) | +50 |
| time bonus on extraction | +300 × fraction of the clock left |
| early alert: the enemy alerted before the objective was done | −150 |
| …and that alert in the first two minutes | −100 more |

A clean, quick mission 1 scores about 1 300–1 400; mission 3 up to about 1 700.

**Ranks** by career merit: PFC 0, CPL 400, SGT 900, SSG 1 500, SFC 2 200, MSG 3 000, 2LT 3 900, 1LT 4 900, CPT 6 000,
MAJ 7 200, LTC 8 500, COL 10 000. At most two promotions per mission. **KIA:** the mission's merit still counts, and
the Ranger is promoted one more rank posthumously; his status becomes KIA. **Captured:** the clock ran out (the plane
left): merit for kills and installations only, no promotion beyond what the score earns, status captured.

**Medals** (one per accomplished mission, the highest whose threshold the mission merit reaches): COM1 (Army
Commendation Medal) 800, COM2 (Commendation, oak leaf cluster) 950, Bronze Star 1 100, Silver Star 1 250,
Distinguished Service Cross 1 400, Medal of Honor 1 550 and the enemy never alerted. Ribbons are drawn as stripes on
the roster and in the debriefing.

## Sound (G4)
All procedural WebAudio (`src/sound.ts`), no sample files: rifle shot (Ranger and enemy, the enemy's quieter with
distance), explosion, footsteps on the clips' `footstep_l` / `footstep_r` events (the Ranger's and nearby
Germans'), grenade throw whoosh on the `release` event, supply-pod pickup chime, UI click / confirm, an alert whistle,
a promotion fanfare, and a 16-step march drum loop on the title. M or the corner button mutes (saved).

## Arsenal and supply pods (G7)
**Flow:** mission select → **supply pod** screen → the drop. The pod screen follows the original's: the pod (a green
bag) shows what's packed, one row per item with its icon, weight and − count +, gauges for items and weight, and
CLEAR / STANDARD / DONE. Keys: Up/Down or 1–5 pick a row, Left/Right or −/+ change it, C clear, S standard, Enter
done, Esc back; on touch, tap − / + and the buttons (`fitMenu` zooms it to the phone). The last loadout is remembered
in this browser (`ar.loadout.v1`). The rules live in `src/loadout.ts`:

| item | weight | STANDARD pod | Ranger's basic carry |
|---|---|---|---|
| carbine magazine (30 rounds) | 1 | 6 | 3 (+ 1 in the carbine) |
| hand grenade | 1 | 6 | 3 |
| first-aid kit (+50 HP) | 2 | 3 | 1 |
| LAW rocket | 5 | 3 | 1 |
| time bomb | 4 | 3 | 1 |

A pod holds at most **21 items** and **45 weight** (STANDARD fills both). The **three pods** dropped with the Ranger
(the map's pod zones) each carry the chosen loadout; walking over one adds its contents (listed above him).

**Weapons** (Space / FIRE uses the selected one; 1–6 or Q select, the touch item bar above FIRE selects, and FIRE
shows its name):
- **Carbine:** 30-round magazines; firing on empty reloads (R reloads any time; the `ranger_kit` reload clip, a
  1.5 s pause when prone); no magazines left: a dry click.
- **Grenade** (2, or G as before).
- **LAW** (3): the Ranger kneels with the launcher (`ranger_law`, kneel_shoot); on its `shoot` event a slow
  `law_rocket` (16 m/s, 30 m, smoke trail) flies straight on and explodes on the first prop or soldier it meets: 300
  damage to what it hits (tanks, bunkers, vehicles have 200–300 HP), plus a 2.5 m splash. It is loud.
- **Time bomb** (4): he crouches and sets the C4 (`time_bomb`) at his feet; the fuse counts 10 s above it (ticking,
  blinking in the last 3 s), then a 5 m blast does 400 damage: it destroys any installation. Get clear.
- **Knife** (5): he turns to the nearest soldier within 1.4 m and stabs (`ranger_knife`, Knife_Stab_Fore); the
  clip's `hit` event kills him. Silent: no noise, nobody is alerted by it.
- **First aid** (6, or H, or the AID button): +50 HP, one kit.

**Installations:** besides the mission targets, every object with a destroyed state (crates, tents, containers…)
and bunkers, tanks, trucks, hangars, towers have hit points, so LAW rockets, bombs and grenades destroy them; each
counts as an installation (+50 merit), and kills by knife, LAW or bomb count as before. The game records what
destroyed what (`killedBy` / `destroyedBy`), and the end screen lists LAW shots, bombs, knife kills and first aid.

**Sprites (all generator, ssg.assets.json):** `ranger_kit` (rifle reload, crouch), `ranger_knife` (Palm City knife,
Knife_Stab_Fore trimmed to 0.9 s), `ranger_law` (BattleRoyale RPG, kneel_shoot), `law_rocket` (RPG rocket,
`projectile`, 8 directions), `time_bomb` (BattleRoyale C4), `supply_pod` (Apocalypse duffle bag), and the loadout
icons `item_mag`, `item_grenade`, `item_medkit`, `item_law`, `item_bomb` at a close-up scale (FB-070). Gaps:
FB-070–075.

## Milestones (they mirror the generator's TODO "Phase G")
| | Needs from the generator | Delivers |
|---|---|---|
| G0 | what exists today | asset pipeline (`ssg.assets.json` → `npm run assets`), Ranger moving in 8 directions on a hand-made iso field, depth sorting, first FEEDBACK |
| G1 | objects & props (Phase A) | enemy soldiers, props with states (intact/destroyed), shooting, grenades, destructible bunkers |
| G2 | tilesets (Phase B) | generated ground tilesets for the three terrains |
| G3 | maps (Phase C) | missions built only through MCP map tools: drop, 3 pods, objective, patrols, timer, extraction |
| G4 | — | mission select, roster with ranks and medals (saved in localStorage), sound |
| G5 | vehicle/prop part animations, multi-terrain tiles | living battlefield: an enemy truck driving the road (8-direction `drive` sprite, wrecked by grenades), animated props (searchlight `turret_sweep`, radar `spin`), mission 4 |
| G6 | large-map readiness (MCP region views, fast scatter) | original-scale 128×256 m maps for missions 1–4, overview map, HUD compass, culling and AI sleep for phones |
| G7 | — (gaps FB-070–075) | supply pod loadout screen, limited ammo and reload, LAW rockets, time bombs, knife, first aid; keyboard and touch item bar |
