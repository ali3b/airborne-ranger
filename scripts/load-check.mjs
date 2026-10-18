// Smoke check: the game boots to a scene with no page errors, and saves a screenshot.
//   node scripts/load-check.mjs [url] [scene]
// Any scene but the title is entered directly with ?scene=<name> (the title honours it). `mission` is mission 1,
// `mission2` (any mission<N> / map name) the mission scene with ?mission=<map>; both play to MISSION ACCOMPLISHED.
// Every mission checks that each target collides with its whole hull (FB-050); a map with vehicles (mission 4) also
// checks that one drives, that a grenade wrecks it and that looping props animate (G5).
// `arsenal` (or `arsenal:mission2`) checks G7: the supply pod loadout screen (CLEAR / limits / STANDARD / DONE) into
// the mission, the basic carry and a pod pickup, then the carbine's magazine and reload, first aid, the knife, a LAW
// on a target and a time bomb on another; then the same by touch on an emulated iPhone in landscape.
import { chromium, devices } from '@playwright/test';
const url = process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5195';
const scene = process.argv[3] ?? 'title';
const isMission = /^mission\d*$/.test(scene);
const isArsenal = scene.startsWith('arsenal');
const arsenalMap = scene.split(':')[1] ?? 'mission1';
const sceneKey = isMission ? 'mission' : isArsenal ? 'loadout' : scene;
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
await page.goto(
  scene === 'title'
    ? url
    : isMission
      ? `${base}/?scene=mission&mission=${encodeURIComponent(missionMap)}`
      : isArsenal
        ? `${base}/?scene=loadout&mission=${encodeURIComponent(arsenalMap)}`
        : `${base}/?scene=${encodeURIComponent(scene)}`,
);
let ok = true;
let shotTaken = false;
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
  if (isArsenal) ok = (await arsenalChecks(page)) && ok;
  if (scene === 'title') {
    // G4: the Ranger select shows the roster's six slots (a fresh browser: all vacant); enlist one in slot 1, choose
    // him, and the mission select lists every mission under his name.
    const slots = await page.evaluate(() => window.game.scene.getScene('title').rows?.map((t) => t.text) ?? []);
    console.log('roster:', JSON.stringify(slots));
    if (slots.length !== 6) {
      ok = false;
      console.log('NO RANGER SELECT (want 6 roster slots)');
    }
    await page.screenshot({ path: 'test-results/title-roster.png' }).catch(() => undefined);
    const enlisted = await page.evaluate(() => {
      const t = window.game.scene.getScene('title');
      t.go(0); // vacant: starts typing a name
      const typing = t.typing;
      const r = t.enlist('LOADCHECK');
      return { typing, ...r, row: t.rows[0].text };
    });
    console.log('enlisted:', JSON.stringify(enlisted));
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    const picked = await page
      .waitForFunction(() => window.game.scene.isActive('missions'), null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(800);
    const rows = await page.evaluate(() => {
      const m = window.game.scene.getScene('missions');
      return { ranger: m.ranger?.name ?? null, missions: m.rows?.map((t) => t.text) ?? [] };
    });
    console.log('missions:', JSON.stringify(rows));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ar.roster.v1') ?? '[]').filter(Boolean).length);
    if (!picked || rows.ranger !== 'LOADCHECK' || rows.missions.length < 3 || saved !== 1) {
      ok = false;
      console.log(`NO MISSION SELECT FOR THE RANGER (picked ${picked}, saved rangers ${saved}, want 3 missions)`);
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
    // FB-050: every target collides with its whole hull (the anchor, the footprint centre, is inside its collider).
    const hulls = await page.evaluate(() => {
      const m = window.game.scene.getScene('mission');
      const inside = (c, poly) => {
        let r = false;
        for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
          const a = poly[k];
          const b = poly[j];
          if (a.y > c.y !== b.y > c.y && c.x < ((b.x - a.x) * (c.y - a.y)) / (b.y - a.y) + a.x) r = !r;
        }
        return r;
      };
      return (m?.targets ?? []).filter((t) => !inside(m.worldOf(t.at), t.world)).map((t) => t.name);
    });
    if (hulls.length) {
      ok = false;
      console.log('TARGETS WITHOUT A HULL COLLIDER:', hulls.join(', '));
    }
    // G5: vehicles drive their path, looping prop animations play; a grenade wrecks the truck.
    if (s.vehicles) {
      const v0 = await page.evaluate(() => window.game.scene.getScene('mission').vehicles.map((v) => ({ x: v.placed.at.x, y: v.placed.at.y })));
      await page.waitForTimeout(4000);
      const g5 = await page.evaluate(async (v0) => {
        const m = window.game.scene.getScene('mission');
        const moved = m.vehicles.filter((v, k) => Math.hypot(v.placed.at.x - v0[k].x, v.placed.at.y - v0[k].y) > 4).length;
        const anim = m.vehicles[0].placed.sprite.anims.currentAnim?.key ?? null;
        // Park the Ranger 8 m west of the truck, facing east, and throw until it's wrecked.
        m.god = true;
        m.grenadesLeft = 99;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const v = m.vehicles[0];
        for (let tries = 0; tries < 4 && v.placed.state === 'intact'; tries++) {
          m.busy = false;
          m.prone = false;
          m.ranger.setPosition(v.placed.at.x - 8 * m.ppm, v.placed.at.y);
          m.facing = 'E';
          m.throwGrenade();
          const t0 = performance.now();
          await wait(200);
          while (performance.now() - t0 < 20000 && (m.grenades.length || m.busy)) await wait(100);
        }
        const t0 = performance.now();
        while (performance.now() - t0 < 15000 && v.placed.state !== 'destroyed') await wait(100);
        return { moved, of: m.vehicles.length, anim, wreck: v.placed.state, wreckAnim: v.placed.sprite.anims.currentAnim?.key ?? null, animatedProps: m.report.animatedProps };
      }, v0);
      console.log('g5:', JSON.stringify(g5));
      if (g5.moved < 1 || g5.wreck !== 'destroyed' || g5.animatedProps < 2) {
        ok = false;
        console.log('G5 CHECK FAILED (want a moving vehicle that a grenade wrecks, >= 2 animated props)');
      }
      await page.screenshot({ path: `test-results/${scene}-truck.png` }).catch(() => undefined);
    }
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
      await page.screenshot({ path: `test-results/${scene}.png` }).catch(() => undefined);
      // G4: Enter → the debriefing (a guest: merit lines, total, medal/promotion as earned).
      const deb = await page.evaluate(async () => {
        const m = window.game.scene.getScene('mission');
        if (!m.toDebrief()) return { error: 'toDebrief refused' };
        const t0 = performance.now();
        while (performance.now() - t0 < 15000 && !window.game.scene.getScene('debrief')?.shown) await new Promise((r) => setTimeout(r, 100));
        const d = window.game.scene.getScene('debrief');
        return { shown: !!d?.shown, points: d?.award?.points, lines: d?.award?.lines?.length, medal: d?.award?.medal, promotedTo: d?.award?.promotedTo };
      });
      console.log('debrief:', JSON.stringify(deb));
      if (!deb.shown || !(deb.points > 0)) {
        ok = false;
        console.log('NO DEBRIEFING (or no merit for an accomplished mission)');
      }
      await page.screenshot({ path: `test-results/${scene}-debrief.png` }).catch(() => undefined);
      shotTaken = true;
    }
  }
} catch (e) {
  ok = false;
  console.log('NOT LOADED:', e.message.split('\n')[0]);
}
if (isArsenal) {
  shotTaken = true;
  ok = (await touchArsenal()) && ok;
}
if (!shotTaken) await page.screenshot({ path: `test-results/${scene}.png` }).catch(() => undefined);
const uniq = [...new Set(errors)].filter((e) => !/favicon/.test(e));
if (uniq.length) console.log('page errors:', uniq.slice(0, 5).join(' | '));
console.log(ok && !uniq.length ? 'game loads ok' : 'FAILED');
await browser.close();
process.exit(ok && !uniq.length ? 0 : 1);

// ---- G7: the arsenal (supply pod loadout, ammo, first aid, knife, LAW, time bomb), keyboard then touch ----

/** Poll a page function until it returns truthy (headless GL runs slow game time). */
async function until(pg, fn, arg, ms = 30000) {
  return pg
    .waitForFunction(fn, arg, { timeout: ms, polling: 100 })
    .then(() => true)
    .catch(() => false);
}

async function arsenalChecks(page) {
  let ok = true;
  const fail = (msg) => {
    ok = false;
    console.log('ARSENAL CHECK FAILED:', msg);
  };
  // Loadout: CLEAR empties the pod, + stops at the weight limit, STANDARD is 21 items, Enter drops in with it.
  const pod = () => page.evaluate(() => ({ ...window.game.scene.getScene('loadout').pod }));
  await page.keyboard.press('c');
  const cleared = await pod();
  await page.keyboard.press('4'); // LAW row
  for (let k = 0; k < 12; k++) await page.keyboard.press('ArrowRight');
  const laws = await pod();
  await page.keyboard.press('s');
  const std = await pod();
  console.log('loadout:', JSON.stringify({ cleared, laws, std }));
  if (Object.values(cleared).some((v) => v !== 0)) fail('CLEAR left items in the pod');
  if (laws.law !== 9) fail(`LAW rockets should stop at the weight limit (9 × 5 = 45), got ${laws.law}`);
  if (Object.values(std).reduce((a, b) => a + b, 0) !== 21) fail('STANDARD is not 21 items');
  await page.screenshot({ path: 'test-results/arsenal-loadout.png' }).catch(() => undefined);
  await page.keyboard.press('Enter');
  if (!(await until(page, () => window.game.scene.isActive('mission') && window.game.scene.getScene('mission').ranger, null, 90000))) {
    fail('DONE did not start the mission');
    return ok;
  }
  await page.waitForTimeout(1000);
  const carry = await page.evaluate(() => {
    const m = window.game.scene.getScene('mission');
    m.god = true;
    return { loadout: m.loadout, mags: m.magsLeft, grenades: m.grenadesLeft, laws: m.lawsLeft, bombs: m.bombsLeft, medkits: m.medkitsLeft, rounds: m.rounds, pods: m.pods.length, podSprite: m.pods[0]?.sprite.texture.key };
  });
  console.log('carry:', JSON.stringify(carry));
  if (carry.loadout.law !== std.law || carry.pods < 1 || carry.podSprite !== 'supply_pod') fail('the pods do not carry the loadout (or no supply_pod sprite)');
  // Walk onto the first pod: its contents are added.
  const got = await page.evaluate(async () => {
    const m = window.game.scene.getScene('mission');
    const before = m.magsLeft;
    m.ranger.setPosition(m.pods[0].at.x, m.pods[0].at.y);
    const t0 = performance.now();
    while (performance.now() - t0 < 10000 && !m.pods[0].taken) await new Promise((r) => setTimeout(r, 100));
    return { taken: m.pods[0].taken, mags: m.magsLeft - before };
  });
  console.log('pod pickup:', JSON.stringify(got));
  if (!got.taken || got.mags !== std.mag) fail('picking a pod up did not add its magazines');

  // Carbine: the last round, then firing on empty reloads (one magazine used, 30 rounds).
  const reload = await page.evaluate(async () => {
    const m = window.game.scene.getScene('mission');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    m.rounds = 1;
    m.busy = false;
    m.prone = false;
    m.selectWeapon('carbine');
    const mags = m.magsLeft;
    m.use();
    let t0 = performance.now();
    while (performance.now() - t0 < 10000 && m.busy) await wait(50);
    const empty = m.rounds;
    await wait(300);
    m.use();
    t0 = performance.now();
    while (performance.now() - t0 < 20000 && m.rounds !== 30) await wait(100);
    return { empty, rounds: m.rounds, magsUsed: mags - m.magsLeft, reloads: m.arsenal.reloads };
  });
  console.log('reload:', JSON.stringify(reload));
  if (reload.empty !== 0 || reload.rounds !== 30 || reload.magsUsed !== 1) fail('magazine / reload');

  // First aid.
  const aid = await page.evaluate(async () => {
    const m = window.game.scene.getScene('mission');
    while (m.busy) await new Promise((r) => setTimeout(r, 50));
    m.hp = 30;
    const kits = m.medkitsLeft;
    m.selectWeapon('medkit');
    m.use();
    return { hp: m.hp, used: kits - m.medkitsLeft };
  });
  console.log('first aid:', JSON.stringify(aid));
  if (aid.hp !== 80 || aid.used !== 1) fail('first aid');

  // Knife: stand next to a soldier and stab: he dies by the knife (no noise).
  const knifeRes = await page.evaluate(async () => {
    const m = window.game.scene.getScene('mission');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const e = m.enemies.find((x) => x.state !== 'dead');
    // Place the Ranger 0.9 m from the soldier along screen x (a world offset found by probing worldOf).
    const at = { x: e.sprite.x - 40, y: e.sprite.y };
    m.ranger.setPosition(at.x, at.y);
    const alertBefore = m.enemies.filter((x) => x.state === 'alert').length;
    m.selectWeapon('knife');
    m.use();
    const t0 = performance.now();
    while (performance.now() - t0 < 15000 && e.state !== 'dead') await wait(50);
    return { dead: e.state === 'dead', by: e.killedBy ?? null, knifeKills: m.arsenal.knifeKills, alertBefore, alertAfter: m.enemies.filter((x) => x.state === 'alert').length };
  });
  console.log('knife:', JSON.stringify(knifeRes));
  if (!knifeRes.dead || knifeRes.by !== 'knife') fail('knife kill');

  // LAW: 10 m west of a target facing east; the rocket destroys it.
  const law = await page.evaluate(async () => {
    const m = window.game.scene.getScene('mission');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    while (m.busy) await wait(50);
    const t = m.targets.find((x) => x.hp > 0) ?? m.props.find((x) => x.hp > 0);
    if (!t) return { error: 'nothing to hit' };
    m.ranger.setPosition(t.at.x - 10 * m.ppm, t.at.y);
    m.facing = 'E';
    m.prone = false;
    m.lawsLeft = Math.max(1, m.lawsLeft);
    const laws = m.lawsLeft;
    m.selectWeapon('law');
    m.use();
    const t0 = performance.now();
    while (performance.now() - t0 < 30000 && !m.rockets.length) await wait(30);
    const flying = m.rockets.length;
    const sprite = m.rockets[0]?.sprite.texture?.key ?? null;
    while (performance.now() - t0 < 60000 && m.rockets.length) await wait(30);
    return { name: t.name, flying, sprite, hp: t.hp, by: t.destroyedBy ?? null, used: laws - m.lawsLeft, cam: [t.at.x, t.at.y] };
  });
  await page.screenshot({ path: 'test-results/arsenal-law.png' }).catch(() => undefined);
  console.log('LAW:', JSON.stringify(law));
  if (law.error || !law.flying || law.sprite !== 'law_rocket' || law.used !== 1 || law.hp > 0 || law.by !== 'law') fail('LAW rocket (fired, flew and destroyed the target)');

  // Time bomb: set at a target's edge, the fuse shows 10, the Ranger walks off, the blast destroys it.
  const bomb = await page.evaluate(async () => {
    const m = window.game.scene.getScene('mission');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    while (m.busy) await wait(50);
    const t = m.targets.find((x) => x.hp > 0) ?? m.props.find((x) => x.hp > 0 && x.name !== 'supply_pod');
    if (!t) return { error: 'nothing left to bomb' };
    m.ranger.setPosition(t.at.x - 2 * m.ppm, t.at.y);
    m.facing = 'E';
    m.prone = false;
    m.bombsLeft = Math.max(1, m.bombsLeft);
    m.selectWeapon('bomb');
    m.use();
    let t0 = performance.now();
    while (performance.now() - t0 < 20000 && !m.bombs.length) await wait(50);
    const label = m.bombs[0]?.label.text ?? null;
    const sprite = m.bombs[0]?.sprite.texture?.key ?? null;
    m.ranger.setPosition(t.at.x - 14 * m.ppm, t.at.y);
    // Headless game time crawls: shorten the rest of the fuse.
    if (m.bombs[0]) m.bombs[0].fuse = Math.min(m.bombs[0].fuse, 2);
    t0 = performance.now();
    while (performance.now() - t0 < 60000 && m.bombs.length) await wait(50);
    await wait(500);
    return { name: t.name, label, sprite, hp: t.hp, by: t.destroyedBy ?? null, placed: m.arsenal.bombsPlaced };
  });
  console.log('time bomb:', JSON.stringify(bomb));
  if (bomb.error || bomb.label !== '10' || bomb.sprite !== 'time_bomb' || bomb.hp > 0 || bomb.by !== 'bomb') fail('time bomb (placed, fuse shown, blast destroyed the target)');
  const hud = await page.evaluate(() => window.game.scene.getScene('mission').hud.text);
  console.log('hud:', JSON.stringify(hud));
  if (!/LAW/.test(hud) || !/\/30/.test(hud)) fail('the HUD lacks ammo / item counts');
  await page.screenshot({ path: 'test-results/arsenal.png' }).catch(() => undefined);
  return ok;
}

/** The same by touch: an emulated iPhone in landscape packs a pod by tapping, drops in, and uses the item bar. */
async function touchArsenal() {
  let ok = true;
  const fail = (msg) => {
    ok = false;
    console.log('TOUCH ARSENAL FAILED:', msg);
  };
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const tp = await ctx.newPage();
  const errs = [];
  tp.on('pageerror', (e) => errs.push(e.message));
  try {
    await tp.goto(`${base}/?scene=loadout&mission=${encodeURIComponent(arsenalMap)}`);
    await until(tp, () => window.game?.scene?.isActive('loadout'), null, 90000);
    await tp.waitForTimeout(1200);
    // Screen position of a named loadout text (the menu camera is zoomed to fit the phone).
    const at = (name) =>
      tp.evaluate((n) => {
        const s = window.game.scene.getScene('loadout');
        const o = s.children.getByName(n);
        const cam = s.cameras.main;
        const r = window.game.canvas.getBoundingClientRect();
        const sx = r.width / window.game.scale.width;
        return o ? { x: r.left + (o.x - cam.worldView.x) * cam.zoom * sx, y: r.top + (o.y - cam.worldView.y) * cam.zoom * sx } : null;
      }, name);
    const tap = async (name) => {
      const p = await at(name);
      if (!p) return fail(`no ${name} on the loadout screen`);
      await tp.touchscreen.tap(p.x, p.y);
      await tp.waitForTimeout(150);
    };
    await tap('btn-clear');
    await tap('plus-bomb');
    await tap('plus-bomb');
    await tap('plus-law');
    await tap('plus-medkit');
    await tap('minus-bomb');
    const pod = await tp.evaluate(() => ({ ...window.game.scene.getScene('loadout').pod }));
    console.log('touch loadout:', JSON.stringify(pod));
    if (pod.bomb !== 1 || pod.law !== 1 || pod.medkit !== 1 || pod.mag !== 0) fail('tapping − / + did not pack the pod');
    await tp.screenshot({ path: 'test-results/arsenal-touch-loadout.png' }).catch(() => undefined);
    await tap('btn-done');
    if (!(await until(tp, () => window.game.scene.isActive('mission') && window.game.scene.getScene('mission').ranger, null, 90000))) {
      fail('DONE (tap) did not start the mission');
      return ok;
    }
    await tp.waitForTimeout(1500);
    const bar = await tp.evaluate(() => [...document.querySelectorAll('#touch .items button')].map((b) => b.dataset.k));
    console.log('item bar:', JSON.stringify(bar));
    if (bar.length !== 6) fail('no item bar (want 6 buttons)');
    const tapEl = async (sel) => {
      const b = await tp.locator(sel).boundingBox();
      if (!b) return fail(`no ${sel}`);
      await tp.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await tp.waitForTimeout(200);
    };
    await tp.evaluate(() => {
      const m = window.game.scene.getScene('mission');
      m.god = true;
      m.hp = 40;
    });
    await tapEl('#touch .items button[data-k="medkit"]');
    await tapEl('#touch .items button[data-k="law"]');
    const sel = await tp.evaluate(() => {
      const m = window.game.scene.getScene('mission');
      return { hp: m.hp, weapon: m.weapon, fire: document.querySelector('#touch button.fire')?.textContent };
    });
    console.log('touch items:', JSON.stringify(sel));
    if (sel.hp !== 90 || sel.weapon !== 'law' || sel.fire !== 'LAW') fail('item bar: AID heals, LAW selects (and names FIRE)');
    await tp.waitForTimeout(800);
    await tapEl('#touch button.fire');
    const fired = await until(tp, () => window.game.scene.getScene('mission').arsenal.lawsFired > 0, null, 30000);
    console.log('touch LAW fired:', fired);
    if (!fired) fail('FIRE with LAW selected did not fire a rocket');
    await tp.waitForTimeout(600);
    await tp.screenshot({ path: 'test-results/arsenal-touch.png' }).catch(() => undefined);
  } catch (e) {
    fail(e.message.split('\n')[0]);
  }
  if (errs.length) fail(`page errors: ${errs.slice(0, 3).join(' | ')}`);
  await ctx.close();
  return ok;
}
