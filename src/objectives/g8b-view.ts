import Phaser from 'phaser';
import type { Mission } from '../scenes/Mission';
import type { Enemy, Placed, Pt, Cause } from '../scenes/Field';
import type { AssetManifest, TiledMap, TiledObject } from '../assets';
import type { MissionConfig } from '../missions';
import type { Dir8 } from '../iso';

/**
 * G8 (lane g8b): the parts of a Mission an objective works with. Most are protected in Field / Mission (another lane
 * edits those files at the same time), so the objectives read them through this view instead of widening them.
 */
export interface MissionView {
  cfg: MissionConfig;
  manifest: AssetManifest;
  ppm: number;
  tmj: TiledMap;
  ranger: Phaser.GameObjects.Sprite;
  facing: Dir8;
  prone: boolean;
  busy: boolean;
  dead: boolean;
  god: boolean;
  hp: number;
  timeLeft: number;
  objectiveDone: boolean;
  objectiveArea: [number, number][];
  extractArea: [number, number][];
  enemies: Enemy[];
  props: Placed[];
  grid: { query(left: number, top: number, right: number, bottom: number, out?: Placed[]): Placed[] };
  targets: Placed[];
  bullets: { pos: Pt; left: number; owner: 'ranger' | 'enemy'; tracer: Phaser.GameObjects.Rectangle }[];
  bombs: { sprite: Phaser.GameObjects.GameObject; label: Phaser.GameObjects.Text; at: Pt; fuse: number }[];
  shotsFired: number;
  grenadesThrown: number;
  arsenal: { lawsFired: number; bombsPlaced: number; heals: number; reloads: number; knifeKills: number };
  touchExtras: Mission['touchExtras'];
  add: Phaser.GameObjects.GameObjectFactory;
  tweens: Phaser.Tweens.TweenManager;
  time: Phaser.Time.Clock;
  input: Phaser.Input.InputPlugin;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  anims: Phaser.Animations.AnimationManager;
  worldOf(p: Pt): Pt;
  cell(x: number, y: number): [number, number];
  rangerCell(): { x: number; y: number };
  sees(e: Enemy): boolean;
  propAt(w: Pt): Placed | undefined;
  play(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, ignoreIfPlaying?: boolean): boolean;
  oneShot(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, event: string, fire: () => void, done: () => void): void;
  explode(at: Pt, opts?: { radius?: number; damage?: number; cause?: Cause; scale?: number; direct?: Placed; directDamage?: number }): void;
  fireBullet(from: Phaser.GameObjects.Sprite, muzzle: Pt, dir: Pt, range: number, owner: 'ranger' | 'enemy', hits: boolean): void;
  noise(src: Pt, radius: number): void;
  depthAt(spr: Phaser.GameObjects.Sprite): number;
  footsteps(spr: Phaser.GameObjects.Sprite, name: string): void;
}

export const view = (m: Mission) => m as unknown as MissionView;

/** The map's zones (Tiled objects of the `zones` layer). */
export function zones(v: MissionView): TiledObject[] {
  return v.tmj.layers.find((l) => (l.class ?? l.name) === 'zones')?.objects ?? [];
}

export function inArea([x, y]: [number, number], poly: [number, number][]) {
  let inside = false;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const [ax, ay] = poly[k];
    const [bx, by] = poly[m];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export const centre = (a: [number, number][]): { x: number; y: number } => ({ x: a.reduce((s, p) => s + p[0], 0) / a.length, y: a.reduce((s, p) => s + p[1], 0) / a.length });

export const distM = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance (m) from a world point to a prop's collider outline (0 inside). */
export function distToProp(w: Pt, p: Placed) {
  if (!p.world.length) return distM(w, p.at);
  let inside = false;
  let best = Infinity;
  const poly = p.world;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const a = poly[k];
    const b = poly[m];
    if (a.y > w.y !== b.y > w.y && w.x < ((b.x - a.x) * (w.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Phaser.Math.Clamp(((w.x - a.x) * ex + (w.y - a.y) * ey) / (ex * ex + ey * ey || 1), 0, 1);
    best = Math.min(best, Math.hypot(a.x + t * ex - w.x, a.y + t * ey - w.y));
  }
  return inside ? 0 : best;
}

/** A short floating message over the Ranger. */
export function say(v: MissionView, text: string, color = '#e8d27a') {
  const t = v.add
    .text(v.ranger.x, v.ranger.y - 110, text, { fontFamily: 'monospace', fontSize: '14px', color, backgroundColor: '#10140caa', padding: { x: 4, y: 2 } })
    .setOrigin(0.5)
    .setDepth(9e8 + 10);
  v.tweens.add({ targets: t, y: t.y - 30, alpha: 0, delay: 1200, duration: 900, onComplete: () => t.destroy() });
}

/** Is the Ranger seen (an alerted soldier that has him in sight) — the photo and sabotage rules. */
export function seenBy(v: MissionView) {
  return v.enemies.find((e) => e.state === 'alert' && v.sees(e)) ?? null;
}
