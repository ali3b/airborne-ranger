import type Phaser from 'phaser';
import type { AssetManifest, TiledMap, TiledObject } from '../assets';
import type { Dir8 } from '../iso';
import type { MissionConfig } from '../missions';
import type { Loadout } from '../loadout';
import type { Cause, Enemy, Placed, Pt } from '../scenes/Field';
import type { PropGrid } from '../world';
import type { Escortee } from './escort';

/**
 * G9: what the enemy systems (src/enemies/*) use of the field scene. Field's members are `protected` for its
 * subclasses; the systems get this view of the same object (`this as unknown as FieldHost`, made once in
 * Field.create), so Field.ts needs only a few marked hooks. Mission-only members are optional.
 */
export interface FieldHost extends Phaser.Scene {
  manifest: AssetManifest;
  ppm: number;
  ranger: Phaser.GameObjects.Sprite;
  facing: Dir8;
  prone: boolean;
  busy: boolean;
  dead: boolean;
  hp: number;
  god: boolean;
  props: Placed[];
  grid: PropGrid<Placed>;
  enemies: Enemy[];
  bullets: { pos: Pt; dir: Pt; left: number; owner: 'ranger' | 'enemy' }[];
  worldOf(p: Pt): Pt;
  propAt(w: Pt): Placed | undefined;
  placeObject(name: string, dir: Dir8, at: Pt, opts?: { hp?: number; state?: string; collision?: [number, number][] }): Placed | null;
  setCollision(p: Placed, polygon: [number, number][]): void;
  showState(p: Placed, anim: string, onDone?: () => void): void;
  play(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, ignoreIfPlaying?: boolean): boolean;
  socket(name: string, clip: string, dir: Dir8, event: string, sockets: string[]): Pt | null;
  fx(name: string, at: Pt, depth: number, opts?: { scale?: number; once?: boolean }): Phaser.GameObjects.Sprite | null;
  explode(at: Pt, opts?: { radius?: number; damage?: number; cause?: Cause; scale?: number; direct?: Placed; directDamage?: number }): void;
  hurtRanger(dmg: number): void;
  noise(src: Pt, radius: number): void;
  spawnEnemy(path: [number, number][], dir?: Dir8, start?: number): Enemy;
  fireBullet(from: Phaser.GameObjects.Sprite, muzzle: Pt, dir: Pt, range: number, owner: 'ranger' | 'enemy', hits: boolean): void;
  loudness(at: Pt, range: number): number;
  depthAt(spr: Phaser.GameObjects.Sprite): number;
  canStand(x: number, y: number): boolean;
  dustBurst(at: Pt): void;
  smokeAndFire(p: Placed, height: number): void;
  destroyProp(p: Placed, cause?: Cause): void;
  speedOf(clip: string): number;

  // Mission only (src/scenes/Mission.ts).
  tmj?: TiledMap;
  cfg?: MissionConfig;
  pods?: { contents: Loadout; taken: boolean }[];
  extractArea?: [number, number][];
  objectiveDone?: boolean;
  outcome?: string | null;
  timeLeft?: number;
  overview?: { isOpen: boolean };
  /** G10: who the enemy may shoot at besides the Ranger (src/enemies/escort.ts). */
  objective?: { exposed?(m: FieldHost): Escortee[] } | null;
}

/** The map's zones (Mission), or none (the test field). */
export function zonesOf(host: FieldHost): TiledObject[] {
  return host.tmj?.layers.find((l) => (l.class ?? l.name) === 'zones')?.objects ?? [];
}

/** A zone's points in map cells (Tiled pixels are `tileheight` per cell on both axes). */
export function zoneCells(host: FieldHost, z: TiledObject): [number, number][] {
  const th = host.tmj!.tileheight;
  const x = z.x / th;
  const y = z.y / th;
  const pts = z.polygon ?? z.polyline;
  if (pts) return pts.map((q) => [x + q.x / th, y + q.y / th]);
  if (z.width || z.height) {
    const w = z.width / th;
    const h = z.height / th;
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  return [[x, y]];
}

/** World direction (x east, y north) of an 8-direction name. */
export function dirVec(d: string): Pt {
  const k = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'].indexOf(d);
  const a = (Math.max(0, k) * Math.PI) / 4;
  return { x: Math.cos(a), y: Math.sin(a) };
}

export const distW = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** A small seeded random (mulberry32) so a map's mines land in the same places every time. */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function inPoly([x, y]: [number, number], poly: [number, number][]) {
  let inside = false;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const [ax, ay] = poly[k];
    const [bx, by] = poly[m];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polyline (same units). */
export function distToPolyline(p: [number, number], line: [number, number][]) {
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, ay] = line[k];
    const [bx, by] = line[k + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - ay) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(ax + t * ex - p[0], ay + t * ey - p[1]));
  }
  return best;
}
