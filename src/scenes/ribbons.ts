import Phaser from 'phaser';
import type { Medal } from '../roster';

/**
 * Service ribbons drawn as stripes (no art needed): each medal's ribbon colours, left to right, as fractions of the
 * width. Simplified from the real ribbons.
 */
const RIBBONS: Record<Medal, [number, number][]> = {
  COM1: [[0x1d5a2e, 0.15], [0xffffff, 0.08], [0x1d5a2e, 0.54], [0xffffff, 0.08], [0x1d5a2e, 0.15]],
  COM2: [[0x1d5a2e, 0.15], [0xffffff, 0.08], [0x1d5a2e, 0.2], [0xc8a040, 0.14], [0x1d5a2e, 0.2], [0xffffff, 0.08], [0x1d5a2e, 0.15]],
  BSM: [[0x8b1a1a, 0.42], [0xffffff, 0.04], [0x1c3f8a, 0.08], [0xffffff, 0.04], [0x8b1a1a, 0.42]],
  SSM: [[0x1c3f8a, 0.15], [0xffffff, 0.12], [0x1c3f8a, 0.1], [0xffffff, 0.06], [0xb02020, 0.14], [0xffffff, 0.06], [0x1c3f8a, 0.1], [0xffffff, 0.12], [0x1c3f8a, 0.15]],
  DSC: [[0xb02020, 0.12], [0xffffff, 0.06], [0x1c3f8a, 0.64], [0xffffff, 0.06], [0xb02020, 0.12]],
  CMH: [[0x5fa8e0, 1]],
};

/** Draw a ribbon with its top-left at (x, y). The CMH gets white stars. */
export function drawRibbon(g: Phaser.GameObjects.Graphics, m: Medal, x: number, y: number, w: number, h: number) {
  let at = x;
  for (const [c, f] of RIBBONS[m]) {
    g.fillStyle(c, 1).fillRect(at, y, w * f + 0.5, h);
    at += w * f;
  }
  if (m === 'CMH') {
    g.fillStyle(0xffffff, 1);
    for (let k = 0; k < 5; k++) g.fillCircle(x + (w * (k + 0.5)) / 5, y + h / 2, Math.max(1, h / 7));
  }
  g.lineStyle(1, 0x000000, 0.6).strokeRect(x, y, w, h);
}
