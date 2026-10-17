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
  polygon: [number, number][];
  tiles: { u: number; v: number };
}

export interface ObjectBlock {
  footprint: { w: number; d: number };
  height: number;
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
  });
}

/** After loading: fix frame pivots and register animations as `<sprite>:<clip>_<dir>`. Call from create(). */
export function setupAssets(scene: Phaser.Scene): AssetManifest | null {
  const m = scene.cache.json.get('manifest') as AssetManifest | undefined;
  if (!m) return null;
  for (const s of Object.values(m.sprites)) {
    if (!scene.textures.exists(s.name)) continue;
    fixPivots(scene.textures.get(s.name));
    const aj = scene.cache.json.get(`anims:${s.name}`) as AnimJson | undefined;
    for (const a of aj?.anims ?? []) {
      // FB-007: anim keys are not namespaced (ranger and german both export "rifle_idle_E"), so prefix them.
      const key = `${s.name}:${a.key}`;
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frameRate: a.frameRate,
        repeat: a.repeat,
        frames: a.frames.map((f) => ({ key: s.name, frame: f.frame })),
      });
    }
  }
  return m;
}

/**
 * FB-001: the phaser3 export writes each frame's pivot relative to the TRIMMED rectangle, but Phaser applies
 * `pivot` as an origin over the untrimmed source size (realWidth/realHeight), which draws a soldier ~30 px too high.
 * Convert once per frame to source-relative.
 */
function fixPivots(tex: Phaser.Textures.Texture) {
  for (const name of tex.getFrameNames()) {
    const f = tex.get(name);
    if (!f.customPivot || !f.trimmed) continue;
    const sss = (f as unknown as { data: { spriteSourceSize: { x: number; y: number } } }).data.spriteSourceSize;
    f.pivotX = (f.pivotX * f.cutWidth + sss.x) / f.realWidth;
    f.pivotY = (f.pivotY * f.cutHeight + sss.y) / f.realHeight;
  }
}
