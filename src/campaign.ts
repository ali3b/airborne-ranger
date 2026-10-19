/**
 * G9: the campaign. One Ranger flies the missions in order (src/missions.ts `MISSIONS`), carrying his merit, rank and
 * medals from one to the next. The state lives on the Ranger's roster record (src/roster.ts, `ar.roster.v1`), so it is
 * saved with the roster: which mission is next, the merit earned in the campaign so far, and whether the mission being
 * flown is the campaign's (picking a single mission from the list flies it outside the campaign).
 *
 * Rules: an accomplished campaign mission moves the campaign on to the next one; the last one completes the campaign
 * (+CAMPAIGN_BONUS merit). A KIA or capture ends it (the Ranger can't fly again anyway). Starting the campaign again
 * after it ended or completed begins at mission 1, with the career kept.
 */
import { MISSIONS, type MissionConfig } from './missions';
import type { MeritLine, MissionResult, Ranger } from './roster';

export const CAMPAIGN_BONUS = 500;

export interface CampaignState {
  /** Index in MISSIONS of the next campaign mission. */
  next: number;
  /** Merit earned in this campaign (difficulty and bonus included). */
  merit: number;
  /** Missions accomplished in this campaign. */
  done: number;
  /** True while the Ranger is flying the campaign's mission (set when it's picked from the menu). */
  playing: boolean;
  /** 'active', 'complete' (every mission accomplished) or 'ended' (KIA / captured). */
  status: 'active' | 'complete' | 'ended';
}

export function freshCampaign(): CampaignState {
  return { next: 0, merit: 0, done: 0, playing: false, status: 'active' };
}

/** The campaign's next mission, or null when it's over. */
export function campaignMission(c: CampaignState | undefined): MissionConfig | null {
  if (!c || c.status !== 'active') return null;
  return MISSIONS[c.next] ?? null;
}

/** A one-line summary for the mission select. */
export function campaignLabel(c: CampaignState | undefined) {
  if (!c) return 'CAMPAIGN: start at mission 1';
  if (c.status === 'complete') return `CAMPAIGN COMPLETE (${c.merit} pts): start again`;
  if (c.status === 'ended') return 'CAMPAIGN ENDED: start again';
  const m = campaignMission(c);
  return m ? `CAMPAIGN: mission ${m.number} of ${MISSIONS.length} (${c.merit} pts)` : 'CAMPAIGN';
}

/**
 * Pick the campaign on the menu: a new or finished campaign starts over at mission 1; returns the mission to fly.
 * The caller saves the roster.
 */
export function startCampaign(r: Ranger): MissionConfig {
  if (!r.campaign || r.campaign.status !== 'active' || !MISSIONS[r.campaign.next]) r.campaign = freshCampaign();
  r.campaign.playing = true;
  return MISSIONS[r.campaign.next];
}

/** A single mission picked from the list: it's flown outside the campaign. */
export function leaveCampaign(r: Ranger) {
  if (r.campaign) r.campaign.playing = false;
}

/**
 * After a mission (called from roster.award): move the campaign on. Returns extra merit lines (the completion bonus)
 * and a note for the debriefing; changes `r.campaign` in place.
 */
export function campaignAfter(r: Ranger, res: MissionResult, points: number): { lines: MeritLine[]; note: string | null } {
  const c = r.campaign;
  if (!c?.playing || c.status !== 'active' || MISSIONS[c.next]?.number !== res.mission) return { lines: [], note: null };
  c.playing = false;
  if (res.outcome !== 'accomplished') {
    // KIA or captured: the Ranger can't fly again, so the campaign is over.
    c.merit += points;
    c.status = 'ended';
    return { lines: [], note: `The campaign ends after ${c.done} of ${MISSIONS.length} missions.` };
  }
  c.done += 1;
  c.next += 1;
  if (c.next >= MISSIONS.length) {
    c.status = 'complete';
    c.merit += points + CAMPAIGN_BONUS;
    return { lines: [{ label: 'Campaign complete', points: CAMPAIGN_BONUS }], note: `CAMPAIGN COMPLETE: ${c.done} missions, ${c.merit} pts.` };
  }
  c.merit += points;
  return { lines: [], note: `Campaign: next is mission ${MISSIONS[c.next].number}, ${MISSIONS[c.next].title} (${c.merit} pts so far).` };
}
