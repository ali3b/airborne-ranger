/**
 * The supply pod loadout (G7): carbine magazines, hand grenades, first-aid
 * kits, LAW rockets and time bombs, limited by weight and a 21-item capacity per pod. The three pods dropped with the
 * Ranger each carry the chosen loadout; the Ranger himself starts with a basic carry.
 */
import { readKey } from './storage';

export type ItemKey = 'mag' | 'grenade' | 'medkit' | 'law' | 'bomb';
export type Loadout = Record<ItemKey, number>;

export interface ItemDef {
  key: ItemKey;
  /** Name on the loadout screen. */
  name: string;
  /** Short HUD label. */
  short: string;
  /** Weight units per item (the pod holds POD_MAX_WEIGHT). */
  weight: number;
  /** The generator sprite drawn as its icon (ssg.assets.json `item_*`). */
  icon: string;
}

export const ITEMS: ItemDef[] = [
  { key: 'mag', name: 'CARBINE MAG', short: 'MAG', weight: 1, icon: 'item_mag' },
  { key: 'grenade', name: 'HAND GRENADE', short: 'GREN', weight: 1, icon: 'item_grenade' },
  { key: 'medkit', name: 'FIRST-AID KIT', short: 'AID', weight: 2, icon: 'item_medkit' },
  { key: 'law', name: 'LAW ROCKET', short: 'LAW', weight: 5, icon: 'item_law' },
  { key: 'bomb', name: 'TIME BOMB', short: 'BOMB', weight: 4, icon: 'item_bomb' },
];

/** Items per pod (21). */
export const POD_CAPACITY = 21;
/** Weight per pod. */
export const POD_MAX_WEIGHT = 45;
/** Pods dropped with the Ranger. */
export const POD_COUNT = 3;
/** Rounds in one carbine magazine. */
export const MAG_SIZE = 30;

/** STANDARD: a balanced pod (21 items, weight 45). */
export const STANDARD: Loadout = { mag: 6, grenade: 6, medkit: 3, law: 3, bomb: 3 };
export const EMPTY: Loadout = { mag: 0, grenade: 0, medkit: 0, law: 0, bomb: 0 };
/** What the Ranger jumps with (a magazine in the carbine plus these). */
export const BASIC_CARRY: Loadout = { mag: 3, grenade: 3, medkit: 1, law: 1, bomb: 1 };

export const count = (l: Loadout) => ITEMS.reduce((s, it) => s + l[it.key], 0);
export const weight = (l: Loadout) => ITEMS.reduce((s, it) => s + l[it.key] * it.weight, 0);

/** Can one more of this item go into the pod? */
export function canAdd(l: Loadout, key: ItemKey) {
  const it = ITEMS.find((x) => x.key === key)!;
  return count(l) < POD_CAPACITY && weight(l) + it.weight <= POD_MAX_WEIGHT;
}

/** A valid loadout from anything (a saved one, scene data): unknown keys dropped, trimmed to the limits. */
export function sanitize(x: unknown): Loadout {
  const l: Loadout = { ...EMPTY };
  const src = (x && typeof x === 'object' ? x : STANDARD) as Partial<Loadout>;
  for (const it of ITEMS) {
    const want = Math.max(0, Math.floor(Number(src[it.key] ?? 0)) || 0);
    for (let k = 0; k < want && canAdd(l, it.key); k++) l[it.key]++;
  }
  return l;
}

const KEY = 'ss.loadout.v1';
/** The last loadout chosen (this browser), STANDARD when none. */
export function loadLoadout(): Loadout {
  try {
    const s = readKey(KEY);
    if (s) return sanitize(JSON.parse(s));
  } catch {
    /* storage blocked */
  }
  return { ...STANDARD };
}
export function saveLoadout(l: Loadout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* storage blocked */
  }
}
