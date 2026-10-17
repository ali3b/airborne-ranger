# Airborne Ranger: a remake built through Synty Sprite Generator

A Phaser 3 remake of MicroProse's Airborne Ranger (1988) in isometric 2:1 (64×32 tiles). Every sprite, tileset and
map comes from Synty Sprite Generator (`~/projects/synty-sprite-generator`). The game exists to prove the generator
and to find its gaps. Game design: `docs/DESIGN.md`. The orchestration loop: the generator's `docs/GAME-LOOP.md`.

## Rules
- Use the generator **only** through its interfaces:
  - the CLI: `node /home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs …` (`--help` on any command)
  - the `synty-sprites` MCP tools (`.mcp.json`, which allows writes into this repo)
- **Never** edit, import or copy code from the generator repo, and never read its database directly.
  If you can't get something through the CLI or MCP, that's a finding: write it in `FEEDBACK.md`.
- Every asset the game uses is declared in `ssg.assets.json` and rebuilt by `npm run assets`
  (`scripts/build-assets.mjs`). `public/assets/` is generated output; never hand-edit it.
- A workaround in the game (hand-made data, code that fixes up an export) is allowed only with a FEEDBACK entry.
  Mark it in code with `// FB-NNN` so it can be removed once the generator is fixed.
- Asset builds are heavy. Run one at a time, and never while a generator walk is running.
- `Airborne Ranger (1988)/` and `decoded/` hold the original game and its reverse-engineering notes. They're
  reference only and git-ignored. Don't ship anything from them.

## Checks before you finish a milestone
- `npm run typecheck`
- `npm run dev` (port 5195), then `node scripts/load-check.mjs http://localhost:5195 <scene>`. It needs no page
  errors, and it writes `test-results/<scene>.png`.
- Update `FEEDBACK.md`, and commit in this repo.
