// audio.js — every sound in Foundry Yard is synthesised with WebAudio.
// No audio files, no network. One shared noise buffer, one master gain,
// and a small queue the game drains each frame so sounds never stack up.
// The context is created on the first user gesture; until then it stays
// suspended and silent.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function initAudio() { ensure(); }
export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

function noise(dur, filterType, freq, gain, decay = 0.08) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur);
}

function tone(freq, dur, type, gain, slideTo = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}

// weapon: 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper'
export function playShot(weapon, distant = false) {
  if (!ctx || muted) return;
  const vol = distant ? 0.12 : 0.5;
  switch (weapon) {
    case 'shotgun': noise(0.22, 'lowpass', 900, vol, 0.18); tone(120, 0.12, 'square', vol * 0.5, 50); break;
    case 'sniper': noise(0.3, 'lowpass', 1400, vol, 0.25); tone(180, 0.2, 'sawtooth', vol * 0.4, 60); break;
    case 'smg': noise(0.09, 'bandpass', 1800, vol * 0.8, 0.07); break;
    case 'pistol': noise(0.12, 'bandpass', 1400, vol, 0.09); break;
    default: noise(0.12, 'bandpass', 1100, vol, 0.1);
  }
}

export function playDryFire() { tone(1200, 0.03, 'square', 0.12); }
export function playReload() {
  tone(500, 0.05, 'square', 0.15);
  setTimeout(() => tone(700, 0.05, 'square', 0.15), 180);
  setTimeout(() => tone(420, 0.06, 'square', 0.18), 420);
}
export function playHit(kill = false) {
  tone(kill ? 1400 : 1000, 0.07, 'sine', 0.25);
  if (kill) setTimeout(() => tone(1800, 0.09, 'sine', 0.25), 70);
}
export function playHurt() { noise(0.15, 'lowpass', 400, 0.3, 0.12); tone(90, 0.15, 'sawtooth', 0.2, 50); }
export function playStep(run) { noise(0.05, 'lowpass', run ? 500 : 320, run ? 0.1 : 0.05, 0.04); }
export function playBeep() { tone(880, 0.09, 'sine', 0.25); }
export function playPlant() { tone(660, 0.12, 'sine', 0.22); setTimeout(() => tone(990, 0.14, 'sine', 0.22), 140); }
export function playExplosion() {
  noise(0.9, 'lowpass', 300, 0.9, 0.8);
  tone(60, 0.8, 'sine', 0.6, 30);
}
export function playClick() { tone(800, 0.04, 'square', 0.15); }
export function playBuy() { tone(520, 0.08, 'sine', 0.2); setTimeout(() => tone(780, 0.1, 'sine', 0.2), 90); }
export function playRoundWin() {
  [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.25), i * 130));
}
export function playRoundLose() {
  [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.22), i * 150));
}
export function playGrenade() { noise(0.15, 'bandpass', 900, 0.25, 0.1); }
