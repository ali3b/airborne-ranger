import Phaser from 'phaser';
// Touch controls for phones and tablets: a virtual stick (left) and action buttons (right), drawn as an HTML
// overlay above the canvas so several fingers work at once. The field scenes show it while they run and read the
// stick each frame; menus use taps on the canvas. ?touch=1 forces it on (desktop testing), ?touch=0 off.

const param = new URLSearchParams(window.location.search).get('touch');
/** True on touch devices (a coarse pointer or touch support), unless ?touch=0. */
export const isTouch = param === '1' || (param !== '0' && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0));

export interface TouchActions {
  shoot(): void;
  grenade(): void;
  prone(): void;
  /** The overview map (missions only): a MAP button top centre when given. */
  map?(): void;
}

/** The stick: x right, y down (screen), each -1..1; run when pushed to the edge. */
const stick = { x: 0, y: 0, run: false };
let actions: TouchActions | null = null;
let root: HTMLDivElement | null = null;
let proneBtn: HTMLButtonElement | null = null;
let mapBtn: HTMLButtonElement | null = null;

/** The stick's world direction (x east, y north) snapped to 8 directions, or null when centred; and whether to run. */
export function touchMove(): { dx: number; dy: number; run: boolean } | null {
  const len = Math.hypot(stick.x, stick.y);
  if (len < 0.25) return null;
  const a = Math.round(Math.atan2(-stick.y, stick.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { dx: Math.round(Math.cos(a) * 1000) / 1000, dy: Math.round(Math.sin(a) * 1000) / 1000, run: stick.run };
}

/** Show the field controls, wired to a scene's actions; returns the function that hides them. */
export function showFieldControls(a: TouchActions): () => void {
  if (!isTouch) return () => undefined;
  actions = a;
  build();
  root!.style.display = 'block';
  mapBtn!.style.display = a.map ? 'block' : 'none';
  return () => {
    if (actions === a) actions = null;
    stick.x = stick.y = 0;
    stick.run = false;
    if (root) root.style.display = 'none';
  };
}

/** Light the PRONE button while the Ranger is down. */
export function setProneLit(on: boolean) {
  proneBtn?.classList.toggle('on', on);
}

function build() {
  if (root) return;
  const css = document.createElement('style');
  css.textContent = `
    #touch { position: fixed; inset: 0; z-index: 5; pointer-events: none; display: none; font-family: monospace;
      -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    #touch .pad { position: absolute; left: 0; bottom: 0; width: 50%; height: 70%; pointer-events: auto; touch-action: none; }
    #touch .base { position: absolute; width: 132px; height: 132px; margin: -66px 0 0 -66px; border-radius: 50%;
      border: 2px solid #e8d27a66; background: #10140c55; display: none; }
    #touch .knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
      background: #e8d27aaa; }
    #touch .knob.run { background: #ff9a50dd; }
    #touch .hint { position: absolute; left: 24px; bottom: 24px; color: #e8d27a88; font-size: 12px; }
    #touch .btns { position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom));
      display: grid; grid-template-columns: auto auto; gap: 12px; align-items: end; pointer-events: auto; touch-action: none; }
    #touch button { width: 76px; height: 76px; border-radius: 50%; border: 2px solid #e8d27a99; background: #10140caa;
      color: #e8d27a; font: bold 12px monospace; touch-action: none; padding: 0; }
    #touch button.fire { width: 96px; height: 96px; font-size: 14px; background: #5a1c14cc; grid-row: span 2; }
    #touch button.down, #touch button.on { background: #e8d27a; color: #10140c; }
    #touch button.fire.down { background: #ff7060; color: #10140c; }
    #touch button.map { position: absolute; top: max(10px, env(safe-area-inset-top)); left: 50%; margin-left: -34px; width: 68px; height: 40px;
      border-radius: 8px; pointer-events: auto; font-size: 13px; }
  `;
  document.head.appendChild(css);
  root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `<div class="pad"><div class="hint">drag to move · push to the edge to run</div><div class="base"><div class="knob"></div></div></div>
    <div class="btns"><button class="grenade">GRENADE</button><button class="fire">FIRE</button><button class="prone">PRONE</button></div>
    <button class="map">MAP</button>`;
  document.body.appendChild(root);

  const pad = root.querySelector('.pad') as HTMLDivElement;
  const base = root.querySelector('.base') as HTMLDivElement;
  const knob = root.querySelector('.knob') as HTMLDivElement;
  const hint = root.querySelector('.hint') as HTMLDivElement;
  const R = 56;
  let id: number | null = null;
  let ox = 0;
  let oy = 0;
  const moveKnob = (cx: number, cy: number) => {
    let dx = cx - ox;
    let dy = cy - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    stick.x = dx / R;
    stick.y = dy / R;
    stick.run = d > R * 0.92;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    knob.classList.toggle('run', stick.run);
  };
  pad.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    // The stick appears where the thumb lands.
    const r = pad.getBoundingClientRect();
    ox = e.clientX;
    oy = e.clientY;
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    base.style.display = 'block';
    hint.style.display = 'none';
    moveKnob(e.clientX, e.clientY);
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) moveKnob(e.clientX, e.clientY);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    stick.x = stick.y = 0;
    stick.run = false;
    base.style.display = 'none';
    knob.style.transform = '';
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  const bind = (sel: string, fire: () => void, repeatMs = 0) => {
    const b = root!.querySelector(sel) as HTMLButtonElement;
    let timer: number | undefined;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      fire();
      if (repeatMs) timer = window.setInterval(fire, repeatMs);
    });
    const up = () => {
      b.classList.remove('down');
      window.clearInterval(timer);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };
  // FIRE repeats while held (the scene's own cooldown sets the real rate).
  bind('.fire', () => actions?.shoot(), 180);
  bind('.grenade', () => actions?.grenade());
  proneBtn = bind('.prone', () => actions?.prone());
  mapBtn = bind('.map', () => actions?.map?.());
}

/**
 * Menus on small screens: lay out on a virtual canvas at least `minW`×`minH` and zoom the camera to fit, so the
 * fixed-size text of the roster and debriefing fits a phone. Returns the size to lay out in.
 */
export function fitMenu(scene: Phaser.Scene, minW = 760, minH = 560): { width: number; height: number } {
  const { width, height } = scene.scale;
  const zoom = Math.min(1, width / minW, height / minH);
  const w = width / zoom;
  const h = height / zoom;
  const cam = scene.cameras.main;
  cam.setZoom(zoom);
  cam.centerOn(w / 2, h / 2);
  // Shrunk text reads better smoothed than with the game's pixel-art filtering.
  if (zoom < 1) {
    const smooth = () => {
      for (const o of scene.children.list) if (o instanceof Phaser.GameObjects.Text && !o.getData('smooth')) {
        o.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        o.setData('smooth', true);
      }
    };
    scene.events.on('postupdate', smooth);
    scene.events.once('shutdown', () => scene.events.off('postupdate', smooth));
  }
  rotateHint(isTouch && height > width && width < 600);
  // Turning the device lays the menu out again.
  const relayout = () => scene.scene.restart();
  scene.scale.once('resize', relayout);
  scene.events.once('shutdown', () => scene.scale.off('resize', relayout));
  return { width: w, height: h };
}

/** A banner on phones held upright in the menus: the game reads best sideways. */
function rotateHint(on: boolean) {
  let el = document.getElementById('rotate');
  if (!on) {
    el?.remove();
    return;
  }
  if (el) return;
  el = document.createElement('div');
  el.id = 'rotate';
  el.textContent = 'turn your phone sideways for the best view';
  el.style.cssText = 'position:fixed;left:0;right:0;bottom:max(16px, env(safe-area-inset-bottom));text-align:center;font:14px monospace;color:#e8d27a;z-index:6;pointer-events:none';
  document.body.appendChild(el);
}
