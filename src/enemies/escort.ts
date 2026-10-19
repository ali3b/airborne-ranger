import Phaser from 'phaser';
import { dirFromWorld } from '../iso';
import { sfx } from '../sound';
import type { Placed, Pt } from '../scenes/Field';
import { distW, type FieldHost } from './host';
import type { G9 } from './index';

/**
 * G10: the enemy shoots at the people the Ranger leads out (mission 6's officer, mission 8's prisoners, mission 10's
 * hostages), not only at him. The mission's objective names who is exposed right now (`Objective.exposed`: the
 * officer once captured, prisoners once the gate is open, hostages once freed); everything else is here:
 * - an alerted soldier within FIRE_RANGE with a clear line fires at one of them every FIRE_EVERY seconds;
 * - a manned machine-gun nest that is on alert fires a short burst at one inside its arc and range;
 * - any enemy bullet (these, and the ones aimed at the Ranger that miss him) that passes within HIT_R of one kills him.
 * An aimed round has AIMED × the difficulty's accuracy of going true; the rest are aimed past. The objective decides
 * what a death means (the officer: failed; prisoners and hostages: the count drops, all dead: failed).
 */
const FIRE_RANGE = 12; // metres
const FIRE_EVERY = 2.5; // seconds per soldier
const AIMED = 0.35;
const NEST_RANGE = 18; // metres (src/enemies/mgnest.ts RANGE)
const NEST_ARC = (65 * Math.PI) / 180;
const NEST_EVERY = 2.6; // seconds between bursts at them
const NEST_ROUNDS = 3;
const HIT_R = 0.45; // metres

/** Someone enemies may shoot at (alive while `alive`); `hit` gets the bullet's world direction. */
export interface Escortee {
  sprite: Phaser.GameObjects.Sprite;
  alive: boolean;
  hit(from: Pt): void;
}

export class EscortFire {
  /** Off for scripted checks that need the escort to survive a teleport into a guarded area. */
  enabled = true;
  stats = { shots: 0, bursts: 0, hits: 0 };
  private cool = new Map<object, number>();
  private last = new WeakMap<object, Pt>();

  constructor(
    private host: FieldHost,
    private g9: G9,
  ) {}

  private targets(): Escortee[] {
    const h = this.host;
    return (h.objective?.exposed?.(h) ?? []).filter((t) => t.alive);
  }

  update(dt: number) {
    const h = this.host;
    const targets = this.targets();
    // Enemy bullets on their way (traced from where they were last frame, so a fast one can't skip a man).
    for (const b of h.bullets) {
      if (b.owner !== 'enemy' || b.left <= 0) continue;
      const p0 = this.last.get(b) ?? b.pos;
      this.last.set(b, b.pos);
      for (const t of targets) {
        if (!t.alive || segDist(h.worldOf(t.sprite), p0, b.pos) > HIT_R) continue;
        b.left = 0;
        t.hit(b.dir);
        this.stats.hits++;
        break;
      }
    }
    if (!this.enabled || !targets.length || h.dead) return;
    // Alerted soldiers.
    for (const e of h.enemies) {
      if (e.state !== 'alert' || e.busy || !e.sprite.active) continue;
      if (this.tick(e, dt, FIRE_EVERY) > 0) continue;
      const ew = h.worldOf(e.sprite);
      const t = targets.find((x) => x.alive && distW(h.worldOf(x.sprite), ew) < FIRE_RANGE && this.clear(ew, h.worldOf(x.sprite)));
      if (!t) continue;
      this.cool.set(e, FIRE_EVERY);
      const tw = h.worldOf(t.sprite);
      const dir = dirFromWorld(tw.x - ew.x, tw.y - ew.y);
      h.play(e.sprite, 'german', 'rifle_shoot', dir, false);
      const muzzle = h.socket('german', 'rifle_shoot', dir, 'shoot', ['weapon_tip', 'hand_r']) ?? { x: 0, y: -50 };
      this.shoot(e.sprite, muzzle, ew, tw, 30);
    }
    // Machine-gun nests on alert.
    for (const n of this.g9.nests.list) {
      if (!n.alive || !n.alert || n.burstLeft > 0) continue;
      if (this.tick(n, dt, NEST_EVERY) > 0) continue;
      const t = targets.find((x) => {
        const tw = h.worldOf(x.sprite);
        const d = distW(n.w, tw);
        const a = Math.atan2(tw.y - n.w.y, tw.x - n.w.x);
        return d < NEST_RANGE && Math.abs(Phaser.Math.Angle.Wrap(a - n.facing)) <= NEST_ARC && this.clear(n.w, tw, n.placed);
      });
      if (!t) continue;
      this.cool.set(n, NEST_EVERY);
      this.stats.bursts++;
      const tw = h.worldOf(t.sprite);
      const dir = dirFromWorld(tw.x - n.w.x, tw.y - n.w.y);
      h.play(n.gunner, 'mg_gunner', 'rifle_crouch_shoot', dir, false);
      const muzzle = h.socket('mg_gunner', 'rifle_crouch_shoot', dir, 'shoot', ['weapon_tip', 'hand_r']) ?? { x: 0, y: -40 };
      for (let k = 0; k < NEST_ROUNDS; k++) h.time.delayedCall(k * 90, () => n.alive && t.alive && this.shoot(n.gunner, muzzle, n.w, h.worldOf(t.sprite), 35));
    }
  }

  /** Count a shooter's cooldown down (a random start so they don't fire in step); returns what's left. */
  private tick(k: object, dt: number, every: number) {
    const left = (this.cool.get(k) ?? Math.random() * every) - dt;
    this.cool.set(k, left);
    return left;
  }

  /** One round at a world point: true with AIMED × accuracy, else aimed past. */
  private shoot(from: Phaser.GameObjects.Sprite, muzzle: Pt, fw: Pt, tw: Pt, loud: number) {
    const h = this.host;
    const d = distW(fw, tw);
    let ang = Math.atan2(tw.y - fw.y, tw.x - fw.x);
    if (Math.random() > AIMED * this.g9.mods.accuracy) ang += (Math.random() < 0.5 ? -1 : 1) * Math.atan2(0.9 + Math.random(), d);
    sfx.enemyShot(0.3 + 0.7 * h.loudness(from, loud));
    h.fireBullet(from, muzzle, { x: Math.cos(ang), y: Math.sin(ang) }, d + 4, 'enemy', false);
    this.stats.shots++;
  }

  /** Nothing solid (but the shooter's own nest) and no canopy between two world points. */
  private clear(a: Pt, b: Pt, own?: Placed) {
    const h = this.host;
    const d = distW(a, b);
    for (let t = 0.6; t < d - 0.4; t += 0.4) {
      const q = { x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d };
      const p = h.propAt(q);
      if ((p && p !== own) || this.g9.sight.blocks(q, t, d)) return false;
    }
    return true;
  }
}

/** Distance from p to the segment a–b (world metres). */
function segDist(p: Pt, a: Pt, b: Pt) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
  return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y);
}
