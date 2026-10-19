// src/objectives/index.ts
import type { Escortee } from '../enemies/escort';
import type { MissionConfig } from '../missions';
import type { Mission } from '../scenes/Mission';

/** A mission's goal beyond "destroy every target" (G8). Kinds register themselves; MissionConfig.objective picks one. */
export interface Objective {
  /** After the map is built: spawn people, items, markers. */
  start(m: Mission): void;
  /** Each frame: 'done' once accomplished, { failed } when it can no longer be. */
  update(m: Mission, dt: number): 'pending' | 'done' | { failed: string };
  /** HUD goal line while pending. */
  hud(m: Mission): string;
  /** Where the compass/overview should point (cell coords), or null for the objective zone. */
  marker?(m: Mission): { x: number; y: number } | null;
  /** Extra debrief stats (label → value). */
  stats?(m: Mission): Record<string, string | number>;
  /** G10: the people the enemy may shoot at now (the escorted officer, freed prisoners or hostages). */
  exposed?(m: Mission): Escortee[];
}

const KINDS: Record<string, (cfg: MissionConfig) => Objective> = {};
export function registerObjective(kind: string, make: (cfg: MissionConfig) => Objective) {
  KINDS[kind] = make;
}
export function makeObjective(cfg: MissionConfig): Objective | null {
  return cfg.objective ? (KINDS[cfg.objective]?.(cfg) ?? null) : null;
}
