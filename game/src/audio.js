// Synthesised sound for EMBERLINE: every effect is built from oscillators and
// filtered noise at runtime, so the game ships no audio assets and makes no
// network request. The bus is lazy — it only creates an AudioContext after the
// first user gesture (or the first shot-mode render), and every call is a no-op
// until then, so headless screenshot runs stay silent and error-free.
export class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  // Short burst of white noise through a low-pass filter: the body of a gunshot.
  _noise(dur, filterFreq, gainVal, when = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // Pure tone with a fast decay envelope.
  _tone(freq, dur, gainVal, type = 'sine', slideTo = 0, when = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  shot(kind) {
    // kind: 'rifle' | 'smg' | 'pistol' | 'enemy'
    if (kind === 'rifle') {
      this._noise(0.11, 2400, 0.9);
      this._tone(160, 0.09, 0.5, 'square', 60);
    } else if (kind === 'smg') {
      this._noise(0.07, 3200, 0.6);
      this._tone(220, 0.05, 0.35, 'square', 90);
    } else if (kind === 'pistol') {
      this._noise(0.09, 1800, 0.7);
      this._tone(130, 0.08, 0.4, 'square', 55);
    } else {
      this._noise(0.1, 1400, 0.35); // distant enemy fire, quieter
    }
  }
  dry() {
    this._tone(900, 0.04, 0.25, 'square');
  }
  reload() {
    this._tone(520, 0.05, 0.3, 'square');
    this._tone(380, 0.05, 0.3, 'square', 0, 0.12);
    this._tone(660, 0.06, 0.35, 'square', 0, 0.28);
  }
  hit() {
    this._tone(1250, 0.05, 0.35, 'sine');
  }
  kill() {
    this._tone(880, 0.07, 0.35, 'sine');
    this._tone(1320, 0.1, 0.3, 'sine', 0, 0.07);
  }
  hurt() {
    this._tone(110, 0.16, 0.5, 'sawtooth', 60);
  }
  beep() {
    this._tone(1040, 0.12, 0.4, 'sine');
  }
  plantTick() {
    this._tone(1560, 0.06, 0.3, 'sine');
  }
  explosion() {
    this._noise(0.9, 420, 1.0);
    this._tone(70, 0.8, 0.9, 'sine', 28);
    this._noise(0.35, 3000, 0.5, 0.02);
  }
  roundStart() {
    this._tone(392, 0.12, 0.3, 'triangle');
    this._tone(523, 0.18, 0.3, 'triangle', 0, 0.12);
  }
  roundWin() {
    this._tone(523, 0.14, 0.3, 'triangle');
    this._tone(659, 0.14, 0.3, 'triangle', 0, 0.13);
    this._tone(784, 0.22, 0.32, 'triangle', 0, 0.26);
  }
  roundLose() {
    this._tone(330, 0.16, 0.3, 'triangle');
    this._tone(262, 0.16, 0.3, 'triangle', 0, 0.15);
    this._tone(196, 0.28, 0.3, 'triangle', 0, 0.3);
  }
  buy() {
    this._tone(990, 0.05, 0.3, 'sine');
    this._tone(1480, 0.08, 0.3, 'sine', 0, 0.06);
  }
  step() {
    this._noise(0.03, 500, 0.08);
  }
}
