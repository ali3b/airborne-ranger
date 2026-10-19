// Screenshots of the Ranger's one-sheet loadouts in a mission (FB-072/073/074): the LAW on the shoulder as it fires,
// the time bomb set on the ground, the first-aid kit, a grenade throw and the knife, each at the clip's event frame.
//   node scripts/ranger-shots.mjs [url] [outDir]     (default http://localhost:5195, docs/screenshots)
// It also checks that every clip the game plays exists on the one `ranger` sheet in all 8 directions.
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5195';
const out = process.argv[3] ?? 'docs/screenshots';
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${url}/?scene=mission&mission=mission1`);
await page.waitForFunction(() => window.game?.scene?.isActive('mission') && window.game.scene.getScene('mission').ranger, null, { timeout: 120000 });
console.log('mission reached');
await page.waitForTimeout(3000);
const missing = await page.evaluate(() => {
  const m = window.game.scene.getScene('mission');
  m.god = true;
  for (const e of m.enemies) e.state = 'dead';
  const s = m.manifest.sprites.ranger;
  const clips = ['rifle_idle', 'rifle_reload', 'grenade_throw', 'law_shoulder_fire', 'bomb_kneel_place', 'medkit_kneel_place', 'knife_Knife_Stab_Fore'];
  const dirs = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  const others = Object.keys(m.manifest.sprites).filter((n) => /^ranger_/.test(n));
  return { missing: clips.flatMap((c) => dirs.map((d) => `${s.animPrefix}${c}_${d}`)).filter((k) => !m.anims.exists(k)), others };
});
console.log('ranger sheet:', JSON.stringify(missing));
let ok = !missing.missing.length && !missing.others.length;
const shot = async (name, weapon, frameOf, facing = 'SE') => {
  await page.evaluate(
    async ({ weapon, frameOf, facing }) => {
      const m = window.game.scene.getScene('mission');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; m.busy && i < 400; i++) await wait(50);
      m.cameras.main.setZoom(2.5);
      // A clear patch for the picture: the nearest spot with no sprite within ~6 m (searched once).
      if (!m.__clear) {
        const objs = m.children.list.filter((o) => o !== m.ranger && o.texture && o.type !== 'TilemapLayer' && o.type !== 'Text');
        const r0 = { x: m.ranger.x, y: m.ranger.y };
        // Walkable ground (inside the map, not blocked) farthest from any sprite, within ~15 m of the drop.
        let best = null;
        let bestD = 0;
        for (let k = 0; k < 3000; k++) {
          const a = k * 0.7, d = 20 + k * 0.25;
          const c = { x: r0.x + Math.cos(a) * d, y: r0.y + Math.sin(a) * d * 0.5 };
          if (!m.canStand(c.x, c.y)) continue;
          const near = Math.min(...objs.map((o) => Math.hypot(o.x - c.x, o.y - c.y)));
          if (near > bestD) {
            bestD = near;
            best = c;
          }
        }
        m.__clear = best ?? r0;
      }
      m.ranger.setPosition(m.__clear.x, m.__clear.y);
      // Anything still drawn over the frame around him (a tree's canopy) is faded out for the picture.
      const box = { x0: m.ranger.x - 130, y0: m.ranger.y - 170, x1: m.ranger.x + 130, y1: m.ranger.y + 50 };
      for (const o of m.children.list) {
        if (o === m.ranger || !o.texture || o.type === 'TilemapLayer' || o.type === 'Text' || !o.getBounds) continue;
        if (['time_bomb', 'law_rocket', 'puff'].includes(o.texture.key)) continue;
        const b = o.getBounds();
        if (b.x < box.x1 && b.right > box.x0 && b.y < box.y1 && b.bottom > box.y0) o.setAlpha(0);
      }
      m.facing = facing;
      m.prone = false;
      m.hp = 40;
      m.lawsLeft = m.bombsLeft = m.medkitsLeft = m.grenadesLeft = 5;
      m.selectWeapon(weapon);
      m.use();
      const t0 = performance.now();
      while (performance.now() - t0 < 5000) {
        const f = m.ranger.anims.currentFrame;
        if (f && f.index - 1 >= frameOf) break;
        await wait(10);
      }
      m.anims.pauseAll();
    },
    { weapon, frameOf, facing },
  );
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 340, y: 160, width: 600, height: 400 } });
  const key = await page.evaluate(() => window.game.scene.getScene('mission').ranger.anims.currentAnim?.key);
  console.log(name, key);
  await page.evaluate(() => window.game.scene.getScene('mission').anims.resumeAll()).catch(() => undefined);
  await page.waitForTimeout(1500).catch(() => undefined);
};
await shot('g11-ranger-law', 'law', 2, 'E');
await shot('g11-ranger-bomb', 'bomb', 8, 'SE');
await shot('g11-ranger-aid', 'medkit', 5, 'SW');
await shot('g11-ranger-grenade', 'grenade', 4, 'SE');
if (errs.length) {
  ok = false;
  console.log('page errors:', errs.slice(0, 3).join(' | '));
}
await browser.close();
console.log(ok ? 'ranger shots ok' : 'FAILED');
process.exit(ok ? 0 : 1);
