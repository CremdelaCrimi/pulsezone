// PulseZone adaptive soundtrack + sound effects, synthesized live with Web Audio (no audio files).
//
// Music follows the game: tempo and layers rise with intensity, the colour follows your zone
// (icy bells below it, a bright arpeggio in it, driving hats above it), and a soft heartbeat
// thump plays at your real BPM.
//
// The synth plays one of several music sets (MUSIC_SETS), so different days sound different.

import { musicTempo, songTone, breakdownDue, BREAKDOWN_BARS, BREAKDOWN_EVERY } from './core.js?v59';

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
};

/**
 * Music sets for the live synth: plain data, one entry per set. Each named workout picks one, so
 * Tuesday doesn't sound like Thursday. The scheduler (playStep) reads everything here. The layer
 * rules (what comes in at which intensity, what each zone adds) are the same for every set, so the
 * music always tells you the same things; a set only changes the notes, the patterns and the sounds.
 *
 * scale    the one scale every note of the set belongs to (pitch classes, 0 = C). Nothing plays
 *          from it: test/audio.test.mjs checks every note below against it, and that no two notes
 *          sounding in the same bar sit a semitone apart.
 * chords   one row per bar, looped. All in Hz: `bass` (the root) and `fifth` for the bass line,
 *          `pad` (the three sustained voices), `lead` (the notes the in-zone pattern picks from)
 *          and `bell` (a below-zone bell picks one at random).
 * patterns 16 characters, one per sixteenth of the bar, '.' = rest:
 *            kick  x = hit, o = soft hit            clap  x = hit
 *            hat   x = soft, X = accent             bell  x = a bell may ring here (`chance`)
 *            bass  r = root, f = fifth, R = root an octave up; `len` = note length in sixteenths
 *            lead  0-9 = that note of the chord's lead list, * = all of them at once (a stab)
 * swing    how late the off-beat sixteenths arrive, as a fraction of a sixteenth (0 = straight).
 * gain     level trims against the night set (1 = the level the synth has always had). Never above
 *          1: the music sits under the call-outs and the sound effects.
 * The other numbers are the sounds themselves: oscillator shapes, filter settings (Hz) and envelope
 * times (seconds). `pad.detune` is in cents; `pad.tone` scales the zone filter (below 1 = darker).
 */
// Equal-tempered pitch from a MIDI note (69 = A4 = 440 Hz), and a chord row from MIDI notes:
// the lead plays the pad an octave up and the bells two octaves up, as the night set does.
const hz = (m) => Math.round(440 * 2 ** ((m - 69) / 12) * 100) / 100;
const chord = (name, root, fifth, pad) => ({ name, bass: hz(root), fifth: hz(fifth), pad: pad.map(hz), lead: pad.map((m) => hz(m + 12)), bell: pad.map((m) => hz(m + 24)) });

export const MUSIC_SETS = deepFreeze({
  // The synth as it has always been (v57 and earlier): A minor, Am - F - C - G, straight sixteenths.
  // Do not retune it: test/audio.test.mjs holds it to a recording of the v57 code.
  night: {
    name: 'Night',
    scale: { name: 'A minor', pitchClasses: [9, 11, 0, 2, 4, 5, 7] },
    swing: 0,
    chords: [ // lead = pad x 2 and bell = pad x 4, exactly as v57 worked them out
      { name: 'Am', bass: 110.0, fifth: 164.81, pad: [220.0, 261.63, 329.63], lead: [440.0, 523.26, 659.26], bell: [880.0, 1046.52, 1318.52] },
      { name: 'F', bass: 87.31, fifth: 130.81, pad: [174.61, 220.0, 261.63], lead: [349.22, 440.0, 523.26], bell: [698.44, 880.0, 1046.52] },
      { name: 'C', bass: 130.81, fifth: 196.0, pad: [261.63, 329.63, 392.0], lead: [523.26, 659.26, 784.0], bell: [1046.52, 1318.52, 1568.0] },
      { name: 'G', bass: 98.0, fifth: 146.83, pad: [196.0, 246.94, 293.66], lead: [392.0, 493.88, 587.32], bell: [784.0, 987.76, 1174.64] },
    ],
    pad: { detune: 7, tone: 1 },
    kick: { easy: 'x.......x.......', full: 'x...x...x...x...', from: 150, to: 45, sweep: 0.12, decay: 0.25, stop: 0.3 },
    clap: { steps: '....x.......x...', freq: 1800, q: 0.8, decay: 0.14 },
    hat: { base: 'x.X.x.X.x.X.x.X.', busy: 'xxXxxxXxxxXxxxXx', freq: 7500, q: 0.5, decay: 0.04 },
    bass: {
      easy: { steps: 'r...............', len: 14 },
      drive: { steps: 'r.r.r.r.r.r.r.r.', len: 1.8 },
      wave: 'sawtooth', cutoff: 250, open: 1400, q: 4,
    },
    lead: { steps: '0121012101210121', wave: 'triangle', decay: 0.14, stop: 0.2 },
    bell: { steps: 'x...x...x...x...', chance: 0.35, partials: [[1, 1], [2.76, 0.4], [5.4, 0.2]], ring: 1.2, stop: 1.4 },
    gain: { pad: 1, kick: 1, clap: 1, hat: 1, bass: 1, lead: 1, bell: 1 },
  },
  // Bright and airy (v58): D major, D - A - Bm - G, a light kick, off-beat hats, soft sine plucks, a little swing.
  harbour: {
    name: 'Harbour',
    scale: { name: 'D major', pitchClasses: [2, 4, 6, 7, 9, 11, 1] },
    swing: 0.08,
    chords: [chord('D', 50, 57, [62, 66, 69]), chord('A', 45, 52, [57, 61, 64]), chord('Bm', 47, 54, [59, 62, 66]), chord('G', 43, 50, [55, 59, 62])],
    pad: { detune: 5, tone: 0.9 },
    kick: { easy: 'x.......x.......', full: 'x.......x...x...', from: 120, to: 50, sweep: 0.1, decay: 0.2, stop: 0.25 },
    clap: { steps: '....x.......x...', freq: 2200, q: 0.7, decay: 0.1 },
    hat: { base: '..x...x...x...x.', busy: 'x.x.X.x.x.x.X.x.', freq: 8000, q: 0.5, decay: 0.035 },
    bass: {
      easy: { steps: 'r.......f.......', len: 7 },
      drive: { steps: 'r...r.f.r...r.f.', len: 1.8 },
      wave: 'triangle', cutoff: 400, open: 1200, q: 2,
    },
    lead: { steps: '0.1.2.1.0.2.1.2.', wave: 'sine', decay: 0.2, stop: 0.3 },
    bell: { steps: 'x.......x.......', chance: 0.3, partials: [[1, 1], [2, 0.3], [3, 0.15]], ring: 1.5, stop: 1.8 },
    gain: { pad: 0.9, kick: 0.8, clap: 0.6, hat: 0.8, bass: 0.9, lead: 0.7, bell: 0.9 },
  },
  // Driving (v58): E minor, Em - C - G - D, four-on-the-floor kick, a busy octave bass, square-wave lead.
  furnace: {
    name: 'Furnace',
    scale: { name: 'E minor', pitchClasses: [4, 6, 7, 9, 11, 0, 2] },
    swing: 0,
    chords: [chord('Em', 40, 47, [55, 59, 64]), chord('C', 48, 55, [55, 60, 64]), chord('G', 43, 50, [55, 59, 62]), chord('D', 50, 57, [57, 62, 66])],
    pad: { detune: 7, tone: 0.85 },
    kick: { easy: 'x.......x.......', full: 'x...x...x...x...', from: 160, to: 45, sweep: 0.1, decay: 0.22, stop: 0.3 },
    clap: { steps: '....x.......x...', freq: 1600, q: 0.9, decay: 0.12 },
    hat: { base: '..X...X...X...X.', busy: 'xxXxxxXxxxXxxxXx', freq: 7500, q: 0.5, decay: 0.04 },
    bass: {
      easy: { steps: 'r.......r.......', len: 6 },
      drive: { steps: 'r.R.r.f.r.R.r.f.', len: 1.8 },
      wave: 'sawtooth', cutoff: 220, open: 1400, q: 4,
    },
    lead: { steps: '0.0.1.0.2.0.1.0.', wave: 'square', decay: 0.1, stop: 0.15 },
    bell: { steps: 'x.......x.......', chance: 0.25, partials: [[1, 1], [2.76, 0.4], [5.4, 0.2]], ring: 1.0, stop: 1.2 },
    gain: { pad: 0.85, kick: 1, clap: 0.9, hat: 0.85, bass: 0.95, lead: 0.8, bell: 0.8 },
  },
  // Dark and broken (v58): D minor, Dm - Bb - F - C, a half-time feel (snare on beat 3), sparse stabs.
  storm: {
    name: 'Storm',
    scale: { name: 'D minor', pitchClasses: [2, 4, 5, 7, 9, 10, 0] },
    swing: 0.12,
    chords: [chord('Dm', 50, 57, [57, 62, 65]), chord('Bb', 46, 53, [58, 62, 65]), chord('F', 41, 48, [57, 60, 65]), chord('C', 48, 55, [55, 60, 64])],
    pad: { detune: 10, tone: 0.75 },
    kick: { easy: 'x.........x.....', full: 'x.....x...x.....', from: 140, to: 42, sweep: 0.14, decay: 0.28, stop: 0.32 },
    clap: { steps: '....x.......x...', freq: 1400, q: 1, decay: 0.18 },
    hat: { base: 'x..x..x..x..x.x.', busy: 'x.xXx.xXx.xXx.xX', freq: 6500, q: 0.6, decay: 0.05 },
    bass: {
      easy: { steps: 'r...............', len: 14 },
      drive: { steps: 'r..r..f.r..r..R.', len: 1.8 },
      wave: 'sawtooth', cutoff: 250, open: 1100, q: 3,
    },
    lead: { steps: '*.......*..*....', wave: 'sawtooth', decay: 0.12, stop: 0.18 },
    bell: { steps: '..x.......x.....', chance: 0.4, partials: [[1, 1], [2.4, 0.5], [4.1, 0.2]], ring: 1.6, stop: 1.9 },
    gain: { pad: 0.85, kick: 0.9, clap: 0.85, hat: 0.8, bass: 0.8, lead: 0.75, bell: 0.85 },
  },
});
const NIGHT = MUSIC_SETS.night;

// What the pattern letters mean in level terms.
const KICK_HIT = { x: 1, o: 0.6 };      // times the kick's intensity level
const HAT_HIT = { x: 0.09, X: 0.16 };

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
    this.setKey = 'night';     // the music set the synth is playing (a key of MUSIC_SETS)
    this.pendingSet = null;    // a set waiting for the next bar line
    this.setBar = 0;           // the bar the current set came in on (it starts from its first chord)
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
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; // globalThis: this file also loads in Node for the tests
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

    // Sustained pad, on the first chord of the current music set.
    const set = MUSIC_SETS[this.setKey];
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 600; this.padFilter.Q.value = 0.7;
    this.padGain = c.createGain(); this.padGain.gain.value = 0.0;
    this.padFilter.connect(this.padGain).connect(this.music);
    this.padOscs = [0, 1, 2].map((i) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = (i - 1) * set.pad.detune;
      o.frequency.value = set.chords[0].pad[i];
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
    // The song runs through a low-pass filter and a bass shelf so it changes with your zone:
    // muffled when you're well below, opening up as you climb, full and punchier in the zone.
    s.filter = this.ctx.createBiquadFilter();
    s.filter.type = 'lowpass'; s.filter.frequency.value = 18000; s.filter.Q.value = 0.5;
    s.shelf = this.ctx.createBiquadFilter();
    s.shelf.type = 'lowshelf'; s.shelf.frequency.value = 90; s.shelf.gain.value = 0;
    // High-pass for breakdowns: idles at 20 Hz (inaudible), rises to ~380 Hz to thin the song out.
    s.hp = this.ctx.createBiquadFilter();
    s.hp.type = 'highpass'; s.hp.frequency.value = 20; s.hp.Q.value = 0.7;
    s.node.connect(s.filter).connect(s.shelf).connect(s.hp).connect(s.gain).connect(this.music);
  }

  setMusicMode(mode) { this.musicMode = mode; this.playSong(); }

  /**
   * Pick the synth's music set: a key of MUSIC_SETS ('night', 'harbour', 'furnace', 'storm');
   * anything else means 'night'. The change comes in on the next bar line, so a bar is never cut in
   * half. Only the live synth changes: the recorded song is untouched, and the set is simply ready
   * for whenever the synth plays. Safe before the first gesture (no audio context yet).
   */
  setMusicSet(key) {
    const next = typeof key === 'string' && Object.prototype.hasOwnProperty.call(MUSIC_SETS, key) ? key : 'night';
    if (!this.ctx) { this.setKey = next; this.pendingSet = null; return; } // nothing is playing yet: no bar to wait for
    this.pendingSet = next === this.setKey ? null : next;
  }

  /** The set the synth is playing, or the one that comes in on the next bar. */
  get musicSet() { return this.pendingSet || this.setKey; }

  /** A waiting set comes in (called on a bar line): it starts on its first chord and the pad moves over. */
  enterSet(t) {
    this.setKey = this.pendingSet;
    this.pendingSet = null;
    this.setBar = Math.floor(this.step / 16);
    const set = MUSIC_SETS[this.setKey];
    // Also while the synth is silent (song playing, options open), so the pad never comes back on the old set's chord.
    this.padOscs.forEach((o, i) => {
      o.detune.setTargetAtTime((i - 1) * set.pad.detune, t, 0.15);
      o.frequency.setTargetAtTime(set.chords[0].pad[i], t, 0.15);
    });
  }

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
    const tone = songTone(this.state);
    // Breakdowns: count bars in song time (independent of the playback rate).
    const bar = Math.floor((s.el.currentTime - (s.loopStart || 0)) / (240 / s.bpm));
    if (s.lastBar != null && bar < s.lastBar) { this.dropIn(); s.lastBreakPeriod = -1; } // the song looped: start counting afresh
    s.lastBar = bar;
    if (on && !s.breakdown && !this.state.paused && breakdownDue(bar, s.lastBreakPeriod, this.state.status)) {
      s.breakdown = { until: bar + BREAKDOWN_BARS }; s.lastBreakPeriod = Math.floor(bar / BREAKDOWN_EVERY);
    }
    if (s.breakdown && (bar >= s.breakdown.until || ended || this.state.status !== 'InZone')) this.dropIn(); // leaving the zone or finishing ends it
    s.filter.frequency.setTargetAtTime(tone.cutoff, this.ctx.currentTime, 1.5);
    s.shelf.gain.setTargetAtTime(s.breakdown ? 0 : tone.bassDb, this.ctx.currentTime, s.breakdown ? 0.3 : 1.5);
    s.hp.frequency.setTargetAtTime(s.breakdown ? 380 : 20, this.ctx.currentTime, s.breakdown ? 0.25 : 0.03);
    // Retry now and then (works on desktop; on Quest the next gesture starts it, see unlock()).
    const t = this.ctx.currentTime;
    if (on && s.el.paused && t - (s.lastTry || 0) > 2) { s.lastTry = t; this.playSong(); }
    // Only pause for good at the end; pausing between moves would need another gesture to restart.
    if (ended && !s.el.paused && s.gain.gain.value < 0.02) s.el.pause();
    // How long the song has been wanted but silent (the game says so and the synth fills in).
    s.silentFor = on && !this.songLive ? (s.silentFor || 0) + (t - (s.lastDrive ?? t)) : 0;
    s.lastDrive = t;
  }

  /** End a song breakdown now: the full sound (bass and all) slams back in. */
  dropIn() {
    const s = this.song;
    if (!s?.breakdown) return;
    s.breakdown = null;
    if (s.hp) s.hp.frequency.setTargetAtTime(20, this.ctx.currentTime, 0.03);
    if (s.shelf) s.shelf.gain.setTargetAtTime(songTone(this.state).bassDb, this.ctx.currentTime, 0.05); // bass slams back too
  }

  /** Dip the music for a moment so a big hit lands harder (like sidechain compression). */
  duck(amount = 0.35, seconds = 0.12) {
    const c = this.ctx;
    if (!c || !this.music) return;
    const g = this.music.gain, t = c.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.55 * (1 - amount), t + 0.015);
    g.linearRampToValueAtTime(0.55, t + seconds);
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

    // Pad follows the zone colour (each music set can shade it a little darker).
    const set = MUSIC_SETS[this.setKey];
    const bright = s.status === 'InZone' ? 1500 : s.status === 'Above' || s.status === 'SafetyBrake' ? 2200 : 700;
    this.padFilter.frequency.setTargetAtTime((bright + 600 * this.smoothIntensity) * set.pad.tone, c.currentTime, 0.8);
    // The synth fills in whenever the song isn't actually playing, so there's never silence.
    const songMode = this.musicMode === 'song' && this.songLive;
    this.padGain.gain.setTargetAtTime(songMode ? 0 : (playing ? 0.05 : 0.025) * set.gain.pad, c.currentTime, 1.5);
    this.driveSong(playing, ended);

    const sixteenth = 60 / this.tempo / 4;
    if (this.nextStepTime < c.currentTime - 0.5) this.nextStepTime = c.currentTime + 0.05; // after a stall
    while (this.nextStepTime < c.currentTime + 0.12) {
      if (this.pendingSet && this.step % 16 === 0) this.enterSet(this.nextStepTime); // a new music set waits for the bar line
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

  /**
   * One sixteenth of the current music set. The layer rules below are the same for every set (and
   * are exactly what the synth always did); the set supplies the notes, the patterns and the sounds.
   */
  playStep(step, t, sixteenth) {
    const s = this.state;
    const k = this.smoothIntensity;
    const set = MUSIC_SETS[this.setKey], gain = set.gain;
    const inStep = step % 16;             // position in the bar
    const bar = Math.floor(step / 16) - this.setBar; // bars since this set came in
    const chord = set.chords[bar % set.chords.length];
    const brake = s.status === 'SafetyBrake';
    // Swing: the off-beat sixteenths arrive a little late. The bar line and the pad stay put.
    const at = set.swing && inStep % 2 ? t + set.swing * sixteenth : t;

    if (inStep === 0) chord.pad.forEach((f, i) => this.padOscs[i].frequency.setTargetAtTime(f, t, 0.15));

    // Kick: the set's full pattern (four on the floor in most), a lighter one when easy, off during the safety brake.
    const kick = KICK_HIT[(k > 0.2 ? set.kick.full : set.kick.easy)[inStep]];
    if (!brake && kick) this.kick(at, (0.7 + 0.3 * k) * kick * gain.kick, set.kick);
    // Clap on the backbeats (2 and 4).
    if (!brake && k > 0.3 && set.clap.steps[inStep] === 'x') this.clap(at, 0.35 * gain.clap, set.clap);
    // Hats: the base pattern, then the busy one when it's hard or you're above the zone.
    const hat = HAT_HIT[(k > 0.6 || s.status === 'Above' ? set.hat.busy : set.hat.base)[inStep]];
    if (!brake && k > 0.2 && hat) this.hat(at, hat * gain.hat, set.hat);
    // Bass: one long note a bar when easy, the set's driving line when harder.
    const line = k > 0.15 ? set.bass.drive : set.bass.easy;
    const note = line.steps[inStep];
    if (note !== '.') {
      const freq = note === 'r' ? chord.bass : note === 'f' ? chord.fifth : chord.bass * 2;
      this.bass(at, freq, sixteenth * line.len, k, 0.22 * gain.bass, set.bass);
    }
    // In the zone: the set's lead (a bright arpeggio, open plucks or chord stabs).
    if (s.status === 'InZone' && k > 0.25) {
      const pick = set.lead.steps[inStep];
      if (pick === '*') chord.lead.forEach((f) => this.pluck(at, f, 0.07 * gain.lead, set.lead));
      else if (pick !== '.') this.pluck(at, chord.lead[pick], 0.07 * gain.lead, set.lead);
    }
    // Below the zone: sparse icy bells.
    if (s.status === 'Below' && set.bell.steps[inStep] === 'x' && Math.random() < set.bell.chance) {
      this.bell(at, chord.bell[Math.floor(Math.random() * chord.bell.length)], 0.06 * gain.bell, set.bell);
    }
  }

  // ------------------------------------------------------------ instruments
  // Each takes its sound (`p`) from the music set; left out, it is the night set's.

  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  kick(t, vol, p = NIGHT.kick) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(p.from, t);
    o.frequency.exponentialRampToValueAtTime(p.to, t + p.sweep);
    this.env(g, t, vol, 0.002, p.decay);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + p.stop);
  }

  noiseHit(t, type, freq, q, vol, decay, dest = this.music) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    this.env(g, t, vol, 0.002, decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, decay + 0.05);
  }

  clap(t, vol, p = NIGHT.clap) { this.noiseHit(t, 'bandpass', p.freq, p.q, vol, p.decay); }

  hat(t, vol, p = NIGHT.hat) { this.noiseHit(t, 'highpass', p.freq, p.q, vol, p.decay); }

  bass(t, freq, dur, k, vol = 0.22, p = NIGHT.bass) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = p.wave; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = p.cutoff + p.open * k; f.Q.value = p.q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pluck(t, freq, vol, p = NIGHT.lead) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = p.wave; o.frequency.value = freq;
    this.env(g, t, vol, 0.003, p.decay);
    o.connect(g); g.connect(this.music); g.connect(this.echo);
    o.start(t); o.stop(t + p.stop);
  }

  bell(t, freq, vol, p = NIGHT.bell) {
    const c = this.ctx;
    for (const [mult, v] of p.partials) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = freq * mult;
      this.env(g, t, vol * v, 0.002, p.ring / mult);
      o.connect(g); g.connect(this.music); g.connect(this.echo);
      o.start(t); o.stop(t + p.stop);
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
      case 'power': { // power orb smashed (or slam bar): big boom + shatter, music ducks under it
        const p = opts.power ?? 1;
        this.duck(0.4, 0.16);
        this.dropIn(); // a breakdown slams back in on a big hit
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
        this.dropIn();
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
      case 'incoming': { // a bomb just locked on: a falling whistle from its side, so you know when to move
        const pan = c.createStereoPanner ? c.createStereoPanner() : null;
        if (pan) { pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0)); pan.connect(this.fx); setTimeout(() => pan.disconnect(), 600); }
        this.tone(t, 1900, 'sine', 0.1, 0.3, 850, pan || this.fx);
        break;
      }
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
      case 'streak': { // held the zone another 15 s (or a combo clear): a soft bell chord that climbs
        const up = Math.pow(2, Math.min(opts.level ?? 1, 8) / 12);
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(t + i * 0.03, f * up, 'sine', 0.09, 0.9));
        this.tone(t, 1567.98 * up, 'triangle', 0.05, 1.2);
        break;
      }
      case 'zone': // entered the zone: rising chime
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(t + i * 0.07, f, 'triangle', 0.15, 0.4));
        break;
      case 'reconnect': // phone heart rate is back: two rising tones
        this.tone(t, 660, 'sine', 0.15, 0.15); this.tone(t + 0.16, 990, 'sine', 0.15, 0.25);
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
