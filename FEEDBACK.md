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
- Status: open
-->

## FB-001 · phaser3 export: frame pivots are relative to the trimmed rect, Phaser reads them over the source size
- Severity: workaround        Milestone: G0
- Tried: `ssg export Character_American_Soldier_01 --class rifle … --view iso8 --ppm 32 --format phaser3 -o …`, then `load.multiatlas` + the frames' `pivot`
- Wanted: `pivot` that Phaser can use as-is. Phaser's JSON parsers set `customPivot`, and `setFrame` makes `pivot` the origin over `realWidth/realHeight` (the untrimmed `sourceSize`).
- Got: `"spriteSourceSize": {"x": 57, "y": 41, "w": 24, "h": 55}, "sourceSize": {"w": 128, "h": 132}, "pivot": {"x": 0.29167, "y": 0.92727}`. The pivot (64, 92) is divided by the *trimmed* size (24×55). Phaser places the origin at 0.927 × 132 = 122 px, so every trimmed sprite is drawn about 30 px too high and a few px off sideways. On the 66×60 crate the error is only about 1 px, so it's easy to miss.
- Workaround: `src/assets.ts` `fixPivots()` rewrites every frame to `(pivot*cut + spriteSourceSize)/real`
- Suggested change: in the phaser3 (and pixi, if it has the same code) writer, emit `pivot = pivotPx / sourceSize`. Add a test that loads the atlas into Phaser's parser and checks the feet land on the pivot.
- Status: open

## FB-002 · No tile lock: "iso8 = 64×32 tiles" is only a hint, the scale has to be worked out by hand
- Severity: workaround        Milestone: G0
- Tried: `ssg export --help`, `ssg views` (`iso8 … "Pixel-art isometric (dimetric, 30°): 64×32 tiles."`), MCP `list_options`
- Wanted: `--tile 64x32` (or a project setting) that locks ppm and says how many metres one tile is, and writes `tile: {w:64,h:32,metres:…}` into the export/meta, so characters, props and later tilesets share one grid by contract.
- Got: only `--ppm`. I had to work out that 64 px across a diamond means tile edge × √2 × ppm = 64, so I chose ppm 32 (tile edge √2 m). Nothing in the export records the tile size. The Unity format description mentions a "scale lock", but the CLI doesn't expose it.
- Workaround: `ssg.assets.json` `"ppm": 32`. The comment in `src/iso.ts` explains the maths.
- Suggested change: `--tile WxH[:metres]` on export/preview/sprite, resolved to ppm by the view. Put the tile in `meta.json`, the manifests and `ssg views --json`.
- Status: open

## FB-003 · Model names aren't unique across packs, and there's no pack-qualified name
- Severity: workaround        Milestone: G0
- Tried: `ssg export SM_Env_Tree_01 -t still …`. Also `ssg assets Tree --pack POLYGON_War` and `ssg assets POLYGON_War/SM_Env_Tree_01`.
- Wanted: the POLYGON_War tree, declared by name in `ssg.assets.json`, portable to any machine.
- Got: the export silently used **POLYGON_City**'s `SM_Env_Tree_01` (id 189) with no warning. `--pack` only takes a numeric id (`ssg: not a number: POLYGON_War`), and `Pack/Name` finds nothing. Ids aren't portable between generator databases.
- Workaround: `scripts/build-assets.mjs` `resolveAsset()` runs `ssg --json assets <name>`, keeps the declared pack and exports by id.
- Suggested change: accept `POLYGON_War/SM_Env_Tree_01` (or `name@pack`) everywhere a model is named (CLI, MCP, `--with`). Warn or fail when a bare name is ambiguous. Let `--pack` take a pack name.
- Status: open

## FB-004 · `--class` ignores `--anim`/`--set`: you always get the whole 13-clip gunner moveset
- Severity: workaround        Milestone: G0
- Tried: `ssg export Character_American_Soldier_01 --class rifle --anim Idle_Standing,Walk_F,Run_F,Rifle_Shoot,Rifle_Death -t prone_idle -t crawl …` and `--class rifle --set builtin_locomotion`
- Wanted: the rifle moveset's carry pose and grip (without `--class` the rifle hangs from one hand and `Rifle_Shoot` points it at the sky), but only the clips each character needs. The German needs idle/walk/shoot/death.
- Got: both commands rendered all 13 clips (`rifle_idle … rifle_death`) and silently dropped my clip list. Each soldier is one 4094×1771 atlas (4.7 MB PNG + 0.6 MB atlas JSON + 1.5 MB meta.json).
- Workaround: accepted the full moveset for both soldiers (`ssg.assets.json` `"class": "rifle"`). The enemy carries 9 clips it never plays.
- Suggested change: with `--class`, `--anim`/`--set`/`-t` pick the subset (by moveset label, e.g. `--moves idle,walk,shoot,death`). If you keep the current behaviour, at least warn that the flags were ignored.
- Status: open

## FB-005 · No throw (grenade) move, and the procedural combat templates aren't listed
- Severity: workaround        Milestone: G0
- Tried: `ssg animations Throw`, `ssg animations Grenade`, `ssg sets`, MCP `list_options` (templates)
- Wanted: a `throw` / `grenade_throw` move for the Ranger (grenades are a core weapon in Airborne Ranger), like the procedural `aim_shoot`, `prone_idle` and `crawl`.
- Got: no clip and no template. `prone_idle`, `crawl`, `kneel_shoot`, `aim_shoot` and `reload_gesture` exist (they're the builtin_gunner fallbacks, and `-t prone_idle` works), but `list_options`/`--help` don't list them. `still`, which every prop export needs, isn't listed either.
- Workaround: none yet (no grenades in G0; G1 needs it).
- Suggested change: add a procedural `throw` (overhand and underhand, with a `release` event and a hand socket) to builtin_gunner. List every template (character combat, `still`) in `list_options` and `ssg export --help`.
- Status: open

## FB-006 · Props have no footprint, collision shape or ground anchor; the only size is a T-pose bounding box
- Severity: workaround        Milestone: G0
- Tried: `ssg --json assets SM_Bld_Bunker_01` (size `[5.96, 3.06, 7.62]`), and the export JSON/meta of `-t still --dirs 4d` props
- Wanted: for each rendered prop direction, a footprint in tiles or metres (rotated with the direction), a collision polygon on the ground in frame pixels, and a sort anchor (front-most ground point or base line) for iso depth sorting. The DESIGN's "object sprites with footprints and collision polygons" can't be built without them.
- Got: the export has only `pivot`. Prop exports have no `meta.json`. The asset size is a model AABB (characters report `2.048 m` wide: the T-pose arm span).
- Workaround: `src/scenes/Field.ts` uses circle colliders from the asset size (`min(x,z)/2`). Depth uses the pivot, so a large bunker sorts by its centre. `scripts/build-assets.mjs` copies `size` into the manifest.
- Suggested change: write `footprint` (ground polygon per direction, in px and m), `collision` and `sortAnchor` into every still/prop export and its meta. This is Phase A's object metadata.
- Status: open

## FB-007 · Animation keys aren't namespaced: two characters' phaser3 anims collide
- Severity: workaround        Milestone: G0
- Tried: loading `Character_American_Soldier_01_anims.json` and `Character_German_Soldier_01_anims.json` with `anims.fromJSON`
- Wanted: both soldiers in one scene.
- Got: both define `rifle_idle_E`, `rifle_walk_E`… Phaser's animation manager is global, so the second set is skipped and the German would play the American's frames.
- Workaround: `src/assets.ts` creates the anims itself as `<sprite>:<clip>_<dir>` and points them at a per-sprite texture key.
- Suggested change: prefix keys with the base or texture key (`Character_German_Soldier_01/rifle_idle_E`), or add an option (`--anim-prefix`). Keep frame `key` and the atlas key consistent.
- Status: open

## FB-008 · `speedMps` is missing for the walk and wrong for the run and death
- Severity: workaround        Milestone: G0
- Tried: the Ranger's `Character_American_Soldier_01.meta.json` `clips[].speedMps`
- Wanted: the ground speed of each locomotion clip, so the game moves at `speedMps` and the feet don't slide (README: "play walk/run cycles at speed / speedMps").
- Got: `rifle_walk` has none, `rifle_crawl` none, `rifle_run` 0.077 m/s and `rifle_death` 24.9 m/s.
- Workaround: `src/scenes/Field.ts` `SPEED` hand-tuned (walk 1.5, run 3.6, crawl 0.5 m/s).
- Suggested change: for in-place clips, measure the stride from foot contacts and write the speed; never write it for one-shots. Write it for procedural crawl/crouch_walk too.
- Status: open

## FB-009 · False `style_without_weapon` warning when the rifle is equipped
- Severity: polish        Milestone: G0
- Tried: `ssg export Character_American_Soldier_01 --class rifle --with SM_Wep_American_Rifle_01 --with SM_Char_Attach_American_Helmet_01 …`
- Wanted: no warning. The rifle is in the hands in every frame (checked on a contact sheet).
- Got: `validation: [{"level":"warn","code":"style_without_weapon","message":"Rifle moves have no rifle weapon equipped: they render empty-handed"}]` in the export JSON. The same happens for the German. With the generic format the CLI's own `--json` result also said `"validation": []` while the file had the warning.
- Workaround: none (the build just prints it).
- Suggested change: count a non-layered (baked) `--with` weapon of the class as equipped. Make the CLI result and the file report the same validation.
- Status: open

## FB-010 · No ground tiles
- Severity: workaround        Milestone: G0
- Tried: `ssg assets Grass`, `ssg views`, `ssg export --help`: nothing makes a 64×32 ground tile
- Wanted: 64×32 diamond ground tiles (grass, dirt, sand, snow) and transitions at the iso8 scale. (Expected: generator Phase B.)
- Got: none.
- Workaround: `src/scenes/Field.ts` `drawGround()` draws procedural diamonds.
- Suggested change: Phase B tilesets. The tile size should come from the same tile lock (FB-002).
- Status: open

## FB-011 · An 8.6 s idle clip and no way to cap or trim frames per export
- Severity: polish        Milestone: G0
- Tried: `--class rifle` (it picks the uploaded `Rifle_Idle`, 258 frames)
- Wanted: a short idle loop. At fps 10 the idle is 86 frames × 8 directions = 688 of the soldier's ~2200 frames.
- Got: 86 idle frames. `ssg clip --trim` exists, but it changes the clip for every character and every user of the generator, so a game can't use it from its own build.
- Workaround: none (fps 10 keeps it to one 4 K atlas page).
- Suggested change: an export-level `--max-frames n` or a per-clip `--trim clip=a..b` that doesn't touch the shared clip. Or prefer a short idle for the rifle moveset.
- Status: open

## FB-012 · The CLI tries to rebuild the generator web app when the shared server is briefly unreachable
- Severity: polish        Milestone: G0
- Tried: `npm run assets` (a sequence of `ssg --json export …`) while another session was working on the generator
- Wanted: wait or retry for the server that's already running, or fail with "server on 5181 not reachable".
- Got: two exports and one `ssg assets` failed with `ssg: Command failed: npm run build -w apps/web` and an esbuild error from someone else's half-edited `apps/web` source (a conflict marker). The server was up again seconds later (`ssg server status` → running).
- Workaround: the build retries each export once. Re-running the failed names worked (`node scripts/build-assets.mjs german bunker`).
- Suggested change: if a server answered recently, or a pid file exists, retry the connection for ~30 s before auto-starting. Never rebuild the web app from a consumer's export call. Show the real cause (server unreachable).
- Status: open

## FB-013 · Props in iso8 with `--dirs 1` render square to the screen, off the iso grid
- Severity: polish        Milestone: G0
- Tried: `ssg export SM_Bld_Bunker_01 … -t still --view iso8 --ppm 32 --dirs 1`
- Wanted: a prop aligned to the 64×32 diamond grid (walls along the tile edges).
- Got: direction `S` (world 270°): the bunker's faces are square to the screen and its edges cross the diamonds. `--dirs 4d` gives the four aligned facings (NE/NW/SW/SE), which is what an iso game needs. That's not documented, and `--dirs 1` is the default the example consumer script uses for props.
- Workaround: `ssg.assets.json` uses `"dirs": "4d"` for every prop.
- Suggested change: for iso views, default prop stills to `4d`, or make `--dirs 1` render the NE (grid-aligned) facing. Say so in the README.
- Status: open

## FB-014 · `ssg resolve` reads "isometric" as top-down and picks generic gear for an American soldier
- Severity: polish        Milestone: G0
- Tried: `ssg resolve "an american soldier with a rifle and a helmet, isometric 8 directions, for phaser"`
- Wanted: `Character_American_Soldier_01` (or SK_Chr…), `SM_Wep_American_Rifle_01`, `SM_Char_Attach_American_Helmet_01`, view iso8.
- Got: `View: Top-down, 8 directions ("8 directions, isometric")`, `weapon: SM_Wep_Rifle_01`, `head: SM_Chr_Attach_Helmet_01`, and `AI unavailable: timed out after 15 s` (it took 15 s even with the AI off or unavailable).
- Workaround: none needed (I name models explicitly).
- Suggested change: let "isometric" win over "8 directions" in the view matcher. Prefer equipment from the model's own pack or faction words ("american", "german"). Skip the AI or time it out fast when it's unavailable.
- Status: open

## FB-015 · CLI table output crashes with EPIPE when piped into `head`
- Severity: polish        Milestone: G0
- Tried: `ssg animations Idle | head -14`
- Wanted: a quiet exit.
- Got: `Error: write EPIPE … Unhandled 'error' event` and a Node stack trace on stderr.
- Workaround: none.
- Suggested change: handle `EPIPE` on stdout (`process.stdout.on('error', e => e.code === 'EPIPE' && process.exit(0))`).
- Status: open
