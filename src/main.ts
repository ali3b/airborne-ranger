import Phaser from 'phaser';
import { Title } from './scenes/Title';
import { MissionSelect } from './scenes/MissionSelect';
import { Field } from './scenes/Field';
import { Mission } from './scenes/Mission';
import { Loadout } from './scenes/Loadout';
import { Debrief } from './scenes/Debrief';
import { installMuteControls, audioState } from './sound';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: document.body,
  backgroundColor: '#10140c',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  pixelArt: true,
  // Sound is procedural WebAudio (src/sound.ts); Phaser's own sound manager isn't used.
  audio: { noAudio: true },
  scene: [Title, MissionSelect, Loadout, Mission, Field, Debrief],
});
installMuteControls();

// Exposed for scripts/load-check.mjs and scripts/demo-record.mjs.
(window as unknown as { game: Phaser.Game; audioState: typeof audioState }).game = game;
(window as unknown as { audioState: typeof audioState }).audioState = audioState;
