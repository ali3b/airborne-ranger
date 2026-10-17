// Smoke check: the game boots to a scene with no page errors, and saves a screenshot.
//   node scripts/load-check.mjs [url] [scene]
// Any scene but the title is entered directly with ?scene=<name> (the title honours it). `mission` is mission 1,
// `mission2` (any mission<N> / map name) the mission scene with ?mission=<map>; both play to MISSION ACCOMPLISHED.
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5195';
const scene = process.argv[3] ?? 'title';
const isMission = /^mission\d*$/.test(scene);
const sceneKey = isMission ? 'mission' : scene;
const missionMap = scene === 'mission' ? 'mission1' : scene;
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const base = url.replace(/\/$/, '');
await page.goto(scene === 'title' ? url : isMission ? `${base}/?scene=mission&mission=${encodeURIComponent(missionMap)}` : `${base}/?scene=${encodeURIComponent(scene)}`);
let ok = true;
try {
  await page.waitForFunction((s) => window.game?.scene?.isActive(s), sceneKey, { timeout: 90000 });
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
    await page.waitForTimeout(2500); // let the grenade land and explode
    // G1: enemies patrol (they moved since the start), and a grenade destroys the tank: put the Ranger 8 m (the
    // grenade's range) west of the tank's anchor facing east, unhurtable so a patrol can't end the check, and throw.
    const setup = await page.evaluate(() => {
      const f = window.game.scene.getScene('field');
      const tank = f.props.find((p) => p.name === 'tank');
      if (!tank) return { error: 'no tank on the field (assets?)' };
      f.god = true;
      f.busy = false;
      f.prone = false;
      f.ranger.setPosition(tank.at.x - 8 * f.ppm, tank.at.y);
      f.facing = 'E';
      const moved = f.enemies.filter((e) => Math.hypot(e.sprite.x - e.path[0].x, e.sprite.y - e.path[0].y) > 2).length;
      return { enemies: f.enemies.length, moved, tank: tank.state, hp: tank.hp };
    });
    console.log('before:', JSON.stringify(setup));
    if (setup.error || setup.enemies < 2 || setup.moved < 1) {
      ok = false;
      console.log('ENEMIES:', setup.error ?? 'fewer than 2 enemies, or none patrolled');
    }
    if (!setup.error) {
      await page.waitForTimeout(300);
      await page.keyboard.press('g');
      const destroyed = await page
        .waitForFunction(() => window.game.scene.getScene('field').props.find((p) => p.name === 'tank')?.state === 'destroyed', null, { timeout: 60000 })
        .then(() => true)
        .catch(() => false);
      const after = await page.evaluate(() => {
        const f = window.game.scene.getScene('field');
        const t = f.props.find((p) => p.name === 'tank');
        return { tank: t.state, hp: t.hp, anim: t.sprite.anims.currentAnim?.key, collider: t.world.length, grenades: f.grenadesThrown, alert: f.enemies.filter((e) => e.state === 'alert').length };
      });
      console.log('after:', JSON.stringify(after));
      if (!destroyed) {
        ok = false;
        console.log('TANK NOT DESTROYED (grenade, HP or the intact_to_destroyed transition?)');
      }
      await page.waitForTimeout(2500); // smoke and fire on the wreck for the screenshot
    }
  }
  if (scene === 'title') {
    // The mission select lists every mission.
    const rows = await page.evaluate(() => window.game.scene.getScene('title').rows?.map((t) => t.text) ?? []);
    console.log('missions:', JSON.stringify(rows));
    if (rows.length < 2) {
      ok = false;
      console.log('NO MISSION SELECT (want at least 2 missions)');
    }
  }
  if (isMission) {
    // G3: the mission comes only from the generator map: tiles drawn, objects spawned from the object layer, the
    // Ranger in the drop zone, enemies from the guard spawns and patrol zones.
    const MIN_OBJECTS = 40;
    const s = await page.evaluate(() => {
      const m = window.game.scene.getScene('mission');
      if (!m?.ranger) return { error: 'no ranger (assets or map missing? run npm run assets)' };
      const c = m.rangerCell();
      const xs = m.dropArea.map((p) => p[0]);
      const ys = m.dropArea.map((p) => p[1]);
      const inDrop = c.x >= Math.min(...xs) && c.x <= Math.max(...xs) && c.y >= Math.min(...ys) && c.y <= Math.max(...ys);
      const layers = m.children.list.filter((o) => o.type === 'TilemapLayer').length;
      return { ...m.report, map: m.mapName, ranger: { x: +c.x.toFixed(2), y: +c.y.toFixed(2) }, inDrop, layers, anim: m.ranger.anims?.currentAnim?.key ?? null };
    });
    console.log('mission:', JSON.stringify(s));
    if (s.map !== missionMap) {
      ok = false;
      console.log(`WRONG MAP ${s.map} (want ${missionMap})`);
    }
    if (s.error || !s.inDrop || !s.tiles || !s.layers || s.objects < MIN_OBJECTS || s.missingSprites.length || s.enemies < 3 || !s.targets) {
      ok = false;
      console.log(`MISSION CHECK FAILED (want: Ranger in the drop zone, tiles drawn, >= ${MIN_OBJECTS} objects, no missing sprites, >= 3 enemies, targets)`);
    }
    await page.screenshot({ path: `test-results/${scene}-drop.png` }).catch(() => undefined);
    if (!s.error) {
      // Blow up the depot: stand 8 m (the grenade's range) west of each target's anchor facing east, unhurtable, and
      // throw until it's destroyed; then put the Ranger in the extraction zone and expect the end screen.
      const destroyed = await page.evaluate(async () => {
        const m = window.game.scene.getScene('mission');
        m.god = true;
        m.grenadesLeft = 99;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        for (const t of m.targets) {
          for (let tries = 0; tries < 4 && t.hp > 0; tries++) {
            m.busy = false;
            m.prone = false;
            m.ranger.setPosition(t.at.x - 8 * m.ppm, t.at.y);
            m.facing = 'E';
            m.throwGrenade();
            const t0 = performance.now();
            await wait(200);
            while (performance.now() - t0 < 20000 && (m.grenades.length || m.busy)) await wait(100);
          }
        }
        return m.targets.filter((t) => t.hp <= 0).length + '/' + m.targets.length;
      });
      console.log('targets destroyed:', destroyed);
      await page.waitForTimeout(1500);
      const end = await page.evaluate(async () => {
        const m = window.game.scene.getScene('mission');
        const xs = m.extractArea.map((p) => p[0]);
        const ys = m.extractArea.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        // The zone centre in map cells → screen (iso projection, origin at the map's top corner).
        m.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
        const t0 = performance.now();
        while (performance.now() - t0 < 10000 && !m.outcome) await new Promise((r) => setTimeout(r, 100));
        return { outcome: m.outcome, objectiveDone: m.objectiveDone };
      });
      console.log('end:', JSON.stringify(end));
      if (end.outcome !== 'accomplished') {
        ok = false;
        console.log('NO MISSION ACCOMPLISHED (depot targets left, or the extraction zone not detected)');
      }
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/${scene}-end.png` }).catch(() => undefined);
      // test-results/<scene>.png: the burning objective (the end screen hidden).
      await page.evaluate(() => {
        const m = window.game.scene.getScene('mission');
        m.children.list.filter((o) => o.depth >= 1e9 && o !== m.hud).forEach((o) => o.setVisible(false));
        const t = m.targets[0];
        m.cameras.main.stopFollow();
        m.ranger.setPosition(t.at.x - 5 * m.ppm, t.at.y + 2 * m.ppm);
        m.cameras.main.centerOn(t.at.x - 60, t.at.y - 40);
      });
      await page.waitForTimeout(800);
    }
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
