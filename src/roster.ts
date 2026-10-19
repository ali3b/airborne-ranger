/**
 * The persistent roster: six Ranger slots saved in localStorage, with name, rank, career score, medals and status.
 * The merit, promotion and medal rules are documented in docs/DESIGN.md ("Roster, merit, promotions and medals").
 */

export const RANKS = ['PFC', 'CPL', 'SGT', 'SSG', 'SFC', 'MSG', '2LT', '1LT', 'CPT', 'MAJ', 'LTC', 'COL'] as const;
export const RANK_NAMES = [
  'Private First Class',
  'Corporal',
  'Sergeant',
  'Staff Sergeant',
  'Sergeant First Class',
  'Master Sergeant',
  'Second Lieutenant',
  'First Lieutenant',
  'Captain',
  'Major',
  'Lieutenant Colonel',
  'Colonel',
];
/** Career merit needed for each rank (index = rank). */
export const RANK_POINTS = [0, 400, 900, 1500, 2200, 3000, 3900, 4900, 6000, 7200, 8500, 10000];
/** At most this many ranks per mission, however big the score. */
export const MAX_PROMOTIONS_PER_MISSION = 2;

export const MEDALS = ['COM1', 'COM2', 'BSM', 'SSM', 'DSC', 'CMH'] as const;
export type Medal = (typeof MEDALS)[number];
export const MEDAL_NAMES: Record<Medal, string> = {
  COM1: 'Army Commendation Medal',
  COM2: 'Army Commendation Medal, Oak Leaf Cluster',
  BSM: 'Bronze Star',
  SSM: 'Silver Star',
  DSC: 'Distinguished Service Cross',
  CMH: 'Medal of Honor',
};
/** Mission merit needed for each medal (one medal per mission: the highest one earned). */
export const MEDAL_POINTS: Record<Medal, number> = { COM1: 800, COM2: 950, BSM: 1100, SSM: 1250, DSC: 1400, CMH: 1550 };

export const MERIT = {
  /** The objective destroyed: × the mission's difficulty (mission 1: 1.0, 2: 1.2, 3: 1.4, 4: 1.6). */
  objective: 500,
  /** Reaching the extraction zone with the objective done. */
  extraction: 200,
  /** Each enemy soldier killed. */
  kill: 25,
  /** Each installation destroyed (objective targets and any other destructible object). */
  installation: 50,
  /** Time bonus on extraction: this × the fraction of the mission clock left. */
  time: 300,
  /** The enemy alerted before the objective was done. */
  earlyAlert: -150,
  /** …and once more if that alert came in the first two minutes. */
  veryEarlyAlert: -100,
};

export type Status = 'active' | 'KIA' | 'captured';

export interface Ranger {
  id: string;
  name: string;
  rank: number;
  score: number;
  medals: Partial<Record<Medal, number>>;
  status: Status;
  missions: number;
  /** Mission numbers accomplished (repeats allowed). */
  accomplished: number[];
}

/** What a mission hands to the debriefing. */
export interface MissionResult {
  mission: number;
  title: string;
  outcome: 'accomplished' | 'failed' | 'kia';
  objectiveDone: boolean;
  kills: number;
  enemies: number;
  installations: number;
  targets: number;
  secondsLeft: number;
  seconds: number;
  /** Mission seconds at the first alert, or null when the enemy never noticed. */
  alertAt: number | null;
  /** Mission seconds when the objective was done, or null. */
  objectiveAt: number | null;
  /** G8: why it failed when it wasn't the clock (the Ranger is recalled, not captured). */
  reason?: string;
  /** G8: the objective's own numbers (prisoners rescued…). */
  stats?: Record<string, string | number>;
}

export interface MeritLine {
  label: string;
  points: number;
}

export interface Award {
  ranger: Ranger;
  before: { rank: number; score: number; status: Status };
  lines: MeritLine[];
  points: number;
  medal: Medal | null;
  promotedTo: number | null;
  posthumous: boolean;
  status: Status;
  /** True when the Ranger is a guest (no roster slot: a mission entered with ?scene=mission). */
  guest: boolean;
}

const KEY = 'ar.roster.v1';
export const SLOTS = 6;

/** The roster: SLOTS entries, null = a vacant slot. */
export function loadRoster(): (Ranger | null)[] {
  let list: (Ranger | null)[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) list = JSON.parse(raw);
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  return Array.from({ length: SLOTS }, (_, k) => (list[k] && typeof list[k] === 'object' ? (list[k] as Ranger) : null));
}

export function saveRoster(r: (Ranger | null)[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r.slice(0, SLOTS)));
  } catch {
    /* storage blocked: the roster lives for this page only */
  }
}

export function newRanger(name: string): Ranger {
  return { id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name: name.trim().toUpperCase().slice(0, 16) || 'RANGER', rank: 0, score: 0, medals: {}, status: 'active', missions: 0, accomplished: [] };
}

/** A guest for a mission entered without the roster (load checks, ?scene=mission links). Never saved. */
export function guestRanger(): Ranger {
  return { ...newRanger('GUEST'), id: 'guest' };
}

const NAMES = ['MILLER', 'DARBY', 'HARRIS', 'RUDDER', 'KOWALSKI', 'SANTOS', 'OKAFOR', 'BRENNAN', 'WALSH', 'NAKAMURA', 'ROSSI', 'LINDQVIST', 'GARCIA', 'MURPHY', 'COLE', 'BAKER'];
export function randomName(taken: string[]) {
  const free = NAMES.filter((n) => !taken.includes(n));
  return (free.length ? free : NAMES)[Math.floor(Math.random() * (free.length || NAMES.length))];
}

export function rankFor(score: number) {
  let r = 0;
  for (let k = 0; k < RANK_POINTS.length; k++) if (score >= RANK_POINTS[k]) r = k;
  return r;
}

export function medalCount(r: Ranger) {
  return MEDALS.reduce((s, m) => s + (r.medals[m] ?? 0), 0);
}

/** The merit lines of one mission (see docs/DESIGN.md). */
export function merit(res: MissionResult): MeritLine[] {
  const lines: MeritLine[] = [];
  const difficulty = 1 + (res.mission - 1) * 0.2;
  if (res.objectiveDone) lines.push({ label: `Objective (difficulty ×${difficulty.toFixed(1)})`, points: Math.round(MERIT.objective * difficulty) });
  if (res.outcome === 'accomplished') lines.push({ label: 'Extraction', points: MERIT.extraction });
  if (res.kills) lines.push({ label: `Enemy troops ${res.kills} × ${MERIT.kill}`, points: res.kills * MERIT.kill });
  if (res.installations) lines.push({ label: `Installations ${res.installations} × ${MERIT.installation}`, points: res.installations * MERIT.installation });
  if (res.outcome === 'accomplished') {
    const left = Math.max(0, res.secondsLeft) / res.seconds;
    lines.push({ label: `Time ${Math.round(left * 100)} % of the clock left`, points: Math.round(MERIT.time * left) });
  }
  const early = res.alertAt !== null && (res.objectiveAt === null || res.alertAt < res.objectiveAt);
  if (early) {
    lines.push({ label: 'Early alert (before the objective)', points: MERIT.earlyAlert });
    if (res.alertAt! < 120) lines.push({ label: 'Alert in the first two minutes', points: MERIT.veryEarlyAlert });
  }
  return lines;
}

/** The highest medal a mission earns (only an accomplished mission earns one; the CMH also needs no alert at all). */
export function medalFor(res: MissionResult, points: number): Medal | null {
  if (res.outcome !== 'accomplished') return null;
  let best: Medal | null = null;
  for (const m of MEDALS) {
    if (points < MEDAL_POINTS[m]) continue;
    if (m === 'CMH' && res.alertAt !== null) continue;
    best = m;
  }
  return best;
}

/**
 * Apply a mission to a Ranger: merit, medal, promotion and status. Mission merit never goes below 0. A KIA gets a
 * posthumous promotion of one rank (on top of what the score earned); a Ranger left behind when the plane leaves is
 * captured. Saves the roster unless the Ranger is a guest.
 */
export function award(rangerId: string | null, res: MissionResult): Award {
  const roster = loadRoster();
  const slot = rangerId ? roster.findIndex((r) => r?.id === rangerId) : -1;
  const guest = slot < 0;
  const r: Ranger = guest ? guestRanger() : { ...roster[slot]!, medals: { ...roster[slot]!.medals }, accomplished: [...(roster[slot]!.accomplished ?? [])] };
  const before = { rank: r.rank, score: r.score, status: r.status };
  const lines = merit(res);
  const points = Math.max(0, lines.reduce((s, l) => s + l.points, 0));
  const medal = medalFor(res, points);
  r.score += points;
  r.missions += 1;
  if (medal) r.medals[medal] = (r.medals[medal] ?? 0) + 1;
  if (res.outcome === 'accomplished') r.accomplished.push(res.mission);
  let rank = Math.min(rankFor(r.score), r.rank + MAX_PROMOTIONS_PER_MISSION);
  rank = Math.max(rank, r.rank);
  const posthumous = res.outcome === 'kia';
  if (posthumous) rank = Math.min(RANKS.length - 1, rank + 1);
  const promotedTo = rank > r.rank ? rank : null;
  r.rank = rank;
  r.status = res.outcome === 'kia' ? 'KIA' : res.outcome === 'failed' && !res.reason ? 'captured' : 'active';
  if (!guest) {
    roster[slot] = r;
    saveRoster(roster);
  }
  return { ranger: r, before, lines, points, medal, promotedTo, posthumous, status: r.status, guest };
}

/** The Ranger picked on the select screen (kept for the session). */
let current: string | null = null;
export const selected = {
  get: () => current,
  set: (id: string | null) => {
    current = id;
  },
};
