import Phaser from 'phaser';
import { getDifficulty, type Difficulty } from '../difficulty';

/**
 * G15: the people the Ranger leads out (mission 6's officer, mission 8's prisoners, mission 10's hostages) are hard to
 * kill by enemy fire ("make it a bit hard to kill the officer"): an enemy round wounds, it doesn't kill.
 * - ESCORT_HP hits to die (by difficulty);
 * - after a hit, GRACE seconds in which further rounds are stopped but do nothing (a machine-gun burst, or two
 *   soldiers firing together, costs one hit), shown by a red flash and a blink;
 * - once hurt, a row of pips over him shows the hits he has left.
 * The Ranger's own bullets and blasts still kill outright (Bystander.hit / the objectives' blast checks).
 */
export const ESCORT_HP: Record<Difficulty, number> = { easy: 5, normal: 4, hard: 3 };
export const GRACE = 1.5; // seconds
const PIP_W = 6;
const PIP_H = 4;
const PIP_GAP = 2;
const PIP_Y = 86; // px over the feet

interface Wound {
  hp: number;
  max: number;
  /** Scene time (s) until which further hits do nothing. */
  until: number;
  alive: () => boolean;
  pips?: Phaser.GameObjects.Graphics;
  blink: boolean;
}

const wounds = new Map<Phaser.GameObjects.Sprite, Wound>();
/** This mission's count: rounds that wounded, rounds stopped in a grace, rounds that killed (load-check reads it). */
export const woundStats = { wounds: 0, graced: 0, kills: 0 };
function hpFor() {
  return ESCORT_HP[getDifficulty()] ?? ESCORT_HP.normal;
}

/** Hits left (and the maximum) for an escorted sprite; full if never hit. */
export function woundsOf(s: Phaser.GameObjects.Sprite) {
  const w = wounds.get(s);
  const max = w?.max ?? hpFor();
  return { hp: w?.hp ?? max, max, grace: !!w && s.scene ? s.scene.time.now / 1000 < w.until : false };
}

/**
 * An enemy round reached `s`. Returns true if it killed him (`die` was called); false if it only wounded him or came
 * inside the grace after the last hit. Either way the caller stops the bullet.
 */
export function woundEscort(s: Phaser.GameObjects.Sprite, alive: () => boolean, die: () => void): boolean {
  if (!s.scene || !alive()) return false;
  const now = s.scene.time.now / 1000;
  let w = wounds.get(s);
  if (!w) {
    const max = hpFor();
    w = { hp: max, max, until: 0, alive, blink: false };
    wounds.set(s, w);
  }
  if (now < w.until) {
    woundStats.graced++;
    return false;
  }
  w.hp--;
  if (w.hp <= 0) {
    woundStats.kills++;
    drop(s, w);
    die();
    return true;
  }
  woundStats.wounds++;
  w.until = now + GRACE;
  w.blink = true;
  flash(s, alive);
  return false;
}

/** Each frame (EscortFire.update): pips follow their man, the grace blink, and the dead or gone are dropped. */
export function updateWounds() {
  for (const [s, w] of wounds) {
    if (!s.scene || !s.active || !w.alive()) {
      drop(s, w);
      continue;
    }
    const now = s.scene.time.now / 1000;
    if (w.blink) {
      if (now < w.until) s.setAlpha(Math.floor(now * 12) % 2 ? 0.45 : 1);
      else {
        s.setAlpha(1);
        w.blink = false;
      }
    }
    const g = (w.pips ??= s.scene.add.graphics().setDepth(9e8 + 5));
    g.clear();
    const width = w.max * PIP_W + (w.max - 1) * PIP_GAP;
    const x0 = s.x - width / 2;
    const y0 = s.y - PIP_Y;
    g.fillStyle(0x10140c, 0.75).fillRect(x0 - 2, y0 - 2, width + 4, PIP_H + 4);
    for (let k = 0; k < w.max; k++) {
      g.fillStyle(k < w.hp ? (w.hp === 1 ? 0xe04030 : 0x7ad060) : 0x4a3a30, 1).fillRect(x0 + k * (PIP_W + PIP_GAP), y0, PIP_W, PIP_H);
    }
  }
}

function drop(s: Phaser.GameObjects.Sprite, w: Wound) {
  w.pips?.destroy();
  if (w.blink && s.scene && w.alive()) s.setAlpha(1);
  wounds.delete(s);
}

/** A short red flash, then his own tint (or none) back. */
function flash(s: Phaser.GameObjects.Sprite, alive: () => boolean) {
  const prev = s.isTinted && !s.tintFill ? s.tintTopLeft : null;
  s.setTintFill(0xff4040);
  s.scene.time.delayedCall(110, () => {
    if (!s.scene || !alive()) return;
    if (prev !== null) s.setTint(prev);
    else s.clearTint();
  });
}

/** A new mission: forget every wound. */
export function resetWounds() {
  for (const [s, w] of wounds) drop(s, w);
  Object.assign(woundStats, { wounds: 0, graced: 0, kills: 0 });
}
