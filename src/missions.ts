/** The missions on the select screen. Each is a generator map (ssg.assets.json `maps`) plus its briefing texts. */
export interface MissionConfig {
  /** The map's name in the manifest (and in the generator project). */
  map: string;
  number: number;
  title: string;
  climate: 'temperate' | 'desert' | 'arctic' | 'jungle';
  /** Played at dusk: the scene is darkened (FB-060: sprites have no light/tint setting in the generator). */
  dusk?: boolean;
  /** HUD goal while the targets stand ("destroy the …"). */
  goal: string;
  /** HUD line once every target is down. */
  done: string;
  /** End screen line on success. */
  success: string;
  /**
   * The clock. G6 maps are 128×256 m: the shortest walkable route (scripts/route-check.mjs) is 370–480 m, 2:10–2:50
   * at a flat-out run, 5–6:30 walking; with the objective, pods, stealth and fights a mission takes about 6–10 minutes.
   */
  seconds: number;
  /** G8: the objective kind (src/objectives); absent = destroy every target. */
  objective?: string;
}

export const MISSIONS: MissionConfig[] = [
  {
    map: 'mission1',
    number: 1,
    title: 'DESTROY A MUNITIONS DEPOT',
    climate: 'temperate',
    goal: 'destroy the munitions depot',
    done: 'DEPOT DESTROYED: get to the extraction zone',
    success: 'Munitions depot destroyed. The Ranger made the pickup.',
    seconds: 10 * 60,
  },
  {
    map: 'mission2',
    number: 2,
    title: 'KNOCK OUT ENEMY RADAR ARRAY',
    climate: 'desert',
    goal: 'knock out the radar array',
    done: 'RADAR ARRAY DOWN: get to the extraction zone',
    success: 'The radar array is down. The Ranger made the pickup.',
    seconds: 10 * 60,
  },
  {
    map: 'mission3',
    number: 3,
    title: 'DISABLE ENEMY AIRCRAFT',
    climate: 'arctic',
    goal: 'destroy the aircraft on the airfield',
    done: 'AIRCRAFT DESTROYED: get to the extraction zone',
    success: 'The enemy aircraft are burning. The Ranger made the pickup.',
    seconds: 11 * 60,
  },
  {
    map: 'mission4',
    number: 4,
    title: 'CUT A PIPELINE',
    climate: 'jungle',
    dusk: true,
    goal: 'blow the pipeline valves',
    done: 'PIPELINE CUT: get to the extraction zone',
    success: 'The pipeline is cut and burning. The Ranger made the pickup at dusk.',
    seconds: 12 * 60,
  },
  // G8 (lane g8b): missions 9-12 with their own objectives (src/objectives/g8b.ts). g8a adds 5-8.
  {
    map: 'mission9',
    number: 9,
    title: 'PHOTOGRAPH AN EXPERIMENTAL AIRCRAFT',
    climate: 'arctic',
    objective: 'photo',
    goal: 'photograph the prototype at the hangar',
    done: 'PHOTOGRAPHS TAKEN: get to the extraction zone',
    success: 'The prototype is on film. The Ranger made the pickup.',
    seconds: 11 * 60,
  },
  {
    map: 'mission10',
    number: 10,
    title: 'FREE THE HOSTAGES',
    climate: 'desert',
    objective: 'hostages',
    goal: 'blow open the stockade gate',
    done: 'HOSTAGES WITH YOU: extraction',
    success: 'The hostages are free. The Ranger brought them out.',
    seconds: 12 * 60,
  },
  {
    map: 'mission11',
    number: 11,
    title: 'CREATE A DIVERSION',
    climate: 'temperate',
    objective: 'diversion',
    goal: 'reach the garrison, hold fire until the buzzer',
    done: 'THE PLANE IS DOWN: get to the border zone',
    success: 'The garrison is in uproar. The Ranger slipped over the border.',
    seconds: 12 * 60,
  },
  {
    map: 'mission12',
    number: 12,
    title: 'DELAYED SABOTAGE',
    climate: 'jungle',
    dusk: true,
    objective: 'sabotage',
    goal: 'plant time bombs on the fuel dump unseen',
    done: 'CHARGES SET: get clear and out before they blow',
    success: 'The charges are ticking in the fuel dump. The Ranger made the pickup unseen.',
    seconds: 12 * 60,
  },
];

/** A mission by map name (or number), defaulting to the first. */
export function missionByKey(key: string | number | null | undefined): MissionConfig {
  return MISSIONS.find((m) => m.map === key || String(m.number) === String(key)) ?? MISSIONS[0];
}
