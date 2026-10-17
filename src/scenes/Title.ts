import Phaser from 'phaser';
import { MISSIONS } from '../missions';

/** Title and mission select: Up/Down (or 1–9) picks a mission, Enter or a click drops in; F opens the test field. */
export class Title extends Phaser.Scene {
  private pick = 0;
  private rows: Phaser.GameObjects.Text[] = [];

  constructor() {
    super('title');
  }

  create() {
    // ?scene=field skips the title (scripts/load-check.mjs uses it); ?scene=mission&mission=mission2 picks a mission.
    const q = new URLSearchParams(window.location.search);
    const want = q.get('scene');
    if (want && want !== 'title' && this.scene.get(want)) {
      this.scene.start(want, { mission: q.get('mission') ?? undefined });
      return;
    }
    const { width, height } = this.scale;
    const cx = width / 2;
    const top = height / 2 - 150;
    this.add.text(cx, top, 'AIRBORNE RANGER', { fontFamily: 'monospace', fontSize: '40px', color: '#e8d27a' }).setOrigin(0.5);
    this.add.text(cx, top + 48, 'built with Synty Sprite Generator', { fontFamily: 'monospace', fontSize: '16px', color: '#9aa88a' }).setOrigin(0.5);
    this.add.text(cx, top + 110, 'SELECT MISSION', { fontFamily: 'monospace', fontSize: '18px', color: '#c8c8a0' }).setOrigin(0.5);
    this.rows = MISSIONS.map((m, k) => {
      const t = this.add
        .text(cx, top + 150 + k * 34, `${m.number}. ${m.title}  (${m.climate})`, { fontFamily: 'monospace', fontSize: '18px', color: '#e8d27a', padding: { x: 8, y: 4 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', () => this.select(k));
      t.on('pointerdown', () => this.go(k));
      return t;
    });
    this.add
      .text(cx, top + 170 + MISSIONS.length * 34, 'Up/Down or 1-9 to pick · Enter or click to drop in · F: test field', { fontFamily: 'monospace', fontSize: '14px', color: '#9aa88a' })
      .setOrigin(0.5);
    this.select(0);
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') this.select((this.pick + MISSIONS.length - 1) % MISSIONS.length);
      else if (e.key === 'ArrowDown' || e.key === 's') this.select((this.pick + 1) % MISSIONS.length);
      else if (e.key === 'Enter' || e.key === ' ') this.go(this.pick);
      else if (e.key === 'f' || e.key === 'F') this.scene.start('field');
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= MISSIONS.length) this.go(Number(e.key) - 1);
    });
  }

  private select(k: number) {
    this.pick = k;
    this.rows.forEach((t, i) => t.setColor(i === k ? '#10140c' : '#e8d27a').setBackgroundColor(i === k ? '#e8d27a' : '#00000000'));
  }

  private go(k: number) {
    this.scene.start('mission', { mission: MISSIONS[k].map });
  }
}
