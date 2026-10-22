/** Short synthesized sounds (Web Audio), no audio files needed. */
const STORAGE_KEY = 'crossroads-sound';

let context: AudioContext | null = null;
let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';

export const isSoundEnabled = (): boolean => enabled;

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
}

function audio(): AudioContext | null {
  if (!enabled || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', volume = 0.07): void {
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sounds = {
  pass(): void {
    tone(520, 0, 0.12, 'triangle', 0.05);
  },
  success(): void {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle'));
  },
  error(): void {
    tone(160, 0, 0.35, 'sawtooth', 0.06);
    tone(120, 0.12, 0.4, 'sawtooth', 0.05);
  },
  siren(): void {
    for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, i * 0.32, 0.3, 'square', 0.03);
  },
  signal(): void {
    tone(880, 0, 0.06, 'square', 0.03);
  },
};
