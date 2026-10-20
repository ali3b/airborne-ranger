// Builds the game plus the gallery page and publishes them to the gh-pages branch (GitHub Pages).
//   node scripts/deploy-pages.mjs            build and push
//   node scripts/deploy-pages.mjs --no-push  build dist/ only (serve it to check: npx vite preview)
// The game's assets (public/assets) are generated locally by `npm run assets` and are not in the source branch,
// so Pages gets the built output, assets included.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });

if (!existsSync(path.join(root, 'public/assets/manifest.json'))) throw new Error('public/assets is missing: run `npm run assets` first');
run('npm run build');

const gallery = path.join(dist, 'gallery');
mkdirSync(gallery, { recursive: true });
cpSync(path.join(root, 'pages/gallery.html'), path.join(gallery, 'index.html'));
cpSync(path.join(root, 'docs/screenshots'), path.join(gallery, 'shots'), { recursive: true });
const video = path.join(root, 'test-results/airborne-ranger-gameplay-v2.mp4');
if (existsSync(video)) {
  mkdirSync(path.join(gallery, 'media'), { recursive: true });
  cpSync(video, path.join(gallery, 'media/gameplay.mp4'));
} else console.warn('no gameplay video (test-results/airborne-ranger-gameplay-v2.mp4): the gallery video will be missing');
// The documentary (FROM NOTHING) with its abridged and three-minute cuts: web encodes plus its subtitles, made outside the repo and dropped in test-results/.
for (const [src, dst] of [['test-results/from-nothing-web.mp4', 'documentary.mp4'], ['test-results/from-nothing.en.vtt', 'documentary.en.vtt'], ['test-results/from-nothing-poster.jpg', 'documentary.jpg'],
  ['test-results/from-nothing-short-web.mp4', 'documentary-abridged.mp4'], ['test-results/from-nothing-short.en.vtt', 'documentary-abridged.en.vtt'], ['test-results/from-nothing-short-poster.jpg', 'documentary-abridged.jpg'],
  ['test-results/from-nothing-3min-web.mp4', 'documentary-3min.mp4'], ['test-results/from-nothing-3min.en.vtt', 'documentary-3min.en.vtt'], ['test-results/from-nothing-3min-poster.jpg', 'documentary-3min.jpg']]) {
  if (existsSync(path.join(root, src))) {
    mkdirSync(path.join(gallery, 'media'), { recursive: true });
    cpSync(path.join(root, src), path.join(gallery, 'media', dst));
  } else console.warn(`no ${src}: the gallery documentary will be missing`);
}
writeFileSync(path.join(dist, '.nojekyll'), '');

if (process.argv.includes('--no-push')) process.exit(0);
const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
rmSync(path.join(dist, '.git'), { recursive: true, force: true });
run('git init -q -b gh-pages', dist);
run('git add -A', dist);
run(`git commit -q -m "Pages build from ${sha}"`, dist);
run(`git push -q -f ${remote} gh-pages`, dist);
rmSync(path.join(dist, '.git'), { recursive: true, force: true });
console.log('pushed gh-pages');
