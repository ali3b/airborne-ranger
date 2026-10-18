import Phaser from 'phaser';

/**
 * G6 large maps (128×256 m, ~1 000 props): what keeps a frame cheap.
 *
 * - `PropGrid`: a uniform grid in screen pixels over anything with a screen rectangle, so collision, line of sight,
 *   bullets and depth sorting look only at the props near a point instead of all of them.
 * - `isoCull`: a tile layer cull that walks only the tiles inside the camera (Phaser's isometric cull tests every
 *   tile of the layer every frame: 32 768 per layer here).
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CELL = 256; // px

export class PropGrid<T extends { bounds?: Rect }> {
  private cells = new Map<number, T[]>();
  private keys = new Map<T, number[]>();

  private static key(cx: number, cy: number) {
    return (cx + 2048) * 4096 + (cy + 2048);
  }

  /** Put (or move) an item under its current `bounds`. */
  update(item: T) {
    this.remove(item);
    const b = item.bounds;
    if (!b) return;
    const ks: number[] = [];
    for (let cy = Math.floor(b.top / CELL); cy <= Math.floor(b.bottom / CELL); cy++) {
      for (let cx = Math.floor(b.left / CELL); cx <= Math.floor(b.right / CELL); cx++) {
        const k = PropGrid.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
        ks.push(k);
      }
    }
    this.keys.set(item, ks);
  }

  remove(item: T) {
    const ks = this.keys.get(item);
    if (!ks) return;
    for (const k of ks) {
      const list = this.cells.get(k)!;
      const at = list.indexOf(item);
      if (at >= 0) list.splice(at, 1);
    }
    this.keys.delete(item);
  }

  clear() {
    this.cells.clear();
    this.keys.clear();
  }

  /** Items whose grid cells touch the rectangle (screen px); each once. */
  query(left: number, top: number, right: number, bottom: number, out: T[] = []): T[] {
    out.length = 0;
    const seen = new Set<T>();
    for (let cy = Math.floor(top / CELL); cy <= Math.floor(bottom / CELL); cy++) {
      for (let cx = Math.floor(left / CELL); cx <= Math.floor(right / CELL); cx++) {
        const list = this.cells.get(PropGrid.key(cx, cy));
        if (!list) continue;
        for (const it of list) {
          if (seen.has(it)) continue;
          seen.add(it);
          out.push(it);
        }
      }
    }
    return out;
  }

  /** Items whose grid cell holds the point (screen px). No copy: don't change the grid while iterating. */
  at(x: number, y: number): readonly T[] {
    return this.cells.get(PropGrid.key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? [];
  }
}

/**
 * Replace a Tiled isometric layer's cull with one that visits only the tiles under the camera, in right-down order.
 * Tile (i, j)'s image has its top-left at (layer.x + (i − j)·w/2, layer.y + (i + j)·h/2) (Phaser's iso tileToWorldXY).
 */
export function isoCull(layer: Phaser.Tilemaps.TilemapLayer, pad = 64) {
  const data = layer.layer;
  const w = data.baseTileWidth;
  const h = data.baseTileHeight;
  layer.cullCallback = (_l: Phaser.Tilemaps.LayerData, camera: Phaser.Cameras.Scene2D.Camera, out: Phaser.Tilemaps.Tile[]) => {
    out.length = 0;
    const v = camera.worldView;
    // d = i − j and s = i + j ranges whose tile images overlap the view (plus a pad).
    const dLo = Math.floor((v.x - pad - layer.x) / (w / 2)) - 1;
    const dHi = Math.ceil((v.right + pad - layer.x) / (w / 2)) + 1;
    const sLo = Math.floor((v.y - pad - layer.y) / (h / 2)) - 2;
    const sHi = Math.ceil((v.bottom + pad - layer.y) / (h / 2)) + 1;
    const jLo = Math.max(0, Math.floor((sLo - dHi) / 2));
    const jHi = Math.min(data.height - 1, Math.ceil((sHi - dLo) / 2));
    for (let j = jLo; j <= jHi; j++) {
      const iLo = Math.max(0, sLo - j, dLo + j);
      const iHi = Math.min(data.width - 1, sHi - j, dHi + j);
      const row = data.data[j];
      for (let i = iLo; i <= iHi; i++) {
        const t = row[i];
        if (t && t.index !== -1 && t.visible && t.alpha !== 0) out.push(t);
      }
    }
    return out;
  };
}
