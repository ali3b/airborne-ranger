import { registerObjective, type Objective } from './index';
import type { Mission } from '../scenes/Mission';
import type { Placed } from '../scenes/Field';
import { sfx } from '../sound';
import { distToProp, inArea, say, seenBy, view, type MissionView } from './g8b-view';
import { cellOf } from './photo';

/**
 * Mission 12, Delayed Sabotage (G8). The original: "Sneak past an enemy airfield's defense perimeter and plant a time
 * bomb at the aviation fuel dump. The time bomb will not explode until long after you leave; if it is to remain
 * undiscovered, it is essential that you not be seen in the vicinity of the fuel dump."
 *
 * The fuel dump's tanks and bowser are the map's targets. A time bomb (the G7 bomb, set with the `kneel_place` move)
 * put down within CHARGE_REACH of one is a delayed charge: its fuse becomes DELAYED_FUSE seconds, so it goes off
 * after the Ranger is gone (or blows him up if he dawdles). Every target charged (or already destroyed): done, get
 * out. Seen inside the fuel dump at any time: the guards search it and find the charges (failed).
 */
const CHARGE_REACH = 2.5; // metres from the target's hull
const DELAYED_FUSE = 150; // seconds

class Sabotage implements Objective {
  private fuel: Placed[] = [];
  private charged = new Set<Placed>();
  private known = new Set<object>();
  private fuseLeft = 0;

  start(m: Mission) {
    const v = view(m);
    this.fuel = v.targets.slice();
  }

  update(m: Mission, dt: number): 'pending' | 'done' | { failed: string } {
    const v = view(m);
    if (!this.fuel.length) return { failed: 'There was no fuel dump to sabotage.' };
    // New bombs next to a fuel target become delayed charges.
    for (const b of v.bombs) {
      if (this.known.has(b)) continue;
      this.known.add(b);
      const w = v.worldOf(b.at);
      const t = this.fuel.find((f) => (f.hp ?? 1) > 0 && distToProp(w, f) <= CHARGE_REACH);
      if (!t) continue;
      b.fuse = DELAYED_FUSE;
      b.label.setText(String(DELAYED_FUSE)).setColor('#ffd040');
      this.charged.add(t);
      sfx.confirm();
      say(v, `CHARGE SET (${this.charged.size}/${this.fuel.length}): ${DELAYED_FUSE} s fuse`, '#80ff80');
    }
    this.fuseLeft = Math.max(0, ...v.bombs.filter((b) => b.fuse > 10).map((b) => b.fuse));
    const c = v.rangerCell();
    if (!v.dead && inArea([c.x, c.y], v.objectiveArea) && seenBy(v)) return { failed: 'Seen at the fuel dump: the guards searched it and found the charges.' };
    const left = this.fuel.filter((f) => !this.charged.has(f) && (f.hp ?? 1) > 0);
    void dt;
    return left.length ? 'pending' : 'done';
  }

  private nextTarget(v: MissionView) {
    const me = v.worldOf(v.ranger);
    return this.fuel
      .filter((f) => !this.charged.has(f) && (f.hp ?? 1) > 0)
      .sort((a, b) => distToProp(me, a) - distToProp(me, b))[0];
  }

  hud(m: Mission) {
    const v = view(m);
    const t = this.nextTarget(v);
    const near = t && distToProp(v.worldOf(v.ranger), t) <= CHARGE_REACH - 0.5;
    return `plant time bombs on the fuel dump unseen (${this.charged.size}/${this.fuel.length})${near ? ': 4 / BOMB here' : ''}`;
  }

  marker(m: Mission) {
    const t = this.nextTarget(view(m));
    return t ? cellOf(t) : null;
  }

  stats(): Record<string, string | number> {
    const blown = this.fuel.filter((f) => (f.hp ?? 1) <= 0).length;
    return {
      'charges set': `${this.charged.size}/${this.fuel.length}`,
      ...(blown ? { 'fuel targets destroyed': blown } : {}),
      ...(this.fuseLeft ? { 'charges go off in': `${Math.ceil(this.fuseLeft)} s` } : {}),
    };
  }

  /** For scripts/load-check.mjs. */
  get state() {
    return { charged: this.charged.size, of: this.fuel.length, fuseLeft: this.fuseLeft };
  }
}

registerObjective('sabotage', () => new Sabotage());
