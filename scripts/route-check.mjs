// G6 balance: the shortest walkable route of each mission (drop → objective → extraction) and what it takes at the
// Ranger's run and walk speeds, with the G9 hazards on it.
//   node scripts/route-check.mjs [mission1 …] [--walk http://localhost:5296] [--clearance <m>]
// The routes come from the generator (`ssg map route`, FB-110: collision and solid object footprints block, 8-way, on
// the map as built in the project, which is what build-maps exported); the hazards are read from the exported .tmj.
// --walk: the Ranger (unhurtable; the people he escorts are not, G15) then runs that route in the game, steered waypoint to waypoint with the keyboard
// state, through the game's own collision; it prints the mission clock it took and whether he got there. The walk follows
// the generator's route with a clearance (`ssg map route --clearance`, FB-125; default WALK_CLEARANCE m), because the
// game's colliders aren't cell aligned and the plain shortest route can squeeze through a one-cell gap he doesn't fit.
// Exits 1 when a route is missing or crosses a minefield, or the walk doesn't get to the end.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';
const project = JSON.parse(fs.readFileSync(path.join(root, 'ssg.assets.json'), 'utf8')).project;
/** The generator's shortest walkable route between two zones (names) or "x,y" cells: {metres, cells}; `clearance` (m)
 * keeps it that far from blocked cells and footprints (FB-125). */
const route = (map, from, to, clearance = 0) => {
  try {
    const args = [SSG, '--json', 'map', 'route', map, '--project', project, '--from', from, '--to', to, '--cells', ...(clearance ? ['--clearance', String(clearance)] : [])];
    const r = JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    return r.found ? { m: r.metres, cells: r.cells } : { m: Infinity, cells: [] };
  } catch (e) {
    let why = String(e.stderr || e.message).trim().split('\n')[0];
    try {
      why = JSON.parse(e.stdout).reason ?? why;
    } catch {
      /* not JSON */
    }
    console.log(`  route ${from} → ${to}${clearance ? ` (clearance ${clearance} m)` : ''}: ${why}`);
    return { m: Infinity, cells: [] };
  }
};
let failed = 0;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/manifest.json'), 'utf8'));
const run = manifest.sprites.ranger.clipInfo.rifle_run.speedMps;
const walk = manifest.sprites.ranger.clipInfo.rifle_walk.speedMps;
const argv = process.argv.slice(2);
const walkUrl = argv.includes('--walk') ? argv[argv.indexOf('--walk') + 1] : null;
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
/** The clearance (m) of the route the walk follows (FB-125). */
const WALK_CLEARANCE = Number(opt('--clearance') ?? 0.5);
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--walk' && argv[i - 1] !== '--clearance');
const names = pos.length ? pos : Object.keys(manifest.maps);
let browser = null;
if (walkUrl) {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}
const props = (o) => Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value]));

for (const name of names) {
  const tmj = JSON.parse(fs.readFileSync(path.join(root, 'public', manifest.maps[name].tmj), 'utf8'));
  const th = tmj.tileheight;
  const layer = (k) => tmj.layers.find((l) => (l.class ?? l.name) === k)?.objects ?? [];
  const zones = layer('zones');
  const drop = zones.find((z) => z.type === 'spawn' && props(z).team === 'ranger');
  // G8: a custom zone with `route` marks where the objective is really reached (the code book, the officer, the
  // P.O.W. camp's exit), when the objective zone's centre is inside a building or behind wire. An objective inside an
  // enclosure (mission 10's stockade) names the cell to reach in `approach` ("x,y").
  const obj = zones.find((z) => z.type === 'custom' && props(z).route) ?? zones.find((z) => z.type === 'objective');
  const ex = zones.find((z) => z.type === 'extraction');
  const oref = props(obj).approach ? String(props(obj).approach) : obj.name;
  const ra = route(name, drop.name, oref);
  const rb = route(name, oref, ex.name);
  const a = ra.m;
  const b = rb.m;
  const total = a + b;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  console.log(`${name}: drop→objective ${a.toFixed(0)} m, objective→extraction ${b.toFixed(0)} m, total ${total.toFixed(0)} m · run ${mmss(total / run)} · walk ${mmss(total / walk)}`);
  if (!Number.isFinite(total)) failed++;
  // G10: the G9 hazards along that route (the game's own numbers: src/enemies/mgnest.ts 18 m and ±65°, tanks.ts 22 m).
  // Mines on the route are a mistake (the shortest way must not need a minefield); nests and tanks may cover it, but
  // the drop→objective leg of a stealth mission (9) should stay out of their reach.
  const hz = hazards(tmj, th, ra.cells, rb.cells);
  if (hz.list.length) console.log(`  hazards: ${hz.list.join(' · ')}`);
  if (hz.mined) {
    console.log(`  MINES ON THE ROUTE: ${hz.mined} cells`);
    failed++;
  }
  // The route the walk follows: the generator's, kept WALK_CLEARANCE m off blocked cells and footprints (FB-125). Where
  // it finds none (a drop or objective in a thicket: FB-128), that leg falls back to the game's own clearRoute.
  const walkLeg = (from, to, leg) => {
    const g = WALK_CLEARANCE ? route(name, from, to, WALK_CLEARANCE) : leg;
    if (g.cells.length) return { ...g, how: `generator, clearance ${WALK_CLEARANCE} m` };
    const c = clearRoute(tmj, leg.cells); // FB-128
    return c.cells.length ? { ...c, how: 'own clearRoute, FB-128' } : { ...leg, how: "generator's shortest" };
  };
  const wa = walkLeg(drop.name, oref, ra);
  const wb = walkLeg(oref, ex.name, rb);
  if (Number.isFinite(total)) console.log(`  walk route: ${wa.m.toFixed(0)} m (${wa.how}) + ${wb.m.toFixed(0)} m (${wb.how})`);
  // The walked route must keep out of the minefields too.
  const wz = hazards(tmj, th, wa.cells, wb.cells);
  if (wz.mined) {
    console.log(`  MINES ON THE WALK ROUTE: ${wz.mined} cells`);
    failed++;
  }
  if (process.env.ROUTE_DUMP) fs.writeFileSync(path.join(process.env.ROUTE_DUMP, `${name}.route.json`), JSON.stringify({ in: ra.cells, out: rb.cells, walkIn: wa.cells, walkOut: wb.cells }));
  if (browser) {
    // The clearance route (the reported metres and hazards stay the shortest route's). Every 4th cell of the route as
    // a waypoint (cell centres).
    const way = [...(wa.cells.length ? wa.cells : ra.cells), ...(wb.cells.length ? wb.cells : rb.cells)].filter((_, k, all) => k % 4 === 0 || k === all.length - 1).map(([x, y]) => [x + 0.5, y + 0.5]);
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`${walkUrl.replace(/\/$/, '')}/?scene=mission&mission=${name}`);
    await page.waitForFunction(() => window.game?.scene?.getScene('mission')?.ranger, null, { timeout: 180000 });
    const res = await page.evaluate(async (way) => {
      const m = window.game.scene.getScene('mission');
      m.god = true;
      // G8: objectives that fail when the Ranger is seen (missions 9, 12) would end the walk: nobody sees him.
      if (m.objective) m.sees = () => false;
      // G15: the people he escorts (mission 6's officer) are no longer made unhurtable: enemy rounds only wound them
      // now (src/enemies/wounds.ts), and a walk that ends early still reports it (`ended`).
      // G15: what enemy fire did to the escort on the way (wounds, rounds stopped in a grace, kills).
      const escort = () => {
        const w = m.g9?.escort?.wounds;
        const o = m.objective?.stats?.(m);
        return { ...(w && w.wounds + w.graced + w.kills ? { escortWounds: { ...w } } : {}), ...(o && Object.keys(o).length ? { objective: o } : {}) };
      };
      const k = m.keys;
      const t0 = m.timeLeft;
      let i = 0;
      let stuck = 0;
      let side = 0;
      let sideDir = 1;
      let unstick = 0;
      let last = m.rangerCell();
      const wall0 = performance.now();
      while (i < way.length && performance.now() - wall0 < 20 * 60 * 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        const c = m.rangerCell();
        if (m.outcome && m.outcome !== 'accomplished') return { reached: i, of: way.length, at: c, gameSeconds: +(t0 - m.timeLeft).toFixed(1), ended: m.outcome, reason: m.result?.reason ?? null, ...escort() };
        const [wx, wy] = way[i];
        // Cells → world (x east, y north): +x cell is south-east, +y cell south-west.
        const dxc = wx - c.x;
        const dyc = wy - c.y;
        if (Math.hypot(dxc, dyc) < 1.2) {
          i++;
          continue;
        }
        let ex = (dxc - dyc) * Math.SQRT1_2;
        let ny = -(dxc + dyc) * Math.SQRT1_2;
        // Stuck on a collider: sidestep (left, then right) for a moment.
        if (side > 0) {
          side--;
          [ex, ny] = sideDir > 0 ? [-ny, ex] : [ny, -ex];
        }
        const n = Math.hypot(ex, ny);
        k.D.isDown = ex / n > 0.38;
        k.A.isDown = ex / n < -0.38;
        k.W.isDown = ny / n > 0.38;
        k.S.isDown = ny / n < -0.38;
        k.SHIFT.isDown = true;
        if (Math.hypot(c.x - last.x, c.y - last.y) < 0.002) stuck++;
        else stuck = 0;
        last = c;
        if (stuck > 0 && stuck % 8 === 0 && side === 0) {
          side = 10;
          sideDir = -sideDir;
          unstick++;
        }
        if (stuck > 300) return { reached: i, of: way.length, at: c, gameSeconds: +(t0 - m.timeLeft).toFixed(1), stuck: true };
      }
      for (const key of ['W', 'A', 'S', 'D', 'SHIFT']) k[key].isDown = false;
      return { reached: i, of: way.length, gameSeconds: +(t0 - m.timeLeft).toFixed(1), unstick, ...escort() };
    }, way);
    console.log(`  walk: ${JSON.stringify(res)}`);
    if (res.reached < res.of) {
      console.log('  WALK STUCK');
      failed++;
    }
    await page.close();
  }
}
await browser?.close();
process.exitCode = failed ? 1 : 0;

/**
 * The G9 hazards on a route (cells): route cells inside a minefield, the cells of each leg (in = drop→objective, out =
 * objective→extraction) a machine-gun nest covers (range and arc, sight lines not traced) and a tank route's nearest
 * approach. Cells are metres; a cell (x, y) is world ((x − y)/√2, −(x + y)/√2).
 */
function hazards(tmj, th, inLeg, outLeg) {
  const layer = (k) => tmj.layers.find((l) => (l.class ?? l.name) === k)?.objects ?? [];
  const zp = (z) => (z.polygon ?? z.polyline ?? [{ x: 0, y: 0 }]).map((q) => [(z.x + q.x) / th, (z.y + q.y) / th]);
  const inPoly = ([x, y], poly) => {
    let r = false;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      const [ax, ay] = poly[k];
      const [bx, by] = poly[j];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) r = !r;
    }
    return r;
  };
  const segDist = ([px, py], line) => {
    let best = Infinity;
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, ay] = line[k];
      const [bx, by] = line[k + 1];
      const ex = bx - ax;
      const ey = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
      best = Math.min(best, Math.hypot(ax + t * ex - px, ay + t * ey - py));
    }
    return best;
  };
  const centre = ([x, y]) => [x + 0.5, y + 0.5];
  const route = [...inLeg, ...outLeg].map(centre);
  const list = [];
  let mined = 0;
  const zones = layer('zones').filter((z) => z.type === 'custom');
  const pz = (z) => Object.fromEntries((z.properties ?? []).map((p) => [p.name, p.value]));
  for (const z of zones.filter((z) => pz(z).minefield)) {
    const poly = zp(z);
    const n = route.filter((c) => inPoly(c, poly)).length;
    mined += n;
    list.push(`${z.name}#${z.id} ${n} cells`);
  }
  const W = Math.SQRT1_2;
  const world = ([x, y]) => [(x - y) * W, -(x + y) * W];
  const DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  for (const o of layer('objects')) {
    const p = Object.fromEntries((o.properties ?? []).map((q) => [q.name, q.value]));
    if (String(p.sprite ?? o.name) !== 'mg_nest') continue;
    const a = (Math.max(0, DIRS.indexOf(String(p.facing))) * Math.PI) / 4;
    const [ax, ay] = world([o.x / th, o.y / th]);
    const g = [ax - Math.cos(a) * 1.9, ay - Math.sin(a) * 1.9];
    const covered = (cells) =>
      cells.map(centre).filter((c) => {
        const [wx, wy] = world(c);
        const d = Math.hypot(wx - g[0], wy - g[1]);
        let da = Math.atan2(wy - g[1], wx - g[0]) - a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        return d <= 18 && Math.abs(da) <= (65 * Math.PI) / 180;
      }).length;
    list.push(`nest ${p.id ?? o.id} ${p.facing} covers in ${covered(inLeg)} / out ${covered(outLeg)} cells`);
  }
  for (const z of zones.filter((z) => pz(z).tank)) {
    const line = zp(z);
    const near = (cells) => Math.min(...cells.map(centre).map((c) => segDist(c, line)));
    list.push(`${z.name}#${z.id} nearest in ${near(inLeg).toFixed(0)} m / out ${near(outLeg).toFixed(0)} m`);
  }
  for (const z of zones.filter((z) => pz(z).trench)) list.push(`${z.name}#${z.id}`);
  return { list, mined };
}

/**
 * FB-128 workaround (was FB-125's): the shortest 8-way route from the first to the last cell of `leg` (a generator route) over the
 * exported map, with the collision layer and object footprints (trees, palms, bushes: their trunk cell) blocked and a
 * band of one cell round them, and the minefields blocked. Cells within 3 of the start and 6 of the goal may lie in the band (zones touch props).
 * Used for a leg only when `ssg map route --clearance` finds none: the generator counts the clearance from the 3×3 and
 * 6×6 footprints of trees and bushes, not their trunk polygons, so in a thicket any clearance shuts every gap (FB-128).
 * Remove once the clearance is counted from the collision polygons.
 */
function clearRoute(tmj, leg) {
  if (!leg.length) return { m: Infinity, cells: [] };
  const { width: W, height: H, tileheight: th } = tmj;
  const layer = (k) => tmj.layers.find((l) => (l.class ?? l.name) === k)?.objects ?? [];
  const hard = new Uint8Array(W * H);
  const mark = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (hard[y * W + x] = 1);
  for (const o of layer('collision')) for (let y = Math.floor(o.y / th); y < Math.ceil((o.y + o.height) / th); y++) for (let x = Math.floor(o.x / th); x < Math.ceil((o.x + o.width) / th); x++) mark(x, y);
  for (const o of layer('objects')) {
    const p = Object.fromEntries((o.properties ?? []).map((q) => [q.name, q.value]));
    if (p.collision === undefined && p.footprintW === undefined) continue;
    const fw = Number(p.footprintW ?? 1);
    const fh = Number(p.footprintH ?? 1);
    const base = /tree|palm|pine|fern|bush/.test(String(p.sprite));
    const x0 = Math.round(o.x / th - (base ? 0.5 : fw / 2));
    const y0 = Math.round(o.y / th - (base ? 0.5 : fh / 2));
    for (let y = y0; y < y0 + (base ? 1 : fh); y++) for (let x = x0; x < x0 + (base ? 1 : fw); x++) mark(x, y);
  }
  // The minefields are blocked too (no band round them): the walk keeps out as the generator's guards do.
  const mined = new Uint8Array(W * H);
  for (const z of layer('zones')) {
    if (!(z.properties ?? []).some((q) => q.name === 'minefield' && q.value)) continue;
    const poly = (z.polygon ?? []).map((q) => [(z.x + q.x) / th, (z.y + q.y) / th]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = false;
      for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
        const [ax, ay] = poly[k];
        const [bx, by] = poly[j];
        if (ay > y + 0.5 !== by > y + 0.5 && x + 0.5 < ((bx - ax) * (y + 0.5 - ay)) / (by - ay) + ax) r = !r;
      }
      if (r) mined[y * W + x] = 1;
    }
  }
  const band = hard.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hard[y * W + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) band[(y + dy) * W + x + dx] = 1;
  const [sx, sy] = leg[0];
  const [gx, gy] = leg[leg.length - 1];
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !mined[y * W + x] && (!band[y * W + x] || (x === sx && y === sy) || (x === gx && y === gy) || (!hard[y * W + x] && ((Math.abs(x - sx) <= 3 && Math.abs(y - sy) <= 3) || (Math.abs(x - gx) <= 6 && Math.abs(y - gy) <= 6))));
  const g = new Float64Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  // Binary heap of [f, cell].
  const heap = [];
  const push = (f, c) => {
    heap.push([f, c]);
    for (let i = heap.length - 1; i > 0; ) {
      const pI = (i - 1) >> 1;
      if (heap[pI][0] <= heap[i][0]) break;
      [heap[pI], heap[i]] = [heap[i], heap[pI]];
      i = pI;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  g[sy * W + sx] = 0;
  push(0, sy * W + sx);
  while (heap.length) {
    const [f, c] = pop();
    const x = c % W;
    const y = (c - x) / W;
    if (f - Math.hypot(gx - x, gy - y) > g[c] + 1e-9) continue;
    if (x === gx && y === gy) {
      const cells = [];
      for (let k = c; k >= 0; k = from[k]) cells.push([k % W, Math.floor(k / W)]);
      return { m: g[c], cells: cells.reverse() };
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!free(nx, ny) || (dx && dy && (!free(x + dx, y) || !free(x, y + dy)))) continue;
      const ng = g[c] + (dx && dy ? Math.SQRT2 : 1);
      const n = ny * W + nx;
      if (ng < g[n]) {
        g[n] = ng;
        from[n] = c;
        push(ng + Math.hypot(gx - nx, gy - ny), n);
      }
    }
  }
  return { m: Infinity, cells: [] };
}
