// G8 (lane g8b): load-check drivers for the objective missions 9-12 (photo, hostages, diversion, sabotage). Called by
// scripts/load-check.mjs for a mission whose config has an `objective` of these kinds; each plays the objective
// through the game's own actions (unhurtable, nobody sees the Ranger unless a check wants it), then extracts and
// expects MISSION ACCOMPLISHED. Returns true when it passed.

/** Run an async function in the page (headless GL runs slow game time: poll with wall-clock limits). */
const inPage = (page, fn, arg) => page.evaluate(fn, arg);

/** Shared page helpers, installed once per page. */
async function helpers(page) {
  await inPage(page, () => {
    const m = window.game.scene.getScene('mission');
    window.g8 = {
      m,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      async until(fn, ms = 30000) {
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          if (fn()) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      },
      /** Cell → screen (iso, origin at the map's top corner). */
      put(cx, cy) {
        m.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
      },
      cellOf(p) {
        return { x: (p.x / 32 + p.y / 16) / 2, y: (p.y / 16 - p.x / 32) / 2 };
      },
      centre(a) {
        return [(Math.min(...a.map((p) => p[0])) + Math.max(...a.map((p) => p[0]))) / 2, (Math.min(...a.map((p) => p[1])) + Math.max(...a.map((p) => p[1]))) / 2];
      },
      async extract() {
        const [cx, cy] = window.g8.centre(m.extractArea);
        window.g8.put(cx, cy);
        await window.g8.until(() => m.outcome, 15000);
        return { outcome: m.outcome, objectiveDone: m.objectiveDone, failReason: m.failReason, stats: m.objective?.stats?.(m) ?? null };
      },
    };
    m.god = true;
  });
}

/** Start the mission again (after a check that fails it on purpose) and reinstall the helpers. */
async function restart(page) {
  await inPage(page, async () => {
    const g = window.game;
    g.scene.getScene('mission').scene.restart();
    await new Promise((r) => setTimeout(r, 500));
    const t0 = performance.now();
    while (performance.now() - t0 < 60000 && !(g.scene.getScene('mission').ranger && g.scene.getScene('mission').objective && !g.scene.getScene('mission').outcome)) await new Promise((r) => setTimeout(r, 100));
  });
  await helpers(page);
}

export async function objectiveChecks(page, scene, kind) {
  await helpers(page);
  let ok = true;
  const fail = (msg) => {
    ok = false;
    console.log(msg);
  };
  if (kind === 'photo') {
    // The seen rule, in a fresh run of the mission.
    const seen = await inPage(page, async () => {
      const g = window.game;
      const m = g.scene.getScene('mission');
      m.scene.restart({ mission: m.cfg.map });
      await window.g8.wait(500);
      await window.g8.until(() => g.scene.getScene('mission').ranger && g.scene.getScene('mission').objective, 60000);
      const n = g.scene.getScene('mission');
      n.god = true;
      const e = n.enemies[0];
      e.state = 'alert';
      n.sees = (x) => x === e;
      const [cx, cy] = [10, 30];
      n.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
      await window.g8.until(() => n.outcome, 15000);
      return { outcome: n.outcome, failReason: n.failReason };
    });
    console.log('photo seen:', JSON.stringify(seen));
    if (seen.outcome !== 'failed' || !/Seen/.test(seen.failReason ?? '')) fail('PHOTO SEEN RULE FAILED (want failed: seen at the hangar)');
    await restart(page);
    const r = await inPage(page, async () => {
      const { m, until, put, cellOf, extract } = window.g8;
      const o = m.objective;
      const cam = m.touchExtras.find((x) => x.key === 'camera');
      // From the drop: too far, nothing happens.
      cam?.action();
      const far = o.state.exposing;
      // Seen inside the hangar zone before the photos: failed. (Checked on a copy of the rule: an enemy that sees him.)
      const sees = m.sees;
      m.sees = () => false;
      const p = m.props.find((x) => x.name === 'prototype_rocket');
      const c = cellOf(p.at);
      put(c.x + 1, c.y + 7);
      m.busy = false;
      await window.g8.wait(300);
      const inView = o.hud(m);
      cam.action();
      const started = o.state.exposing !== null;
      const anim = m.ranger.anims.currentAnim?.key ?? null;
      await until(() => o.state.taken, 30000);
      const taken = o.state.taken;
      m.sees = sees;
      const end = await extract();
      return { hasCamera: !!cam, far, inView, started, anim, taken, ...end };
    });
    console.log('photo:', JSON.stringify(r));
    if (!r.hasCamera || r.far !== null || !r.started || !/camera_kneel_shoot/.test(r.anim ?? '') || !r.taken || r.outcome !== 'accomplished') fail('PHOTO CHECK FAILED (want: CAMERA item, nothing from afar, kneel + exposure in view, photos taken, accomplished)');
  }
  if (kind === 'hostages') {
    const r = await inPage(page, async () => {
      const { m, until, put, cellOf, extract, wait } = window.g8;
      const o = m.objective;
      const s0 = o.state;
      const sitting = o.followers.list.filter((f) => /sit/.test(f.sprite.anims.currentAnim?.key ?? '')).length;
      m.sees = () => false;
      for (const e of m.enemies) e.sprite.setActive(false);
      m.enemies.length = 0;
      const gate = m.props.find((x) => x.name === 'stockade_gate');
      const g = cellOf(gate.at);
      // A time bomb at the gate (outside), a short fuse for the check, the Ranger clear of it.
      put(g.x, g.y + 1.2);
      m.facing = 'NE';
      m.busy = false;
      m.prone = false;
      m.bombsLeft = 5;
      m.placeBomb();
      await until(() => m.bombs.length, 20000);
      m.bombs.forEach((b) => (b.fuse = 0.5));
      put(g.x, g.y + 12);
      await until(() => o.state.freed, 30000);
      const freed = o.state;
      // Walk them out: the Ranger waits 8 m outside the gate until they are with him.
      put(g.x, g.y + 8);
      const out = await until(() => o.followers.list.filter((f) => f.alive && f.free && !f.exits.length).length >= o.state.alive && o.state.alive > 0, 90000);
      const near = o.followers.alive.filter((f) => Math.hypot(f.sprite.x - m.ranger.x, (f.sprite.y - m.ranger.y) * 2) < 10 * m.ppm).length;
      const moving = o.followers.list.map((f) => f.sprite.anims.currentAnim?.key?.split('/').pop()).join(',');
      await wait(300);
      const end = await extract();
      return { s0, sitting, freed, out, near, moving, ...end };
    });
    console.log('hostages:', JSON.stringify(r));
    if (r.s0.total < 3 || r.sitting < r.s0.total || !r.freed.freed || !r.out || r.outcome !== 'accomplished' || !/^[1-9]/.test(String(r.stats?.['hostages rescued'] ?? ''))) {
      fail('HOSTAGES CHECK FAILED (want: >= 3 sitting hostages, the gate blown frees them, they come out and follow, accomplished with rescued > 0)');
    }
  }
  if (kind === 'diversion') {
    // Premature contact: a shot in the garrison during the hold fails it.
    const early = await inPage(page, async () => {
      const g = window.game;
      const m = g.scene.getScene('mission');
      m.scene.restart({ mission: m.cfg.map });
      await window.g8.wait(500);
      await window.g8.until(() => g.scene.getScene('mission').ranger && g.scene.getScene('mission').objective, 60000);
      const n = g.scene.getScene('mission');
      n.god = true;
      n.sees = () => false;
      const a = n.objectiveArea;
      const cx = (Math.min(...a.map((q) => q[0])) + Math.max(...a.map((q) => q[0]))) / 2;
      const cy = (Math.min(...a.map((q) => q[1])) + Math.max(...a.map((q) => q[1]))) / 2 + 4;
      n.ranger.setPosition((cx - cy) * 32, (cx + cy) * 16);
      await window.g8.until(() => n.objective.state.phase === 'hold', 10000);
      n.busy = false;
      n.weapon = 'carbine';
      n.shoot();
      await window.g8.until(() => n.outcome, 15000);
      return { outcome: n.outcome, failReason: n.failReason };
    });
    console.log('diversion early:', JSON.stringify(early));
    if (early.outcome !== 'failed' || !/Premature/.test(early.failReason ?? '')) fail('DIVERSION PREMATURE RULE FAILED');
    await restart(page);
    const r = await inPage(page, async () => {
      const { m, until, put, centre, extract } = window.g8;
      const o = m.objective;
      m.sees = () => false;
      const [cx, cy] = centre(m.objectiveArea);
      put(cx, cy + 4);
      await until(() => o.state.phase === 'hold', 10000);
      const hold = o.state.phase;
      o.hurry();
      await until(() => o.state.phase === 'window', 10000);
      const window1 = o.state.phase;
      const alerted = m.enemies.filter((e) => e.state === 'alert').length;
      // Wreck installations in the garrison (2 points each).
      const inZone = (p) => {
        const c = window.g8.cellOf(p.at);
        const a = m.objectiveArea;
        return c.x > Math.min(...a.map((q) => q[0])) && c.x < Math.max(...a.map((q) => q[0])) && c.y > Math.min(...a.map((q) => q[1])) && c.y < Math.max(...a.map((q) => q[1]));
      };
      for (const p of m.props.filter((p) => p.hp > 0 && inZone(p)).slice(0, 3)) {
        p.hp = 0;
        m.destroyProp(p, 'grenade');
      }
      await until(() => o.state.phase === 'inbound', 10000);
      const inbound = o.state;
      o.hurry();
      await until(() => o.state.phase === 'landed', 10000);
      const end = await extract();
      return { hold, window1, alerted, inbound, ...end };
    });
    console.log('diversion:', JSON.stringify(r));
    if (r.hold !== 'hold' || r.window1 !== 'window' || r.alerted < 1 || r.inbound.phase !== 'inbound' || r.outcome !== 'accomplished') fail('DIVERSION CHECK FAILED (want: hold, buzzer window with the garrison alerted, diversion made, plane lands, accomplished)');
  }
  if (kind === 'sabotage') {
    const r = await inPage(page, async () => {
      const { m, until, put, cellOf, extract } = window.g8;
      const o = m.objective;
      m.sees = () => false;
      m.bombsLeft = 9;
      const fuses = [];
      let anim = null;
      for (const t of m.targets) {
        const c = cellOf(t.at);
        // Stand just south-east of the hull (cell +x), facing it.
        const xs = t.world.map((q) => q.x);
        const half = (Math.max(...xs) - Math.min(...xs)) / 2;
        put(c.x + half * 0.7 + 0.6, c.y + half * 0.7 + 0.6);
        m.facing = 'N';
        m.busy = false;
        m.prone = false;
        const n = m.bombs.length;
        m.placeBomb();
        await window.g8.wait(150);
        anim ??= m.ranger.anims.currentAnim?.key ?? null;
        await until(() => m.bombs.length > n, 20000);
        fuses.push(Math.round(m.bombs.at(-1)?.fuse ?? 0));
      }
      const state = o.state;
      const end = await extract();
      return { targets: m.targets.length, fuses, anim, state, ...end };
    });
    console.log('sabotage:', JSON.stringify(r));
    if (r.targets < 2 || r.fuses.some((f) => f < 100) || !/plant_kneel_place/.test(r.anim ?? '') || r.state.charged !== r.targets || r.outcome !== 'accomplished') {
      fail('SABOTAGE CHECK FAILED (want: kneel_place, a delayed fuse on every fuel target, accomplished)');
    }
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/${scene}-end.png` }).catch(() => undefined);
  return ok;
}
