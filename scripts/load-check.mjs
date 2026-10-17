// Smoke check: the game boots to the title scene with no page errors, and saves a screenshot.
//   node scripts/load-check.mjs [url] [scene]
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
await page.goto(url);
let ok = true;
try {
  await page.waitForFunction((s) => window.game?.scene?.isActive(s), scene, { timeout: 90000 });
  await page.waitForTimeout(1500);
  console.log(`${scene} reached`);
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
