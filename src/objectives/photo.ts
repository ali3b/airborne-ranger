import { registerObjective, type Objective } from './index';
import type { Mission } from '../scenes/Mission';
import type { Placed } from '../scenes/Field';
import { dirFromWorld, screenToTile } from '../iso';
import { sfx } from '../sound';
import { distToProp, inArea, say, seenBy, view, type MissionView } from './g8b-view';

/**
 * Mission 9, Photograph an Experimental Aircraft (G8). The original: "Infiltrate an enemy airfield and sneak into the
 * hangar. Do not allow yourself to be seen entering the hangar!" The prototype (`prototype_rocket`, the map object
 * with the `prototype` property) stands at the hangar. The Ranger gets within PHOTO_RANGE with a clear line of sight
 * and uses the camera (C, or CAMERA on the touch item bar): he kneels and holds still (`ranger_ops`
 * camera_kneel_shoot) for EXPOSURE seconds; moving away, releasing C early or losing sight spoils it. Seen by a
 * soldier inside the hangar zone before the photos are taken: the run is blown (failed). The prototype destroyed
 * before it is photographed: failed. Then extraction as usual.
 */
const PHOTO_RANGE = 16; // metres from the prototype's hull
const EXPOSURE = 1.5; // seconds held still

class Photo implements Objective {
  private subject: Placed | null = null;
  private taken = false;
  /** Seconds into the exposure, or null when not taking one. */
  private exposing: number | null = null;
  private attempts = 0;
  private seenAtHangar = false;

  start(m: Mission) {
    const v = view(m);
    this.subject = v.props.find((p) => p.name === 'prototype_rocket') ?? null;
    const kb = v.input.keyboard;
    const key = kb?.addKey('C');
    key?.on('down', () => this.shoot(v));
    // Keyboard: the exposure lasts while C is held.
    key?.on('up', () => this.exposing !== null && this.exposing < EXPOSURE && this.spoil(v, 'held too short'));
    v.touchExtras.push({ key: 'camera', label: 'CAMERA', count: '', selected: false, action: () => this.shoot(v) });
  }

  /** Can the Ranger photograph the prototype from where he is: range, and no prop in between. */
  private inView(v: MissionView): string | null {
    const s = this.subject;
    if (!s) return 'no subject';
    const me = v.worldOf(v.ranger);
    const d = distToProp(me, s);
    if (d > PHOTO_RANGE) return `too far (${Math.round(d)} m)`;
    const at = v.worldOf(s.at);
    const len = Math.hypot(at.x - me.x, at.y - me.y);
    for (let t = 0.6; t < len; t += 0.3) {
      const q = { x: me.x + ((at.x - me.x) * t) / len, y: me.y + ((at.y - me.y) * t) / len };
      const p = v.propAt(q);
      if (p === s) break;
      if (p) return 'no line of sight';
    }
    return null;
  }

  private shoot(v: MissionView) {
    if (this.taken || this.exposing !== null || v.busy || v.dead || !this.subject || v.objectiveDone) return;
    const why = this.inView(v);
    if (why) {
      sfx.dryFire();
      say(v, `CAMERA: ${why}`, '#ffb060');
      return;
    }
    this.attempts++;
    v.prone = false;
    v.busy = true;
    this.exposing = 0;
    const me = v.worldOf(v.ranger);
    const at = v.worldOf(this.subject.at);
    v.facing = dirFromWorld(at.x - me.x, at.y - me.y);
    if (!v.play(v.ranger, 'ranger_ops', 'camera_kneel_shoot', v.facing, false)) v.play(v.ranger, 'ranger', 'rifle_idle', v.facing, false);
    sfx.click();
  }

  private spoil(v: MissionView, why: string) {
    this.exposing = null;
    v.busy = false;
    sfx.dryFire();
    say(v, `PHOTO SPOILED: ${why}`, '#ffb060');
  }

  update(m: Mission, dt: number): 'pending' | 'done' | { failed: string } {
    const v = view(m);
    if (!this.subject) return { failed: 'There was no prototype to photograph.' };
    if (!this.taken && (this.subject.hp ?? 1) <= 0) return { failed: 'The prototype was destroyed before it was photographed.' };
    const c = v.rangerCell();
    if (!this.taken && !v.dead && inArea([c.x, c.y], v.objectiveArea) && seenBy(v)) {
      this.seenAtHangar = true;
      return { failed: 'Seen at the hangar: the prototype was rolled away under guard.' };
    }
    if (this.exposing !== null) {
      if (v.dead) this.exposing = null;
      else if (this.inView(v)) this.spoil(v, 'lost sight');
      else if ((this.exposing += dt) >= EXPOSURE) {
        this.exposing = null;
        this.taken = true;
        v.busy = false;
        sfx.pickup();
        // The flash.
        const f = v.add.circle(v.ranger.x, v.ranger.y - 50, 6, 0xffffff, 0.9).setDepth(9e8 + 5);
        v.tweens.add({ targets: f, scale: 6, alpha: 0, duration: 250, onComplete: () => f.destroy() });
        say(v, 'PHOTOGRAPHS TAKEN', '#80ff80');
      }
    }
    return this.taken ? 'done' : 'pending';
  }

  hud(m: Mission) {
    const v = view(m);
    if (this.exposing !== null) return `PHOTOGRAPHING… ${Math.max(0, EXPOSURE - this.exposing).toFixed(1)} s, hold still`;
    const why = this.subject ? this.inView(v) : null;
    return `photograph the prototype unseen (${why ? `C camera: ${why}` : 'in view: C / CAMERA'})`;
  }

  marker(): { x: number; y: number } | null {
    return this.subject ? cellOf(this.subject) : null;
  }

  stats(): Record<string, string | number> {
    return { photos: this.taken ? 'taken' : 'none', 'camera tries': this.attempts, ...(this.seenAtHangar ? { seen: 'at the hangar' } : {}) };
  }

  /** For scripts/load-check.mjs. */
  get state() {
    return { taken: this.taken, exposing: this.exposing, subject: this.subject?.name ?? null };
  }
}

/** A prop's anchor in map cells (the iso inverse of tileToScreen). */
export function cellOf(p: Placed) {
  const { i, j } = screenToTile(p.at.x, p.at.y);
  return { x: i, y: j };
}

registerObjective('photo', () => new Photo());
