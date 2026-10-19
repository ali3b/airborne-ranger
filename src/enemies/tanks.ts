import Phaser from 'phaser';
import { animKey } from '../assets';
import { dirFromWorld, screenToWorldDelta, tileToScreen, worldToScreenDelta, type Dir8 } from '../iso';
import { sfx } from '../sound';
import { circleHitsPolygon, RANGER_RADIUS, type Cause, type Placed, type Pt } from '../scenes/Field';
import { dirVec, distW, type FieldHost } from './host';
import type { G9 } from './index';

/**
 * G9 tanks. A tank (`tank_drive`: the German tank with its `drive` and `fire` moves in 8 directions) drives a route
 * there and back (a map zone: `custom` polyline with `tank`, `speed`). When it sees the Ranger (all round: the turret
 * turns) it stops, swings its hull to him, aims and fires a shell: it flies to where he was (less exactly on Easy),
 * stops on the first thing in its way and bursts with a blast radius. Armour: rifles and grenades do nothing; a LAW
 * hit (300) or a time bomb next to it (400) destroys it (HP), and `tank_wreck`'s `intact_to_destroyed` plays in the
 * same facing (the two sprites are one model, so their anchors match; FB-056).
 */
const HP = 300;
const SIGHT = 22; // metres
const AIM = 1.6; // seconds (× difficulty reaction)
const RELOAD = 4.5; // seconds (× difficulty reaction)
const LOSE_AFTER = 4; // seconds
const SHELL_SPEED = 24; // m/s
const SHELL_BLAST = 3; // metres
const SHELL_DAMAGE = 70; // at the centre, falling to 40 % at the edge
const MISS = 3; // metres: how far off a shell lands at most (÷ difficulty accuracy)
const SLEEP = 50; // metres
const BARREL = 4.2; // metres from the anchor to the muzzle
const MUZZLE_H = 1.9; // metres above the ground

export interface Tank {
  placed: Placed;
  path: Pt[]; // screen
  next: number;
  speed: number;
  hp: number;
  mode: 'drive' | 'aim' | 'reload' | 'dead';
  timer: number;
  unseen: number;
  blocked: number;
  shots: number;
  /** Metres driven (for the load check). */
  travelled: number;
}

interface Shell {
  ball: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
  pos: Pt; // world
  dir: Pt;
  left: number;
  total: number;
  h0: number; // px above the ground at the muzzle
  from: Tank;
}

export class Tanks {
  list: Tank[] = [];
  shells: Shell[] = [];
  stats = { shots: 0, blasts: 0, destroyed: 0, armourHits: 0 };

  constructor(
    private host: FieldHost,
    private g9: G9,
  ) {}

  /** A tank on a route in map cells (driven there and back), `speed` m/s. */
  spawn(cells: [number, number][], speed = 2) {
    const h = this.host;
    const s = h.manifest.sprites.tank_drive;
    if (!s?.object || !h.manifest.sprites.tank_wreck || cells.length < 2) return null;
    const path = [...cells, ...cells.slice(1, -1).reverse()].map(([i, j]) => tileToScreen(i, j));
    const w = screenToWorldDelta(path[1].x - path[0].x, path[1].y - path[0].y, h.ppm);
    const dir = dirFromWorld(w.x, w.y);
    const d = s.object.directions.find((x) => x.name === dir) ?? s.object.directions[0];
    const spr = h.add.sprite(path[0].x, path[0].y, 'tank_drive');
    // Named for its wreck so Field.destroyProp plays tank_wreck's states; hp stays undefined so grenades and the
    // blast loop in Field.explode leave it alone (G9 armour: onBlast below).
    const placed: Placed = { sprite: spr, name: 'tank_wreck', dir: d.name as Dir8, at: { ...path[0] }, anchor: d.anchor, world: [], screen: [], minX: 0, maxX: 0, state: 'intact' };
    spr.play(animKey(s, 'drive', placed.dir));
    h.setCollision(placed, d.polygon);
    spr.setDepth(placed.at.y);
    h.props.push(placed);
    const t: Tank = { placed, path, next: 1, speed, hp: HP, mode: 'drive', timer: 0, unseen: 0, blocked: 0, shots: 0, travelled: 0 };
    this.list.push(t);
    return t;
  }

  private face(t: Tank, dir: Dir8) {
    if (t.placed.dir === dir) return true;
    const h = this.host;
    const s = h.manifest.sprites.tank_drive;
    const d = s.object!.directions.find((x) => x.name === dir);
    if (!d) return false;
    const before = { dir: t.placed.dir, anchor: t.placed.anchor };
    t.placed.dir = dir;
    t.placed.anchor = d.anchor;
    h.setCollision(t.placed, d.polygon);
    // Turning into the Ranger: don't.
    if (!h.dead && circleHitsPolygon(h.worldOf(h.ranger), RANGER_RADIUS, t.placed.world)) {
      t.placed.dir = before.dir;
      t.placed.anchor = before.anchor;
      h.setCollision(t.placed, s.object!.directions.find((x) => x.name === before.dir)!.polygon);
      return false;
    }
    t.placed.sprite.play(animKey(s, 'drive', dir));
    t.placed.sprite.anims.pause();
    return true;
  }

  sees(t: Tank, rw: Pt) {
    const h = this.host;
    const tw = h.worldOf(t.placed.at);
    const d = distW(tw, rw);
    if (h.dead || d > SIGHT * this.g9.viewScale() * (h.prone ? 0.6 : 1)) return false;
    for (let s = 3; s < d - 0.4; s += 0.4) {
      const q = { x: tw.x + ((rw.x - tw.x) * s) / d, y: tw.y + ((rw.y - tw.y) * s) / d };
      const p = h.propAt(q);
      if ((p && p !== t.placed) || this.g9.sight.blocks(q, s, d)) return false;
    }
    return true;
  }

  update(dt: number) {
    const h = this.host;
    const rw = h.worldOf(h.ranger);
    for (const t of this.list) {
      if (t.mode === 'dead') continue;
      const tw = h.worldOf(t.placed.at);
      if (distW(tw, rw) > SLEEP) {
        if (!t.placed.sprite.anims.isPaused) t.placed.sprite.anims.pause();
        continue;
      }
      const seen = this.sees(t, rw);
      if (seen) {
        t.unseen = 0;
        if (t.mode === 'drive') {
          t.mode = 'aim';
          t.timer = AIM * this.g9.mods.reaction;
          t.placed.sprite.anims.pause();
          this.g9.alerts.raiseAlarm(h.ranger);
        }
      } else if (t.mode !== 'drive' && (t.unseen += dt) > LOSE_AFTER) {
        t.mode = 'drive';
      }
      if (t.mode === 'drive') this.drive(t, dt);
      else {
        this.face(t, dirFromWorld(rw.x - tw.x, rw.y - tw.y));
        t.timer -= dt;
        if (t.timer <= 0 && seen) this.fire(t, rw);
        else if (t.timer <= 0 && t.mode === 'reload') t.mode = 'aim';
      }
    }
    this.updateShells(dt);
  }

  private drive(t: Tank, dt: number) {
    const h = this.host;
    const p = t.placed;
    const goal = t.path[t.next];
    const w = screenToWorldDelta(goal.x - p.at.x, goal.y - p.at.y, h.ppm);
    const dist = Math.hypot(w.x, w.y);
    if (dist < 0.15) {
      t.next = (t.next + 1) % t.path.length;
      return;
    }
    const dir = dirFromWorld(w.x, w.y);
    if (!this.face(t, dir)) return;
    const step = Math.min(dist, t.speed * dt);
    const sd = worldToScreenDelta((w.x / dist) * step, (w.y / dist) * step, h.ppm);
    const before = { ...p.at };
    p.at = { x: p.at.x + sd.x, y: p.at.y + sd.y };
    const s = h.manifest.sprites.tank_drive;
    h.setCollision(p, s.object!.directions.find((x) => x.name === p.dir)!.polygon);
    // The Ranger in the way: it waits, and knocks him down if he stays.
    if (!h.dead && circleHitsPolygon(h.worldOf(h.ranger), RANGER_RADIUS, p.world)) {
      p.at = before;
      h.setCollision(p, s.object!.directions.find((x) => x.name === p.dir)!.polygon);
      p.sprite.anims.pause();
      if ((t.blocked += dt) > 1.5) {
        t.blocked = 0;
        h.hurtRanger(30);
      }
      return;
    }
    t.blocked = 0;
    t.travelled += step;
    p.sprite.setPosition(p.at.x, p.at.y).setDepth(p.at.y);
    const key = animKey(s, 'drive', p.dir);
    if (p.sprite.anims.currentAnim?.key !== key) p.sprite.play(key);
    else if (p.sprite.anims.isPaused) p.sprite.anims.resume();
  }

  /** Fire: the `fire` move (barrel recoil) once, a muzzle flash, and a shell towards the Ranger (with an error). */
  private fire(t: Tank, rw: Pt) {
    const h = this.host;
    const p = t.placed;
    const s = h.manifest.sprites.tank_drive;
    t.mode = 'reload';
    t.timer = RELOAD * this.g9.mods.reaction;
    t.shots++;
    this.stats.shots++;
    const fireKey = animKey(s, 'fire', p.dir);
    if (h.anims.exists(fireKey)) {
      p.sprite.play(fireKey);
      h.time.delayedCall(600, () => {
        if (t.mode === 'dead') return;
        p.sprite.play(animKey(s, 'drive', p.dir));
        p.sprite.anims.pause();
      });
    }
    const v = dirVec(p.dir);
    const tw = h.worldOf(p.at);
    const muzzle = { x: tw.x + v.x * BARREL, y: tw.y + v.y * BARREL };
    const err = (MISS / this.g9.mods.accuracy) * (h.prone ? 1.3 : 1) * Math.sqrt(Math.random());
    const ea = Math.random() * Math.PI * 2;
    const target = { x: rw.x + Math.cos(ea) * err, y: rw.y + Math.sin(ea) * err };
    const d = Math.max(1, distW(muzzle, target));
    const ms = worldToScreenDelta(muzzle.x, muzzle.y, h.ppm);
    const h0 = MUZZLE_H * h.ppm * 0.866;
    const flash = h.add.circle(ms.x, ms.y - h0, 10, 0xffe080, 0.95).setDepth(ms.y + 1000);
    h.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: 160, onComplete: () => flash.destroy() });
    sfx.explosion(0.25 + 0.5 * h.loudness(p.at, 40));
    h.cameras.main.shake(90, 0.003);
    h.noise(p.at, 25);
    const ball = h.add.circle(ms.x, ms.y - h0, 4, 0x2a2a20).setStrokeStyle(1, 0xffc060);
    const shadow = h.add.ellipse(ms.x, ms.y, 8, 4, 0x000000, 0.35);
    this.shells.push({ ball, shadow, pos: muzzle, dir: { x: (target.x - muzzle.x) / d, y: (target.y - muzzle.y) / d }, left: d, total: d, h0, from: t });
  }

  private updateShells(dt: number) {
    const h = this.host;
    for (const sh of this.shells) {
      const step = Math.min(sh.left, SHELL_SPEED * dt);
      const n = Math.max(1, Math.ceil(step / 0.3));
      let hit = false;
      for (let k = 0; k < n && !hit; k++) {
        sh.pos = { x: sh.pos.x + (sh.dir.x * step) / n, y: sh.pos.y + (sh.dir.y * step) / n };
        sh.left -= step / n;
        const p = h.propAt(sh.pos);
        if (p && p !== sh.from.placed) hit = true;
      }
      const s = worldToScreenDelta(sh.pos.x, sh.pos.y, h.ppm);
      const hgt = sh.h0 * Math.max(0, sh.left / sh.total);
      sh.ball.setPosition(s.x, s.y - hgt).setDepth(s.y + 400);
      sh.shadow.setPosition(s.x, s.y).setDepth(s.y - 1);
      if (hit || sh.left <= 0) {
        sh.left = 0;
        this.blast(s);
      }
    }
    for (const sh of this.shells) if (sh.left <= 0) {
      sh.ball.destroy();
      sh.shadow.destroy();
    }
    this.shells = this.shells.filter((sh) => sh.left > 0);
  }

  /** A shell bursts: hurts the Ranger by distance, sets off mines; soldiers and props are left to the Ranger. */
  private blast(at: Pt) {
    const h = this.host;
    this.stats.blasts++;
    h.fx('explosion', at, at.y + 1000, { once: true, scale: 1.1 });
    h.dustBurst(at);
    sfx.explosion(0.35 + 0.65 * h.loudness(at, 40));
    h.cameras.main.shake(160, 0.006);
    const w = h.worldOf(at);
    const d = distW(h.worldOf(h.ranger), w);
    if (d < SHELL_BLAST) h.hurtRanger(Math.round(SHELL_DAMAGE * (1 - (0.6 * d) / SHELL_BLAST)));
    this.g9.mines.onBlast(w, SHELL_BLAST);
  }

  /** Field.explode's G9 hook: only a LAW hit or a time bomb hurts a tank. */
  onBlast(w: Pt, radius: number, cause: Cause, direct?: Placed) {
    for (const t of this.list) {
      if (t.mode === 'dead') continue;
      let dmg = 0;
      if (cause === 'law' && direct === t.placed) dmg = 300;
      else if (cause === 'bomb' && distW(this.host.worldOf(t.placed.at), w) < radius + 2) dmg = 400;
      else if (direct === t.placed || distW(this.host.worldOf(t.placed.at), w) < radius + 2) this.stats.armourHits++;
      if (!dmg) continue;
      t.hp -= dmg;
      if (t.hp <= 0) this.destroy(t, cause);
    }
  }

  private destroy(t: Tank, cause: Cause) {
    t.mode = 'dead';
    this.stats.destroyed++;
    t.placed.sprite.anims.resume();
    this.host.destroyProp(t.placed, cause);
    // Now it counts as a destroyed installation (Mission's merit: hp ≤ 0).
    t.placed.hp = 0;
  }
}
