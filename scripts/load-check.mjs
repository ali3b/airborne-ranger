// Smoke check: the game boots to a scene with no page errors, and saves a screenshot.
//   node scripts/load-check.mjs [url] [scene]
// Any scene but the title is entered directly with ?scene=<name> (the title honours it). `mission` is mission 1,
// `mission2` (any mission<N> / map name) the mission scene with ?mission=<map>; both play to MISSION ACCOMPLISHED.
// Every mission checks that each target collides with its whole hull (FB-050); a map with vehicles (mission 4) also
// checks that one drives, that a grenade wrecks it and that looping props animate (G5).
// G8: missions 5–8 (`mission5`…`mission8`) also reach their objective kind (src/objectives): the code book taken, the
// officer surrendering and following, the SAM site's targets, the P.O.W. gate opened and the prisoners following; the
// officer and P.O.W. missions then check that killing them fails the mission with a reason (the Ranger not captured).
// `arsenal` (or `arsenal:mission2`) checks G7: the supply pod loadout screen (CLEAR / limits / STANDARD / DONE) into
// the mission, the basic carry and a pod pickup, then the carbine's magazine and reload, first aid, the knife, a LAW
// on a target and a time bomb on another; then the same by touch on an emulated iPhone in landscape.
import { chromium, devices } from '@playwright/test';
import { objectiveChecks } from './g8b-checks.mjs';
const url = process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5195';
const scene = process.argv[3] ?? 'title';
const isMission = /^mission\d*$/.test(scene);
const isArsenal = scene.startsWith('arsenal');
// G9: `g9` checks the enemy systems on the test field (a machine-gun nest, mines, a trench, a tank, sight lines,
// alerts spreading and the alarm's reinforcements).
const isG9 = scene === 'g9';
const arsenalMap = scene.split(':')[1] ?? 'mission1';
const sceneKey = isMission ? 'mission' : isArsenal ? 'loadout' : isG9 ? 'field' : scene;
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
        : `${base}/?scene=${encodeURIComponent(isG9 ? 'field' : scene)}`,
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
  if (isG9) {
    ok = (await g9Checks(page)) && ok;
    shotTaken = true;
  }
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
    // G9: difficulty (D cycles it, saved) and the campaign (C starts it at mission 1; an accomplished campaign mission
    // moves it on, persisted with the roster).
    const diff = [];
    for (let k = 0; k < 3; k++) {
      diff.push(await page.evaluate(() => window.game.scene.getScene('missions').difficultyBtn?.text ?? null));
      await page.keyboard.press('d');
      await page.waitForTimeout(150);
    }
    const savedDiff = await page.evaluate(() => localStorage.getItem('ar.difficulty.v1'));
    console.log('difficulty:', JSON.stringify(diff), savedDiff);
    if (!diff.every(Boolean) || new Set(diff).size !== 3 || savedDiff !== 'normal') {
      ok = false;
      console.log('NO DIFFICULTY CHOICE (want three levels cycling on D, saved)');
    }
    await page.screenshot({ path: 'test-results/g9-missions.png' }).catch(() => undefined);
    await page.keyboard.press('c');
    const camp = await until(page, () => window.game.scene.isActive('loadout'), null, 15000);
    const c0 = await page.evaluate(() => ({ map: window.game.scene.getScene('loadout').cfg?.map, campaign: JSON.parse(localStorage.getItem('ar.roster.v1'))[0]?.campaign }));
    // The campaign's bookkeeping through the real award() (the module the game runs, from the dev server).
    const c1 = await page.evaluate(async () => {
      const roster = await import('/src/roster.ts');
      const r = roster.loadRoster()[0];
      const res = { mission: 1, title: 'X', outcome: 'accomplished', objectiveDone: true, kills: 2, enemies: 20, installations: 3, targets: 3, secondsLeft: 300, seconds: 600, alertAt: null, objectiveAt: 100 };
      const a = roster.award(r.id, res);
      window.game.scene.getScene('loadout').scene.start('missions');
      await new Promise((ok) => setTimeout(ok, 800));
      return { note: a.campaignNote, campaign: roster.loadRoster()[0].campaign, label: window.game.scene.getScene('missions').campaignBtn?.text, score: roster.loadRoster()[0].score };
    });
    console.log('campaign:', JSON.stringify({ started: camp, ...c0 }), JSON.stringify(c1));
    if (!camp || c0.map !== 'mission1' || !c0.campaign?.playing || c1.campaign?.next !== 1 || !(c1.campaign?.merit > 0) || !/mission 2/.test(c1.label ?? '') || !c1.note) {
      ok = false;
      console.log('CAMPAIGN CHECK FAILED (C starts mission 1; an accomplished mission moves the campaign to mission 2, saved)');
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
      return { ...m.report, objective: m.cfg.objective ?? null, map: m.mapName, ranger: { x: +c.x.toFixed(2), y: +c.y.toFixed(2) }, inDrop, layers, anim: m.ranger.anims?.currentAnim?.key ?? null };
    });
    console.log('mission:', JSON.stringify(s));
    if (s.map !== missionMap) {
      ok = false;
      console.log(`WRONG MAP ${s.map} (want ${missionMap})`);
    }
    if (s.error || !s.inDrop || !s.tiles || !s.layers || s.objects < MIN_OBJECTS || s.missingSprites.length || s.enemies < 3 || (!s.targets && !s.objective)) {
      ok = false;
      console.log(`MISSION CHECK FAILED (want: Ranger in the drop zone, tiles drawn, >= ${MIN_OBJECTS} objects, no missing sprites, >= 3 enemies, targets or an objective)`);
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
    // G6: the overview map opens and closes (Tab), the compass shows a distance, enemies far from the Ranger sleep.
    const g6 = await page.evaluate(async () => {
      const m = window.game.scene.getScene('mission');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const awake = m.enemies.filter((e) => e.sprite.active).length;
      const visibleProps = m.props.filter((p) => p.sprite.visible).length;
      m.toggleMap();
      await wait(300);
      const open = !!m.overview?.isOpen;
      const t0 = m.timeLeft;
      await wait(1200);
      const clockRan = m.timeLeft < t0;
      m.toggleMap();
      await wait(200);
      return { size: `${m.mapW}x${m.mapH}`, seconds: m.cfg.seconds, open, clockRan, closed: !m.overview?.isOpen, compass: m.compassText?.text ?? null, awake, enemies: m.enemies.length, visibleProps, props: m.props.length };
    });
    console.log('g6:', JSON.stringify(g6));
    if (!g6.open || !g6.closed || !/\d+ m$/.test(g6.compass ?? '') || g6.awake >= g6.enemies || g6.visibleProps >= g6.props) {
      ok = false;
      console.log('G6 CHECK FAILED (want: the overview opens and closes, a compass distance, far enemies asleep, off-screen props hidden)');
    }
    // G9: the map's machine-gun nests (manned), minefields, trenches and tanks; the difficulty.
    const g9 = await page.evaluate(() => {
      const g = window.game.scene.getScene('mission').g9;
      if (!g) return { error: 'no g9' };
      return { difficulty: g.difficulty, nests: g.nests.list.length, mines: g.mines.list.length, minefields: g.mines.stats.fields, trenches: g.trenches.list.length, tanks: g.tanks.list.length, canopy: g.sight.canopyCells, adjust: g.adjust };
    });
    console.log('g9:', JSON.stringify(g9));
    // Missions 1–4 carry the G9 hazards so far (maps/g6/<mission>/stage3.json); 5–12 don't have them yet.
    const want = { mission1: { tanks: 1, trenches: 2 }, mission2: { tanks: 1 }, mission3: { tanks: 1 }, mission4: {} }[missionMap];
    if (g9.error || (want && (g9.nests < 2 || g9.mines < 6 || g9.minefields < 2 || g9.tanks < (want.tanks ?? 0) || g9.trenches < (want.trenches ?? 0)))) {
      ok = false;
      console.log('G9 MAP CHECK FAILED (want >= 2 manned nests, 2 minefields with >= 6 mines, the tanks and trenches the map has)');
    }
    if (s.vehicles) {
      // Vehicles far from the Ranger don't drive (G6): stand him 10 m north of the first one.
      await page.evaluate(() => {
        const m = window.game.scene.getScene('mission');
        const v = m.vehicles[0].placed;
        m.god = true;
        m.ranger.setPosition(v.at.x, v.at.y - 10 * m.ppm * 0.5);
      });
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
    // G8 (g8b): objective missions play their own objective (scripts/g8b-checks.mjs), then the debriefing.
    if (!s.error && ['photo', 'hostages', 'diversion', 'sabotage'].includes(s.objective)) {
      ok = (await objectiveChecks(page, scene, s.objective)) && ok;
      await page.screenshot({ path: `test-results/${scene}.png` }).catch(() => undefined);
      const deb = await page.evaluate(async () => {
        const m = window.game.scene.getScene('mission');
        if (!m.toDebrief()) return { error: 'toDebrief refused' };
        const t0 = performance.now();
        while (performance.now() - t0 < 15000 && !window.game.scene.getScene('debrief')?.shown) await new Promise((r) => setTimeout(r, 100));
        const d = window.game.scene.getScene('debrief');
        return { shown: !!d?.shown, points: d?.award?.points };
      });
      console.log('debrief:', JSON.stringify(deb));
      if (!deb.shown || !(deb.points > 0)) {
        ok = false;
        console.log('NO DEBRIEFING (or no merit for an accomplished mission)');
      }
      shotTaken = true;
    }
    if (!s.error && !s.objective) {
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
      // G8: the objective kinds (src/objectives): take the code book, make the officer surrender and follow, open the
      // P.O.W. camp and gather the prisoners (the SAM site is its targets).
      if (s.objective) {
        const g8 = await page.evaluate(objectiveStep);
        console.log('g8 objective:', JSON.stringify(g8));
        if (!g8?.ok) {
          ok = false;
          console.log(`G8 OBJECTIVE CHECK FAILED (${s.objective})`);
        }
        await page.screenshot({ path: `test-results/${scene}-objective.png` }).catch(() => undefined);
      }
      const end = await page.evaluate(async () => {
        const m = window.game.scene.getScene('mission');
        const xs = m.extractArea.map((p) => p[0]);
        const ys = m.extractArea.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        // The zone centre in map cells → screen (iso projection, origin at the map's top corner).
        m.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
        // G8: the officer / prisoners following him come along.
        m.bystanders.filter((b) => b.alive && b.following).forEach((b, k) => {
          b.sprite.setPosition(m.ranger.x + 30 + (k % 3) * 20, m.ranger.y + 10 + Math.floor(k / 3) * 14);
          b.queue = [];
        });
        // G9: no extraction without the plane: the call is offered in the zone (C), the plane flies in and lifts him.
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const t1 = performance.now();
        while (performance.now() - t1 < 10000 && !m.g9?.pickup.canCall) await wait(100);
        const offered = { canCall: !!m.g9?.pickup.canCall, hud: m.hud.text.split('\n')[0] };
        return { offered };
      });
      console.log('pickup offered:', JSON.stringify(end.offered));
      await page.keyboard.press('c');
      await page.waitForTimeout(300);
      Object.assign(
        end,
        await page.evaluate(async () => {
          const m = window.game.scene.getScene('mission');
          const p = m.g9.pickup;
          const called = p.state;
          // Shorten the wait (the plane's approach itself still plays).
          p.eta = Math.min(p.eta, 5);
          let plane = false;
          const t0 = performance.now();
          while (performance.now() - t0 < 60000 && !m.outcome) {
            plane ||= m.children.list.some((o) => o.texture?.key === 'plane_pickup' && o.visible);
            await new Promise((r) => setTimeout(r, 100));
          }
          return { called, plane, passes: p.stats.passes, outcome: m.outcome, objectiveDone: m.objectiveDone, stats: m.result?.stats ?? null };
        }),
      );
      console.log('end:', JSON.stringify(end));
      if (end.outcome !== 'accomplished' || !end.offered?.canCall || end.called !== 'called' || !end.plane) {
        ok = false;
        console.log('NO MISSION ACCOMPLISHED (depot targets left, the extraction zone not detected, or no plane call / pickup)');
      }
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/${scene}-end.png` }).catch(() => undefined);
      // test-results/<scene>.png: the burning objective (the end screen hidden).
      await page.evaluate(() => {
        const m = window.game.scene.getScene('mission');
        m.children.list.filter((o) => o.depth >= 1e9 && o !== m.hud).forEach((o) => o.setVisible(false));
        const o = m.objectiveArea;
        const oc = [o.reduce((a, p) => a + p[0], 0) / o.length, o.reduce((a, p) => a + p[1], 0) / o.length];
        const t = m.targets[0] ?? { at: { x: (oc[0] - oc[1]) * 32, y: (oc[0] + oc[1]) * 16 } };
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
      // G8: the officer / every prisoner killed fails the mission with its reason (the Ranger is recalled).
      if (s.objective === 'officer' || s.objective === 'pow') {
        await page.goto(`${base}/?scene=mission&mission=${encodeURIComponent(missionMap)}`);
        await page.waitForFunction(() => window.game?.scene?.getScene('mission')?.ranger && window.game.scene.getScene('mission').objective, null, { timeout: 90000 });
        const fail = await page.evaluate(async () => {
          const m = window.game.scene.getScene('mission');
          m.god = true;
          for (const b of m.bystanders) if (b.alive) m.explode({ x: b.sprite.x, y: b.sprite.y }, { radius: 1 });
          const t0 = performance.now();
          while (performance.now() - t0 < 15000 && !m.outcome) await new Promise((r) => setTimeout(r, 100));
          return { outcome: m.outcome, reason: m.result?.reason ?? null, status: m.award?.status ?? null };
        });
        console.log('g8 fail:', JSON.stringify(fail));
        if (fail.outcome !== 'failed' || !fail.reason || fail.status === 'captured') {
          ok = false;
          console.log('G8 FAILURE CHECK FAILED (want: failed, a reason, the Ranger not captured)');
        }
        await page.screenshot({ path: `test-results/${scene}-failed.png` }).catch(() => undefined);
      }
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

// ---- G8 (lane g8a): reach each objective kind (runs in the page) ----
async function objectiveStep() {
  const m = window.game.scene.getScene('mission');
  const o = m.objective;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms && !f()) await wait(100);
    return !!f();
  };
  const cellToScreen = ([i, j]) => ({ x: (i - j) * 32, y: (i + j) * 16 });
  m.god = true;
  const kind = m.cfg.objective;
  if (kind === 'codebook') {
    const p = cellToScreen(o.cell);
    m.ranger.setPosition(p.x - 20, p.y + 6);
    const done = await until(() => m.objectiveDone, 15000);
    return { ok: done, kind, hud: m.hud.text.split('\n')[0], stats: o.stats() };
  }
  if (kind === 'officer') {
    const off = o.officer;
    const hud0 = o.hud(m);
    m.ranger.setPosition(off.sprite.x - 1.5 * m.ppm, off.sprite.y + 0.5 * m.ppm);
    const following = await until(() => off.following, 20000);
    // He follows: walk the Ranger 6 m away and see the officer keep up.
    const start = { x: off.sprite.x, y: off.sprite.y };
    for (let k = 0; k < 12; k++) {
      m.ranger.setPosition(m.ranger.x + 0.5 * m.ppm, m.ranger.y);
      await wait(150);
    }
    const moved = await until(() => Math.hypot(off.sprite.x - start.x, off.sprite.y - start.y) > 1.5 * m.ppm, 20000);
    return { ok: following && moved && off.alive && !m.objectiveDone, kind, hud0, hud: o.hud(m), following, moved };
  }
  if (kind === 'pow') {
    const open = await until(() => o.open, 15000);
    const ex = cellToScreen(o.exit);
    m.ranger.setPosition(ex.x, ex.y + 3 * m.ppm * 0.5);
    const joined = await until(() => o.escort.following.length === o.escort.alive.length, 60000);
    return { ok: open && joined && o.escort.following.length > 0, kind, open, following: o.escort.following.length, alive: o.escort.alive.length, hud: o.hud(m) };
  }
  if (kind === 'sam') return { ok: m.objectiveDone, kind, hud: o.hud(m), stats: o.stats(m) };
  return { ok: false, kind, error: 'unknown objective kind' };
}

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
    while (m.busy) await wait(50);
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
    // A patrol or a crate in the line of fire takes the rocket instead: fire again (up to 3).
    let flying = 0;
    let sprite = null;
    let shots = 0;
    const laws = (m.lawsLeft = Math.max(3, m.lawsLeft));
    for (; shots < 3 && t.hp > 0; shots++) {
      while (m.busy) await wait(50);
      m.ranger.setPosition(t.at.x - 10 * m.ppm, t.at.y);
      m.facing = 'E';
      m.prone = false;
      m.selectWeapon('law');
      m.use();
      const t0 = performance.now();
      while (performance.now() - t0 < 30000 && !m.rockets.length) await wait(30);
      flying = Math.max(flying, m.rockets.length);
      sprite ??= m.rockets[0]?.sprite.texture?.key ?? null;
      while (performance.now() - t0 < 60000 && m.rockets.length) await wait(30);
    }
    return { name: t.name, flying, sprite, shots, hp: t.hp, by: t.destroyedBy ?? null, used: laws - m.lawsLeft };
  });
  await page.screenshot({ path: 'test-results/arsenal-law.png' }).catch(() => undefined);
  console.log('LAW:', JSON.stringify(law));
  if (law.error || !law.flying || law.sprite !== 'law_rocket' || law.used !== law.shots || law.hp > 0 || law.by !== 'law') fail('LAW rocket (fired, flew and destroyed the target)');

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
    await until(tp, () => !window.game.scene.getScene('mission').busy, null, 15000);
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

// ---- G9: enemies (machine-gun nest, mines, trench, tank, sight, alerts, alarm) on the test field ----

async function g9Checks(page) {
  let ok = true;
  const fail = (msg) => {
    ok = false;
    console.log('G9 CHECK FAILED:', msg);
  };
  // Helpers in the page: world <-> screen and a Ranger teleport (world metres).
  await page.evaluate(() => {
    const f = window.game.scene.getScene('field');
    const scr = (w) => ({ x: w.x * f.ppm, y: -w.y * f.ppm * 0.5 });
    window.g9t = {
      f,
      scr,
      put(w, facing) {
        const s = scr(w);
        f.busy = false;
        f.prone = false;
        f.ranger.setPosition(s.x, s.y);
        if (facing) f.facing = facing;
      },
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
  });
  const setup = await page.evaluate(() => {
    const { f } = window.g9t;
    const g = f.g9;
    if (!g) return { error: 'no g9 on the field' };
    return {
      nests: g.nests.list.length,
      gunner: g.nests.list[0]?.gunner.anims.currentAnim?.key ?? null,
      mines: g.mines.list.length,
      hidden: g.mines.list.filter((m) => !m.sprite.visible).length,
      trenches: g.trenches.list.length,
      tanks: g.tanks.list.length,
      canopy: g.sight.canopyCells,
      difficulty: g.difficulty,
    };
  });
  console.log('g9 setup:', JSON.stringify(setup));
  if (setup.error || setup.nests < 1 || !setup.gunner || setup.mines < 3 || setup.hidden !== setup.mines || setup.trenches < 1 || setup.tanks < 1 || setup.canopy < 10) {
    fail('want a manned nest, >= 3 hidden mines, a trench, a tank and tree canopies');
    return ok;
  }

  // Mines: hidden until close, then visible; stepping on one wounds the Ranger.
  const mine = await page.evaluate(async () => {
    const { f, put, wait } = window.g9t;
    const m = f.g9.mines.list[0];
    // Unhurtable (a stray enemy shot mustn't end the check): record the damage the mine deals instead.
    f.god = true;
    let mineDmg = 0;
    const hurt = f.hurtRanger;
    f.hurtRanger = (d) => {
      mineDmg += d;
      return hurt.call(f, d);
    };
    put({ x: m.w.x - 3.2, y: m.w.y });
    await wait(400);
    const far = m.sprite.visible;
    put({ x: m.w.x - 1.8, y: m.w.y });
    await wait(400);
    const near = m.sprite.visible;
    put({ x: m.w.x, y: m.w.y });
    const t0 = performance.now();
    while (performance.now() - t0 < 8000 && m.live) await wait(100);
    f.hurtRanger = hurt;
    return { far, near, live: m.live, damage: mineDmg, triggered: f.g9.mines.stats.triggered };
  });
  console.log('g9 mine:', JSON.stringify(mine));
  if (mine.far || !mine.near || mine.live || !(mine.damage >= 40)) fail('mine (hidden at 3 m, seen at 1.8 m, stepping on it wounds)');
  await page.waitForTimeout(800);

  // Trench: slower and in cover, waist deep.
  const trench = await page.evaluate(async () => {
    const { f, put, wait } = window.g9t;
    const t = f.g9.trenches.list[0];
    const [i, j] = [(t.line[0][0] + t.line[1][0]) / 2, (t.line[0][1] + t.line[1][1]) / 2];
    f.ranger.setPosition((i - j) * 32, (i + j) * 16);
    f.busy = false;
    f.prone = false;
    await wait(500);
    return { inside: f.g9.trenches.inside, speed: f.g9.speedScale(), view: f.g9.viewScale(), hit: f.g9.hitScale(), lip: !!f.g9.trenches.lip?.visible, hud: f.hud.text.split('\n')[0] };
  });
  console.log('g9 trench:', JSON.stringify(trench));
  if (!trench.inside || !(trench.speed < 1) || !(trench.view < 1) || !(trench.hit < 1) || !/IN TRENCH/.test(trench.hud)) fail('trench (inside, slower, harder to see and hit, HUD)');
  await page.screenshot({ path: 'test-results/g9-trench.png' }).catch(() => undefined);

  // Machine-gun nest: the gunner fires bursts at the Ranger in his arc; two grenades destroy the nest and him.
  const nest = await page.evaluate(async () => {
    const { f, put, wait } = window.g9t;
    const n = f.g9.nests.list[0];
    const v = { x: Math.cos(n.facing), y: Math.sin(n.facing) };
    const aw = f.worldOf(n.placed.at);
    put({ x: aw.x + v.x * 9, y: aw.y + v.y * 9 });
    const t0 = performance.now();
    while (performance.now() - t0 < 30000 && f.g9.nests.stats.rounds < 3) await wait(100);
    return { rounds: f.g9.nests.stats.rounds, bursts: f.g9.nests.stats.bursts, alarm: f.g9.alerts.alarm, anim: n.gunner.anims.currentAnim?.key };
  });
  console.log('g9 nest fires:', JSON.stringify(nest));
  if (nest.rounds < 3) fail('the nest did not fire a burst at the Ranger in its arc');
  await page.screenshot({ path: 'test-results/g9-nest.png' }).catch(() => undefined);
  const nestDown = await page.evaluate(async () => {
    const { f, put, wait } = window.g9t;
    const n = f.g9.nests.list[0];
    const v = { x: Math.cos(n.facing), y: Math.sin(n.facing) };
    const aw = f.worldOf(n.placed.at);
    // 8 m (the grenade's reach) out along the arc's centre, facing back at the nest.
    const back = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][((Math.round(Math.atan2(-v.y, -v.x) / (Math.PI / 4)) % 8) + 8) % 8];
    f.grenadesLeft = 99;
    for (let tries = 0; tries < 5 && n.alive; tries++) {
      put({ x: aw.x + v.x * 8, y: aw.y + v.y * 8 }, back);
      f.throwGrenade();
      const t0 = performance.now();
      await wait(200);
      while (performance.now() - t0 < 20000 && (f.grenades.length || f.busy)) await wait(100);
      await wait(300);
    }
    return { alive: n.alive, nest: n.placed.state, hp: n.placed.hp, gunner: n.gunner.anims.currentAnim?.key };
  });
  console.log('g9 nest destroyed:', JSON.stringify(nestDown));
  if (nestDown.alive || !(nestDown.hp <= 0)) fail('grenades did not destroy the nest and its gunner');

  // Tank: drives, sees the Ranger, fires shells that burst; a grenade does nothing, a LAW destroys it.
  await page.evaluate(() => {
    const { f, put } = window.g9t;
    // A spot `r` m from the tank in one of the 8 directions with a clear view of it; the Ranger faces it.
    window.g9t.spotNear = (t, r) => {
      const D = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
      const tw = f.worldOf(t.placed.at);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const w = { x: tw.x - Math.cos(a) * r, y: tw.y - Math.sin(a) * r };
        const s = window.g9t.scr(w);
        if (!f.canStand(s.x, s.y) || f.propAt(w)) continue;
        if (f.g9.tanks.sees(t, w)) return { w, facing: D[k] };
      }
      return null;
    };
    void put;
  });
  const tank = await page.evaluate(async () => {
    const { f, put, wait, spotNear } = window.g9t;
    const t = f.g9.tanks.list[0];
    const tw0 = f.worldOf(t.placed.at);
    put({ x: tw0.x + 30, y: tw0.y + 30 }); // out of sight (but near enough to be awake): it drives
    const t0 = performance.now();
    while (performance.now() - t0 < 30000 && t.travelled < 2) await wait(100);
    const spot = spotNear(t, 12);
    if (!spot) return { error: 'no clear spot 12 m from the tank', travelled: t.travelled };
    put(spot.w, spot.facing);
    const t1 = performance.now();
    while (performance.now() - t1 < 40000 && f.g9.tanks.stats.blasts < 1) await wait(100);
    return { travelled: +t.travelled.toFixed(2), mode: t.mode, shots: f.g9.tanks.stats.shots, blasts: f.g9.tanks.stats.blasts };
  });
  console.log('g9 tank fires:', JSON.stringify(tank));
  if (tank.error || !(tank.travelled >= 2) || tank.shots < 1 || tank.blasts < 1) fail('tank (drives its route, fires a shell that bursts)');
  await page.screenshot({ path: 'test-results/g9-tank.png' }).catch(() => undefined);
  const armour = await page.evaluate(async () => {
    const { f, put, wait, spotNear } = window.g9t;
    const t = f.g9.tanks.list[0];
    f.grenadesLeft = 99;
    let spot = spotNear(t, 8);
    if (spot) {
      put(spot.w, spot.facing);
      f.throwGrenade();
      const t0 = performance.now();
      await wait(200);
      while (performance.now() - t0 < 20000 && (f.grenades.length || f.busy)) await wait(100);
    }
    const afterGrenade = t.hp;
    f.lawsLeft = 9;
    for (let tries = 0; tries < 3 && t.mode !== 'dead'; tries++) {
      spot = spotNear(t, 10);
      if (!spot) break;
      put(spot.w, spot.facing);
      f.fireLaw();
      const t1 = performance.now();
      await wait(200);
      while (performance.now() - t1 < 20000 && (f.rockets.length || f.busy)) await wait(100);
      await wait(300);
    }
    const t2 = performance.now();
    while (performance.now() - t2 < 15000 && t.placed.state !== 'destroyed') await wait(100);
    return { afterGrenade, armourHits: f.g9.tanks.stats.armourHits, mode: t.mode, state: t.placed.state, hp: t.placed.hp, by: t.placed.destroyedBy ?? null, anim: t.placed.sprite.anims.currentAnim?.key };
  });
  console.log('g9 tank armour:', JSON.stringify(armour));
  if (armour.afterGrenade !== 300 || armour.armourHits < 1 || armour.mode !== 'dead' || armour.state !== 'destroyed' || armour.by !== 'law') fail('tank armour (a grenade does nothing, a LAW destroys it)');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/g9-tank-wreck.png' }).catch(() => undefined);

  // Sight: a canopy between a soldier and the Ranger hides him. Alerts: an alerted soldier's neighbour follows; the
  // alarm sends reinforcements to the last known position.
  const alerts = await page.evaluate(async () => {
    const { f, put, wait, scr } = window.g9t;
    const live = f.enemies.filter((e) => e.state !== 'dead');
    if (live.length < 2) return { error: 'fewer than 2 soldiers left' };
    const [a, b] = live;
    const aw = f.worldOf(a.sprite);
    const bs = scr({ x: aw.x + 5, y: aw.y + 2 });
    b.sprite.setPosition(bs.x, bs.y);
    b.path = [bs];
    b.next = 0;
    a.path = [{ x: a.sprite.x, y: a.sprite.y }];
    a.next = 0;
    // The Ranger 20 m off: both awake, too far to be seen.
    put({ x: aw.x - 20, y: aw.y });
    for (const e of live) if (e !== a && e !== b) e.state = 'dead';
    a.state = 'patrol';
    b.state = 'patrol';
    await wait(500);
    const before = { a: a.state, b: b.state, spread: f.g9.alerts.stats.spread };
    a.state = 'alert';
    a.reaction = 0.7;
    a.unseen = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 15000 && b.state !== 'alert') await wait(30);
    const spread = { before, b: b.state, spreadAfter: f.g9.alerts.stats.spread };
    const sent0 = f.g9.alerts.stats.reinforcements;
    f.g9.alerts.alarm = false;
    f.g9.alerts.raiseAlarm({ x: f.ranger.x, y: f.ranger.y });
    return { spread, alarm: f.g9.alerts.alarm, hunters: f.g9.alerts.stats.reinforcements - sent0, stats: f.g9.alerts.stats, hud: f.hud.text.split('\n')[0] };
  });
  console.log('g9 alerts:', JSON.stringify(alerts));
  if (alerts.error || alerts.spread.b !== 'alert' || alerts.spread.before.b !== 'patrol' || !(alerts.spread.spreadAfter > alerts.spread.before.spread) || !alerts.alarm || alerts.hunters < 1) fail('alerts (spread to a neighbour, alarm sends reinforcements)');
  // Night and dusk: the view shrinks.
  const dusk = await page.evaluate(() => {
    const g = window.g9t.f.g9;
    const day = g.viewScale();
    g.sight.light = 0.7;
    const d = g.viewScale();
    g.sight.light = 1;
    return { day, dusk: d };
  });
  if (!(dusk.dusk < dusk.day)) fail('dusk does not shorten the view');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/g9.png' }).catch(() => undefined);
  return ok;
}
