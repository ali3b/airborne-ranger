import Phaser from 'phaser';
import { isTouch } from './touch';
import { screenToWorldDelta, worldToScreenDelta } from './iso';

// G12: mouse aim on desktop. Moving the mouse over the game (or clicking) turns it on: the commando faces the
// cursor and shoots, throws and fires toward it; left click uses the selected weapon (held: repeats at the
// weapon's rate), right click throws a grenade. A crosshair replaces the system cursor, coloured by whether the
// selected weapon reaches; a grenade or LAW selected also shows its range as a ring on the ground. Walking on the
// keys with the mouse left alone for a moment turns it off again (keyboard play as before). Touch devices: off.

type Pt = { x: number; y: number };

export interface AimHost {
  readonly scene: Phaser.Scene;
  /** The commando's feet (screen px), or null when there is no commando. */
  feet(): Pt | null;
  ppm(): number;
  /** Living soldiers the cursor snaps to: pointing at one's body aims at his feet. */
  targets(): Phaser.GameObjects.Sprite[];
  /** The selected weapon's reach in metres (0: no range shown), and whether to draw it as a ring. */
  reach(): { metres: number; ring: boolean };
  /** A grenade's reach in metres (the crosshair's centre dot: green while a right-click grenade reaches). */
  grenadeReach: number;
  /** True while the action is paused or over (the overview map, the end screen, dead): no aim, the system cursor. */
  paused(): boolean;
  /** Moving on the keys this frame. */
  keyMoving(): boolean;
  fire(): void;
  grenade(): void;
}

/** Seconds of keyboard movement with the mouse left alone before mouse aim turns off. */
const IDLE_OFF_S = 2;
const OK = 0xf0e8a0;
const FAR = 0xff5040;

export class MouseAim {
  /** Mouse aim is on (the commando faces and fires toward the cursor). */
  on = false;
  private lastMove = -1e9;
  private cross: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Graphics;
  private cursorHidden = false;

  constructor(private host: AimHost) {
    const sc = host.scene;
    this.cross = sc.add.graphics().setScrollFactor(0).setDepth(1.5e9).setVisible(false);
    this.ring = sc.add.graphics().setDepth(9e8).setVisible(false);
    if (isTouch) return;
    sc.input.mouse?.disableContextMenu();
    const wake = (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) return false;
      this.on = true;
      this.lastMove = sc.time.now;
      return true;
    };
    sc.input.on(Phaser.Input.Events.POINTER_MOVE, wake);
    sc.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!wake(p) || over.length || host.paused()) return; // a click on a button or the open map isn't a shot
      if (p.rightButtonDown()) host.grenade();
      else if (p.leftButtonDown()) host.fire();
    });
    sc.input.on(Phaser.Input.Events.GAME_OUT, () => this.off());
    sc.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    sc.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      sc.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
      this.showCursor(true);
    });
  }

  off() {
    this.on = false;
    this.cross.setVisible(false);
    this.ring.setVisible(false);
    this.showCursor(true);
  }

  private showCursor(show: boolean) {
    if (this.cursorHidden === !show) return;
    this.cursorHidden = !show;
    this.host.scene.input.setDefaultCursor(show ? '' : 'none');
  }

  /**
   * The ground point the cursor aims at (screen px, the world layer), or null when mouse aim is off. Pointing at a
   * soldier's body aims at his feet (the cursor's own ground point would lie behind him).
   */
  point(): Pt | null {
    if (!this.on) return null;
    const p = this.host.scene.input.activePointer;
    const w = this.host.scene.cameras.main.getWorldPoint(p.x, p.y);
    for (const s of this.host.targets()) {
      const half = s.displayWidth / 5;
      if (w.x > s.x - half && w.x < s.x + half && w.y < s.y + 4 && w.y > s.y - s.displayHeight * 0.75) return { x: s.x, y: s.y };
    }
    return { x: w.x, y: w.y };
  }

  /** World metres (x east, y north) from the commando's feet to the aim point, or null. */
  offset(): Pt | null {
    const at = this.point();
    const f = this.host.feet();
    return at && f ? screenToWorldDelta(at.x - f.x, at.y - f.y, this.host.ppm()) : null;
  }

  private update() {
    if (!this.on) return;
    const sc = this.host.scene;
    const p = sc.input.activePointer;
    if (this.host.keyMoving() && !p.leftButtonDown() && sc.time.now - this.lastMove > IDLE_OFF_S * 1000) return this.off();
    if (this.host.paused()) {
      this.cross.setVisible(false);
      this.ring.setVisible(false);
      this.showCursor(true);
      return;
    }
    this.showCursor(false);
    if (p.leftButtonDown()) this.host.fire(); // held: the weapon's own rate (busy while its clip plays)
    this.draw();
  }

  private draw() {
    const f = this.host.feet();
    const o = this.offset();
    if (!f || !o) return;
    const d = Math.hypot(o.x, o.y);
    const { metres, ring } = this.host.reach();
    const col = metres && d > metres ? FAR : OK;
    const p = this.host.scene.input.activePointer;
    const g = this.cross.clear().setVisible(true);
    // The crosshair: a dark outline under a light one so it reads on snow and sand alike.
    for (const [w, c, a] of [
      [4, 0x10140c, 0.7],
      [2, col, 1],
    ] as const) {
      g.lineStyle(w, c, a);
      g.strokeCircle(p.x, p.y, 11);
      g.lineBetween(p.x - 18, p.y, p.x - 6, p.y).lineBetween(p.x + 6, p.y, p.x + 18, p.y);
      g.lineBetween(p.x, p.y - 18, p.x, p.y - 6).lineBetween(p.x, p.y + 6, p.x, p.y + 18);
    }
    g.fillStyle(d > this.host.grenadeReach ? 0xffa040 : 0x80ff80, 1).fillCircle(p.x, p.y, 2.5);
    const r = this.ring.clear().setVisible(ring);
    if (!ring || !metres) return;
    // The weapon's range on the ground (2:1 iso: an ellipse), and where a throw beyond it lands.
    const ppm = this.host.ppm();
    r.lineStyle(2, col, 0.45).strokeEllipse(f.x, f.y, metres * ppm * 2, metres * ppm);
    if (d > metres) {
      const s = worldToScreenDelta((o.x / d) * metres, (o.y / d) * metres, ppm);
      const x = f.x + s.x;
      const y = f.y + s.y;
      r.lineStyle(2, FAR, 0.9).lineBetween(x - 6, y - 3, x + 6, y + 3).lineBetween(x - 6, y + 3, x + 6, y - 3);
    }
  }
}
