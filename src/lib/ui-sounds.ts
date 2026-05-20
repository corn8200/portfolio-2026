// UI sound synthesizer. WebAudio, no samples. ~2KB. Off by default.
// Per DESIGN.md §5: six sounds, all synthesized at runtime, all opt-in.
//
// Pitches expressed in semitones above middle A (220Hz reference).
// Each sound is 1-2 short FM/AM-shaped tones + an exponential envelope.

type SoundName =
  | 'hover'        // hairline tick — 4ms attack, 80ms tail, very quiet
  | 'click'        // confirm — two-pitch chirp up
  | 'submit'       // commit — three-tone arpeggio
  | 'error'        // soft thunk descending
  | 'route'        // route handoff — quick swept rumble
  | 'listening';   // voice-mode opened — sustained hum, ~600ms

let ctx: AudioContext | null = null;
let enabled: boolean = (() => {
  try { return localStorage.getItem('sound') === 'on'; } catch { return false; }
})();

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
    catch { return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.06, attack = 0.005, when = 0) {
  const ac = ensure();
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sweep(fromHz: number, toHz: number, dur: number, gain = 0.05, when = 0) {
  const ac = ensure();
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(fromHz, t0);
  osc.frequency.exponentialRampToValueAtTime(toHz, t0 + dur);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const filt = ac.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1800;
  osc.connect(filt).connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function play(name: SoundName): void {
  if (!enabled) return;
  switch (name) {
    case 'hover':     tone(2300, 0.06, 'triangle', 0.018, 0.003); break;
    case 'click':     tone(740, 0.05, 'sine', 0.05, 0.003); tone(1100, 0.07, 'sine', 0.035, 0.003, 0.04); break;
    case 'submit':    tone(523.25, 0.07, 'triangle', 0.05); tone(659.25, 0.07, 'triangle', 0.05, 0.005, 0.06); tone(783.99, 0.10, 'triangle', 0.05, 0.005, 0.12); break;
    case 'error':     sweep(420, 180, 0.18, 0.06); break;
    case 'route':     sweep(1200, 380, 0.20, 0.04); break;
    case 'listening': tone(220, 0.6, 'sine', 0.03, 0.04); tone(330, 0.6, 'sine', 0.02, 0.04, 0.05); break;
  }
}

export function setEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem('sound', on ? 'on' : 'off'); } catch {}
}

export function isEnabled(): boolean { return enabled; }
