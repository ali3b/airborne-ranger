import Phaser from 'phaser';
import { DIRS8, dirFromWorld, worldToScreenDelta, type Dir8 } from '../iso';
import { sfx } from '../sound';
import type { Placed, Pt } from '../scenes/Field';
import { dirVec, distW, type FieldHost } from './host';
import type { G9 } from './index';

/**
 * G9 machine-gun nests. An `mg_nest` (a curved sandbag wall, the generator's object with intact / destroyed states)
 * with a gunner (`mg_gunner`: a German soldier kneeling with the heavy machine gun) behind its open side. He covers an
 * arc of ARC_HALF either side of the nest's facing (the wall's bulge) out to RANGE, and fires bursts. The sandbags
 * stop rifle fire: a grenade, a LAW or a time bomb destroys the nest (an installation) and the gunner with it.
 */
const RANGE = 18; // metres
const ARC_HALF = (65 * Math.PI) / 180;
const BEHIND = 1.9; // metres from the nest's anchor to the gunner, on the open side
const BURST = 6; // rounds
const SHOT_GAP = 0.09; // seconds between rounds
const PAUSE = 1.7; // seconds between bursts (× difficulty reaction)
const REACTION = 0.9; // seconds from seeing to the first burst (× difficulty reaction)
const HIT = 0.3; // per round, before range, prone, cover and difficulty
const LOSE_AFTER = 3; // seconds
const SLEEP = 40; // metres

export interface Nest {
  placed: Placed;
  gunner: Phaser.GameObjects.Sprite;
  /** World point of the gunner, and the arc's centre direction (world angle). */
  w: Pt;
  facing: number;
  aim: number;
  alive: boolean;
  alert: boolean;
  wait: number;
  burstLeft: number;
  shotIn: number;
  unseen: number;
  rounds: number;
}

export class MgNests {
  list: Nest[] = [];
  stats = { bursts: 0, rounds: 0, destroyed: 0 };

  constructor(
    private host: FieldHost,
    private g9: G9,
  ) {}

  /** Man every `mg_nest` among the props (a map's objects or the test field's). */
  manAll() {
    for (const p of this.host.props) if (p.name === 'mg_nest' && !this.list.some((n) => n.placed === p)) this.man(p);
  }

  man(p: Placed) {
    const h = this.host;
    if (!h.manifest.sprites.mg_gunner) return null;
    const v = dirVec(p.dir);
    const aw = h.worldOf(p.at);
    const w = { x: aw.x - v.x * BEHIND, y: aw.y - v.y * BEHIND };
    const s = worldToScreenDelta(w.x, w.y, h.ppm);
    const gunner = h.add.sprite(s.x, s.y, 'mg_gunner');
    const facing = Math.atan2(v.y, v.x);
    const n: Nest = { placed: p, gunner, w, facing, aim: facing, alive: true, alert: false, wait: 0, burstLeft: 0, shotIn: 0, unseen: 0, rounds: 0 };
    h.play(gunner, 'mg_gunner', 'rifle_crouch_idle', p.dir);
    gunner.setDepth(h.depthAt(gunner));
    this.list.push(n);
    return n;
  }

  private dir(n: Nest): Dir8 {
    return dirFromWorld(Math.cos(n.aim), Math.sin(n.aim));
  }

  /** Does the gunner see the Ranger: in range, inside the arc, nothing but his own sandbags in between. */
  private sees(n: Nest, rw: Pt) {
    const h = this.host;
    const d = distW(n.w, rw);
    if (d > RANGE * this.g9.viewScale() * (h.prone ? 0.6 : 1)) return false;
    const a = Math.atan2(rw.y - n.w.y, rw.x - n.w.x);
    if (Math.abs(Phaser.Math.Angle.Wrap(a - n.facing)) > ARC_HALF) return false;
    for (let t = 0.6; t < d - 0.4; t += 0.35) {
      const q = { x: n.w.x + ((rw.x - n.w.x) * t) / d, y: n.w.y + ((rw.y - n.w.y) * t) / d };
      const p = h.propAt(q);
      if ((p && p !== n.placed) || this.g9.sight.blocks(q, t, d)) return false;
    }
    return true;
  }

  update(dt: number) {
    const h = this.host;
    const rw = h.worldOf(h.ranger);
    for (const n of this.list) {
      if (!n.alive) continue;
      // The nest blown up (grenade, LAW, bomb): the gunner falls with it.
      if ((n.placed.hp !== undefined && n.placed.hp <= 0) || n.placed.state === 'dying' || n.placed.state === 'destroyed') {
        this.kill(n);
        continue;
      }
      if (distW(n.w, rw) > SLEEP) continue;
      const seen = !h.dead && this.sees(n, rw);
      if (seen) {
        n.aim = Math.atan2(rw.y - n.w.y, rw.x - n.w.x);
        n.unseen = 0;
        if (!n.alert) {
          n.alert = true;
          n.wait = REACTION * this.g9.mods.reaction;
          this.g9.alerts.shout(n.gunner, 14);
          this.g9.alerts.raiseAlarm(h.ranger);
        }
      } else if (n.alert && (n.unseen += dt) > LOSE_AFTER) {
        n.alert = false;
        n.burstLeft = 0;
        h.play(n.gunner, 'mg_gunner', 'rifle_crouch_idle', this.dir(n));
        continue;
      }
      if (!n.alert) continue;
      if (n.burstLeft > 0) {
        if ((n.shotIn -= dt) <= 0) {
          n.shotIn = SHOT_GAP;
          n.burstLeft--;
          this.fire(n, rw);
          if (n.burstLeft === 0) n.wait = PAUSE * this.g9.mods.reaction;
        }
        continue;
      }
      if ((n.wait -= dt) <= 0 && seen) {
        n.burstLeft = BURST;
        n.shotIn = 0;
        this.stats.bursts++;
        h.noise(n.gunner, 16);
        h.play(n.gunner, 'mg_gunner', 'rifle_crouch_shoot', this.dir(n), false);
      } else if (!n.gunner.anims.isPlaying) h.play(n.gunner, 'mg_gunner', 'rifle_crouch_idle', this.dir(n));
    }
  }

  /** One round of the burst, from the gun's muzzle, aimed at the Ranger with a spread; a miss goes past him. */
  private fire(n: Nest, rw: Pt) {
    const h = this.host;
    const dir = this.dir(n);
    const d = distW(n.w, rw);
    let chance = HIT * Phaser.Math.Clamp(1.2 - d / RANGE, 0.4, 1) * this.g9.hitScale();
    if (h.prone) chance *= 0.5;
    const hits = !h.dead && Math.random() < chance;
    let ang = Math.atan2(rw.y - n.w.y, rw.x - n.w.x);
    if (!hits) ang += (Math.random() < 0.5 ? -1 : 1) * Math.atan2(0.8 + Math.random() * 1.4, d);
    const muzzle = h.socket('mg_gunner', 'rifle_crouch_shoot', dir, 'shoot', ['weapon_tip', 'hand_r']) ?? { x: 0, y: -40 };
    h.fireBullet(n.gunner, muzzle, { x: Math.cos(ang), y: Math.sin(ang) }, d + 6, 'enemy', hits);
    sfx.enemyShot(0.3 + 0.7 * h.loudness(n.gunner, 35));
    n.rounds++;
    this.stats.rounds++;
    if (n.burstLeft % 3 === 2) h.play(n.gunner, 'mg_gunner', 'rifle_crouch_shoot', dir, false);
  }

  private kill(n: Nest) {
    n.alive = false;
    this.stats.destroyed++;
    const h = this.host;
    const away = DIRS8[(DIRS8.indexOf(this.dir(n)) + 4) % 8];
    if (!h.play(n.gunner, 'mg_gunner', 'rifle_death', away, false)) n.gunner.setVisible(false);
  }

  /** Gunners are hidden with the props off camera (Field.cullWorld culls only props and soldiers). */
  cull(v: Phaser.Geom.Rectangle) {
    for (const n of this.list) {
      const on = n.gunner.x > v.x - 160 && n.gunner.x < v.right + 160 && n.gunner.y > v.y - 160 && n.gunner.y - 120 < v.bottom + 160;
      if (n.gunner.visible !== on) n.gunner.setVisible(on);
    }
  }
}
