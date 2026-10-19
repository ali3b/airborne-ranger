# Airborne Ranger: a remake built through Synty Sprite Generator

A Phaser 3 remake of MicroProse's Airborne Ranger (1988) in isometric 2:1 (64×32 tiles). Every sprite, tileset and
map comes from Synty Sprite Generator (`~/projects/synty-sprite-generator`). The game exists to prove the generator
and to find its gaps. Game design: `docs/DESIGN.md`. The orchestration loop: the generator's `docs/GAME-LOOP.md`.

## Rules
- Use the generator **only** through its interfaces:
  - the CLI: `node /home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs …` (`--help` on any command)
  - the `synty-sprites` MCP tools (`.mcp.json`, which allows writes into this repo); from a shell, `node scripts/mcp.mjs
    tools | schema <tool> | call <tool> '<json>'` talks to the same server (images land in test-results/mcp/).
    Missions 2 and 3 were authored that way: `maps/mcp/stage*.json` / `maps/mcp3/stage*.json` are the edit_map batches,
    `maps/mission2.ops.json` / `maps/mission3.ops.json` their sum.
    G6 rebuilt missions 1–4 at 128×256 the same way: `maps/g6/<mission>/stage*.json`, applied (and summed into
    `maps/<mission>.ops.json`) by `node scripts/g6-stages.mjs <mission>`; G8's missions 5–8 live in `maps/g8/<mission>/`.
    G10's hazards on missions 9–12 (which have no stages) are the batches `maps/g10/<mission>.json`, spliced into
    `maps/<mission>.ops.json` before the first scatter; `node scripts/build-maps.mjs <mission>` applies and exports.
- **Never** edit, import or copy code from the generator repo, and never read its database directly.
  If you can't get something through the CLI or MCP, that's a finding: write it in `FEEDBACK.md`.
- Every asset the game uses is declared in `ssg.assets.json` and rebuilt by `npm run assets`
  (`scripts/build-assets.mjs`). `public/assets/` is generated output; never hand-edit it.
- A workaround in the game (hand-made data, code that fixes up an export) is allowed only with a FEEDBACK entry.
  Mark it in code with `// FB-NNN` so it can be removed once the generator is fixed.
- Asset builds are heavy. Run one at a time, and never while a generator walk is running.
- Never kill processes by name (`pkill vite`, `killall node`): the generator's shared dev server is a vite process
  too. Start your own servers on a known port (vite 5195, a static `dist` server e.g. 5298), note the PID, and stop
  that PID only.
- `Airborne Ranger (1988)/` and `decoded/` hold the original game and its reverse-engineering notes. They're
  reference only and git-ignored. Don't ship anything from them.

## Checks before you finish a milestone
- `npm run typecheck`
- `npm run dev` (port 5195), then `node scripts/load-check.mjs http://localhost:5195 <scene>` for `title` (Ranger
  select → enlist → mission select), `field`, `mission`, `mission2`, `mission3`, `mission4`, `mission5`…`mission8` (G8 objectives: code book, officer, SAM site, P.O.W. camp), `mission9`–`mission12` (photo, hostages, diversion, sabotage with their failure rules; `scripts/g8b-checks.mjs`) (each plays to the debriefing; mission 4 also checks the driving
  truck, its wreck and the animated props), and `arsenal` (G7: the supply pod screen, pods, reload, first aid, knife, LAW,
  time bomb, then the same by touch on an emulated iPhone in landscape). G9: `g9` (the test field's machine-gun nest, mines, trench, tank, alerts and alarm). It
  needs no page errors, and it writes `test-results/<scene>.png`.
- Big maps (G6): `node scripts/route-check.mjs [--walk <url>]` (the shortest walkable route per mission, and running it
  in the game) and `node scripts/perf-check.mjs <url> [missions] [--phone] [--gpu]` (frame rate and CPU per frame).
- The Ranger's sheet: `node scripts/ranger-shots.mjs <url> [outDir]` checks every clip the game plays exists on the one
  `ranger` sheet in 8 directions and takes the `g11-ranger-*` screenshots (LAW, time bomb, first aid, grenade).
- Update `FEEDBACK.md`, and commit in this repo.
