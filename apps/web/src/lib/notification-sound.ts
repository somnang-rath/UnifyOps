let ctx: AudioContext | null = null;

const STORAGE_KEY = 'pr_notif_sound';

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function setSoundEnabled(v: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

export function playPing(force = false): void {
  if (!force && !isSoundEnabled()) return;
  const c = ensureContext();
  if (!c) return;
  try {
    const now = c.currentTime;
    const notes = [
      { freq: 880, start: 0, dur: 0.08 },
      { freq: 1320, start: 0.06, dur: 0.1 },
    ];
    for (const n of notes) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(0.12, now + n.start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain).connect(c.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur);
    }
  } catch {
    /* ignore */
  }
}
