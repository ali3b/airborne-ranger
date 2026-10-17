// Gameplay demo: title → mission select → mission 1 (drop, move, firefight, grenade the depot, extract) → mission 2.
//   npm run build && (cd dist && python3 -m http.server 5297) &  then: node scripts/demo-record.mjs http://localhost:5297 test-results/demo
//   ffmpeg -i test-results/demo/gameplay.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart test-results/gameplay.mp4
// Serve a static build (not vite): the load checks stop every vite, which would kill the take.
// Cuts between scenes are camera fades (the Ranger is moved during the black), so there are no idle stretches.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5196';
const out = process.argv[3] ?? 'demo-out';
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
// GPU WebGL through EGL (smooth); old headless mode (new headless greys the bottom of the video).
const browser = await chromium.launch({ env, headless: true, args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: out, size: { width: 1600, height: 900 } } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of keys.reverse()) await page.keyboard.up(k);
};
const M = (fn, arg) => page.evaluate(fn, arg);

// Fade to black, run `move` inside the scene, fade back in.
const cut = async (move, arg) => {
  await M(() => { window.game.scene.getScene('mission').cameras.main.fadeOut(250); });
  await wait(300);
  await M(move, arg);
  await wait(150);
  await M(() => { window.game.scene.getScene('mission').cameras.main.fadeIn(350); });
  await wait(400);
};

await page.goto(url);
await page.waitForFunction(() => window.game?.scene?.isActive('title'), null, { timeout: 90000 });
await wait(2500);
await page.keyboard.press('ArrowDown');
await wait(700);
await page.keyboard.press('ArrowUp');
await wait(700);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.game?.scene?.isActive('mission') && window.game.scene.getScene('mission').ranger, null, { timeout: 90000 });
await M(() => {
  const m = window.game.scene.getScene('mission');
  m.god = true; // a demo, not a test of skill
  m.grenadesLeft = 20;
});
await wait(2500);

// Move around the drop zone: walk, run, go prone and crawl, stand.
await hold(['s', 'd'], 1600);
await hold(['Shift', 'd'], 1400);
await hold(['Shift', 's'], 1000);
await page.keyboard.press('x');
await hold(['d'], 1400);
await page.keyboard.press('x');
await wait(500);

// Firefight: next to the nearest German, facing him, a few shots.
await cut(() => {
  const m = window.game.scene.getScene('mission');
  const r = m.ranger;
  const alive = m.enemies.filter((e) => e.state !== 'dead');
  alive.sort((a, b) => Math.hypot(a.sprite.x - r.x, a.sprite.y - r.y) - Math.hypot(b.sprite.x - r.x, b.sprite.y - r.y));
  const e = alive[0];
  r.setPosition(e.sprite.x - 7 * m.ppm, e.sprite.y);
  m.facing = 'E';
});
for (let i = 0; i < 5; i++) {
  await M(() => { const m = window.game.scene.getScene('mission'); m.busy = false; m.shoot(); });
  await wait(650);
}
await wait(1200);

// The depot: grenades at each target from 8 m west, like a player working round it.
const targets = await M(() => window.game.scene.getScene('mission').targets.length);
for (let i = 0; i < targets; i++) {
  const hp = await M((k) => window.game.scene.getScene('mission').targets[k].hp, i);
  if (hp <= 0) continue;
  await cut((k) => {
    const m = window.game.scene.getScene('mission');
    const t = m.targets[k];
    m.busy = false;
    m.prone = false;
    m.ranger.setPosition(t.at.x - 8 * m.ppm, t.at.y);
    m.facing = 'E';
  }, i);
  for (let tries = 0; tries < 3; tries++) {
    await M(() => { const m = window.game.scene.getScene('mission'); m.busy = false; m.throwGrenade(); });
    await wait(2200);
    if ((await M((k) => window.game.scene.getScene('mission').targets[k].hp, i)) <= 0) break;
  }
}
await wait(2500); // the burning depot

// Extraction.
await cut(() => {
  const m = window.game.scene.getScene('mission');
  const xs = m.extractArea.map((p) => p[0]);
  const ys = m.extractArea.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 - 3;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  m.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
  m.facing = 'E';
});
await hold(['d'], 2200);
await page.waitForFunction(() => window.game.scene.getScene('mission').outcome, null, { timeout: 15000 }).catch(() => undefined);
await wait(3500);

// Mission 2, the desert: the drop, then the radar array goes up.
await page.goto(`${url}/?scene=mission&mission=mission2`);
await page.waitForFunction(() => window.game?.scene?.isActive('mission') && window.game.scene.getScene('mission').ranger, null, { timeout: 90000 });
await M(() => {
  const m = window.game.scene.getScene('mission');
  m.god = true;
  m.grenadesLeft = 20;
});
await wait(1500);
await hold(['Shift', 's', 'd'], 1800);
const t2 = await M(() => window.game.scene.getScene('mission').targets.length);
for (let i = 0; i < Math.min(t2, 2); i++) {
  await cut((k) => {
    const m = window.game.scene.getScene('mission');
    const t = m.targets[k];
    m.busy = false;
    m.ranger.setPosition(t.at.x - 8 * m.ppm, t.at.y);
    m.facing = 'E';
  }, i);
  for (let tries = 0; tries < 3; tries++) {
    await M(() => { const m = window.game.scene.getScene('mission'); m.busy = false; m.throwGrenade(); });
    await wait(2200);
    if ((await M((k) => window.game.scene.getScene('mission').targets[k].hp, i)) <= 0) break;
  }
}
await wait(3000);

const video = page.video();
await ctx.close();
await browser.close();
const file = await video.path();
fs.renameSync(file, `${out}/gameplay.webm`);
console.log('video:', `${out}/gameplay.webm`, 'errors:', errors.slice(0, 3));
