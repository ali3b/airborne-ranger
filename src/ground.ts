import Phaser from 'phaser';
import type { TilesetEntry } from './assets';

/** The parts of a Tiled tileset (.tsj, from `ssg tileset export -f tsj`) the ground builder reads. */
interface Tsj {
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  /** `noisePeriod` (tiles): the large-scale ground noise repeats every P tiles; variant v is drawn for period cell
   * (v mod P, ⌊v/P⌋ mod P). */
  properties?: { name: string; value: number | string | boolean }[];
  tiles?: { id: number; properties?: { name: string; value: number | string | boolean }[] }[];
  wangsets?: { name: string; type: string; colors: { name: string }[]; wangtiles: { tileid: number; wangid: number[] }[] }[];
}

/**
 * Ground built from a generated corner tileset. `corner(x, y)` names the terrain at grid corner (x, y), for x and y in
 * 0..size; each tile (i, j) takes the tile whose four corners match (Tiled corner wangid: top-right, bottom-right,
 * bottom-left, top-left at indices 1, 3, 5, 7, in map-grid space: i runs down-right, j down-left), picking among
 * variants by position: the tileset's `noisePeriod` P and each tile's `variant` property say which variant was drawn
 * for period cell (i mod P, j mod P), so the large-scale ground noise runs on across tiles (as `ssg map export` does). Returns the layer, drawn so tile (i, j)'s centre is at iso.tileToScreen(i, j).
 * (Maps come from the generator later (G3); until then the terrain layout is code.)
 */
export function buildGround(scene: Phaser.Scene, ts: TilesetEntry, size: number, corner: (x: number, y: number) => string) {
  const tsj = scene.cache.json.get(`tileset:${ts.name}`) as Tsj;
  const ws = tsj.wangsets?.find((w) => w.type === 'corner');
  if (!ws) throw new Error(`tileset ${ts.name} has no corner wangset`);
  const colour = new Map(ws.colors.map((c, k) => [c.name, k + 1]));
  const byCorners = new Map<string, number[]>();
  for (const wt of ws.wangtiles) {
    const k = [1, 3, 5, 7].map((n) => wt.wangid[n]).join(',');
    byCorners.set(k, [...(byCorners.get(k) ?? []), wt.tileid]);
  }
  const P = Number(tsj.properties?.find((p) => p.name === 'noisePeriod')?.value ?? 1) || 1;
  const variantOf = new Map((tsj.tiles ?? []).map((t) => [t.id, Number(t.properties?.find((p) => p.name === 'variant')?.value ?? 0)]));
  const base = colour.get('grass') ?? 1;
  const fallback = byCorners.get([base, base, base, base].join(','))!;
  const c = (x: number, y: number) => colour.get(corner(x, y)) ?? base;
  const data: number[] = [];
  let missing = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const key = [c(i + 1, j), c(i + 1, j + 1), c(i, j + 1), c(i, j)].join(',');
      let ids = byCorners.get(key);
      if (!ids) {
        // A corner mix the tileset has no pair for (three terrains in one cell): draw the base terrain.
        missing++;
        ids = fallback;
      }
      const want = (i % P) + P * (j % P);
      const exact = ids.find((id) => (variantOf.get(id) ?? 0) === want);
      const h = Math.abs(Math.imul(i * 73856093 ^ j * 19349663, 0x9e3779b1)) >>> 7;
      data.push((exact ?? ids[h % ids.length]) + 1); // firstgid 1
    }
  }
  if (missing) console.warn(`ground: ${missing} tiles had no matching corner tile in ${ts.name} (drawn as the base terrain)`);

  // A Tiled isometric map in memory (the tileset embedded from the .tsj), loaded through Phaser's Tiled parser.
  const mapKey = `ground:${ts.name}`;
  scene.cache.tilemap.remove(mapKey);
  scene.cache.tilemap.add(mapKey, {
    format: Phaser.Tilemaps.Formats.TILED_JSON,
    data: {
      type: 'map',
      version: '1.10',
      orientation: 'isometric',
      renderorder: 'right-down',
      infinite: false,
      width: size,
      height: size,
      tilewidth: tsj.tilewidth,
      tileheight: tsj.tileheight,
      layers: [{ type: 'tilelayer', name: 'ground', id: 1, x: 0, y: 0, width: size, height: size, opacity: 1, visible: true, data }],
      tilesets: [{ firstgid: 1, name: tsj.name, tilewidth: tsj.tilewidth, tileheight: tsj.tileheight, tilecount: tsj.tilecount, columns: tsj.columns, image: tsj.image, imagewidth: tsj.imagewidth, imageheight: tsj.imageheight, margin: 0, spacing: 0 }],
    },
  });
  const map = scene.make.tilemap({ key: mapKey });
  const tileset = map.addTilesetImage(tsj.name, `tileset-img:${ts.name}`)!;
  // Phaser draws iso tile (i, j)'s image with its top-left at ((i - j) * w/2, (i + j) * h/2): shift by half a tile
  // so the diamond's centre lands on tileToScreen(i, j).
  const layer = map.createLayer('ground', tileset, -tsj.tilewidth / 2, -tsj.tileheight / 2)!;
  layer.setDepth(-1e9);
  // Phaser culls iso layers by the camera; draw the whole (small) map.
  layer.setSkipCull(true);
  return layer;
}
