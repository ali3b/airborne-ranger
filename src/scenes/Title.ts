import Phaser from 'phaser';

export class Title extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create() {
    // ?scene=field skips the title (scripts/load-check.mjs uses it).
    const want = new URLSearchParams(window.location.search).get('scene');
    if (want && want !== 'title' && this.scene.get(want)) {
      this.scene.start(want);
      return;
    }
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2 - 20, 'AIRBORNE RANGER', { fontFamily: 'monospace', fontSize: '40px', color: '#e8d27a' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 30, 'built with Synty Sprite Generator', { fontFamily: 'monospace', fontSize: '16px', color: '#9aa88a' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 80, 'MISSION 1: DESTROY A MUNITIONS DEPOT', { fontFamily: 'monospace', fontSize: '16px', color: '#e8d27a' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 110, 'press any key or click to drop in  (F: test field)', { fontFamily: 'monospace', fontSize: '14px', color: '#c8c8a0' }).setOrigin(0.5);
    const go = (e?: KeyboardEvent) => this.scene.start(e?.key === 'f' || e?.key === 'F' ? 'field' : 'mission');
    this.input.keyboard?.once('keydown', go);
    this.input.once('pointerdown', () => go());
  }
}
