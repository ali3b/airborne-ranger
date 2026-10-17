// Smoke check: the game boots to a scene with no page errors, and saves a screenshot.
//   node scripts/load-check.mjs [url] [scene]
// Any scene but the title is entered directly with ?scene=<name> (the title honours it).
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5195';
const scene = process.argv[3] ?? 'title';
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(scene === 'title' ? url : `${url.replace(/\/$/, '')}/?scene=${encodeURIComponent(scene)}`);
let ok = true;
try {
  await page.waitForFunction((s) => window.game?.scene?.isActive(s), scene, { timeout: 90000 });
  await page.waitForTimeout(1500);
  console.log(`${scene} reached`);
  if (scene === 'field') {
    // Walk the Ranger a little (down-right, then right) so movement and direction animations run.
    await page.keyboard.down('s');
    await page.keyboard.down('d');
    await page.waitForTimeout(900);
    await page.keyboard.up('s');
    await page.waitForTimeout(500);
    await page.keyboard.up('d');
    await page.waitForTimeout(400);
    // Throw a grenade: the throw move's release event must spawn one.
    // Headless software GL runs a few fps and Phaser clamps the frame delta, so game time is slow here: poll.
    await page.keyboard.press('g');
    await page
      .waitForFunction(() => window.game.scene.getScene('field')?.grenadesThrown > 0, null, { timeout: 15000 })
      .catch(() => undefined);
    const state = await page.evaluate(() => {
      const f = window.game.scene.getScene('field');
      const r = f?.children?.list?.filter((o) => o.texture?.key === 'ranger')[0];
      return r ? { x: Math.round(r.x), y: Math.round(r.y), anim: r.anims?.currentAnim?.key ?? null, sprites: f.children.list.length, grenades: f.grenadesThrown } : null;
    });
    console.log('ranger:', JSON.stringify(state));
    if (!state || !state.anim) {
      ok = false;
      console.log('NO RANGER (assets missing? run npm run assets)');
    } else if (!state.grenades) {
      ok = false;
      console.log('NO GRENADE (throw move or release event missing?)');
    }
    await page.waitForTimeout(2500); // let the grenade land and explode for the screenshot
  }
} catch (e) {
  ok = false;
  console.log('NOT LOADED:', e.message.split('\n')[0]);
}
await page.screenshot({ path: `test-results/${scene}.png` }).catch(() => undefined);
const uniq = [...new Set(errors)].filter((e) => !/favicon/.test(e));
if (uniq.length) console.log('page errors:', uniq.slice(0, 5).join(' | '));
console.log(ok && !uniq.length ? 'game loads ok' : 'FAILED');
await browser.close();
process.exit(ok && !uniq.length ? 0 : 1);
