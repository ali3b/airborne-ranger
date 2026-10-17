// Gameplay demo v2: Ranger select (a seeded roster, a new Ranger enlisted) → mission select → a slice of each mission
// (1 temperate depot, 2 desert radar, 3 arctic airfield: planes destroyed) → the debriefing with a promotion.
//   npm run build && (cd dist && python3 -m http.server 5298) &   (stop that server by its PID afterwards)
//   node scripts/demo-record.mjs http://localhost:5298 test-results/demo
//   ffmpeg -i test-results/demo/gameplay.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart test-results/airborne-ranger-gameplay-v2.mp4
// Serve a static build, not vite. Cuts inside a mission are camera fades (the Ranger is moved during the black).
// Every page.evaluate returns plain data (a returned Phaser object makes Playwright serialise the scene graph and
// freezes the take), and the game's own methods (shoot, throwGrenade) are called directly instead of key presses.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const url = (process.argv[2] ?? 'http://localhost:5298').replace(/\/$/, '');
const out = process.argv[3] ?? 'demo-out';
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
// GPU WebGL through EGL (smooth); old headless mode (new headless greys the bottom of the video).
const browser = await chromium.launch({ env, headless: true, args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: out, size: { width: 1600, height: 900 } } });

// A roster with history, so the select screen shows ranks, ribbons and the fallen.
const SEED = [
  { id: 'v1', name: 'RUDDER', rank: 8, score: 6420, medals: { COM1: 2, BSM: 1, SSM: 1, DSC: 1 }, status: 'active', missions: 7, accomplished: [1, 2, 3, 1, 2, 3] },
  { id: 'v2', name: 'DARBY', rank: 5, score: 3150, medals: { COM1: 1, COM2: 1, BSM: 1 }, status: 'KIA', missions: 4, accomplished: [1, 2] },
  { id: 'v3', name: 'KOWALSKI', rank: 2, score: 980, medals: { COM1: 1 }, status: 'captured', missions: 2, accomplished: [1] },
  null,
  null,
  null,
];
await ctx.addInitScript((seed) => {
  if (!localStorage.getItem('ar.roster.v1')) localStorage.setItem('ar.roster.v1', JSON.stringify(seed));
}, SEED);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
};
const M = (fn, arg) => page.evaluate(fn, arg);
let T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);

// Fade to black, run `move` inside the mission, fade back in.
const cut = async (move, arg) => {
  await M(() => { window.game.scene.getScene('mission').cameras.main.fadeOut(250); });
  await wait(300);
  await M(move, arg);
  await wait(150);
  await M(() => { window.game.scene.getScene('mission').cameras.main.fadeIn(350); });
  await wait(400);
};

const missionReady = () => page.waitForFunction(() => window.game?.scene?.isActive('mission') && !!window.game.scene.getScene('mission').ranger, null, { timeout: 90000 });

/** Grenade target k from 8 m west until it's down (up to `throws` throws). */
const grenadeTarget = async (k, throws = 3) => {
  if ((await M((i) => window.game.scene.getScene('mission').targets[i].hp, k)) <= 0) return;
  await cut((i) => {
    const m = window.game.scene.getScene('mission');
    const t = m.targets[i];
    m.busy = false;
    m.prone = false;
    m.ranger.setPosition(t.at.x - 8 * m.ppm, t.at.y);
    m.facing = 'E';
  }, k);
  for (let tries = 0; tries < throws; tries++) {
    await M(() => { const m = window.game.scene.getScene('mission'); m.busy = false; m.throwGrenade(); });
    await wait(2000);
    if ((await M((i) => window.game.scene.getScene('mission').targets[i].hp, k)) <= 0) break;
  }
};

/** Every remaining target down without showing it (a mission slice that cuts to the extraction). */
const finishTargetsOffCamera = () =>
  M(() => {
    const m = window.game.scene.getScene('mission');
    for (const t of m.targets) if (t.hp > 0) { t.hp = 0; m.destroyProp(t); }
  });

/** Walk into the extraction zone (from 3 cells west of its centre) and wait for the end screen. */
const extract = async () => {
  await cut(() => {
    const m = window.game.scene.getScene('mission');
    const xs = m.extractArea.map((p) => p[0]);
    const ys = m.extractArea.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2 - 3;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    m.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
    m.facing = 'E';
  });
  await hold(['d'], 1500);
  await page.waitForFunction(() => !!window.game.scene.getScene('mission').outcome, null, { timeout: 15000 }).catch(() => undefined);
};

/** End screen → debriefing, held until every line is shown plus `ms`. */
const debrief = async (ms) => {
  await wait(900);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.scene.isActive('debrief'), null, { timeout: 15000 });
  await page.waitForFunction(() => window.game.scene.getScene('debrief').shown, null, { timeout: 30000 });
  const a = await M(() => {
    const d = window.game.scene.getScene('debrief').award;
    return { points: d.points, medal: d.medal, promotedTo: d.promotedTo, status: d.status };
  });
  log('debrief', JSON.stringify(a));
  await wait(ms);
  return a;
};

/** From the mission select, drop into mission n (1-based) by keys. */
const pickMission = async (n) => {
  await page.waitForFunction(() => window.game.scene.isActive('missions'), null, { timeout: 15000 });
  await wait(600);
  for (let k = 1; k < n; k++) {
    await page.keyboard.press('ArrowDown');
    await wait(350);
  }
  await wait(250);
  await page.keyboard.press('Enter');
  await missionReady();
  await M(() => {
    const m = window.game.scene.getScene('mission');
    m.god = true; // a demo, not a test of skill
    m.grenadesLeft = 20;
  });
};

await page.goto(url);
await page.waitForFunction(() => window.game?.scene?.isActive('title'), null, { timeout: 90000 });
T0 = Date.now();
log('title');
// The roster: look over the veterans, then enlist a new Ranger in slot 4.
await wait(1400);
for (let k = 0; k < 3; k++) {
  await page.keyboard.press('ArrowDown');
  await wait(500);
}
await page.keyboard.press('Enter'); // vacant → name entry (a random name is filled in)
await wait(600);
for (let k = 0; k < 16; k++) await page.keyboard.press('Backspace');
await page.keyboard.type('HARRIS', { delay: 110 });
await wait(400);
await page.keyboard.press('Enter'); // enlisted
await wait(900);
await page.keyboard.press('Enter'); // choose him
log('mission select');

// Mission 1, temperate: the drop, a walk and a crawl, a firefight, the depot goes up, extraction.
await pickMission(1);
log('mission 1');
await wait(1500);
await hold(['s', 'd'], 1200);
await hold(['Shift', 'd'], 1000);
await page.keyboard.press('x');
await hold(['d'], 900);
await page.keyboard.press('x');
await wait(300);
await cut(() => {
  const m = window.game.scene.getScene('mission');
  const r = m.ranger;
  const alive = m.enemies.filter((e) => e.state !== 'dead');
  alive.sort((a, b) => Math.hypot(a.sprite.x - r.x, a.sprite.y - r.y) - Math.hypot(b.sprite.x - r.x, b.sprite.y - r.y));
  const e = alive[0];
  r.setPosition(e.sprite.x - 7 * m.ppm, e.sprite.y);
  m.facing = 'E';
});
for (let i = 0; i < 4; i++) {
  await M(() => { const m = window.game.scene.getScene('mission'); m.busy = false; m.shoot(); });
  await wait(600);
}
await wait(600);
const t1 = await M(() => window.game.scene.getScene('mission').targets.length);
for (let i = 0; i < Math.min(t1, 2); i++) await grenadeTarget(i);
await wait(1500); // the burning depot
await finishTargetsOffCamera();
await extract();
await debrief(1800);
await page.keyboard.press('Enter'); // → mission select

// Mission 2, desert: the radar array.
await pickMission(2);
log('mission 2');
await wait(1200);
await hold(['Shift', 's', 'd'], 1300);
await grenadeTarget(0); // the first radar target
await wait(1500);
await finishTargetsOffCamera();
await extract();
// A quick look at the debriefing (Enter during the reveal shows it all).
await wait(900);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.game.scene.isActive('debrief'), null, { timeout: 15000 });
await wait(900);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.game.scene.getScene('debrief').shown, null, { timeout: 15000 });
await wait(1200);
await page.keyboard.press('Enter');

// Mission 3, arctic: every plane on the airfield destroyed, then out.
await pickMission(3);
log('mission 3');
await wait(1200);
await hold(['Shift', 'd'], 1100);
const t3 = await M(() => window.game.scene.getScene('mission').targets.length);
for (let i = 0; i < t3; i++) await grenadeTarget(i, 5);
await finishTargetsOffCamera(); // only if a plane still stands after five grenades
await wait(1500);
// The burning airfield: pull the camera back over the wrecks.
await M(() => {
  const m = window.game.scene.getScene('mission');
  const xs = m.targets.map((t) => t.at.x);
  const ys = m.targets.map((t) => t.at.y);
  m.cameras.main.stopFollow();
  m.cameras.main.pan((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2 - 40, 1200, 'Sine.easeInOut');
  m.cameras.main.zoomTo(0.75, 1200);
});
await wait(2600);
await M(() => {
  const m = window.game.scene.getScene('mission');
  m.cameras.main.zoomTo(1, 300);
  m.cameras.main.startFollow(m.ranger, true, 0.15, 0.15);
});
await extract();
await debrief(3000);

log('done');
const video = page.video();
await ctx.close();
await browser.close();
const file = await video.path();
fs.renameSync(file, `${out}/gameplay.webm`);
console.log('video:', `${out}/gameplay.webm`, 'errors:', errors.slice(0, 3));
