import Phaser from 'phaser';
import { animKey } from '../assets';
import { DIRS8, dirFromWorld, screenToWorldDelta, tileToScreen, worldToScreenDelta, type Dir8 } from '../iso';
import { circleHitsPolygon, type Placed, type Pt } from '../scenes/Field';
import { distM, type MissionView } from './g8b-view';

/**
 * G8 (lane g8b): people who follow the Ranger once freed (mission 10's hostages). They sit (`hostage` sit) until
 * released, then walk or run (`unarmed_walk` / `unarmed_run`) through `exits` (cell points, e.g. the blown gate and a
 * spot outside it) and after that keep 1.6–3 m behind the Ranger, in a file. They collide with props like the
 * Ranger, slide along walls and step aside when stuck. An enemy bullet that passes within 0.45 m kills one, so does a
 * blast; alerted soldiers and machine-gun nests shoot at freed ones (src/enemies/escort.ts).
 */
const RADIUS = 0.3;
const GAP = 1.8; // metres behind the one in front

export interface Follower {
  sprite: Phaser.GameObjects.Sprite;
  alive: boolean;
  free: boolean;
  /** Cell points to pass through first (the gate, then outside it). */
  exits: [number, number][];
  dir: Dir8;
  stuck: number;
  side: number;
  diedBy?: string;
}

export class Followers {
  list: Follower[] = [];
  private near: Placed[] = [];

  constructor(private v: MissionView) {}

  spawn(cells: [number, number][]) {
    const name = 'hostage';
    const s = this.v.manifest.sprites[name];
    for (const [x, y] of cells) {
      const at = tileToScreen(x, y);
      const spr = this.v.add.sprite(at.x, at.y, s ? name : 'ranger');
      const dir: Dir8 = DIRS8[Math.floor(Math.random() * 8)];
      if (s) this.v.play(spr, name, 'sit', dir);
      else spr.setTint(0xc0a080);
      spr.setDepth(at.y);
      this.list.push({ sprite: spr, alive: true, free: false, exits: [], dir, stuck: 0, side: 0 });
    }
    if (s) for (const f of this.list) this.v.footsteps(f.sprite, name);
  }

  release(exits: [number, number][]) {
    for (const f of this.list) {
      if (!f.alive || f.free) continue;
      f.free = true;
      f.exits = exits.map((e) => [e[0] + (Math.random() - 0.5) * 0.8, e[1] + (Math.random() - 0.5) * 0.8]);
    }
  }

  get alive() {
    return this.list.filter((f) => f.alive);
  }

  kill(f: Follower, from: Pt, why: string) {
    if (!f.alive) return;
    f.alive = false;
    f.diedBy = why;
    f.sprite.removeAllListeners(Phaser.Animations.Events.ANIMATION_UPDATE);
    if (!this.v.play(f.sprite, 'hostage', 'death_fall', dirFromWorld(-from.x, -from.y), false)) f.sprite.setAlpha(0.4);
    f.sprite.setTint(0xb0a0a0);
  }

  /** A blast at a screen point: hostages inside `radius` metres die. */
  blast(at: Pt, radius: number) {
    const w = this.v.worldOf(at);
    for (const f of this.list) {
      const fw = this.v.worldOf(f.sprite);
      if (f.alive && distM(fw, w) < radius) this.kill(f, { x: fw.x - w.x, y: fw.y - w.y }, 'blast');
    }
  }

  update(dt: number) {
    const v = this.v;
    // Enemy bullets.
    for (const b of v.bullets) {
      if (b.owner !== 'enemy' || b.left <= 0) continue;
      for (const f of this.list) {
        if (!f.alive) continue;
        const fw = v.worldOf(f.sprite);
        if (distM(b.pos, fw) < 0.45) {
          b.left = 0;
          this.kill(f, { x: fw.x - b.pos.x, y: fw.y - b.pos.y }, 'shot');
          break;
        }
      }
    }
    // Alerted soldiers and machine-gun nests fire at freed hostages: src/enemies/escort.ts (G10, Rescue.exposed).
    // Walking: through the exits, then after the Ranger (each after the one in front of him).
    const walk = v.manifest.sprites.hostage?.clipInfo.unarmed_walk?.speedMps ?? 1.3;
    const run = v.manifest.sprites.hostage?.clipInfo.unarmed_run?.speedMps ?? 3.5;
    let lead: Pt = v.worldOf(v.ranger);
    let k = 0;
    for (const f of this.list) {
      f.sprite.setDepth(v.depthAt(f.sprite));
      if (!f.alive || !f.free) continue;
      const me = v.worldOf(f.sprite);
      let goal: Pt;
      let gap = GAP;
      if (f.exits.length) {
        const [cx, cy] = f.exits[0];
        const s = tileToScreen(cx, cy);
        goal = screenToWorldDelta(s.x, s.y, v.ppm);
        gap = 0.3;
        if (distM(me, goal) < 0.6) f.exits.shift();
      } else {
        goal = lead;
        gap = k === 0 ? 1.6 : GAP;
        k++;
      }
      const d = distM(me, goal);
      if (!f.exits.length) lead = me;
      if (d <= gap) {
        f.stuck = 0;
        v.play(f.sprite, 'hostage', 'unarmed_idle', f.dir);
        continue;
      }
      const speed = d > 6 ? run : walk;
      let dx = (goal.x - me.x) / d;
      let dy = (goal.y - me.y) / d;
      if (f.side > 0) {
        f.side -= dt;
        [dx, dy] = [-dy * Math.sign(f.side + 0.01), dx];
      }
      const step = Math.min(d - gap, speed * dt);
      const moved = this.tryMove(f, dx * step, dy * step) || this.tryMove(f, dx * step, 0) || this.tryMove(f, 0, dy * step);
      if (!moved) {
        if ((f.stuck += dt) > 0.6) {
          f.side = 0.8;
          f.stuck = 0;
        }
      } else f.stuck = 0;
      f.dir = dirFromWorld(dx, dy);
      v.play(f.sprite, 'hostage', speed > walk ? 'unarmed_run' : 'unarmed_walk', f.dir);
      // Far behind and out of sight (stuck for good): catch up behind the Ranger.
      if (!f.exits.length && d > 30 && !v.cameras.main.worldView.contains(f.sprite.x, f.sprite.y)) {
        const r = v.worldOf(v.ranger);
        const s = worldToScreenDelta(r.x - 1.2 * k, r.y - 1.2 * k, v.ppm);
        f.sprite.setPosition(s.x, s.y);
      }
      if (!f.exits.length) lead = v.worldOf(f.sprite);
    }
  }

  /** Move by (dx, dy) metres unless that enters a prop's collider. */
  private tryMove(f: Follower, dx: number, dy: number) {
    if (!dx && !dy) return false;
    const v = this.v;
    const me = v.worldOf(f.sprite);
    const w = { x: me.x + dx, y: me.y + dy };
    const s = worldToScreenDelta(w.x, w.y, v.ppm);
    const r = RADIUS * v.ppm + 2;
    for (const q of v.grid.query(s.x - r, s.y - r, s.x + r, s.y + r, this.near)) if (circleHitsPolygon(w, RADIUS, q.world)) return false;
    f.sprite.setPosition(s.x, s.y);
    return true;
  }
}

/** For the HUD: does an animation exist (the hostage sprite was built)? */
export function hasHostageSprite(v: MissionView) {
  const s = v.manifest.sprites.hostage;
  return !!s && v.anims.exists(animKey(s, 'sit', 'SE'));
}
