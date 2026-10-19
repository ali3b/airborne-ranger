import Phaser from 'phaser';
import { MISSIONS } from '../missions';
import { loadRoster, saveRoster, selected, RANKS, RANK_NAMES, type Ranger } from '../roster';
import { cycleDifficulty, mods } from '../difficulty'; // G9
import { campaignLabel, leaveCampaign, startCampaign } from '../campaign'; // G9
import { sfx } from '../sound';
import { fitMenu, isTouch } from '../touch';

const FONT = { fontFamily: 'monospace' };
const GOLD = '#e8d27a';
const DIM = '#9aa88a';

/** Mission select for the chosen Ranger: Up/Down (or 1–9) picks, Enter or a click drops in, Esc back to the roster. */
export class MissionSelect extends Phaser.Scene {
  private pick = 0;
  /** One text per mission (scripts/load-check.mjs reads them). */
  rows: Phaser.GameObjects.Text[] = [];
  ranger: Ranger | null = null;
  /** G9: the DIFFICULTY and CAMPAIGN buttons (top right; D and C). */
  difficultyBtn?: Phaser.GameObjects.Text;
  campaignBtn?: Phaser.GameObjects.Text;

  constructor() {
    super('missions');
  }

  create() {
    this.ranger = loadRoster().find((r) => r !== null && r.id === selected.get()) ?? null;
    if (!this.ranger || this.ranger.status !== 'active') {
      this.scene.start('title');
      return;
    }
    const r = this.ranger;
    const { width, height } = fitMenu(this, 580, 520);
    const cx = width / 2;
    const top = Math.max(30, height / 2 - 200);
    this.add.text(cx, top, 'AIRBORNE RANGER', { ...FONT, fontSize: '36px', color: GOLD }).setOrigin(0.5);
    this.add
      .text(cx, top + 52, `${RANK_NAMES[r.rank].toUpperCase()} ${r.name}  ·  ${r.score} pts  ·  ${r.missions} missions`, { ...FONT, fontSize: '17px', color: '#c8c8a0' })
      .setOrigin(0.5);
    this.add.text(cx, top + 105, 'SELECT MISSION', { ...FONT, fontSize: '20px', color: '#c8c8a0' }).setOrigin(0.5);
    this.rows = MISSIONS.map((m, k) => {
      const done = r.accomplished?.includes(m.number) ? '  [done]' : '';
      const t = this.add
        .text(cx, top + 150 + k * 38, `${m.number}. ${m.title}  (${m.climate})${done}`, { ...FONT, fontSize: '18px', color: GOLD, padding: { x: 10, y: 5 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', (p: Phaser.Input.Pointer) => !p.wasTouch && this.select(k));
      t.on('pointerup', () => this.go(k));
      return t;
    });
    this.add
      .text(cx, top + 175 + MISSIONS.length * 38, isTouch ? 'tap a mission, then pack the supply pods' : `Up/Down or 1-${MISSIONS.length} to pick · Enter or click: supply pods · D difficulty · C campaign · Esc: roster · M: sound`, { ...FONT, fontSize: '14px', color: DIM })
      .setOrigin(0.5);
    this.add
      .text(20, 20, '< ROSTER', { ...FONT, fontSize: '18px', color: GOLD, padding: { x: 10, y: 8 }, backgroundColor: '#1a2014' })
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.scene.start('title'));
    this.add.text(cx, top + 200 + MISSIONS.length * 38, `rank ${RANKS[r.rank]}`, { ...FONT, fontSize: '12px', color: DIM }).setOrigin(0.5);
    this.g9Buttons(width);
    this.pick = 0;
    this.select(0);
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') this.select((this.pick + MISSIONS.length - 1) % MISSIONS.length);
      else if (e.key === 'ArrowDown' || e.key === 's') this.select((this.pick + 1) % MISSIONS.length);
      else if (e.key === 'Enter' || e.key === ' ') this.go(this.pick);
      else if (e.key === 'Escape') this.scene.start('title');
      else if (e.key === 'd' || e.key === 'D') this.toggleDifficulty(); // G9
      else if (e.key === 'c' || e.key === 'C') this.campaign(); // G9
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= MISSIONS.length) this.go(Number(e.key) - 1);
    });
  }

  select(k: number) {
    if (k !== this.pick) sfx.click();
    this.pick = k;
    this.rows.forEach((t, i) => t.setColor(i === k ? '#10140c' : GOLD).setBackgroundColor(i === k ? GOLD : '#00000000'));
  }

  /** G9: difficulty (Easy / Normal / Hard) and the campaign, as two buttons in the top right. */
  private g9Buttons(width: number) {
    const style = { ...FONT, fontSize: '16px', color: GOLD, padding: { x: 10, y: 8 }, backgroundColor: '#1a2014' };
    // On touch screens the sound / full-screen buttons hold the top right corner: go below them.
    const y0 = isTouch ? 76 : 20;
    this.difficultyBtn = this.add.text(width - 20, y0, '', style).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.difficultyBtn.on('pointerup', () => this.toggleDifficulty());
    this.campaignBtn = this.add.text(width - 20, y0 + 42, '', style).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.campaignBtn.on('pointerup', () => this.campaign());
    this.showG9();
  }

  private showG9() {
    this.difficultyBtn?.setText(`DIFFICULTY: ${mods().label}${isTouch ? '' : ' (D)'}`);
    this.campaignBtn?.setText(`${campaignLabel(this.ranger?.campaign)}${isTouch ? '' : ' (C)'}`);
  }

  toggleDifficulty() {
    cycleDifficulty();
    sfx.click();
    this.showG9();
  }

  /** G9: fly the campaign's next mission (a new campaign starts at mission 1). */
  campaign() {
    if (!this.ranger) return;
    const roster = loadRoster();
    const r = roster.find((x) => x?.id === this.ranger!.id);
    if (!r) return;
    const m = startCampaign(r);
    saveRoster(roster);
    sfx.confirm();
    this.scene.start('loadout', { mission: m.map, ranger: r.id });
  }

  go(k: number) {
    sfx.confirm();
    // G9: a mission picked from the list is flown outside the campaign.
    const roster = loadRoster();
    const r = roster.find((x) => x?.id === this.ranger?.id);
    if (r?.campaign?.playing) {
      leaveCampaign(r);
      saveRoster(roster);
    }
    // G7: pack the supply pods first.
    this.scene.start('loadout', { mission: MISSIONS[k].map, ranger: this.ranger?.id });
  }
}
