import Phaser from 'phaser';
import { animKey, props, type TiledMap, type TiledObject } from '../assets';
import { tileToScreen, screenToTile, type Dir8 } from '../iso';
import { Field, type Placed, type Pt } from './Field';
import { missionByKey, type MissionConfig } from '../missions';

/**
 * A mission built only from a generator map (`ssg map export --embed`, see scripts/build-maps.mjs and
 * maps/mission1.ops.json): the ground and decoration tile layers, objects from the object layer (sprite name, state,
 * facing, custom properties), blocked cells from the collision layer, and zones: the drop zone (spawn, team ranger),
 * guard spawns, patrol polylines, the objective and the extraction zone, supply pods (custom zones with `pod`).
 *
 * Coordinates: the map's cell coordinates (x down-right, y down-left, (2.5, 3.5) = centre of cell (2, 3)) are the
 * iso `tileToScreen` input here, so the map's top corner is the world origin. A Tiled object's (x, y) is in
 * `tileheight` pixels per cell on both axes.
 */

const START_GRENADES = 6;
const POD_RADIUS = 1.2; // metres

interface Pod {
  sprite: Phaser.GameObjects.Sprite;
  at: Pt;
  grenades: number;
  taken: boolean;
}

/** A zone as a polygon in cell coordinates. */
type Area = [number, number][];

export class Mission extends Field {
  /** The mission being played (src/missions.ts), from the scene data or ?mission=. */
  protected cfg: MissionConfig = missionByKey(null);
  protected mapName = 'mission1';
  private started = false;
  protected tmj!: TiledMap;
  protected mapW = 0;
  protected mapH = 0;
  protected blocked = new Set<number>();
  protected targets: Placed[] = [];
  protected pods: Pod[] = [];
  protected dropArea: Area = [];
  protected objectiveArea: Area = [];
  protected extractArea: Area = [];
  protected extractMarker?: Phaser.GameObjects.Graphics;
  protected timeLeft = 0;
  protected objectiveDone = false;
  /** 'accomplished' | 'failed' once the mission is over. */
  outcome: string | null = null;
  /** For scripts/load-check.mjs: how the map turned into the scene. */
  report = { tiles: 0, objects: 0, missingSprites: [] as string[], blockedCells: 0, enemies: 0, pods: 0, targets: 0 };

  constructor() {
    super('mission');
  }

  init(data: { mission?: string }) {
    // A restart (R after dying) keeps the mission being played.
    const key = data?.mission ?? (this.started ? this.cfg.map : new URLSearchParams(window.location.search).get('mission'));
    this.started = true;
    this.cfg = missionByKey(key);
    this.mapName = this.cfg.map;
  }

  create() {
    this.targets = [];
    this.pods = [];
    this.blocked = new Set();
    this.timeLeft = this.cfg.seconds;
    this.objectiveDone = false;
    this.outcome = null;
    this.grenadesLeft = START_GRENADES;
    this.report = { tiles: 0, objects: 0, missingSprites: [], blockedCells: 0, enemies: 0, pods: 0, targets: 0 };
    super.create();
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.outcome) this.scene.start('title');
    });
  }

  /** Cell coordinates of a Tiled object position (pixels of `tileheight` per cell). */
  protected cell(x: number, y: number): [number, number] {
    return [x / this.tmj.tileheight, y / this.tmj.tileheight];
  }

  protected buildWorld(): Pt | null {
    const tmj = this.cache.json.get(`tmj:${this.mapName}`) as TiledMap | undefined;
    if (!tmj) {
      this.add.text(20, 60, `No map ${this.mapName}: run \`npm run assets\``, { fontFamily: 'monospace', fontSize: '16px', color: '#ff8080' }).setScrollFactor(0);
      return null;
    }
    this.tmj = tmj;
    this.mapW = tmj.width;
    this.mapH = tmj.height;
    this.drawTiles();

    for (const l of tmj.layers) {
      if (l.type !== 'objectgroup') continue;
      const kind = l.class ?? l.name;
      if (kind === 'collision') for (const o of l.objects ?? []) this.addBlocked(o);
      if (kind === 'objects') for (const o of l.objects ?? []) this.addObject(o);
    }
    this.report.blockedCells = this.blocked.size;

    const zones = tmj.layers.find((l) => (l.class ?? l.name) === 'zones')?.objects ?? [];
    const drop = zones.find((z) => z.type === 'spawn' && props(z).team === 'ranger') ?? zones.find((z) => z.type === 'spawn');
    this.dropArea = drop ? this.area(drop) : [[1, 1], [2, 1], [2, 2], [1, 2]];
    this.objectiveArea = this.area(zones.find((z) => z.type === 'objective') ?? drop!);
    const ex = zones.find((z) => z.type === 'extraction');
    this.extractArea = ex ? this.area(ex) : [];
    for (const z of zones) if (z.type === 'custom' && props(z).pod) this.addPod(z);
    this.drawExtraction();
    this.report.pods = this.pods.length;
    this.report.targets = this.targets.length;

    // The Ranger lands in the middle of the drop zone.
    const c = centroid(this.dropArea);
    return tileToScreen(c[0], c[1]);
  }

  /** The tile layers through Phaser's Tiled parser (the tilesets are embedded in the .tmj). */
  protected drawTiles() {
    const key = `map:${this.mapName}`;
    this.cache.tilemap.remove(key);
    this.cache.tilemap.add(key, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: this.tmj });
    const map = this.make.tilemap({ key });
    const sets = this.tmj.tilesets
      .map((ts) => map.addTilesetImage(ts.name, `map-img:${this.mapName}:${ts.name}`))
      .filter((t): t is Phaser.Tilemaps.Tileset => !!t);
    for (const l of this.tmj.layers) {
      if (l.type !== 'tilelayer') continue;
      // The generator's README: create the layer at x = (rows − 1) · tileWidth / 2 to match its picture, whose left
      // edge is the map's left corner. Here the world origin is the map's top corner, rows · tileWidth / 2 to the
      // right of that edge, so the layer goes at −tileWidth / 2: tile (i, j)'s diamond centre lands on
      // tileToScreen(i + 0.5, j + 0.5).
      const layer = map.createLayer(l.name, sets, -this.tmj.tilewidth / 2, 0);
      if (!layer) continue;
      layer.setDepth(-1e9 + (l.name === 'ground' ? 0 : 1));
      layer.setSkipCull(true);
      this.report.tiles += (l.data ?? []).filter((g) => g > 0).length;
    }
  }

  /** A collision rectangle (Tiled pixels) → blocked cells. */
  protected addBlocked(o: TiledObject) {
    const [x0, y0] = this.cell(o.x, o.y);
    const [w, h] = this.cell(o.width, o.height);
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) this.blocked.add(y * this.mapW + x);
  }

  /**
   * A placed object. The generator writes each one self-describing (FB-039 verified): `sprite` (its name here and in
   * the manifest), `facing`, `state`, and `collision`, the ground polygon of that state and facing in Tiled pixels
   * around the anchor (the footprint centre, which is the object's position).
   */
  protected addObject(o: TiledObject) {
    const p = props(o);
    const name = String(p.sprite ?? o.name);
    const [cx, cy] = this.cell(o.x, o.y);
    const target = p.target === true;
    const th = this.tmj.tileheight;
    // Tiled iso pixels (tileheight per cell on both axes) → screen pixels.
    const collision = typeof p.collision === 'string' ? (JSON.parse(p.collision) as [number, number][]).map(([x, y]) => [((x - y) / th) * (this.tmj.tilewidth / 2), ((x + y) / th) * (this.tmj.tileheight / 2)] as [number, number]) : undefined;
    const placed = this.placeObject(name, String(p.facing) as Dir8, tileToScreen(cx, cy), { hp: target ? Number(p.hp ?? 100) : undefined, state: String(p.state), collision });
    if (!placed) {
      if (!this.report.missingSprites.includes(name)) this.report.missingSprites.push(name);
      return;
    }
    this.report.objects++;
    if (target) this.targets.push(placed);
  }

  /** A zone's outline in cell coordinates (a point becomes a 1 m square around it). */
  protected area(z: TiledObject): Area {
    const [x, y] = this.cell(z.x, z.y);
    if (z.polygon) return z.polygon.map((q) => [x + q.x / this.tmj.tileheight, y + q.y / this.tmj.tileheight]);
    if (z.point || (!z.width && !z.height)) return [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]];
    const [w, h] = this.cell(z.width, z.height);
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }

  protected spawnEnemies() {
    const zones = this.tmj.layers.find((l) => (l.class ?? l.name) === 'zones')?.objects ?? [];
    for (const z of zones) {
      const p = props(z);
      if (p.team === 'ranger') continue;
      const [x, y] = this.cell(z.x, z.y);
      const facing = (typeof p.facing === 'string' ? p.facing : 'SW') as Dir8;
      if (z.type === 'spawn') {
        this.spawnEnemy([[x, y]], facing);
      } else if (z.type === 'patrol' && z.polyline?.length) {
        let pts = z.polyline.map((q): [number, number] => [x + q.x / this.tmj.tileheight, y + q.y / this.tmj.tileheight]);
        const closed = pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)![0], pts[0][1] - pts.at(-1)![1]) < 0.01;
        if (closed) pts = pts.slice(0, -1);
        // An open patrol walks there and back.
        else if (p.loop !== true) pts = [...pts, ...pts.slice(1, -1).reverse()];
        const n = Math.max(1, Number(p.count ?? 1));
        for (let k = 0; k < n; k++) this.spawnEnemy(pts, facing, Math.floor((k * pts.length) / n));
      }
    }
    this.report.enemies = this.enemies.length;
  }

  /** A supply pod: the crate sprite, tinted, no collider; walking over it restocks grenades. */
  protected addPod(z: TiledObject) {
    const [x, y] = this.cell(z.x, z.y);
    const at = tileToScreen(x, y);
    const s = this.manifest.sprites.crate;
    const spr = this.add.sprite(at.x, at.y, 'crate');
    if (s && this.anims.exists(animKey(s, s.clips[0], 'SE'))) spr.play(animKey(s, s.clips[0], 'SE'));
    spr.setTint(0xe0c060).setScale(0.8).setDepth(at.y);
    this.tweens.add({ targets: spr, y: at.y - 6, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
    this.pods.push({ sprite: spr, at, grenades: Number(props(z).grenades ?? 3), taken: false });
  }

  /** The extraction zone's outline on the ground, brighter once the depot is destroyed. */
  protected drawExtraction() {
    if (!this.extractArea.length) return;
    const g = this.add.graphics().setDepth(-1e8);
    const pts = this.extractArea.map(([x, y]) => tileToScreen(x, y));
    g.lineStyle(2, 0xff80c0, 1).strokePoints(pts.map((q) => new Phaser.Math.Vector2(q.x, q.y)), true);
    g.setAlpha(0.35);
    this.extractMarker = g;
  }

  protected worldBounds() {
    const tw = this.tmj?.tilewidth ?? 64;
    return new Phaser.Geom.Rectangle((-this.mapH * tw) / 2 - 64, -600, ((this.mapW + this.mapH) * tw) / 2 + 128, ((this.mapW + this.mapH) * tw) / 4 + 680);
  }

  /** On the map and not on a blocked cell (water). */
  protected canStand(x: number, y: number) {
    const { i, j } = screenToTile(x, y);
    if (i < 0.3 || j < 0.3 || i > this.mapW - 0.3 || j > this.mapH - 0.3) return false;
    return !this.blocked.has(Math.floor(j) * this.mapW + Math.floor(i));
  }

  /** The Ranger's position in map cells (for the load check). */
  rangerCell() {
    const { i, j } = screenToTile(this.ranger.x, this.ranger.y);
    return { x: i, y: j };
  }

  protected hudLine() {
    const alert = this.enemies.some((e) => e.state === 'alert');
    const done = this.targets.filter((t) => (t.hp ?? 0) <= 0).length;
    const t = Math.max(0, Math.ceil(this.timeLeft));
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const goal = this.objectiveDone ? this.cfg.done : `${this.cfg.goal} (${done}/${this.targets.length})`;
    return `MISSION ${this.cfg.number} · ${clock}   HP ${this.hp}${alert ? '  ALERT' : ''}   ${goal}`;
  }

  update(t: number, dtMs: number) {
    if (!this.ranger || this.outcome) return;
    super.update(t, dtMs);
    const dt = dtMs / 1000;
    this.timeLeft -= dt;
    // Supply pods.
    for (const p of this.pods) {
      if (p.taken || Phaser.Math.Distance.Between(p.at.x, p.at.y / 0.5, this.ranger.x, this.ranger.y / 0.5) > POD_RADIUS * this.ppm) continue;
      p.taken = true;
      this.grenadesLeft += p.grenades;
      this.tweens.killTweensOf(p.sprite);
      this.tweens.add({ targets: p.sprite, alpha: 0, y: p.sprite.y - 30, duration: 400, onComplete: () => p.sprite.destroy() });
    }
    if (!this.objectiveDone && this.targets.length && this.targets.every((x) => (x.hp ?? 0) <= 0)) {
      this.objectiveDone = true;
      this.extractMarker?.setAlpha(1);
      if (this.extractMarker) this.tweens.add({ targets: this.extractMarker, alpha: 0.4, yoyo: true, repeat: -1, duration: 500 });
    }
    const c = this.rangerCell();
    if (this.objectiveDone && !this.dead && inPolygon([c.x, c.y], this.extractArea)) this.finish('accomplished');
    else if (this.timeLeft <= 0) this.finish('failed');
  }

  /** The end screen. */
  protected finish(outcome: 'accomplished' | 'failed') {
    this.outcome = outcome;
    this.busy = true;
    const { width, height } = this.scale;
    const ok = outcome === 'accomplished';
    const kills = this.enemies.filter((e) => e.state === 'dead').length;
    const used = this.cfg.seconds - Math.max(0, this.timeLeft);
    this.add.rectangle(width / 2, height / 2, width, height, 0x10140c, 0.8).setScrollFactor(0).setDepth(1e9);
    this.add
      .text(
        width / 2,
        height / 2,
        `${ok ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}\n\n` +
          `${ok ? this.cfg.success : 'The plane left without you.'}\n` +
          `time ${Math.floor(used / 60)}:${String(Math.floor(used % 60)).padStart(2, '0')} · enemies ${kills}/${this.enemies.length} · grenades thrown ${this.grenadesThrown}\n\n` +
          'press Enter for the title',
        { fontFamily: 'monospace', fontSize: '22px', color: ok ? '#e8d27a' : '#ff7060', align: 'center' },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1e9 + 1);
  }
}

function centroid(a: Area): [number, number] {
  return [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
}

function inPolygon([x, y]: [number, number], poly: Area) {
  let inside = false;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const [ax, ay] = poly[k];
    const [bx, by] = poly[m];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
