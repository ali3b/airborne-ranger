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
  /** FX: how the export says to blend the sheet (`add` for fire and explosions, `normal` for smoke). */
  blend?: string | null;
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
  /** Object states (intact, damaged, destroyed…): one animation each, sharing the frame size and anchor. */
  states?: ObjectState[];
  /** Transition animations between states (`intact_to_destroyed`), when the template applied to the model. */
  transitions?: { animation: string; from: string; to: string; asset: string }[];
}

/** One state of an object: its own model's footprint and per-direction collision polygon (frame pixels). */
export interface ObjectState {
  name: string;
  animation: string;
  asset: string;
  footprint: { w: number; d: number };
  height: number;
  sameAsBase: boolean;
  directions: { name: string; polygon: [number, number][]; tiles: { u: number; v: number } }[];
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
  /** Mission maps (Tiled .tmj with embedded tilesets, from `ssg map export --embed`), by name. */
  maps?: Record<string, MapEntry>;
}

export interface MapEntry {
  name: string;
  /** The generator's map id. */
  id: number;
  size: string;
  tmj: string;
  path: string;
  preview?: string;
  minimap?: string;
}

/** The parts of a Tiled .tmj the mission scene reads. */
export interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}
export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  polygon?: { x: number; y: number }[];
  polyline?: { x: number; y: number }[];
  properties?: TiledProperty[];
}
export interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup';
  class?: string;
  data?: number[];
  objects?: TiledObject[];
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation: string;
  layers: TiledLayer[];
  tilesets: { firstgid: number; name: string; image: string }[];
  properties?: TiledProperty[];
}

/** A Tiled object's custom properties as a plain record. */
export function props(o: { properties?: TiledProperty[] }): Record<string, string | number | boolean> {
  return Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value]));
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

/**
 * Queue the manifest; once it arrives, queue every sprite's atlas and animations. Call from preload(). `maps` names
 * the mission maps to load (G6: a 128×256 map is ~2 MB of .tmj and its own ground atlas, so only the one played).
 */
export function preloadAssets(scene: Phaser.Scene, maps: string[] = []) {
  // A later scene start finds the manifest cached (the loader skips it, so its filecomplete never fires).
  const cached = scene.cache.json.get('manifest') as AssetManifest | undefined;
  if (cached) return queueMaps(scene, cached, maps);
  scene.load.json('manifest', 'assets/manifest.json');
  scene.load.once('filecomplete-json-manifest', (_key: string, _type: string, m: AssetManifest) => {
    for (const s of Object.values(m.sprites)) {
      // The sprite's own name is the texture key: the generator's base names collide between packs. (Already
      // there: loaded by the loadout screen for its item icons.)
      if (!scene.textures.exists(s.name)) scene.load.multiatlas(s.name, s.atlas, s.path);
      scene.load.json(`anims:${s.name}`, s.anims);
      // Characters' meta carries the per-frame sockets (grenade hand, muzzle).
      if (s.meta && !s.object) scene.load.json(`meta:${s.name}`, s.meta);
    }
    for (const t of Object.values(m.tilesets ?? {})) {
      scene.load.json(`tileset:${t.name}`, t.tsj);
      scene.load.image(`tileset-img:${t.name}`, t.image);
    }
    queueMaps(scene, m, maps);
  });
}

/** Maps: the .tmj, then (once it arrives) each embedded tileset's atlas next to it. */
function queueMaps(scene: Phaser.Scene, m: AssetManifest, maps: string[]) {
  for (const mp of Object.values(m.maps ?? {})) {
    if (!maps.includes(mp.name) || scene.cache.json.exists(`tmj:${mp.name}`)) continue;
    scene.load.once(`filecomplete-json-tmj:${mp.name}`, (_k: string, _t: string, tmj: TiledMap) => {
      for (const ts of tmj.tilesets) scene.load.image(`map-img:${mp.name}:${ts.name}`, `${mp.path}${ts.image}`);
    });
    scene.load.json(`tmj:${mp.name}`, mp.tmj);
  }
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
