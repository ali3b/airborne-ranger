// Builds every asset declared in ssg.assets.json through the Synty Sprite Generator CLI (never its code).
//   npm run assets                         build everything
//   node scripts/build-assets.mjs ranger   rebuild a subset by name (the manifest keeps the rest)
// Output: public/assets/<name>/…  (phaser3 multiatlas + anims + meta) and public/assets/manifest.json.
// Exports run one at a time: the generator's GPU is shared.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';
const out = path.join(root, 'public/assets');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'ssg.assets.json'), 'utf8'));

const ssg = (args) => {
  const txt = execFileSync(process.execPath, [SSG, '--json', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 << 20 }).toString();
  return JSON.parse(txt);
};

/**
 * Names are not unique across packs (SM_Env_Tree_01 is in POLYGON_City and POLYGON_War, and a plain name export picks
 * City), and ids are local to one generator database. So: look the name up, keep the declared pack, export by id.
 */
// FB-003
function resolveAsset(s) {
  const r = ssg(['assets', s.asset, '--limit', '200']);
  const hits = r.items.filter((a) => a.name === s.asset && (!s.pack || a.pack === s.pack));
  if (!hits.length) throw new Error(`${s.name}: no model ${s.asset}${s.pack ? ` in ${s.pack}` : ''}`);
  if (hits.length > 1) console.error(`  ${s.name}: ${hits.length} models named ${s.asset} in ${s.pack}; using id ${hits[0].id}`);
  return hits[0];
}

function exportArgs(s, id, dir) {
  const a = ['export', String(id), '--view', spec.view, '--ppm', String(spec.ppm), '--format', spec.format, '--fps', String(s.fps ?? spec.fps)];
  a.push('--dirs', s.dirs ?? '8');
  if (s.class) a.push('--class', s.class);
  for (const w of s.with ?? []) a.push('--with', w);
  for (const c of s.anim ?? []) a.push('--anim', c);
  if (s.template) a.push('-t', s.template);
  if (s.set) a.push('--set', s.set);
  a.push(s.uniform ? '--uniform' : '--no-uniform');
  a.push('-o', dir);
  return a;
}

function build(s) {
  const asset = resolveAsset(s);
  const tmp = path.join(out, `.${s.name}.tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      r = ssg(exportArgs(s, asset.id, tmp));
      if (r.items?.every((i) => i.status === 'done')) break;
      throw new Error(r.items?.map((i) => `${i.name}: ${i.error ?? i.status}`).join(', ') ?? 'no result');
    } catch (e) {
      console.error(`  ${s.name}: export failed (attempt ${attempt}): ${String(e.message).split('\n')[0]}`);
      if (attempt === 2) throw e;
    }
  }
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
  const textureKey = anims[0]?.frames[0]?.key ?? path.basename(atlasFile, '.json');
  const dirs = [...new Set(anims.map((a) => a.key.split('_').pop()))];
  const clips = [...new Set(anims.map((a) => a.key.slice(0, a.key.lastIndexOf('_'))))];
  const frame0 = atlas.textures[0].frames[0];
  const validation = r.validation ?? [];
  if (validation.length) console.error(`  ${s.name}: validation ${validation.map((v) => `${v.level}:${v.code}`).join(', ')}`);
  return {
    name: s.name,
    asset: asset.name,
    assetId: asset.id,
    pack: asset.pack,
    kind: asset.kind,
    textureKey,
    atlas: `assets/${s.name}/${atlasFile}`,
    path: `assets/${s.name}/`,
    anims: `assets/${s.name}/${animsFile}`,
    meta: metaFile ? `assets/${s.name}/${metaFile}` : null,
    // True size in metres [x, y(up), z] around the model origin, for footprints. The export itself carries no footprint.
    size: asset.size ?? null, // FB-006
    frameSize: [frame0.sourceSize.w, frame0.sourceSize.h],
    dirs,
    clips,
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
Object.assign(manifest, { tileSize: spec.tileSize, view: spec.view, ppm: spec.ppm, format: spec.format, generatedBy: 'Synty Sprite Generator (ssg CLI)' });

const t0 = Date.now();
const failed = [];
for (const s of spec.sprites) {
  if (only.length && !only.includes(s.name)) continue;
  const t = Date.now();
  console.error(`=== ${s.name}: ${s.asset}`);
  try {
    manifest.sprites[s.name] = build(s);
    console.error(`  done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } catch (e) {
    failed.push(s.name);
    console.error(`  FAILED: ${String(e.message).split('\n')[0]}`);
  }
}
// Drop entries no longer declared.
for (const k of Object.keys(manifest.sprites)) if (!spec.sprites.some((s) => s.name === k)) delete manifest.sprites[k];
manifest.builtAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.error(`\n${Object.keys(manifest.sprites).length} sprites in manifest, built in ${((Date.now() - t0) / 1000).toFixed(1)} s${failed.length ? `; FAILED: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
