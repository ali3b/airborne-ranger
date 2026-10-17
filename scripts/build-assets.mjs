// Builds every asset declared in ssg.assets.json through the Synty Sprite Generator CLI (never its code).
//   npm run assets                         build everything
//   node scripts/build-assets.mjs ranger   rebuild a subset by name (the manifest keeps the rest)
// Output: public/assets/<name>/…  (phaser3 multiatlas + anims + meta) and public/assets/manifest.json.
// Exports run one at a time: the generator's GPU is shared.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';
const out = path.join(root, 'public/assets');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'ssg.assets.json'), 'utf8'));

// An export that shows no new progress line for this long counts as hung and is stopped (its batch keeps running
// in the generator). FB-016: the CLI's progress doesn't move while frames render, so the limit is generous.
const STALL_MS = 4 * 60 * 1000;

/** Run an export, echoing the CLI's progress lines, and stop it if they stall. */
function ssgExport(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SSG, '--json', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let last = '';
    let lastChange = Date.now();
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => {
      const lines = String(d).split(/[\r\n]+/).filter(Boolean);
      for (const l of lines) {
        if (l !== last) {
          last = l;
          lastChange = Date.now();
          process.stderr.write(`  | ${l}\n`);
        }
      }
    });
    const watchdog = setInterval(() => {
      if (Date.now() - lastChange > STALL_MS) {
        clearInterval(watchdog);
        p.kill('SIGTERM');
        reject(new Error(`export stalled for ${STALL_MS / 60000} min (last progress: ${last || 'none'}) and was stopped`));
      }
    }, 5000);
    p.on('close', (code) => {
      clearInterval(watchdog);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`ssg exited ${code} without a JSON result`));
      }
    });
  });
}

// Models are named Pack/Model (e.g. POLYGON_War/SM_Env_Tree_01): names repeat across packs.
function exportArgs(s, dir) {
  const a = ['export', s.asset, '--view', spec.view, '--tile', spec.tile, '--metres-per-tile', String(spec.metresPerTile)];
  a.push('--format', spec.format, '--fps', String(s.fps ?? spec.fps), '--dirs', s.dirs ?? '8');
  if (s.class) a.push('--class', s.class);
  for (const w of s.with ?? []) a.push('--with', w);
  if (s.anim?.length) a.push('--anim', s.anim.join(','));
  if (s.template) a.push('-t', s.template);
  if (s.set) a.push('--set', s.set);
  const maxSeconds = s.maxSeconds ?? (s.class ? spec.maxSeconds : undefined);
  if (maxSeconds) a.push('--max-seconds', String(maxSeconds));
  a.push(s.uniform ? '--uniform' : '--no-uniform');
  a.push('-o', dir);
  return a;
}

async function build(s) {
  const tmp = path.join(out, `.${s.name}.tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  const args = exportArgs(s, tmp);
  console.error(`  ssg ${args.join(' ')}`);
  const r = await ssgExport(args);
  if (!r.items?.every((i) => i.status === 'done')) throw new Error(r.items?.map((i) => `${i.name}: ${i.error ?? i.status}`).join(', ') ?? 'no result');
  const item = r.items[0];
  // The CLI writes <out>/<model name>/…; flatten to public/assets/<name>/.
  const sub = fs.readdirSync(tmp).map((d) => path.join(tmp, d)).find((d) => fs.statSync(d).isDirectory());
  const dest = path.join(out, s.name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(sub, dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(dest, 'previews'), { recursive: true, force: true });

  const files = fs.readdirSync(dest);
  const animsFile = files.find((f) => f.endsWith('_anims.json'));
  const metaFile = files.find((f) => f.endsWith('.meta.json'));
  const atlasFile = files.find((f) => f.endsWith('.json') && f !== animsFile && f !== metaFile && !f.endsWith('.sheet.json'));
  const anims = JSON.parse(fs.readFileSync(path.join(dest, animsFile), 'utf8')).anims;
  const atlas = JSON.parse(fs.readFileSync(path.join(dest, atlasFile), 'utf8'));
  const meta = metaFile ? JSON.parse(fs.readFileSync(path.join(dest, metaFile), 'utf8')) : null;
  const textureKey = anims[0]?.frames[0]?.key ?? path.basename(atlasFile, '.json');
  const dirs = [...new Set(anims.map((a) => a.key.split('_').pop()))];
  const clips = [...new Set(anims.map((a) => a.key.slice(0, a.key.lastIndexOf('_'))))];
  const frame0 = atlas.textures[0].frames[0];
  const validation = meta?.validation ?? r.validation ?? [];
  if (validation.length) console.error(`  ${s.name}: validation ${validation.map((v) => `${v.level}:${v.code}`).join(', ')}`);
  return {
    name: s.name,
    asset: item.name,
    assetId: item.assetId,
    pack: s.asset.includes('/') ? s.asset.split('/')[0] : null,
    textureKey,
    atlas: `assets/${s.name}/${atlasFile}`,
    path: `assets/${s.name}/`,
    anims: `assets/${s.name}/${animsFile}`,
    meta: metaFile ? `assets/${s.name}/${metaFile}` : null,
    pixelsPerMetre: meta?.pixelsPerMetre ?? null,
    frameSize: [frame0.sourceSize.w, frame0.sourceSize.h],
    dirs,
    clips,
    // Per clip: ground speed (locomotion only) and named events by frame.
    clipInfo: Object.fromEntries((meta?.clips ?? []).map((c) => [c.name, { speedMps: c.speedMps ?? null, events: c.events ?? [] }])),
    // Props: footprint, anchor and collision polygon per direction (generator Phase A object metadata).
    object: meta?.object ?? null,
    validation,
    batch: r.batch,
  };
}

fs.mkdirSync(out, { recursive: true });
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const unknown = only.filter((n) => !spec.sprites.some((s) => s.name === n));
if (unknown.length) {
  console.error(`unknown asset name(s): ${unknown.join(', ')} (see ssg.assets.json)`);
  process.exit(1);
}
const manifestPath = path.join(out, 'manifest.json');
const manifest = only.length && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { sprites: {} };
Object.assign(manifest, { tile: spec.tile, metresPerTile: spec.metresPerTile, view: spec.view, format: spec.format, generatedBy: 'Synty Sprite Generator (ssg CLI)' });

const t0 = Date.now();
const failed = [];
for (const s of spec.sprites) {
  if (only.length && !only.includes(s.name)) continue;
  const t = Date.now();
  console.error(`=== ${s.name}: ${s.asset}`);
  try {
    manifest.sprites[s.name] = await build(s);
    console.error(`  done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } catch (e) {
    failed.push(s.name);
    console.error(`  FAILED: ${String(e.message).split('\n')[0]}`);
  }
}
// Drop entries no longer declared.
for (const k of Object.keys(manifest.sprites)) if (!spec.sprites.some((s) => s.name === k)) delete manifest.sprites[k];
// Under the tile lock every sprite shares one scale; the game reads it from here. FB-019: only props record the
// tile in their export, so check the scale agrees and take the tile from ssg.assets.json.
const ppms = [...new Set(Object.values(manifest.sprites).map((x) => x.pixelsPerMetre).filter(Boolean).map((v) => v.toFixed(3)))];
if (ppms.length > 1) console.error(`  WARNING: sprites disagree on pixels per metre: ${ppms.join(', ')}`);
manifest.ppm = Number(ppms[0] ?? 0);
manifest.builtAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.error(`\n${Object.keys(manifest.sprites).length} sprites in manifest, built in ${((Date.now() - t0) / 1000).toFixed(1)} s${failed.length ? `; FAILED: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
