import Phaser from 'phaser';
import { missionByKey, type MissionConfig } from '../missions';
import { ITEMS, POD_CAPACITY, POD_COUNT, POD_MAX_WEIGHT, STANDARD, EMPTY, BASIC_CARRY, canAdd, count, weight, loadLoadout, saveLoadout, sanitize, type ItemKey, type Loadout as LoadoutT } from '../loadout';
import type { AssetManifest } from '../assets';
import { sfx } from '../sound';
import { fitMenu, isTouch } from '../touch';

const FONT = { fontFamily: 'monospace' };
const GOLD = '#e8d27a';
const DIM = '#9aa88a';
/** Facing used for each item's icon (the long LAW reads best side-on). */
const ICON_DIR: Record<ItemKey, string> = { mag: 'SE', grenade: 'SE', medkit: 'SE', law: 'E', bomb: 'SE' };

/**
 * The supply pod loadout (G7), between the mission select and the drop, after the original's supply pod screen: the
 * pod's contents drawn in a green bag at the top, one row per item (icon, name, weight, − count +), the item and weight
 * gauges, and CLEAR / STANDARD / DONE. Keys: Up/Down (or 1–5) pick a row, Left/Right or −/+ change it, C clear,
 * S standard, Enter done, Esc back to the mission select. On touch: tap the − / + buttons and the three buttons.
 */
export class Loadout extends Phaser.Scene {
  private cfg: MissionConfig = missionByKey(null);
  private rangerId: string | undefined;
  /** The pod being packed (scripts/load-check.mjs reads and drives it). */
  pod: LoadoutT = { ...STANDARD };
  pick = 0;
  private rows: { name: Phaser.GameObjects.Text; num: Phaser.GameObjects.Text; bg: Phaser.GameObjects.Rectangle }[] = [];
  private bag!: Phaser.GameObjects.Container;
  private gauge!: Phaser.GameObjects.Text;
  private bars: { items: Phaser.GameObjects.Rectangle; weight: Phaser.GameObjects.Rectangle; w: number } | null = null;
  private manifest: AssetManifest | null = null;

  constructor() {
    super('loadout');
  }

  init(data: { mission?: string; ranger?: string }) {
    this.cfg = missionByKey(data?.mission ?? new URLSearchParams(window.location.search).get('mission'));
    this.rangerId = data?.ranger;
    this.pod = loadLoadout();
  }

  preload() {
    // Only the item icons: the field's atlases load with the mission (a separate manifest key, so the mission's own
    // manifest load still fires and loads the rest; textures already here are skipped by the loader).
    this.load.json('loadout-manifest', 'assets/manifest.json');
    this.load.once('filecomplete-json-loadout-manifest', (_k: string, _t: string, m: AssetManifest) => {
      for (const it of ITEMS) {
        const s = m.sprites[it.icon];
        if (s) this.load.multiatlas(s.name, s.atlas, s.path);
      }
    });
  }

  create() {
    this.manifest = (this.cache.json.get('loadout-manifest') as AssetManifest | undefined) ?? null;
    const { width, height } = fitMenu(this, 720, 600);
    const cx = width / 2;
    const top = Math.max(16, height / 2 - 290);
    this.add.text(cx, top, 'SUPPLY POD', { ...FONT, fontSize: '30px', color: GOLD }).setOrigin(0.5, 0);
    this.add
      .text(cx, top + 38, `MISSION ${this.cfg.number}: ${this.cfg.title}  ·  ${POD_COUNT} pods drop with you`, { ...FONT, fontSize: '14px', color: '#c8c8a0' })
      .setOrigin(0.5, 0);

    // The pod: a green bag with the packed items in it (like the original's screen).
    const bagW = Math.min(640, width - 40);
    const bagY = top + 66;
    this.add.rectangle(cx, bagY + 50, bagW, 100, 0x2e5a22).setStrokeStyle(3, 0x7fd060).setOrigin(0.5);
    this.add.ellipse(cx + bagW / 2 - 6, bagY + 50, 40, 96, 0x24481a).setStrokeStyle(3, 0x7fd060);
    this.bag = this.add.container(cx - bagW / 2 + 14, bagY + 8);

    // Rows.
    const rowW = Math.min(640, width - 40);
    const left = cx - rowW / 2;
    const rowY = bagY + 120;
    const RH = 52;
    this.rows = ITEMS.map((it, k) => {
      const y = rowY + k * RH;
      const bg = this.add.rectangle(left, y, rowW, RH - 6, 0x1a2014).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.select(k));
      this.icon(it.icon, ICON_DIR[it.key], left + 40, y + (RH - 6) / 2, 64, RH - 12);
      const name = this.add.text(left + 84, y + 12, `${k + 1} ${it.name}`, { ...FONT, fontSize: '18px', color: GOLD });
      this.add.text(left + 330, y + 15, `wt ${it.weight}`, { ...FONT, fontSize: '14px', color: DIM });
      const minus = this.button(left + rowW - 150, y + (RH - 6) / 2, '−', 44, () => this.change(k, -1));
      const num = this.add.text(left + rowW - 98, y + (RH - 6) / 2, '0', { ...FONT, fontSize: '22px', color: GOLD }).setOrigin(0.5);
      const plus = this.button(left + rowW - 40, y + (RH - 6) / 2, '+', 44, () => this.change(k, 1));
      minus.setName(`minus-${it.key}`);
      plus.setName(`plus-${it.key}`);
      return { name, num, bg };
    });

    // Gauges.
    const gy = rowY + ITEMS.length * RH + 4;
    this.gauge = this.add.text(left, gy, '', { ...FONT, fontSize: '15px', color: '#c8c8a0' });
    const bw = rowW - 330;
    this.add.rectangle(left + 330, gy + 2, bw, 8, 0x2a3020).setOrigin(0, 0);
    this.add.rectangle(left + 330, gy + 14, bw, 8, 0x2a3020).setOrigin(0, 0);
    this.bars = {
      items: this.add.rectangle(left + 330, gy + 2, 0, 8, 0x7fd060).setOrigin(0, 0),
      weight: this.add.rectangle(left + 330, gy + 14, 0, 8, 0xe8d27a).setOrigin(0, 0),
      w: bw,
    };
    const carry = ITEMS.filter((it) => BASIC_CARRY[it.key]).map((it) => `${BASIC_CARRY[it.key]} ${it.short}`).join(', ');
    this.add.text(left, gy + 26, `you carry: carbine + 1 loaded mag, ${carry}`, { ...FONT, fontSize: '13px', color: DIM });

    // CLEAR / STANDARD / DONE.
    const by = gy + 72;
    this.button(cx - 190, by, 'CLEAR', 160, () => this.setPod({ ...EMPTY }), true).setName('btn-clear');
    this.button(cx, by, 'STANDARD', 160, () => this.setPod({ ...STANDARD }), true).setName('btn-standard');
    this.button(cx + 190, by, 'DONE', 160, () => this.done(), true).setName('btn-done');
    this.add
      .text(cx, by + 34, isTouch ? 'tap − / + to pack the pod' : 'Up/Down or 1-5 pick · Left/Right or -/+ change · C clear · S standard · Enter done · Esc back', {
        ...FONT,
        fontSize: '12px',
        color: DIM,
      })
      .setOrigin(0.5, 0);
    this.add
      .text(20, 20, '< MISSIONS', { ...FONT, fontSize: '18px', color: GOLD, padding: { x: 10, y: 8 }, backgroundColor: '#1a2014' })
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.back());

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') this.select((this.pick + ITEMS.length - 1) % ITEMS.length);
      else if (e.key === 'ArrowDown') this.select((this.pick + 1) % ITEMS.length);
      else if (e.key === 'ArrowLeft' || e.key === '-' || e.key === 'a') this.change(this.pick, -1);
      else if (e.key === 'ArrowRight' || e.key === '+' || e.key === '=' || e.key === 'd') this.change(this.pick, 1);
      else if (e.key === 'c' || e.key === 'C') this.setPod({ ...EMPTY });
      else if (e.key === 's' || e.key === 'S') this.setPod({ ...STANDARD });
      else if (e.key === 'Enter' || e.key === ' ') this.done();
      else if (e.key === 'Escape') this.back();
      else if (/^[1-5]$/.test(e.key)) this.select(Number(e.key) - 1);
    });
    this.select(0, true);
    this.refresh();
  }

  /** An item icon from its generator sprite, scaled to fit a box. */
  private icon(sprite: string, dir: string, x: number, y: number, w: number, h: number) {
    if (!this.textures.exists(sprite)) return null;
    const tex = this.textures.get(sprite);
    const want = `still_${dir}_0`;
    const frame = tex.has(want) ? want : tex.getFrameNames()[0];
    const img = this.add.image(x, y, sprite, frame);
    img.setScale(Math.min(w / img.width, h / img.height, 1.5));
    return img;
  }

  private button(x: number, y: number, label: string, w: number, fn: () => void, big = false) {
    const b = this.add
      .text(x, y, label, {
        ...FONT,
        fontSize: big ? '20px' : '24px',
        color: big ? '#ffffff' : GOLD,
        backgroundColor: big ? '#8a1c14' : '#2a3020',
        padding: { x: 8, y: big ? 6 : 2 },
        fixedWidth: w,
        align: 'center',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    b.on('pointerdown', () => b.setAlpha(0.7));
    b.on('pointerout', () => b.setAlpha(1));
    b.on('pointerup', () => {
      b.setAlpha(1);
      fn();
    });
    return b;
  }

  select(k: number, quiet = false) {
    if (!quiet && k !== this.pick) sfx.click();
    this.pick = k;
    this.rows.forEach((r, i) => {
      r.bg.setFillStyle(i === k ? 0x3a4426 : 0x1a2014);
      r.name.setColor(i === k ? '#ffffff' : GOLD);
    });
  }

  /** One more (+1) or one fewer (−1) of row k; refused (a low click) at the pod's limits. */
  change(k: number, d: number) {
    this.select(k, true);
    const key = ITEMS[k].key;
    if (d > 0 && !canAdd(this.pod, key)) return sfx.dryFire();
    if (d < 0 && this.pod[key] <= 0) return sfx.dryFire();
    this.pod[key] += d;
    sfx.click();
    this.refresh();
  }

  setPod(l: LoadoutT) {
    this.pod = sanitize(l);
    sfx.confirm();
    this.refresh();
  }

  private refresh() {
    const n = count(this.pod);
    const w = weight(this.pod);
    ITEMS.forEach((it, k) => this.rows[k]?.num.setText(String(this.pod[it.key])));
    this.gauge.setText(`items ${n}/${POD_CAPACITY}\nweight ${w}/${POD_MAX_WEIGHT}`);
    if (this.bars) {
      this.bars.items.width = (this.bars.w * n) / POD_CAPACITY;
      this.bars.weight.width = (this.bars.w * w) / POD_MAX_WEIGHT;
    }
    // The bag's contents: one small icon per item, in packing order.
    this.bag.removeAll(true);
    let x = 0;
    let row = 0;
    for (const it of ITEMS) {
      for (let c = 0; c < this.pod[it.key]; c++) {
        const img = this.icon(it.icon, ICON_DIR[it.key], 0, 0, it.key === 'law' ? 56 : 26, 26);
        if (!img) continue;
        const iw = Math.max(26, img.displayWidth) + 4;
        if (x + iw > 560) {
          x = 0;
          row++;
        }
        img.setPosition(x + iw / 2, 14 + row * 30);
        this.bag.add(img);
        x += iw;
      }
    }
  }

  done() {
    saveLoadout(this.pod);
    sfx.confirm();
    this.scene.start('mission', { mission: this.cfg.map, ranger: this.rangerId, loadout: { ...this.pod } });
  }

  back() {
    this.scene.start(this.rangerId ? 'missions' : 'title');
  }
}
