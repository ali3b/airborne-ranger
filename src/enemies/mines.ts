import Phaser from 'phaser';
import { animKey } from '../assets';
import { tileToScreen } from '../iso';
import { sfx } from '../sound';
import type { Pt } from '../scenes/Field';
import { distW, inPoly, seeded, type FieldHost } from './host';

/**
 * G9 mines. A minefield is a map zone (`custom`, property `minefield`, `mines` = how many, laid out here from the
 * zone's id so they're the same every time). Mines are hidden: the Ranger spots one only close up (REVEAL m, more when
 * he's prone or crawling, eyes on the ground); once spotted it stays visible. Stepping on one sets it off: a blast that
 * wounds or kills. A grenade, LAW or bomb blast sets off the mines around it (a way to clear a path).
 */
const REVEAL = 2.2; // metres, standing or walking
const REVEAL_PRONE = 4.5; // metres, prone or crawling
const TRIGGER = 0.45; // metres
const BLAST = 1.8; // metres
const DAMAGE = 85; // at the centre; less towards the edge
const SPACING = 1.6; // metres between mines

export interface Mine {
  at: Pt; // screen px
  w: Pt; // world metres
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Ellipse;
  seen: boolean;
  live: boolean;
}

export class Mines {
  list: Mine[] = [];
  /** Counters for the load check. */
  stats = { fields: 0, triggered: 0, chained: 0 };

  constructor(private host: FieldHost) {}

  /** Lay `count` mines inside a zone polygon (map cells), seeded by `seed`. */
  addField(poly: [number, number][], count: number, seed: string) {
    const h = this.host;
    const rnd = seeded(seed);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const c: [number, number] = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
      if (poly.length > 2 && !inPoly(c, poly)) continue;
      const at = tileToScreen(c[0], c[1]);
      const w = h.worldOf(at);
      if (!h.canStand(at.x, at.y) || h.propAt(w) || this.list.some((m) => distW(m.w, w) < SPACING)) continue;
      this.add(at);
      placed++;
    }
    this.stats.fields++;
    return placed;
  }

  /** One mine at a screen point. */
  add(at: Pt) {
    const h = this.host;
    const s = h.manifest.sprites.mine;
    const key = s ? animKey(s, s.clips[0], s.dirs[0]) : '';
    const sprite = h.anims.exists(key) ? h.add.sprite(at.x, at.y, 'mine').play(key) : h.add.ellipse(at.x, at.y - 2, 16, 8, 0x4a4a30);
    // Flat on the ground: under anyone standing on it.
    sprite.setDepth(at.y - 8).setVisible(false);
    const m: Mine = { at, w: h.worldOf(at), sprite, seen: false, live: true };
    this.list.push(m);
    return m;
  }

  update() {
    const h = this.host;
    if (h.dead || !this.list.length) return;
    const rw = h.worldOf(h.ranger);
    const reveal = h.prone ? REVEAL_PRONE : REVEAL;
    for (const m of this.list) {
      if (!m.live) continue;
      const dx = Math.abs(m.w.x - rw.x);
      const dy = Math.abs(m.w.y - rw.y);
      if (dx > REVEAL_PRONE || dy > REVEAL_PRONE) continue;
      const d = Math.hypot(dx, dy);
      if (!m.seen && d < reveal) this.spot(m);
      if (d < TRIGGER) {
        this.stats.triggered++;
        this.detonate(m);
      }
    }
  }

  private spot(m: Mine) {
    m.seen = true;
    m.sprite.setVisible(true).setAlpha(0);
    this.host.tweens.add({ targets: m.sprite, alpha: 1, duration: 250 });
    // A short red ring so the eye finds it.
    const ring = this.host.add.ellipse(m.at.x, m.at.y, 30, 15).setStrokeStyle(2, 0xff5040, 0.9).setDepth(m.at.y - 7);
    this.host.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 700, repeat: 1, onComplete: () => ring.destroy() });
  }

  /** Bang: the blast hurts the Ranger by distance and alerts the area. */
  detonate(m: Mine) {
    if (!m.live) return;
    const h = this.host;
    m.live = false;
    m.sprite.destroy();
    h.fx('explosion', m.at, m.at.y + 1000, { once: true, scale: 0.8 });
    h.dustBurst(m.at);
    sfx.explosion(0.35 + 0.65 * h.loudness(m.at, 40));
    h.cameras.main.shake(160, 0.007);
    const d = distW(h.worldOf(h.ranger), m.w);
    if (d < BLAST) h.hurtRanger(Math.round(DAMAGE * (1 - (0.5 * d) / BLAST)));
    h.noise(m.at, 20);
  }

  /** A blast at `w` (world) with `radius` m: the mines in it go off a moment later. */
  onBlast(w: Pt, radius: number) {
    for (const m of this.list) {
      if (!m.live || distW(m.w, w) > radius) continue;
      this.stats.chained++;
      this.host.time.delayedCall(120 + Math.random() * 200, () => this.detonate(m));
    }
  }
}
