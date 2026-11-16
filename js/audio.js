// PulseZone adaptive soundtrack + sound effects, synthesized live with Web Audio (no audio files).
//
// Music follows the game: tempo and layers rise with intensity, the colour follows your zone
// (icy bells below it, a bright arpeggio in it, driving hats above it), and a soft heartbeat
// thump plays at your real BPM.

import { musicTempo } from './core.js?v13';

const CHORDS = [
  // A minor - F - C - G, as [root Hz, chord tones Hz]
  [110.0, [220.0, 261.63, 329.63]],
  [87.31, [174.61, 220.0, 261.63]],
  [130.81, [261.63, 329.63, 392.0]],
  [98.0, [196.0, 246.94, 293.66]],
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.state = { intensity: 0.15, status: 'NoSignal', bpm: 0, phase: 'WarmUp', target: 120, paused: false };
    this.smoothIntensity = 0.15;
    this.smoothTempo = 100;
    this.volume = 0.8;
    this.musicMode = 'synth';  // 'synth' = generated live; 'song' = a recorded track, time-stretched
    this.song = null;          // { url, bpm, el, node, gain }
    this.step = 0;            // 16th-note counter
    this.nextStepTime = 0;
    this.nextBeatTime = 0;    // heartbeat
    this.timer = 0;
  }

  /**
   * Call from every user gesture (tap / click / key / Enter VR / controller trigger). Safe to call
   * repeatedly: it creates or resumes the audio context and starts the song inside the gesture,
   * because the Quest browser refuses to start media from a timer.
   */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 25);
    this.playSong();
  }

  /** Start the song element if it should be playing. Only reliable inside a user gesture. */
  playSong() {
    const s = this.song;
    if (!s?.el || !s.el.paused || this.musicMode !== 'song' || this.state.phase === 'Finished') return;
    s.el.play().then(() => { s.error = ''; }).catch((e) => { s.error = e?.name || 'blocked'; });
  }

  /** True once the song is actually producing sound (not blocked, loading or stalled). */
  get songLive() {
    const el = this.song?.el;
    return !!el && !el.paused && el.readyState >= 3;
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);

    this.music = c.createGain(); this.music.gain.value = 0.55; this.music.connect(this.master);
    this.fx = c.createGain(); this.fx.gain.value = 0.9; this.fx.connect(this.master);

    // Echo send for bells / arp.
    this.echo = c.createDelay(1.0);
    this.echoFb = c.createGain(); this.echoFb.gain.value = 0.35;
    this.echoOut = c.createGain(); this.echoOut.gain.value = 0.35;
    this.echo.connect(this.echoFb).connect(this.echo);
    this.echo.connect(this.echoOut).connect(this.music);

    // One second of white noise, reused for drums and whooshes.
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Sustained pad.
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 600; this.padFilter.Q.value = 0.7;
    this.padGain = c.createGain(); this.padGain.gain.value = 0.0;
    this.padFilter.connect(this.padGain).connect(this.music);
    this.padOscs = [0, 1, 2].map((i) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = (i - 1) * 7;
      o.frequency.value = CHORDS[0][1][i];
      o.connect(this.padFilter);
      o.start();
      return o;
    });
    this.nextStepTime = c.currentTime + 0.1;
    this.nextBeatTime = c.currentTime + 0.5;
    if (this.song) this.attachSong();
  }

  /**
   * Use a recorded song (made at `bpm`) instead of the live synth music. The song is sped up or
   * slowed down to the same pacing tempo, with pitch preserved, so it never sounds chipmunky.
   */
  setSong(url, bpm = 120, loopStart = 0, loopEnd = 0) {
    this.song = { url, bpm, loopStart, loopEnd };
    if (this.ctx) this.attachSong();
  }

  attachSong() {
    const s = this.song;
    if (!s || s.el) return;
    const el = new Audio();
    el.src = s.url;
    el.loop = !s.loopEnd;          // with loop points we jump back ourselves (bar-aligned, skips intro/outro)
    el.preload = 'auto';
    el.addEventListener('ended', () => { el.currentTime = s.loopStart; el.play().catch(() => {}); });
    el.addEventListener('error', () => { s.error = 'load failed'; });
    el.preservesPitch = true;
    el.webkitPreservesPitch = true;
    s.el = el;
    s.node = this.ctx.createMediaElementSource(el);
    s.gain = this.ctx.createGain();
    s.gain.gain.value = 0;
    s.node.connect(s.gain).connect(this.music);
  }

  setMusicMode(mode) { this.musicMode = mode; this.playSong(); }

  /** Keep the song's speed and volume in step with the game (called from the scheduler). */
  driveSong(playing, ended) {
    const s = this.song;
    if (!s?.el) return;
    const on = this.musicMode === 'song' && playing;
    // Playback rate between 0.78x and 1.25x keeps time-stretching clean.
    const rate = Math.min(1.25, Math.max(0.78, this.smoothTempo / s.bpm));
    if (Math.abs(s.el.playbackRate - rate) > 0.004) s.el.playbackRate = rate;
    // Bar-aligned loop: jump back by exactly the loop length so the beat carries straight through.
    if (s.loopEnd && s.el.currentTime >= s.loopEnd) s.el.currentTime = s.loopStart + (s.el.currentTime - s.loopEnd);
    s.gain.gain.setTargetAtTime(on ? 1.6 : 0, this.ctx.currentTime, on ? 0.4 : 0.25);
    // Retry now and then (works on desktop; on Quest the next gesture starts it, see unlock()).
    const t = this.ctx.currentTime;
    if (on && s.el.paused && t - (s.lastTry || 0) > 2) { s.lastTry = t; this.playSong(); }
    // Only pause for good at the end; pausing between moves would need another gesture to restart.
    if (ended && !s.el.paused && s.gain.gain.value < 0.02) s.el.pause();
    // How long the song has been wanted but silent (the game says so and the synth fills in).
    s.silentFor = on && !this.songLive ? (s.silentFor || 0) + (t - (s.lastDrive ?? t)) : 0;
    s.lastDrive = t;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.1);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
  }

  /** Feed the current game state every frame. */
  update(state) { Object.assign(this.state, state); }

  /** Song tempo leads you: faster when you need to pick it up, slower when you need to ease off. */
  get tempo() { return this.smoothTempo; }

  // ------------------------------------------------------------ scheduler

  /**
   * Runs from a 25 ms timer and also from the game's frame loop (timers can be slowed down while
   * the headset is in VR). Everything is based on the audio clock, so extra calls are harmless.
   */
  schedule() {
    const c = this.ctx;
    if (!c) return;
    if (c.state !== 'running') {
      const now = performance.now();
      if (now - (this.lastResume || 0) > 2000) { this.lastResume = now; c.resume().catch(() => {}); }
      return;
    }
    const s = this.state;
    const dt = Math.min(0.25, Math.max(0, c.currentTime - (this.lastSchedule ?? c.currentTime)));
    this.lastSchedule = c.currentTime;
    this.smoothIntensity += (s.intensity - this.smoothIntensity) * (1 - Math.exp(-dt / 1.25));
    // Glide to the new tempo over a few seconds so the beat never lurches.
    this.smoothTempo += (musicTempo({ ...s, intensity: this.smoothIntensity }) - this.smoothTempo) * (1 - Math.exp(-dt / 2.1));
    const ended = s.phase === 'Finished';
    const playing = !ended && !s.paused;   // paused (options open): the song keeps running silently

    // Pad follows the zone colour.
    const bright = s.status === 'InZone' ? 1500 : s.status === 'Above' || s.status === 'SafetyBrake' ? 2200 : 700;
    this.padFilter.frequency.setTargetAtTime(bright + 600 * this.smoothIntensity, c.currentTime, 0.8);
    // The synth fills in whenever the song isn't actually playing, so there's never silence.
    const songMode = this.musicMode === 'song' && this.songLive;
    this.padGain.gain.setTargetAtTime(songMode ? 0 : playing ? 0.05 : 0.025, c.currentTime, 1.5);
    this.driveSong(playing, ended);

    const sixteenth = 60 / this.tempo / 4;
    if (this.nextStepTime < c.currentTime - 0.5) this.nextStepTime = c.currentTime + 0.05; // after a stall
    while (this.nextStepTime < c.currentTime + 0.12) {
      if (playing && !songMode) this.playStep(this.step, this.nextStepTime, sixteenth);
      this.nextStepTime += sixteenth;
      this.step++;
    }

    // Heartbeat at the real BPM (lub-dub), quiet; louder when the safety brake is on.
    if (s.bpm >= 35 && s.status !== 'NoSignal') {
      if (this.nextBeatTime < c.currentTime - 0.5) this.nextBeatTime = c.currentTime + 0.05;
      while (this.nextBeatTime < c.currentTime + 0.12) {
        const vol = s.status === 'SafetyBrake' ? 0.5 : 0.18;
        this.thump(this.nextBeatTime, vol);
        this.thump(this.nextBeatTime + 0.13, vol * 0.6);
        this.nextBeatTime += 60 / s.bpm;
      }
    } else {
      this.nextBeatTime = c.currentTime + 0.5;
    }
  }

  playStep(step, t, sixteenth) {
    const s = this.state;
    const k = this.smoothIntensity;
    const inStep = step % 16;             // position in the bar
    const bar = Math.floor(step / 16);
    const [root, chord] = CHORDS[bar % CHORDS.length];
    const brake = s.status === 'SafetyBrake';

    if (inStep === 0) chord.forEach((f, i) => this.padOscs[i].frequency.setTargetAtTime(f, t, 0.15));

    // Kick: four on the floor, half-time when easy, off during the safety brake.
    if (!brake && inStep % 4 === 0 && (k > 0.2 || inStep % 8 === 0)) this.kick(t, 0.7 + 0.3 * k);
    // Clap on 2 and 4.
    if (!brake && k > 0.3 && (inStep === 4 || inStep === 12)) this.clap(t, 0.35);
    // Hats: 8ths, then 16ths when it's hard or you're above the zone.
    const sixteenths = k > 0.6 || s.status === 'Above';
    if (!brake && k > 0.2 && (sixteenths || inStep % 2 === 0)) this.hat(t, inStep % 4 === 2 ? 0.16 : 0.09);
    // Bass: whole notes when easy, driving 8ths when harder.
    if (k > 0.15 ? inStep % 2 === 0 : inStep === 0) this.bass(t, root, k > 0.15 ? sixteenth * 1.8 : sixteenth * 14, k);
    // In the zone: a bright 16th-note arpeggio.
    if (s.status === 'InZone' && k > 0.25) {
      const notes = [chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[1] * 2];
      this.pluck(t, notes[inStep % 4], 0.07);
    }
    // Below the zone: sparse icy bells.
    if (s.status === 'Below' && inStep % 4 === 0 && Math.random() < 0.35) {
      this.bell(t, chord[Math.floor(Math.random() * 3)] * 4, 0.06);
    }
  }

  // ------------------------------------------------------------ instruments

  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  kick(t, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    this.env(g, t, vol, 0.002, 0.25);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + 0.3);
  }

  noiseHit(t, type, freq, q, vol, decay, dest = this.music) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    this.env(g, t, vol, 0.002, decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, decay + 0.05);
  }

  clap(t, vol) { this.noiseHit(t, 'bandpass', 1800, 0.8, vol, 0.14); }

  hat(t, vol) { this.noiseHit(t, 'highpass', 7500, 0.5, vol, 0.04); }

  bass(t, freq, dur, k) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = 250 + 1400 * k; f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pluck(t, freq, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    this.env(g, t, vol, 0.003, 0.14);
    o.connect(g); g.connect(this.music); g.connect(this.echo);
    o.start(t); o.stop(t + 0.2);
  }

  bell(t, freq, vol) {
    const c = this.ctx;
    for (const [mult, v] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = freq * mult;
      this.env(g, t, vol * v, 0.002, 1.2 / mult);
      o.connect(g); g.connect(this.music); g.connect(this.echo);
      o.start(t); o.stop(t + 1.4);
    }
  }

  thump(t, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    this.env(g, t, vol, 0.005, 0.14);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + 0.2);
  }

  tone(t, freq, type, vol, decay, glideTo, dest = this.fx) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
    this.env(g, t, vol, 0.003, decay);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + decay + 0.05);
  }

  // ------------------------------------------------------------ sound effects

  sfx(name, opts = {}) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + 0.005;
    switch (name) {
      case 'hit': { // punchy thwack, pitched by hand; harder punches add a bass thump and a crack
        const base = opts.hand === 'left' ? 520 : 660;
        const p = opts.power ?? 0.5;
        if (p < 0.3) { // soft punch: hollow thud
          this.noiseHit(t, 'lowpass', 700, 0.8, 0.45, 0.08, this.fx);
          this.tone(t, 180, 'sine', 0.18, 0.1, 120);
          break;
        }
        this.noiseHit(t, 'bandpass', 2500, 1.2, 0.35 + 0.3 * p, 0.06, this.fx);
        this.tone(t, base, 'square', 0.1 + 0.05 * p, 0.09, base * 1.5);
        this.tone(t, 130, 'sine', 0.35 * p, 0.14 + 0.08 * p, 45);                 // bass thump
        if (p > 0.6) this.noiseHit(t, 'highpass', 4500, 0.7, 0.35 * p, 0.12, this.fx); // glassy crack
        break;
      }
      case 'power': { // power orb smashed: big boom + shatter
        const p = opts.power ?? 1;
        this.tone(t, 110, 'sine', 0.5, 0.35, 38);
        this.tone(t, 70, 'triangle', 0.3, 0.3, 35);
        this.noiseHit(t, 'highpass', 3500, 0.6, 0.45, 0.25, this.fx);
        this.noiseHit(t + 0.02, 'bandpass', 6000, 2, 0.3 * p, 0.3, this.fx);
        [1046.5, 1568].forEach((f, i) => this.tone(t + 0.04 + i * 0.05, f, 'triangle', 0.1, 0.25));
        break;
      }
      case 'bag': { // speed bag tap: tight and quick
        this.noiseHit(t, 'bandpass', 1800, 2.5, 0.4, 0.04, this.fx);
        this.tone(t, opts.hand === 'left' ? 240 : 280, 'sine', 0.22, 0.06, 140);
        break;
      }
      case 'block': // guard shot blocked: deep thunk + metallic ring
        this.noiseHit(t, 'lowpass', 900, 0.8, 0.6, 0.12, this.fx);
        this.tone(t, 95, 'sine', 0.45, 0.22, 55);
        this.tone(t, 740, 'triangle', 0.1, 0.35, 700);
        break;
      case 'burst': // a speed bag / battle ropes is coming: two quick rising blips
        this.tone(t, 660, 'square', 0.12, 0.08, 990);
        this.tone(t + 0.12, 880, 'square', 0.12, 0.1, 1320);
        break;
      case 'perfect': // followed the swing curve: punchy hit plus a bright rising sparkle
        this.noiseHit(t, 'bandpass', 2500, 1.2, 0.5, 0.06, this.fx);
        [784, 1046.5, 1318.5].forEach((f, i) => this.tone(t + i * 0.045, f, 'triangle', 0.13, 0.22));
        break;
      case 'weak': this.tone(t, 160, 'triangle', 0.2, 0.12, 110); break;
      case 'wrong': this.tone(t, 140, 'sawtooth', 0.12, 0.18); this.tone(t + 0.09, 120, 'sawtooth', 0.12, 0.18); break;
      case 'miss': this.tone(t, 300, 'sine', 0.08, 0.2, 200); break;
      case 'wall': // you clipped a wall
        this.noiseHit(t, 'lowpass', 400, 0.7, 0.8, 0.3, this.fx);
        this.tone(t, 90, 'square', 0.25, 0.25, 50);
        break;
      case 'dodge': { // whoosh
        const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        src.buffer = this.noise;
        f.type = 'bandpass'; f.Q.value = 1.5;
        f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.25);
        this.env(g, t, 0.35, 0.05, 0.25);
        src.connect(f).connect(g).connect(this.fx);
        src.start(t, 0, 0.35);
        break;
      }
      case 'streak': { // held the zone another 15 s: a soft bell chord that climbs with the streak
        const up = Math.pow(2, Math.min(opts.level ?? 1, 8) / 12);
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(t + i * 0.03, f * up, 'sine', 0.09, 0.9));
        this.tone(t, 1567.98 * up, 'triangle', 0.05, 1.2);
        break;
      }
      case 'zone': // entered the zone: rising chime
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(t + i * 0.07, f, 'triangle', 0.15, 0.4));
        break;
      case 'alert': // phone lost
        this.tone(t, 880, 'sine', 0.18, 0.15); this.tone(t + 0.2, 660, 'sine', 0.18, 0.25);
        break;
      case 'finish':
        [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(t + i * 0.1, f, 'triangle', 0.16, 0.6));
        break;
      default: break;
    }
  }
}
