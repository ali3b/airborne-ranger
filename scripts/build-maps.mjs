// Builds the mission maps from scratch through the Synty Sprite Generator CLI's map ops (never its code).
//   node scripts/build-maps.mjs              every map in ssg.assets.json `maps`
//   node scripts/build-maps.mjs mission1     one map (and the stamp maps it needs are not rebuilt)
// Each entry of `maps` names a map in the project, its size and tileset, and a JSON op list (maps/*.ops.json: the
// same ops as the MCP's edit_map, applied in one atomic `ssg map edit`). The map is wiped first with ops (FB-034: no
// map delete or reset), so the result depends only on the op list and its seeds. An entry can then save stamps cut from
// the map (`stamps`), export Tiled .tmj with embedded tilesets (`export`, for Phaser) and preview PNGs.
// public/assets/manifest.json gets a `maps` section.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';
const spec = JSON.parse(fs.readFileSync(path.join(root, 'ssg.assets.json'), 'utf8'));
const P = ['--project', spec.project];

/** Run the CLI with --json. Resolves {code, json, stdout, stderr}. */
function ssg(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SSG, '--json', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        /* not JSON */
      }
      resolve({ code, json, stdout, stderr });
    });
  });
}

async function must(args, what) {
  const r = await ssg(args);
  if (r.code !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(0, 1500)}`);
  return r;
}

/** The project's map with this name (FB-033: names aren't unique; the oldest wins). */
async function findMap(name) {
  const r = await must(['map', 'list', ...P], 'map list');
  const all = (Array.isArray(r.json) ? r.json : r.json?.maps ?? []).filter((m) => m.name === name).sort((a, b) => a.id - b.id);
  if (all.length > 1) console.error(`  warning: ${all.length} maps are named "${name}" (ids ${all.map((m) => m.id).join(', ')}); using ${all[0].id}`);
  return all[0] ?? null;
}

/**
 * Ops that empty a map: remove every object and zone and clear the collision. The ground is repainted by the op list
 * (its first op is a whole-map `generate`). FB-034: there is no `map delete` / reset in the CLI or MCP.
 */
async function wipeOps(id, size) {
  const r = await must(['map', 'show', String(id), ...P], 'map show');
  const m = r.json;
  const [w, h] = size.split('x').map(Number);
  return [
    ...(m.objectList ?? []).map((o) => ({ op: 'remove', id: o.id })),
    ...(m.zones ?? []).map((z) => ({ op: 'removeZone', id: z.id })),
    { op: 'rect', x0: 0, y0: 0, x1: w - 1, y1: h - 1, value: false },
  ];
}

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

async function buildMap(def) {
  const t0 = Date.now();
  console.error(`=== map: ${def.name} (${def.size}, ${def.ops})`);
  let map = await findMap(def.name);
  if (!map) {
    await must(['map', 'create', def.name, ...P, '--size', def.size, '--tileset', def.tileset], 'map create');
    map = await findMap(def.name);
  } else if (map.size !== def.size) {
    throw new Error(`map ${def.name} is ${map.size}, the definition says ${def.size} (resize it in the app or rename the entry)`);
  }
  const ops = [...(await wipeOps(map.id, def.size)), ...readJson(def.ops)];
  const tmp = path.join(root, 'test-results', `${def.name}.ops.applied.json`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(ops));
  const r = await must(['map', 'edit', String(map.id), ...P, `@${tmp}`], `map edit ${def.name}`);
  // Each generator op reports what it did: placed vs. target, skipped spots.
  for (const x of r.json?.reports ?? []) {
    if (!['generate', 'path', 'scatter', 'stamp'].includes(x.op)) continue;
    const { index, op, ...rest } = x;
    console.error(`  ${op}: ${JSON.stringify(rest)}`);
  }
  console.error(`  revision ${r.json?.revision}, ${r.json?.applied ?? ops.length} ops`);

  for (const s of def.stamps ?? []) {
    await must(['map', 'stamp', 'save', String(map.id), s.name, '--rect', s.rect.join(','), '--replace', ...P], `stamp save ${s.name}`);
    console.error(`  saved stamp ${s.name} (${s.rect.join(',')})`);
  }

  const entry = { name: def.name, id: map.id, size: def.size };
  if (def.export) {
    const dir = path.join(root, def.export);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const e = await must(['map', 'export', String(map.id), ...P, '-f', 'tmj', '--embed', '-o', dir], `map export ${def.name}`);
    for (const w of [e.json?.warnings ?? []].flat()) console.error(`  export warning: ${typeof w === 'string' ? w : JSON.stringify(w)}`);
    const tmj = fs.readdirSync(dir).find((f) => f.endsWith('.tmj'));
    if (!tmj) throw new Error(`map export wrote no .tmj (${fs.readdirSync(dir).join(', ')})`);
    const rel = path.relative(path.join(root, 'public'), dir);
    entry.tmj = `${rel}/${tmj}`;
    entry.path = `${rel}/`;
    // The generator's own picture of the map (what Tiled/Phaser should draw) and a minimap, for review.
    await must(['map', 'preview', String(map.id), ...P, '-o', path.join(dir, 'preview.png'), '--bg', '10140c', '--max', '3072'], 'map preview');
    await must(['map', 'preview', String(map.id), ...P, '-o', path.join(dir, 'minimap.png'), '--minimap', '--scale', '6'], 'map minimap');
    entry.preview = `${rel}/preview.png`;
    entry.minimap = `${rel}/minimap.png`;
  }
  console.error(`  built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return entry;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const defs = (spec.maps ?? []).filter((d) => !only.length || only.includes(d.name));
const manifestPath = path.join(root, 'public/assets/manifest.json');
const failed = [];
const built = {};
for (const d of defs) {
  try {
    built[d.name] = await buildMap(d);
  } catch (e) {
    failed.push(d.name);
    console.error(`  ${d.name} FAILED: ${e.message}`);
  }
}
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.maps ??= {};
  for (const [k, v] of Object.entries(built)) if (v.tmj) manifest.maps[k] = v;
  for (const k of Object.keys(manifest.maps)) if (!(spec.maps ?? []).some((d) => d.name === k && d.export)) delete manifest.maps[k];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
console.error(`${Object.keys(built).length} map(s) built${failed.length ? `; FAILED: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
