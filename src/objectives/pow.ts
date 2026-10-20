import Phaser from 'phaser';
import { props } from '../assets';
import type { Dir8 } from '../iso';
import type { Placed } from '../scenes/Field';
import type { Mission } from '../scenes/Mission';
import { sfx } from '../sound';
import type { Escortee } from '../enemies/escort';
import { registerObjective, type Objective } from './index';
import { cellWorld, centroid, customZones, dist, Escort, Follower, rangerExtracting, say, screenCell, view, zoneCell } from './follower';

/** Seconds standing at the gate to cut its lock and wire (the quiet way in). */
const CUT_TIME = 4;
/** Metres from the gate's anchor the Ranger must stand to cut it. */
const CUT_REACH = 2.2;
/** Metres: a freed prisoner joins the Ranger when he comes this close. */
const JOIN = 7;
/** Metres from the Ranger a following prisoner must be when he reaches the extraction zone. */
const DELIVER = 12;

/**
 * Mission 8, Liberate a P.O.W. Camp: the prisoners (`pow_prisoner`, custom zones with `prisoner`) are behind the
 * camp's wire. Open the gate (the target `pow_gate`): blow it up, or stand at it for a few seconds to cut it. Freed
 * prisoners walk out to the camp exit (the custom zone `pow_exit`) and wait; each joins the Ranger when he comes
 * near and follows him (`Follower`). Bring them to the extraction zone; the debriefing counts the rescued. If every
 * prisoner dies the mission fails. G10: once the gate is open the enemy shoots at them (src/enemies/escort.ts).
 */
class Pow implements Objective {
  private escort?: Escort;
  private gate?: Placed;
  private open = false;
  private cut = 0;
  private bar?: Phaser.GameObjects.Text;
  private exit: [number, number] | null = null;
  private rescued = 0;

  start(m: Mission) {
    const v = view(m);
    const people = customZones(m, 'prisoner').map((z, k) => {
      const facing = (typeof props(z).facing === 'string' ? props(z).facing : 'SE') as Dir8;
      return new Follower(m, v.manifest.sprites.pow_prisoner ? 'pow_prisoner' : 'ranger', zoneCell(m, z), facing, 1.6 + k * 1.1);
    });
    this.escort = new Escort(m, people);
    this.gate = v.targets.find((t) => t.name === 'pow_gate') ?? v.targets[0];
    const ex = customZones(m, 'pow_exit')[0];
    this.exit = ex ? zoneCell(m, ex) : null;
    this.bar = v.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#e8d27a', backgroundColor: '#10140ccc', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(9e8 + 10).setVisible(false);
  }

  update(m: Mission, dt: number) {
    const e = this.escort;
    if (!e) return 'pending' as const;
    e.update(dt);
    const v = view(m);
    if (!e.alive.length) return { failed: 'Every prisoner was killed.' };
    const rw = v.worldOf(v.ranger);
    const g = this.gate;
    if (!this.open && g) {
      if ((g.hp ?? 0) <= 0) this.free(m);
      else if (!v.dead && dist(v.worldOf(g.at), rw) < CUT_REACH) {
        this.cut += dt;
        this.bar!.setVisible(true).setPosition(v.ranger.x, v.ranger.y - 120).setText(`cutting the wire ${Math.min(100, Math.round((this.cut / CUT_TIME) * 100))} %`);
        if (this.cut >= CUT_TIME) {
          g.hp = 0;
          v.destroyProp(g, 'knife');
          this.free(m);
        }
      } else {
        this.cut = Math.max(0, this.cut - dt);
        this.bar!.setVisible(false);
      }
    }
    if (this.open) {
      for (const f of e.alive) if (!f.following && !v.dead && dist(f.world, rw) < JOIN) {
        f.join();
        say(m, f.sprite, 'WITH YOU!', '#c0ffc0');
      }
      const out = e.following;
      if (out.length && rangerExtracting(m) && out.every((f) => dist(f.world, rw) < DELIVER)) {
        this.rescued = out.length;
        return 'done' as const;
      }
    }
    return 'pending' as const;
  }

  /** The gate is down: the prisoners walk out to the exit and wait for the Ranger. */
  private free(m: Mission) {
    this.open = true;
    this.bar?.setVisible(false);
    sfx.confirm();
    const exit = this.exit ? cellWorld(m, this.exit) : this.gate ? view(m).worldOf(this.gate.at) : null;
    this.escort?.alive.forEach((f, k) => {
      if (exit) f.walk([{ x: exit.x + (k % 3) * 0.9 - 0.9, y: exit.y + Math.floor(k / 3) * 0.9 }]);
      if (k === 0) say(m, f.sprite, "WE'RE FREE!", '#c0ffc0');
    });
  }

  hud(m: Mission) {
    const e = this.escort;
    if (!e) return 'liberate the P.O.W. camp';
    if (!this.open) return 'liberate the P.O.W. camp: blow the gate, or stand at it to cut the wire';
    const v = view(m);
    const rw = v.worldOf(v.ranger);
    const lag = e.following.some((f) => dist(f.world, rw) > DELIVER) ? ' (wait for them)' : '';
    return `prisoners with you ${e.following.length}/${e.alive.length}: lead them to the extraction zone${lag}`;
  }

  /** G10: once the gate is open the prisoners are out in the open, and the enemy shoots at them. */
  exposed(): Escortee[] {
    if (!this.open || !this.escort) return [];
    return this.escort.alive.map((f) => ({ sprite: f.sprite, get alive() { return f.alive; }, hit: (from) => f.hit('enemy', from) }));
  }

  marker(m: Mission) {
    const e = this.escort;
    if (!e) return null;
    if (!this.open) return this.gate ? screenCell(this.gate.at) : null;
    const waiting = e.alive.filter((f) => !f.following);
    if (waiting.length && !e.following.length) return screenCell(waiting[0].sprite);
    return centroid(view(m).extractArea);
  }

  stats(): Record<string, string | number> {
    const e = this.escort;
    if (!e) return {};
    return { 'prisoners rescued': `${this.rescued}/${e.people.length}`, 'prisoners killed': e.people.length - e.alive.length };
  }
}

registerObjective('pow', () => new Pow());
