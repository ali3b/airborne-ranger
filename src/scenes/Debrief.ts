import Phaser from 'phaser';
import { RANKS, RANK_NAMES, MEDAL_NAMES, type Award, type MissionResult } from '../roster';
import { sfx } from '../sound';
import { drawRibbon } from './ribbons';
import { fitMenu, isTouch } from '../touch';

const FONT = { fontFamily: 'monospace' };
const GOLD = '#e8d27a';
const DIM = '#9aa88a';

/**
 * The debriefing after a mission: the outcome, each merit line (revealed one by one), the total, the medal and the
 * promotion (posthumous after a KIA). Enter: the mission select (an active Ranger) or the roster.
 */
export class Debrief extends Phaser.Scene {
  award!: Award;
  result!: MissionResult;
  /** True once every line is shown (scripts/load-check.mjs and the demo wait for it). */
  shown = false;

  constructor() {
    super('debrief');
  }

  init(data: { award: Award; result: MissionResult }) {
    this.award = data.award;
    this.result = data.result;
    this.shown = false;
  }

  create() {
    const a = this.award;
    const res = this.result;
    const { width, height } = fitMenu(this, 620, 680);
    const cx = width / 2;
    const w = Math.min(760, width - 40);
    const left = cx - w / 2;
    let y = Math.max(24, height / 2 - 320);
    const ok = res.outcome === 'accomplished';
    const head = ok ? 'MISSION ACCOMPLISHED' : res.outcome === 'kia' ? 'KILLED IN ACTION' : res.reason ? 'MISSION FAILED' : 'MISSION FAILED: CAPTURED';
    this.add.text(cx, y, 'DEBRIEFING', { ...FONT, fontSize: '18px', color: DIM }).setOrigin(0.5, 0);
    y += 30;
    this.add.text(cx, y, `MISSION ${res.mission}: ${res.title}`, { ...FONT, fontSize: '20px', color: '#c8c8a0' }).setOrigin(0.5, 0);
    y += 34;
    this.add.text(cx, y, head, { ...FONT, fontSize: '34px', color: ok ? GOLD : '#ff7060' }).setOrigin(0.5, 0);
    y += 52;
    const name = `${RANKS[a.before.rank]} ${a.ranger.name}${a.guest ? ' (guest: not on the roster)' : ''}`;
    this.add.text(cx, y, name, { ...FONT, fontSize: '18px', color: GOLD }).setOrigin(0.5, 0);
    y += 40;
    // G8: why it failed (not the clock) and the objective's own numbers.
    const extra = [res.reason, Object.entries(res.stats ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ')].filter(Boolean).join('\n');
    if (extra) {
      this.add.text(cx, y - 8, extra, { ...FONT, fontSize: '15px', color: res.reason ? '#ff9080' : '#c8c8a0', align: 'center' }).setOrigin(0.5, 0);
      y += 24 * extra.split('\n').length;
    }

    const lines = a.lines.length ? a.lines : [{ label: 'No merit earned', points: 0 }];
    const steps: (() => void)[] = [];
    for (const l of lines) {
      const yy = y;
      steps.push(() => {
        this.add.text(left + 20, yy, l.label, { ...FONT, fontSize: '18px', color: l.points < 0 ? '#ff9080' : '#e0e0c0' });
        this.add.text(left + w - 20, yy, `${l.points > 0 ? '+' : ''}${l.points}`, { ...FONT, fontSize: '18px', color: l.points < 0 ? '#ff9080' : GOLD }).setOrigin(1, 0);
        sfx.click();
      });
      y += 28;
    }
    const yt = y + 6;
    steps.push(() => {
      this.add.graphics().lineStyle(1, 0xe8d27a, 0.6).lineBetween(left + 20, yt, left + w - 20, yt);
      this.add.text(left + 20, yt + 8, 'MISSION MERIT', { ...FONT, fontSize: '20px', color: GOLD });
      this.add.text(left + w - 20, yt + 8, `${a.points}`, { ...FONT, fontSize: '20px', color: GOLD }).setOrigin(1, 0);
      this.add.text(left + 20, yt + 36, `career ${a.before.score} → ${a.ranger.score} pts`, { ...FONT, fontSize: '15px', color: DIM });
      sfx.confirm();
    });
    y = yt + 80;
    if (a.medal) {
      const ym = y;
      const m = a.medal;
      steps.push(() => {
        const g = this.add.graphics();
        drawRibbon(g, m, cx - 160, ym + 4, 48, 20);
        this.add.text(cx - 100, ym, `AWARDED: ${MEDAL_NAMES[m]}`, { ...FONT, fontSize: '18px', color: GOLD });
        sfx.confirm();
      });
      y += 44;
    }
    if (a.promotedTo !== null) {
      const yp = y;
      const to = a.promotedTo;
      steps.push(() => {
        const t = this.add
          .text(cx, yp, `${a.posthumous ? 'POSTHUMOUSLY PROMOTED' : 'PROMOTED'} TO ${RANK_NAMES[to].toUpperCase()} (${RANKS[to]})`, {
            ...FONT,
            fontSize: '22px',
            color: '#10140c',
            backgroundColor: GOLD,
            padding: { x: 12, y: 6 },
          })
          .setOrigin(0.5, 0)
          .setScale(0.6);
        this.tweens.add({ targets: t, scale: 1, duration: 350, ease: 'Back.out' });
        sfx.fanfare();
      });
      y += 50;
    }
    const status = a.status === 'KIA' ? `${a.ranger.name} is listed as killed in action.` : a.status === 'captured' ? `The plane left without ${a.ranger.name}: captured.` : '';
    const yh = y + 10;
    steps.push(() => {
      if (status) this.add.text(cx, yh, status, { ...FONT, fontSize: '16px', color: '#ff9080' }).setOrigin(0.5, 0);
      this.add.text(cx, yh + 34, isTouch ? 'tap to continue' : a.status === 'active' && !a.guest ? 'Enter: mission select · Esc: roster' : 'Enter: roster', { ...FONT, fontSize: '14px', color: DIM }).setOrigin(0.5, 0);
      this.shown = true;
    });
    // The lines appear one by one; a key shows the rest at once.
    let next = 0;
    const timers = steps.map((_, k) => this.time.delayedCall(400 + k * 300, () => next <= k && steps[next++]()));
    const showAll = () => {
      timers.forEach((t) => t.remove());
      while (next < steps.length) steps[next++]();
    };

    // A tap: the rest of the lines, then on (like Enter).
    this.input.on('pointerup', () => {
      if (!this.shown) return showAll();
      sfx.click();
      this.scene.start(a.status === 'active' && !a.guest ? 'missions' : 'title');
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== ' ') return;
      if (!this.shown) {
        showAll();
        return;
      }
      sfx.click();
      this.scene.start(e.key !== 'Escape' && a.status === 'active' && !a.guest ? 'missions' : 'title');
    });
  }
}
