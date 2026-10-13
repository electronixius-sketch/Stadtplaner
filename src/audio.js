// Kleine synthetische Soundeffekte (WebAudio), ohne Audiodateien.
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.35;
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (_) { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, type = 'sine', vol = 0.4, slide = 0, delay = 0) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol = 0.3, freq = 800) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(f).connect(g).connect(this.master);
    s.start();
  }

  click() { this.tone(880, 0.05, 'triangle', 0.18); }
  build() { this.tone(180, 0.12, 'square', 0.12, -60); this.noise(0.12, 0.25, 900); this.tone(520, 0.08, 'triangle', 0.12, 0, 0.06); }
  zone() { this.tone(660, 0.07, 'sine', 0.2); this.tone(990, 0.08, 'sine', 0.15, 0, 0.05); }
  bulldoze() { this.noise(0.35, 0.45, 500); this.tone(90, 0.3, 'sawtooth', 0.12, -40); }
  error() { this.tone(220, 0.15, 'square', 0.12); this.tone(160, 0.2, 'square', 0.12, 0, 0.1); }
  milestone() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.22, 0, i * 0.11)); }
  chirp() { this.tone(1800, 0.05, 'sine', 0.08, 600); this.tone(2200, 0.05, 'sine', 0.06, 500, 0.07); }
  undo() { this.tone(500, 0.08, 'triangle', 0.15, -200); }
}
