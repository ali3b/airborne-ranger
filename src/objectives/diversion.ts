import Phaser from 'phaser';
import { registerObjective, type Objective } from './index';
import type { Mission } from '../scenes/Mission';
import type { Enemy, Placed } from '../scenes/Field';
import { sfx } from '../sound';
import { centre, inArea, say, view, type MissionView } from './g8b-view';
import { cellOf } from './photo';

/**
 * Mission 11, Create a Diversion (G8). Briefing: "Do not commence combat until the countdown buzzer sounds. Shoot
 * whenever it sounds again. Fight your way to the border, causing combat as often as possible. … The aircraft cannot
 * be recalled early — be there when the countdown clock reaches zero."
 *
 * Here: the first time the Ranger enters the garrison (the objective zone) a HOLD countdown starts; combat in the
 * garrison before the buzzer (a shot, a blast, a kill there) blows the diversion (failed). At the buzzer the alarm
 * goes off (`alarm_pole`s flash, every soldier in the garrison is alerted) and a combat window of WINDOW seconds
 * opens: each soldier killed in the garrison scores 1, each installation destroyed there 2. The buzzer sounds again
 * after a short lull for another window, until NEEDED points are made. Then the plane is on its way: it lands at the
 * border (the extraction zone) PLANE_IN seconds later, not before — the objective is done then, and the Ranger must
 * be there (or get there before the clock runs out).
 */
const HOLD = 8; // seconds from entering the garrison to the first buzzer
const WINDOW = 35; // seconds of each combat window
const LULL = 15; // seconds between windows
const NEEDED = 6; // diversion points
const PLANE_IN = 60; // seconds from the diversion made to the plane at the border

type Phase = 'approach' | 'hold' | 'window' | 'lull' | 'inbound' | 'landed';

class Diversion implements Objective {
  private phase: Phase = 'approach';
  /** Seconds left in the current phase (hold, window, lull, inbound). */
  private left = 0;
  private points = 0;
  private windows = 0;
  private kills = 0;
  private wrecked = 0;
  private dead = new Set<Enemy>();
  private down = new Set<Placed>();
  private shots = 0;
  private blasts = 0;
  private alarms: Placed[] = [];
  private flash: Phaser.GameObjects.Ellipse[] = [];

  start(m: Mission) {
    const v = view(m);
    this.alarms = v.props.filter((p) => p.name === 'alarm_pole');
    // Count the blasts (any explosion in the garrison is combat).
    const explode = v.explode.bind(m);
    v.explode = (at, opts = {}) => {
      explode(at, opts);
      const c = cellOf({ at } as Placed);
      if (inArea([c.x, c.y], v.objectiveArea)) this.blasts++;
    };
  }

  private inZone(v: MissionView, x: number, y: number) {
    const c = cellOf({ at: { x, y } } as Placed);
    return inArea([c.x, c.y], v.objectiveArea);
  }

  private buzz(v: MissionView) {
    this.phase = 'window';
    this.left = WINDOW;
    this.windows++;
    sfx.alert();
    say(v, this.windows === 1 ? 'BUZZER: open fire!' : 'BUZZER: fire again!', '#ff8060');
    // The alarm: every soldier in the garrison is on alert, turned towards the Ranger.
    const r = v.worldOf(v.ranger);
    for (const e of v.enemies) {
      if (e.state !== 'patrol' || !this.inZone(v, e.sprite.x, e.sprite.y)) continue;
      const w = v.worldOf(e.sprite);
      e.state = 'alert';
      e.reaction = 0.7;
      e.unseen = 0;
      e.angle = Math.atan2(r.y - w.y, r.x - w.x);
    }
    for (const a of this.alarms) {
      const f = v.add.ellipse(a.at.x, a.at.y - 200, 30, 30, 0xff3020, 0.8).setBlendMode(Phaser.BlendModes.ADD).setDepth(9e8 + 3);
      v.tweens.add({ targets: f, alpha: 0.1, yoyo: true, repeat: Math.floor(WINDOW / 0.5), duration: 250, onComplete: () => f.destroy() });
      this.flash.push(f);
    }
  }

  update(m: Mission, dt: number): 'pending' | 'done' | { failed: string } {
    const v = view(m);
    const c = v.rangerCell();
    const here = inArea([c.x, c.y], v.objectiveArea);
    // Combat in the garrison since the last frame.
    let fresh = 0;
    for (const e of v.enemies) {
      if (e.state !== 'dead' || this.dead.has(e)) continue;
      this.dead.add(e);
      if (this.inZone(v, e.sprite.x, e.sprite.y)) {
        fresh += 1;
        if (this.phase === 'window') this.kills++;
      }
    }
    for (const p of v.props) {
      if (p.hp === undefined || p.hp > 0 || this.down.has(p)) continue;
      this.down.add(p);
      if (this.inZone(v, p.at.x, p.at.y)) {
        fresh += 2;
        if (this.phase === 'window') this.wrecked++;
      }
    }
    const shotNow = v.shotsFired > this.shots && here;
    this.shots = v.shotsFired;
    const blastNow = this.blasts > 0;
    this.blasts = 0;
    if ((this.phase === 'approach' || this.phase === 'hold') && (fresh || ((shotNow || blastNow) && this.phase === 'hold'))) {
      return { failed: 'Premature contact in the garrison: the diversion was blown before the buzzer.' };
    }
    if (this.phase === 'window') this.points += fresh;
    switch (this.phase) {
      case 'approach':
        if (here && !v.dead) {
          this.phase = 'hold';
          this.left = HOLD;
          sfx.tick(false);
          say(v, `IN THE GARRISON: hold fire, buzzer in ${HOLD} s`);
        }
        break;
      case 'hold':
        if ((this.left -= dt) <= 0) this.buzz(v);
        else if (Math.ceil(this.left) !== Math.ceil(this.left + dt)) sfx.tick(this.left < 3);
        break;
      case 'window':
        if (this.points >= NEEDED) {
          this.phase = 'inbound';
          this.left = PLANE_IN;
          sfx.confirm();
          say(v, `DIVERSION MADE: the plane lands at the border in ${PLANE_IN} s`, '#80ff80');
        } else if ((this.left -= dt) <= 0) {
          this.phase = 'lull';
          this.left = LULL;
        }
        break;
      case 'lull':
        if ((this.left -= dt) <= 0) this.buzz(v);
        break;
      case 'inbound':
        if ((this.left -= dt) <= 0) {
          this.phase = 'landed';
          sfx.alert();
        }
        break;
    }
    return this.phase === 'landed' ? 'done' : 'pending';
  }

  hud() {
    const s = Math.max(0, Math.ceil(this.left));
    switch (this.phase) {
      case 'approach':
        return 'reach the garrison, hold fire until the buzzer';
      case 'hold':
        return `HOLD FIRE: buzzer in ${s} s`;
      case 'window':
        return `OPEN FIRE in the garrison: diversion ${this.points}/${NEEDED} · ${s} s`;
      case 'lull':
        return `diversion ${this.points}/${NEEDED}: next buzzer in ${s} s`;
      case 'inbound':
        return `DIVERSION MADE: get to the border, the plane lands in ${s} s`;
      default:
        return 'the plane is down: get to the border zone';
    }
  }

  marker(m: Mission) {
    const v = view(m);
    return this.phase === 'inbound' && v.extractArea.length ? centre(v.extractArea) : null;
  }

  stats(): Record<string, string | number> {
    return { 'diversion points': `${this.points}/${NEEDED}`, 'combat windows': this.windows, 'garrison kills': this.kills, 'garrison wrecks': this.wrecked };
  }

  /** For scripts/load-check.mjs. */
  get state() {
    return { phase: this.phase, left: this.left, points: this.points, windows: this.windows };
  }
  /** For scripts/load-check.mjs: skip the plane's wait. */
  hurry() {
    this.left = Math.min(this.left, 0.5);
  }
}

registerObjective('diversion', () => new Diversion());
