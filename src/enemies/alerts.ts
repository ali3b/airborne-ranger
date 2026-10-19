import Phaser from 'phaser';
import { screenToTile, screenToWorldDelta, worldToScreenDelta } from '../iso';
import { sfx } from '../sound';
import type { DifficultyMods } from '../difficulty';
import type { Enemy, Pt } from '../scenes/Field';
import { distW, type FieldHost } from './host';

/**
 * G9 alerts and the alarm. An alerted soldier shouts: the soldiers near him (SPREAD_R) turn towards the Ranger's last
 * known position and are alerted too, a moment later, so an alert runs along a patrol line. Several alerts in a short
 * time, or a long one, raise the ALARM: reinforcements (the nearest idle soldiers, then new ones from out of sight)
 * head for the last known position and search there; the alarm calms down when nobody has seen the Ranger for a while.
 * Enemies that already think (Field.updateEnemies) keep doing so; this only changes their state, facing and path.
 */
const SPREAD_R = 12; // metres: how far a shout carries
const SPREAD_DELAY = [0.5, 1.1]; // seconds before a neighbour reacts
const ALARM_ALERTS = 3; // alerts within ALARM_WINDOW raise the alarm
const ALARM_WINDOW = 12; // seconds
const ALARM_LONG = 6; // seconds: or one soldier keeps the Ranger in sight this long
const CALM_AFTER = 40; // seconds without a sighting
const REINFORCE_FROM = 90; // metres: idle soldiers this close to the last known position are sent
const SPAWN_AT = [30, 42]; // metres from the last known position for new soldiers
const HUNT_SPEED = 2.4; // m/s for sleeping (far) hunters, moved here
const SEARCH_R = 2.5; // metres: the loop hunters walk around the last known position

interface Home {
  path: Pt[];
  next: number;
}

export class Alerts {
  /** Screen point where the enemy last saw (or heard) the Ranger. */
  lastKnown: Pt | null = null;
  alarm = false;
  /** Counters for the load check and the end screen. */
  stats = { alerts: 0, spread: 0, alarms: 0, reinforcements: 0, spawned: 0 };
  readonly hunters = new Set<Enemy>();
  private time = 0;
  private seenAt = -1e9;
  private prev = new Map<Enemy, Enemy['state']>();
  private alertSince = new Map<Enemy, number>();
  private alertTimes: number[] = [];
  private pending: { e: Enemy; at: number }[] = [];
  private home = new Map<Enemy, Home>();

  constructor(
    private host: FieldHost,
    private mods: DifficultyMods,
  ) {}

  update(dt: number) {
    const h = this.host;
    this.time += dt;
    const t = this.time;
    for (const e of h.enemies) {
      const before = this.prev.get(e) ?? 'patrol';
      if (e.state === 'alert' && before !== 'alert') this.onAlert(e);
      if (e.state !== 'alert') this.alertSince.delete(e);
      this.prev.set(e, e.state);
      if (e.state === 'dead') {
        this.hunters.delete(e);
        continue;
      }
      // Field resets `unseen` to 0 each frame the soldier sees the Ranger.
      if (e.state === 'alert' && e.unseen === 0 && e.sprite.active && !h.dead) {
        this.sighted();
        if (t - (this.alertSince.get(e) ?? t) > ALARM_LONG) this.raiseAlarm();
      }
    }
    // Shouts reaching the neighbours.
    if (this.pending.length) {
      for (const p of this.pending) if (p.at <= t) this.alertBy(p.e);
      this.pending = this.pending.filter((p) => p.at > t);
    }
    this.alertTimes = this.alertTimes.filter((x) => t - x < ALARM_WINDOW);
    if (!this.alarm && this.alertTimes.length >= ALARM_ALERTS) this.raiseAlarm();
    if (this.alarm && t - this.seenAt > CALM_AFTER) this.calm();
    // Hunters far from the Ranger sleep in Field (no AI): walk them here so they arrive.
    for (const e of this.hunters) if (!e.sprite.active) this.walkAsleep(e, dt);
  }

  /** The Ranger is in someone's sight now. */
  private sighted() {
    const r = this.host.ranger;
    const moved = !this.lastKnown || distW(this.host.worldOf(this.lastKnown), this.host.worldOf(r)) > 6;
    this.lastKnown = { x: r.x, y: r.y };
    this.seenAt = this.time;
    // During an alarm the hunters follow fresh news.
    if (this.alarm && moved) for (const e of this.hunters) this.huntTo(e, this.lastKnown);
  }

  private onAlert(e: Enemy) {
    const h = this.host;
    this.stats.alerts++;
    this.alertTimes.push(this.time);
    this.alertSince.set(e, this.time);
    // Difficulty: reaction time from noticing to the first shot (Field sets 0.7 s).
    e.reaction *= this.mods.reaction;
    if (!this.lastKnown || this.time - this.seenAt > 3) {
      this.lastKnown = { x: h.ranger.x, y: h.ranger.y };
    }
    this.shout(e.sprite, SPREAD_R, e);
  }

  /** A shout from `src` (screen): soldiers within `radius` m who aren't alert yet will be in a moment. */
  shout(src: Pt, radius: number, from?: Enemy) {
    const w = this.host.worldOf(src);
    for (const n of this.host.enemies) {
      if (n === from || n.state !== 'patrol' || !n.sprite.active || this.pending.some((p) => p.e === n)) continue;
      if (distW(w, this.host.worldOf(n.sprite)) > radius) continue;
      this.pending.push({ e: n, at: this.time + Phaser.Math.FloatBetween(SPREAD_DELAY[0], SPREAD_DELAY[1]) });
    }
  }

  /** A neighbour hears the shout: alert, facing the last known position. */
  private alertBy(e: Enemy) {
    if (e.state !== 'patrol') return;
    const h = this.host;
    const to = this.lastKnown ?? h.ranger;
    const a = h.worldOf(e.sprite);
    const b = h.worldOf(to);
    e.state = 'alert';
    e.reaction = 0.7; // scaled by difficulty in onAlert, next frame
    e.unseen = 0;
    e.angle = Math.atan2(b.y - a.y, b.x - a.x);
    this.stats.spread++;
    const t = h.add.text(e.sprite.x, e.sprite.y - 95, '!', { fontFamily: 'monospace', fontSize: '22px', color: '#ff5040', stroke: '#10140c', strokeThickness: 4 }).setOrigin(0.5).setDepth(9e8 + 10);
    h.tweens.add({ targets: t, y: t.y - 20, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  /** The alarm: a siren, and reinforcements toward the last known position. */
  raiseAlarm(at?: Pt) {
    if (at) this.lastKnown = { x: at.x, y: at.y };
    if (this.alarm) return;
    this.alarm = true;
    this.seenAt = Math.max(this.seenAt, this.time);
    this.stats.alarms++;
    sfx.alert();
    this.host.time.delayedCall(400, () => sfx.alert());
    this.reinforce();
  }

  private reinforce() {
    const h = this.host;
    const goal = this.lastKnown ?? { x: h.ranger.x, y: h.ranger.y };
    const gw = h.worldOf(goal);
    const want = this.mods.reinforcements;
    const idle = h.enemies
      .filter((e) => e.state === 'patrol' && !this.hunters.has(e))
      .map((e) => ({ e, d: distW(h.worldOf(e.sprite), gw) }))
      .filter((x) => x.d > SPREAD_R && x.d < REINFORCE_FROM)
      .sort((a, b) => a.d - b.d)
      .slice(0, want);
    for (const { e } of idle) {
      this.home.set(e, { path: e.path, next: e.next });
      this.huntTo(e, goal);
      this.stats.reinforcements++;
    }
    // Not enough nearby: new soldiers arrive from out of sight.
    for (let k = idle.length; k < want; k++) {
      const spot = this.spawnSpot(gw, k);
      if (!spot) break;
      const c = screenToTile(spot.x, spot.y);
      const e = h.spawnEnemy([[c.i, c.j]], 'S');
      this.huntTo(e, goal);
      this.stats.reinforcements++;
      this.stats.spawned++;
    }
  }

  /** A standable spot SPAWN_AT m from `gw` (world), away from the Ranger's view if it can. */
  private spawnSpot(gw: Pt, k: number): Pt | null {
    const h = this.host;
    const rw = h.worldOf(h.ranger);
    const away = Math.atan2(gw.y - rw.y, gw.x - rw.x) + Math.PI; // behind the last known position, seen from him
    // Nearer in when the map ends (or water) is in the way.
    for (let tries = 0; tries < 32; tries++) {
      const a = away + ((k * 0.7 + tries * 0.9) % (Math.PI * 2)) - Math.PI / 2;
      const r = Phaser.Math.FloatBetween(SPAWN_AT[0], SPAWN_AT[1]) * (tries < 16 ? 1 : 0.5);
      const w = { x: gw.x + Math.cos(a) * r, y: gw.y + Math.sin(a) * r };
      const s = worldToScreenDelta(w.x, w.y, h.ppm);
      if (h.canStand(s.x, s.y) && !h.propAt(w)) return s;
    }
    return null;
  }

  /** Send a soldier to search around `goal` (screen): a small loop around it. */
  private huntTo(e: Enemy, goal: Pt) {
    const w = this.host.worldOf(goal);
    const a0 = Math.random() * Math.PI * 2;
    e.path = [0, 1, 2].map((k) => {
      const a = a0 + (k * Math.PI * 2) / 3;
      return worldToScreenDelta(w.x + Math.cos(a) * SEARCH_R, w.y + Math.sin(a) * SEARCH_R, this.host.ppm);
    });
    e.next = 0;
    this.hunters.add(e);
  }

  private walkAsleep(e: Enemy, dt: number) {
    const goal = e.path[e.next];
    const w = screenToWorldDelta(goal.x - e.sprite.x, goal.y - e.sprite.y, this.host.ppm);
    const d = Math.hypot(w.x, w.y);
    if (d < 0.2) {
      e.next = (e.next + 1) % e.path.length;
      return;
    }
    const step = Math.min(d, HUNT_SPEED * dt);
    const s = worldToScreenDelta((w.x / d) * step, (w.y / d) * step, this.host.ppm);
    e.sprite.setPosition(e.sprite.x + s.x, e.sprite.y + s.y);
    e.angle = Math.atan2(w.y, w.x);
  }

  /** Nobody has seen the Ranger for a while: the sent soldiers go back to their rounds. */
  private calm() {
    this.alarm = false;
    for (const e of this.hunters) {
      const home = this.home.get(e);
      if (!home) continue; // a reinforcement keeps searching where it was sent
      e.path = home.path;
      e.next = home.next;
    }
    this.hunters.clear();
    this.home.clear();
  }
}
