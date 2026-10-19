import { props as propsOf } from '../assets';
import { screenToTile, tileToScreen, type Dir8 } from '../iso';
import { mods as difficultyMods, getDifficulty, type Difficulty, type DifficultyMods } from '../difficulty';
import { Pickup } from '../pickup';
import type { Cause, Placed, Pt } from '../scenes/Field';
import { Alerts } from './alerts';
import { EscortFire } from './escort';
import { zoneCells, zonesOf, type FieldHost } from './host';
import { MgNests } from './mgnest';
import { Mines } from './mines';
import { Sight } from './sight';
import { Tanks } from './tanks';
import { Trenches } from './trenches';

/**
 * The test field's G9 set (tile coordinates on its 40×40 field, the Ranger starting at (12, 12)): a machine-gun nest
 * covering the south-west, a few mines north-west of the start, a trench line and a tank on the south side.
 */
const TEST_FIELD = {
  nest: { i: 4, j: 25, dir: 'SW' as Dir8 },
  mines: [[8, 6], [9.5, 8], [7, 9], [10.5, 5]] as [number, number][],
  trench: [[2, 17], [13, 17]] as [number, number][],
  tank: [[25, 36], [36, 36]] as [number, number][],
};

/**
 * G9: enemies and difficulty, in one object the field scene owns (`Field.g9`). Field.ts and Mission.ts call it from a
 * few hooks marked `// G9`: create, update, the HUD, the Ranger's speed, enemy sight and aim, blasts and the
 * extraction. Everything else lives in src/enemies/*, src/pickup.ts and src/difficulty.ts.
 *
 * Map data (missions, from the generator map's zones and objects; maps/g6/<mission>/stage4.json):
 * - objects `mg_nest` (facing = the arc it covers) get a gunner;
 * - zones `custom` with `minefield` (`mines` = count) are mined;
 * - zones `custom` polyline with `trench` (`width` m) are trenches;
 * - zones `custom` polyline with `tank` (`speed` m/s) are tank routes.
 * The test field gets one of each (src/enemies/testfield.ts).
 */
export class G9 {
  readonly difficulty: Difficulty;
  readonly mods: DifficultyMods;
  readonly sight: Sight;
  readonly alerts: Alerts;
  readonly mines: Mines;
  readonly nests: MgNests;
  readonly tanks: Tanks;
  readonly trenches: Trenches;
  readonly pickup: Pickup;
  /** G10: fire at the officer, prisoners and hostages the Ranger leads out. */
  readonly escort: EscortFire;
  /** What changed with the difficulty (for the load check). */
  readonly adjust = { removed: 0, added: 0, pods: 0 };
  private cullTick = 0;

  constructor(private host: FieldHost) {
    // The test field plays at Normal; missions at the chosen difficulty.
    this.difficulty = host.tmj ? getDifficulty() : 'normal';
    this.mods = difficultyMods(this.difficulty);
    if (host.tmj) this.applyDifficulty();
    this.sight = new Sight(host);
    this.alerts = new Alerts(host, this.mods);
    this.mines = new Mines(host);
    this.nests = new MgNests(host, this);
    this.tanks = new Tanks(host, this);
    this.trenches = new Trenches(host);
    this.pickup = new Pickup(host, this);
    this.escort = new EscortFire(host, this);
    if (host.tmj) this.fromMap();
    else this.testField(TEST_FIELD);
    this.nests.manAll();
  }

  /** Mines, trenches and tanks from the map's zones. */
  private fromMap() {
    for (const z of zonesOf(this.host)) {
      if (z.type !== 'custom') continue;
      const p = propsOf(z);
      const cells = zoneCells(this.host, z);
      if (p.minefield) this.mines.addField(cells, Number(p.mines ?? 8), `${this.host.cfg?.map}:${z.id}:${z.name}`);
      if (p.trench && cells.length > 1) this.trenches.add(cells, Number(p.width ?? 1.6));
      if (p.tank && cells.length > 1) this.tanks.spawn(cells, Number(p.speed ?? 2));
    }
  }

  /** Difficulty on a mission map: fewer or more soldiers, fuller or emptier pods. */
  private applyDifficulty() {
    const h = this.host;
    const f = this.mods.enemies;
    const n = h.enemies.length;
    if (f < 1) {
      // Every k-th soldier stays home.
      const drop = Math.round(n * (1 - f));
      const gone = new Set<number>();
      for (let k = 0; k < drop; k++) gone.add(Math.floor(((k + 0.5) * n) / drop));
      h.enemies = h.enemies.filter((e, i) => {
        if (!gone.has(i)) return true;
        e.sprite.destroy();
        return false;
      });
      this.adjust.removed = n - h.enemies.length;
    } else if (f > 1) {
      // A second man on some patrols (half a loop behind), or beside a guard.
      const add = Math.round(n * (f - 1));
      const base = h.enemies.slice();
      for (let k = 0; k < add; k++) {
        const e = base[Math.floor(((k + 0.5) * base.length) / add)];
        const cells = e.path.map((q) => {
          const c = screenToTile(q.x, q.y);
          return [c.i, c.j] as [number, number];
        });
        const dir = (['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as Dir8[])[((Math.round(e.angle / (Math.PI / 4)) % 8) + 8) % 8];
        if (cells.length > 1) h.spawnEnemy(cells, dir, (e.next + Math.floor(cells.length / 2)) % cells.length);
        else h.spawnEnemy([[cells[0][0] + 1.2, cells[0][1] - 1.2]], dir);
      }
      this.adjust.added = h.enemies.length - n;
    }
    for (const pod of h.pods ?? []) {
      for (const k of Object.keys(pod.contents) as (keyof typeof pod.contents)[]) {
        const v = pod.contents[k];
        if (v > 0) pod.contents[k] = Math.max(1, Math.round(v * this.mods.pods));
      }
      this.adjust.pods++;
    }
  }

  update(dt: number) {
    this.trenches.update();
    this.alerts.update(dt);
    this.mines.update();
    this.nests.update(dt);
    this.tanks.update(dt);
    this.pickup.update(dt);
    this.escort.update(dt);
    if (this.cullTick++ % 3 === 0) this.nests.cull(this.host.cameras.main.worldView);
  }

  // ---- hooks called from Field ----

  /** Multiplier on the enemy view range: light (dusk, night), trench, difficulty. */
  viewScale() {
    return this.sight.light * this.trenches.sight * this.mods.sight;
  }

  /** Multiplier on enemy hit chance: difficulty and the trench's cover. */
  hitScale() {
    return this.mods.accuracy * this.trenches.cover;
  }

  /** Multiplier on the Ranger's ground speed (slower in a trench). */
  speedScale() {
    return this.trenches.speed;
  }

  /** Is this point of a look hidden by a canopy? */
  blocksSight(q: Pt, t: number, d: number) {
    return this.sight.blocks(q, t, d);
  }

  /** A blast (Field.explode): armour on tanks, mines set off. */
  onBlast(w: Pt, radius: number, cause: Cause, direct?: Placed) {
    this.tanks.onBlast(w, radius, cause, direct);
    this.mines.onBlast(w, radius);
  }

  /** Extra HUD words: alarm, trench, the plane. */
  hud() {
    const parts = [this.alerts.alarm ? 'ALARM' : '', this.trenches.inside ? 'IN TRENCH' : '', this.pickup.hud()].filter(Boolean);
    return parts.length ? `   ${parts.join('   ')}` : '';
  }

  /** Mission's extraction: true once the plane has picked the Ranger up. */
  pickedUp() {
    return this.pickup.done;
  }

  // ---- the test field ----

  /** The test field's G9 set (TEST_FIELD). */
  testField(layout: { nest?: { i: number; j: number; dir: Dir8 }; mines?: [number, number][]; trench?: [number, number][]; tank?: [number, number][] }) {
    const h = this.host;
    if (layout.nest) {
      const d = h.manifest.sprites.mg_nest?.object?.directions.find((x) => x.name === layout.nest!.dir);
      if (d) {
        const at = tileToScreen(layout.nest.i - 0.5 + d.tiles.u / 2, layout.nest.j - 0.5 + d.tiles.v / 2);
        const p = h.placeObject('mg_nest', layout.nest.dir, at, { hp: 150 });
        if (p) this.nests.man(p);
      }
    }
    for (const [i, j] of layout.mines ?? []) this.mines.add(tileToScreen(i, j));
    if (layout.trench) this.trenches.add(layout.trench, 1.6);
    if (layout.tank) this.tanks.spawn(layout.tank, 1.5);
  }
}
