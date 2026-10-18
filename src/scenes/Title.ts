import Phaser from 'phaser';
import { loadRoster, saveRoster, newRanger, randomName, selected, RANKS, MEDALS, SLOTS, type Ranger } from '../roster';
import { sfx, startDrums, stopDrums, muteKeys } from '../sound';
import { drawRibbon } from './ribbons';
import { fitMenu, isTouch } from '../touch';

const FONT = { fontFamily: 'monospace' };
const GOLD = '#e8d27a';
const DIM = '#9aa88a';

/**
 * Title and Ranger select: the roster's six slots. Up/Down (or 1–6) picks a slot; Enter on an active Ranger goes to
 * the mission select, on a vacant slot enlists a new Ranger (type a name, Enter); Delete twice retires the picked
 * Ranger (frees the slot). F opens the test field. A drum loop plays here.
 *
 * ?scene=<key> skips the title once (scripts/load-check.mjs); ?scene=mission&mission=mission2 plays a mission as a
 * guest (not on the roster).
 */
export class Title extends Phaser.Scene {
  private pick = 0;
  private roster: (Ranger | null)[] = [];
  /** One text per slot (scripts/load-check.mjs reads them). */
  rows: Phaser.GameObjects.Text[] = [];
  private ribbons: Phaser.GameObjects.Graphics[] = [];
  private hint!: Phaser.GameObjects.Text;
  /** The name being typed for a new Ranger (null: not enlisting). */
  typing: string | null = null;
  private retireArmed = -1;

  constructor() {
    super('title');
  }

  create() {
    const q = new URLSearchParams(window.location.search);
    const want = q.get('scene');
    if (want && want !== 'title' && this.scene.get(want) && !this.registry.get('skipped')) {
      this.registry.set('skipped', true);
      this.scene.start(want, { mission: q.get('mission') ?? undefined });
      return;
    }
    this.typing = null;
    this.retireArmed = -1;
    this.roster = loadRoster();
    const { width, height } = fitMenu(this, 660, 600);
    const cx = width / 2;
    const top = Math.max(30, height / 2 - 250);
    this.add.text(cx, top, 'AIRBORNE RANGER', { ...FONT, fontSize: '44px', color: GOLD }).setOrigin(0.5);
    this.add.text(cx, top + 50, 'built with Synty Sprite Generator', { ...FONT, fontSize: '16px', color: DIM }).setOrigin(0.5);
    this.add.text(cx, top + 105, 'SELECT RANGER', { ...FONT, fontSize: '20px', color: '#c8c8a0' }).setOrigin(0.5);
    const rowW = Math.min(860, width - 40);
    this.rows = [];
    this.ribbons = [];
    for (let k = 0; k < SLOTS; k++) {
      const t = this.add
        .text(cx - rowW / 2, top + 145 + k * 44, '', { ...FONT, fontSize: '18px', color: GOLD, padding: { x: 10, y: 8 }, fixedWidth: rowW })
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', (p: Phaser.Input.Pointer) => !p.wasTouch && this.typing === null && this.select(k));
      // A tap or click: choose (or enlist); tapping the new Ranger's row again enlists that name. Holding a row
      // (touch) or a right click retires its Ranger, like Delete.
      let downAt = 0;
      t.on('pointerdown', (p: Phaser.Input.Pointer) => {
        downAt = this.time.now;
        if (p.rightButtonDown()) this.retire(k);
      });
      t.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.rightButtonReleased()) return;
        if (this.time.now - downAt > 600) return this.retire(k);
        if (this.typing !== null) return k === this.pick ? void this.enlist() : undefined;
        this.go(k);
      });
      this.rows.push(t);
      this.ribbons.push(this.add.graphics());
    }
    this.hint = this.add.text(cx, top + 165 + SLOTS * 44, '', { ...FONT, fontSize: '14px', color: DIM, align: 'center' }).setOrigin(0.5, 0);
    const k0 = this.roster.findIndex((r) => r !== null && r.id === selected.get());
    this.pick = k0 >= 0 ? k0 : 0;
    this.refresh();
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.key(e));
    this.input.mouse?.disableContextMenu();
    startDrums();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      stopDrums();
      muteKeys(true);
    });
  }

  private key(e: KeyboardEvent) {
    if (this.typing !== null) {
      if (e.key === 'Enter') {
        this.enlist();
        return;
      }
      if (e.key === 'Escape') {
        this.typing = null;
        muteKeys(true);
      } else if (e.key === 'Backspace') this.typing = this.typing.slice(0, -1);
      else if (/^[a-zA-Z0-9 .'-]$/.test(e.key) && this.typing.length < 16) this.typing += e.key.toUpperCase();
      this.refresh();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'w') this.select((this.pick + SLOTS - 1) % SLOTS);
    else if (e.key === 'ArrowDown' || e.key === 's') this.select((this.pick + 1) % SLOTS);
    else if (e.key === 'Enter' || e.key === ' ') this.go(this.pick);
    else if (e.key === 'Delete') this.retire(this.pick);
    else if (e.key === 'f' || e.key === 'F') this.scene.start('field');
    else if (/^[1-6]$/.test(e.key)) {
      this.select(Number(e.key) - 1);
      this.go(this.pick);
    }
  }

  private refresh() {
    this.roster.forEach((r, k) => {
      const row = this.rows[k];
      const g = this.ribbons[k];
      g.clear();
      if (this.typing !== null && k === this.pick) {
        const blink = Math.floor(this.time.now / 400) % 2 ? '_' : ' ';
        row.setText(`${k + 1}. NEW RANGER, NAME: ${this.typing}${blink}`);
        return;
      }
      if (!r) {
        row.setText(`${k + 1}. -- vacant: enlist a new Ranger --`);
        return;
      }
      const status = r.status === 'active' ? '' : r.status === 'KIA' ? '  KIA' : '  CAPTURED';
      row.setText(`${k + 1}. ${RANKS[r.rank].padEnd(4)} ${r.name.padEnd(16)} ${String(r.score).padStart(6)} pts ${String(r.missions).padStart(3)} msn${status}`);
      // Medal ribbons at the right end of the row, highest first.
      let x = row.x + row.width - 14;
      for (const m of [...MEDALS].reverse()) {
        if (!r.medals[m]) continue;
        x -= 30;
        drawRibbon(g, m, x, row.y + 12, 26, 12);
      }
    });
    this.colour();
    const r = this.roster[this.pick];
    this.hint.setText(
      isTouch
        ? this.typing !== null
          ? 'tap the row again to enlist this Ranger'
          : this.retireArmed === this.pick
            ? 'hold again to retire this Ranger (the slot is freed)'
            : `${!r ? 'tap: enlist a Ranger here' : r.status === 'active' ? 'tap: choose this Ranger' : `${r.name} was ${r.status === 'KIA' ? 'killed in action' : 'captured'}: hold the row twice to retire`}\ntap a row · hold a row: retire`
        : this.typing !== null
          ? 'type a name · Enter: enlist · Esc: cancel'
          : this.retireArmed === this.pick
            ? 'press Delete again to retire this Ranger (the slot is freed)'
            : `${!r ? 'Enter: enlist a Ranger here' : r.status === 'active' ? 'Enter: choose this Ranger' : `${r.name} was ${r.status === 'KIA' ? 'killed in action' : 'captured'}: Delete twice to retire, then enlist`}\nUp/Down or 1-6 · Delete: retire · M: sound on/off · F: test field`,
    );
  }

  private colour() {
    this.rows.forEach((t, i) => {
      const r = this.roster[i];
      const out = r && r.status !== 'active';
      const on = i === this.pick;
      t.setColor(on ? '#10140c' : out ? '#a07a6c' : r ? GOLD : DIM).setBackgroundColor(on ? (out ? '#b08070' : GOLD) : '#00000000');
    });
  }

  private select(k: number) {
    if (k !== this.pick) sfx.click();
    this.pick = k;
    if (this.retireArmed !== k) this.retireArmed = -1;
    this.refresh();
  }

  /** Enter on slot k: choose an active Ranger, or start enlisting on a vacant slot. */
  go(k: number) {
    const r = this.roster[k];
    this.pick = k;
    if (!r) {
      this.typing = randomName(this.roster.filter((x): x is Ranger => x !== null).map((x) => x.name));
      muteKeys(false);
      sfx.click();
      this.refresh();
      return;
    }
    if (r.status !== 'active') {
      this.refresh();
      return;
    }
    sfx.confirm();
    selected.set(r.id);
    this.scene.start('missions');
  }

  /** Enlist the typed name (or `name`) in the picked slot. */
  enlist(name?: string) {
    const r = newRanger(name ?? this.typing ?? '');
    this.roster[this.pick] = r;
    saveRoster(this.roster);
    this.typing = null;
    muteKeys(true);
    sfx.confirm();
    this.refresh();
    return { id: r.id, name: r.name };
  }

  private retire(k: number) {
    if (!this.roster[k]) return;
    if (this.retireArmed !== k) {
      this.retireArmed = k;
      this.refresh();
      return;
    }
    this.roster[k] = null;
    saveRoster(this.roster);
    this.retireArmed = -1;
    sfx.click();
    this.refresh();
  }

  update() {
    if (this.typing !== null) this.refresh();
  }
}
