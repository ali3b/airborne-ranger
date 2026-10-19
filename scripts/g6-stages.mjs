// Applies a mission's staged edit_map batches (maps/g6/<map>/stage*.json) through the generator's MCP in one
// session, and writes their sum to maps/<map>.ops.json (what scripts/build-maps.mjs replays).
//   node scripts/g6-stages.mjs mission1 [--dry]      (maps/g6/<map>/ or maps/g8/<map>/)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = process.argv[2];
// G8 maps (missions 5–8) keep their stages in maps/g8/<map>/.
const dir = ['maps/g6', 'maps/g8'].map((d) => path.join(root, d, map)).find((d) => fs.existsSync(d)) ?? path.join(root, 'maps/g6', map);
const stages = fs.readdirSync(dir).filter((f) => /^stage\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
const calls = stages.map((f) => ({ tool: 'edit_map', args: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
const ops = calls.flatMap((c) => c.args.ops);
fs.writeFileSync(path.join(root, 'maps', `${map}.ops.json`), '[\n' + ops.map((o) => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n');
console.error(`${map}: ${stages.length} stages, ${ops.length} ops → maps/${map}.ops.json`);
if (process.argv.includes('--dry')) process.exit(0);
const tmp = path.join(root, 'test-results', `${map}-stages.json`);
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, JSON.stringify(calls));
execFileSync(process.execPath, [path.join(root, 'scripts/mcp.mjs'), 'calls', `@${path.relative(root, tmp)}`], { cwd: root, stdio: 'inherit' });
