import Phaser from 'phaser';
import { preloadAssets, setupAssets, type AssetManifest, type SpriteEntry } from '../assets';
import { dirFromWorld, tileToScreen, worldToScreenDelta, screenToWorldDelta, type Dir8, TILE_W, TILE_H } from '../iso';

const MAP = 28; // tiles per side

/** Hand-placed props: tile (i, j), sprite name, facing (one of the 4 diagonals the props were rendered in). */
const PROPS: { i: number; j: number; name: string; dir: Dir8 }[] = [
  { i: 18, j: 8, name: 'bunker', dir: 'SW' },
  { i: 14, j: 9, name: 'sandbags', dir: 'SE' },
  { i: 15, j: 11, name: 'sandbags', dir: 'SW' },
  { i: 11, j: 16, name: 'wire', dir: 'SE' },
  { i: 13, j: 17, name: 'wire', dir: 'SE' },
  { i: 9, j: 15, name: 'wire', dir: 'SW' },
  { i: 3, j: 11, name: 'tree', dir: 'SE' },
  { i: 23, j: 3, name: 'tree', dir: 'NE' },
  { i: 6, j: 23, name: 'tree', dir: 'SW' },
  { i: 16, j: 14, name: 'crate', dir: 'SE' },
  { i: 17, j: 14, name: 'crate', dir: 'SW' },
  { i: 20, j: 12, name: 'crate', dir: 'NE' },
];

/**
 * Ground speeds in m/s, hand-tuned. FB-008: the export's speedMps is missing for the walk and nonsense for the run
 * (0.077 m/s), so the game can't match the feet.
 */
const SPEED = { walk: 1.5, run: 3.6, crawl: 0.5 };

interface Collider {
  x: number;
  y: number;
  r: number; // world metres
}

export class Field extends Phaser.Scene {
  private manifest!: AssetManifest;
  private ranger!: Phaser.GameObjects.Sprite;
  private enemy?: Phaser.GameObjects.Sprite;
  private facing: Dir8 = 'SE';
  private prone = false;
  private busy = false; // a one-shot (shoot) is playing
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private colliders: Collider[] = [];
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
    this.drawGround();

    for (const p of PROPS) this.placeProp(p);

    const start = tileToScreen(9, 9);
    this.ranger = this.add.sprite(start.x, start.y, 'ranger');
    this.play(this.ranger, 'ranger', 'rifle_idle', this.facing);

    if (m.sprites.german) {
      const e = tileToScreen(13, 5);
      this.enemy = this.add.sprite(e.x, e.y, 'german');
      this.play(this.enemy, 'german', 'rifle_idle', 'SW');
    }

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys('W,A,S,D,SHIFT,X,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys.X.on('down', () => {
      this.prone = !this.prone;
    });
    this.keys.SPACE.on('down', () => this.shoot());

    const top = tileToScreen(0, 0);
    const right = tileToScreen(MAP, 0);
    const left = tileToScreen(0, MAP);
    const bottom = tileToScreen(MAP, MAP);
    this.cameras.main.setBounds(left.x - 64, top.y - 400, right.x - left.x + 128, bottom.y - top.y + 480);
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
        const path = Math.abs(i - j - 2) <= 1 && i > 3;
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

  private placeProp(p: { i: number; j: number; name: string; dir: Dir8 }) {
    const s: SpriteEntry | undefined = this.manifest.sprites[p.name];
    if (!s) return;
    const pos = tileToScreen(p.i, p.j);
    const spr = this.add.sprite(pos.x, pos.y, p.name);
    this.play(spr, p.name, s.clips[0], p.dir);
    spr.setDepth(pos.y);
    // FB-006: exports carry no footprint or collision shape; approximate with a circle from the model's size.
    if (s.size) {
      const r = (Math.min(s.size[0], s.size[2]) / 2) * 0.9;
      this.colliders.push({ x: pos.x, y: pos.y, r: p.name === 'tree' ? 0.4 : r });
    }
  }

  private play(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, ignoreIfPlaying = true) {
    const key = `${name}:${clip}_${dir}`;
    if (!this.anims.exists(key)) return;
    spr.play(key, ignoreIfPlaying);
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
      const len = Math.hypot(dx, dy);
      const speed = this.prone ? SPEED.crawl : running ? SPEED.run : SPEED.walk;
      const step = worldToScreenDelta((dx / len) * speed * dt, (dy / len) * speed * dt, this.manifest.ppm);
      this.tryMove(step.x, step.y);
      this.play(this.ranger, 'ranger', this.prone ? 'rifle_crawl' : running ? 'rifle_run' : 'rifle_walk', this.facing);
    } else if (!this.busy) {
      this.play(this.ranger, 'ranger', this.prone ? 'rifle_prone_idle' : 'rifle_idle', this.facing);
    }
    this.ranger.setDepth(this.ranger.y);

    if (this.enemy) {
      const w = screenToWorldDelta(this.ranger.x - this.enemy.x, this.ranger.y - this.enemy.y, this.manifest.ppm);
      this.play(this.enemy, 'german', 'rifle_idle', dirFromWorld(w.x, w.y));
      this.enemy.setDepth(this.enemy.y);
    }

    const t = { x: this.ranger.x, y: this.ranger.y };
    this.hud.setText(
      `WASD/arrows move · Shift run · X prone · Space shoot\n${this.ranger.anims.currentAnim?.key ?? '-'}  (${t.x.toFixed(0)}, ${t.y.toFixed(0)})`,
    );
  }

  /** Move in screen pixels, refusing steps that enter a prop collider or leave the map. */
  private tryMove(sx: number, sy: number) {
    const nx = this.ranger.x + sx;
    const ny = this.ranger.y + sy;
    const ppm = this.manifest.ppm;
    for (const c of this.colliders) {
      const w = screenToWorldDelta(nx - c.x, ny - c.y, ppm);
      if (Math.hypot(w.x, w.y) < c.r + 0.3) return;
    }
    // Stay on the diamond map.
    const i = (nx / (TILE_W / 2) + ny / (TILE_H / 2)) / 2;
    const j = (ny / (TILE_H / 2) - nx / (TILE_W / 2)) / 2;
    if (i < 0.5 || j < 0.5 || i > MAP - 1.5 || j > MAP - 1.5) return;
    this.ranger.setPosition(nx, ny);
  }
}
