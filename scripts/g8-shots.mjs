// G8 (missions 5–8) screenshots for docs/screenshots: each objective in the game, staged with the scene's own
// state (the Ranger unhurtable, moved next to the objective).
//   node scripts/g8-shots.mjs [url]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const url = (process.argv[2] ?? 'http://localhost:5195').replace(/\/$/, '');
const out = 'docs/screenshots';
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

async function mission(map) {
  await page.goto(`${url}/?scene=mission&mission=${map}`);
  await page.waitForFunction(() => window.game?.scene?.getScene('mission')?.ranger && window.game.scene.getScene('mission').objective, null, { timeout: 90000 });
  await page.evaluate(() => {
    const m = window.game.scene.getScene('mission');
    m.god = true;
    for (const e of m.enemies) e.sprite.setActive(false);
  });
}
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
};
/** Stand the Ranger at a cell offset from a screen point and let the camera settle. */
const stand = (dx, dy) =>
  page.evaluate(
    async ([dx, dy]) => {
      const m = window.game.scene.getScene('mission');
      const p = m.__shotAt;
      m.ranger.setPosition(p.x + (dx - dy) * 32, p.y + (dx + dy) * 16);
      await new Promise((r) => setTimeout(r, 1500));
    },
    [dx, dy],
  );

// 5: the code book on the headquarters table.
await mission('mission5');
await page.evaluate(() => {
  const m = window.game.scene.getScene('mission');
  const [i, j] = m.objective.cell;
  m.__shotAt = { x: (i - j) * 32, y: (i + j) * 16 };
});
await stand(3, 4);
await shot('g8-mission5-codebook');

// 6: the officer gives up, then follows.
await mission('mission6');
await page.evaluate(() => {
  const m = window.game.scene.getScene('mission');
  m.__shotAt = { x: m.objective.officer.sprite.x, y: m.objective.officer.sprite.y };
});
await stand(1.2, 1.6);
await page.waitForTimeout(300);
await shot('g8-mission6-surrender');
await page.waitForFunction(() => window.game.scene.getScene('mission').objective.officer.following, null, { timeout: 30000 });
await stand(7, 6);
await page.waitForTimeout(4000);
await shot('g8-mission6-escort');

// 7: the SAM site.
await mission('mission7');
await page.evaluate(() => {
  const m = window.game.scene.getScene('mission');
  const t = m.targets.find((x) => x.name === 'sam_launcher');
  m.__shotAt = { x: t.at.x, y: t.at.y };
});
await stand(9, 9);
await shot('g8-mission7-sam');

// 8: the P.O.W. camp at dusk, then the prisoners out of the gate.
await mission('mission8');
await page.evaluate(() => {
  const m = window.game.scene.getScene('mission');
  const [i, j] = m.objective.exit;
  m.__shotAt = { x: (i - j) * 32, y: (i + j) * 16 };
});
await stand(2, 4);
await shot('g8-mission8-camp');
await page.evaluate(() => {
  const m = window.game.scene.getScene('mission');
  const g = m.objective.gate;
  m.explode({ x: g.at.x, y: g.at.y }, { radius: 1.5 });
});
await page.waitForFunction(() => window.game.scene.getScene('mission').objective.escort.following.length >= 3, null, { timeout: 60000 });
await stand(6, 6);
await page.waitForTimeout(5000);
await shot('g8-mission8-prisoners');
await browser.close();
