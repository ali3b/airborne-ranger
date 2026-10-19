import { props } from '../assets';
import type { Dir8 } from '../iso';
import type { Mission } from '../scenes/Mission';
import { sfx } from '../sound';
import { registerObjective, type Objective } from './index';
import { centroid, customZones, dist, Escort, Follower, rangerExtracting, say, screenCell, view, zoneCell } from './follower';

/** Metres: the officer gives up when the Ranger gets this close. */
const SURRENDER = 3;
/** Metres: he shouts for the guards when he spots the Ranger farther off (not prone). */
const SHOUT = 9;
/** Metres from the Ranger the officer must be when the Ranger reaches the extraction zone. */
const DELIVER = 7;

/**
 * Mission 6, Capture an Enemy Officer: the officer (`officer`, the map's custom zone with `officer`) is at his
 * headquarters. If he spots the Ranger at a distance he shouts for his guards; when the Ranger gets close he
 * surrenders and follows him (`Follower`). Bring him to the extraction zone alive: a stray bullet or a blast that
 * kills him fails the mission.
 */
class Officer implements Objective {
  private officer?: Follower;
  private escort?: Escort;
  private state: 'free' | 'surrendering' | 'captured' = 'free';
  private shouted = false;
  private capturedAt: number | null = null;

  start(m: Mission) {
    const z = customZones(m, 'officer')[0];
    if (!z) return;
    const facing = (typeof props(z).facing === 'string' ? props(z).facing : 'SW') as Dir8;
    this.officer = new Follower(m, view(m).manifest.sprites.officer ? 'officer' : 'german', zoneCell(m, z), facing, 1.6);
    this.escort = new Escort(m, [this.officer]);
  }

  update(m: Mission, dt: number) {
    const o = this.officer;
    if (!o || !this.escort) return 'pending' as const;
    this.escort.update(dt);
    if (!o.alive) return { failed: 'The enemy officer was killed.' };
    const v = view(m);
    const rw = v.worldOf(v.ranger);
    const d = dist(o.world, rw);
    if (this.state === 'free' && !v.dead) {
      if (d < SURRENDER) {
        this.state = 'surrendering';
        o.face(rw);
        say(m, o.sprite, 'NICHT SCHIESSEN!', '#ffffff');
        sfx.confirm();
        // FB-076: no hands-up clip; hit_react stands in for the surrender gesture.
        o.gesture(() => {
          this.state = 'captured';
          this.capturedAt = v.cfg.seconds - v.timeLeft;
          o.join();
          say(m, v.ranger, 'OFFICER CAPTURED');
        });
      } else if (d < SHOUT && !v.prone && !this.shouted) {
        this.shouted = true;
        o.face(rw);
        say(m, o.sprite, 'ALARM!', '#ff9080');
        v.noise(o.sprite, 16);
      }
    }
    if (this.state === 'captured' && rangerExtracting(m) && d < DELIVER) return 'done' as const;
    return 'pending' as const;
  }

  hud(m: Mission) {
    if (this.state !== 'captured') return 'capture the enemy officer at his headquarters';
    const o = this.officer!;
    const v = view(m);
    const lag = dist(o.world, v.worldOf(v.ranger)) > 10 ? ' (he is falling behind)' : '';
    return `escort the officer to the extraction zone${lag}`;
  }

  marker(m: Mission) {
    return this.state === 'captured' ? centroid(view(m).extractArea) : this.officer && this.shouted ? screenCell(this.officer.sprite) : null;
  }

  stats(): Record<string, string | number> {
    const o = this.officer;
    if (!o) return {};
    return { officer: !o.alive ? `killed (${o.killedBy})` : this.state === 'captured' ? 'captured' : 'still at large', ...(this.capturedAt !== null ? { 'captured at': `${Math.floor(this.capturedAt / 60)}:${String(Math.round(this.capturedAt % 60)).padStart(2, '0')}` } : {}) };
  }
}

registerObjective('officer', () => new Officer());
