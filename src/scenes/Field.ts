import Phaser from 'phaser';
import { preloadAssets, setupAssets, type AssetManifest, type SpriteEntry, type ObjectDirection, type CharacterMeta } from '../assets';
import { DIRS8, dirFromWorld, tileToScreen, worldToScreenDelta, screenToWorldDelta, type Dir8, TILE_W, TILE_H } from '../iso';

const MAP = 40; // tiles per side (1 m per tile)

/**
 * Hand-placed props: the top tile (i, j) of the block the prop covers, sprite name, and facing (one of the 4
 * diagonals the props were rendered in, which line them up with the tile grid). The block's size comes from the
 * export's `object.directions[].tiles` (u, v).
 */
const PROPS: { i: number; j: number; name: string; dir: Dir8 }[] = [
  { i: 22, j: 6, name: 'bunker', dir: 'SW' },
  { i: 17, j: 12, name: 'sandbags', dir: 'SE' },
  { i: 19, j: 16, name: 'sandbags', dir: 'SW' },
  { i: 13, j: 22, name: 'wire', dir: 'SE' },
  { i: 17, j: 23, name: 'wire', dir: 'SE' },
  { i: 10, j: 20, name: 'wire', dir: 'SW' },
  { i: 3, j: 13, name: 'tree', dir: 'SE' },
  { i: 31, j: 2, name: 'tree', dir: 'NE' },
  { i: 6, j: 31, name: 'tree', dir: 'SW' },
  { i: 22, j: 19, name: 'crate', dir: 'SE' },
  { i: 24, j: 19, name: 'crate', dir: 'SW' },
  { i: 27, j: 16, name: 'crate', dir: 'NE' },
];

/**
 * FB-017: a tree's collision polygon is the hull of its whole canopy (5 × 5.7 m), so it would block a 6 × 6 tile
 * area. Trees collide with a trunk circle (radius in metres) at the model origin instead.
 */
const TRUNK: Record<string, number> = { tree: 0.35 };

const RANGER_RADIUS = 0.3; // metres
const GRENADE_RANGE = 8; // metres
const GRENADE_FLIGHT = 0.9; // seconds
const GRENADE_APEX = 70; // px above the straight line at mid-flight
const BLAST_RADIUS = 3; // metres

type Pt = { x: number; y: number };

/** A prop on the field: its collision polygon in world metres and its screen outline for depth sorting. */
interface Placed {
  sprite: Phaser.GameObjects.Image;
  world: Pt[];
  screen: Pt[];
  minX: number;
  maxX: number;
}

interface Grenade {
  ball: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
  from: Pt; // ground point (screen px)
  to: Pt;
  h0: number; // starting height above the ground (screen px)
  t: number;
}

export class Field extends Phaser.Scene {
  private manifest!: AssetManifest;
  private ppm = 45.25;
  private ranger!: Phaser.GameObjects.Sprite;
  private enemy?: Phaser.GameObjects.Sprite;
  private enemyDead = false;
  private facing: Dir8 = 'SE';
  private prone = false;
  private busy = false; // a one-shot (shoot, throw) is playing
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private props: Placed[] = [];
  private grenades: Grenade[] = [];
  private grenadesThrown = 0;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super('field');
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    const m = setupAssets(this);
    if (!m || !m.sprites.ranger) {
      this.add.text(20, 20, 'No assets: run `npm run assets`', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8080' });
      return;
    }
    this.manifest = m;
    this.ppm = m.ppm;
    this.drawGround();

    for (const p of PROPS) this.placeProp(p);

    const start = tileToScreen(12, 12);
    this.ranger = this.add.sprite(start.x, start.y, 'ranger');
    this.play(this.ranger, 'ranger', 'rifle_idle', this.facing);

    if (m.sprites.german) {
      const e = tileToScreen(17, 8);
      this.enemy = this.add.sprite(e.x, e.y, 'german');
      this.play(this.enemy, 'german', 'rifle_idle', 'SW');
    }

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys('W,A,S,D,SHIFT,X,SPACE,G') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys.X.on('down', () => {
      if (!this.busy) this.prone = !this.prone;
    });
    this.keys.SPACE.on('down', () => this.shoot());
    this.keys.G.on('down', () => this.throwGrenade());

    const top = tileToScreen(0, 0);
    const right = tileToScreen(MAP, 0);
    const left = tileToScreen(0, MAP);
    const bottom = tileToScreen(MAP, MAP);
    this.cameras.main.setBounds(left.x - 64, top.y - 600, right.x - left.x + 128, bottom.y - top.y + 680);
    this.cameras.main.startFollow(this.ranger, true, 0.15, 0.15);
    this.cameras.main.setRoundPixels(true);

    this.hud = this.add
      .text(10, 10, '', { fontFamily: 'monospace', fontSize: '14px', color: '#e8d27a', backgroundColor: '#10140ccc', padding: { x: 6, y: 4 } })
      .setScrollFactor(0)
      .setDepth(1e9);
  }

  /** Procedural ground (FB-010: the generator has no ground tiles yet). */
  private drawGround() {
    const g = this.add.graphics().setDepth(-1e9);
    const rnd = new Phaser.Math.RandomDataGenerator(['field']);
    for (let i = 0; i < MAP; i++) {
      for (let j = 0; j < MAP; j++) {
        const c = tileToScreen(i, j);
        const path = Math.abs(i - j - 3) <= 1 && i > 5;
        const base = path ? [0x7a, 0x68, 0x48] : [0x4e, 0x66, 0x32];
        const v = rnd.between(-8, 8);
        const col = Phaser.Display.Color.GetColor(base[0] + v, base[1] + v, base[2] + v);
        g.fillStyle(col, 1);
        g.lineStyle(1, 0x000000, 0.08);
        const pts = [
          new Phaser.Math.Vector2(c.x, c.y - TILE_H / 2),
          new Phaser.Math.Vector2(c.x + TILE_W / 2, c.y),
          new Phaser.Math.Vector2(c.x, c.y + TILE_H / 2),
          new Phaser.Math.Vector2(c.x - TILE_W / 2, c.y),
        ];
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
      }
    }
  }

  /**
   * Place a prop from its export's `object` block: the anchor pixel (the footprint's ground centre) goes on the
   * centre of the block of tiles it covers, and the per-direction collision polygon becomes the collider.
   */
  private placeProp(p: { i: number; j: number; name: string; dir: Dir8 }) {
    const s: SpriteEntry | undefined = this.manifest.sprites[p.name];
    const d: ObjectDirection | undefined = s?.object?.directions.find((x) => x.name === p.dir);
    const anim = s && this.anims.get(`${p.name}:${s.clips[0]}_${p.dir}`);
    if (!s || !d || !anim) return;
    const frame = anim.frames[0].frame;
    // Tile (i, j) spans i±0.5 around tileToScreen(i, j), so the block's centre is half its size in from the top tile.
    const at = tileToScreen(p.i - 0.5 + d.tiles.u / 2, p.j - 0.5 + d.tiles.v / 2);
    const img = this.add.image(at.x, at.y, p.name, frame.name);
    img.setOrigin(d.anchor.x / frame.realWidth, d.anchor.y / frame.realHeight);
    let screen = d.polygon.map(([x, y]) => ({ x: at.x + x - d.anchor.x, y: at.y + y - d.anchor.y }));
    let depth = at.y;
    const trunk = TRUNK[p.name];
    if (trunk) {
      // FB-017: collide with the trunk at the model origin (the frame pivot) instead of the canopy hull.
      const c = { x: at.x + frame.pivotX * frame.realWidth - d.anchor.x, y: at.y + frame.pivotY * frame.realHeight - d.anchor.y };
      screen = Array.from({ length: 8 }, (_, k) => {
        const o = worldToScreenDelta(Math.cos((k * Math.PI) / 4) * trunk, Math.sin((k * Math.PI) / 4) * trunk, this.ppm);
        return { x: c.x + o.x, y: c.y + o.y };
      });
      depth = c.y;
    }
    img.setDepth(depth);
    this.props.push({
      sprite: img,
      screen,
      world: screen.map((q) => screenToWorldDelta(q.x, q.y, this.ppm)),
      minX: Math.min(...screen.map((q) => q.x)),
      maxX: Math.max(...screen.map((q) => q.x)),
    });
  }

  private play(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, ignoreIfPlaying = true) {
    const key = `${name}:${clip}_${dir}`;
    if (!this.anims.exists(key)) return false;
    spr.play(key, ignoreIfPlaying);
    return true;
  }

  private shoot() {
    const clip = this.prone ? 'rifle_prone_shoot' : 'rifle_shoot';
    if (!this.ranger || this.busy || !this.anims.exists(`ranger:${clip}_${this.facing}`)) return;
    this.busy = true;
    this.play(this.ranger, 'ranger', clip, this.facing, false);
    this.ranger.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.busy = false;
    });
  }

  /** Throw a grenade: the throw move's `release` event spawns it at the throwing hand's socket on that frame. */
  private throwGrenade() {
    const clip = 'rifle_throw';
    if (!this.ranger || this.busy || this.prone || !this.anims.exists(`ranger:${clip}_${this.facing}`)) return;
    const meta = this.cache.json.get('meta:ranger') as CharacterMeta | undefined;
    const release = this.manifest.sprites.ranger.clipInfo[clip]?.events.find((e) => e.name === 'release')?.frame ?? 0;
    const dir = this.facing;
    this.busy = true;
    let thrown = false;
    const fire = () => {
      if (thrown) return;
      thrown = true;
      const sockets = meta?.animations.find((a) => a.clip === clip && a.direction === dir)?.sockets[release];
      // The procedural throw uses the free left hand by default (the rifle stays in the right).
      const hand = sockets?.hand_l ?? sockets?.hand_r;
      const off = hand && meta ? { x: hand.x - meta.pivot.x, y: hand.y - meta.pivot.y } : { x: 0, y: -60 };
      this.spawnGrenade(dir, off);
    };
    const onFrame = (_a: Phaser.Animations.Animation, f: Phaser.Animations.AnimationFrame) => {
      if (f.index - 1 >= release) fire(); // AnimationFrame.index is 1-based, events are 0-based
    };
    this.ranger.on(Phaser.Animations.Events.ANIMATION_UPDATE, onFrame);
    this.ranger.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.ranger.off(Phaser.Animations.Events.ANIMATION_UPDATE, onFrame);
      fire();
      this.busy = false;
    });
    this.play(this.ranger, 'ranger', clip, dir, false);
  }

  /** A grenade leaves the hand at `off` (screen px from the Ranger's feet) and arcs to a point ahead of him. */
  private spawnGrenade(dir: Dir8, off: Pt) {
    this.grenadesThrown++;
    const a = (DIRS8.indexOf(dir) * Math.PI) / 4;
    const reach = worldToScreenDelta(Math.cos(a) * GRENADE_RANGE, Math.sin(a) * GRENADE_RANGE, this.ppm);
    const from = { x: this.ranger.x + off.x, y: this.ranger.y };
    const to = { x: this.ranger.x + reach.x, y: this.ranger.y + reach.y };
    const ball = this.add.circle(from.x, from.y + off.y, 3, 0x2c3a1c).setStrokeStyle(1, 0x101408);
    const shadow = this.add.ellipse(from.x, from.y, 7, 3, 0x000000, 0.35);
    this.grenades.push({ ball, shadow, from, to, h0: -off.y, t: 0 });
  }

  /** Placeholder blast: flash, expanding scorch ring, camera shake; kills the enemy inside the radius. */
  private explode(at: Pt) {
    const flash = this.add.circle(at.x, at.y - 10, 10, 0xffd060, 0.95).setDepth(at.y + 1);
    const ring = this.add.ellipse(at.x, at.y, 20, 10, 0xff6020, 0.6).setDepth(at.y);
    this.tweens.add({ targets: flash, scale: 5, alpha: 0, duration: 450, onComplete: () => flash.destroy() });
    const r = BLAST_RADIUS * this.ppm;
    this.tweens.add({ targets: ring, displayWidth: r * 2, displayHeight: r, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
    this.cameras.main.shake(180, 0.006);
    if (this.enemy && !this.enemyDead) {
      const w = screenToWorldDelta(this.enemy.x - at.x, this.enemy.y - at.y, this.ppm);
      if (Math.hypot(w.x, w.y) < BLAST_RADIUS) {
        this.enemyDead = true;
        if (!this.play(this.enemy, 'german', 'rifle_death', dirFromWorld(-w.x, -w.y), false)) this.enemy.setVisible(false);
      }
    }
  }

  private updateGrenades(dt: number) {
    for (const g of this.grenades) {
      g.t = Math.min(1, g.t + dt / GRENADE_FLIGHT);
      const x = Phaser.Math.Linear(g.from.x, g.to.x, g.t);
      const y = Phaser.Math.Linear(g.from.y, g.to.y, g.t);
      const h = g.h0 * (1 - g.t) + 4 * GRENADE_APEX * g.t * (1 - g.t);
      g.shadow.setPosition(x, y).setDepth(y - 1);
      g.ball.setPosition(x, y - h).setDepth(y + 2);
      if (g.t >= 1) {
        g.ball.destroy();
        g.shadow.destroy();
        this.explode({ x, y });
      }
    }
    this.grenades = this.grenades.filter((g) => g.t < 1);
  }

  /** Ground speed of a locomotion clip, as measured by the generator (`speedMps`), so the feet don't slide. */
  private speedOf(clip: string) {
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
    const moving = dx !== 0 || dy !== 0;
    const running = k.SHIFT.isDown && !this.prone;

    if (moving && !this.busy) {
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

    if (this.enemy) {
      if (!this.enemyDead) {
        const w = screenToWorldDelta(this.ranger.x - this.enemy.x, this.ranger.y - this.enemy.y, this.ppm);
        this.play(this.enemy, 'german', 'rifle_idle', dirFromWorld(w.x, w.y));
      }
      this.enemy.setDepth(this.depthAt(this.enemy));
    }
    this.updateGrenades(dt);

    const t = { x: this.ranger.x, y: this.ranger.y };
    this.hud.setText(
      `WASD/arrows move · Shift run · X prone · Space shoot · G grenade (${this.grenadesThrown})\n${this.ranger.anims.currentAnim?.key ?? '-'}  (${t.x.toFixed(0)}, ${t.y.toFixed(0)})`,
    );
  }

  /**
   * Iso depth for a character at its feet: by screen y, but where a prop's sprite overlaps, its ground outline
   * decides: feet below the outline's front edge at that x are in front of the prop, otherwise behind it.
   */
  private depthAt(spr: Phaser.GameObjects.Sprite) {
    let depth = spr.y;
    const half = spr.displayWidth / 4;
    for (const p of this.props) {
      const b = p.sprite.getBounds();
      if (spr.x + half < b.left || spr.x - half > b.right || spr.y < b.top || spr.y - spr.displayHeight > b.bottom) continue;
      if (spr.x < p.minX || spr.x > p.maxX) continue;
      const front = frontEdgeAt(p.screen, spr.x);
      depth = spr.y >= front ? Math.max(depth, p.sprite.depth + 1) : Math.min(depth, p.sprite.depth - 1);
    }
    return depth;
  }

  /** Move in screen pixels, refusing steps that enter a prop's collision polygon or leave the map. */
  private tryMove(sx: number, sy: number) {
    const nx = this.ranger.x + sx;
    const ny = this.ranger.y + sy;
    const w = screenToWorldDelta(nx, ny, this.ppm);
    for (const p of this.props) if (circleHitsPolygon(w, RANGER_RADIUS, p.world)) return;
    // Stay on the diamond map.
    const i = (nx / (TILE_W / 2) + ny / (TILE_H / 2)) / 2;
    const j = (ny / (TILE_H / 2) - nx / (TILE_W / 2)) / 2;
    if (i < 0.5 || j < 0.5 || i > MAP - 1.5 || j > MAP - 1.5) return;
    this.ranger.setPosition(nx, ny);
  }
}

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

/** Does a circle (world metres) touch or lie inside a polygon (world metres)? */
function circleHitsPolygon(c: Pt, r: number, poly: Pt[]) {
  let inside = false;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const a = poly[k];
    const b = poly[m];
    if (a.y > c.y !== b.y > c.y && c.x < ((b.x - a.x) * (c.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Phaser.Math.Clamp(((c.x - a.x) * ex + (c.y - a.y) * ey) / (ex * ex + ey * ey || 1), 0, 1);
    if (Math.hypot(a.x + t * ex - c.x, a.y + t * ey - c.y) < r) return true;
  }
  return inside;
}
