// G6 balance: the shortest walkable route of each mission (drop → nearest pod on the way is ignored → objective →
// extraction) over the exported map, and what it takes at the Ranger's run and walk speeds.
//   node scripts/route-check.mjs [mission1 …] [--walk http://localhost:5296]
// --walk: the Ranger (unhurtable) then runs that route in the game, steered waypoint to waypoint with the keyboard
// state, through the game's own collision; it prints the mission clock it took and whether he got there.
// Blocked: the collision layer's cells and every object's footprint cells (props stop the Ranger). 8-way A* on cells.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/manifest.json'), 'utf8'));
const run = manifest.sprites.ranger.clipInfo.rifle_run.speedMps;
const walk = manifest.sprites.ranger.clipInfo.rifle_walk.speedMps;
const argv = process.argv.slice(2);
const walkUrl = argv.includes('--walk') ? argv[argv.indexOf('--walk') + 1] : null;
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--walk');
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
  const { width: W, height: H, tileheight: th } = tmj;
  const blocked = new Uint8Array(W * H);
  const layer = (k) => tmj.layers.find((l) => (l.class ?? l.name) === k)?.objects ?? [];
  for (const o of layer('collision')) for (let y = Math.floor(o.y / th); y < Math.ceil((o.y + o.height) / th); y++) for (let x = Math.floor(o.x / th); x < Math.ceil((o.x + o.width) / th); x++) blocked[y * W + x] = 1;
  for (const o of layer('objects')) {
    const p = props(o);
    const fw = Number(p.footprintW ?? 1);
    const fh = Number(p.footprintH ?? 1);
    // Trees block only their trunk (the game's collider is the base), the rest their footprint.
    const base = /tree|palm|pine|fern|bush/.test(String(p.sprite));
    const x0 = Math.round(o.x / th - (base ? 0.5 : fw / 2));
    const y0 = Math.round(o.y / th - (base ? 0.5 : fh / 2));
    for (let y = y0; y < y0 + (base ? 1 : fh); y++) for (let x = x0; x < x0 + (base ? 1 : fw); x++) if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 1;
  }
  // A cell of clearance around props for the A* route (the Ranger is 0.6 m wide; colliders aren't cell aligned).
  const hard = blocked.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hard[y * W + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) blocked[(y + dy) * W + x + dx] = 1;
  const zones = layer('zones');
  const centre = (z) => (z.width ? [Math.floor((z.x + z.width / 2) / th), Math.floor((z.y + z.height / 2) / th)] : [Math.floor(z.x / th), Math.floor(z.y / th)]);
  const drop = zones.find((z) => z.type === 'spawn' && props(z).team === 'ranger');
  // G8: a custom zone with `route` marks where the objective is really reached (the code book, the officer, the
  // P.O.W. camp's exit), when the objective zone's centre is inside a building or behind wire.
  const obj = zones.find((z) => z.type === 'custom' && props(z).route) ?? zones.find((z) => z.type === 'objective');
  const ex = zones.find((z) => z.type === 'extraction');
  const astar = ([sx, sy], [gx, gy]) => {
    // Start and goal may lie in the clearance band: they and the 3 cells around them count as free.
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (!blocked[y * W + x] || (Math.abs(x - sx) <= 3 && Math.abs(y - sy) <= 3 && !hard[y * W + x]) || (Math.abs(x - gx) <= 6 && Math.abs(y - gy) <= 6 && !hard[y * W + x]));
    // The goal may sit on a prop (a target): stop next to it.
    const g = new Float64Array(W * H).fill(Infinity);
    const from = new Int32Array(W * H).fill(-1);
    const open = [[0, sx, sy]];
    g[sy * W + sx] = 0;
    const trace = (x, y) => {
      const cells = [];
      for (let k = y * W + x; k >= 0; k = from[k]) cells.push([k % W, Math.floor(k / W)]);
      return cells.reverse();
    };
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, x, y] = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (Math.abs(x - gx) <= 6 && Math.abs(y - gy) <= 6) return { m: g[y * W + x], cells: trace(x, y) };
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!free(nx, ny) || (dx && dy && (!free(x + dx, y) || !free(x, y + dy)))) continue;
        const ng = g[y * W + x] + (dx && dy ? Math.SQRT2 : 1);
        if (ng < g[ny * W + nx]) {
          g[ny * W + nx] = ng;
          from[ny * W + nx] = y * W + x;
          open.push([ng + Math.hypot(gx - nx, gy - ny), nx, ny]);
        }
      }
    }
    return { m: Infinity, cells: [] };
  };
  // G8: an objective inside an enclosure (mission 10's stockade) names the cell to reach in `approach` ("x,y").
  const oc = props(obj).approach ? String(props(obj).approach).split(',').map((v) => Math.floor(Number(v))) : centre(obj);
  const ra = astar(centre(drop), oc);
  const rb = astar(oc, centre(ex));
  const a = ra.m;
  const b = rb.m;
  const total = a + b;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  console.log(`${name}: drop→objective ${a.toFixed(0)} m, objective→extraction ${b.toFixed(0)} m, total ${total.toFixed(0)} m · run ${mmss(total / run)} · walk ${mmss(total / walk)} · blocked ${blocked.reduce((s, v) => s + v, 0)} cells`);
  // G10: the G9 hazards along that route (the game's own numbers: src/enemies/mgnest.ts 18 m and ±65°, tanks.ts 22 m).
  // Mines on the route are a mistake (the shortest way must not need a minefield); nests and tanks may cover it, but
  // the drop→objective leg of a stealth mission (9) should stay out of their reach.
  const hz = hazards(tmj, th, ra.cells, rb.cells);
  if (hz.list.length) console.log(`  hazards: ${hz.list.join(' · ')}`);
  if (hz.mined) console.log(`  MINES ON THE ROUTE: ${hz.mined} cells`);
  if (process.env.ROUTE_DUMP) fs.writeFileSync(path.join(process.env.ROUTE_DUMP, `${name}.route.json`), JSON.stringify({ in: ra.cells, out: rb.cells }));
  if (browser) {
    // Every 4th cell of the route as a waypoint (cell centres).
    const way = [...ra.cells, ...rb.cells].filter((_, k, all) => k % 4 === 0 || k === all.length - 1).map(([x, y]) => [x + 0.5, y + 0.5]);
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`${walkUrl.replace(/\/$/, '')}/?scene=mission&mission=${name}`);
    await page.waitForFunction(() => window.game?.scene?.getScene('mission')?.ranger, null, { timeout: 180000 });
    const res = await page.evaluate(async (way) => {
      const m = window.game.scene.getScene('mission');
      m.god = true;
      // G8: objectives that fail when the Ranger is seen (missions 9, 12) would end the walk: nobody sees him.
      if (m.objective) m.sees = () => false;
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
        if (stuck > 300) return { reached: i, of: way.length, at: c, gameSeconds: t0 - m.timeLeft, stuck: true };
      }
      for (const key of ['W', 'A', 'S', 'D', 'SHIFT']) k[key].isDown = false;
      return { reached: i, of: way.length, gameSeconds: +(t0 - m.timeLeft).toFixed(1), unstick };
    }, way);
    console.log(`  walk: ${JSON.stringify(res)}`);
    await page.close();
  }
}
await browser?.close();

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
