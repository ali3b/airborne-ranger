import Phaser from 'phaser';
import { MISSIONS } from '../missions';
import { loadRoster, selected, RANKS, RANK_NAMES, type Ranger } from '../roster';
import { sfx } from '../sound';

const FONT = { fontFamily: 'monospace' };
const GOLD = '#e8d27a';
const DIM = '#9aa88a';

/** Mission select for the chosen Ranger: Up/Down (or 1–9) picks, Enter or a click drops in, Esc back to the roster. */
export class MissionSelect extends Phaser.Scene {
  private pick = 0;
  /** One text per mission (scripts/load-check.mjs reads them). */
  rows: Phaser.GameObjects.Text[] = [];
  ranger: Ranger | null = null;

  constructor() {
    super('missions');
  }

  create() {
    this.ranger = loadRoster().find((r) => r !== null && r.id === selected.get()) ?? null;
    if (!this.ranger || this.ranger.status !== 'active') {
      this.scene.start('title');
      return;
    }
    const r = this.ranger;
    const { width, height } = this.scale;
    const cx = width / 2;
    const top = Math.max(30, height / 2 - 200);
    this.add.text(cx, top, 'AIRBORNE RANGER', { ...FONT, fontSize: '36px', color: GOLD }).setOrigin(0.5);
    this.add
      .text(cx, top + 52, `${RANK_NAMES[r.rank].toUpperCase()} ${r.name}  ·  ${r.score} pts  ·  ${r.missions} missions`, { ...FONT, fontSize: '17px', color: '#c8c8a0' })
      .setOrigin(0.5);
    this.add.text(cx, top + 105, 'SELECT MISSION', { ...FONT, fontSize: '20px', color: '#c8c8a0' }).setOrigin(0.5);
    this.rows = MISSIONS.map((m, k) => {
      const done = r.accomplished?.includes(m.number) ? '  [done]' : '';
      const t = this.add
        .text(cx, top + 150 + k * 38, `${m.number}. ${m.title}  (${m.climate})${done}`, { ...FONT, fontSize: '18px', color: GOLD, padding: { x: 10, y: 5 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', () => this.select(k));
      t.on('pointerdown', () => this.go(k));
      return t;
    });
    this.add
      .text(cx, top + 175 + MISSIONS.length * 38, `Up/Down or 1-${MISSIONS.length} to pick · Enter or click to drop in · Esc: roster · M: sound`, { ...FONT, fontSize: '14px', color: DIM })
      .setOrigin(0.5);
    this.add.text(cx, top + 200 + MISSIONS.length * 38, `rank ${RANKS[r.rank]}`, { ...FONT, fontSize: '12px', color: DIM }).setOrigin(0.5);
    this.pick = 0;
    this.select(0);
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') this.select((this.pick + MISSIONS.length - 1) % MISSIONS.length);
      else if (e.key === 'ArrowDown' || e.key === 's') this.select((this.pick + 1) % MISSIONS.length);
      else if (e.key === 'Enter' || e.key === ' ') this.go(this.pick);
      else if (e.key === 'Escape') this.scene.start('title');
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= MISSIONS.length) this.go(Number(e.key) - 1);
    });
  }

  select(k: number) {
    if (k !== this.pick) sfx.click();
    this.pick = k;
    this.rows.forEach((t, i) => t.setColor(i === k ? '#10140c' : GOLD).setBackgroundColor(i === k ? GOLD : '#00000000'));
  }

  go(k: number) {
    sfx.confirm();
    this.scene.start('mission', { mission: MISSIONS[k].map, ranger: this.ranger?.id });
  }
}
