# Feedback for Synty Sprite Generator

Every gap the game hits in the generator's CLI or MCP. The orchestrator triages entries into the generator's
`TODO.md` (section "Inbox: from Airborne Ranger"). Number the entries in order and never reuse a number.

Status: `open` → `triaged (TODO: …)` → `fixed (<commit>)` → `verified` (the game's workaround was removed).

<!-- Template
## FB-001 · <title>
- Severity: blocks | workaround | polish        Milestone: G0
- Tried: `ssg …` / MCP tool …
- Wanted: …
- Got: …
- Workaround: <file in this repo, or none>
- Suggested change: …
- Status: fixed (generator 43fccdd, wizard): re-test in the next game wave
-->

## FB-001 · phaser3 export: frame pivots are relative to the trimmed rect, Phaser reads them over the source size
- Severity: workaround        Milestone: G0
- Tried: `ssg export Character_American_Soldier_01 --class rifle … --view iso8 --ppm 32 --format phaser3 -o …`, then `load.multiatlas` + the frames' `pivot`
- Wanted: `pivot` that Phaser can use as-is. Phaser's JSON parsers set `customPivot`, and `setFrame` makes `pivot` the origin over `realWidth/realHeight` (the untrimmed `sourceSize`).
- Got: `"spriteSourceSize": {"x": 57, "y": 41, "w": 24, "h": 55}, "sourceSize": {"w": 128, "h": 132}, "pivot": {"x": 0.29167, "y": 0.92727}`. The pivot (64, 92) is divided by the *trimmed* size (24×55). Phaser places the origin at 0.927 × 132 = 122 px, so every trimmed sprite is drawn about 30 px too high and a few px off sideways. On the 66×60 crate the error is only about 1 px, so it's easy to miss.
- Workaround: `src/assets.ts` `fixPivots()` rewrites every frame to `(pivot*cut + spriteSourceSize)/real`
- Suggested change: in the phaser3 (and pixi, if it has the same code) writer, emit `pivot = pivotPx / sourceSize`. Add a test that loads the atlas into Phaser's parser and checks the feet land on the pivot.
- Re-test (G1, 2026-10-17): unchanged. A tile-locked crate frame still has `spriteSourceSize {x:3,y:4,w:84,h:76}`, `sourceSize {w:90,h:84}`, `pivot.y 0.72368` (= 55/76 of the trimmed rect). `fixPivots()` stays for the soldiers; props no longer depend on it (they're placed by the `object` anchor with `setOrigin`).
- Re-test (G2, 2026-10-17): works. Every phaser3 frame's `pivot` × `sourceSize` is the ground point (ranger 89,124 = the meta pivot in all 832 frames; crate 45,59). `fixPivots()` is removed; sprites stand on their feet.
- Status: verified

## FB-002 · No tile lock: "iso8 = 64×32 tiles" is only a hint, the scale has to be worked out by hand
- Severity: workaround        Milestone: G0
- Tried: `ssg export --help`, `ssg views` (`iso8 … "Pixel-art isometric (dimetric, 30°): 64×32 tiles."`), MCP `list_options`
- Wanted: `--tile 64x32` (or a project setting) that locks ppm and says how many metres one tile is, and writes `tile: {w:64,h:32,metres:…}` into the export/meta, so characters, props and later tilesets share one grid by contract.
- Got: only `--ppm`. I had to work out that 64 px across a diamond means tile edge × √2 × ppm = 64, so I chose ppm 32 (tile edge √2 m). Nothing in the export records the tile size. The Unity format description mentions a "scale lock", but the CLI doesn't expose it.
- Workaround: `ssg.assets.json` `"ppm": 32`. The comment in `src/iso.ts` explains the maths.
- Suggested change: `--tile WxH[:metres]` on export/preview/sprite, resolved to ppm by the view. Put the tile in `meta.json`, the manifests and `ssg views --json`.
- Re-test (G1, 2026-10-17): works. Every sprite is exported with `--tile 64x32 --metres-per-tile 1` (`ssg.assets.json` `tile`/`metresPerTile`); all seven report `pixelsPerMetre 45.2548`, props report `object.tiles` (bunker 6×8, crate 2×2…). The hand-worked `ppm` is gone; the game reads ppm from the manifest. One gap is left, filed as FB-019 (no tile record in a character's meta).
- Status: verified

## FB-003 · Model names aren't unique across packs, and there's no pack-qualified name
- Severity: workaround        Milestone: G0
- Tried: `ssg export SM_Env_Tree_01 -t still …`. Also `ssg assets Tree --pack POLYGON_War` and `ssg assets POLYGON_War/SM_Env_Tree_01`.
- Wanted: the POLYGON_War tree, declared by name in `ssg.assets.json`, portable to any machine.
- Got: the export silently used **POLYGON_City**'s `SM_Env_Tree_01` (id 189) with no warning. `--pack` only takes a numeric id (`ssg: not a number: POLYGON_War`), and `Pack/Name` finds nothing. Ids aren't portable between generator databases.
- Workaround: `scripts/build-assets.mjs` `resolveAsset()` runs `ssg --json assets <name>`, keeps the declared pack and exports by id.
- Suggested change: accept `POLYGON_War/SM_Env_Tree_01` (or `name@pack`) everywhere a model is named (CLI, MCP, `--with`). Warn or fail when a bare name is ambiguous. Let `--pack` take a pack name.
- Re-test (G1, 2026-10-17): works. `ssg.assets.json` names every model and `--with` item as `POLYGON_War/…`; `resolveAsset()` is removed. A bare `SM_Env_Tree_01` now warns ("is in 5 packs … using POLYGON_City/SM_Env_Tree_01 (#189). Name it as Pack/Model") on stderr and in the JSON `warnings`.
- Status: verified

## FB-004 · `--class` ignores `--anim`/`--set`: you always get the whole 13-clip gunner moveset
- Severity: workaround        Milestone: G0
- Tried: `ssg export Character_American_Soldier_01 --class rifle --anim Idle_Standing,Walk_F,Run_F,Rifle_Shoot,Rifle_Death -t prone_idle -t crawl …` and `--class rifle --set builtin_locomotion`
- Wanted: the rifle moveset's carry pose and grip (without `--class` the rifle hangs from one hand and `Rifle_Shoot` points it at the sky), but only the clips each character needs. The German needs idle/walk/shoot/death.
- Got: both commands rendered all 13 clips (`rifle_idle … rifle_death`) and silently dropped my clip list. Each soldier is one 4094×1771 atlas (4.7 MB PNG + 0.6 MB atlas JSON + 1.5 MB meta.json).
- Workaround: accepted the full moveset for both soldiers (`ssg.assets.json` `"class": "rifle"`). The enemy carries 9 clips it never plays.
- Suggested change: with `--class`, `--anim`/`--set`/`-t` pick the subset (by moveset label, e.g. `--moves idle,walk,shoot,death`). If you keep the current behaviour, at least warn that the flags were ignored.
- Re-test (G1, 2026-10-17): works. `--class rifle --anim idle,walk,run,shoot,prone_idle,crawl,prone_shoot,throw,death` renders exactly those 9 moves for the Ranger, and `--anim idle,walk,shoot,death` renders 4 for the German (1.8 MB instead of ~6.8 MB).
- Status: verified

## FB-005 · No throw (grenade) move, and the procedural combat templates aren't listed
- Severity: workaround        Milestone: G0
- Tried: `ssg animations Throw`, `ssg animations Grenade`, `ssg sets`, MCP `list_options` (templates)
- Wanted: a `throw` / `grenade_throw` move for the Ranger (grenades are a core weapon in Airborne Ranger), like the procedural `aim_shoot`, `prone_idle` and `crawl`.
- Got: no clip and no template. `prone_idle`, `crawl`, `kneel_shoot`, `aim_shoot` and `reload_gesture` exist (they're the builtin_gunner fallbacks, and `-t prone_idle` works), but `list_options`/`--help` don't list them. `still`, which every prop export needs, isn't listed either.
- Workaround: none yet (no grenades in G0; G1 needs it).
- Suggested change: add a procedural `throw` (overhand and underhand, with a `release` event and a hand socket) to builtin_gunner. List every template (character combat, `still`) in `list_options` and `ssg export --help`.
- Re-test (G1, 2026-10-17): works. `--anim …,throw` gives `rifle_throw` (12 frames) with a `release` event at frame 5. The game spawns the grenade at that frame's `hand_l` socket (`Field.throwGrenade()`), arcs it 8 m and explodes it. `ssg templates` lists every template, `still` and `throw` included.
- Status: verified

## FB-006 · Props have no footprint, collision shape or ground anchor; the only size is a T-pose bounding box
- Severity: workaround        Milestone: G0
- Tried: `ssg --json assets SM_Bld_Bunker_01` (size `[5.96, 3.06, 7.62]`), and the export JSON/meta of `-t still --dirs 4d` props
- Wanted: for each rendered prop direction, a footprint in tiles or metres (rotated with the direction), a collision polygon on the ground in frame pixels, and a sort anchor (front-most ground point or base line) for iso depth sorting. The DESIGN's "object sprites with footprints and collision polygons" can't be built without them.
- Got: the export has only `pivot`. Prop exports have no `meta.json`. The asset size is a model AABB (characters report `2.048 m` wide: the T-pose arm span).
- Workaround: `src/scenes/Field.ts` uses circle colliders from the asset size (`min(x,z)/2`). Depth uses the pivot, so a large bunker sorts by its centre. `scripts/build-assets.mjs` copies `size` into the manifest.
- Suggested change: write `footprint` (ground polygon per direction, in px and m), `collision` and `sortAnchor` into every still/prop export and its meta. This is Phase A's object metadata.
- Re-test (G1, 2026-10-17): works. Props are placed by `object.directions[].anchor` on the centre of their `tiles` u×v block and collide with the per-direction `polygon` (converted to metres). Characters sort against a prop by its outline's front edge. The size-based circles and the manifest `size` are gone. Trees still need a trunk collider: FB-017.
- Status: verified

## FB-007 · Animation keys aren't namespaced: two characters' phaser3 anims collide
- Severity: workaround        Milestone: G0
- Tried: loading `Character_American_Soldier_01_anims.json` and `Character_German_Soldier_01_anims.json` with `anims.fromJSON`
- Wanted: both soldiers in one scene.
- Got: both define `rifle_idle_E`, `rifle_walk_E`… Phaser's animation manager is global, so the second set is skipped and the German would play the American's frames.
- Workaround: `src/assets.ts` creates the anims itself as `<sprite>:<clip>_<dir>` and points them at a per-sprite texture key.
- Suggested change: prefix keys with the base or texture key (`Character_German_Soldier_01/rifle_idle_E`), or add an option (`--anim-prefix`). Keep frame `key` and the atlas key consistent.
- Re-test (G1, 2026-10-17): unchanged (still open): both soldiers export `rifle_idle_E`…, so the `<sprite>:` prefix stays.
- Re-test (G2, 2026-10-17): works. Keys are `Character_American_Soldier_01/rifle_idle_E`, `Character_German_Soldier_01/rifle_idle_E`. The game registers them as exported (`animKey()` = manifest `animPrefix` + clip + dir); the `<sprite>:` prefix is gone.
- Status: verified

## FB-008 · `speedMps` is missing for the walk and wrong for the run and death
- Severity: workaround        Milestone: G0
- Tried: the Ranger's `Character_American_Soldier_01.meta.json` `clips[].speedMps`
- Wanted: the ground speed of each locomotion clip, so the game moves at `speedMps` and the feet don't slide (README: "play walk/run cycles at speed / speedMps").
- Got: `rifle_walk` has none, `rifle_crawl` none, `rifle_run` 0.077 m/s and `rifle_death` 24.9 m/s.
- Workaround: `src/scenes/Field.ts` `SPEED` hand-tuned (walk 1.5, run 3.6, crawl 0.5 m/s).
- Suggested change: for in-place clips, measure the stride from foot contacts and write the speed; never write it for one-shots. Write it for procedural crawl/crouch_walk too.
- Re-test (G1, 2026-10-17): works. `rifle_walk 1.22`, `rifle_run 2.81`, `rifle_crawl 0.6` m/s; one-shots (shoot, throw, death) have none. `SPEED` is gone: the Ranger moves at the clip's `speedMps`.
- Status: verified

## FB-009 · False `style_without_weapon` warning when the rifle is equipped
- Severity: polish        Milestone: G0
- Tried: `ssg export Character_American_Soldier_01 --class rifle --with SM_Wep_American_Rifle_01 --with SM_Char_Attach_American_Helmet_01 …`
- Wanted: no warning. The rifle is in the hands in every frame (checked on a contact sheet).
- Got: `validation: [{"level":"warn","code":"style_without_weapon","message":"Rifle moves have no rifle weapon equipped: they render empty-handed"}]` in the export JSON. The same happens for the German. With the generic format the CLI's own `--json` result also said `"validation": []` while the file had the warning.
- Workaround: none (the build just prints it).
- Suggested change: count a non-layered (baked) `--with` weapon of the class as equipped. Make the CLI result and the file report the same validation.
- Re-test (G1, 2026-10-17): works. Both soldiers export with `validation: []` in the CLI result. (The phaser3 `meta.json` no longer has a `validation` key at all, so the file and the result can't disagree.)
- Status: verified

## FB-010 · No ground tiles
- Severity: workaround        Milestone: G0
- Tried: `ssg assets Grass`, `ssg views`, `ssg export --help`: nothing makes a 64×32 ground tile
- Wanted: 64×32 diamond ground tiles (grass, dirt, sand, snow) and transitions at the iso8 scale. (Expected: generator Phase B.)
- Got: none.
- Workaround: `src/scenes/Field.ts` `drawGround()` draws procedural diamonds.
- Suggested change: Phase B tilesets. The tile size should come from the same tile lock (FB-002).
- Re-test (G2, 2026-10-17): works. `ssg tileset create temperate` + terrains grass, dirt (`--blend grass --variants 2`), sand (same) → 62 seamless corner tiles, exported with `-f tsj` into `public/assets/tilesets/temperate/`. `drawGround()` now builds a Phaser isometric tilemap from the corner wangset (`src/ground.ts`); the procedural diamonds are gone. Gaps: FB-022, FB-023, FB-024.
- Status: verified

## FB-011 · An 8.6 s idle clip and no way to cap or trim frames per export
- Severity: polish        Milestone: G0
- Tried: `--class rifle` (it picks the uploaded `Rifle_Idle`, 258 frames)
- Wanted: a short idle loop. At fps 10 the idle is 86 frames × 8 directions = 688 of the soldier's ~2200 frames.
- Got: 86 idle frames. `ssg clip --trim` exists, but it changes the clip for every character and every user of the generator, so a game can't use it from its own build.
- Workaround: none (fps 10 keeps it to one 4 K atlas page).
- Suggested change: an export-level `--max-frames n` or a per-clip `--trim clip=a..b` that doesn't touch the shared clip. Or prefer a short idle for the rifle moveset.
- Re-test (G1, 2026-10-17): works. `--max-seconds 2` (`ssg.assets.json` `maxSeconds`, characters only) cuts the idle to 10 frames (was 86).
- Status: verified

## FB-012 · The CLI tries to rebuild the generator web app when the shared server is briefly unreachable
- Severity: polish        Milestone: G0
- Tried: `npm run assets` (a sequence of `ssg --json export …`) while another session was working on the generator
- Wanted: wait or retry for the server that's already running, or fail with "server on 5181 not reachable".
- Got: two exports and one `ssg assets` failed with `ssg: Command failed: npm run build -w apps/web` and an esbuild error from someone else's half-edited `apps/web` source (a conflict marker). The server was up again seconds later (`ssg server status` → running).
- Workaround: the build retries each export once. Re-running the failed names worked (`node scripts/build-assets.mjs german bunker`).
- Suggested change: if a server answered recently, or a pid file exists, retry the connection for ~30 s before auto-starting. Never rebuild the web app from a consumer's export call. Show the real cause (server unreachable).
- Re-test (G1, 2026-10-17): the build's own retry is removed, and seven exports in a row went through. (No server outage happened during the build, so the retry path itself wasn't exercised.)
- Status: verified

## FB-013 · Props in iso8 with `--dirs 1` render square to the screen, off the iso grid
- Severity: polish        Milestone: G0
- Tried: `ssg export SM_Bld_Bunker_01 … -t still --view iso8 --ppm 32 --dirs 1`
- Wanted: a prop aligned to the 64×32 diamond grid (walls along the tile edges).
- Got: direction `S` (world 270°): the bunker's faces are square to the screen and its edges cross the diamonds. `--dirs 4d` gives the four aligned facings (NE/NW/SW/SE), which is what an iso game needs. That's not documented, and `--dirs 1` is the default the example consumer script uses for props.
- Workaround: `ssg.assets.json` uses `"dirs": "4d"` for every prop.
- Suggested change: for iso views, default prop stills to `4d`, or make `--dirs 1` render the NE (grid-aligned) facing. Say so in the README.
- Re-test (G2, 2026-10-17): works. Without `dirs`, bunker, tree and crate export one `SE` facing (`facing: +u`); sandbags and wire with `facings: 2` export `SE` and `SW` (1×4 and 4×1 tiles). `dirs: "4d"` is removed from every prop.
- Status: verified

## FB-014 · `ssg resolve` reads "isometric" as top-down and picks generic gear for an American soldier
- Severity: polish        Milestone: G0
- Tried: `ssg resolve "an american soldier with a rifle and a helmet, isometric 8 directions, for phaser"`
- Wanted: `Character_American_Soldier_01` (or SK_Chr…), `SM_Wep_American_Rifle_01`, `SM_Char_Attach_American_Helmet_01`, view iso8.
- Got: `View: Top-down, 8 directions ("8 directions, isometric")`, `weapon: SM_Wep_Rifle_01`, `head: SM_Chr_Attach_Helmet_01`, and `AI unavailable: timed out after 15 s` (it took 15 s even with the AI off or unavailable).
- Workaround: none needed (I name models explicitly).
- Suggested change: let "isometric" win over "8 directions" in the view matcher. Prefer equipment from the model's own pack or faction words ("american", "german"). Skip the AI or time it out fast when it's unavailable.
- Status: triaged (TODO: Inbox / Phase A–B, generator 2026-10-17)

## FB-015 · CLI table output crashes with EPIPE when piped into `head`
- Severity: polish        Milestone: G0
- Tried: `ssg animations Idle | head -14`
- Wanted: a quiet exit.
- Got: `Error: write EPIPE … Unhandled 'error' event` and a Node stack trace on stderr.
- Workaround: none.
- Suggested change: handle `EPIPE` on stdout (`process.stdout.on('error', e => e.code === 'EPIPE' && process.exit(0))`).
- Re-test (G1, 2026-10-17): works. `ssg animations Idle | head -3` exits 0 with no stack trace.
- Status: verified

## FB-016 · `ssg export` progress sits at 0 % for the whole render, so a slow render looks like a hang
- Severity: polish        Milestone: G1
- Tried: `npm run assets` (each export is `ssg --json export …`, rendered in software/SwiftShader mode), reading the CLI's progress lines on stderr
- Wanted: progress that moves while frames render (frames done / total, or per clip), so a build can tell a slow software render from a stuck one.
- Got: `[batch 154] running · CPU 0% exporting Character_American_Soldier_01 (1/1)` for the whole ~40 s render, then straight to `95% … writing files`. `ssg batch list` at the same moment showed `progress: 0.95`, so the server knows more than the CLI prints.
- Workaround: `scripts/build-assets.mjs` stops an export only after 4 minutes with no new progress line. A long software render (a big moveset in 8 directions) could trip that while still working.
- Suggested change: print the item's progress (and frames done/total) in the CLI's progress line every few seconds while rendering.
- Re-test (G2, 2026-10-17): works. The progress line moves every few seconds: `[batch 174] running · CPU 22% 616/3328 frames, ~7:28 left …: rendered 616/3328 frames (measuring)`. The 4-minute stall limit stays as a safety net.
- Status: verified

## FB-017 · A tree's collision polygon is its whole canopy
- Severity: workaround        Milestone: G1
- Tried: `ssg export POLYGON_War/SM_Env_Tree_01 -t still --dirs 4d --view iso8 --tile 64x32 --metres-per-tile 1 --format phaser3`, then the meta's `object` block
- Wanted: a ground collider for what stands on the ground (the trunk, about 0.5 m across). Soldiers walk under the branches.
- Got: `footprint 5.02 × 5.677 m`, `tiles 6×6`, and `collision` = the convex hull of the whole mesh seen from above, so the tree blocks an area about 5 m wide. The footprint and tiles are fine for placement; the collider isn't.
- Workaround: `src/scenes/Field.ts` `TRUNK` (`// FB-017`): trees collide with a 0.35 m circle at the model origin (the frame pivot) and sort by it.
- Suggested change: build `collision` from the vertices near the ground (e.g. below 0.5–1 m, or the lowest 10 % of the height) for vegetation and anything with an overhang, or offer `--collision base|hull`. Keep `footprint`/`tiles` from the full hull.
- Re-test (G2, 2026-10-17): works. The tree's `object.collision` is `{source: "base", cut: 0.5}` (a ~0.65 m trunk hull), the whole hull is `object.canopy`, and `directions[].polygon` follows the trunk. The `TRUNK` circle is removed; trees collide with `polygon` and sort by its lowest point.
- Status: verified

## FB-018 · Idle, walk and run clips carry a `shoot` event
- Severity: polish        Milestone: G1
- Tried: `ssg export POLYGON_War/Character_American_Soldier_01 --class rifle --anim idle,walk,run,shoot,… --max-seconds 2`, the meta's `clips[].events`
- Wanted: `shoot` only on the shooting moves, so a game can fire the bullet from the event.
- Got: `rifle_idle` `{frame 2, shoot}`, `rifle_walk` `{frame 3, shoot}` and `rifle_run` `{frame 5, shoot}`, besides the footsteps. (The idle event moved from frame 44 to frame 2 with `--max-seconds`.) A game that fires on every `shoot` event would shoot while standing still.
- Workaround: none (the game fires from the shoot moves themselves and ignores events on loops).
- Suggested change: put the automatic key event only on attack/shoot/cast clips, never on locomotion and idles.
- Re-test (G2, 2026-10-17): works. Events are now only footsteps on walk/run/crawl, `shoot` on the shoot moves, `release` on throw, `dead` on death; idle has none.
- Status: verified

## FB-019 · A character's meta has no tile-lock record
- Severity: polish        Milestone: G1
- Tried: the Ranger's `Character_American_Soldier_01.meta.json` from a `--tile 64x32 --metres-per-tile 1` export
- Wanted: the tile lock written down (e.g. `tile: {w:64, h:32, metresPerTile:1, shape:"diamond"}`), as FB-002 asked, so a game can check that every sprite shares one grid.
- Got: only `pixelsPerMetre: 45.2548`. Props have it inside `object.tiles` (`tilePx 64, metresPerTile 1`); characters have nothing.
- Workaround: `scripts/build-assets.mjs` checks that every sprite reports the same `pixelsPerMetre` and writes the tile from `ssg.assets.json` into the manifest.
- Suggested change: write a top-level `tile` block into every meta.json, generic JSON and layers manifest under a tile lock.
- Re-test (G2, 2026-10-17): works. Every meta (characters and props) has `scale: {mode: "tile", pixelsPerMetre: 45.2548, tilePx: 64, tileHeightPx: 32, metresPerTile: 1, shape: "diamond"}`. `build-assets.mjs` checks every sprite's `scale` against `ssg.assets.json` and copies it into the manifest.
- Status: verified

## FB-020 · Assets built with `ssg export` don't show up in the generator app
- Severity: blocks (visibility)        Milestone: G1
- Tried: `scripts/build-assets.mjs` → `ssg export` per asset
- Wanted: the game's sprites visible and editable in the app (Projects → Sprites), like a user would use it
- Got: anonymous batches only; no "Airborne Ranger" project, nothing in the gallery (raised by the user)
- Workaround: none
- Suggested change: declarative sprites in a project, kept in sync by the build script
- Re-test (G2, 2026-10-17): works. `ssg.assets.json` has `"project": "Airborne Ranger"`; `npm run assets` runs `ssg sprite apply ssg.assets.json --render --download public/assets`. `ssg sprites --project "Airborne Ranger"` lists ranger, german, bunker, sandbags, wire, tree, crate (project 4, "Isometric, 8 directions · tile lock 64×32 (1 m) · Phaser 3"); the tileset `temperate` is in the same project. A second run prints `unchanged · up to date` for all seven, renders nothing and leaves the PNGs byte-identical (5.6 s). One difference from `ssg export`: FB-021.
- Status: verified

## FB-021 · `sprite apply` renders `with` equipment as separate layers, so the base sheet has no rifle or helmet
- Severity: workaround        Milestone: G2
- Tried: `ssg sprite apply ssg.assets.json --render --download public/assets` with the same ranger/german entries `ssg export` rendered before (`class rifle`, `with: [rifle, helmet]`, no `layered` key)
- Wanted: the same output as `ssg export` with those keys: one sheet with the rifle and helmet baked in.
- Got: a layered render: `<base>.json`/`_0.png` (a bald soldier with empty hands), `<base>_head…`, `<base>_weapon…` and `<base>.layers.json`; 3328 frames instead of 832 (~5 min instead of ~50 s on CPU). A game that loads `<base>.json` as before draws soldiers without rifles or helmets and gets no warning. Sizes, clips, events, speeds, `scale` and the `object` blocks were otherwise identical to the export path.
- Workaround: `ssg.assets.json` sets `"layered": false` on both soldiers; `scripts/build-assets.mjs` warns when a downloaded folder has a `.layers.json`.
- Suggested change: make an apply entry render what `ssg export` renders for the same keys (bake `with` unless `layered: true`), or say in the apply result that the sprite will be layered and why. The README's apply section should state the default.
- Status: open

## FB-022 · Tileset texture terrains: no way to find a ground texture, and a missing one is accepted silently
- Severity: polish        Milestone: G2
- Tried: `ssg tileset terrain add temperate grass --texture Terrain/Grass_01.png` (the README's example path), then `ssg tileset render`. To find a real one: `ssg assets Ground|Grass|Dirt|Sand|Terrain`, MCP `get_asset` on POLYGON_War `SM_Env_Dirt_Mound_01` and POLYGON_Apocalypse `SM_Generic_Ground_01`
- Wanted: a Synty ground texture (grass, dirt) for the temperate terrain, found through the CLI/MCP; a warning if the path doesn't exist.
- Got: no command lists pack textures. `get_asset` only shows the packs' palette atlases (`PolygonWar_Texture_01_A.png`…), which aren't tileable ground. The made-up path was stored with no warning at add or render (README: "drawn in its tint or kind colour, with a warning"); the terrain came out in a flat colour and its wang colour in the .tsj was `#808080`.
- Workaround: palette terrains (grass, dirt, sand kind colours with noise).
- Suggested change: `ssg tileset textures [search]` / MCP `search_textures` listing tileable textures in the installed packs (with a thumbnail); fail or warn on `terrain add` when `--texture` resolves to nothing.
- Status: open

## FB-023 · Tilesets: a lone terrain has no tile, and only one blend per terrain
- Severity: polish        Milestone: G2
- Tried: `ssg tileset terrain add temperate grass` (alone), then `dirt --blend grass`, `sand --blend grass`
- Wanted: a grass tile as soon as grass exists, and dirt↔sand transitions (so a map can run a dirt road through sand).
- Got: `0 tiles` until a blended terrain was added. `--blend` takes one terrain, and there's no command to add a transition pair between two existing terrains, so dirt and sand can never touch.
- Workaround: `src/scenes/Field.ts` keeps dirt and sand apart in its corner grid; `src/ground.ts` draws a corner set without a tile as grass (`// FB-023`).
- Suggested change: give every terrain its full tile(s) on add; let `--blend` take a list, plus `ssg tileset blend add <tileset> <a> <b>`.
- Status: open

## FB-024 · Tilesets can't be declared like sprites
- Severity: polish        Milestone: G2
- Tried: keeping the ground tileset in `ssg.assets.json` next to the sprites, rebuilt by `npm run assets`
- Wanted: `ssg tileset apply` (or a `tilesets` section that `ssg sprite apply` understands) that creates/updates a tileset and its terrains by name and exports it, with the same "unchanged" semantics as `sprite apply`.
- Got: only imperative `create` / `terrain add` / `terrain remove` (and no `tileset delete`). A changed terrain (colour, variants) isn't picked up by a re-run unless it's removed first.
- Workaround: `scripts/build-assets.mjs` `buildTileset()` (`// FB-024`) reads `ssg.assets.json` `tilesets`, creates the tileset if missing, adds missing terrains by name and exports `-f tsj`. Changing a declared terrain needs a manual `ssg tileset terrain remove`.
- Suggested change: a declarative `ssg tileset apply <file>` (MCP `apply_tilesets`).
- Status: open
