import Phaser from 'phaser';
import { props, type AssetManifest, type TiledMap, type TiledObject } from '../assets';
import { dirFromWorld, screenToTile, tileToScreen, worldToScreenDelta, type Dir8 } from '../iso';
import type { Bystander, Cause, Enemy, Placed, Pt } from '../scenes/Field';
import type { Mission } from '../scenes/Mission';

/**
 * G8 (lane g8a): what the objective kinds need from the Mission scene. These members are protected there (the scene
 * keeps its API small); the objectives read them through this view instead of widening the scene class.
 */
export interface MissionView {
  ranger: Phaser.GameObjects.Sprite;
  dead: boolean;
  prone: boolean;
  enemies: Enemy[];
  targets: Placed[];
  props: Placed[];
  tmj: TiledMap;
  manifest: AssetManifest;
  ppm: number;
  objectiveArea: [number, number][];
  extractArea: [number, number][];
  bystanders: Bystander[];
  timeLeft: number;
  cfg: { seconds: number };
  cell(x: number, y: number): [number, number];
  worldOf(p: Pt): Pt;
  play(spr: Phaser.GameObjects.Sprite, name: string, clip: string, dir: Dir8, ignoreIfPlaying?: boolean): boolean;
  depthAt(spr: Phaser.GameObjects.Sprite): number;
  noise(src: Pt, radius: number): void;
  destroyProp(p: Placed, cause?: Cause): void;
  add: Phaser.GameObjects.GameObjectFactory;
  tweens: Phaser.Tweens.TweenManager;
}
export const view = (m: Mission) => m as unknown as MissionView;

/** The map's zones (the `zones` object layer). */
export function zones(m: Mission): TiledObject[] {
  const t = view(m).tmj;
  return t.layers.find((l) => (l.class ?? l.name) === 'zones')?.objects ?? [];
}

/** A zone's point (or its first corner) in cell coordinates. */
export function zoneCell(m: Mission, z: TiledObject): [number, number] {
  return view(m).cell(z.x, z.y);
}

/** World metres of a cell coordinate. */
export function cellWorld(m: Mission, c: [number, number]): Pt {
  const s = tileToScreen(c[0], c[1]);
  return view(m).worldOf(s);
}

/** Cell coordinates of a screen point. */
export function screenCell(p: Pt): { x: number; y: number } {
  const t = screenToTile(p.x, p.y);
  return { x: t.i, y: t.j };
}

export function centroid(a: [number, number][]): { x: number; y: number } | null {
  if (!a.length) return null;
  return { x: a.reduce((s, p) => s + p[0], 0) / a.length, y: a.reduce((s, p) => s + p[1], 0) / a.length };
}

export function inArea([x, y]: [number, number], poly: [number, number][]) {
  let inside = false;
  for (let k = 0, n = poly.length - 1; k < poly.length; n = k++) {
    const [ax, ay] = poly[k];
    const [bx, by] = poly[n];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Is the Ranger inside the extraction zone? */
export function rangerExtracting(m: Mission) {
  const v = view(m);
  const c = screenCell(v.ranger);
  return !v.dead && inArea([c.x, c.y], v.extractArea);
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** A line of text that floats up over someone and fades. */
export function say(m: Mission, at: Pt, text: string, color = '#e8d27a') {
  const v = view(m);
  const t = v.add
    .text(at.x, at.y - 110, text, { fontFamily: 'monospace', fontSize: '14px', color, backgroundColor: '#10140caa', padding: { x: 4, y: 2 } })
    .setOrigin(0.5)
    .setDepth(9e8 + 10);
  v.tweens.add({ targets: t, y: t.y - 30, alpha: 0, delay: 1200, duration: 900, onComplete: () => t.destroy() });
}

/** Mission seconds as m:ss. */
export function clock(m: Mission) {
  const v = view(m);
  const s = Math.max(0, Math.round(v.cfg.seconds - v.timeLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Someone the Ranger leads out (G8): a captured officer, freed prisoners. He follows the Ranger's own footsteps (a
 * trail of the points the Ranger walked, so he goes where the Ranger could go), `lag` metres behind, walking or
 * running to keep up. Before he joins he can walk a path of his own (prisoners to the camp gate). The Ranger's bullets
 * and any blast kill him (a `Bystander` of the Field). A character sprite with idle / walk / run and a death clip.
 */
export class Follower implements Bystander {
  sprite: Phaser.GameObjects.Sprite;
  alive = true;
  following = false;
  /** World points still to walk (the Ranger's trail while following, else his own path). */
  queue: Pt[] = [];
  dir: Dir8;
  killedBy?: Cause;
  private clips: { idle: string; walk: string; run: string; death: string | null; hit: string | null };
  private busy = false;

  constructor(
    private m: Mission,
    readonly name: string,
    cell: [number, number],
    dir: Dir8,
    public lag: number,
  ) {
    const v = view(m);
    const at = tileToScreen(cell[0], cell[1]);
    this.sprite = v.add.sprite(at.x, at.y, name);
    this.dir = dir;
    // FB-077: the unarmed set has no hit/death; they come from the templates (hit_react, death_fall).
    const clips = v.manifest.sprites[name]?.clips ?? [];
    const find = (k: string) => clips.find((c) => c === k || c.endsWith(`_${k}`) || c.startsWith(`${k}_`)) ?? null;
    this.clips = { idle: find('idle') ?? clips[0] ?? 'idle', walk: find('walk') ?? 'walk', run: find('run') ?? find('walk') ?? 'run', death: find('death_fall') ?? find('death'), hit: find('hit_react') ?? find('hit') };
    v.play(this.sprite, name, this.clips.idle, dir);
    v.bystanders.push(this);
  }

  get world() {
    return view(this.m).worldOf(this.sprite);
  }

  /** Start following the Ranger (from where he stands). */
  join() {
    if (!this.alive || this.following) return;
    this.following = true;
    this.queue = [view(this.m).worldOf(view(this.m).ranger)];
  }

  /** Walk a path of world points (not following). */
  walk(path: Pt[]) {
    if (!this.following) this.queue = [...path];
  }

  /** A one-shot gesture (the officer's surrender), then idle again. */
  gesture(then?: () => void) {
    const v = view(this.m);
    if (!this.clips.hit || !v.play(this.sprite, this.name, this.clips.hit, this.dir, false)) return then?.();
    this.busy = true;
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.busy = false;
      then?.();
    });
  }

  /** Turn to face a world point. */
  face(w: Pt) {
    const me = this.world;
    if (dist(me, w) > 0.05) this.dir = dirFromWorld(w.x - me.x, w.y - me.y);
  }

  hit(cause: Cause, from: Pt) {
    if (!this.alive) return;
    this.alive = false;
    this.following = false;
    this.killedBy = cause;
    this.busy = true;
    const v = view(this.m);
    this.sprite.removeAllListeners(Phaser.Animations.Events.ANIMATION_COMPLETE);
    const dir = Math.hypot(from.x, from.y) > 0 ? dirFromWorld(-from.x, -from.y) : this.dir;
    if (!this.clips.death || !v.play(this.sprite, this.name, this.clips.death, dir, false)) this.sprite.setAlpha(0.4).setAngle(80);
  }

  /** How far the trail still runs from him to the Ranger (metres). */
  private behind(rw: Pt) {
    let d = 0;
    let p = this.world;
    for (const q of this.queue) {
      d += dist(p, q);
      p = q;
    }
    return d + dist(p, rw);
  }

  update(dt: number) {
    const v = view(this.m);
    this.sprite.setDepth(v.depthAt(this.sprite));
    if (!this.alive || this.busy) return;
    const rw = v.worldOf(v.ranger);
    let speed = 0;
    if (this.following) {
      const gap = this.behind(rw) - this.lag;
      const info = v.manifest.sprites[this.name]?.clipInfo ?? {};
      if (gap > 0.05) speed = gap > 3 ? (info[this.clips.run]?.speedMps ?? 4) : (info[this.clips.walk]?.speedMps ?? 1.4);
      // Never closer than the lag (the trail can double back).
      if (dist(this.world, rw) < this.lag * 0.7) speed = 0;
      if (!speed) this.face(rw);
    } else if (this.queue.length) {
      speed = v.manifest.sprites[this.name]?.clipInfo[this.clips.walk]?.speedMps ?? 1.4;
    }
    let left = speed * dt;
    let moved = false;
    while (left > 0 && this.queue.length) {
      const me = this.world;
      const q = this.queue[0];
      const d = dist(me, q);
      if (d < 0.05) {
        this.queue.shift();
        continue;
      }
      const step = Math.min(d, left);
      const s = worldToScreenDelta(((q.x - me.x) / d) * step, ((q.y - me.y) / d) * step, v.ppm);
      this.sprite.setPosition(this.sprite.x + s.x, this.sprite.y + s.y);
      this.dir = dirFromWorld(q.x - me.x, q.y - me.y);
      left -= step;
      moved = true;
      if (step >= d) this.queue.shift();
    }
    const clip = moved ? (speed > 2 ? this.clips.run : this.clips.walk) : this.clips.idle;
    v.play(this.sprite, this.name, clip, this.dir);
  }
}

/**
 * Records the Ranger's trail for the followers: every half metre he moves, the point goes onto each following one's
 * queue.
 */
export class Escort {
  private last: Pt | null = null;
  constructor(
    private m: Mission,
    readonly people: Follower[],
  ) {}

  update(dt: number) {
    const v = view(this.m);
    const rw = v.worldOf(v.ranger);
    if (!this.last || dist(rw, this.last) > 0.5) {
      this.last = rw;
      for (const f of this.people) if (f.following && f.alive) f.queue.push(rw);
    }
    for (const f of this.people) f.update(dt);
  }

  get alive() {
    return this.people.filter((f) => f.alive);
  }

  get following() {
    return this.people.filter((f) => f.alive && f.following);
  }
}

/** The custom zones whose property `key` is set (props(z)[key]). */
export function customZones(m: Mission, key: string) {
  return zones(m).filter((z) => z.type === 'custom' && props(z)[key] !== undefined && props(z)[key] !== false);
}
