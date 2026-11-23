// Every sound is synthesised with Web Audio: no audio files.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = false;
    this.ready = false;
    this.tickAcc = 0.9;
    this.cricket = 3;
    this.gull = 9;
  }

  init() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      const master = this.master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
      const loopNoise = (type, freq, q) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(f);
        f.connect(g);
        g.connect(master);
        src.start();
        return { f, g };
      };
      this.wind = loopNoise('lowpass', 500, 0.5);
      this.hum = loopNoise('lowpass', 140, 0.6);
      this.chain = loopNoise('bandpass', 2300, 2.5);
      this.surf = loopNoise('lowpass', 520, 0.4);
      this.surf.g.gain.value = 0.03;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain);
      lfoGain.connect(this.surf.g.gain);
      lfo.start();
      this.ready = true;
      return true;
    } catch (err) {
      this.ctx = null;
      return false;
    }
  }

  setEnabled(on) {
    if (on && !this.init()) return false;
    this.enabled = on;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    return true;
  }

  /** s: { dt, speed (m/s), cadence (rad/s), coasting, night } */
  update(s) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const v = s.speed;
    const k = Math.min(1, v / 12.5);
    this.wind.g.gain.setTargetAtTime(k * k * 0.24, t, 0.12);
    this.wind.f.frequency.setTargetAtTime(380 + k * 1200, t, 0.12);
    this.hum.g.gain.setTargetAtTime(Math.min(0.16, v * 0.013), t, 0.1);
    this.chain.g.gain.setTargetAtTime(s.coasting ? 0 : Math.min(0.02, s.cadence * 0.0022), t, 0.06);
    // the freewheel ticks while coasting
    if (s.coasting && v > 0.4) {
      this.tickAcc += s.dt * v * 8.45;
      if (this.tickAcc >= 1) {
        this.tickAcc %= 1;
        this.noiseBurst({ type: 'bandpass', freq: 3600, q: 7, dur: 0.014, gain: 0.045 });
      }
    } else {
      this.tickAcc = 0.9;
    }
    this.cricket -= s.dt;
    if (this.cricket < 0) {
      this.cricket = 0.55 + Math.random() * 0.5;
      if (s.night > 0.5) this.chirp(s.night);
    }
    this.gull -= s.dt;
    if (this.gull < 0) {
      this.gull = 16 + Math.random() * 22;
      if (s.night < 0.5) this.cry();
    }
  }

  noiseBurst({ type, freq, q = 0.7, dur, gain, sweepTo }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  tone({ type, f0, f1, dur, gain, attack = 0.005, when = 0 }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A struck bell: inharmonic partials, rung twice. */
  bell() {
    if (!this.ready || !this.enabled) return;
    const f0 = 2300 * (0.96 + Math.random() * 0.08);
    for (const [ratio, amp, dec] of [[1, 0.22, 0.9], [2.76, 0.1, 0.5], [5.4, 0.05, 0.25], [1.19, 0.06, 0.3]]) {
      this.tone({ type: 'sine', f0: f0 * ratio, dur: dec, gain: amp, attack: 0.002 });
      this.tone({ type: 'sine', f0: f0 * ratio * 1.011, dur: dec * 0.8, gain: amp * 0.6, attack: 0.002, when: 0.13 });
    }
  }

  /** A nasal, complaining honk. */
  honk() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(950, t);
    f.frequency.exponentialRampToValueAtTime(620, t + dur);
    f.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    g.gain.setValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g);
    g.connect(this.master);
    for (const det of [0, 7, -5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(290 + det, t);
      osc.frequency.exponentialRampToValueAtTime(205 + det, t + dur * 0.7);
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }

  splash() {
    this.noiseBurst({ type: 'lowpass', freq: 3200, sweepTo: 420, dur: 0.4, gain: 0.16 });
  }

  cry() {
    for (let i = 0; i < 3; i++) this.tone({ type: 'triangle', f0: 1900, f1: 1250, dur: 0.32, gain: 0.022, when: i * 0.42 });
  }

  chirp(night) {
    for (let i = 0; i < 3; i++) this.tone({ type: 'sine', f0: 4300, dur: 0.035, gain: 0.02 * night, attack: 0.004, when: i * 0.085 });
  }
}
