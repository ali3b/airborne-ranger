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
| objective destroyed | 500 × difficulty (mission 1: 1.0, 2: 1.2, 3: 1.4) |
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

## Milestones (they mirror the generator's TODO "Phase G")
| | Needs from the generator | Delivers |
|---|---|---|
| G0 | what exists today | asset pipeline (`ssg.assets.json` → `npm run assets`), Ranger moving in 8 directions on a hand-made iso field, depth sorting, first FEEDBACK |
| G1 | objects & props (Phase A) | enemy soldiers, props with states (intact/destroyed), shooting, grenades, destructible bunkers |
| G2 | tilesets (Phase B) | generated ground tilesets for the three terrains |
| G3 | maps (Phase C) | missions built only through MCP map tools: drop, 3 pods, objective, patrols, timer, extraction |
| G4 | — | mission select, roster with ranks and medals (saved in localStorage), sound |
