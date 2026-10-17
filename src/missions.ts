/** The missions on the select screen. Each is a generator map (ssg.assets.json `maps`) plus its briefing texts. */
export interface MissionConfig {
  /** The map's name in the manifest (and in the generator project). */
  map: string;
  number: number;
  title: string;
  climate: 'temperate' | 'desert' | 'arctic';
  /** HUD goal while the targets stand ("destroy the …"). */
  goal: string;
  /** HUD line once every target is down. */
  done: string;
  /** End screen line on success. */
  success: string;
  seconds: number;
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
    seconds: 12 * 60,
  },
  {
    map: 'mission2',
    number: 2,
    title: 'KNOCK OUT ENEMY RADAR ARRAY',
    climate: 'desert',
    goal: 'knock out the radar array',
    done: 'RADAR ARRAY DOWN: get to the extraction zone',
    success: 'The radar array is down. The Ranger made the pickup.',
    seconds: 12 * 60,
  },
  {
    map: 'mission3',
    number: 3,
    title: 'DISABLE ENEMY AIRCRAFT',
    climate: 'arctic',
    goal: 'destroy the aircraft on the airfield',
    done: 'AIRCRAFT DESTROYED: get to the extraction zone',
    success: 'The enemy aircraft are burning. The Ranger made the pickup.',
    seconds: 12 * 60,
  },
];

/** A mission by map name (or number), defaulting to the first. */
export function missionByKey(key: string | number | null | undefined): MissionConfig {
  return MISSIONS.find((m) => m.map === key || String(m.number) === String(key)) ?? MISSIONS[0];
}
