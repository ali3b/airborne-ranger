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
- Re-test (G3): removed `"layered": false` from both soldiers. The first `npm run assets` reported every sprite `updated` (plan "No changes", nothing rendered), the second `unchanged`. No `.layers.json`; the sheets still have the rifle and helmet baked in (checked `rifle_shoot_SE_0` of both), 832 (ranger) and 368 (german) frames as before. The `layered: false` workaround is gone.
- Status: verified

## FB-022 · Tileset texture terrains: no way to find a ground texture, and a missing one is accepted silently
- Severity: polish        Milestone: G2
- Tried: `ssg tileset terrain add temperate grass --texture Terrain/Grass_01.png` (the README's example path), then `ssg tileset render`. To find a real one: `ssg assets Ground|Grass|Dirt|Sand|Terrain`, MCP `get_asset` on POLYGON_War `SM_Env_Dirt_Mound_01` and POLYGON_Apocalypse `SM_Generic_Ground_01`
- Wanted: a Synty ground texture (grass, dirt) for the temperate terrain, found through the CLI/MCP; a warning if the path doesn't exist.
- Got: no command lists pack textures. `get_asset` only shows the packs' palette atlases (`PolygonWar_Texture_01_A.png`…), which aren't tileable ground. The made-up path was stored with no warning at add or render (README: "drawn in its tint or kind colour, with a warning"); the terrain came out in a flat colour and its wang colour in the .tsj was `#808080`.
- Workaround: palette terrains (grass, dirt, sand kind colours with noise).
- Suggested change: `ssg tileset textures [search]` / MCP `search_textures` listing tileable textures in the installed packs (with a thumbnail); fail or warn on `terrain add` when `--texture` resolves to nothing.
- Re-test (G4, 2026-10-17): works. `ssg textures sand|dirt|rock|grass` lists pack textures with kind and size; the temperate grass is now `POLYGON_Generic_v3/Textures/Generic_Grass.png` at scale 4 and the desert tileset uses Palm City `Sand_01`, Generic `Dirt` (tinted `#b48c5c`) and Generic `Rock`. A made-up path (`Terrain/Grass_99.png`) is refused on apply with the five closest matches. Gap: `ssg tileset apply --dry-run` accepts the made-up path (FB-047).
- Status: verified

## FB-023 · Tilesets: a lone terrain has no tile, and only one blend per terrain
- Severity: polish        Milestone: G2
- Tried: `ssg tileset terrain add temperate grass` (alone), then `dirt --blend grass`, `sand --blend grass`
- Wanted: a grass tile as soon as grass exists, and dirt↔sand transitions (so a map can run a dirt road through sand).
- Got: `0 tiles` until a blended terrain was added. `--blend` takes one terrain, and there's no command to add a transition pair between two existing terrains, so dirt and sand can never touch.
- Workaround: `src/scenes/Field.ts` keeps dirt and sand apart in its corner grid; `src/ground.ts` draws a corner set without a tile as grass (`// FB-023`).
- Suggested change: give every terrain its full tile(s) on add; let `--blend` take a list, plus `ssg tileset blend add <tileset> <a> <b>`.
- Re-test (G3, maps): it bites maps harder. A river `path` with `edge: sand, edgeWidth: 1` puts water, sand and grass corners in one cell (54 cells drawn as a pure fallback tile); `edgeWidth: 2` fixes the bank. The biome's sand/dirt patches next to roads and trenches give sand|dirt, mud|sand mixes; running a second `generate` after the paths with `keep: [water, sand, road, mud, dirt]` keeps a grass ring and fixed those. Left: 10 cells where the road meets the sand ford (road↔sand has no tiles, road can only blend with grass).
- Re-test (G4, 2026-10-17): works. Pure tiles come with every terrain, and the temperate tileset declares `pairs` incl. road↔sand and dirt↔sand; the desert one `pairs: "all"`. The ford's 10 fallback cells are down to 4, all three-terrain mixes (grass|sand|road in one cell) that no corner pair can draw; mission 2 has 19 such cells (rock|sand|dirt). `src/ground.ts`'s FB-023 fallback is now a plain base-terrain fallback, and it picks variants by position (`noisePeriod` + tile `variant`). The three-terrain cells are FB-038's business.
- Status: verified

## FB-024 · Tilesets can't be declared like sprites
- Severity: polish        Milestone: G2
- Tried: keeping the ground tileset in `ssg.assets.json` next to the sprites, rebuilt by `npm run assets`
- Wanted: `ssg tileset apply` (or a `tilesets` section that `ssg sprite apply` understands) that creates/updates a tileset and its terrains by name and exports it, with the same "unchanged" semantics as `sprite apply`.
- Got: only imperative `create` / `terrain add` / `terrain remove` (and no `tileset delete`). A changed terrain (colour, variants) isn't picked up by a re-run unless it's removed first.
- Workaround: `scripts/build-assets.mjs` `buildTileset()` (`// FB-024`) reads `ssg.assets.json` `tilesets`, creates the tileset if missing, adds missing terrains by name and exports `-f tsj`. Changing a declared terrain needs a manual `ssg tileset terrain remove`.
- Suggested change: a declarative `ssg tileset apply <file>` (MCP `apply_tilesets`).
- Re-test (G4, 2026-10-17): works. `ssg.assets.json` `tilesets` (with `noisePeriod`, `variants`, texture terrains, `pairs`) goes through the same `sprite apply - --render --download public/assets` as the sprites, which writes `public/assets/tilesets/<name>/`. `buildTileset()` is gone from `scripts/build-assets.mjs`; changing a terrain (the desert dirt tint) is picked up by a re-run ("updated", 7 s). The temperate atlas redrew once (152 → 1006 tiles).
- Status: verified

## FB-025 · `ssg props list` doesn't list vehicles, so the intact tank can't be found there (only its wreck)
- Severity: polish        Milestone: G1
- Tried: `ssg props list Tank --damaged`, `ssg props list --pack POLYGON_War --damaged --limit 400`, `ssg props list --category vehicle`
- Wanted: `SM_Veh_German_Tank_01` with `states intact,destroyed`, like `SM_Bld_Barn_01` shows `intact,damaged`.
- Got: only the wreck `SM_Veh_German_Tank_Destroyed_01` (category `wreck`, states `intact,destroyed`); the intact tank is kind `vehicle` with an empty category (`ssg assets POLYGON_War/SM_Veh_German_Tank_01`) and `--category vehicle` is refused (`category must be one of building, …`). `ssg props states POLYGON_War/SM_Veh_German_Tank_01` does find the pair.
- Workaround: none needed (named the tank from the brief).
- Suggested change: include `vehicle` kind models in `props list` (they're the commonest destructibles), or add a `vehicle` category; list the wreck under its intact model instead of as a separate row.
- Re-test (G4, 2026-10-17): works. `ssg props list Tank` lists `SM_Veh_German_Tank_01` (category vehicle, states intact,destroyed) and `props list Truck` the trucks; mission 2's truck (`POLYGON_BattleRoyale/SM_Veh_Truck_01`) was found there.
- Status: verified

## FB-026 · Apply entries with `states`: the README example is refused, and a vehicle defaults to 8 directions
- Severity: polish        Milestone: G1
- Tried: `{ "name": "tank", "asset": "POLYGON_War/SM_Veh_German_Tank_01", "template": "still", "states": "auto,destroyed@destroy" }` (the README's apply example has `"template": "still", "slice": "columns", "states": "auto"` on the bunker)
- Wanted: the entry accepted (still + states is what the object is), and one grid-aligned facing like other props (FB-013).
- Got: `ssg: sprites[7] (tank): states are the sprite's moves; leave out anim, template, set and class (or drop states).` Without `template` it rendered, but in **8 directions**: 152 frames of 442×348, a 9.0 MB + 0.36 MB two-page atlas (the large bunker, kind prop, got one SE facing). With `"facings": 2`: 38 frames, 2.5 MB.
- Workaround: `ssg.assets.json` drops `template` on state entries and sets `"facings": 2` on the tank.
- Suggested change: accept (ignore) `template: "still"` next to `states`, and fix the README example; give vehicles exported as objects (with `states`) the same one-facing default as props.
- Re-test (G4, 2026-10-17): works. The tank entry is `template: "still"` + `states` again (accepted), with no `facings`: it rendered one SE facing (19 frames instead of 38). The truck entry is declared the same way.
- Status: verified

## FB-027 · `intact_to_destroyed` ends on an empty frame and never shows the wreck; the hull flips over
- Severity: workaround        Milestone: G1
- Tried: tank `states: "auto,destroyed@destroy"` (`destroy` defaults), played in game: `intact_to_destroyed_SE` (17 frames at 10 fps, 1.7 s, `impact` event on frame 0) then `destroyed_SE`
- Wanted: a transition that reads as "the tank blows up and becomes this wreck": parts burst and settle and the last frame matches (or crossfades into) the `destroyed` still, so an engine can switch with no pop.
- Got: the frame size, pivot and anchor are shared as documented (442×348, every clip), so placement is right. But the intact tank's parts fly apart like a toy: the whole hull rotates upside down (frames 3–12 show its flat underside), both tracks are thrown upright above it and are cropped at the frame top in frames 5–7, the turret tumbles off the front, and from frame 12 everything fades to an empty frame. The rusted wreck (a different model) then pops in. At 1.7 s the first half reads well; the second half is a fading grey slab.
- Workaround: `src/scenes/Field.ts` `destroyProp()` (`// FB-027`) draws the `destroyed` frame under the transition and fades it in over the transition's last 40 %.
- Suggested change: let the destroy template end in the target state: crossfade the target state model in while the parts fade (it's already loaded under the same root), or a `settle` option. Weight the launch by part size so the hull lifts and drops instead of flipping, and clamp rotation of the largest part.
- Re-test (G4, 2026-10-17): works. `intact_to_destroyed_SE` (17 frames) ends on the wreck: the last frames are the `destroyed` still, the hull no longer flips (it tilts a little while the tracks and wheels fly), nothing leaves the frame. The crossfade (frames 11–13) is a little ghostly. The wreck fade-in in `destroyProp()` is removed: the game plays the transition and then `destroyed`, with no pop.
- Status: verified

## FB-028 · No transition for single-mesh models; the War bunkers have no destroyed state, the large one's damaged state is almost identical
- Severity: workaround        Milestone: G1
- Tried: `ssg props states POLYGON_War/SM_Bld_Bunker_01` (the game's bunker): `no damaged or destroyed versions found`. Picked `POLYGON_War/SM_Bld_Bunker_Large_01` (`ssg props list --damaged` → `intact,damaged`) with `states: "auto,damaged@destroy"`.
- Wanted: a destructible bunker: some transition and a clearly broken end state.
- Got: `validation warn:state_clip_skipped` (`intact_to_damaged: destroy does not apply to SM_Bld_Bunker_Large_01`): only `intact` and `damaged` (608×532, 1 facing). `SM_Bld_Bunker_Large_Damaged_01` differs from the intact model by one chipped corner with rebar on the far side; side by side at tile scale it's hard to tell which is which. Its collision is nearly the same (`sameAsBase: false`, 10.17 vs 10.06 m deep).
- Workaround: `src/scenes/Field.ts` `destroyProp()` (`// FB-028`): a dust burst hides the swap and the damaged state is scorched with a tint.
- Suggested change: a fallback transition for single meshes (`hit_shake` + sink/dust, or `collapse`: shear down and crossfade to the target state) usable as `damaged@hit_shake`; and a generated `burnt` state (charred texture tint) for models without a damaged file, so the plain bunker can be destroyed too.
- Re-test (G3): the depot's shipping container (`POLYGON_Apocalypse/SM_Prop_Shipping_Container_01`, `states: "auto,damaged@destroy"`) gets `state_clip_skipped` too, and the crate pile, barrel pile and camo-net tent have no damaged model at all. `src/scenes/Field.ts` `destroyProp()` (`// FB-028`) now also blasts stateless objects: explosion, dust, a scorched tint, fire and smoke.
- Re-test (G4, 2026-10-17): works, with polish left (FB-043, FB-044). The container, camo tent, crate, crate pile, barrel pile, the large bunker and mission 2's radar dishes and radio tower are declared `destroyed=@scorch:dark=0.9@collapse:blast=1` (the tower without `blast`) and get `intact`, a scorched `destroyed` and `intact_to_destroyed` (15 frames: shake, dust, flash, crossfade). The game's stateless blast and the scorch tint in `destroyProp()` are removed; every mission target now has states. Load checks destroy mission 1's 8 and mission 2's 4 targets this way.
- Status: verified

## FB-029 · An object's frame pivot is the model origin, not its anchor, so `play()` moves a sprite placed by its anchor
- Severity: polish        Milestone: G1
- Tried: placing the tank like the other props (`setOrigin(anchor / frame size)`), then `sprite.play('…/intact_to_destroyed_SE')`
- Wanted: switching states with `play()` and nothing else (LAYERS.md: "An engine plays `intact_to_destroyed` exactly like any other animation … with no offset to apply").
- Got: every frame's `pivot` is (221, 230) (= 0.5, 0.661), the model origin, while `object.directions[SE].anchor` is (241.62, 240.31) and `object.anchor` (direction 0) is (200.38, 240.31). Phaser applies the frame pivot as the origin on each animation frame, so the tank jumps ~22 px on the first `play()`. Images placed once with `setOrigin` never noticed this.
- Workaround: `src/scenes/Field.ts` `showState()` positions the sprite at `at + (pivot − anchor)` and lets the pivot be the origin.
- Suggested change: for object exports, write each direction's anchor as the frame `pivot`, or document that a Phaser sprite must be offset by (pivot − anchor).
- Re-test (G4, 2026-10-17): works. In every frame of the tank, container (both facings), radar dish and truck, `pivot × sourceSize` equals `object.directions[].anchor` (0 mismatches). `showState()` now just plays and sets the position; mission 1's placement doesn't move (load check, screenshots).
- Status: verified

## FB-030 · Several sprites of one model share one animation prefix
- Severity: polish        Milestone: G1
- Tried: three FX sprites from one model, `smoke` / `fire` / `explosion` = `POLYGON_Particle_FX/SM_Particle_Smoke_01` with `template` `smoke_loop` / `fire_loop` / `explosion`
- Wanted: animation keys unique per sprite (FB-007 made them unique per model).
- Got: all three export `Particle_Smoke_01.json` and keys `Particle_Smoke_01/<clip>_S`. They only coexist because the clip names differ; two sprites of one model with the same clip (a tank in two liveries, a `smoke` and a `smoke_big`) would collide in Phaser's global animation manager.
- Workaround: none needed yet.
- Suggested change: in `sprite apply` / project downloads, prefix keys (and base file names) with the sprite name.
- Re-test (G4, 2026-10-17): works for sprites rendered since the fix: `tank/intact_SE`, `smoke/smoke_loop_S`, `fire/…`, `explosion/…` (the FX no longer share `Particle_Smoke_01/`). The game needed no change (the manifest's `animPrefix` comes from the anims file). Sprites not re-rendered keep `<base>/` (`Bld_Bunker_01/still_SE`), so one project mixes both styles until each is re-rendered; nothing marks them outdated (FB-042).
- Status: verified

## FB-031 · `smoke_loop` renders light grey and additive, and barely rises
- Severity: polish        Milestone: G1
- Tried: `{ "name": "smoke", "asset": "POLYGON_Particle_FX/SM_Particle_Smoke_01", "template": "smoke_loop", "dirs": "1" }` (130×182, 20 frames)
- Wanted: a dark smoke column for a burning wreck, normal blending (README: "`smoke_puffs` / `smoke_loop` (normal blending)").
- Got: `meta.blend: "add"`, light grey puffs that stay in one blob across the loop (little visible rise at this size). `fire_loop` (74×118, 7 frames) and `explosion` (284×348, 9 frames, `impact` on frame 0) look right.
- Workaround: `src/scenes/Field.ts` `smokeAndFire()` draws the smoke with normal blending, scaled 1.6 and tinted dark (marked FB-031).
- Suggested change: write `blend: normal` for smoke templates, and a `color`/`dark` parameter (wreck smoke vs. steam); more rise per loop.
- Re-test (G4, 2026-10-17): works after a forced re-render (FB-042: the fix alone didn't make the sprite outdated, and `smoke_loop:dark=0.8` didn't either; `fps: 12` did). `meta.blend` is `normal`, the column is dark grey and rises through a 116×232 frame. The game now takes the blend from the export (manifest `blend`) and draws smoke without the tint and normal-blend override.
- Status: verified

## FB-032 · `edit_map` `place`: the schema only takes `spriteId`, so an AI has to look ids up (`sprite` by name works but isn't declared)
- Severity: polish        Milestone: G3
- Tried: `{"op": "place", "sprite": "crate", "x": 3, "y": 3}` (the MCP `edit_map` schema from `tools/list`; `scatter` and `path` objects declare `sprite` by name)
- Wanted: place by sprite name, declared in the schema like the generators' `sprite`.
- Got: it works through the CLI, but the `place` op in the MCP schema lists only `spriteId` (integer) and `assetRef`, so a client that validates arguments (or an AI reading the schema) has to call `list_sprites` and map names to ids first. The map JSON and the generator reports also speak in ids (`"byObject": {"sprite 30": 13}`, legend `tree_small [sprite 30]`).
- Workaround: none needed (maps/*.ops.json use `sprite`).
- Suggested change: declare `sprite` (name or id) on `place` and `move`, and name sprites in reports (`"tree_small": 13`).
- Re-test (G4, 2026-10-17): worse over MCP than through the CLI: `edit_map` `{op: "place", sprite: "radio_tower", …}` fails with `place needs a spriteId or an assetRef` (the undeclared key is stripped by the schema), so an MCP author must call `list_sprites` and use ids. Mission 2 places by `spriteId` (maps/mission2.ops.json).
- Re-test (G4 wave 7, 2026-10-17): works. The MCP `edit_map` schema declares `sprite` on `place` and `move` (and scatter/path objects); reports name sprites (`"byObject": {"rock": 10}`, ids under `sprites`). maps/mission2.ops.json now places by name; mission 3 was authored by name only.
- Status: verified

## FB-033 · `map create` with a name that exists silently makes a second map; names then resolve to the oldest
- Severity: workaround        Milestone: G3
- Tried: `ssg map create probe --size 20x16 --tileset temperate` twice
- Wanted: an error ("map probe exists, id 1"), or `--replace` / `--if-missing`.
- Got: `created map 3 "probe"` next to map 1 "probe"; `ssg map show probe` then shows map 1. A build script that creates its map when missing would fork the map on a race or a typo-free re-run after a failed lookup.
- Workaround: `scripts/build-maps.mjs` `findMap()` (`// FB-033`) looks the map up by name in `map list`, warns on duplicates and uses the oldest.
- Suggested change: unique map names per project (like sprites in `sprite apply`), or a clear error.
- Re-test (G4 wave 7, 2026-10-17): works. `map create probe` on a taken name fails (exit 1; `--json` gives `{"error": …, "code": "conflict"}` naming both old probe ids); `--if-missing` returns the map as it is, `--replace` deletes and recreates it (new id). `findMap()` is gone: build-maps.mjs runs `map create … --if-missing` and uses the returned id. Small things: the CLI error says "pass replace: true … or ifMissing: true" (the MCP spelling, not `--replace` / `--if-missing`); `--if-missing` with a different `--size` silently returns the old size (the script still checks it); the two legacy `probe` maps (1 and 3) still share a name and `map show probe` silently picks id 1. Deleting them was refused by this session's permission policy, so they stay.
- Status: verified

## FB-034 · No way to delete or reset a map from the CLI or MCP, so "rebuild from scratch" means removing everything with ops
- Severity: workaround        Milestone: G3
- Tried: rebuilding `mission1` from `maps/mission1.ops.json` on every `npm run assets`; cleaning up two `probe` maps
- Wanted: `ssg map delete <map>` / MCP `delete_map`, or `create --replace`, or an op `{op: "clear"}` that empties every layer, so a seeded op list fully defines the map.
- Got: no delete or reset (HTTP has `DELETE /api/maps/:id`, but the game only uses the CLI/MCP). The two `probe` maps (ids 1 and 3) and nothing else from these tests are left in the "Airborne Ranger" project.
- Workaround: `scripts/build-maps.mjs` `wipeOps()` (`// FB-034`) prepends `remove` / `removeZone` for every object and zone and a whole-map `rect value:false` to the op list, in the same atomic batch; the first op (`generate` over the whole map) repaints the ground.
- Suggested change: `map delete` + MCP `delete_map`, and a `clear` op (or `edit_map {reset: true}`).
- Re-test (G4 wave 7, 2026-10-17): works. `map reset <map> --base grass`, `map delete`, `map create --replace` and the `clear` op all tested on a scratch map; `{op: "clear"}` reports what it removed. `wipeOps()` is gone: build-maps.mjs puts `{op: "clear"}` first (each maps/*.ops.json now starts with it; the bunker stamp source clears to grass) in the same atomic batch. Note: a deleted map's id is reused by the next `map create` (6 → deleted → the next probe was 6 again).
- Status: verified

## FB-035 · Path objects: `facing: "across"` on a path down the y axis gives the same facing as `along`; the README's "wire along a trench" lays it across
- Severity: workaround        Milestone: G3
- Tried: `path` with `objects: [{sprite: "wire", every: 6, offset: 2, facing: …}]` (wire has facings SE = 1×4 cells along y and SW = 4×1 along x), once down the y axis and once along x
- Wanted: `along` = the wire runs along the path, as in the README example (`--object Wire … --facing along  # a trench with wire along it`).
- Got: path along x: `along` → SE (wire across the path), `across` → SW (along the path). Path along y: `along` → SW (across), `across` → **SW** too. So "along" means "the object's front points along the path" (right for a soldier, wrong for a wall or wire), and "across" on a y path picks a facing the 2-facing export doesn't have and falls back to SW.
- Workaround: `maps/mission1.ops.json` trench 1 (down y) gives `facing: "SE"` explicitly, trench 2 (along x) `across`.
- Suggested change: fix `across` for 2-facing sprites (pick the export's facing whose axis is perpendicular, SE↔NW and SW↔NE being the same line); say in the docs that along/across name where the front points, and add `"parallel"` / `"perpendicular"` for walls, wire and sandbags (their long side) — or make walls use their long axis.
- Re-test (G4 wave 7, 2026-10-17): works. `facing: "parallel"` on both mission 1 trenches (down y and along x) lays the wire along the mud (1×4 cells down y, 4×1 along x; checked in the preview), and on both mission 2 sandbag walls. The explicit `SE` and the `across` workaround are gone. One gap: trench 2 reports `"placed": {"wire": 1}, "skipped": 1` with no reason (scatter has `rejected` by cause; path objects don't).
- Status: verified

## FB-036 · Scatter under-delivers without saying why, and the result depends on op order
- Severity: workaround        Milestone: G3
- Tried: in `mission1` (48×40, ~1300 m² allowed): `scatter` tree_small `density 3, spacing 3, cluster 0.6`; rocks `count 10, spacing 4/5`; the 6×6 pine `count 6, spacing 6–8`. All with `avoidTerrains [water, sand, road, mud]`, `avoidZones [spawn, objective, extraction, patrol, custom]`.
- Wanted: `count` placed when there is clearly room, or a reason per rejected spot (terrain, zone, spacing, overlap, off-map) in the report.
- Got: `{"placed": 13, "target": 39}`, `{"placed": 2, "target": 6}`; rocks after the trees `{"placed": 2, "target": 10}` but before them 10/10; a second tree pass (other seed, density 1, no clusters) `{"placed": 0, "target": 13}`. On an empty 20×16 map the same ops place their full count. The report has no reasons, so the only way to tune it is trial and error.
- Workaround: `maps/mission1.ops.json` scatters the big trees first, then rocks, then small trees.
- Suggested change: retry darts until `count` is met or the allowed area is exhausted; report rejections by reason (`"skipped": {"spacing": 40, "terrain": 12, "overlap": 5}`); name sprites in `byObject`.
- Re-test (G4 wave 7, 2026-10-17): works. Mission 1's rocks are 10/10 although they still come after the big trees (were 2/10 in that order). Short scatters now explain themselves: the big trees `2/6` with `rejected {terrain 1479, zone 402, overlap 258, spacing 176, bounds 603}`, `swept 1920` and `short: "4 not placed, every spot of the region tried: mostly terrain …"`; small trees 12/38 the same way. Mission 2's scatters all reach their target (26 bushes instead of 13). `byObject` names sprites.
- Status: verified

## FB-037 · Stamps: rotating needs every facing in the export, and a stamp's ground overwrites everything in its rectangle
- Severity: polish        Milestone: G3
- Tried: a `bunker_nest` stamp (bunker + two sandbag walls + a guard spawn, 12×10 cells) placed at rotate 90 / 270 / 0
- Wanted: a prefab that drops in turned, leaving the ground around its contents alone.
- Got: `sprite 16 has no facing "SW" (facings: SE)` for the bunker (props default to one facing, FB-013); it needed `"facings": 4` on bunker and sandbags in `ssg.assets.json` (both re-rendered in ~5 s). The stamp then worked well (facings and footprints turn, zone ids renumbered). But its ground is the whole rectangle, so its grass border painted over the river bank where a stamp touched it (water|grass mixes, FB-023); there is no way to stamp only the non-base terrain.
- Workaround: `ssg.assets.json` `facings: 4` on bunker and sandbags; stamp A moved a cell off the river.
- Suggested change: say "render it with --facings 4" in the error (or offer the mirrored facing for objects with a 180° symmetric footprint); a stamp `ground: "painted"` option that keeps only cells/corners that differ from the source map's base terrain.
- Re-test (G4 wave 7, 2026-10-17): works. On a scratch map a stamp cut from a dirt pad on grass, placed turned 90° against a river's sand bank, wrote only its 36 dirt corners (`ground: {mode: "mask"}`) and left the bank alone; mission 1's three bunker nests report `mask, 99 corners`. The facing fallback couldn't be exercised: every multi-facing sprite in the project has 4 facings (or SE+SW wire) and one-facing sprites carry no facing to turn. The stamp next to the river now uses `ground: "none"` to avoid a dirt/sand/grass T-junction (FB-049).
- Status: verified

## FB-038 · Map ops don't warn about corner mixes the tileset can't draw; it only shows up at export
- Severity: polish        Milestone: G3
- Tried: river/road/trench `path`s and biome patches on the temperate tileset (grass, dirt, sand, water, mud, road; each blends with one other, FB-023)
- Wanted: the `path` / `generate` / `stamp` report (and `get_map`) to say "54 cells have no tile (water|sand|grass…)" with where they are, while the author can still change the op.
- Got: the edit reports `corners` only; `ssg map export` prints `54 cells have a corner mix the tileset has no tile for (…)`, with no positions. The preview draws them as fallback tiles, which is easy to miss at 1568 px.
- Workaround: `scripts/build-maps.mjs` prints the export warnings; the op list was tuned by hand (FB-023 re-test).
- Suggested change: count and list (a few cells each) unsupported mixes in the edit result and `get_map`; optionally a `path` option that adds a ring of a blendable terrain automatically.
- Re-test (G4 wave 7, 2026-10-17): works. `map edit` / `map show` warn with cell positions and corners, separate two-terrain mixes (`add the pair (ssg tileset blend temperate dirt water), or fix "add-pairs"`) from three-terrain cells; build-maps.mjs prints the edit's `warnings`. Repaint: mission 1 went 6 → 4 (the stamp by the river with `ground: "none"`), mission 2 19 → 7 (paint the road/track/ridge/pad first, then `generate desert` with `keep`, as mission 1 does). The rest are T-junctions where a road meets a sand bank or a track, which no repaint can remove: see FB-049. `--fix add-pairs` has nothing to add (no two-terrain gaps left), and it would fight the declared `pairs` in ssg.assets.json anyway.
- Status: verified

## FB-039 · The exported object layer is thin for a game: no `facing` on one-facing sprites, ids the game can't map, no collision shapes
- Severity: polish        Milestone: G3
- Tried: spawning every object of `mission1.tmj` in Phaser from its properties
- Wanted: each object self-describing: the sprite's name, its facing and state always, and enough to collide without opening the sprite's export (or a pointer to it).
- Got: `name` (the sprite name, which happens to match `ssg.assets.json`), `spriteId` (the generator's id: not in the downloaded sprite files or the game's manifest), `facing` only when the sprite has more than one facing (the tent, crate piles and trees have none), `state` only for sprites with states, `footprintW/H`, `anchor: "footprint-centre"`. Collision is only the map's blocked-cell rectangles; the objects' polygons have to come from each sprite's export `object` block. In Tiled the objects are bare points (no images), so a human can't check the layout there either.
- Workaround: `src/scenes/Mission.ts` maps objects by `name`, defaults a missing facing to SE and takes collision from the manifest's object blocks.
- Suggested change: always write `sprite` (name), `facing` and `state`; optionally a `collision` polygon per object (cells or Tiled pixels) and an image-collection tileset so Tiled shows the objects as tile objects.
- Re-test (G4 wave 7, 2026-10-17): works. Every exported object has `sprite`, `exportName`, `asset`, `facing` and `state` (`still` for one-state sprites), and `collision` in Tiled pixels around the anchor; converted to screen pixels it equals the manifest's polygon for that state and facing (tent, wire, tree, container checked to 0.1 px). Mission.ts now reads `sprite`/`facing`/`state` and takes the collider from `collision` (no SE default, no manifest lookup for the first collider; destroyed states still swap to the manifest's polygon).
- Status: verified

## FB-040 · `get_map` / `ssg map show` hide what an AI author needs: zone extents, paths and the terrain under collision
- Severity: polish        Milestone: G3
- Tried: authoring `mission1` from the text overview (no images), as an AI on the MCP would
- Wanted: to see where each zone is, how long a patrol is, and that the river under `#` is water with a sand bank and a ford.
- Got: each zone is one digit at one cell (the drop rect 3..10 × 4..10 shows as a single `3`, a 5-point patrol loop as one `6`); digits are reused when there are more than ten zones (`0  spawn z1 "guard"; custom pod2 "supply pod"`); blocked cells print `#` over their terrain, so the river reads as `###` and the ford only shows as a gap. A 1.5 m trench paints corners, not whole cells, so trench 1 doesn't show in the picture at all (only its wire `W`). The `objectList` in `--json` has positions, but zones have no points there (`{"id","kind","name","shape"}` only).
- Workaround: none (looked at the preview PNG).
- Suggested change: draw rect/polygon zone outlines and polyline paths into the picture (or a second "zones" picture), unique zone symbols (letters after 9), collision as a separate picture or lower-case terrain symbols, and the zones' points in the JSON.
- Re-test (G4 wave 7, 2026-10-17): works. `map show --collision separate` gives a terrain picture with the river's water, sand bank and the ford readable plus a collision picture of its own; rect zones are outlines, patrols path lines, 1.5 m trenches show as `%`; the legend gives extents (`rect cells 37..46 × 3..17`) and path lengths, symbols are unique (0–9 then letters). The arctic map (mission 3) was planned from this picture alone.
- Status: verified

## FB-041 · Coordinate conventions differ between ops, and `--json` errors aren't JSON
- Severity: polish        Milestone: G3
- Tried: `rect` paint ops, `addZone` rects, `place`, `stamp`, the exported Tiled objects
- Wanted: one convention, stated in each tool's description.
- Got: `rect` / `stamp save --rect` are inclusive **cells** (`x0..x1`), `addZone` rect points are **grid coordinates** (the drop zone `[[3,4],[10,10]]` exports as 7×6 cells, 224×192 px), `place` x,y is the **footprint centre** snapped (odd spans on cell centres, even on edges), `stamp` x,y the **top-left cell**, and Tiled objects are in `tileheight` px per cell on both axes. All documented somewhere, but an AI mixing `rect` and `addZone` gets off-by-one zones. Separately, `ssg --json map edit` with a failing op prints the errors as text on stderr and nothing on stdout.
- Workaround: none needed.
- Suggested change: a one-paragraph "coordinates" note in the `edit_map` description; `--json` errors as `{"errors": [...]}` on stdout.
- Re-test (G4 wave 7, 2026-10-17): works. README "Coordinates" has the per-op table, `edit_map`'s description carries the convention and the `anchor` option, and `ssg --json map edit` with a bad op prints `{"error": "No sprite named \"nope\". Did you mean: …"}` on stdout (exit 1). With two bad ops only the first (the name lookup) is reported.
- Status: verified

## FB-042 · Parameter-only changes don't make a sprite outdated, and there is no forced re-render
- Severity: workaround        Milestone: G4
- Tried: `smoke` `"template": "smoke_loop"` → `"smoke_loop:dark=0.8"`; the scorched states `destroyed=@scorch@collapse:blast=1` → `destroyed=@scorch:dark=0.9@collapse:blast=1`; then `ssg sprite apply … --render --download`. Also: the FB-030/031 fixes themselves.
- Wanted: the sprites re-rendered (their spec changed), or at least a way to force it (`sprite render --force`, apply `"force": true`).
- Got: `smoke: updated · up to date`. `ssg sprite show smoke` says `render now: No changes` while the spec has `params {dark: 0.8}` and the current render `params {}`; same for `look: "scorch:dark=0.9"` vs the rendered `"scorch"`. Generator fixes (smoke blend, anim prefix) don't mark old renders outdated either, so FB-030/031 could only be re-tested by changing something else.
- Workaround: `ssg.assets.json` `"fps": 12` on smoke/fire/explosion and `"maxSeconds": 3` on the scorched objects (both counted as changes) forced the renders.
- Suggested change: compare template/state parameters in the outdated check; `ssg sprite render --force` / apply `--force <names>`; optionally mark renders made by an older renderer version as outdated ("renderer changed").
- Re-test (G4 wave 8, 2026-10-18): works. Dropping the hacks (`fps` 12 on smoke/fire/explosion, `maxSeconds` 3 on the scorched objects) and putting `blast=1` back on the radio tower made exactly those 12 sprites `would update · outdated` with a reason (`Clip length changed`, `Move settings changed` for the parameter-only `@collapse` → `@collapse:blast=1`). `node scripts/build-assets.mjs tree --force` (→ `sprite apply --force tree`) re-rendered an unchanged sprite as v2. Everything else now reads `outdated (renderer updated; --force re-renders)` and is left alone by `--render`, which is what I want. The workaround is gone. One nit: removing `fps` reports `View or size changed` (FB-055).
- Status: verified

## FB-043 · `collapse` / `@scorch`: see-through crossfade, a sink that pops back up, and a scorch that barely darkens
- Severity: polish        Milestone: G4
- Tried: `destroyed=@scorch:dark=0.9@collapse:blast=1` on the shipping container, camo tent and radar dish (contact sheets of `intact_to_destroyed_SE`, 15 frames)
- Wanted: a model that shakes, sinks into dust and ends as a clearly burnt version of itself.
- Got: during the crossfade (frames 10–12) both models are half transparent and draw their back faces: the container is seen inside out (its far walls and floor through the near ones), the dish shows its back. The intact model sinks/squashes (10 %) and then the scorched still (sunk 6 %) fades in taller, so the object pops up at the end. With `dark=0.9` the rust-red container only turns dark red, and the camo tent looks almost the same as intact; the rubble pieces are the main tell.
- Workaround: none needed (the game adds fire and smoke on the wreck).
- Suggested change: crossfade with the destination drawn opaque underneath (or dither instead of alpha); sink the scorched still as far as the collapse ends; let `dark` reach charcoal at 1 and desaturate.
- Re-test (G4 wave 8, 2026-10-18): works. Contact sheets of `intact_to_destroyed` (container SW, plane_big, tent, radio tower; 15 frames): the crossfade frames are opaque (no inside-out container, no see-through dish), the scorched still doesn't pop up at the end, and `dark=0.9` now ends charcoal (the rust-red container and the Ju 87 come out near-black grey). In the game the depot's containers, the radar array and mission 3's planes collapse into dark wrecks (test-results/mission3.png, the v2 video).
- Status: verified

## FB-044 · `collapse:blast=1` on a tall thin model draws the flash as a big rectangular slab
- Severity: polish        Milestone: G4
- Tried: `POLYGON_War/SM_Prop_Radio_Tower_01` (1.7×1.7×12.3 m) with `destroyed=@scorch@collapse:blast=1`
- Wanted: an explosion flash at the tower.
- Got: frames 1–5 show a white/orange rectangle half the tower's height and wider than its frame column (a clipped billboard), starting with a white disc mid-air. The radar dish's flash with the same parameters looks right.
- Workaround: the radio tower is declared without `blast` (the game's own grenade explosion plays anyway).
- Suggested change: size the blast by the footprint and place it at the base, or clip it to a circle.
- Re-test (G4 wave 8, 2026-10-18): works. The radio tower is declared with `blast=1` again: the flash is a round fireball at the base, inside the tower's column, from a white core to orange to dust; no slab.
- Status: verified

## FB-045 · MCP: an author can't see an object sprite's footprint before placing it
- Severity: polish        Milestone: G4
- Tried: authoring mission 2 over MCP: `list_sprites` (kind object), `get_sprite radar_dish`, then `edit_map` `place`
- Wanted: each object sprite's footprint in cells per facing (and its facings and states), so a layout can be planned.
- Got: `list_sprites` gives a summary line ("Isometric, 8 directions" for objects that render one facing) and `get_sprite` the spec; neither has the export's `object.tiles`. The first compound batch failed on two overlaps (`o1 would overlap radar_tent (tent) at (43.5, 12.5)`) whose sizes I then had to read off the `get_map` picture after the next try (truck 8×4 at SE, container 7×3 at SW, barrel pile 3×3). `search_props` has model-level tiles, but not per facing and not by sprite name.
- Workaround: trial and error (one failed batch).
- Suggested change: `list_sprites` / `get_sprite` with `object: {facings: {SE: {u, v}}, states}` from the current export; a `place` error that says the footprint it tried.
- Re-test (G4 wave 7, mission 3, 2026-10-17): still open. `get_sprite plane` (4 kB) has `facings: 1` but no footprint, and neither does `list_sprites`. Mission 3's 16 placements worked first time only because I read `object.directions[].tiles` from the game's downloaded manifest, which an MCP-only author doesn't have. `props list` / `search_props` don't help either: they give model `w×d`, and for the SE facing that is the other way round from the map footprint `u×v` (plane 10x9 → 9x10, hangar 14x18 → 18x14, plane_big 14x12 → 12x14).
- Re-test (G4 wave 8, 2026-10-18): works. `map_sprites {map: "mission3"}` (7.5 kB, project inferred from the map) lists every sprite with per-facing footprints that match the game's manifest (plane SE 9×10, plane_big 12×14, hangar 18×14, container SW 7×3 / SE 3×7, bunker four facings), with height, states and anchor. `get_sprite plane` has `perFacing {SE: {u: 9, v: 10, metres}}`. A refused `place` now says the footprint it tried (`o2 covers 9×10 cells centred at (17.5, 14)`). Nit: `kind: "object"` leaves out the vehicles (plane, tank, truck) that are placed as objects (FB-053).
- Status: verified

## FB-046 · MCP map authoring: answers are big, every call needs `project`, the picture is buried
- Severity: polish        Milestone: G4
- Tried: authoring mission 2 only through `generate_map`, `edit_map`, `get_map`, `map_preview`, `undo_map`, `export_map` (21 calls, `scripts/mcp.mjs`, log in test-results/mcp-calls.jsonl)
- Wanted: small answers an AI can read in its context, and the map picture as the main thing.
- Got: (1) `edit_map` with the default `show: true` returns ~20 kB (the full `objectList` with every object's properties, then the picture as a string array at `overview.overview`, inside an object also called `overview`); `generate_map` ~16 kB; `get_map` ~13 kB. (2) `project` defaults to "the first project", which isn't the game's, so every call must repeat `"project": "Airborne Ranger"`. (3) `generate_map` `dryRun` turns seeds into numbers (`"seed": -1421424047`), so the dry-run ops aren't the readable op list one would save; I wrote the ops by hand instead. (4) In `map_preview` labels sit on top of each other (the objective's label under a guard spawn's). (5) Zone digits are still reused (`0` = the drop zone and pod 3) and the ridge's rock terrain shows only as `#` (FB-040). (6) 19 three-terrain cells only show up at `export_map` (FB-038).
- Workaround: `scripts/mcp-picture.mjs` prints just the picture and legend from a saved answer; `"show": false` on later edits.
- Suggested change: `show: "picture"` (picture + legend + counts, no objectList) as the default for edit/generate; a session/default project (or the only project with maps); keep seeds as given in dry runs; offset overlapping labels.
- Re-test (G4 wave 7, mission 3, 2026-10-17): partly better. Mission 3 took 7 map calls (create_map, 5 edit_map, 1 map_preview) with no errors, against mission 2's 21 calls and 2 failed batches. Sprites by name, the scatter `short` advice and the separate collision picture did most of that. Still open: `project` must go in every call (it defaults to the first project); `edit_map` with `show: true` returns 7 / 13 / 22 kB as objects are added (the `objectList` dominates), against 1 kB with `show: false`; and zone outlines in the picture hide the objects under them (the objective's `1` edge over the hangar column, the patrol `6` over a crate pile).
- Re-test (G4 wave 8, 2026-10-18): works. `get_map` brief 78 chars / normal 8.4 kB / full 14.3 kB on mission 3; `edit_map` answers briefly (1.7 kB with a 24×20 picture, 0.25 kB for a refused batch). `use_project` holds for the session (scripts/mcp.mjs gained `--project` and `calls @file` to run several calls in one session), and a map given by name finds its project without either. `generate_map` `dryRun` keeps a text seed (`"seed": "ranger-w8"`). `map_preview labels: "all"` places overlapping labels apart with leader lines (two guard spawns 1 cell apart, the objective label and a patrol). Still in the text picture: zone marks overwrite object cells (FB-054).
- Status: verified

## FB-047 · `ssg tileset apply --dry-run` doesn't check textures, and its tile count reads oddly
- Severity: polish        Milestone: G4
- Tried: a tileset with `"texture": "Terrain/Grass_99.png"` through `ssg tileset apply --dry-run`, then without `--dry-run`
- Wanted: the dry run to fail like the real run.
- Got: the dry run says `would create · grass · 1 tiles`; the real run refuses it (with good suggestions). The dry run of the temperate update says `152 tiles (+854 −0)` (the old count next to the change, not the result 1006), and its pairs column lists the current pairs, not the declared ones.
- Workaround: none needed.
- Suggested change: validate textures in the dry run; show `152 → 1006 tiles` and the declared pairs.
- Re-test (G4 wave 8, 2026-10-18): works. The dry run refuses `Terrain/Grass_99.png` with the same closest-texture suggestions as the real run, and adding a pair reads `1006 → 1034 tiles (would create 28, keep 1006)` with the declared pairs listed.
- Status: verified

## FB-048 · `props list` reports some models at 100+ metres
- Severity: polish        Milestone: G4
- Tried: `ssg props list Bush`, `ssg props list Palm` looking for desert scenery
- Wanted: sizes to choose by.
- Got: `POLYGON_BattleRoyale/SM_Env_Bush_01` 161.7×156.7×145.6 m (162×157 tiles), `POLYGON_Adventure_Pack/SM_Env_Bush_03` 106 m, `POLYGON_Palm_City/SM_Env_Tree_Palm_Sappling_01` 154 m, next to sane 2 m bushes in the same packs. Probably a unit/scale import problem; they'd render enormous.
- Workaround: picked `POLYGON_Palm_City/SM_Env_Bush_01` (2.1 m) and `POLYGON_City/SM_Env_PalmTree_01`.
- Suggested change: flag or fix outliers on ingest (a bush over 20 m is a scale bug); show a warning column in `props list`.
- Re-test (G4 wave 8, 2026-10-18): works. `props list Bush`: every bush is 1–4 m now (Palm City `Bush_01` 2.1 m, BattleRoyale 1.6 m, Adventure 1.1–2.1 m); the palm saplings are 1.5–2.2 m. Across all props the only big ones left are the War battleships (223 m and 154 m, plausibly real) and the juice cart, which is flagged `size?`.
- Status: verified

## FB-049 · A road meeting a river bank (or a track crossing a road) always leaves three-terrain cells the tileset can't draw
- Severity: polish        Milestone: G4
- Tried: FB-038's advice to "repaint so at most two meet" on mission 1 (road across a sand-banked river, with a sand ford) and mission 2 (dirt track crossing the road).
- Wanted: a map where every cell has a tile.
- Got: wherever three areas meet (grass | road | sand bank, or sand | road | dirt track), some cell has corners from all three. No repaint removes that, because it is a T-junction, and a buffer ring only moves the junction somewhere else. Reordering helped where the third terrain was incidental: mission 2 went from 19 to 7 by painting paths first and then `generate … keep`, and mission 1 from 6 to 4 with `ground: "none"` on the stamp next to the river. The remaining 4 + 7 cells are real junctions, and they draw as the main terrain's pure tile, which shows a hard notch.
- Workaround: none (the cells show the fallback tile).
- Suggested change: draw a 3–4-terrain cell by layering: the lowest-priority terrain's pure tile, then each higher terrain's corner mask over it (a terrain priority/z-order per tileset, like Tiled's or Godot's terrain layering). Or let `path` lay its `edge` terrain under the junction automatically. And reword the hint so it doesn't promise that a repaint can always fix it.
- Re-test (G5 wave 9, 2026-10-18): works. `"mixes": "triples"` on the temperate and desert tilesets in ssg.assets.json (`sprite apply` created 112 / 168 mix tiles: 1006 → 1118, 868 → 1036). After the rebuild `map show` / `map edit` report no cells without a tile on mission 1 (was 4) and mission 2 (was 7), and none on mission 3 or the new mission 4. Mission 1's ford junction cells (13,21), (24,21), (12,24), (25,24) now draw three-terrain tiles (wangids like grass|road|sand), not the grass fallback. `--fix add-mixes` wasn't needed.
- Status: verified

## FB-050 · Aircraft get a `base` collision (a sliver at the tail wheel), and a declared sprite can't set `collisionHeight`
- Severity: workaround        Milestone: G4
- Tried: `POLYGON_War/SM_Veh_Plane_German_01` and `_02` as project sprites (`ssg.assets.json` `plane`, `plane_big`), placed on mission 3 and grenaded at their footprint centre.
- Wanted: a collision polygon around the fuselage (and wings), like the tank's and truck's `hull`.
- Got: `collision: {source: "base", cut: 0.444}`. On the Bf 109 that is an 8-point sliver at the tail wheel, 4.2 m behind the anchor, and on the larger plane a 3 × 1.3 m band behind its centre. The Ranger walks through the planes, and a grenade landing on the cockpit does 0 damage. The intact state's per-direction polygon and the map's `collision` property are the same sliver. The README's fix is `--collision-height`, but `sprite apply` refuses `"collisionHeight"` ("unknown key"), and `apply_sprites`, `create_object_sprite` and `set_object_states` don't have it; only the anonymous `export_sprites` does.
- Workaround: `src/scenes/Field.ts` `WHOLE_HULL` (`// FB-050`) makes `plane` and `plane_big` collide with the export's `canopyPolygon` (the whole hull).
- Suggested change: accept `collisionHeight` (and maybe `collision: "hull" | "base"`) on declared and app sprites; don't use `base` for vehicles (a model whose slice below the cut is only wheels or skids); and warn when the base polygon doesn't contain the anchor.
- Re-test (G5 wave 9, 2026-10-18): works. The old plane renders still said `base` (they were only `outdated (renderer updated)`), so `node scripts/build-assets.mjs plane plane_big --force` re-rendered them: `collision.source "hull"`, `rule "vehicle"`, 18/20-point polygons around the whole aircraft, and mission 3's exported `collision` covers ±143×159 / ±178×223 Tiled px around the anchor (the anchor inside). `WHOLE_HULL` is gone from src/scenes/Field.ts. The declared `"collision": "full"` works too: the radar dish (a pole, so `base` under `auto`) is now a hull target. load-check gained a test that every target's collider contains its anchor (missions 1–4 pass).
- Status: verified

## FB-051 · Path objects report `skipped` with no reason
- Severity: polish        Milestone: G4
- Tried: mission 1 trench 2, a `path` with `objects: [{sprite: "wire", every: 7, facing: "parallel"}]`.
- Wanted: like scatter, why a spot was skipped (overlap with what, off the map, terrain).
- Got: `"placed": {"wire": 1}, "skipped": 1` and nothing else.
- Workaround: none.
- Suggested change: `rejected` by cause (and the spot) for path objects, as scatter reports.
- Re-test (G5 wave 9, 2026-10-18): works. Mission 1 trench 2: `"skipped": 1, "rejected": {"bounds": 1}, "rejectedSpots": [{"object": "wire", "x": 48, "y": 29.5, "cause": "bounds"}]` plus a `short` hint ("the path runs off the map or too close to its edge … move the points in or lower offset"). Same for mission 4's pipeline (the 5th pipe at x 46).
- Status: verified

## FB-052 · Map and tileset lifecycle nits: MCP wording in CLI errors, `--if-missing` ignores the size, deleted ids are reused
- Severity: polish        Milestone: G4
- Tried: `ssg map create probe …` on a taken name; `map create mission1 --if-missing --size 40x40` (the map is 48x40); deleting a scratch map (id 6) and a scratch tileset (id 3), then creating mission 3 and the arctic tileset.
- Wanted: CLI flags in CLI errors; a warning when `--if-missing` finds a map that differs from what was asked; ids that aren't reused.
- Got: the CLI error says "pass replace: true … or ifMissing: true" (the MCP spelling). `--if-missing` silently returns the 48x40 map. The new mission 3 map got id 6 again, and the arctic tileset got id 3. Previews and exports came out right (they're keyed by revision as well), but anything else caching by id (Tiled firstgids, the app's per-browser view settings, a game's saved `mapId`) can mix up a deleted map with its successor.
- Workaround: build-maps.mjs compares the returned size itself.
- Suggested change: say `--replace` / `--if-missing` in the CLI; `existed: true, differs: {size: …}` (or refuse) on a mismatch; AUTOINCREMENT ids.
- Re-test (G5 wave 9, 2026-10-18): works. `map create probe` on a taken name: "pass --replace to delete it and start again, or --if-missing to use it". `map create mission1 --if-missing --size 40x40`: "warning: map 4 "mission1" exists but differs from what was asked: size 40x40 (the map has 48x40); it was left as it is". Creating, deleting and re-creating a scratch map gave ids 7 then 8 (no reuse); mission 4 got id 9. Nit: with `--json` the mismatch is only on stderr (the JSON has `existed: true` but no `differs`), so build-maps.mjs keeps its own size check.
- Status: verified

## FB-053 · `map_sprites kind: "object"` leaves out vehicles that are placed as objects
- Severity: polish        Milestone: G4
- Tried: `map_sprites {map: "mission3", kind: "object"}` to plan the airfield.
- Wanted: everything that can stand on the map as an object, with its footprint.
- Got: the planes, the tank and the truck are `kind: "vehicle"`, so they're missing from that list (they appear without the filter, with footprints). An author filtering for scenery to place misses the airfield's main targets.
- Workaround: call it without `kind`.
- Suggested change: let `kind: "object"` mean "placeable with a footprint" (objects and vehicles with an `object` block), or add `placeable: true`; or say in the answer that vehicles were filtered out.
- Re-test (G5 wave 9, 2026-10-18, not fixed yet): it leaves out more than vehicles. On mission 4, `kind: "object"` lists 10 sprites (bush, fern, guard_tower, hangar, palm, rock, rock_big, tanktrap, tree, tree_small), while the unfiltered list shows `pipe`, `pipe_valve`, `searchlight`, `radar_spin`, `tent`, `crate`… also as `"kind": "object"` with footprints. It looks like the filter keeps only one-state stills.
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-054 · The text picture still lets zone marks overwrite object cells
- Severity: polish        Milestone: G4
- Tried: a scratch map: a plane (9×10) with two guard spawns and a patrol line over it, `edit_map` / `get_map` picture.
- Wanted: the objects readable under zones (or both shown).
- Got: the spawn digits `1`, `2` replace two of the plane's `P` cells and the patrol's `3` replaces its last column, so the plane looks 8 cells wide. FB-046's labels fix applies to `map_preview`; the text picture is unchanged.
- Workaround: none (read the object list for sizes).
- Suggested change: draw objects over zone outlines (zones only on empty cells), or mark shared cells with a combined symbol listed in the legend.
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-055 · An `fps` change is reported as "View or size changed"
- Severity: polish        Milestone: G4
- Tried: removing `"fps": 12` from the smoke, fire and explosion sprites (back to the project's 10), `sprite apply --dry-run`.
- Wanted: `render: Frame rate changed` (like `Clip length changed` for `maxSeconds`).
- Got: `smoke: would update · render: View or size changed`.
- Workaround: none needed.
- Suggested change: a reason of its own for fps (and for each sprite key that marks a render outdated).
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-056 · Object states are stills only: a sprite can't both drive (or spin) and be destroyed
- Severity: workaround        Milestone: G5
- Tried: an enemy truck that drives along a road and can be blown up: `{"asset": "POLYGON_BattleRoyale/SM_Veh_Truck_01", "template": ["drive"], "states": "auto,destroyed@destroy", "dirs": "8"}`; also a spinning radar dish as a target (`spin` + `destroyed=@scorch@collapse`).
- Wanted: one sprite (one sheet, one anchor) with a looping `intact` (or an extra `drive` move) next to `destroyed` and `intact_to_destroyed`.
- Got: `sprite apply --help`: "states … (no anim/template/set/class)"; README: "With `states` the states are the sprite's moves: `"template": "still"` … other moves are refused". Each state is one still frame per direction.
- Workaround: two sprites of the same model, `truck_drive` (template `drive`, 8 directions) and `truck_wreck` (`auto,destroyed@destroy`, `dirs: 8`, `facings: 0`). Their anchors per direction are identical, so `src/scenes/Mission.ts` (`// FB-056`) plays `truck_drive/drive_<dir>` while it moves and swaps to `truck_wreck/intact_to_destroyed_<dir>` on the same sprite when a grenade kills it. The spinning dish (`radar_spin`) is scenery only.
- Suggested change: let a state carry its own moves (`"intact": {"template": "drive"}` or `"intact": "@spin"`), or allow `template`/`anim` next to `states` and render them on the same sheet with the shared framing (transitions start from the state's first frame).
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-057 · `flag_wave` can't wave a single-mesh flag, and POLYGON_War's flags are all single meshes
- Severity: polish        Milestone: G5
- Tried: `preview_sprite {asset: "POLYGON_War/SM_Env_Flag_Pole_Germany_01", templates: ["flag_wave"]}` (also the `_Long_Germany_A` banners) for a flag over the pump station.
- Wanted: a flag that waves.
- Got: `Error: none of the set applies to this asset`. `get_asset` shows no parts, so `set_part_role` can't mark one as `flag`. The only models with a `flag` part are POLYGON_Dark_Fortress banners (9.6 m wide).
- Workaround: none (no flag in mission 4).
- Suggested change: a vertex-bend `flag_wave` for single meshes (bend the vertices beyond the pole's bounding box, or the thin plane part of the mesh, by distance from the pole), or let `set_part_role` take a vertex region / material as a part.
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-058 · `set_part_role` accepts an unknown part name silently
- Severity: polish        Milestone: G5
- Tried: `set_part_role {asset: 931, part: "SM_Prop_Searchlight_Base_01_Head_01", role: "turret"}` (a guess at the name) for a sweeping searchlight.
- Wanted: an error naming the parts.
- Got: `isError: false` and the parts list back with `role: null` unchanged; only reading it showed that the part is `SM_Prop_Searchlight_Head_01`. The retry worked and `turret_sweep` sweeps the head nicely. Also, `get_asset` gives the head's `bbox_min/max` as ±0.005 m on a 1.46 m model (probably model-local units), which doesn't help to find the part either.
- Workaround: none needed (re-read and retried).
- Suggested change: refuse unknown parts (`no part "…": parts are SM_Prop_Searchlight_Head_01`), accept the `local` name (`Head_01`) too, and give part boxes in metres.
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-059 · Vehicle routes: a patrol zone can't say which vehicle drives it
- Severity: workaround        Milestone: G5
- Tried: mission 4's truck route over MCP: `addZone kind: "patrol"` along the road.
- Wanted: a route the generator knows is a vehicle's (sprite checked against the project, drawn by `map_preview` with the vehicle on it, kept off by scatters as a road).
- Got: patrol zones are generic; `properties: {"vehicle": "truck_drive", "wreck": "truck_wreck", "speed": 3}` are free-form, so a misspelt sprite name only shows when the game runs, and the picture shows just a patrol line. `map_sprites` lists `truck_drive` with per-facing footprints (E 7×7, SE 8×4…), but nothing ties it to the zone.
- Workaround: `src/scenes/Mission.ts` (`// FB-059`) turns a patrol zone with a `vehicle` property into a driving vehicle instead of a soldier.
- Suggested change: a `sprite` (or `vehicle`) property on patrol/route zones that is validated like `place`'s `sprite`, exported as `sprite` on the Tiled object, and drawn by `map_preview` (the sprite at the first point, facing along the route).
- Re-test (G6, 2026-10-18): works. Mission 4's two truck routes use `addZone {vehicle: "truck_drive", speed: 3}`; the export writes `vehicle` (name) + `vehicleId` + `speed`, which `Mission.spawnVehicle` reads unchanged. The wreck sprite and hit points are still free-form `properties` (`wreck`, `hp`).
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-060 · Dusk and night: tilesets can be tinted, sprites can't be lit or tinted
- Severity: workaround        Milestone: G5
- Tried: mission 4 at dusk in the jungle. The `jungle` tileset tints its textures (moss `#8aa080`, mud `#6a5848`, water `#6f8f96`), but sprite keys have no `tint`, light colour or ambient setting (`look` is clean/pixel…, `fx.tint` is for glowing FX only).
- Wanted: soldiers, trees, the truck and props rendered with a dusk light (low warm sun or blue ambient), so a night mission doesn't need a screen-wide filter.
- Got: nothing in `sprite apply --help`, `list_options` or the project settings.
- Workaround: `Mission.dusk()` (FB-060 in src/scenes/Mission.ts and src/missions.ts): a blue multiply rectangle over the world under the HUD; additive effects (fire, explosions) are lifted above it so they still glow; searchlights get an additive glow ellipse.
- Suggested change: a render-time light preset per project or sprite (`"light": "dusk" | {ambient, sun: {colour, elevation, azimuth}}`) applied to every sprite and tileset of the project, as one more variant key (so a game can ship day and night sheets).
- Status: fixed (generator wave 9: `light` presets on sprites and tilesets; re-test and drop the blue overlay)

## FB-061 · Re-applying an unchanged tileset with `"pairs": "all"` adds hundreds of mix tiles without saying why
- Severity: polish        Milestone: G5
- Tried: `sprite apply ssg.assets.json --dry-run` before changing anything this wave.
- Wanted: `unchanged` for the desert and arctic tilesets (their declarations didn't change), or a reason.
- Got: `tileset desert: would update · 868 → 1036 tiles (would create 168)` and `arctic: 1264 → 1744 (would create 480)`. `tileset show arctic` afterwards says `mixes: auto (every 3–4-terrain mix: 5 terrains or fewer), 480 mixed tiles`, so wave 8's `auto` default creates every mix for small tilesets. That is fine, but the dry run reads as if the file changed, and the arctic atlas grew 38 % for a map that has no three-terrain cells.
- Workaround: none (accepted the larger arctic atlas).
- Suggested change: give the update a reason (`mixes: auto now adds every mix (5 terrains or fewer)`), and maybe let `auto` add only the mixes the project's maps use.
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-062 · `"dirs": "1"` on an object sprite switches the view to "custom"
- Severity: polish        Milestone: G5
- Tried: `{"name": "searchlight", "template": "turret_sweep:…", "dirs": "1"}` (one facing, like the FX sprites) in an iso8 project.
- Wanted: one grid-aligned iso8 facing (SE), like a `still` object.
- Got: the dry run said `view custom · dirs 1` (the FX sprites' straight-on single view), not `iso8 · facings 1`.
- Workaround: left `dirs` out; objects default to one facing.
- Suggested change: for an object in a view with facings, read `dirs: 1` as `facings: 1`, or warn that it leaves the project's view.
- Status: fixed (generator wave 9, branch wave-9; re-test and remove workaround)

## FB-063 · Maps can't be resized; "make it bigger" means delete and re-create under the same name
- Severity: workaround        Milestone: G6
- Tried: growing missions 1–4 from 48×40 to 128×256 over MCP: `create_map` / `edit_map` / `list_maps` have no size change, `set {target: "map", key: "width"}` is only a custom property, and `ssg map create mission1 --if-missing --size 128x256` warns "exists but differs … it was left as it is".
- Wanted: `resize_map {map, width, height, anchor: "top-left" | "centre", fill: terrain}` (MCP and `ssg map resize`) that keeps the id, layers, objects and zones (dropping or reporting what falls outside).
- Got: `create_map {replace: true}` deletes the map and makes a new one under the name: a new id (mission1 4 → 11, mission2 5 → 13, mission3 6 → 14, mission4 9 → 15), the revision history and undo gone. It was harmless here only because the op lists rebuild everything from `clear`.
- Workaround: `scripts/build-maps.mjs --resize` (`// FB-063`) re-creates a map with `--replace` when its size differs from ssg.assets.json; the op list then rebuilds it.
- Suggested change: a resize op/command as above; or let `create_map {ifMissing: true}` with a different size offer `resize: true`.
- Re-test (generator large-map update, 2026-10-19): unchanged; no resize command or op.
- Status: triaged (TODO: Inbox, generator 2026-10-19 wave 10)

## FB-064 · The minimap shades blocked cells even without `collision`, so a river reads purple
- Severity: workaround        Milestone: G6
- Tried: a clean minimap for the in-game overview map: `ssg map preview mission1 --minimap --no-zones --no-labels --scale 2` and the same with `--layers ground,objects` (also MCP `map_preview {minimap: true}`; `collision` defaults to false).
- Wanted: ground and objects only; water drawn as water.
- Got: every blocked water cell is `rgb(105,54,75)` (purple), while the fords where collision was cleared are `rgb(83,117,147)` (blue). Blocked rock ridges (missions 2 and 3) are tinted the same way. `--layers ground,objects` doesn't change it, so the collision tint can't be turned off.
- Workaround: `src/overview.ts` (`// FB-064`) draws the overview itself from the exported .tmj: each ground gid's average colour from the map's tileset atlas, object footprints darkened.
- Suggested change: shade collision on the minimap only with `collision: true` / `--collision` (like the iso preview), and honour `layers`.
- Re-test (generator large-map update, 2026-10-19): unchanged; `--minimap --no-zones --no-labels` still draws blocked water `rgb(105,54,75)`.
- Status: triaged (TODO: Inbox, generator 2026-10-19 wave 10)

## FB-065 · Large maps: the text picture is downsampled and neither picture can show a region
- Severity: polish        Milestone: G6
- Tried: reading 128×256 maps while authoring missions 1–4 (MCP, `scripts/mcp.mjs`; the calls are in test-results/mcp-calls.jsonl).
- Wanted: a readable close-up of one area (a depot, a ford, an outpost) next to the overview.
- Got (timings over MCP, mission1 with 977 objects): `get_map {detail: brief}` 1.2 s, 83 chars; `normal` 1.6 s, 17 KB, and its picture is the map **downsampled 4×** to 32×64 characters (the description says "bigger maps are shown in blocks"; it's one block, every 4×4 cells one character, so a 3×3 rock or a 1-cell ford disappears); `picture: 256` 1.7 s, 49 KB for the full 128×256 characters; `full` 1.7 s, 138 KB. `map_preview {maxSize: 1568}` 5.7 s, 881 KB PNG at 4 px per tile, where objects are specks (labels are readable); `ssg map preview --max 3072` 8.1 s. Neither tool takes a rectangle, so a close-up of the depot means the 49 KB full picture and counting columns. The rest is fast: create 1.5 s, a 16-op terrain batch 1.7 s, a 4-scatter batch (903 objects) 9 s, export 0.7 s, minimap 0.8 s.
- Workaround: `picture: 256` and slicing rows/columns in a shell; the iso preview for layout only (until the region update below).
- Suggested change: `region: [x0, y0, x1, y1]` on `get_map` (full resolution inside it) and on `map_preview` (crop, then scale to maxSize); say in the answer when a picture is downsampled and by how much.
- Re-test (generator large-map update, 2026-10-19): mostly fixed. `get_map {region: "4,4,40,36"}` gives the depot at full resolution (2.3 s, 11 KB); `map_preview {region: "0,0,48,40", maxSize: 1280}` draws it at 0.45 scale, every tent, crate and wire readable (5.8 s). Object lists are capped at 200. Left: the whole-map picture is still silently downsampled (say so in the answer), and a region preview still takes ~6 s.
- Status: partly fixed (region windows, wave 10); header scale note triaged

## FB-066 · The exported object layer repeats each sprite's data on every object (866 KB of a 2 MB .tmj)
- Severity: polish        Milestone: G6
- Tried: `ssg map export mission1 -f tmj --embed` at 128×256 with 977 objects.
- Wanted: a compact object layer; per-sprite data once.
- Got: mission1.tmj is 1 987 KB: the object layer 866 KB (≈ 890 bytes per object: `asset`, `exportName`, `spriteId`, `footprintW/H`, `anchor`, `mapId` and the `collision` polygon string repeated on every tree of the same sprite and facing), the ground 121 KB, an all-zero decoration layer 66 KB, the embedded tileset 110 KB. It gzips to 58 KB, so download size is fine; parse time and memory on phones less so.
- Workaround: none needed (the game skips empty tile layers when drawing).
- Suggested change: an option to write per-sprite data once (Tiled object templates, or a `sprites` map property keyed by sprite + facing + state) and only position/state/facing per object; skip empty tile layers or write them as compressed base64.
- Re-test (generator large-map update, 2026-10-19): the MCP object lists are capped now; the exported .tmj is unchanged.
- Status: triaged (TODO: Inbox, generator 2026-10-19 wave 10)

## FB-067 · Scatter weights favour small sprites: weight 1 : 2 gave 181 palms to 126 trees
- Severity: polish        Milestone: G6
- Tried: mission 4's canopy, `scatter {objects: [{sprite: "palm", weight: 1}, {sprite: "tree", weight: 2}], density: 1.4, …}`.
- Wanted: about twice as many trees as palms.
- Got: `byObject {palm: 181, tree: 126}`. The tree's 6×6 footprint fails more darts than the palm's 4×4, and the retries refill with whatever fits, so the mix inverts. With equal footprints the weights hold (mission 1: tree_small 3 : bush 1 → 557 : 163).
- Workaround: none (accepted the mix).
- Suggested change: keep drawing by weight until each sprite's share is met (or give up per sprite), and report the asked vs. placed share per sprite.
- Re-test (generator large-map update, 2026-10-19): faster (mission 4's three scatters re-applied in 3.2 s), weights still inverted: `{tree: 123, palm: 183}`.
- Re-test (G9, 2026-10-19, missions 1–4 rebuilt with the G9 stage): works. Mission 4's canopy reports `byObject {tree: 204, palm: 102}` with `byObjectAsked {tree: 204, palm: 102}`; the undergrowth `{bush: 275, tree_small: 138, fern: 276}` as asked. The maps' scatters changed accordingly (the route and perf checks were run again).
- Status: verified

## FB-068 · No way to mirror or rotate a map (or a region) after authoring it
- Severity: polish        Milestone: G6
- Tried: missions 2 and 4 came out with the drop in the west and the objective in the east; the design wants drop south, objective north (in the iso view: the map's bottom and top corners).
- Wanted: `edit_map {op: "transform", flip: "x" | "y", rotate: 90…, region?}` over ground, collision, objects (positions and facings) and zones.
- Got: nothing; stamps can turn in quarter steps but not mirror, and there is no whole-map transform.
- Workaround: a throw-away script mirrored the staged op lists (x → 128 − x for points, rects, places, stamp corners and scatter regions) and the batches were re-applied over MCP (`maps/g6/mission2|4/stage*.json`).
- Suggested change: a transform op as above (and `flip` on stamps).
- Re-test (generator large-map update, 2026-10-19): unchanged (no transform op; stamps still turn only).
- Status: triaged (TODO: Inbox, generator 2026-10-19 wave 10)

## FB-069 · Fords: clearing collision under a crossing also unblocks the water beside it
- Severity: workaround        Milestone: G6
- Tried: rivers made with `path {terrain: "water", collision: true, edge: "sand"}` and a ford: `path {terrain: "sand", width: 4–5}` across, then `rect {value: false}` over the crossing (the old missions did the same).
- Wanted: only the ford's cells walkable.
- Got: the rect clears every cell in its box, so with a jittered river the water cells left and right of the sand bar become walkable too (the minimap shows them blue next to the purple blocked river, FB-064). A tighter rect misses part of the bar.
- Workaround: tight rects (the ford's width + 1 cell) in maps/g6/mission1|4/stage1.json; a few water cells stay walkable.
- Suggested change: `path {…, collision: false}` that clears the cells under it (a ford or bridge); or `rect {value: false, terrains: ["sand"]}` / a `paint`/`fill` filter by terrain; or make `path {collision: true}` re-derive blocking from the final terrain so a later sand path over the water unblocks exactly its cells.
- Re-test (generator large-map update, 2026-10-19): unchanged (`rect` has no terrain filter, `path {collision}` only blocks).
- Re-test (G8 lane g8a, 2026-10-19): works. Missions 5 and 8 make their fords with `path {terrain, width, collision: false}` and no rect (maps/g8/mission5|8/stage1.json): the route check crosses on the fords, and its blocked-cell count rises by 211 / 270 against the old rects (the water beside the fords stays blocked).
- Re-test (G8 lane g8b, 2026-10-19): works. Missions 11 and 12 cut their fords with `path {collision:false}` alone (reports `cleared: 16–21`); no `rect value:false`, the water beside them stays blocked; route-check crosses them. Missions 1–4 still use the old rects.
- Status: verified (missions 5, 8, 11, 12; missions 1–4 still carry the old rects until they are rebuilt)


## FB-070 · A sprite can't leave the project's tile lock: UI icons get the map scale, `ppm` is ignored silently
- Severity: workaround        Milestone: G7
- Tried: the loadout screen's item icons (magazine, grenade, first-aid kit, LAW, time bomb) as sprites in the "Airborne Ranger" project with `"ppm": 300` (and `"tile": null` to opt out of the lock).
- Wanted: a close-up render of small items for a menu (an icon ~60 px tall), declared next to the game's other sprites so it shows in the app.
- Got: `sprite apply --dry-run` printed `tile 64x32 (1 m/tile)` for them: the project's tile lock wins and the sprite's `ppm` is dropped without a word; `"tile": null` is refused (`Bad tile size "null"`). At the map scale a grenade is ~5 px.
- Workaround: the `item_*` sprites declare `"tile": "64x32", "metresPerTile": 0.125` (8× the map scale, 362 px/m); `scripts/build-assets.mjs` (FB-070) leaves sprites with their own `metresPerTile` out of the shared-grid check and the game's ppm.
- Suggested change: warn when a sprite's `ppm` loses to the tile lock, and accept `"tile": false` (or `"scale": "free"`/`"ui": true`) on one sprite to render it at its own ppm, marked in the manifest so a game can tell icons from map sprites.
- Status: fixed (generator wave 10, master c2fbd9b; re-test and drop the workaround)

## FB-071 · POLYGON_War's American grenade renders 100× too big (centimetre units)
- Severity: workaround        Milestone: G7
- Tried: `preview_sprite {asset: "POLYGON_War/SM_Wep_American_Grenade_01", templates: ["still"], overrides: {ppm: 300}}` for the grenade icon.
- Wanted: a 10 cm grenade.
- Got: a 3630×6126 px frame. `get_asset` gives the parts' `bbox_min/max` around ±0.05 but `minM/maxM/sizeM` 100× larger (`sizeM [8.23, 14.98, 3.26]` for the clip), so the model is read as a 15 m object (like FB-048's props at 100+ m).
- Workaround: `item_grenade` uses POLYGON_BattleRoyale/SM_Wep_Grenade_01.
- Suggested change: detect centimetre-scaled weapons/props on ingest (a held weapon over 3 m, or parts whose metre size is 100× their bbox) and rescale them; flag the outliers in `search_assets`.
- Status: fixed (generator wave 10, master c2fbd9b; re-test and drop the workaround)

## FB-072 · No shoulder-fired launcher pose, and the launcher's rocket can't leave the tube
- Severity: workaround        Milestone: G7
- Tried: `search_animations` for rocket, bazooka, launcher (no results); the `kneel_shoot` template with `with: ["POLYGON_BattleRoyale/SM_Wep_RPG_01"]` (sprite `ranger_law`).
- Wanted: a Ranger kneeling with a LAW on his shoulder, aiming along it, the rocket leaving on a `shoot` event (the RPG model even has a part `SM_Wep_RPG_Rocket_01` with role `projectile`).
- Got: kneel_shoot holds the tube like a rifle at chest height (it reads as a launcher only side-on), and the rocket part stays drawn in the tube on every frame after the shot. There is no American LAW (M72) model either; the RPG stands in.
- Workaround: `ranger_law` (kneel_shoot + RPG) for the shot, and a separate `law_rocket` sprite (SM_Wep_RPG_Rocket_Active_01, `projectile` template, 8 directions) spawned at the `weapon_tip` socket on `shoot` (`src/scenes/Field.ts` `fireLaw`, FB-072).
- Suggested change: a `shoulder_fire` character template (tube on the right shoulder, head along it, kneeling or standing) using the weapon's grip, and a `hide` (or `detach`) of a `projectile` part from the weapon at the clip's `shoot` event.
- Status: fixed (generator wave 10, master c2fbd9b; re-test and drop the workaround)

## FB-073 · No clip or template to kneel and place something (time bomb, pick-up, first aid)
- Severity: workaround        Milestone: G7
- Tried: `search_animations` for place, plant, pick up, heal, bandage (all empty); the character templates (`list_options`).
- Wanted: a short one-shot "kneel, put something on the ground, stand up" with a `place` event, usable for time bombs, mines and picking things up.
- Got: only kneeling bow clips and `Stand_ToCrouch` / `Crouch_ToStand` transitions; nothing with the hands going to the ground.
- Workaround: the rifle moveset's `crouch_idle` loop (`ranger_kit`) plays for 0.8 s, then the bomb appears at the Ranger's feet (`placeBomb`, FB-073); first aid uses the same crouch.
- Suggested change: a procedural `kneel_place` template (crouch, reach the free hand to the ground in front, stand) with `place` at the lowest reach, and maybe `use_item` (hands to the chest) for first aid.
- Re-test (G8 lane g8b, 2026-10-19): works. `ranger_ops` has `{ "template": "kneel_place", "with": "POLYGON_BattleRoyale/SM_Prop_C4_01", "as": "plant" }` → `plant_kneel_place` with a `release` event (frame 6); `placeBomb` plays it and sets the bomb on `release` (the crouch stand-in stays only for a build without `ranger_ops`).
- Status: verified for the time bomb (lane g8b; first aid still uses the crouch)

## FB-074 · One character, different held items per clip, needs one sprite per item
- Severity: workaround        Milestone: G7
- Tried: adding the knife stab (Knife_Stab_Fore with a knife) and the LAW shot (kneel_shoot with the RPG) to the Ranger, who carries the carbine in every other clip.
- Wanted: one `ranger` sprite whose clips say what's in the hands (`"anim": [{"clip": "Knife_Stab_Fore", "with": ["…Knife_01"]}]`), one sheet, one prefix.
- Got: `with` is per sprite, so the Ranger is now four sprites of the same model and helmet: `ranger` (carbine), `ranger_kit` (reload, crouch), `ranger_knife`, `ranger_law`, each with its own sheet, frame size and anim prefix (the old `ranger` even keeps the `Character_American_Soldier_01/` prefix, the new ones `ranger_kit/`…). An outfit change has to be repeated on four sprites.
- Workaround: the game plays the other sprites' animations on the Ranger's sprite (`src/scenes/Field.ts`, FB-074); per-frame pivots line them up.
- Suggested change: per-clip `with` (and per-clip "hands empty") in `anim` entries and in `add_moves`, rendered into the one sheet; or sprite "variants" that share a name and prefix.
- Status: fixed (generator wave 10, master c2fbd9b; re-test and drop the workaround)

## FB-075 · `search_assets` doesn't match everyday names: "first aid", "explosive", "bazooka" find nothing
- Severity: polish        Milestone: G7
- Tried: `search_assets` for "first aid", "explosive", "bazooka", "duffel" while looking for loadout items.
- Wanted: SM_Gen_Prop_Medkit_01 / SM_Prop_MedicalBox_01, SM_Prop_C4_01, SM_Wep_RPG_01, SM_Item_Duffle_Bag_01.
- Got: `{"total":0}` for each; only the exact name fragments ("medkit", "C4", "RPG", "duffle") work.
- Workaround: guessed the names.
- Suggested change: a small synonym list (first aid → medkit/medical/bandage, explosive → C4/bomb/dynamite, bazooka/launcher → RPG/rocket, duffel ↔ duffle) and fuzzy matching on tags.
- Status: fixed (generator wave 10, master c2fbd9b; re-test and drop the workaround)

## FB-076 · No surrender (hands up) clip or template for a captured soldier
- Severity: workaround        Milestone: G8
- Tried: `search_animations` for surrender, hands up, hands (only HandsOnHips, phone and hair idles), and the character templates in `list_options`.
- Wanted: mission 6's enemy officer raising his hands when the Ranger reaches him, then walking with them up (or behind his head) while he is led out; prisoners could use the same.
- Got: nothing that lifts both arms above the head; the unarmed moveset has idle / walk / run only.
- Workaround: the officer (`officer`, unarmed + `hit_react`) plays `hit_react` once as the "surrender" gesture with a "NICHT SCHIESSEN!" line, then follows with the normal unarmed walk (`src/objectives/officer.ts`, FB-076).
- Suggested change: a procedural `hands_up` pose template (both upper arms raised, forearms up, loop) and a `hands_up_walk` (the walk clip with the arm bones overridden by the pose), or a generic "arms pose over a locomotion clip" layer.
- Status: open

## FB-077 · The unarmed moveset has no hit or death, and doesn't fall back to the templates like the gunner set
- Severity: polish        Milestone: G8
- Tried: `"class": "unarmed", "anim": ["idle", "walk", "run", "hit", "death"]` for the officer and the prisoners (ssg.assets.json).
- Wanted: like `rifle` (builtin_gunner), `hit` and `death` filled by `hit_react` / `death_fall` when the pack has no unarmed clip.
- Got: `sprite apply` refused the whole batch: `"hit" is no move of the moveset (idle, walk, run, place)`, suggesting sword clips (Hit_F_React_Sword, Death_B_01_Sword…).
- Workaround: `"anim": ["idle", "walk", "run"], "template": ["hit_react", "death_fall"]` (the game looks the clip names up, `src/objectives/follower.ts`).
- Suggested change: let builtin_locomotion (unarmed) fall back to `hit_react` / `death_fall` the way the combat sets do, or add hit/death to the unarmed moveset.
- Status: open

## FB-078 · Fences can't be laid end to end: footprints snap 5.12 m panels to 6 cells and overlaps are refused
- Severity: workaround        Milestone: G8
- Tried: mission 8's P.O.W. camp: `place pow_fence` (POLYGON_War SM_Prop_Fence_Wire_01, 5.12 m) every 5.12 m along each side of the camp, and the 2.64 m gate `pow_gate` in a gap.
- Wanted: a closed wire fence (no gap the Ranger fits through) with one gate.
- Got: `o2 would overlap o1 (pow_fence)…` for every second panel: the 5.12 m panel covers 6 cells, so panels can only stand 6 m apart, leaving 0.88 m gaps (the Ranger is 0.6 m wide). Path objects with `every` have the same limit.
- Workaround: `snap: false, allowOverlap: true` on every panel and the gate, placed at computed centres (maps/g8/mission8/stage2.json); nothing checks that the fence is really closed.
- Suggested change: a `fence` (or `wall`) op / path mode that lays a panel sprite end to end along a polyline by its real length (cut or scaled last panel), with `gaps: [{at, sprite: "pow_gate"}]`, exempting the panels from the overlap check against each other.
- Status: open

## FB-079 · No way to put a small object on top of another (a code book on a table)
- Severity: workaround        Milestone: G8
- Tried: mission 5: `place code_book` on the cell of `hq_table`.
- Wanted: the book lying on the table top (0.82 m up), drawn over the table, and listed with the table in get_map.
- Got: the overlap check refuses it; `allowOverlap` would only stand it on the ground inside the table's footprint. Objects have no elevation or "on top of" link.
- Workaround: the book is a custom zone (`codebook`, `height: 0.82`) and the game draws `code_book` raised by that height (`src/objectives/codebook.ts`, FB-079).
- Suggested change: `place {…, on: "<object id>"}` (or `elevation` metres) that puts a small prop on another's top surface (the support's height from its export), exported as an object property the engine can apply, and shown in the previews.
- Status: open

## FB-094 · A template asked for with a class comes back as a different, class-named move
- Severity: polish        Milestone: G9
- Tried: `mg_gunner` in ssg.assets.json: `"class": "rifle", "anim": ["crouch_idle", "death"], "template": ["kneel_shoot:twoHanded=1,kick=6"]` with the German heavy machine gun.
- Wanted: a clip named `kneel_shoot` (the template, with its parameters), as `ranger_law` gets when there's no class.
- Got: the dry run and the export list `rifle_crouch_shoot` instead, with no note that the template was swapped for the rifle moveset's crouch shoot (were `twoHanded` / `kick` used?). It does kneel and has a `shoot` event, so the game uses it.
- Workaround: src/enemies/mgnest.ts plays `rifle_crouch_shoot`.
- Suggested change: keep the asked-for template (named as asked) or say in the dry run / apply report "template kneel_shoot → rifle_crouch_shoot (class rifle has it)" and which parameters were dropped.
- Status: open

## FB-095 · No way to put game-only markers (mines) on a map: a placed object always collides
- Severity: workaround        Milestone: G9
- Tried: hidden mines on missions 1–4. `place {sprite: "mine"}` makes a solid object (the export's collision polygon goes into the .tmj), and a scatter of mines would be the same.
- Wanted: scatter / place "markers": objects without collision (or with `collision: false`), so a minefield can be authored over MCP as N mine positions inside a zone with the generator's spacing and terrain rules, visible in the map preview for the author.
- Got: only solid objects, or zones.
- Workaround: a `custom` zone with `minefield: true, mines: N` (maps/g6/<mission>/stage3.json); the game lays the mines inside it with a seeded random (src/enemies/mines.ts `addField`, avoiding blocked cells and props).
- Suggested change: `place` / `scatter` with `collision: false` (written to the .tmj as a property, no collision layer cells), or a `markers` scatter that writes point objects.
- Status: open

## FB-096 · A tank's turret can't aim apart from its hull
- Severity: workaround        Milestone: G9
- Tried: `tank_drive` (POLYGON_War German tank, `drive` + `fire` templates, 8 directions). The model has `turret` and `barrel` parts (`ssg parts`).
- Wanted: the hull driving one way while the turret points at the target: either a turret layer (8 turret directions over each hull direction, aligned at the turret ring) or a `turret_aim` move per direction.
- Got: one baked sheet per hull direction; the `turret_sweep` template only sweeps.
- Workaround: the tank stops and swings its whole hull to the Ranger's 8-direction before it fires (src/enemies/tanks.ts `face`).
- Suggested change: `layered` parts for vehicles (hull and turret+barrel as separate aligned sheets, the turret's pivot given), or a `turret_dirs` option.
- Status: open

## FB-097 · Vehicle `fire` is a loop with no event and no muzzle socket
- Severity: workaround        Milestone: G9
- Tried: `"template": ["drive", "fire:duration=0.6"]` on `tank_drive`, to fire a shell from the barrel.
- Wanted: a one-shot fire move with a `shoot` event on the recoil frame and a `muzzle` / `barrel_tip` socket per frame in the meta (like a character's `weapon_tip`), so the shell and flash start at the barrel's end.
- Got: `fire` loops (repeat −1), its clip has no events, and object/vehicle metas carry no sockets.
- Workaround: the game plays `fire` for 0.6 s and puts the muzzle 4.2 m in front of the anchor, 1.9 m up (src/enemies/tanks.ts `BARREL`, `MUZZLE_H`).
- Suggested change: `fire:once=1` with a `shoot` event, and sockets for vehicle parts with roles (`barrel` tip, `turret`), exported like character sockets.
- Status: open

## FB-098 · `dirs: "1"` on a vehicle picks S; you can't say which single direction
- Severity: polish        Milestone: G9
- Tried: `plane_pickup` (the C-47 transport, `propeller_spin`, at full tile-locked scale: 1474×1064 px frames), `"dirs": "1"` to keep the atlas small.
- Wanted: one chosen direction (the plane flies in over the extraction zone; E/W or N would suit some maps better).
- Got: `S` only (it suits flying down the screen, so it's used that way).
- Workaround: the plane always flies north → south over the zone (src/pickup.ts).
- Suggested change: `"dirs": "E"` / `["N", "S"]` (names), the same as a list of directions elsewhere.
- Status: open

## FB-099 · A curved sandbag wall collides with its convex hull, so nobody can stand inside the curve
- Severity: workaround        Milestone: G9
- Tried: `mg_nest` (POLYGON_War `SM_Env_Sandbag_Wall_Curved_01`, 4 facings, states).
- Wanted: a collider that follows the wall (a concave polygon, or the wall as a thick polyline), so a gunner can kneel inside the half-circle.
- Got: a D-shaped convex hull (`SE`: flat side at u = −1.12, bulge to +u) that also covers the inside of the curve.
- Workaround: the gunner kneels just behind the open side, 1.9 m from the anchor (src/enemies/mgnest.ts `BEHIND`).
- Suggested change: `collision: "concave"` (an alpha shape of the ground slice) for walls and fences.
- Status: open

## FB-100 · A `path` trench leaves no trace the game can read
- Severity: workaround        Milestone: G9
- Tried: making mission 1's trenches (painted by `path {terrain: "mud", width: 1.5, jitter: 0.6, seed: "trench-w"}` in G6) into cover the Ranger can drop into.
- Wanted: the path's centreline and width in the export (a zone or a polyline object written by the path op, e.g. `path {…, zone: {kind: "custom", properties: {trench: true}}}`), so the game knows where the trench runs without copying its points.
- Got: only the painted terrain (mud is also used for tracks and fords elsewhere, so the tiles don't say "trench").
- Workaround: `custom` polyline zones with `trench: true, width: 2.2` on the same points (maps/g6/mission1/stage3.json).
- Suggested change: an optional `zone` on `path` that records the (jittered) centreline and width.
- Status: open

## FB-101 · Placing after a scatter: overlaps are refused, but there's no "clear the spot" option
- Severity: workaround        Milestone: G9
- Tried: `edit_map place mg_nest` on the finished mission maps (after the G6 scatter stage).
- Wanted: `place {…, clear: true}` removing the scatter objects (trees, bushes) under the new footprint, as a level designer would.
- Got: `g9_nest1 would overlap o174 (tree_small) at (51.5, 98.5); …` for every nest; the scatter's object ids change on each rebuild, so removing them by id isn't stable.
- Workaround: the G9 ops are a stage *before* the scatters (maps/g6/<mission>/stage3.json; the scatters moved to stage4), so the scatter avoids them; the maps' scatter results changed with it.
- Suggested change: `clear: true` on `place` / `stamp` (only removing objects from scatter ops, reported), or a `clearRect` / `clearZone` op for objects.
## FB-085 · A destroyed state can't say how it collides: a blown gate keeps the whole panel as its collider
- Severity: workaround        Milestone: G8
- Tried: mission 10's stockade gate, `stockade_gate` (POLYGON_War `SM_Prop_Fence_High_02`) declared with `"states": "destroyed=@scorch:dark=0.9@collapse:blast=1"`, blown by a time bomb so the hostages can walk out.
- Wanted: the destroyed state's footprint to be what is left on the ground: nothing (a gap) for a gate or fence panel, a low rubble outline for a wall.
- Got: the destroyed state is the scorched copy with the intact panel's polygon (5 × 0.15 m), so the gap stays shut in the game, and `collapse` fades the picture but not the collider.
- Workaround: `src/objectives/rescue.ts` (FB-085) empties the gate's collider once its state is `destroyed` and shows the wreck at 45 % alpha.
- Suggested change: a per-state `collision` (`"none"`, `"base"`, `"full"`, or `"auto"`: none when the transition fades out) in the `states` syntax, e.g. `"destroyed=@scorch@collapse:fade=1;collision=none"` or `{ "destroyed": { "collision": "none" } }`, written into the export's `object.states[].directions[].polygon` (empty).
- Status: open

## FB-086 · A character declared with templates only still renders the locomotion set
- Severity: polish        Milestone: G8
- Tried: `ranger_ops` with only `"template": [{ "template": "kneel_shoot:…", "with": "…Camera_01", "as": "camera" }, { "template": "kneel_place", "with": "…C4_01", "as": "plant" }]` (and `"anim": []`), `ssg sprite apply --dry-run`.
- Wanted: two clips (`camera_kneel_shoot`, `plant_kneel_place`): the Ranger's own sprite has idle/walk/run already (the game plays these clips on it, FB-074 pattern).
- Got: clips `idle, walk, run, camera_kneel_shoot, plant_kneel_place`: three 8-direction clips nobody plays are rendered on the shared runner (the same for `ranger_law`).
- Workaround: none (render time only).
- Suggested change: when `template` (or `anim`) is given, don't add the kind's default set; or let `"set": "none"` / `"anim": []` mean "only these".
- Status: open

## FB-087 · `search_assets` misses everyday names for props and people: "fuel tank", "hostage", "siren"
- Severity: polish        Milestone: G8
- Tried: `search_assets` for the new missions' props and people: "jet", "aircraft", "fuel tank", "fuel", "hostage", "prisoner", "civilian", "siren", "alarm", "camera".
- Wanted: aircraft (fine now: "aircraft"/"airplane" find the planes, FB-075), the tankers and tanks (`SK_Veh_BigRig_Trailer_Tanker_01`, `SK_Veh_Army_Truck_Tank_01`, `SM_Bld_WaterTank_01`) for "fuel tank", the civilian characters (`Character_GentleMan_01`, `Character_Resistance_Male_01`, `Character_FactoryGirl_01`…) for "hostage"/"civilian", `SM_Prop_AlarmPole_01` for "siren".
- Got: "fuel tank" → TankTrap, Tankard and battle tanks; "hostage" and "siren" → nothing; "fuel" → only a fuel sign; "jet" → the jet ski (there is no jet aircraft in the installed packs, which is fine, but nothing says so). Found by listing every character and guessing prop names.
- Workaround: none (picked by hand: `hostage` = Resistance_Male_01, `alarm_pole`, `fuel_tank` = WaterTank_01, `fuel_bowser` = Army_Truck_Tank_01, the V-2 `SM_Veh_Rocket_01` as the experimental aircraft).
- Suggested change: role words in the synonym list (hostage/prisoner/civilian → non-soldier characters, fuel tank → tanker/tank but not tank trap or battle tank, siren → alarm) and a `kind`/`category` filter that ranks vehicles vs props; for characters, AI tags like `civilian`, `soldier`, `officer`.
- Status: open

## FB-088 · No pose for raising a held item to the eyes (camera, binoculars)
- Severity: polish        Milestone: G8
- Tried: mission 9's camera: `ranger_ops` `{ "template": "kneel_shoot:duration=1.5,twoHanded=1,kick=0", "with": "POLYGON_Apocalypse/SM_Item_Camera_01", "as": "camera" }`; `search_animations` for camera, photo, binocular, look.
- Wanted: a kneeling (or standing) "hold to the face" pose with the item at the eyes, with an event when it is in place (`shutter` / `look`).
- Got: kneel_shoot holds the camera at arm's length like a pistol; at 1 m per tile the 18 cm camera is a dark dot in the hands, so it reads as aiming, not photographing. No camera/binocular clips found.
- Workaround: the kneel_shoot clip plus a white flash circle when the exposure completes (`src/objectives/photo.ts`).
- Suggested change: a `raise_to_eyes` character template (hands to the face, head slightly forward, optional kneel) with a `look` event, usable for cameras, binoculars, radios.
- Status: open
