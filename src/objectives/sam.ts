import type { Mission } from '../scenes/Mission';
import { registerObjective, type Objective } from './index';
import { dist, screenCell, view } from './follower';

/** What each target sprite counts as on the HUD. */
const LABEL: Record<string, string> = { sam_launcher: 'launchers', sam_missiles: 'missiles', radar_dish: 'radar', radar_spin: 'radar', radio_tower: 'radar' };

/**
 * Mission 7, Disable a SAM Site: every target of the site (the launchers, the missile stacks, the radar) must be
 * destroyed. The HUD counts them by kind; near the site the compass points at the nearest one still standing.
 */
class Sam implements Objective {
  start() {}

  update(m: Mission) {
    const t = view(m).targets;
    return t.length && t.every((x) => (x.hp ?? 0) <= 0) ? ('done' as const) : ('pending' as const);
  }

  private groups(m: Mission) {
    const g = new Map<string, [number, number]>();
    for (const t of view(m).targets) {
      const k = LABEL[t.name] ?? t.name;
      const c = g.get(k) ?? [0, 0];
      c[1]++;
      if ((t.hp ?? 0) <= 0) c[0]++;
      g.set(k, c);
    }
    return g;
  }

  hud(m: Mission) {
    return `disable the SAM site: ${[...this.groups(m)].map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', ')}`;
  }

  marker(m: Mission) {
    const v = view(m);
    const rw = v.worldOf(v.ranger);
    const up = v.targets.filter((t) => (t.hp ?? 0) > 0);
    if (!up.length) return null;
    const near = up.reduce((a, b) => (dist(v.worldOf(a.at), rw) < dist(v.worldOf(b.at), rw) ? a : b));
    return dist(v.worldOf(near.at), rw) < 45 ? screenCell(near.at) : null;
  }

  stats(m: Mission) {
    return Object.fromEntries([...this.groups(m)].map(([k, [a, b]]) => [`${k} destroyed`, `${a}/${b}`]));
  }
}

registerObjective('sam', () => new Sam());
