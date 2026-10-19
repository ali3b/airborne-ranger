// G6: frame rate on the big maps, and the overview map screen.
//   node scripts/perf-check.mjs [url] [mission1,mission2,…] [--phone] [--gpu] [--seconds 20] [--shots] [--nocull]
// The Ranger runs a fixed route (north from the drop, god mode) while the frame rate is sampled from Phaser's loop.
// --phone: a Pixel 7 sized landscape viewport (915×412, DPR 2.6, touch) with the CPU throttled 4× (CDP).
// --gpu: hardware GL (EGL) instead of SwiftShader, for realistic numbers; --shots: overview + compass screenshots.
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--seconds'));
const url = (pos[0] ?? 'http://localhost:5296').replace(/\/$/, '');
const maps = (pos[1] ?? 'mission1,mission2,mission3,mission4').split(',');
const phone = flag('--phone');
const seconds = Number(opt('--seconds', 20));
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const args = flag('--gpu') ? ['--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ env, args });
const ctx = await browser.newContext(
  phone ? { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } },
);
const results = [];
for (const map of maps) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (phone) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.goto(`${url}/?scene=mission&mission=${map}${phone ? '&touch=1' : ''}`);
  await page.waitForFunction(() => window.game?.scene?.isActive('mission') && window.game.scene.getScene('mission').ranger, null, { timeout: 180000 });
  await page.waitForTimeout(2000);
  const gl = await page.evaluate(() => {
    const g = window.game.renderer.gl;
    const dbg = g?.getExtension('WEBGL_debug_renderer_info');
    return g ? g.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : g.RENDERER) : 'canvas';
  });
  if (flag('--nocull')) {
    // For comparison: Phaser's own iso tile cull, every prop drawn and animated, no AI sleep.
    await page.evaluate(() => {
      const m = window.game.scene.getScene('mission');
      m.events.off('postupdate', m.cullWorld, m);
      for (const l of m.children.list.filter((o) => o.type === 'TilemapLayer')) l.cullCallback = window.Phaser.Tilemaps.Components.GetCullTilesFunction(l.layer.orientation);
      for (const p of m.props) p.sprite.setVisible(true).setActive(true);
      for (const e of m.enemies) e.sprite.setVisible(true);
      m.awake = (e) => (e.sprite.setActive(true), true);
    });
  }
  // Run north-west on the map (screen up-left = towards the map's top corner) with the keyboard, sampling fps.
  const r = await page.evaluate(async (seconds) => {
    const m = window.game.scene.getScene('mission');
    m.god = true;
    const loop = window.game.loop;
    // CPU time per frame: Phaser's step (update + render submit).
    const step = loop.callback;
    let stepMs = 0;
    let steps = 0;
    loop.callback = (t, d) => {
      const a = performance.now();
      step(t, d);
      stepMs += performance.now() - a;
      steps++;
    };
    const samples = [];
    const frames0 = loop.frame;
    const t0 = performance.now();
    let worst = 0;
    let last = performance.now();
    const keys = m.keys;
    keys.W.isDown = true;
    keys.SHIFT.isDown = true;
    let flip = 0;
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      if (now - t0 > (flip + 1) * 3000) {
        // zig-zag so the Ranger doesn't stop at a wall for the whole run
        flip++;
        keys.A.isDown = flip % 2 === 1;
        keys.D.isDown = flip % 2 === 0;
      }
      samples.push(loop.actualFps);
    }
    keys.W.isDown = keys.SHIFT.isDown = keys.A.isDown = keys.D.isDown = false;
    const frames = loop.frame - frames0;
    const secs = (performance.now() - t0) / 1000;
    const visible = m.props.filter((p) => p.sprite.visible).length;
    const awake = m.enemies.filter((e) => e.sprite.active).length;
    loop.callback = step;
    return { fps: +(frames / secs).toFixed(1), stepMs: +(stepMs / steps).toFixed(2), worstFrameMs: Math.round(worst), props: m.props.length, visibleProps: visible, enemies: m.enemies.length, awake, children: m.children.list.length, moved: m.rangerCell() };
  }, seconds);
  results.push({ map, gl, ...r, errors: errors.slice(0, 3) });
  console.log(JSON.stringify(results.at(-1)));
  if (flag('--shots')) {
    await page.screenshot({ path: `test-results/${map}-compass${phone ? '-phone' : ''}.png` });
    await page.evaluate(() => window.game.scene.getScene('mission').toggleMap());
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/${map}-overview${phone ? '-phone' : ''}.png` });
    await page.evaluate(() => window.game.scene.getScene('mission').toggleMap());
  }
  await page.close();
}
await browser.close();
