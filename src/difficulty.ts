/**
 * G9: difficulty. Easy / Normal / Hard change how many soldiers a map fields, how well and how fast they shoot and
 * notice the Ranger, how much the supply pods carry, how many reinforcements an alarm brings and how long the plane
 * takes to come. Picked on the mission select screen (D, or the DIFFICULTY button), saved in this browser.
 * The merit of a mission is scaled by `merit` (a line on the debriefing).
 */
import { readKey } from './storage';
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

export interface DifficultyMods {
  label: string;
  /** Soldiers on a map (patrols and guards): Easy drops some, Hard adds some (a fraction of the map's own). */
  enemies: number;
  /** Enemy hit chance (rifles, machine guns, tank shells' aim). */
  accuracy: number;
  /** Reaction time from noticing to the first shot, and the pause between bursts. */
  reaction: number;
  /** Enemy sight range. */
  sight: number;
  /** What each supply pod carries (the packed loadout, rounded; never below one of an item that was packed). */
  pods: number;
  /** Soldiers an alarm sends toward the Ranger's last known position. */
  reinforcements: number;
  /** Seconds from calling the plane until it reaches the extraction zone. */
  pickupWait: number;
  /** Mission merit multiplier. */
  merit: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyMods> = {
  easy: { label: 'EASY', enemies: 0.7, accuracy: 0.6, reaction: 1.5, sight: 0.85, pods: 1.5, reinforcements: 2, pickupWait: 15, merit: 0.75 },
  normal: { label: 'NORMAL', enemies: 1, accuracy: 1, reaction: 1, sight: 1, pods: 1, reinforcements: 3, pickupWait: 20, merit: 1 },
  hard: { label: 'HARD', enemies: 1.35, accuracy: 1.3, reaction: 0.7, sight: 1.15, pods: 0.6, reinforcements: 5, pickupWait: 25, merit: 1.3 },
};

const KEY = 'ss.difficulty.v1';

export function getDifficulty(): Difficulty {
  // ?difficulty= wins (load checks, links), then the saved choice.
  const q = new URLSearchParams(window.location.search).get('difficulty');
  if (q && (DIFFICULTIES as string[]).includes(q)) return q as Difficulty;
  try {
    const v = readKey(KEY);
    if (v && (DIFFICULTIES as string[]).includes(v)) return v as Difficulty;
  } catch {
    /* storage blocked */
  }
  return 'normal';
}

export function setDifficulty(d: Difficulty) {
  try {
    localStorage.setItem(KEY, d);
  } catch {
    /* storage blocked: this page only */
  }
}

/** The next level (the menu button cycles Easy → Normal → Hard). */
export function cycleDifficulty(): Difficulty {
  const d = DIFFICULTIES[(DIFFICULTIES.indexOf(getDifficulty()) + 1) % DIFFICULTIES.length];
  setDifficulty(d);
  return d;
}

export const mods = (d: Difficulty = getDifficulty()) => DIFFICULTY[d];
