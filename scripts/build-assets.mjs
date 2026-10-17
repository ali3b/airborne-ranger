// Builds every asset declared in ssg.assets.json through the Synty Sprite Generator CLI (never its code).
//   npm run assets                           build everything
//   node scripts/build-assets.mjs ranger     apply/render/download a subset by name (the manifest keeps the rest)
//   node scripts/build-assets.mjs --no-tilesets   skip the ground tilesets
// Sprites: `ssg sprite apply ssg.assets.json --render --download public/assets` keeps every sprite in the
// generator project named in the file (visible and editable in the app), renders only what is outdated and writes
// public/assets/<name>/. Tilesets: `ssg tileset create / terrain add / export` into public/assets/tilesets/.
// Then public/assets/manifest.json is written from the downloaded folders.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';
const out = path.join(root, 'public/assets');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'ssg.assets.json'), 'utf8'));

// A render that shows no new progress line for this long counts as hung and is stopped (its batch keeps running in
// the generator).
const STALL_MS = 4 * 60 * 1000;

/** Run the CLI with --json, echoing its progress lines; stop it if they stall. Resolves {code, json, stdout}. */
function ssg(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SSG, '--json', ...args], { cwd: root, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (input) p.stdin.end(input);
    let stdout = '';
    let last = '';
    let lastChange = Date.now();
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => {
      for (const l of String(d).split(/[\r\n]+/).filter(Boolean)) {
        if (l === last) continue;
        last = l;
        lastChange = Date.now();
        process.stderr.write(`  | ${l}\n`);
      }
    });
    const watchdog = setInterval(() => {
      if (Date.now() - lastChange > STALL_MS) {
        clearInterval(watchdog);
        p.kill('SIGTERM');
        reject(new Error(`ssg ${args[0]} stalled for ${STALL_MS / 60000} min (last progress: ${last || 'none'}) and was stopped`));
      }
    }, 5000);
    p.on('close', (code) => {
      clearInterval(watchdog);
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        /* not JSON */
      }
      resolve({ code, json, stdout });
    });
  });
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Manifest entry for one downloaded sprite folder public/assets/<name>/. */
function describe(s) {
  const dest = path.join(out, s.name);
  const files = fs.readdirSync(dest);
  // The base sheet's files (a layered export adds <base>_<layer>… files next to them: shortest name wins).
  const animsFile = files.filter((f) => f.endsWith('_anims.json')).sort((x, y) => x.length - y.length)[0];
  const base = animsFile?.slice(0, -'_anims.json'.length);
  const metaFile = files.find((f) => f === `${base}.meta.json`);
  const atlasFile = files.find((f) => f === `${base}.json`);
  const layered = files.some((f) => f.endsWith('.layers.json'));
  if (!animsFile || !atlasFile) throw new Error(`no phaser3 atlas/anims in ${dest} (${files.join(', ')})`);
  const anims = readJson(path.join(dest, animsFile)).anims;
  const atlas = readJson(path.join(dest, atlasFile));
  const meta = metaFile ? readJson(path.join(dest, metaFile)) : null;
  const textureKey = anims[0]?.frames[0]?.key ?? path.basename(atlasFile, '.json');
  // Anim keys are "<base>/<clip>_<dir>" (FB-007 fixed): the game plays them as they are.
  const bare = (k) => k.slice(k.lastIndexOf('/') + 1);
  const dirs = [...new Set(anims.map((a) => bare(a.key).split('_').pop()))];
  const clips = [...new Set(anims.map((a) => bare(a.key).slice(0, bare(a.key).lastIndexOf('_'))))];
  const frame0 = atlas.textures[0].frames[0];
  const validation = meta?.validation ?? [];
  // FB-021: apply renders `with` items as layers unless the entry says `layered: false` (ssg.assets.json does).
  if (layered) console.error(`  ${s.name}: WARNING: layered render (the base sheet lacks the --with items); the game draws only the base`);
  if (validation.length) console.error(`  ${s.name}: validation ${validation.map((v) => `${v.level}:${v.code}`).join(', ')}`);
  return {
    name: s.name,
    asset: s.asset,
    pack: s.asset.includes('/') ? s.asset.split('/')[0] : null,
    textureKey,
    atlas: `assets/${s.name}/${atlasFile}`,
    path: `assets/${s.name}/`,
    anims: `assets/${s.name}/${animsFile}`,
    animPrefix: anims[0] ? anims[0].key.slice(0, anims[0].key.lastIndexOf('/') + 1) : '',
    meta: metaFile ? `assets/${s.name}/${metaFile}` : null,
    scale: meta?.scale ?? null,
    pixelsPerMetre: meta?.scale?.pixelsPerMetre ?? meta?.pixelsPerMetre ?? null,
    frameSize: [frame0.sourceSize.w, frame0.sourceSize.h],
    dirs,
    clips,
    // Per clip: ground speed (locomotion only) and named events by frame.
    clipInfo: Object.fromEntries((meta?.clips ?? []).map((c) => [c.name, { speedMps: c.speedMps ?? null, events: c.events ?? [] }])),
    // Props: footprint, anchor and collision polygon per direction (generator object metadata).
    object: meta?.object ?? null,
    layered,
    validation,
  };
}

// FB-024: tilesets have no declarative apply like sprites, so this syncs them by hand (missing terrains only).
/** A ground tileset: created in the project if missing, its missing terrains added, then exported as Tiled .tsj + PNG. */
async function buildTileset(t) {
  const dir = path.join(out, 'tilesets', t.name);
  const P = ['--project', spec.project];
  const listed = await ssg(['tileset', 'list', ...P]);
  const all = Array.isArray(listed.json) ? listed.json : listed.json?.tilesets ?? [];
  if (!all.some((x) => x.name === t.name)) {
    const r = await ssg(['tileset', 'create', t.name, ...P, '--tile', spec.tile, '--metres-per-tile', String(spec.metresPerTile)]);
    if (r.code !== 0) throw new Error(`tileset create: ${r.stdout.trim()}`);
  }
  const shown = await ssg(['tileset', 'show', t.name, ...P]);
  const have = new Set((shown.json?.terrains ?? shown.json?.tileset?.terrains ?? []).map((x) => x.name));
  for (const tr of t.terrains) {
    if (have.has(tr.name)) continue;
    const a = ['tileset', 'terrain', 'add', t.name, tr.name, ...P];
    for (const k of ['kind', 'color', 'noise', 'texture', 'tint', 'blend', 'variants']) if (tr[k] != null) a.push(`--${k}`, String(tr[k]));
    const r = await ssg(a);
    if (r.code !== 0) throw new Error(`terrain add ${tr.name}: ${r.stdout.trim()}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const r = await ssg(['tileset', 'export', t.name, ...P, '-f', 'tsj', '-o', dir]);
  if (r.code !== 0) throw new Error(`tileset export: ${r.stdout.trim()}`);
  const tsj = fs.readdirSync(dir).find((f) => f.endsWith('.tsj'));
  if (!tsj) throw new Error(`tileset export wrote no .tsj (${fs.readdirSync(dir).join(', ')})`);
  const ts = readJson(path.join(dir, tsj));
  return { name: t.name, tsj: `assets/tilesets/${t.name}/${tsj}`, image: `assets/tilesets/${t.name}/${ts.image}`, path: `assets/tilesets/${t.name}/` };
}

fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const known = [...spec.sprites.map((s) => s.name), ...(spec.tilesets ?? []).map((t) => t.name)];
const unknown = only.filter((n) => !known.includes(n));
if (unknown.length) {
  console.error(`unknown asset name(s): ${unknown.join(', ')} (see ssg.assets.json)`);
  process.exit(1);
}
const wanted = (name) => !only.length || only.includes(name);
const manifestPath = path.join(out, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : {};
manifest.sprites ??= {};
manifest.tilesets ??= {};
Object.assign(manifest, { project: spec.project, tile: spec.tile, metresPerTile: spec.metresPerTile, view: spec.view, format: spec.format, generatedBy: 'Synty Sprite Generator (ssg CLI)' });

const t0 = Date.now();
const failed = [];

// 1. Sprites: one apply for the whole file (a subset goes on stdin). The generator renders only outdated sprites.
const sprites = spec.sprites.filter((s) => wanted(s.name));
if (sprites.length) {
  const { tilesets: _t, maps: _m, ...rest } = spec;
  const subset = only.length ? JSON.stringify({ ...rest, sprites }) : null;
  console.error(`=== sprites → project "${spec.project}": ${sprites.map((s) => s.name).join(', ')}`);
  try {
    const r = await ssg(['sprite', 'apply', subset ? '-' : 'ssg.assets.json', '--render', '--download', 'public/assets'], { input: subset });
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results/sprite-apply.json'), r.stdout);
    if (r.code !== 0) console.error(`  ssg sprite apply exited ${r.code}: ${r.json ? '' : r.stdout.trim().slice(0, 400)}`);
    for (const x of r.json?.sprites ?? r.json?.results ?? []) console.error(`  ${x.name}: ${[x.action, x.render?.status ?? x.render, x.download?.status ?? x.download].filter((v) => typeof v === 'string').join(' · ')}`);
  } catch (e) {
    console.error(`  FAILED: ${String(e.message).split('\n')[0]}`);
  }
  for (const s of sprites) {
    try {
      fs.rmSync(path.join(out, s.name, 'previews'), { recursive: true, force: true });
      manifest.sprites[s.name] = describe(s);
    } catch (e) {
      failed.push(s.name);
      console.error(`  ${s.name} FAILED: ${String(e.message).split('\n')[0]}`);
    }
  }
}

// 2. Ground tilesets.
if (!args.includes('--no-tilesets')) {
  for (const t of (spec.tilesets ?? []).filter((t) => wanted(t.name) || !only.length)) {
    console.error(`=== tileset: ${t.name}`);
    try {
      manifest.tilesets[t.name] = await buildTileset(t);
    } catch (e) {
      failed.push(t.name);
      console.error(`  FAILED: ${String(e.message).split('\n')[0]}`);
    }
  }
}

// Drop entries no longer declared.
for (const k of Object.keys(manifest.sprites)) if (!spec.sprites.some((s) => s.name === k)) delete manifest.sprites[k];
for (const k of Object.keys(manifest.tilesets)) if (!(spec.tilesets ?? []).some((t) => t.name === k)) delete manifest.tilesets[k];
// Under the tile lock every sprite shares one grid: every data file carries a `scale` record (FB-019). Check it.
const grids = [...new Set(Object.values(manifest.sprites).map((x) => (x.scale ? `${x.scale.mode} ${x.scale.tilePx}x${x.scale.tileHeightPx} ${x.scale.metresPerTile} m` : 'none')))];
if (grids.length !== 1 || grids[0] !== `tile ${spec.tile} ${spec.metresPerTile} m`) console.error(`  WARNING: sprites' scale records: ${grids.join(' | ')} (expected tile ${spec.tile} ${spec.metresPerTile} m)`);
const ppms = [...new Set(Object.values(manifest.sprites).map((x) => x.pixelsPerMetre).filter(Boolean).map((v) => v.toFixed(3)))];
if (ppms.length > 1) console.error(`  WARNING: sprites disagree on pixels per metre: ${ppms.join(', ')}`);
manifest.ppm = Number(ppms[0] ?? 0);
manifest.builtAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.error(
  `\n${Object.keys(manifest.sprites).length} sprites, ${Object.keys(manifest.tilesets).length} tilesets in the manifest, built in ${((Date.now() - t0) / 1000).toFixed(1)} s${failed.length ? `; FAILED: ${failed.join(', ')}` : ''}`,
);
process.exit(failed.length ? 1 : 0);
