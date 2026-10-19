// G8 (lane g8b): screenshots of missions 9-12's objectives in action, for docs/screenshots/ (g8-mission<N>-*.png).
//   node scripts/g8b-shots.mjs [url] [mission9,mission10,…] [--gpu]
// Each mission: the Ranger is put at the objective (unhurtable, unseen) and the objective is played up to a
// telling moment: the camera exposure at the prototype, the hostages following out of the blown stockade, the
// garrison during a buzzer window, a charge being set at the fuel dump at dusk. Mission 9 again by touch at phone
// size (844×390) for the CAMERA item.
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
const url = (pos[0] ?? 'http://localhost:5297').replace(/\/$/, '');
const maps = (pos[1] ?? 'mission9,mission10,mission11,mission12').split(',');
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const args = argv.includes('--gpu') ? ['--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ env, args });

async function open(page, map, touch = false) {
  await page.goto(`${url}/?scene=mission&mission=${map}${touch ? '&touch=1' : ''}`);
  await page.waitForFunction(() => window.game?.scene?.getScene('mission')?.ranger && window.game.scene.getScene('mission').objective, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const m = window.game.scene.getScene('mission');
    m.god = true;
    m.sees = () => false;
    window.put = (cx, cy) => m.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
    window.cellOf = (p) => ({ x: (p.x / 32 + p.y / 16) / 2, y: (p.y / 16 - p.x / 32) / 2 });
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  });
}

for (const map of maps) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await open(page, map);
  const n = map.replace('mission', '');
  if (map === 'mission9') {
    await page.evaluate(async () => {
      const m = window.game.scene.getScene('mission');
      const p = m.props.find((x) => x.name === 'prototype_rocket');
      const c = window.cellOf(p.at);
      window.put(c.x + 1, c.y + 7);
      await window.wait(3000);
      m.touchExtras.find((x) => x.key === 'camera').action();
      await window.wait(1200);
    });
  }
  if (map === 'mission10') {
    await page.evaluate(async () => {
      const m = window.game.scene.getScene('mission');
      const gate = m.props.find((x) => x.name === 'stockade_gate');
      const g = window.cellOf(gate.at);
      window.put(g.x, g.y + 1.2);
      m.facing = 'NE';
      m.bombsLeft = 5;
      m.placeBomb();
      const t0 = performance.now();
      while (!m.bombs.length && performance.now() - t0 < 20000) await window.wait(100);
      m.bombs.forEach((b) => (b.fuse = 0.5));
      window.put(g.x, g.y + 12);
      while (!m.objective.state.freed && performance.now() - t0 < 40000) await window.wait(100);
      window.put(g.x + 1, g.y + 9);
      const t1 = performance.now();
      while (m.objective.followers.list.some((f) => f.exits.length) && performance.now() - t1 < 60000) await window.wait(200);
      window.put(g.x + 3, g.y + 13);
      await window.wait(2500);
    });
  }
  if (map === 'mission11') {
    await page.evaluate(async () => {
      const m = window.game.scene.getScene('mission');
      const a = m.objectiveArea;
      const cx = (Math.min(...a.map((q) => q[0])) + Math.max(...a.map((q) => q[0]))) / 2;
      const cy = (Math.min(...a.map((q) => q[1])) + Math.max(...a.map((q) => q[1]))) / 2;
      window.put(cx + 2, cy + 6);
      const o = m.objective;
      const t0 = performance.now();
      while (o.state.phase !== 'hold' && performance.now() - t0 < 10000) await window.wait(100);
      o.hurry();
      while (o.state.phase !== 'window' && performance.now() - t0 < 20000) await window.wait(100);
      m.grenadesLeft = 9;
      m.facing = 'NW';
      m.throwGrenade();
      await window.wait(3500);
      m.busy = false;
      m.facing = 'NE';
      m.throwGrenade();
      await window.wait(3000);
    });
  }
  if (map === 'mission12') {
    await page.evaluate(async () => {
      const m = window.game.scene.getScene('mission');
      const t = m.targets[0];
      const c = window.cellOf(t.at);
      const xs = t.world.map((q) => q.x);
      const half = (Math.max(...xs) - Math.min(...xs)) / 2;
      window.put(c.x + half * 0.7 + 0.6, c.y + half * 0.7 + 0.6);
      m.facing = 'N';
      m.placeBomb();
      await window.wait(2500);
      window.put(c.x + half * 0.7 + 3.5, c.y + half * 0.7 + 3);
      await window.wait(800);
    });
  }
  await page.screenshot({ path: `docs/screenshots/g8-mission${n}.png` });
  console.log(`docs/screenshots/g8-mission${n}.png`);
  await page.close();
}

// Touch: mission 9's item bar with CAMERA, at phone size.
if (maps.includes('mission9')) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await open(page, 'mission9', true);
  await page.evaluate(async () => {
    const m = window.game.scene.getScene('mission');
    const p = m.props.find((x) => x.name === 'prototype_rocket');
    const c = window.cellOf(p.at);
    window.put(c.x + 1, c.y + 7);
    await window.wait(800);
  });
  const btn = page.locator('#touch .items button[data-k="camera"]');
  const has = await btn.count();
  if (has) await btn.tap();
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => window.game.scene.getScene('mission').objective.state);
  console.log('touch camera:', has ? 'button found' : 'NO BUTTON', JSON.stringify(st));
  await page.screenshot({ path: 'docs/screenshots/g8-mission9-touch.png' });
  await ctx.close();
}
await browser.close();
