// Alle Töne werden selbst erzeugt (WebAudio), es werden keine Audiodateien gebraucht.

let ac: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) { muted = m; }
export function isMuted() { return muted; }

function ctx(): AudioContext {
  if (!ac) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    ac = new AC();
  }
  if (ac.state === "suspended") ac.resume();
  return ac;
}

function tone(f: number, t0: number, d: number, type: OscillatorType, v: number, f2?: number) {
  if (muted) return;
  const c = ctx();
  const t = c.currentTime + t0;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + d + 0.03);
}

function whoosh() {
  if (muted) return;
  const c = ctx();
  const len = Math.floor(c.sampleRate * 0.6);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource();
  s.buffer = b;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(400, c.currentTime);
  f.frequency.exponentialRampToValueAtTime(3600, c.currentTime + 0.45);
  const g = c.createGain();
  g.gain.value = 0.16;
  s.connect(f).connect(g).connect(c.destination);
  s.start();
}

export const snd = {
  move: () => tone(1250, 0, 0.06, "square", 0.035, 1700),
  ok: () => { tone(660, 0, 0.09, "triangle", 0.12); tone(990, 0.07, 0.18, "triangle", 0.12); },
  back: () => tone(560, 0, 0.12, "triangle", 0.1, 330),
  open: () => { whoosh(); tone(220, 0, 0.35, "sine", 0.1, 880); },
};
