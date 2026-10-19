import { screenToWorldDelta } from '../iso';
import type { FieldHost } from './host';
import type { Pt } from '../scenes/Field';

/**
 * G9 sight lines. Field.sees() already stops a look at any prop's collider (buildings, walls, bunkers, rocks, tree
 * trunks); this adds the tree canopies (the export's `canopyPolygon`; trees collide only at the trunk) as cover
 * that hides the Ranger, and scales the view range: shorter at dusk or night, in a trench, and by difficulty.
 * (Prone already shortens it in Field.)
 */
const CANOPY_SPRITES = ['tree', 'tree_small', 'palm', 'pine_snow', 'pine_snow_small'];
const CELL = 0.5; // metres
const key = (x: number, y: number) => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(y / CELL) + 32768);

export class Sight {
  /** Cells (CELL m, world) under a tree canopy. */
  private canopy = new Set<number>();
  /** Multiplier on the enemy view range from the light (dusk 0.7, night 0.5). */
  light = 1;

  constructor(private host: FieldHost) {
    const cfg = host.cfg as { dusk?: boolean; night?: boolean } | undefined;
    this.light = cfg?.night ? 0.5 : cfg?.dusk ? 0.7 : 1;
    for (const p of host.props) if (CANOPY_SPRITES.includes(p.name)) this.addCanopy(p);
  }

  private addCanopy(p: { name: string; dir: string; at: Pt; anchor: Pt }) {
    const d = this.host.manifest.sprites[p.name]?.object?.directions.find((x) => x.name === p.dir);
    const poly = d?.canopyPolygon;
    if (!poly?.length) return;
    // Only the middle of the canopy (shrunk 30 % towards its centre): an edge leaf shouldn't hide a man.
    const w = poly.map(([x, y]) => screenToWorldDelta(p.at.x + x - p.anchor.x, p.at.y + y - p.anchor.y, this.host.ppm));
    const cx = w.reduce((s, q) => s + q.x, 0) / w.length;
    const cy = w.reduce((s, q) => s + q.y, 0) / w.length;
    const s = w.map((q) => ({ x: cx + (q.x - cx) * 0.7, y: cy + (q.y - cy) * 0.7 }));
    const xs = s.map((q) => q.x);
    const ys = s.map((q) => q.y);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += CELL)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += CELL) if (inside({ x: x + CELL / 2, y: y + CELL / 2 }, s)) this.canopy.add(key(x + CELL / 2, y + CELL / 2));
  }

  /** Cells under canopies (for the load check). */
  get canopyCells() {
    return this.canopy.size;
  }

  /** Is the world point `q`, `t` m along a look of `d` m, hidden by a canopy? (Not the metre at either end.) */
  blocks(q: Pt, t: number, d: number) {
    return t > 1 && t < d - 1 && this.canopy.has(key(q.x, q.y));
  }
}

function inside(c: Pt, poly: Pt[]) {
  let r = false;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const a = poly[k];
    const b = poly[m];
    if (a.y > c.y !== b.y > c.y && c.x < ((b.x - a.x) * (c.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
