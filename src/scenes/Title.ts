import Phaser from 'phaser';

export class Title extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create() {
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2 - 20, 'AIRBORNE RANGER', { fontFamily: 'monospace', fontSize: '40px', color: '#e8d27a' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 30, 'built with Synty Sprite Generator', { fontFamily: 'monospace', fontSize: '16px', color: '#9aa88a' }).setOrigin(0.5);
  }
}
