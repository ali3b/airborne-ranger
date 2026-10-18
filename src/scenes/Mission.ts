import Phaser from 'phaser';
import { isTouch } from '../touch';
import { animKey, props, type TiledMap, type TiledObject } from '../assets';
import { tileToScreen, screenToTile, dirFromWorld, screenToWorldDelta, worldToScreenDelta, type Dir8 } from '../iso';
import { Field, circleHitsPolygon, distW, RANGER_RADIUS, type Placed, type Pt } from './Field';
import { isoCull } from '../world';
import { Overview } from '../overview';
import { missionByKey, type MissionConfig } from '../missions';
import { award, selected, type Award, type MissionResult } from '../roster';
import { sfx } from '../sound';

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
/** G6: vehicles this far from the Ranger stop driving until he comes nearer. */
const VEHICLE_SLEEP = 45; // metres

interface Pod {
  sprite: Phaser.GameObjects.Sprite;
  at: Pt;
  grenades: number;
  taken: boolean;
}

/**
 * An enemy vehicle driving a patrol path (G5): the `drive` sprite (8 directions, its own hull collision per
 * direction) while it moves; when a blast destroys it the `wreck` sprite's `intact_to_destroyed` plays in the same
 * facing. Both sprites are the same model, so their anchors per direction match. // FB-056: one sprite can't hold both a
 * looping drive and object states, hence the pair.
 */
interface Vehicle {
  placed: Placed;
  drive: string;
  path: Pt[];
  next: number;
  speed: number;
  /** Seconds the vehicle has been held up by the Ranger in its way. */
  blocked: number;
}

/** A zone as a polygon in cell coordinates. */
type Area = [number, number][];

export class Mission extends Field {
  private finishedAt = 0;
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
  protected vehicles: Vehicle[] = [];
  protected timeLeft = 0;
  protected objectiveDone = false;
  /** 'accomplished' | 'failed' | 'kia' once the mission is over. */
  outcome: MissionResult['outcome'] | null = null;
  /** The Ranger on the roster playing this mission (null: a guest, see Title). */
  protected rangerId: string | null = null;
  /** Mission seconds at the first alert / when the objective was done (for the merit). */
  protected alertAt: number | null = null;
  protected objectiveAt: number | null = null;
  /** The debriefing's data, set when the mission ends. */
  result: MissionResult | null = null;
  award: Award | null = null;
  /** For scripts/load-check.mjs: how the map turned into the scene. */
  report = { tiles: 0, objects: 0, missingSprites: [] as string[], blockedCells: 0, enemies: 0, pods: 0, targets: 0, vehicles: 0, animatedProps: 0 };

  constructor() {
    super('mission');
  }

  /** The overview map (Tab / O / the MAP button), while open the action pauses and the clock runs. */
  protected overview?: Overview;
  protected compass?: Phaser.GameObjects.Graphics;
  protected compassText?: Phaser.GameObjects.Text;

  protected mapsToLoad() {
    return [this.mapName];
  }

  init(data: { mission?: string; ranger?: string }) {
    const key = data?.mission ?? (this.started ? this.cfg.map : new URLSearchParams(window.location.search).get('mission'));
    this.started = true;
    this.rangerId = data?.ranger ?? selected.get();
    this.cfg = missionByKey(key);
    this.mapName = this.cfg.map;
  }

  create() {
    this.targets = [];
    this.pods = [];
    this.vehicles = [];
    this.blocked = new Set();
    this.timeLeft = this.cfg.seconds;
    this.objectiveDone = false;
    this.outcome = null;
    this.result = null;
    this.award = null;
    this.alertAt = null;
    this.objectiveAt = null;
    this.restartOnR = false;
    this.grenadesLeft = START_GRENADES;
    this.report = { tiles: 0, objects: 0, missingSprites: [], blockedCells: 0, enemies: 0, pods: 0, targets: 0, vehicles: 0, animatedProps: 0 };
    super.create();
    if (this.cfg.dusk && this.ranger) this.dusk();
    if (this.ranger) {
      this.overview = new Overview(this, this.tmj, this.mapName);
      const kb = this.input.keyboard!;
      kb.addKey('TAB').on('down', () => this.toggleMap());
      kb.addKey('O').on('down', () => this.toggleMap());
      this.compass = this.add.graphics().setScrollFactor(0).setDepth(1e9);
      this.compassText = this.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e8d27a', backgroundColor: '#10140ccc', padding: { x: 4, y: 2 } })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(1e9);
    }
    this.input.keyboard?.on('keydown-ENTER', () => this.toDebrief());
    // A tap continues too, once the end screen has been up a moment (not the tap that was firing).
    this.input.on('pointerdown', () => this.time.now - this.finishedAt > 1000 && this.toDebrief());
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
      // An empty layer (the decoration layer, usually) isn't drawn at all.
      if (!(l.data ?? []).some((g) => g > 0)) continue;
      // The generator's README: create the layer at x = (rows − 1) · tileWidth / 2 to match its picture, whose left
      // edge is the map's left corner. Here the world origin is the map's top corner, rows · tileWidth / 2 to the
      // right of that edge, so the layer goes at −tileWidth / 2: tile (i, j)'s diamond centre lands on
      // tileToScreen(i + 0.5, j + 0.5).
      const layer = map.createLayer(l.name, sets, -this.tmj.tilewidth / 2, 0);
      if (!layer) continue;
      layer.setDepth(-1e9 + (l.name === 'ground' ? 0 : 1));
      // G6: only the tiles under the camera (Phaser's own iso cull tests all 32 768 tiles of a layer every frame).
      isoCull(layer);
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
    // Looping prop animations (searchlight sweep, radar spin) come from the sprite's own template.
    const anim = placed.sprite.anims.currentAnim;
    if (anim && anim.frames.length > 1 && anim.repeat === -1) this.report.animatedProps++;
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
      // FB-059: a vehicle route is a patrol zone with the game's own `vehicle` / `wreck` / `speed` properties.
      if (z.type === 'patrol' && typeof p.vehicle === 'string' && z.polyline?.length) {
        const pts = z.polyline.map((q): [number, number] => [x + q.x / this.tmj.tileheight, y + q.y / this.tmj.tileheight]);
        this.spawnVehicle(p.vehicle, String(p.wreck ?? p.vehicle), pts, Number(p.speed ?? 3), Number(p.hp ?? 100));
        continue;
      }
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
    this.report.vehicles = this.vehicles.length;
  }

  /**
   * A vehicle on a path (cell coordinates), driven there and back. Its collider is the drive sprite's hull for the
   * current direction, so bullets stop on it, the Ranger can't walk through it and a grenade damages it.
   */
  protected spawnVehicle(drive: string, wreck: string, cells: [number, number][], speed: number, hp: number) {
    const s = this.manifest.sprites[drive];
    if (!s?.object || !this.manifest.sprites[wreck]) {
      if (!this.report.missingSprites.includes(drive)) this.report.missingSprites.push(drive);
      return;
    }
    const path = [...cells, ...cells.slice(1, -1).reverse()].map(([i, j]) => tileToScreen(i, j));
    const w = screenToWorldDelta(path[1].x - path[0].x, path[1].y - path[0].y, this.ppm);
    const dir = dirFromWorld(w.x, w.y);
    const d = s.object.directions.find((x) => x.name === dir) ?? s.object.directions[0];
    const spr = this.add.sprite(path[0].x, path[0].y, drive);
    const placed: Placed = { sprite: spr, name: wreck, dir: d.name as Dir8, at: { ...path[0] }, anchor: d.anchor, world: [], screen: [], minX: 0, maxX: 0, hp, state: 'intact' };
    spr.play(animKey(s, s.clips[0], placed.dir));
    this.setCollision(placed, d.polygon);
    spr.setDepth(placed.at.y);
    this.props.push(placed);
    this.vehicles.push({ placed, drive, path, next: 1, speed, blocked: 0 });
  }

  protected updateVehicles(dt: number) {
    const rw = this.worldOf(this.ranger);
    for (const v of this.vehicles) {
      const p = v.placed;
      if (p.state !== 'intact') continue;
      if (distW(this.worldOf(p.at), rw) > VEHICLE_SLEEP) continue;
      const goal = v.path[v.next];
      const w = screenToWorldDelta(goal.x - p.at.x, goal.y - p.at.y, this.ppm);
      const dist = Math.hypot(w.x, w.y);
      if (dist < 0.15) {
        v.next = (v.next + 1) % v.path.length;
        continue;
      }
      const dir = dirFromWorld(w.x, w.y);
      const s = this.manifest.sprites[v.drive];
      const d = s.object!.directions.find((x) => x.name === dir) ?? s.object!.directions[0];
      const step = Math.min(dist, v.speed * dt);
      const sd = worldToScreenDelta((w.x / dist) * step, (w.y / dist) * step, this.ppm);
      const before = { at: { ...p.at }, dir: p.dir, anchor: p.anchor };
      p.at = { x: p.at.x + sd.x, y: p.at.y + sd.y };
      p.dir = dir;
      p.anchor = d.anchor;
      this.setCollision(p, d.polygon);
      // The Ranger in the way: the truck waits (and he takes a knock if he stays right against it).
      if (this.ranger && !this.dead && circleHitsPolygon(this.worldOf(this.ranger), RANGER_RADIUS, p.world)) {
        p.at = before.at;
        p.dir = before.dir;
        p.anchor = before.anchor;
        const back = s.object!.directions.find((x) => x.name === p.dir) ?? d;
        this.setCollision(p, back.polygon);
        p.sprite.anims.pause();
        if ((v.blocked += dt) > 1.5) {
          v.blocked = 0;
          this.hurtRanger(20);
        }
        continue;
      }
      v.blocked = 0;
      p.sprite.setPosition(p.at.x, p.at.y).setDepth(p.at.y);
      const key = animKey(s, s.clips[0], p.dir);
      if (p.sprite.anims.currentAnim?.key !== key) p.sprite.play(key);
      else if (p.sprite.anims.isPaused) p.sprite.anims.resume();
    }
  }

  /** At dusk, additive effects (fire, explosions) glow over the wash instead of being dimmed blue by it. */
  protected fx(name: string, at: Pt, depth: number, opts: { scale?: number; once?: boolean } = {}) {
    const spr = super.fx(name, at, depth, opts);
    if (spr && this.cfg.dusk && spr.blendMode === Phaser.BlendModes.ADD) spr.setDepth(9e8 + 2 + depth / 1e6);
    return spr;
  }

  /** Dusk: the world under a blue multiply wash, the HUD stays bright (FB-060). */
  protected dusk() {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width * 2, height * 2, 0x6a74a8).setBlendMode(Phaser.BlendModes.MULTIPLY).setScrollFactor(0).setDepth(9e8);
    // Searchlights: a soft additive glow in front of each lamp.
    for (const p of this.props) {
      if (p.name !== 'searchlight') continue;
      const glow = this.add.ellipse(p.at.x + 30, p.at.y + 20, 150, 70, 0xfff2c0, 0.22).setBlendMode(Phaser.BlendModes.ADD).setDepth(9e8 + 1);
      this.tweens.add({ targets: glow, x: p.at.x - 30, yoyo: true, repeat: -1, duration: 2000, ease: 'Sine.inOut' });
    }
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
    return `MISSION ${this.cfg.number} · ${clock}   HP ${this.hp}${alert ? '  ALERT' : ''}   ${goal}${isTouch ? '' : '   Tab map'}`;
  }

  /** Open or close the overview map. While it's open the action pauses (the mission clock runs on). */
  toggleMap() {
    if (!this.overview || this.outcome || this.dead) return;
    if (this.overview.isOpen) {
      this.overview.close();
      this.anims.resumeAll();
      this.busy = this.busyBeforeMap;
      return;
    }
    this.busyBeforeMap = this.busy;
    this.busy = true;
    this.anims.pauseAll();
    const c = this.rangerCell();
    this.overview.open({
      ranger: [c.x, c.y],
      facing: this.facing,
      objective: this.objectiveArea,
      objectiveDone: this.objectiveDone,
      extraction: this.extractArea,
      drop: this.dropArea,
      pods: this.pods.filter((p) => !p.taken).map((p) => {
        const q = screenToTile(p.at.x, p.at.y);
        return [q.i, q.j] as [number, number];
      }),
      title: `MISSION ${this.cfg.number} · ${this.cfg.title}`,
    });
  }
  private busyBeforeMap = false;

  /** Where the Ranger should head now: the objective, then the extraction zone (cell coordinates). */
  protected goalCell(): [number, number] | null {
    const a = this.objectiveDone ? this.extractArea : this.objectiveArea;
    return a.length ? centroid(a) : null;
  }

  /** The HUD compass: north up (screen up is world north in iso8), an arrow to the goal and its distance. */
  protected drawCompass() {
    const g = this.compass;
    const goal = this.goalCell();
    if (!g || !this.compassText || !goal) return;
    const cx = 34;
    const cy = this.hud.y + this.hud.height + 34;
    g.clear();
    g.fillStyle(0x10140c, 0.8).fillCircle(cx, cy, 24);
    g.lineStyle(1, 0xe8d27a, 0.7).strokeCircle(cx, cy, 24);
    // North tick.
    g.fillStyle(0xe8d27a, 0.8).fillTriangle(cx, cy - 23, cx - 4, cy - 15, cx + 4, cy - 15);
    const at = tileToScreen(goal[0], goal[1]);
    const a = Math.atan2(at.y - this.ranger.y, at.x - this.ranger.x);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const col = this.objectiveDone ? 0xff80c0 : 0xffd040;
    g.fillStyle(col, 1).fillTriangle(cx + dx * 20, cy + dy * 20, cx - dx * 6 - dy * 7, cy - dy * 6 + dx * 7, cx - dx * 6 + dy * 7, cy - dy * 6 - dx * 7);
    const w = screenToWorldDelta(at.x - this.ranger.x, at.y - this.ranger.y, this.ppm);
    const m = Math.round(Math.hypot(w.x, w.y) / 5) * 5;
    this.compassText.setPosition(cx + 30, cy).setText(`${this.objectiveDone ? 'EXTRACTION' : 'OBJECTIVE'} ${m} m`).setColor(this.objectiveDone ? '#ff80c0' : '#ffd040');
  }

  update(t: number, dtMs: number) {
    if (!this.ranger || this.outcome) return;
    const dt = dtMs / 1000;
    if (this.overview?.isOpen) {
      this.timeLeft -= dt;
      this.hud.setText(`${this.hudLine()}\nMAP: Tab / O${isTouch ? ' / MAP' : ''} to return`);
      if (this.timeLeft <= 0) {
        this.toggleMap();
        this.finish('failed');
      }
      return;
    }
    super.update(t, dtMs);
    this.drawCompass();
    this.updateVehicles(dt);
    this.timeLeft -= dt;
    // Supply pods.
    for (const p of this.pods) {
      if (p.taken || Phaser.Math.Distance.Between(p.at.x, p.at.y / 0.5, this.ranger.x, this.ranger.y / 0.5) > POD_RADIUS * this.ppm) continue;
      p.taken = true;
      this.grenadesLeft += p.grenades;
      sfx.pickup();
      this.tweens.killTweensOf(p.sprite);
      this.tweens.add({ targets: p.sprite, alpha: 0, y: p.sprite.y - 30, duration: 400, onComplete: () => p.sprite.destroy() });
    }
    const elapsed = this.cfg.seconds - this.timeLeft;
    if (this.alertAt === null && this.enemies.some((e) => e.state === 'alert')) {
      this.alertAt = elapsed;
      sfx.alert();
    }
    if (!this.objectiveDone && this.targets.length && this.targets.every((x) => (x.hp ?? 0) <= 0)) {
      this.objectiveDone = true;
      this.objectiveAt = elapsed;
      this.extractMarker?.setAlpha(1);
      if (this.extractMarker) this.tweens.add({ targets: this.extractMarker, alpha: 0.4, yoyo: true, repeat: -1, duration: 500 });
    }
    const c = this.rangerCell();
    if (this.objectiveDone && !this.dead && inPolygon([c.x, c.y], this.extractArea)) this.finish('accomplished');
    else if (this.timeLeft <= 0) this.finish('failed');
  }

  /** A KIA: the death clip plays out, then the mission ends (no restart: the roster remembers). */
  protected onRangerDown() {
    this.time.delayedCall(1800, () => this.finish('kia'));
  }

  /** The end screen; the merit is awarded (and the roster saved) right away, the debriefing follows on Enter. */
  protected finish(outcome: MissionResult['outcome']) {
    if (this.outcome) return;
    this.outcome = outcome;
    this.finishedAt = this.time.now;
    this.busy = true;
    const { width, height } = this.scale;
    const ok = outcome === 'accomplished';
    const kills = this.enemies.filter((e) => e.state === 'dead').length;
    const used = this.cfg.seconds - Math.max(0, this.timeLeft);
    this.result = {
      mission: this.cfg.number,
      title: this.cfg.title,
      outcome,
      objectiveDone: this.objectiveDone,
      kills,
      enemies: this.enemies.length,
      installations: this.props.filter((p) => p.hp !== undefined && p.hp <= 0).length,
      targets: this.targets.length,
      secondsLeft: Math.max(0, this.timeLeft),
      seconds: this.cfg.seconds,
      alertAt: this.alertAt,
      objectiveAt: this.objectiveAt,
    };
    this.award = award(this.rangerId, this.result);
    const head = ok ? 'MISSION ACCOMPLISHED' : outcome === 'kia' ? 'RANGER KILLED IN ACTION' : 'MISSION FAILED';
    const line = ok ? this.cfg.success : outcome === 'kia' ? 'The Ranger fell behind enemy lines.' : 'The plane left without you.';
    this.add.rectangle(width / 2, height / 2, width, height, 0x10140c, 0.8).setScrollFactor(0).setDepth(1e9);
    this.add
      .text(
        width / 2,
        height / 2,
        `${head}\n\n${line}\n` +
          `time ${Math.floor(used / 60)}:${String(Math.floor(used % 60)).padStart(2, '0')} · enemies ${kills}/${this.enemies.length} · grenades thrown ${this.grenadesThrown}\n\n` +
          (isTouch ? 'tap for the debriefing' : 'press Enter for the debriefing'),
        { fontFamily: 'monospace', fontSize: '22px', color: ok ? '#e8d27a' : '#ff7060', align: 'center' },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1e9 + 1);
  }

  /** Enter after the end: the debriefing. */
  toDebrief() {
    if (!this.outcome || !this.award || !this.result) return false;
    this.scene.start('debrief', { award: this.award, result: this.result });
    return true;
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
