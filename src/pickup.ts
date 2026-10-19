import Phaser from 'phaser';
import { animKey } from './assets';
import { isTouch } from './touch';
import { screenToTile, tileToScreen } from './iso';
import { sfx } from './sound';
import { inPoly, type FieldHost } from './enemies/host';
import type { G9 } from './enemies/index';

/**
 * G9: the plane's recall and pickup. With the objective done, the Ranger in the extraction zone calls the plane
 * (C, or the CALL PLANE touch button). It takes the difficulty's `pickupWait` seconds; the call is heard, so the alarm
 * goes up and he has to hold out. The plane (`plane_pickup`: the C-47 transport at full scale, its propellers
 * spinning) flies in from the north over the zone; if he's in the zone when it's overhead he's lifted aboard and the
 * mission is accomplished, otherwise it goes round and comes back (GO_ROUND s). The clock still runs: the plane leaves
 * for good when it's out.
 */
const FLY_IN = 6; // seconds of the approach (and of the climb-out)
const SPEED = 300; // px per second on screen (about 13 m/s north–south: slow enough to watch)
const ALTITUDE = 240; // px above the ground
const GO_ROUND = 12; // seconds
const BOARD = 1.2; // seconds of the lift

type State = 'idle' | 'called' | 'inbound' | 'boarding' | 'done';

export class Pickup {
  state: State = 'idle';
  /** Seconds until the plane is over the zone. */
  eta = 0;
  stats = { calls: 0, passes: 0, missed: 0 };
  private plane?: Phaser.GameObjects.Sprite;
  private shadow?: Phaser.GameObjects.Sprite;
  private over: { x: number; y: number } = { x: 0, y: 0 };
  private button?: HTMLButtonElement;

  constructor(
    private host: FieldHost,
    private g9: G9,
  ) {
    if (!host.extractArea) return;
    host.input.keyboard?.addKey('C').on('down', () => this.call());
    if (isTouch) this.makeButton();
  }

  /** Is the Ranger in the extraction zone? */
  inZone() {
    const h = this.host;
    if (!h.extractArea?.length) return false;
    const c = screenToTile(h.ranger.x, h.ranger.y);
    return inPoly([c.i, c.j], h.extractArea);
  }

  get canCall() {
    const h = this.host;
    return this.state === 'idle' && !h.cfg?.planeWaiting && !!h.objectiveDone && !h.dead && !h.outcome && this.inZone();
  }

  /** Radio the plane. */
  call() {
    if (!this.canCall) return false;
    this.state = 'called';
    this.eta = this.g9.mods.pickupWait;
    this.stats.calls++;
    sfx.confirm();
    this.say('PLANE CALLED: hold the zone');
    // The radio call is heard: the enemy comes for him.
    this.g9.alerts.raiseAlarm(this.host.ranger);
    return true;
  }

  /** For Mission's extraction check: true once the Ranger is aboard. */
  get done() {
    return this.state === 'done';
  }

  update(dt: number) {
    const h = this.host;
    if (this.button) {
      const show = this.canCall || this.state === 'called' || this.state === 'inbound';
      this.button.style.display = show && !h.overview?.isOpen ? 'block' : 'none';
      this.button.textContent = this.state === 'idle' ? 'CALL PLANE' : `PLANE ${Math.max(0, Math.ceil(this.eta))}s`;
      this.button.classList.toggle('on', this.state !== 'idle');
    }
    // G8 mission 11: the plane has already landed at the border (MissionConfig.planeWaiting): no call, no alarm; it
    // comes in as soon as the Ranger is in the zone.
    if (h.cfg?.planeWaiting && this.state === 'idle' && h.objectiveDone && !h.dead && !h.outcome && this.inZone()) {
      this.state = 'called';
      this.eta = FLY_IN;
      this.say('THE PLANE IS HERE: get aboard');
    }
    if (this.state === 'idle' || this.state === 'done' || this.state === 'boarding') return;
    this.eta -= dt;
    if (this.state === 'called' && this.eta <= FLY_IN) this.flyIn();
    if (this.state === 'inbound') this.fly();
  }

  private zoneCentre() {
    const a = this.host.extractArea!;
    const c = [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
    return tileToScreen(c[0], c[1]);
  }

  /** The plane appears north of the zone (screen up) and flies south over it. */
  private flyIn() {
    const h = this.host;
    this.state = 'inbound';
    this.stats.passes++;
    this.over = this.zoneCentre();
    const s = h.manifest.sprites.plane_pickup;
    const dir = s?.dirs[0] ?? 'S';
    const key = s ? animKey(s, s.clips[0], dir) : '';
    if (!h.anims.exists(key)) return;
    this.shadow = h.add.sprite(0, 0, 'plane_pickup').play(key).setTintFill(0x000000).setAlpha(0.22).setDepth(-1e8 + 1);
    this.plane = h.add.sprite(0, 0, 'plane_pickup').play(key).setDepth(9e8 + 5);
    this.fly();
  }

  private fly() {
    // Ground point of the plane: eta seconds of flight north of the zone (screen up), the approach FLY_IN s long.
    const y = this.over.y - this.eta * SPEED;
    this.plane?.setPosition(this.over.x, y - ALTITUDE);
    this.shadow?.setPosition(this.over.x + 40, y);
    if (this.eta > 0) return;
    const h = this.host;
    if (this.inZone() && !h.dead && !h.outcome) return this.board();
    // Missed: it flies on and comes round again.
    this.stats.missed++;
    this.say('THE PLANE MISSED YOU: back to the zone');
    this.leave();
    this.state = 'called';
    this.eta = GO_ROUND;
  }

  /** Lifted aboard as the plane passes over him. */
  private board() {
    const h = this.host;
    this.state = 'boarding';
    h.busy = true;
    h.god = true;
    sfx.fanfare();
    h.tweens.add({ targets: h.ranger, y: h.ranger.y - ALTITUDE, alpha: 0, duration: BOARD * 1000, ease: 'Quad.in' });
    this.leave();
    h.time.delayedCall(BOARD * 1000, () => {
      this.state = 'done';
    });
  }

  /** The plane flies on south and off screen. */
  private leave() {
    const p = this.plane;
    const s = this.shadow;
    this.plane = this.shadow = undefined;
    if (!p) return;
    this.host.tweens.add({ targets: [p, s], y: `+=${FLY_IN * SPEED}`, duration: FLY_IN * 1000, onComplete: () => [p, s].forEach((o) => o?.destroy()) });
  }

  private say(text: string) {
    const h = this.host;
    const { width } = h.scale;
    const t = h.add
      .text(width / 2, 120, text, { fontFamily: 'monospace', fontSize: '18px', color: '#ff80c0', backgroundColor: '#10140ccc', padding: { x: 8, y: 4 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1e9);
    h.tweens.add({ targets: t, alpha: 0, delay: 2200, duration: 600, onComplete: () => t.destroy() });
  }

  /** HUD text: the call hint in the zone, the plane's countdown. */
  hud() {
    if (this.canCall) return isTouch ? 'CALL THE PLANE' : 'C: CALL THE PLANE';
    if (this.state === 'called' || this.state === 'inbound') return `PLANE ${Math.max(0, Math.ceil(this.eta))}s: hold the zone`;
    if (this.state === 'boarding') return 'PICKUP';
    return '';
  }

  /** Touch: a CALL PLANE button under the MAP button, shown when it can be used. */
  private makeButton() {
    const root = document.getElementById('touch');
    if (!root) return;
    let b = root.querySelector('button.call') as HTMLButtonElement | null;
    if (!b) {
      b = document.createElement('button');
      b.className = 'call';
      b.style.cssText =
        'position:absolute;top:calc(max(10px, env(safe-area-inset-top)) + 150px);left:max(10px, env(safe-area-inset-left));width:96px;height:40px;border-radius:8px;pointer-events:auto;font-size:12px;display:none;background:#5a1c48cc;';
      root.appendChild(b);
    }
    const btn = b;
    const tap = (e: Event) => {
      e.preventDefault();
      this.call();
    };
    btn.addEventListener('pointerdown', tap);
    this.button = btn;
    this.host.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      btn.removeEventListener('pointerdown', tap);
      btn.style.display = 'none';
    });
  }
}
