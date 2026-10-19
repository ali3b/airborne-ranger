import Phaser from 'phaser';
import { props } from '../assets';
import { tileToScreen } from '../iso';
import type { Mission } from '../scenes/Mission';
import { sfx } from '../sound';
import { registerObjective, type Objective } from './index';
import { cellWorld, clock, customZones, dist, say, screenCell, view, zoneCell } from './follower';

/** Metres from the book at which the Ranger picks it up. */
const PICKUP = 1.2;

/**
 * Mission 5, Steal a Code Book: the book (`code_book`, the map's custom zone with `codebook`, raised `height` metres
 * onto the table it lies on) is in the headquarters. Walking up to it takes it: the objective is done, then the
 * extraction as usual.
 */
class CodeBook implements Objective {
  private book?: Phaser.GameObjects.Sprite;
  private glint?: Phaser.GameObjects.Arc;
  private at = { x: 0, y: 0 };
  private cell: [number, number] = [0, 0];
  private takenAt: string | null = null;

  start(m: Mission) {
    const v = view(m);
    const z = customZones(m, 'codebook')[0];
    if (!z) return;
    this.cell = zoneCell(m, z);
    this.at = cellWorld(m, this.cell);
    const ground = tileToScreen(this.cell[0], this.cell[1]);
    // FB-079: objects can't sit on others; the zone's `height` lifts the book onto the table.
    const lift = Number(props(z).height ?? 0) * v.ppm * 0.866;
    const has = !!v.manifest.sprites.code_book;
    this.book = v.add.sprite(ground.x, ground.y - lift, has ? 'code_book' : '__WHITE').setDepth(ground.y + 2);
    if (has) {
      const s = v.manifest.sprites.code_book;
      v.play(this.book, 'code_book', s.clips[0], (s.dirs.includes('SE') ? 'SE' : s.dirs[0]) as never);
    } else this.book.setDisplaySize(14, 10).setTint(0x8a2020);
    v.tweens.add({ targets: this.book, y: this.book.y - 5, yoyo: true, repeat: -1, duration: 800, ease: 'Sine.inOut' });
    // A glint so it can be found on the table.
    this.glint = v.add.circle(ground.x, ground.y - lift - 14, 3, 0xfff6c0, 0.9).setDepth(ground.y + 3);
    v.tweens.add({ targets: this.glint, scale: 2.4, alpha: 0.1, yoyo: true, repeat: -1, duration: 600 });
  }

  update(m: Mission) {
    if (this.takenAt) return 'done' as const;
    const v = view(m);
    if (!this.book || v.dead || dist(v.worldOf(v.ranger), this.at) > PICKUP) return 'pending' as const;
    this.takenAt = clock(m);
    sfx.pickup();
    say(m, v.ranger, 'CODE BOOK TAKEN');
    v.tweens.killTweensOf(this.book);
    this.glint?.destroy();
    v.tweens.add({ targets: this.book, x: v.ranger.x, y: v.ranger.y - 60, alpha: 0, duration: 450, onComplete: () => this.book?.destroy() });
    return 'done' as const;
  }

  hud() {
    return 'steal the code book from the headquarters';
  }

  marker(m: Mission) {
    // The compass points at the book once he's near the headquarters (the zone's centre before that).
    const v = view(m);
    return dist(v.worldOf(v.ranger), this.at) < 40 ? screenCell(tileToScreen(this.cell[0], this.cell[1])) : null;
  }

  stats(): Record<string, string | number> {
    return this.takenAt ? { 'code book taken at': this.takenAt } : { 'code book': 'not taken' };
  }
}

registerObjective('codebook', () => new CodeBook());
