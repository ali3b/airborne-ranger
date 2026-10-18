import Phaser from 'phaser';
import { props, type TiledMap } from './assets';
import { DIRS8, type Dir8 } from './iso';
import { isTouch } from './touch';

/**
 * The overview map (G6), like the original's map screen: the whole mission area in the game's iso orientation (the
 * map's top corner up, so north is up as in play), with the Ranger, the objective, the supply pods left and the
 * extraction zone.
 *
 * The picture is drawn here from the exported map: each ground tile's average colour from the map's own tileset
 * atlas, objects darker over their footprints. // FB-064: the generator's minimap (`ssg map preview --minimap`) shades
 * blocked cells even with --layers ground,objects and no --collision, so its river reads purple, not water.
 */

type Cell = [number, number];

export interface OverviewInfo {
  ranger: Cell;
  facing: Dir8;
  objective: Cell[];
  objectiveDone: boolean;
  extraction: Cell[];
  drop: Cell[];
  pods: Cell[];
  title: string;
}

interface EmbeddedTileset {
  firstgid: number;
  name: string;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  margin?: number;
  spacing?: number;
}

const PX = 2; // picture pixels per cell

export class Overview {
  isOpen = false;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private readonly key: string;

  constructor(
    private scene: Phaser.Scene & { toggleMap(): void },
    private tmj: TiledMap,
    mapName: string,
  ) {
    this.key = `overview:${mapName}`;
    if (!scene.textures.exists(this.key)) this.paint(mapName);
  }

  /** The map picture in map coordinates (x right, y down), PX pixels per cell, as a canvas texture. */
  private paint(mapName: string) {
    const { width: W, height: H } = this.tmj;
    const colours = new Map<number, [number, number, number]>();
    for (const ts of this.tmj.tilesets as unknown as EmbeddedTileset[]) {
      const tex = this.scene.textures.get(`map-img:${mapName}:${ts.name}`);
      const img = tex?.getSourceImage() as HTMLImageElement | undefined;
      if (!img || !img.width) continue;
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, img.width, img.height).data;
      const m = ts.margin ?? 0;
      const sp = ts.spacing ?? 0;
      for (let k = 0; k < ts.tilecount; k++) {
        const x0 = m + (k % ts.columns) * (ts.tilewidth + sp);
        const y0 = m + Math.floor(k / ts.columns) * (ts.tileheight + sp);
        let r = 0;
        let gg = 0;
        let b = 0;
        let n = 0;
        // Every other pixel is plenty for an average.
        for (let y = y0; y < y0 + ts.tileheight; y += 2) {
          for (let x = x0; x < x0 + ts.tilewidth; x += 2) {
            const o = (y * img.width + x) * 4;
            if (px[o + 3] < 128) continue;
            r += px[o];
            gg += px[o + 1];
            b += px[o + 2];
            n++;
          }
        }
        if (n) colours.set(ts.firstgid + k, [r / n, gg / n, b / n]);
      }
    }
    const canvas = this.scene.textures.createCanvas(this.key, W * PX, H * PX)!;
    const ctx = canvas.getContext();
    const out = ctx.createImageData(W * PX, H * PX);
    const ground = this.tmj.layers.find((l) => l.type === 'tilelayer' && l.name === 'ground') ?? this.tmj.layers.find((l) => l.type === 'tilelayer');
    const cellColour = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const col = colours.get(ground?.data?.[i] ?? 0) ?? [60, 70, 40];
      cellColour.set(col, i * 3);
    }
    // Objects: their footprint cells darker (trees, rocks, buildings read as clumps and blocks).
    const shade = new Float32Array(W * H).fill(1);
    const th = this.tmj.tileheight;
    for (const l of this.tmj.layers) {
      if (l.type !== 'objectgroup' || (l.class ?? l.name) !== 'objects') continue;
      for (const o of l.objects ?? []) {
        const p = props(o);
        const fw = Number(p.footprintW ?? 1);
        const fh = Number(p.footprintH ?? 1);
        const x0 = Math.round(o.x / th - fw / 2);
        const y0 = Math.round(o.y / th - fh / 2);
        const dark = /tree|palm|pine|fern|bush/.test(String(p.sprite ?? o.name)) ? 0.62 : 0.5;
        for (let y = Math.max(0, y0); y < Math.min(H, y0 + fh); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + fw); x++) shade[y * W + x] = Math.min(shade[y * W + x], dark);
      }
    }
    for (let y = 0; y < H * PX; y++) {
      for (let x = 0; x < W * PX; x++) {
        const c = Math.floor(y / PX) * W + Math.floor(x / PX);
        const o = (y * W * PX + x) * 4;
        const s = shade[c];
        out.data[o] = cellColour[c * 3] * s;
        out.data[o + 1] = cellColour[c * 3 + 1] * s;
        out.data[o + 2] = cellColour[c * 3 + 2] * s;
        out.data[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    canvas.refresh();
    canvas.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  open(info: OverviewInfo) {
    if (this.isOpen) return;
    this.isOpen = true;
    const sc = this.scene;
    const { width: sw, height: sh } = sc.scale;
    const { width: W, height: H } = this.tmj;
    const D = 2e9;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.parts.push(o);
      (o as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor(0);
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(D + this.parts.length);
      return o;
    };
    const bg = add(sc.add.rectangle(sw / 2, sh / 2, sw, sh, 0x10140c, 0.94).setInteractive());
    bg.on('pointerdown', () => sc.toggleMap());
    // k screen px per cell along the iso axes: the diamond is (W + H)·k wide and half that high.
    const top = 40;
    const bottom = 46;
    const k = Math.min((sw - 32) / (W + H), (2 * (sh - top - bottom)) / (W + H));
    const cx = sw / 2;
    const cy = top + (sh - top - bottom) / 2;
    const ox = cx - ((W - H) * k) / 2;
    const oy = cy - ((W + H) * k) / 4;
    const at = ([x, y]: Cell) => ({ x: ox + (x - y) * k, y: oy + ((x + y) * k) / 2 });
    // The picture turned 45° and squashed to 2:1 (a container's scale applies after its child's rotation).
    const a = k / (PX * Math.SQRT1_2 * 2);
    const box = add(sc.add.container(ox, oy).setScale(a * 2, a));
    box.add(sc.add.image(0, 0, this.key).setOrigin(0, 0).setRotation(Math.PI / 4));
    const g = add(sc.add.graphics());
    const outline = (area: Cell[], colour: number, alpha: number, fill = 0) => {
      if (!area.length) return;
      const pts = area.map(at);
      if (fill) g.fillStyle(colour, fill).fillPoints(pts, true);
      g.lineStyle(2, colour, alpha).strokePoints(pts, true);
    };
    const label = (area: Cell[], text: string, colour: string, below = false) => {
      if (!area.length) return;
      const pts = area.map(at);
      const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const y = below ? Math.max(...pts.map((p) => p.y)) + 4 : Math.min(...pts.map((p) => p.y)) - 4;
      add(sc.add.text(x, y, text, { fontFamily: 'monospace', fontSize: '11px', color: colour, backgroundColor: '#10140cbb', padding: { x: 3, y: 1 } }).setOrigin(0.5, below ? 0 : 1));
    };
    outline(info.drop, 0x60e080, 0.6);
    outline(info.objective, 0xffd040, 1, info.objectiveDone ? 0 : 0.25);
    outline(info.extraction, 0xff80c0, 1, info.objectiveDone ? 0.35 : 0.15);
    label(info.drop, 'DROP', '#60e080', true);
    label(info.objective, info.objectiveDone ? 'OBJECTIVE (DONE)' : 'OBJECTIVE', '#ffd040');
    label(info.extraction, 'EXTRACTION', '#ff80c0');
    for (const p of info.pods) {
      const q = at(p);
      g.fillStyle(0xe0c060, 1).fillRect(q.x - 3, q.y - 3, 6, 6);
      g.lineStyle(1, 0x10140c, 1).strokeRect(q.x - 3, q.y - 3, 6, 6);
    }
    // The Ranger: a blinking dot and a tick the way he faces (screen directions: north is up).
    const r = at(info.ranger);
    const ang = (DIRS8.indexOf(info.facing) * Math.PI) / 4;
    g.lineStyle(2, 0xffffff, 1).lineBetween(r.x, r.y, r.x + Math.cos(ang) * 12, r.y - Math.sin(ang) * 6);
    const dot = add(sc.add.circle(r.x, r.y, 6, 0xff4040).setStrokeStyle(2, 0xffffff));
    sc.tweens.add({ targets: dot, alpha: 0.25, yoyo: true, repeat: -1, duration: 350 });
    add(sc.add.text(sw / 2, 12, `${info.title} · ${W}×${H} m`, { fontFamily: 'monospace', fontSize: '15px', color: '#e8d27a' }).setOrigin(0.5, 0));
    const close = isTouch ? 'tap or MAP to return' : 'Tab / O to return';
    add(
      sc.add
        .text(sw / 2, sh - 12, `● RANGER   ■ SUPPLY POD   OBJECTIVE   EXTRACTION   N ↑   · ${close} (the clock runs)`, { fontFamily: 'monospace', fontSize: '12px', color: '#e8d27a' })
        .setOrigin(0.5, 1),
    );
  }

  close() {
    for (const p of this.parts) p.destroy();
    this.parts = [];
    this.isOpen = false;
  }
}
