import Phaser from 'phaser';

/** One entry of public/assets/manifest.json (written by scripts/build-assets.mjs). */
export interface SpriteEntry {
  name: string;
  asset: string;
  pack: string | null;
  textureKey: string;
  atlas: string;
  path: string;
  anims: string;
  /** Prefix of the exported animation keys (`<base>/`). */
  animPrefix: string;
  meta: string | null;
  pixelsPerMetre: number | null;
  frameSize: [number, number];
  dirs: string[];
  clips: string[];
  /** Per clip: measured ground speed (locomotion only) and named events by frame. */
  clipInfo: Record<string, { speedMps: number | null; events: { frame: number; name: string }[] }>;
  /** Props: the export's object block (footprint, anchor, collision per direction). */
  object: ObjectBlock | null;
}

/** One rendered facing of an object: anchor and collision polygon in untrimmed frame pixels, span in tiles. */
export interface ObjectDirection {
  name: string;
  anchor: { x: number; y: number };
  /** Collision polygon in frame pixels (a tree's trunk: `collision.source` "base"). */
  polygon: [number, number][];
  /** The whole hull when the collision is only the base (trees). */
  canopyPolygon?: [number, number][];
  tiles: { u: number; v: number };
}

export interface ObjectBlock {
  footprint: { w: number; d: number };
  height: number;
  collision: { source: 'hull' | 'base' | 'bounds'; cut?: number; points: [number, number][] };
  directions: ObjectDirection[];
}

/** The parts of a character's `.meta.json` the game reads: the pivot and per-frame sockets. */
export interface CharacterMeta {
  pivot: { x: number; y: number };
  animations: { clip: string; direction: string; flipX: boolean; sockets: Record<string, { x: number; y: number }>[] }[];
}

export interface AssetManifest {
  tile: string;
  metresPerTile: number;
  view: string;
  /** Pixels per metre shared by every sprite (the tile lock). */
  ppm: number;
  sprites: Record<string, SpriteEntry>;
  /** Ground tilesets (Tiled .tsj + atlas PNG), by name. */
  tilesets: Record<string, TilesetEntry>;
}

export interface TilesetEntry {
  name: string;
  tsj: string;
  image: string;
  path: string;
}

interface AnimJson {
  anims: { key: string; frameRate: number; repeat: number; frames: { key: string; frame: string }[] }[];
}

/** Queue the manifest; once it arrives, queue every sprite's atlas and animations. Call from preload(). */
export function preloadAssets(scene: Phaser.Scene) {
  scene.load.json('manifest', 'assets/manifest.json');
  scene.load.once('filecomplete-json-manifest', (_key: string, _type: string, m: AssetManifest) => {
    for (const s of Object.values(m.sprites)) {
      // The sprite's own name is the texture key: the generator's base names collide between packs.
      scene.load.multiatlas(s.name, s.atlas, s.path);
      scene.load.json(`anims:${s.name}`, s.anims);
      // Characters' meta carries the per-frame sockets (grenade hand, muzzle).
      if (s.meta && !s.object) scene.load.json(`meta:${s.name}`, s.meta);
    }
    for (const t of Object.values(m.tilesets ?? {})) {
      scene.load.json(`tileset:${t.name}`, t.tsj);
      scene.load.image(`tileset-img:${t.name}`, t.image);
    }
  });
}

/**
 * After loading: register every sprite's animations under the exported keys (`<base>/<clip>_<dir>`, unique per model),
 * pointing at the texture loaded under the sprite's own name. Call from create().
 */
export function setupAssets(scene: Phaser.Scene): AssetManifest | null {
  const m = scene.cache.json.get('manifest') as AssetManifest | undefined;
  if (!m) return null;
  for (const s of Object.values(m.sprites)) {
    if (!scene.textures.exists(s.name)) continue;
    const aj = scene.cache.json.get(`anims:${s.name}`) as AnimJson | undefined;
    for (const a of aj?.anims ?? []) {
      if (scene.anims.exists(a.key)) continue;
      scene.anims.create({
        key: a.key,
        frameRate: a.frameRate,
        repeat: a.repeat,
        frames: a.frames.map((f) => ({ key: s.name, frame: f.frame })),
      });
    }
  }
  return m;
}

/** The animation key of a sprite's clip in one direction. */
export function animKey(s: SpriteEntry, clip: string, dir: string) {
  return `${s.animPrefix}${clip}_${dir}`;
}
