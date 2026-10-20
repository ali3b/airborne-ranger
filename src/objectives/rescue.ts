import type { Escortee } from '../enemies/escort';
import { registerObjective, type Objective } from './index';
import type { Mission } from '../scenes/Mission';
import type { Placed } from '../scenes/Field';
import { props } from '../assets';
import { sfx } from '../sound';
import { Followers } from './hostages';
import { centre, distM, inArea, say, view, zones, type MissionView } from './g8b-view';
import { cellOf } from './photo';

/**
 * Mission 10, Free the Hostages (G8). Briefing: "Blow open the door on the Hostage Prison … Defend the hostages
 * … Beware of enemy attempts to destroy the prison and kill the hostages." The hostages sit in a guarded stockade
 * (the map's custom zones with `hostage`); its gate (`stockade_gate`, property `gate`) only gives to explosives (a
 * grenade, LAW or time bomb). Once it is down they come out through the gap and follow the Ranger (src/objectives/
 * hostages.ts). They die to enemy fire and blasts, and alerted soldiers shoot at them. The objective is done when the
 * Ranger reaches the extraction zone with at least one living hostage near him; all of them dead: failed. The debrief
 * counts the rescued.
 */
const WITH_HIM = 10; // metres: a hostage this close to the Ranger counts as with him

class Rescue implements Objective {
  private hostages!: Followers;
  private gate: Placed | null = null;
  private freed = false;
  private total = 0;
  private rescued = 0;

  start(m: Mission) {
    const v = view(m);
    this.hostages = new Followers(v);
    const cells = zones(v)
      .filter((z) => z.type === 'custom' && props(z).hostage)
      .map((z) => v.cell(z.x, z.y));
    this.hostages.spawn(cells);
    this.total = cells.length;
    this.gate = v.props.find((p) => p.name === 'stockade_gate') ?? null;
    // Blasts kill hostages too: wrap this mission's explode (a grenade's 3 m, a bomb's 5 m).
    const explode = v.explode.bind(m);
    v.explode = (at, opts = {}) => {
      explode(at, opts);
      this.hostages.blast(at, (opts.radius ?? 3) * 0.8);
    };
  }

  /** The gate and a point 4 m outside it (towards the Ranger's side: away from the hostages' centre). */
  private exits(): [number, number][] {
    if (!this.gate) return [];
    const g = cellOf(this.gate);
    const hs = this.hostages.list.map((f) => f.sprite);
    const c = hs.length ? { x: hs.reduce((s, h) => s + h.x, 0) / hs.length, y: hs.reduce((s, h) => s + h.y, 0) / hs.length } : this.gate.at;
    const hc = cellOf({ at: c } as Placed);
    const dx = g.x - hc.x;
    const dy = g.y - hc.y;
    const n = Math.hypot(dx, dy) || 1;
    return [
      [g.x - (dx / n) * 1.5, g.y - (dy / n) * 1.5],
      [g.x, g.y],
      [g.x + (dx / n) * 4, g.y + (dy / n) * 4],
    ];
  }

  update(m: Mission, dt: number): 'pending' | 'done' | { failed: string } {
    const v = view(m);
    if (!this.freed && this.gate && ((this.gate.hp ?? 1) <= 0 || this.gate.state === 'destroyed')) {
      this.freed = true;
      this.hostages.release(this.exits());
      sfx.confirm();
      say(v, 'THE GATE IS DOWN: the hostages follow you', '#80ff80');
    }
    // FB-085: the blown gate's destroyed state (a scorched copy) keeps the whole panel as its collider: clear it so
    // the gap can be walked through, and show the wreck faded.
    if (this.freed && this.gate?.state === 'destroyed' && this.gate.world.length) {
      this.gate.world = [];
      this.gate.sprite.setAlpha(0.45);
    }
    this.hostages.update(dt);
    const alive = this.hostages.alive;
    if (!alive.length) return { failed: this.total ? 'Every hostage was killed.' : 'There were no hostages.' };
    const near = this.withHim(v).length;
    const c = v.rangerCell();
    if (this.freed && near > 0 && !v.dead && inArea([c.x, c.y], v.extractArea)) {
      this.rescued = near;
      return 'done';
    }
    return 'pending';
  }

  private withHim(v: MissionView) {
    const r = v.worldOf(v.ranger);
    return this.hostages.alive.filter((f) => f.free && distM(v.worldOf(f.sprite), r) < WITH_HIM);
  }

  hud(m: Mission) {
    const v = view(m);
    const alive = this.hostages.alive.length;
    if (!this.freed) return `blow open the stockade gate (hostages ${alive}/${this.total})`;
    return `bring the hostages to the extraction (${alive}/${this.total} alive, ${this.withHim(v).length} with you)`;
  }

  /** G10: freed hostages are shot at by alerted soldiers and machine-gun nests (src/enemies/escort.ts). */
  exposed(): Escortee[] {
    return this.hostages.list.filter((f) => f.alive && f.free).map((f) => ({ sprite: f.sprite, get alive() { return f.alive; }, hit: (from) => this.hostages.kill(f, from, 'shot') }));
  }

  marker(m: Mission) {
    const v = view(m);
    if (!this.freed) return this.gate ? cellOf(this.gate) : null;
    return v.extractArea.length ? centre(v.extractArea) : null;
  }

  stats(m: Mission): Record<string, string | number> {
    const v = view(m);
    const rescued = this.rescued || (v.objectiveDone ? this.withHim(v).length : 0);
    return { 'hostages rescued': `${rescued}/${this.total}`, 'hostages killed': this.total - this.hostages.alive.length };
  }

  /** For scripts/load-check.mjs. */
  get state() {
    return { freed: this.freed, total: this.total, alive: this.hostages.alive.length, free: this.hostages.list.filter((f) => f.free).length, gate: this.gate?.state ?? null };
  }
  get followers() {
    return this.hostages;
  }
}

registerObjective('hostages', () => new Rescue());
