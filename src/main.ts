import Phaser from 'phaser';
import { Title } from './scenes/Title';
import { Field } from './scenes/Field';
import { Mission } from './scenes/Mission';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: document.body,
  backgroundColor: '#10140c',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  pixelArt: true,
  scene: [Title, Mission, Field],
});

// Exposed for scripts/load-check.mjs.
(window as unknown as { game: Phaser.Game }).game = game;
