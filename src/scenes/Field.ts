import Phaser from 'phaser';
import { isTouch, setProneLit, showFieldControls, touchMove } from '../touch';
import { preloadAssets, setupAssets, animKey, type AssetManifest, type SpriteEntry, type ObjectDirection, type CharacterMeta } from '../assets';
import { DIRS8, dirFromWorld, tileToScreen, worldToScreenDelta, screenToWorldDelta, type Dir8, TILE_W, TILE_H } from '../iso';
import { buildGround } from '../ground';
import { PropGrid, type Rect } from '../world';
import { sfx } from '../sound';

const MAP = 40; // tiles per side (1 m per tile)

/**
 * Hand-placed props: the top tile (i, j) of the block the prop covers, sprite name, and facing. Objects render
 * grid-aligned: one facing (SE) by default, SE and SW for walls, wire and the tank (`facings: 2`). The block's size
 * comes from the export's `object.directions[].tiles` (u, v). (Maps come from the generator in G3.)
 */
const PROPS: { i: number; j: number; name: string; dir: Dir8 }[] = [
  { i: 22, j: 6, name: 'bunker', dir: 'SE' },
  { i: 29, j: 9, name: 'bunker_large', dir: 'SE' },
  { i: 24, j: 26, name: 'tank', dir: 'SE' },
  { i: 17, j: 12, name: 'sandbags', dir: 'SE' },
  { i: 19, j: 16, name: 'sandbags', dir: 'SW' },
  { i: 13, j: 22, name: 'wire', dir: 'SE' },
  { i: 17, j: 23, name: 'wire', dir: 'SE' },
  { i: 10, j: 20, name: 'wire', dir: 'SW' },
  { i: 3, j: 13, name: 'tree', dir: 'SE' },
  { i: 31, j: 2, name: 'tree', dir: 'SE' },
  { i: 6, j: 31, name: 'tree', dir: 'SE' },
  { i: 22, j: 19, name: 'crate', dir: 'SE' },
  { i: 24, j: 19, name: 'crate', dir: 'SE' },
  { i: 27, j: 16, name: 'crate', dir: 'SE' },
];

/** Hit points of the props that can be destroyed (sprites exported with `states`). A grenade does up to 100. */
const DESTRUCTIBLE_HP: Record<string, number> = { tank: 100, bunker_large: 200 };

/** German patrols: hard-coded waypoint loops in tile coordinates (maps with zones come in G3). */
const PATROLS: [number, number][][] = [
  [
    [27, 21],
    [37, 21],
  ],
  [
    [22, 24],
    [34, 24],
    [34, 32],
    [22, 32],
  ],
  [
    [14, 30],
    [14, 37],
    [20, 37],
    [20, 30],
  ],
];

export const RANGER_RADIUS = 0.3; // metres
const RANGER_HP = 100;
const GRENADE_RANGE = 8; // metres
const GRENADE_FLIGHT = 0.9; // seconds
const GRENADE_APEX = 70; // px above the straight line at mid-flight
const BLAST_RADIUS = 3; // metres
const GRENADE_DAMAGE = 100;
const BULLET_SPEED = 45; // m/s (slow enough to see the tracer)
const RANGER_BULLET_RANGE = 22; // metres
const ENEMY_VIEW_RANGE = 11; // metres
const ENEMY_VIEW_HALF_ANGLE = (55 * Math.PI) / 180;
const ENEMY_REACTION = 0.7; // seconds from noticing to the first shot
const ENEMY_LOSE_AFTER = 4; // seconds without sight before resuming the patrol
const ENEMY_HIT_DAMAGE = 25;
const NOISE_SHOT = 14; // metres: a rifle shot alerts enemies this close
const NOISE_BLAST = 20;
/** G6: enemies farther than this from the Ranger sleep (no AI, no animation); they wake again inside WAKE_AT. */
const SLEEP_AT = 36; // metres
const WAKE_AT = 32;

export type Pt = { x: number; y: number };

/** A prop on the field: its collision polygon in world metres and its screen outline for depth sorting. */
export interface Placed {
  sprite: Phaser.GameObjects.Sprite;
  name: string;
  dir: Dir8;
  /** Ground point (screen px) where the object's anchor is drawn. */
  at: Pt;
  anchor: Pt;
  world: Pt[];
  screen: Pt[];
  minX: number;
  maxX: number;
  hp?: number;
  /** Current state for objects exported with states. */
  state?: string;
  /** Screen rectangle of its sprite and collider (the grid and view culling use it). */
  bounds?: Rect;
}

interface Grenade {
  ball: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
  from: Pt; // ground point (screen px)
  to: Pt;
  h0: number; // starting height above the ground (screen px)
  t: number;
}

interface Bullet {
  tracer: Phaser.GameObjects.Rectangle;
  pos: Pt; // ground point (world metres)
  dir: Pt; // unit (world)
  left: number; // metres
  h: number; // height above the ground point (screen px)
  owner: 'ranger' | 'enemy';
  /** Enemy bullets: decided on firing (hit chance); a miss is aimed past the Ranger and can't hurt him. */
  hits: boolean;
}

export interface Enemy {
  sprite: Phaser.GameObjects.Sprite;
  path: Pt[]; // waypoints (screen px)
  next: number;
  angle: number; // facing (world radians)
  state: 'patrol' | 'alert' | 'dead';
  reaction: number;
  cooldown: number;
  unseen: number;
  busy: boolean; // shooting
}

export class Field extends Phaser.Scene {
  protected manifest!: AssetManifest;
  protected ppm = 45.25;
  protected ranger!: Phaser.GameObjects.Sprite;
  protected facing: Dir8 = 'SE';
  protected prone = false;
  protected busy = false; // a one-shot (shoot, throw) is playing
  protected keys!: Record<string, Phaser.Input.Keyboard.Key>;
  protected cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  protected props: Placed[] = [];
  /** The props by screen area (G6): collision, sight, bullets and depth look only at the ones nearby. */
  protected grid = new PropGrid<Placed>();
  /** Scratch list for grid queries. */
  protected near: Placed[] = [];
  protected grenades: Grenade[] = [];
  protected bullets: Bullet[] = [];
  protected enemies: Enemy[] = [];
  protected grenadesThrown = 0;
  protected shotsFired = 0;
  protected hp = RANGER_HP;
  protected dead = false;
  /** Test hook (scripts/load-check.mjs): the Ranger takes no damage. */
  god = false;
  /** R restarts after the Ranger dies (the test field; a mission debriefs a KIA instead). */
  protected restartOnR = true;
  protected hud!: Phaser.GameObjects.Text;

  /** Grenades the Ranger carries (the field test scene has no limit; missions restock from supply pods). */
  protected grenadesLeft = Infinity;

  constructor(key = 'field') {
    super(key);
  }

  /** The overview map, in scenes that have one (Mission). */
  toggleMap?(): void;

  /** Mission maps this scene needs loaded (the test field has none). */
  protected mapsToLoad(): string[] {
    return [];
  }

  preload() {
    preloadAssets(this, this.mapsToLoad());
    // The first load of the sprites takes a few seconds: say so (and how far it got) instead of a blank screen.
    const { width, height } = this.scale;
    const t = this.add.text(width / 2, height / 2, 'AIRBORNE DROP IN PROGRESS', { fontFamily: 'monospace', fontSize: '22px', color: '#e8d27a' }).setOrigin(0.5);
    const bar = this.add.rectangle(width / 2 - 150, height / 2 + 34, 0, 6, 0xe8d27a).setOrigin(0, 0.5);
    this.load.on('progress', (v: number) => bar.setSize(300 * v, 6));
    this.load.once('complete', () => {
      t.destroy();
      bar.destroy();
    });
  }

  create() {
    // A restart reuses this scene object: reset everything the class initialisers set.
    this.props = [];
    this.grid.clear();
    this.grenades = [];
    this.bullets = [];
    this.enemies = [];
    this.grenadesThrown = 0;
    this.shotsFired = 0;
    this.hp = RANGER_HP;
    this.dead = false;
    this.busy = false;
    this.prone = false;
    this.facing = 'SE';

    const m = setupAssets(this);
    if (!m || !m.sprites.ranger) {
      this.add.text(20, 20, 'No assets: run `npm run assets`', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8080' });
      return;
    }
    this.manifest = m;
    this.ppm = m.ppm;
    this.makeTextures();
    const start = this.buildWorld();
    if (!start) return;

    this.ranger = this.add.sprite(start.x, start.y, 'ranger');
    this.play(this.ranger, 'ranger', 'rifle_idle', this.facing);
    this.footsteps(this.ranger, 'ranger');

    if (m.sprites.german) this.spawnEnemies();

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys('W,A,S,D,SHIFT,X,SPACE,G,R') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys.X.on('down', () => {
      if (!this.busy && !this.dead) this.prone = !this.prone;
    });
    this.keys.SPACE.on('down', () => this.shoot());
    this.keys.G.on('down', () => this.throwGrenade());
    this.keys.R.on('down', () => {
      if (this.dead && this.restartOnR) this.scene.restart();
    });
    // Phones and tablets: the stick and buttons (src/touch.ts); a tap on the map restarts the test field when down.
    document.getElementById('rotate')?.remove();
    const hideTouch = showFieldControls({
      shoot: () => this.shoot(),
      grenade: () => this.throwGrenade(),
      prone: () => {
        if (!this.busy && !this.dead) this.prone = !this.prone;
      },
      map: this.toggleMap ? () => this.toggleMap?.() : undefined,
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, hideTouch);
    this.input.on('pointerdown', () => {
      if (this.dead && this.restartOnR) this.scene.restart();
    });

    const b = this.worldBounds();
    this.cameras.main.setBounds(b.x, b.y, b.width, b.height);
    this.cameras.main.startFollow(this.ranger, true, 0.15, 0.15);
    this.cameras.main.setRoundPixels(true);

    // Off-screen props are hidden and paused, after each update (G6).
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.cullWorld, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.cullWorld, this));

    this.hud = this.add
      .text(10, 10, '', { fontFamily: 'monospace', fontSize: '14px', color: '#e8d27a', backgroundColor: '#10140ccc', padding: { x: 6, y: 4 } })
      .setScrollFactor(0)
      .setDepth(1e9);
  }

  /** The hand-made test field: generated ground, hand-placed props. Returns the Ranger's start (screen px). */
  protected buildWorld(): Pt | null {
    this.drawGround();
    for (const p of PROPS) this.placeProp(p);
    return tileToScreen(12, 12);
  }

  protected spawnEnemies() {
    for (const path of PATROLS) this.spawnEnemy(path);
  }

  /** Camera bounds (screen px) around the world. */
  protected worldBounds() {
    const top = tileToScreen(0, 0);
    const right = tileToScreen(MAP, 0);
    const left = tileToScreen(0, MAP);
    const bottom = tileToScreen(MAP, MAP);
    return new Phaser.Geom.Rectangle(left.x - 64, top.y - 600, right.x - left.x + 128, bottom.y - top.y + 680);
  }

  /** Can the Ranger's feet be at this screen point (on the map, not on a blocked cell)? Props are checked apart. */
  protected canStand(x: number, y: number) {
    const i = (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2;
    const j = (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2;
    return !(i < 0.5 || j < 0.5 || i > MAP - 1.5 || j > MAP - 1.5);
  }

  /** The HUD's first line. */
  protected hudLine() {
    const alive = this.enemies.filter((e) => e.state !== 'dead').length;
    const alert = this.enemies.some((e) => e.state === 'alert');
    const targets = this.props.filter((p) => p.hp !== undefined);
    return `HP ${this.hp}${alert ? '  ALERT' : ''}   enemies ${alive}/${this.enemies.length}   targets destroyed ${targets.filter((p) => p.hp! <= 0).length}/${targets.length}`;
  }

  /** Placeholder texture for smoke, fire and dust particles (Particle_FX sprites come later). */
  protected makeTextures() {
    if (this.textures.exists('puff')) return;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillCircle(8, 8, 8);
    g.generateTexture('puff', 16, 16);
    g.destroy();
  }

  /**
   * Ground from the generated tileset (G2): a corner grid of terrains (grass, a dirt track, a sand patch), each tile
   * the tileset's tile whose four corners match (the tileset declares a dirt↔sand pair, so they may touch).
   */
  protected drawGround() {
    const ts = this.manifest.tilesets?.temperate;
    if (!ts || !this.cache.json.exists(`tileset:${ts.name}`)) {
      this.add.text(20, 60, 'No ground tileset: run `npm run assets`', { fontFamily: 'monospace', fontSize: '14px', color: '#ff8080' }).setScrollFactor(0);
      return;
    }
    const noise = (x: number, y: number) => Math.sin(x * 1.7 + y * 0.9) + Math.cos(x * 0.6 - y * 1.3);
    buildGround(this, ts, MAP, (x, y) => {
      if (Math.abs(x - y - 3 + 0.6 * noise(x, y)) <= 1.4 && x > 5) return 'dirt';
      if (Math.hypot(x - 8, y - 30) < 4.5 + noise(x, y)) return 'sand';
      if (Math.hypot(x - 33, y - 30) < 3.5 + 0.8 * noise(x, y)) return 'sand';
      return 'grass';
    });
  }

  /**
   * Place a prop from its export's `object` block: the anchor pixel (the footprint's ground centre) goes on the
   * centre of the block of tiles it covers, and the per-direction collision polygon becomes the collider. Objects
   * with states start in the first state (`intact`) and keep their anchor in every state.
   */
  protected placeProp(p: { i: number; j: number; name: string; dir: Dir8 }) {
    const d: ObjectDirection | undefined = this.manifest.sprites[p.name]?.object?.directions.find((x) => x.name === p.dir);
    if (!d) return;
    // Tile (i, j) spans i±0.5 around tileToScreen(i, j), so the block's centre is half its size in from the top tile.
    const at = tileToScreen(p.i - 0.5 + d.tiles.u / 2, p.j - 0.5 + d.tiles.v / 2);
    const hp = this.manifest.sprites[p.name].object?.states?.length ? DESTRUCTIBLE_HP[p.name] : undefined;
    this.placeObject(p.name, p.dir, at, { hp });
  }

  /**
   * An object sprite with its anchor on `at` (screen px), in `state` (default: its first state) with the facing's
   * collision polygon (or `collision`: screen px around the anchor, e.g. from a map object). `hp` makes it
   * destructible. Returns null when the sprite, facing or state wasn't exported.
   */
  protected placeObject(name: string, dir: Dir8, at: Pt, opts: { hp?: number; state?: string; collision?: [number, number][] } = {}): Placed | null {
    const s: SpriteEntry | undefined = this.manifest.sprites[name];
    const d: ObjectDirection | undefined = s?.object?.directions.find((x) => x.name === dir);
    const st = s?.object?.states?.find((x) => x.name === opts.state) ?? s?.object?.states?.[0];
    const first = st?.animation ?? s?.clips[0];
    if (!s || !d || !first || !this.anims.exists(animKey(s, first, dir))) return null;
    const spr = this.add.sprite(at.x, at.y, name);
    const placed: Placed = { sprite: spr, name, dir, at, anchor: d.anchor, world: [], screen: [], minX: 0, maxX: 0 };
    this.showState(placed, first);
    if (opts.hp !== undefined) {
      placed.hp = opts.hp;
      placed.state = st?.name ?? 'intact';
    }
    const poly = opts.collision?.map(([x, y]): [number, number] => [x + d.anchor.x, y + d.anchor.y]) ?? st?.directions.find((x) => x.name === dir)?.polygon ?? d.polygon;
    this.setCollision(placed, poly);
    // The collision polygon is what stands on the ground: a tree's trunk (`collision.source` "base"), the whole
    // hull for crates, walls and buildings.
    const lowest = Math.max(...placed.screen.map((q) => q.y));
    spr.setDepth(s.object?.collision?.source === 'base' ? lowest : at.y);
    this.props.push(placed);
    return placed;
  }

  /**
   * Play one of the object's animations (a state or a transition) with its anchor on `at`. Every frame's pivot is the
   * object's anchor for its direction (FB-029, verified), so the sprite simply stands on `at` whatever plays.
   */
  protected showState(p: Placed, anim: string, onDone?: () => void) {
    const s = this.manifest.sprites[p.name];
    p.sprite.play(animKey(s, anim, p.dir));
    p.sprite.setPosition(p.at.x, p.at.y);
    if (onDone) p.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, onDone);
  }

  /** A prop's collider from a polygon in frame pixels (around its anchor). */
  protected setCollision(p: Placed, polygon: [number, number][]) {
    p.screen = polygon.map(([x, y]) => ({ x: p.at.x + x - p.anchor.x, y: p.at.y + y - p.anchor.y }));
    p.world = p.screen.map((q) => screenToWorldDelta(q.x, q.y, this.ppm));
    p.minX = Math.min(...p.screen.map((q) => q.x));
    p.maxX = Math.max(...p.screen.map((q) => q.x));
    const b = p.sprite.getBounds();
    const ys = p.screen.map((q) => q.y);
    p.bounds = { left: Math.min(b.left, p.minX), right: Math.max(b.right, p.maxX), top: Math.min(b.top, ...ys), bottom: Math.max(b.bottom, ...ys) };
    this.grid.update(p);
  }

  /** The prop whose collider holds a world point, if any. */
  protected propAt(w: Pt): Placed | undefined {
    const s = worldToScreenDelta(w.x, w.y, this.ppm);
    return this.grid.at(s.x, s.y).find((p) => pointInPolygon(w, p.world));
  }

  private cullTick = 0;
  /**
   * G6: hide props and characters outside the camera (with a margin) and pause the props there, so a map of ~1 000
   * props draws and animates only the hundred or so on screen. Every third frame.
   */
  protected cullWorld() {
    if (this.cullTick++ % 3) return;
    const v = this.cameras.main.worldView;
    const m = 160;
    const l = v.x - m;
    const r = v.right + m;
    const t = v.y - m;
    const bt = v.bottom + m;
    for (const p of this.props) {
      const b = p.bounds;
      const on = !b || (b.right > l && b.left < r && b.bottom > t && b.top < bt);
      if (p.sprite.visible !== on) p.sprite.setVisible(on).setActive(on);
    }
    for (const e of this.enemies) {
      const x = e.sprite.x;
      const y = e.sprite.y;
      e.sprite.setVisible(x > l && x < r && y > t && y - 120 < bt);
    }
  }

  /** G6: is the enemy near enough to the Ranger to think and animate? Far ones sleep (inactive: no anim, no events). */
  protected awake(e: Enemy, ranger: Pt) {
    const d = distW(this.worldOf(e.sprite), ranger);
    const on = d < (e.sprite.active ? SLEEP_AT : WAKE_AT);
    if (on !== e.sprite.active) e.sprite.setActive(on);
    return on;
  }

  /**
   * Destroy an object with states: play `intact_to_<last>` once (it ends on the last state's still: FB-027 verified),
   * then show the last state (destroyed) and swap the collider for that state's polygon; fire and smoke stay on the
   * wreck. Models without a destroyed version are exported with a scorched copy and a `collapse` (FB-028 verified).
   */
  protected destroyProp(p: Placed) {
    const s = this.manifest.sprites[p.name];
    const states = s.object?.states ?? [];
    const end = states[states.length - 1];
    if (!end) {
      // Declared without states: only the game's own blast and fire.
      if (p.state === 'destroyed') return;
      p.state = 'destroyed';
      this.dustBurst(p.at);
      this.smokeAndFire(p, (s.object?.height ?? 1.5) * 0.6);
      return;
    }
    if (p.state === end.name || p.state === 'dying') return;
    const from = p.state ?? states[0].name;
    p.state = 'dying';
    const finish = () => {
      p.state = end.name;
      this.showState(p, end.animation);
      const poly = end.directions.find((x) => x.name === p.dir)?.polygon;
      if (poly) this.setCollision(p, poly);
      this.smokeAndFire(p, Math.max(end.height, 1));
    };
    const tr = s.object?.transitions?.find((t) => t.from === from && t.to === end.name);
    if (tr && this.anims.exists(animKey(s, tr.animation, p.dir))) this.showState(p, tr.animation, finish);
    else finish();
  }

  protected dustBurst(at: Pt) {
    const e = this.add.particles(at.x, at.y - 20, 'puff', {
      speed: { min: 40, max: 140 },
      angle: { min: 180, max: 360 },
      scale: { start: 2.5, end: 5 },
      alpha: { start: 0.8, end: 0 },
      tint: [0x8a7a60, 0x6a604c, 0x9a8e74],
      lifespan: 1400,
      emitting: false,
    });
    e.setDepth(at.y + 50);
    e.explode(40);
    this.time.delayedCall(1600, () => e.destroy());
  }

  /**
   * A looping or one-shot effect sprite from the generator's particle FX templates (`fire`, `smoke`, `explosion` in
   * ssg.assets.json), its pivot on `at`. Returns null when the effect wasn't built.
   */
  protected fx(name: string, at: Pt, depth: number, opts: { scale?: number; once?: boolean } = {}) {
    const s = this.manifest.sprites[name];
    const key = s && animKey(s, s.clips[0], s.dirs[0]);
    if (!key || !this.anims.exists(key)) return null;
    const spr = this.add.sprite(at.x, at.y, name).setDepth(depth).setScale(opts.scale ?? 1);
    // The export says how to blend it (smoke normal, fire and explosions additive).
    spr.setBlendMode(s.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    spr.play({ key, startFrame: opts.once ? 0 : Phaser.Math.Between(0, this.anims.get(key).frames.length - 1) });
    if (opts.once) spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => spr.destroy());
    return spr;
  }

  protected smokeAndFire(p: Placed, height: number) {
    // Two thirds up the wreck (a height h m is h·ppm·cos 30° px on screen in iso8).
    const top = { x: p.at.x, y: p.at.y - height * this.ppm * 0.866 * 0.66 };
    // Generator FX: flames on the wreck, a dark smoke column above (smoke_loop:dark, normal blending: FB-031 verified).
    const flames = [-0.35, 0.1, 0.4].map((f, k) =>
      this.fx('fire', { x: top.x + f * 60, y: top.y + 10 + k * 6 }, p.sprite.depth + 1, { scale: 1 - k * 0.15 }),
    );
    const column = this.fx('smoke', { x: top.x + 8, y: top.y - 10 }, p.sprite.depth + 2, { scale: 1.3 });
    if (flames.every(Boolean) && column) return;
    // Placeholder particles when the FX sprites weren't built.
    const fire = this.add.particles(top.x, top.y, 'puff', {
      x: { min: -18, max: 18 },
      speedY: { min: -50, max: -20 },
      scale: { start: 1.3, end: 0.2 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffc040, 0xff7020, 0xff4010],
      blendMode: 'ADD',
      lifespan: 600,
      frequency: 60,
    });
    const smoke = this.add.particles(top.x, top.y - 10, 'puff', {
      x: { min: -14, max: 14 },
      speedY: { min: -45, max: -25 },
      speedX: { min: 4, max: 16 },
      scale: { start: 1.6, end: 6 },
      alpha: { start: 0.6, end: 0 },
      tint: [0x3a3a38, 0x55524c, 0x2a2a28],
      lifespan: 2600,
      frequency: 110,
    });
    fire.setDepth(p.sprite.depth + 1);
    smoke.setDepth(p.sprite.depth + 2);
  }

  /** A German soldier walking a waypoint loop (tile coordinates); one waypoint = a guard standing facing `dir`. */
  protected spawnEnemy(path: [number, number][], dir: Dir8 = 'SW', start = 0) {
    const pts = path.map(([i, j]) => tileToScreen(i, j));
    const at = pts[start % pts.length];
    const spr = this.add.sprite(at.x, at.y, 'german');
    const a = (DIRS8.indexOf(dir) * Math.PI) / 4;
    const e: Enemy = { sprite: spr, path: pts, next: (start + 1) % pts.length, angle: a, state: 'patrol', reaction: 0, cooldown: 0, unseen: 0, busy: false };
    this.enemies.push(e);
    this.play(spr, 'german', 'rifle_idle', dir);
    this.footsteps(spr, 'german');
    return e;
  }

  /**
   * Footstep sounds on the clips' `footstep_l` / `footstep_r` events (the generator's clip events), quieter with
   * distance from the Ranger.
   */
  protected footsteps(spr: Phaser.GameObjects.Sprite, name: string) {
    const info = this.manifest.sprites[name]?.clipInfo ?? {};
    const prefix = this.manifest.sprites[name]?.animPrefix ?? '';
    spr.on(Phaser.Animations.Events.ANIMATION_UPDATE, (a: Phaser.Animations.Animation, f: Phaser.Animations.AnimationFrame) => {
      const clip = a.key.slice(prefix.length).replace(/_[A-Z]+$/, '');
      if (!info[clip]?.events.some((e) => e.name.startsWith('footstep') && e.frame === f.index - 1)) return;
      const v = this.loudness(spr, 14) * (name === 'ranger' ? 1 : 0.6);
      if (v > 0.02) sfx.footstep(v);
    });
  }

  /** 1 at the Ranger, falling to 0 at `range` metres: how loud something there sounds. */
  protected loudness(at: Pt, range: number) {
    if (!this.ranger) return 1;
    const d = distW(this.worldOf(at), this.worldOf(this.ranger));
    return Phaser.Math.Clamp(1 - d / range, 0, 1);
  }

  protected play(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, ignoreIfPlaying = true) {
    const s = this.manifest.sprites[name];
    const key = s ? animKey(s, clip, dir) : '';
    if (!this.anims.exists(key)) return false;
    spr.play(key, ignoreIfPlaying);
    return true;
  }

  /**
   * Run a one-shot clip and call `fire` once on the frame of its named event (or at the end if the event never
   * shows: a slow frame can skip it), then `done`.
   */
  protected oneShot(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, event: string, fire: () => void, done: () => void) {
    const at = this.manifest.sprites[name].clipInfo[clip]?.events.find((e) => e.name === event)?.frame ?? 0;
    let fired = false;
    const once = () => {
      if (fired) return;
      fired = true;
      fire();
    };
    const onFrame = (_a: Phaser.Animations.Animation, f: Phaser.Animations.AnimationFrame) => {
      if (f.index - 1 >= at) once(); // AnimationFrame.index is 1-based, events are 0-based
    };
    if (!this.play(spr, name, clip, dir, false)) {
      done();
      return;
    }
    spr.on(Phaser.Animations.Events.ANIMATION_UPDATE, onFrame);
    spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      spr.off(Phaser.Animations.Events.ANIMATION_UPDATE, onFrame);
      once();
      done();
    });
    if (at === 0) once();
  }

  /**
   * A socket on the event frame of a character's clip (the meta's per-frame sockets), as an offset from the feet in
   * screen px. The muzzle is `weapon_tip`; `hand_r` stands in when a frame has no weapon tip.
   */
  protected socket(name: string, clip: string, dir: Dir8, event: string, sockets: string[]): Pt | null {
    const meta = this.cache.json.get(`meta:${name}`) as CharacterMeta | undefined;
    const frame = this.manifest.sprites[name].clipInfo[clip]?.events.find((e) => e.name === event)?.frame ?? 0;
    const at = meta?.animations.find((a) => a.clip === clip && a.direction === dir)?.sockets[frame];
    const hit = sockets.map((k) => at?.[k]).find(Boolean);
    return hit && meta ? { x: hit.x - meta.pivot.x, y: hit.y - meta.pivot.y } : null;
  }

  /** Ranger fires: the rifle shoot clip's `shoot` event spawns a bullet at the muzzle (`weapon_tip` socket). */
  protected shoot() {
    const clip = this.prone ? 'rifle_prone_shoot' : 'rifle_shoot';
    if (!this.ranger || this.busy || this.dead || !this.anims.exists(animKey(this.manifest.sprites.ranger, clip, this.facing))) return;
    this.busy = true;
    const dir = this.facing;
    this.oneShot(
      this.ranger,
      'ranger',
      clip,
      dir,
      'shoot',
      () => {
        this.shotsFired++;
        sfx.shot();
        const muzzle = this.socket('ranger', clip, dir, 'shoot', ['weapon_tip', 'hand_r']) ?? { x: 0, y: -50 };
        const a = (DIRS8.indexOf(dir) * Math.PI) / 4;
        this.fireBullet(this.ranger, muzzle, { x: Math.cos(a), y: Math.sin(a) }, RANGER_BULLET_RANGE, 'ranger', true);
        this.noise(this.ranger, NOISE_SHOT);
      },
      () => {
        this.busy = false;
      },
    );
  }

  /** A bullet from a character's muzzle (offset from the feet, screen px) along a world direction. */
  protected fireBullet(from: Phaser.GameObjects.Sprite, muzzle: Pt, dir: Pt, range: number, owner: Bullet['owner'], hits: boolean) {
    const ground = { x: from.x + muzzle.x, y: from.y };
    const pos = screenToWorldDelta(ground.x, ground.y, this.ppm);
    const sd = worldToScreenDelta(dir.x, dir.y, this.ppm);
    const tracer = this.add
      .rectangle(ground.x, ground.y + muzzle.y, 9, 2, owner === 'ranger' ? 0xfff0a0 : 0xffa060)
      .setRotation(Math.atan2(sd.y, sd.x));
    const flash = this.add.circle(ground.x, ground.y + muzzle.y, 4, 0xffe080, 0.9).setDepth(from.depth + 1);
    this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 90, onComplete: () => flash.destroy() });
    this.bullets.push({ tracer, pos, dir, left: range, h: -muzzle.y, owner, hits });
  }

  protected updateBullets(dt: number) {
    const rangerW = this.worldOf(this.ranger);
    for (const b of this.bullets) {
      const step = Math.min(b.left, BULLET_SPEED * dt);
      // Sub-steps so a fast bullet can't skip over a soldier or a thin wall.
      const n = Math.max(1, Math.ceil(step / 0.2));
      for (let k = 0; k < n && b.left > 0; k++) {
        b.pos = { x: b.pos.x + (b.dir.x * step) / n, y: b.pos.y + (b.dir.y * step) / n };
        b.left -= step / n;
        if (this.propAt(b.pos)) {
          b.left = 0;
          this.spark(b);
          break;
        }
        if (b.owner === 'ranger') {
          const e = this.enemies.find((x) => x.state !== 'dead' && distW(b.pos, this.worldOf(x.sprite)) < 0.45);
          if (e) {
            b.left = 0;
            this.killEnemy(e, b.dir);
          }
        } else if (b.hits && !this.dead && distW(b.pos, rangerW) < 0.45) {
          b.left = 0;
          this.hurtRanger(ENEMY_HIT_DAMAGE);
        }
      }
      const s = worldToScreenDelta(b.pos.x, b.pos.y, this.ppm);
      b.tracer.setPosition(s.x, s.y - b.h).setDepth(s.y + 1);
    }
    for (const b of this.bullets) if (b.left <= 0) b.tracer.destroy();
    this.bullets = this.bullets.filter((b) => b.left > 0);
  }

  protected spark(b: Bullet) {
    const s = worldToScreenDelta(b.pos.x, b.pos.y, this.ppm);
    const c = this.add.circle(s.x, s.y - b.h, 2, 0xffffff).setDepth(s.y + 2);
    this.tweens.add({ targets: c, scale: 3, alpha: 0, duration: 150, onComplete: () => c.destroy() });
  }

  protected worldOf(spr: Pt) {
    return screenToWorldDelta(spr.x, spr.y, this.ppm);
  }

  protected killEnemy(e: Enemy, from: Pt) {
    e.state = 'dead';
    e.sprite.removeAllListeners(Phaser.Animations.Events.ANIMATION_UPDATE);
    e.sprite.removeAllListeners(Phaser.Animations.Events.ANIMATION_COMPLETE);
    // Falls away from the shot: the death clip faces into it.
    if (!this.play(e.sprite, 'german', 'rifle_death', dirFromWorld(-from.x, -from.y), false)) e.sprite.setVisible(false);
  }

  protected hurtRanger(dmg: number) {
    if (this.god || this.dead) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.ranger.setTintFill(0xff4040);
    this.time.delayedCall(80, () => this.ranger.clearTint());
    if (this.hp > 0) return;
    this.dead = true;
    this.busy = true;
    this.ranger.removeAllListeners(Phaser.Animations.Events.ANIMATION_UPDATE);
    this.ranger.removeAllListeners(Phaser.Animations.Events.ANIMATION_COMPLETE);
    this.play(this.ranger, 'ranger', 'rifle_death', this.facing, false);
    this.onRangerDown();
  }

  /** The Ranger is dead: the test field offers a restart (a mission goes to its debriefing instead). */
  protected onRangerDown() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, isTouch ? 'RANGER DOWN\ntap to restart' : 'RANGER DOWN\npress R to restart', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ff7060',
        align: 'center',
        backgroundColor: '#10140ccc',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1e9);
  }

  /** A loud sound: living enemies within `radius` turn towards it and are on alert. */
  protected noise(src: Pt, radius: number) {
    const w = this.worldOf(src);
    for (const e of this.enemies) {
      if (e.state === 'dead') continue;
      const ew = this.worldOf(e.sprite);
      if (distW(w, ew) > radius) continue;
      e.angle = Math.atan2(w.y - ew.y, w.x - ew.x);
      if (e.state === 'patrol') {
        e.state = 'alert';
        e.reaction = ENEMY_REACTION;
        e.unseen = 0;
      }
    }
  }

  /** Can the enemy see the Ranger: in range (less when he's prone), inside the view cone, no prop in between. */
  protected sees(e: Enemy) {
    if (this.dead) return false;
    const a = this.worldOf(e.sprite);
    const b = this.worldOf(this.ranger);
    const d = distW(a, b);
    if (d > (this.prone ? ENEMY_VIEW_RANGE * 0.6 : ENEMY_VIEW_RANGE)) return false;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (Math.abs(Phaser.Math.Angle.Wrap(ang - e.angle)) > ENEMY_VIEW_HALF_ANGLE) return false;
    for (let t = 0.6; t < d - 0.4; t += 0.3) {
      const q = { x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d };
      if (this.propAt(q)) return false;
    }
    return true;
  }

  protected updateEnemies(dt: number) {
    const walk = this.manifest.sprites.german?.clipInfo.rifle_walk?.speedMps ?? 1.2;
    const rw = this.worldOf(this.ranger);
    for (const e of this.enemies) {
      if (!this.awake(e, rw)) continue;
      e.sprite.setDepth(this.depthAt(e.sprite));
      if (e.state === 'dead') continue;
      const seen = this.sees(e);
      if (e.state === 'patrol') {
        if (seen) {
          e.state = 'alert';
          e.reaction = ENEMY_REACTION;
          e.unseen = 0;
        } else {
          const goal = e.path[e.next];
          const w = screenToWorldDelta(goal.x - e.sprite.x, goal.y - e.sprite.y, this.ppm);
          const d = Math.hypot(w.x, w.y);
          if (d < 0.1) {
            e.next = (e.next + 1) % e.path.length;
          } else {
            const step = Math.min(d, walk * dt);
            const sd = worldToScreenDelta((w.x / d) * step, (w.y / d) * step, this.ppm);
            e.sprite.setPosition(e.sprite.x + sd.x, e.sprite.y + sd.y);
            e.angle = Math.atan2(w.y, w.x);
            this.play(e.sprite, 'german', 'rifle_walk', dirFromWorld(w.x, w.y));
          }
          continue;
        }
      }
      // Alert: stand, face the Ranger while he's in sight, shoot after the reaction time.
      if (seen) {
        const a = this.worldOf(e.sprite);
        const b = this.worldOf(this.ranger);
        e.angle = Math.atan2(b.y - a.y, b.x - a.x);
        e.unseen = 0;
      } else if ((e.unseen += dt) > ENEMY_LOSE_AFTER || this.dead) {
        if (!e.busy) e.state = 'patrol';
        continue;
      }
      const dir = dirFromWorld(Math.cos(e.angle), Math.sin(e.angle));
      e.reaction -= dt;
      e.cooldown -= dt;
      if (e.busy) continue;
      if (seen && e.reaction <= 0 && e.cooldown <= 0) this.enemyShoot(e, dir);
      else this.play(e.sprite, 'german', 'rifle_idle', dir);
    }
  }

  /**
   * An enemy shot: rifle_shoot, the bullet leaves the muzzle on the `shoot` event. Hit chance falls with distance
   * and halves against a prone Ranger; a miss is aimed past him.
   */
  protected enemyShoot(e: Enemy, dir: Dir8) {
    e.busy = true;
    this.oneShot(
      e.sprite,
      'german',
      'rifle_shoot',
      dir,
      'shoot',
      () => {
        if (e.state === 'dead' || this.dead) return;
        const a = this.worldOf(e.sprite);
        const b = this.worldOf(this.ranger);
        const d = distW(a, b);
        let chance = Phaser.Math.Clamp(0.65 - (d - 3) * 0.05, 0.2, 0.65);
        if (this.prone) chance *= 0.5;
        const hits = Math.random() < chance;
        let ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (!hits) ang += (Math.random() < 0.5 ? -1 : 1) * Math.atan2(0.9 + Math.random(), d);
        const muzzle = this.socket('german', 'rifle_shoot', dir, 'shoot', ['weapon_tip', 'hand_r']) ?? { x: 0, y: -50 };
        sfx.enemyShot(0.3 + 0.7 * this.loudness(e.sprite, 30));
        this.fireBullet(e.sprite, muzzle, { x: Math.cos(ang), y: Math.sin(ang) }, d + 6, 'enemy', hits);
      },
      () => {
        e.busy = false;
        e.cooldown = 1.1 + Math.random() * 0.8;
      },
    );
  }

  /** Throw a grenade: the throw move's `release` event spawns it at the throwing hand's socket on that frame. */
  protected throwGrenade() {
    const clip = 'rifle_throw';
    if (!this.ranger || this.busy || this.prone || this.dead || this.grenadesLeft <= 0 || !this.anims.exists(animKey(this.manifest.sprites.ranger, clip, this.facing))) return;
    const dir = this.facing;
    this.busy = true;
    this.grenadesLeft--;
    this.oneShot(
      this.ranger,
      'ranger',
      clip,
      dir,
      'release',
      () => {
        // The procedural throw uses the free left hand by default (the rifle stays in the right).
        const off = this.socket('ranger', clip, dir, 'release', ['hand_l', 'hand_r']) ?? { x: 0, y: -60 };
        sfx.throwWhoosh();
        this.spawnGrenade(dir, off);
      },
      () => {
        this.busy = false;
      },
    );
  }

  /** A grenade leaves the hand at `off` (screen px from the Ranger's feet) and arcs to a point ahead of him. */
  protected spawnGrenade(dir: Dir8, off: Pt) {
    this.grenadesThrown++;
    const a = (DIRS8.indexOf(dir) * Math.PI) / 4;
    const reach = worldToScreenDelta(Math.cos(a) * GRENADE_RANGE, Math.sin(a) * GRENADE_RANGE, this.ppm);
    const from = { x: this.ranger.x + off.x, y: this.ranger.y };
    const to = { x: this.ranger.x + reach.x, y: this.ranger.y + reach.y };
    const ball = this.add.circle(from.x, from.y + off.y, 3, 0x2c3a1c).setStrokeStyle(1, 0x101408);
    const shadow = this.add.ellipse(from.x, from.y, 7, 3, 0x000000, 0.35);
    this.grenades.push({ ball, shadow, from, to, h0: -off.y, t: 0 });
  }

  /** Placeholder blast: flash, scorch ring, camera shake; kills enemies and damages destructibles in the radius. */
  protected explode(at: Pt) {
    // The generator's explosion (fireball, sparks); a flash circle when it wasn't built.
    const boom = this.fx('explosion', at, at.y + 1000, { once: true });
    sfx.explosion(0.35 + 0.65 * this.loudness(at, 40));
    const flash = this.add.circle(at.x, at.y - 10, 10, 0xffd060, boom ? 0 : 0.95).setDepth(at.y + 1000);
    const ring = this.add.ellipse(at.x, at.y, 20, 10, 0xff6020, 0.6).setDepth(at.y + 999);
    this.tweens.add({ targets: flash, scale: 5, alpha: 0, duration: 450, onComplete: () => flash.destroy() });
    const r = BLAST_RADIUS * this.ppm;
    this.tweens.add({ targets: ring, displayWidth: r * 2, displayHeight: r, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
    this.cameras.main.shake(180, 0.006);
    const w = this.worldOf(at);
    for (const e of this.enemies) {
      if (e.state === 'dead') continue;
      const ew = this.worldOf(e.sprite);
      if (distW(ew, w) < BLAST_RADIUS) this.killEnemy(e, { x: ew.x - w.x, y: ew.y - w.y });
    }
    if (distW(this.worldOf(this.ranger), w) < BLAST_RADIUS * 0.7) this.hurtRanger(60);
    for (const p of this.props) {
      if (p.hp === undefined || p.hp <= 0) continue;
      const d = pointInPolygon(w, p.world) ? 0 : distToPolygon(w, p.world);
      if (d > BLAST_RADIUS) continue;
      p.hp -= d < BLAST_RADIUS / 2 ? GRENADE_DAMAGE : GRENADE_DAMAGE / 2;
      if (p.hp <= 0) this.destroyProp(p);
    }
    this.noise(at, NOISE_BLAST);
  }

  protected updateGrenades(dt: number) {
    for (const g of this.grenades) {
      g.t = Math.min(1, g.t + dt / GRENADE_FLIGHT);
      const x = Phaser.Math.Linear(g.from.x, g.to.x, g.t);
      const y = Phaser.Math.Linear(g.from.y, g.to.y, g.t);
      const h = g.h0 * (1 - g.t) + 4 * GRENADE_APEX * g.t * (1 - g.t);
      g.shadow.setPosition(x, y).setDepth(y - 1);
      // In the air the grenade is drawn over what stands near its ground point (it arcs over props).
      g.ball.setPosition(x, y - h).setDepth(y + 400 * Math.sin(Math.PI * g.t));
      if (g.t >= 1) {
        g.ball.destroy();
        g.shadow.destroy();
        this.explode({ x, y });
      }
    }
    this.grenades = this.grenades.filter((g) => g.t < 1);
  }

  /** Ground speed of a locomotion clip, as measured by the generator (`speedMps`), so the feet don't slide. */
  protected speedOf(clip: string) {
    return this.manifest.sprites.ranger.clipInfo[clip]?.speedMps ?? 0;
  }

  update(_t: number, dtMs: number) {
    if (!this.ranger) return;
    const dt = dtMs / 1000;
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.A.isDown || this.cursors.left.isDown) dx -= 1;
    if (k.D.isDown || this.cursors.right.isDown) dx += 1;
    if (k.W.isDown || this.cursors.up.isDown) dy += 1;
    if (k.S.isDown || this.cursors.down.isDown) dy -= 1;
    const pad = touchMove();
    if (pad && dx === 0 && dy === 0) {
      dx = pad.dx;
      dy = pad.dy;
    }
    const moving = dx !== 0 || dy !== 0;
    const running = (k.SHIFT.isDown || (!!pad && pad.run)) && !this.prone;
    setProneLit(this.prone);

    if (this.dead) {
      // the death clip plays out
    } else if (moving && !this.busy) {
      this.facing = dirFromWorld(dx, dy);
      const clip = this.prone ? 'rifle_crawl' : running ? 'rifle_run' : 'rifle_walk';
      const len = Math.hypot(dx, dy);
      const speed = this.speedOf(clip);
      const step = worldToScreenDelta((dx / len) * speed * dt, (dy / len) * speed * dt, this.ppm);
      this.tryMove(step.x, step.y);
      this.play(this.ranger, 'ranger', clip, this.facing);
    } else if (!this.busy) {
      this.play(this.ranger, 'ranger', this.prone ? 'rifle_prone_idle' : 'rifle_idle', this.facing);
    }
    this.ranger.setDepth(this.depthAt(this.ranger));

    this.updateEnemies(dt);
    this.updateGrenades(dt);
    this.updateBullets(dt);

    const g = Number.isFinite(this.grenadesLeft) ? `${this.grenadesLeft} left` : `${this.grenadesThrown}`;
    this.hud.setText(`${this.hudLine()}\n${isTouch ? `grenades: ${g}` : `WASD/arrows move · Shift run · X prone · Space shoot · G grenade (${g}) · M sound`}`);
  }

  /**
   * Iso depth for a character at its feet: by screen y, but where a prop's sprite overlaps, its ground outline
   * decides: feet below the outline's front edge at that x are in front of the prop, otherwise behind it.
   */
  protected depthAt(spr: Phaser.GameObjects.Sprite) {
    let depth = spr.y;
    const half = spr.displayWidth / 4;
    for (const p of this.grid.query(spr.x - half, spr.y - spr.displayHeight, spr.x + half, spr.y, this.near)) {
      const b = p.bounds!;
      if (spr.x + half < b.left || spr.x - half > b.right || spr.y < b.top || spr.y - spr.displayHeight > b.bottom) continue;
      if (spr.x < p.minX || spr.x > p.maxX) continue;
      const front = frontEdgeAt(p.screen, spr.x);
      depth = spr.y >= front ? Math.max(depth, p.sprite.depth + 1) : Math.min(depth, p.sprite.depth - 1);
    }
    return depth;
  }

  /** Move in screen pixels, refusing steps that enter a prop's collision polygon or leave the map. */
  protected tryMove(sx: number, sy: number) {
    const nx = this.ranger.x + sx;
    const ny = this.ranger.y + sy;
    const w = screenToWorldDelta(nx, ny, this.ppm);
    const r = RANGER_RADIUS * this.ppm + 2;
    for (const p of this.grid.query(nx - r, ny - r, nx + r, ny + r, this.near)) if (circleHitsPolygon(w, RANGER_RADIUS, p.world)) return;
    if (!this.canStand(nx, ny)) return;
    this.ranger.setPosition(nx, ny);
  }
}

export const distW = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Largest y of the polygon's outline at screen x (its front edge, nearest the camera). */
function frontEdgeAt(poly: Pt[], x: number) {
  let best = -Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    if ((x < a.x && x < b.x) || (x > a.x && x > b.x)) continue;
    const y = a.x === b.x ? Math.max(a.y, b.y) : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    best = Math.max(best, y);
  }
  return best;
}

export function pointInPolygon(c: Pt, poly: Pt[]) {
  let inside = false;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const a = poly[k];
    const b = poly[m];
    if (a.y > c.y !== b.y > c.y && c.x < ((b.x - a.x) * (c.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's outline (world metres). */
function distToPolygon(c: Pt, poly: Pt[]) {
  let best = Infinity;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const a = poly[k];
    const b = poly[m];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Phaser.Math.Clamp(((c.x - a.x) * ex + (c.y - a.y) * ey) / (ex * ex + ey * ey || 1), 0, 1);
    best = Math.min(best, Math.hypot(a.x + t * ex - c.x, a.y + t * ey - c.y));
  }
  return best;
}

/** Does a circle (world metres) touch or lie inside a polygon (world metres)? */
export function circleHitsPolygon(c: Pt, r: number, poly: Pt[]) {
  return pointInPolygon(c, poly) || distToPolygon(c, poly) < r;
}
