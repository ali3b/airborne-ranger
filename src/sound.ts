/**
 * Procedural sound effects (WebAudio, no sample files): every sound is synthesised here from noise and oscillators,
 * so there is nothing to download or license. M toggles mute (saved in localStorage).
 *
 *   shot, enemyShot   rifle crack: a short noise burst through a high-pass, plus a low thump
 *   explosion         a long low-passed noise rumble with a falling sub-bass sine
 *   footstep          a soft low-passed noise tick (played on the clips' footstep_l / footstep_r events)
 *   throwWhoosh       a band-passed noise sweep (the grenade leaving the hand)
 *   pickup            a rising two-note chime (a supply pod)
 *   click, confirm    UI blips
 *   alert             a short two-tone whistle when the enemy is alerted
 *   drums             the title's march loop (kick, snare, snare rolls), scheduled ahead on the audio clock
 */

const MUTE_KEY = 'ar.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = readMuted();
let drumTimer: number | null = null;
let drumNext = 0;
let drumStep = 0;
let startedCount = 0;

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The audio context, created on first use; browsers start it suspended until a key or click (see unlock()). */
function ac(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Resume the context on the first user gesture (autoplay rules). Safe to call often. */
export function unlock() {
  const c = ac();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}
window.addEventListener('keydown', unlock);
window.addEventListener('pointerdown', unlock);

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.02);
}

export function toggleMute() {
  setMuted(!muted);
  return muted;
}

/** True when a sound would be heard (running context, not muted): skip the synthesis otherwise. */
function live(): AudioContext | null {
  const c = ac();
  if (!c || muted || c.state !== 'running') return null;
  return c;
}

/** A noise source through a filter and an envelope, into the master. */
function noise(c: AudioContext, at: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 0.7, freqEnd?: number) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, at);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(at, Math.random() * 1.5, dur + 0.05);
  startedCount++;
}

/** A sine (or other wave) with a pitch glide and a decay. */
function tone(c: AudioContext, at: number, dur: number, gain: number, f0: number, f1: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master!);
  o.start(at);
  o.stop(at + dur + 0.05);
  startedCount++;
}

/** `vol` 0..1 scales a sound (distance falloff for enemy sounds). */
export const sfx = {
  shot(vol = 1) {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.12, 0.9 * vol, 'highpass', 900);
    noise(c, t, 0.25, 0.5 * vol, 'lowpass', 1800, 0.7, 300);
    tone(c, t, 0.12, 0.6 * vol, 150, 50);
  },
  enemyShot(vol = 1) {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.1, 0.6 * vol, 'highpass', 1400);
    noise(c, t, 0.3, 0.35 * vol, 'lowpass', 1200, 0.7, 250);
  },
  explosion(vol = 1) {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 1.6, 1.0 * vol, 'lowpass', 2200, 0.8, 90);
    noise(c, t, 0.25, 0.6 * vol, 'bandpass', 900, 0.6);
    tone(c, t, 0.9, 0.9 * vol, 90, 28);
  },
  footstep(vol = 1) {
    const c = live();
    if (!c) return;
    noise(c, c.currentTime, 0.07, 0.22 * vol, 'lowpass', 500 + Math.random() * 250, 1.2);
  },
  throwWhoosh() {
    const c = live();
    if (!c) return;
    noise(c, c.currentTime, 0.35, 0.35, 'bandpass', 500, 2.5, 2400);
  },
  pickup() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.12, 0.25, 660, 660, 'square');
    tone(c, t + 0.1, 0.22, 0.25, 990, 990, 'square');
  },
  click() {
    const c = live();
    if (!c) return;
    tone(c, c.currentTime, 0.05, 0.18, 1200, 900, 'square');
  },
  confirm() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.08, 0.2, 520, 520, 'square');
    tone(c, t + 0.08, 0.16, 0.2, 780, 780, 'square');
  },
  alert() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 0.14, 0.18, 1500, 1500, 'triangle');
    tone(c, t + 0.16, 0.2, 0.18, 1150, 1150, 'triangle');
  },
  /** The debriefing's promotion fanfare: a short bugle-like triad. */
  fanfare() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    [392, 523, 659, 784].forEach((f, k) => tone(c, t + k * 0.16, k === 3 ? 0.6 : 0.18, 0.22, f, f, 'sawtooth'));
  },
};

/**
 * The title's drum loop: a 16-step march at 112 bpm (kick on the beats, snare on 2 and 4, rolls at the end of the
 * bar), scheduled 0.2 s ahead on the audio clock so a slow frame doesn't make it stutter.
 */
const KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1];
const STEP = 60 / 112 / 4;

export function startDrums() {
  if (drumTimer !== null) return;
  drumStep = 0;
  drumNext = 0;
  const tick = () => {
    const c = ctx;
    if (!c || c.state !== 'running') {
      ac();
      return;
    }
    if (drumNext < c.currentTime) drumNext = c.currentTime + 0.05;
    while (drumNext < c.currentTime + 0.2) {
      const s = drumStep % 16;
      if (!muted) {
        if (KICK[s]) tone(c, drumNext, 0.25, 0.7, 120, 40);
        if (SNARE[s]) {
          noise(c, drumNext, s >= 13 ? 0.09 : 0.16, s >= 13 ? 0.25 : 0.4, 'highpass', 1500);
          tone(c, drumNext, 0.08, 0.15, 260, 180, 'triangle');
        }
        if (s % 2 === 0) noise(c, drumNext, 0.03, 0.06, 'highpass', 7000);
      }
      drumNext += STEP;
      drumStep++;
    }
  };
  drumTimer = window.setInterval(tick, 50);
}

export function stopDrums() {
  if (drumTimer !== null) window.clearInterval(drumTimer);
  drumTimer = null;
}

let muteKeyOn = true;
/** Whether the M key toggles mute (off while a name is typed). */
export function muteKeys(on: boolean) {
  muteKeyOn = on;
}

/** The M key and a small SOUND ON/OFF button in the corner (works in every scene). */
export function installMuteControls() {
  const b = document.createElement('button');
  b.id = 'mute';
  b.style.cssText =
    'position:fixed;right:10px;bottom:10px;z-index:10;font:12px monospace;padding:4px 8px;background:#10140ccc;color:#e8d27a;border:1px solid #e8d27a66;cursor:pointer';
  const label = () => (b.textContent = muted ? 'SOUND OFF (M)' : 'SOUND ON (M)');
  label();
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    unlock();
    toggleMute();
    label();
    b.blur();
  });
  document.body.appendChild(b);
  window.addEventListener('keydown', (e) => {
    if (!muteKeyOn || e.repeat || (e.key !== 'm' && e.key !== 'M')) return;
    toggleMute();
    label();
  });
}

/** For the checks: the audio context's state and how many sounds were started. */
export function audioState() {
  return { state: ctx?.state ?? 'none', muted, started: startedCount };
}
