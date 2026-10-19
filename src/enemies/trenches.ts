import Phaser from 'phaser';
import { screenToTile } from '../iso';
import { distToPolyline, type FieldHost } from './host';

/**
 * G9 trenches. A trench is a map zone (`custom` polyline, property `trench`, `width` m) laid over the map's dug trench
 * lines (mission 1's mud trenches with wire). Inside one the Ranger is in cover: he moves slower (SLOW), enemies see
 * him from less far (SIGHT) and hit him less often (COVER); he stands in it up to his waist (the bottom of his sprite
 * is hidden by the trench's earth while he's up; prone he's simply in it).
 */
const SLOW = 0.65;
const SIGHT = 0.5;
const COVER = 0.4;
const SINK_PX = 22; // how much of the Ranger's legs the trench hides

export interface Trench {
  line: [number, number][]; // map cells
  half: number; // cells (1 m)
}

export class Trenches {
  list: Trench[] = [];
  /** True while the Ranger is in a trench (updated each frame). */
  inside = false;
  stats = { entered: 0 };
  lip?: Phaser.GameObjects.Ellipse;
  private mask?: Phaser.Display.Masks.GeometryMask;
  private maskShape?: Phaser.GameObjects.Graphics;

  constructor(private host: FieldHost) {}

  add(line: [number, number][], width: number) {
    this.list.push({ line, half: width / 2 });
  }

  update() {
    const h = this.host;
    const was = this.inside;
    if (this.list.length && !h.dead) {
      const c = screenToTile(h.ranger.x, h.ranger.y);
      this.inside = this.list.some((t) => distToPolyline([c.i, c.j], t.line) <= t.half);
    } else this.inside = false;
    if (this.inside && !was) this.stats.entered++;
    // Waist deep: a mask hides his legs and a dark hole lies around them while he's up. (A crop would be simpler,
    // but Phaser 3.80's crop clamps to the trimmed frame size while measuring from the untrimmed corner, so it shows
    // nothing on the generator's trimmed atlas frames.)
    const sink = this.inside && !h.prone && !h.dead;
    if (sink) {
      if (!this.mask) {
        this.maskShape = h.make.graphics({}, false).fillStyle(0xffffff).fillRect(-150, -400, 300, 400 - SINK_PX);
        this.mask = this.maskShape.createGeometryMask();
        this.lip = h.add.ellipse(0, 0, 54, 22, 0x2e261a, 0.85).setStrokeStyle(2, 0x5a4a32, 1);
      }
      this.maskShape!.setPosition(h.ranger.x, h.ranger.y);
      if (h.ranger.mask !== this.mask) h.ranger.setMask(this.mask);
      this.lip!.setVisible(true).setPosition(h.ranger.x, h.ranger.y - SINK_PX + 2).setDepth(h.ranger.depth - 0.5);
    } else if (this.mask && h.ranger.mask === this.mask) {
      h.ranger.clearMask();
      this.lip?.setVisible(false);
    }
  }

  get speed() {
    return this.inside ? SLOW : 1;
  }
  get sight() {
    return this.inside && !this.host.prone ? SIGHT : this.inside ? 0.8 : 1;
  }
  get cover() {
    return this.inside ? COVER : 1;
  }
}
