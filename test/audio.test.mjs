// Music-set checks for js/audio.js: the live synth's sets (night, harbour, furnace, storm).
// Run:  node test/audio.test.mjs     (exit code 0 = all passed)
//
// No browser here and nobody listening, so the checks go by the book:
//   - the data is complete, in tune and in key (every note in the set's scale, no semitone clashes);
//   - the patterns stay as light as the night set's (a pace-keeper, not a distraction), and no louder;
//   - 'night' is still the v57 synth, held two ways: step by step against the v57 scheduling rules
//     written out below, and call by call against a recording of the v57 file itself (a digest of
//     every Web Audio call it made over a scripted workout, sound effects included);
//   - setMusicSet falls back to 'night', waits for the bar line and leaves the recorded song alone.
// A recording stand-in replaces the Web Audio context; it throws where a browser would.
//
// To re-make or cross-check the v57 recording against any other build of audio.js:
//   git show e983ba8:js/audio.js > <dir>/audio.js      (with a copy of js/core.js next to it)
//   node test/audio.test.mjs --ref=<dir>/audio.js      (prints its digest and the first difference)
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AudioEngine, MUSIC_SETS } from '../js/audio.js';

let failures = 0;
const check = (ok, what) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`);
  if (!ok) failures++;
};
/** Run `fn`; a throw is a failed check (with the message) instead of a crashed test run. */
const attempt = (what, fn) => {
  try { return fn(); } catch (e) { check(false, `${what}: threw ${e?.message || e}`); return undefined; }
};

const KEYS = ['night', 'harbour', 'furnace', 'storm'];
const NEW_KEYS = KEYS.slice(1);
const LANES = ['kick', 'clap', 'hat', 'bass', 'pluck', 'bell'];
const STATUSES = ['NoSignal', 'Below', 'InZone', 'Above', 'SafetyBrake'];
// Intensities on both sides of every layer threshold (0.15 bass, 0.2 kick and hats, 0.25 lead, 0.3 clap, 0.6 busy hats).
const LEVELS = [0, 0.1, 0.15, 0.16, 0.2, 0.21, 0.25, 0.26, 0.3, 0.31, 0.45, 0.6, 0.61, 0.8, 1];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Seeded stand-in for Math.random, so two runs can be compared call for call.
const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const withRandom = (random, fn) => {
  const real = Math.random;
  Math.random = random;
  try { return fn(); } finally { Math.random = real; }
};

// ---------------------------------------------------------------- a recording stand-in for Web Audio

const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];

class FakeParam {
  constructor(ctx, node, name, value) { this.ctx = ctx; this.node = node; this.name = name; this.id = `${node.id}.${name}`; this.v = value; }
  seen(v) { this.v = v; this.ctx.heard(this, v); }
  get value() { return this.v; }
  set value(v) { this.ctx.num(v, this.id); this.ctx.note(`${this.id} = ${v}`); this.seen(v); }
  auto(call, v, t, ...more) {
    this.ctx.num(v, `${this.id}.${call} value`); this.ctx.time(t, `${this.id}.${call} time`);
    this.ctx.note(`${this.id}.${call}(${[v, t, ...more].join(', ')})`);
    this.seen(v);
    return this;
  }
  setValueAtTime(v, t) { return this.auto('setValueAtTime', v, t); }
  linearRampToValueAtTime(v, t) { return this.auto('linearRampToValueAtTime', v, t); }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0)) throw new RangeError(`${this.id}: exponential ramp to ${v}`); // a browser throws on 0
    return this.auto('exponentialRampToValueAtTime', v, t);
  }
  setTargetAtTime(v, t, tau) {
    this.ctx.num(tau, `${this.id}.setTargetAtTime time constant`);
    if (tau < 0) throw new RangeError(`${this.id}: negative time constant`);
    return this.auto('setTargetAtTime', v, t, tau);
  }
  cancelScheduledValues(t) { this.ctx.time(t, `${this.id}.cancelScheduledValues`); this.ctx.note(`${this.id}.cancelScheduledValues(${t})`); return this; }
}

class FakeNode {
  constructor(ctx, kind, params = {}) {
    this.ctx = ctx; this.kind = kind; this.id = `${kind}${ctx.made++}`;
    ctx.note(`new ${this.id}`);
    for (const [name, value] of Object.entries(params)) this[name] = new FakeParam(ctx, this, name, value);
  }
  connect(dest) {
    if (!(dest instanceof FakeNode || dest instanceof FakeParam) || dest.ctx !== this.ctx) throw new TypeError(`${this.id}: connect to a non-node`);
    this.ctx.note(`${this.id} -> ${dest.id}`);
    return dest;
  }
  disconnect() { /* only the 'incoming' whistle's panner, from a timer, long after the recording */ }
}

class FakeSource extends FakeNode { // oscillators and noise players: start once, stop after
  start(when = 0, offset, duration) {
    const args = [when, offset, duration].filter((x) => x !== undefined);
    args.forEach((x) => this.ctx.time(x, `${this.id}.start`));
    if (this.startedAt !== undefined) throw new Error(`${this.id}: started twice`);
    if (this.kind === 'noise' && !this.buffer) throw new Error(`${this.id}: started with no buffer`);
    this.startedAt = when;
    this.ctx.note(`${this.id}.start(${args.join(', ')})`);
  }
  stop(when = 0) {
    this.ctx.time(when, `${this.id}.stop`);
    if (this.startedAt === undefined) throw new Error(`${this.id}: stopped before it started`);
    if (when < this.startedAt) this.ctx.problems.push(`${this.id}: stops before it starts`);
    this.ctx.note(`${this.id}.stop(${when})`);
  }
}

class FakeOsc extends FakeSource {
  constructor(ctx) { super(ctx, 'osc', { frequency: 440, detune: 0 }); this.shape = 'sine'; }
  get type() { return this.shape; }
  set type(v) {
    if (!OSC_TYPES.includes(v)) throw new TypeError(`${this.id}: oscillator type ${v}`); // (a browser silently ignores it: the wrong sound)
    this.shape = v; this.ctx.note(`${this.id}.type = ${v}`);
  }
}

class FakeFilter extends FakeNode {
  constructor(ctx) { super(ctx, 'filter', { frequency: 350, Q: 1, gain: 0, detune: 0 }); this.shape = 'lowpass'; }
  get type() { return this.shape; }
  set type(v) {
    if (!FILTER_TYPES.includes(v)) throw new TypeError(`${this.id}: filter type ${v}`);
    this.shape = v; this.ctx.note(`${this.id}.type = ${v}`);
  }
}

class FakeContext {
  constructor() {
    this.currentTime = 0; this.state = 'running'; this.sampleRate = 48000;
    this.made = 0; this.lines = []; this.problems = [];
    this.oscHz = []; this.filterHz = []; this.peak = 0;
    this.destination = new FakeNode(this, 'out');
  }
  note(line) { this.lines.push(line); }
  num(x, what) { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${what}: ${x} is not a finite number`); }
  time(x, what) { this.num(x, what); if (x < 0) throw new RangeError(`${what}: negative time ${x}`); }
  heard(param, v) { // every value an oscillator or filter frequency, or a gain, is ever sent to
    if (param.name === 'frequency') (param.node.kind === 'osc' ? this.oscHz : this.filterHz).push(v);
    if (param.name === 'gain' && param.node.kind === 'gain') this.peak = Math.max(this.peak, Math.abs(v));
  }
  createGain() { return new FakeNode(this, 'gain', { gain: 1 }); }
  createOscillator() { return new FakeOsc(this); }
  createBiquadFilter() { return new FakeFilter(this); }
  createDelay(max = 1) { this.num(max, 'createDelay'); return new FakeNode(this, 'delay', { delayTime: 0 }); }
  createDynamicsCompressor() { return new FakeNode(this, 'comp', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }); }
  createStereoPanner() { return new FakeNode(this, 'pan', { pan: 0 }); }
  createMediaElementSource() { return new FakeNode(this, 'media'); }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length);
    return { length, sampleRate: rate, numberOfChannels: channels, getChannelData: () => data };
  }
  createBufferSource() { return new FakeSource(this, 'noise'); }
  resume() { return Promise.resolve(); }
}

/** An engine on the stand-in context, as unlock() would leave it (minus the timer). */
function boot(Engine = AudioEngine, setKey) {
  const a = new Engine();
  if (setKey) a.setMusicSet(setKey);
  a.ctx = new FakeContext();
  a.build();
  return a;
}
/** Let the 25 ms scheduler timer run for `seconds` on the stand-in clock, feeding `state` like the game does. */
function play(a, seconds, state) {
  const c = a.ctx;
  c.tick = c.tick || 0;
  for (let n = Math.round(seconds / 0.025); n > 0; n--) {
    c.currentTime = ++c.tick * 0.025;
    a.update(state);
    a.schedule();
  }
}

// A workout in miniature: every layer threshold is crossed both ways, every zone status is visited,
// with a pause, a finish and every sound effect along the way.
const at = (intensity, status, bpm, more = {}) => ({ intensity, status, bpm, phase: 'Training', target: 125, paused: false, ...more });
const WORKOUT = [
  [6, at(0.1, 'NoSignal', 0, { phase: 'WarmUp', target: 100 })],   // long bass note, light kick
  [8, at(0.18, 'Below', 88, { phase: 'WarmUp', target: 100 })],    // the bass line drives, bells
  [8, at(0.23, 'Below', 96)],                                     // full kick, hats
  [8, at(0.28, 'InZone', 124)],                                   // the lead comes in
  [10, at(0.45, 'InZone', 126)],                                  // claps
  [10, at(0.8, 'InZone', 128)],                                   // busy hats
  [8, at(0.5, 'Above', 140)],                                     // above the zone: busy hats, slower
  [6, at(0.5, 'SafetyBrake', 165)],                               // no drums, loud heartbeat
  [6, at(0.6, 'Below', 100)],
  [4, at(0.6, 'InZone', 125, { paused: true })],                  // options open: nothing sounds
  [6, at(0.3, 'Below', 110, { phase: 'CoolDown' })],
  [3, at(0.1, 'InZone', 100, { phase: 'Finished' })],
];
const EFFECTS = [
  ['hit', { hand: 'left', power: 0.2 }], ['hit', { hand: 'right', power: 0.5 }], ['hit', { hand: 'left', power: 0.9 }], ['hit'],
  ['power', { power: 1 }], ['power'], ['bag', { hand: 'left' }], ['bag'], ['block'], ['burst'], ['perfect'], ['weak'], ['wrong'],
  ['miss'], ['wall'], ['incoming', { pan: -0.7 }], ['dodge'], ['streak', { level: 3 }], ['streak'], ['zone'], ['reconnect'],
  ['alert'], ['finish'], ['no-such-effect'],
];
/** Play WORKOUT in one set from a cold start; returns the context (its `lines` are every Web Audio call made). */
function playWorkout(Engine, setKey, seed = 57) {
  return withRandom(mulberry32(seed), () => {
    const a = boot(Engine, setKey);
    let fx = 0;
    WORKOUT.forEach(([seconds, state], i) => {
      play(a, seconds / 2, state);
      // A couple of sound effects and a control mid-way through each stretch, as the game would.
      for (let n = 0; n < 2; n++, fx++) a.sfx(...EFFECTS[fx % EFFECTS.length]);
      if (i === 3) a.duck();
      if (i === 5) a.duck(0.5, 2.3);
      if (i === 6) a.dropIn();
      if (i === 7) a.setVolume(0.6);
      if (i === 8) { a.setEnabled(false); a.setEnabled(true); }
      play(a, seconds / 2, state);
    });
    return a.ctx;
  });
}
const digest = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');

// ---------------------------------------------------------------- instrument-level recording

/**
 * Call playStep directly for `bars` bars with the layer intensity pinned to `k`, recording what it asks
 * the instruments for instead of sounding it: [{ lane, step, args }]. No audio context involved.
 */
function recordSteps(setKey, status, k, bars = 4, tempo = 117) {
  const a = new AudioEngine();
  a.setMusicSet(setKey);
  const calls = [];
  let step = 0;
  for (const lane of LANES) a[lane] = (...args) => { calls.push({ lane, step, args }); };
  a.padOscs = [0, 1, 2].map((i) => ({ frequency: { setTargetAtTime: (...args) => { calls.push({ lane: 'pad', step, args: [i, ...args] }); } } }));
  a.update({ status, intensity: k, bpm: 120, target: 125 });
  a.smoothIntensity = k;
  const sixteenth = 60 / tempo / 4;
  for (; step < bars * 16; step++) a.playStep(step, 10 + step * sixteenth, sixteenth);
  return calls;
}
const perBar = (calls, lane, bars = 4) => {
  const n = new Array(bars).fill(0);
  calls.forEach((c) => { if (!lane || c.lane === lane) n[Math.floor(c.step / 16)]++; });
  return n;
};
/** The pitched notes in a recording: [{ lane, hz }] (bass, lead and bell notes, and the pad's retunes). */
const notesOf = (calls) => calls.flatMap((c) => (c.lane === 'pad' ? [{ lane: 'pad', hz: c.args[1] }]
  : ['bass', 'pluck', 'bell'].includes(c.lane) ? [{ lane: c.lane, hz: c.args[1] }] : []));

// ---------------------------------------------------------------- pitch helpers

const semis = (hz) => 12 * Math.log2(hz / 440) + 69;            // MIDI note number, fractional
const pitchClass = (hz) => ((Math.round(semis(hz)) % 12) + 12) % 12;
const centsOff = (hz) => Math.abs(semis(hz) - Math.round(semis(hz))) * 100;
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const rowNotes = (ch) => [ch.bass, ch.fifth, ch.bass * 2, ...ch.pad, ...ch.lead, ...ch.bell];

// ================================================================= the checks

console.log('\n== the sets');
check(same(Object.keys(MUSIC_SETS), KEYS), `MUSIC_SETS has exactly ${KEYS.join(', ')}`);
check(Object.isFrozen(MUSIC_SETS) && KEYS.every((key) => Object.isFrozen(MUSIC_SETS[key]) && Object.isFrozen(MUSIC_SETS[key].chords[0].pad)),
  'the data is frozen: nothing can retune a set at run time');

// Every field the scheduler and the instruments read, with the kind of value it must hold.
const num = (lo, hi) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const pattern = (letters) => (v) => typeof v === 'string' && new RegExp(`^[${letters}.]{16}$`).test(v);
const hzList = (min, max) => (v) => Array.isArray(v) && v.length >= min && v.length <= max && v.every(num(30, 5000));
const FIELDS = {
  name: (v) => typeof v === 'string' && v.length > 0,
  'scale.name': (v) => typeof v === 'string' && v.length > 0,
  'scale.pitchClasses': (v) => Array.isArray(v) && v.length >= 5 && v.length <= 7 && new Set(v).size === v.length && v.every((p) => Number.isInteger(p) && p >= 0 && p < 12),
  swing: num(0, 0.34),
  chords: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 16,
  'pad.detune': num(0, 15), 'pad.tone': num(0.5, 1),
  'kick.easy': pattern('xo'), 'kick.full': pattern('xo'),
  'kick.from': num(60, 300), 'kick.to': num(30, 100), 'kick.sweep': num(0.02, 0.3), 'kick.decay': num(0.05, 0.4), 'kick.stop': num(0.05, 0.6),
  'clap.steps': pattern('x'), 'clap.freq': num(500, 5000), 'clap.q': num(0.3, 5), 'clap.decay': num(0.02, 0.3),
  'hat.base': pattern('xX'), 'hat.busy': pattern('xX'), 'hat.freq': num(3000, 12000), 'hat.q': num(0.3, 5), 'hat.decay': num(0.01, 0.12),
  'bass.easy.steps': pattern('rfR'), 'bass.easy.len': num(0.5, 15), 'bass.drive.steps': pattern('rfR'), 'bass.drive.len': num(0.5, 15),
  'bass.wave': (v) => OSC_TYPES.includes(v), 'bass.cutoff': num(100, 1000), 'bass.open': num(0, 3000), 'bass.q': num(0, 8),
  'lead.steps': pattern('0-9*'), 'lead.wave': (v) => OSC_TYPES.includes(v), 'lead.decay': num(0.05, 0.6), 'lead.stop': num(0.05, 0.8),
  'bell.steps': pattern('x'), 'bell.chance': num(0, 1), 'bell.ring': num(0.2, 2), 'bell.stop': num(0.2, 2.5),
  'bell.partials': (v) => Array.isArray(v) && v.length >= 1 && v.length <= 4 && v.every((p) => Array.isArray(p) && p.length === 2 && num(1, 8)(p[0]) && num(0.01, 1)(p[1])),
  'gain.pad': num(0.3, 1), 'gain.kick': num(0.3, 1), 'gain.clap': num(0.3, 1), 'gain.hat': num(0.3, 1), 'gain.bass': num(0.3, 1), 'gain.lead': num(0.3, 1), 'gain.bell': num(0.3, 1),
};
const CHORD_FIELDS = { name: (v) => typeof v === 'string' && v.length > 0, bass: num(55, 200), fifth: num(55, 300), pad: hzList(3, 3), lead: hzList(3, 10), bell: hzList(1, 6) };
const dig = (o, path) => path.split('.').reduce((v, key) => (v == null ? undefined : v[key]), o);
for (const key of KEYS) {
  const set = MUSIC_SETS[key] || {};
  const bad = Object.entries(FIELDS).filter(([path, ok]) => !ok(dig(set, path))).map(([path]) => path);
  (set.chords || []).forEach((ch, i) => Object.entries(CHORD_FIELDS).forEach(([f, ok]) => { if (!ok(ch[f])) bad.push(`chords[${i}].${f}`); }));
  check(bad.length === 0, `${key}: every field the scheduler reads is there and sane${bad.length ? ` (bad: ${bad.join(', ')})` : ''}`);
}
check(KEYS.every((key) => same(Object.keys(MUSIC_SETS[key]), Object.keys(MUSIC_SETS.night)) && same(Object.keys(MUSIC_SETS[key].gain), Object.keys(MUSIC_SETS.night.gain))),
  'all four sets have the same shape (nothing extra, nothing missing)');

console.log('\n== notes: in tune, in range, in key');
for (const key of KEYS) {
  const set = MUSIC_SETS[key];
  const all = set.chords.flatMap(rowNotes);
  const sour = all.filter((hz) => centsOff(hz) > 1);
  check(sour.length === 0, `${key}: all ${all.length} notes within a cent of equal temperament${sour.length ? ` (off: ${sour.join(', ')})` : ''}`);
  const outside = [...new Set(all.filter((hz) => !set.scale.pitchClasses.includes(pitchClass(hz))).map((hz) => `${NOTE[pitchClass(hz)]} (${hz})`))];
  check(outside.length === 0, `${key}: every note belongs to ${set.scale.name}${outside.length ? ` (outside: ${outside.join(', ')})` : ''}`);
  // No two notes that can sound in the same bar (bass, pad, lead, bells) a semitone apart, in any octave.
  const clashes = set.chords.flatMap((ch) => {
    const pcs = [...new Set(rowNotes(ch).map(pitchClass))];
    return pcs.filter((p) => pcs.includes((p + 1) % 12)).map((p) => `${ch.name}: ${NOTE[p]}/${NOTE[(p + 1) % 12]}`);
  });
  check(clashes.length === 0, `${key}: no semitone clashes inside any bar${clashes.length ? ` (${clashes.join(', ')})` : ''}`);
  // Bass on roots and fifths; the pad holds the chord the bass names.
  const loose = set.chords.filter((ch) => {
    const up = (pitchClass(ch.fifth) - pitchClass(ch.bass) + 12) % 12;
    return up !== 7 || !ch.pad.map(pitchClass).includes(pitchClass(ch.bass)) || !ch.lead.every((hz) => hz > ch.pad[0]) || !ch.bell.every((hz) => hz >= ch.lead[0]);
  }).map((ch) => ch.name);
  check(loose.length === 0, `${key}: bass on the root with a perfect fifth, the root in the pad, lead above the pad, bells above that${loose.length ? ` (not: ${loose.join(', ')})` : ''}`);
  const digits = set.lead.steps.replace(/[.*]/g, '').split('').map(Number);
  check(digits.every((d) => set.chords.every((ch) => d < ch.lead.length)), `${key}: the lead pattern only picks notes every chord has`);
}

console.log('\n== patterns and sounds hold together');
for (const key of KEYS) {
  const set = MUSIC_SETS[key];
  // The bass is one voice: a note ends before the next begins (swung notes start late), bar to bar too.
  const overlaps = ['easy', 'drive'].filter((tier) => {
    const { steps, len } = set.bass[tier];
    const starts = [...steps].flatMap((ch, i) => (ch === '.' ? [] : [i + (i % 2 ? set.swing : 0)]));
    return starts.length === 0 || starts.some((s, i) => s + len > (i + 1 < starts.length ? starts[i + 1] : starts[0] + 16) + 1e-9);
  });
  check(overlaps.length === 0, `${key}: bass notes never overlap${overlaps.length ? ` (${overlaps.join(', ')})` : ''}`);
  check(set.kick.to < set.kick.from && set.kick.stop >= 0.002 + set.kick.decay && set.lead.stop >= 0.003 + set.lead.decay
    && set.bell.stop >= 0.002 + set.bell.ring / Math.min(...set.bell.partials.map((p) => p[0])),
    `${key}: every oscillator outlives its envelope (no clicks from an early stop)`);
  check(set.bass.easy.steps[0] !== '.' && set.bass.drive.steps[0] !== '.' && set.kick.easy[0] !== '.' && set.kick.full[0] !== '.',
    `${key}: bass and kick mark the bar line`);
}

console.log('\n== density: a pace-keeper, like the night set');
// What one bar may hold. Night's own busiest bar has 49 events (measured on the v57 code, which night matches call for call).
const MOST = { kick: 4, clap: 2, hat: 16, bass: 12, pluck: 16, bell: 4 };
const grid = (fn) => STATUSES.flatMap((status) => LEVELS.map((k) => fn(status, k)));
const nightBusiest = Math.max(...grid((status, k) => Math.max(...perBar(withRandom(() => 0, () => recordSteps('night', status, k))))));
check(nightBusiest === 49, `night's busiest bar has 49 events (got ${nightBusiest})`);
for (const key of KEYS) {
  const worst = [];
  let busiest = 0;
  attempt(`${key} density`, () => grid((status, k) => {
    // Math.random = 0 rings every bell that can ring: the most a bar can ever hold.
    const calls = withRandom(() => 0, () => recordSteps(key, status, k));
    const where = `${status} k=${k}`;
    const total = perBar(calls.filter((c) => c.lane !== 'pad'));
    busiest = Math.max(busiest, ...total);
    for (const lane of LANES) if (Math.max(...perBar(calls, lane)) > MOST[lane]) worst.push(`${where}: ${Math.max(...perBar(calls, lane))} ${lane}`);
    if (Math.max(...total) > nightBusiest) worst.push(`${where}: ${Math.max(...total)} events in a bar`);
    const brake = status === 'SafetyBrake';
    const count = (lane) => perBar(calls, lane);
    if (Math.min(...count('bass')) < 1) worst.push(`${where}: a bar with no bass`);
    if (!perBar(calls, 'pad').every((n) => n === 3)) worst.push(`${where}: the pad is not retuned once a bar`);
    if (brake && (Math.max(...count('kick')) || Math.max(...count('clap')) || Math.max(...count('hat')))) worst.push(`${where}: drums during the safety brake`);
    if (!brake && Math.min(...count('kick')) < 2) worst.push(`${where}: fewer than 2 kicks in a bar`);
    if (!brake && k > 0.3 && !count('clap').every((n) => n === 2)) worst.push(`${where}: not 2 claps a bar`);
    if (!brake && k > 0.2 && Math.min(...count('hat')) < 4) worst.push(`${where}: fewer than 4 hats in a bar`);
    if ((brake || k <= 0.2) && Math.max(...count('hat'))) worst.push(`${where}: hats when they should rest`);
    if (k <= 0.3 && Math.max(...count('clap'))) worst.push(`${where}: claps when they should rest`);
    const zone = status === 'InZone' && k > 0.25;
    if (zone ? Math.min(...count('pluck')) < 6 : Math.max(...count('pluck')) > 0) worst.push(`${where}: lead ${zone ? 'too thin to hear' : 'outside the zone'}`);
    if (status === 'Below' ? Math.min(...count('bell')) < 1 : Math.max(...count('bell')) > 0) worst.push(`${where}: bells ${status === 'Below' ? 'missing' : 'outside Below'}`);
  }));
  check(worst.length === 0, `${key}: every bar within bounds in all ${STATUSES.length * LEVELS.length} status x intensity cases (busiest bar: ${busiest} events)${worst.length ? ` (${worst.slice(0, 4).join('; ')})` : ''}`);
  // Busier never means quieter layers: more intensity never removes events (same zone status).
  const dips = STATUSES.filter((status) => {
    const totals = LEVELS.map((k) => withRandom(() => 0, () => recordSteps(key, status, k)).filter((c) => c.lane !== 'pad').length);
    return totals.some((n, i) => i > 0 && n < totals[i - 1]);
  });
  check(dips.length === 0, `${key}: more intensity never thins the music out${dips.length ? ` (${dips.join(', ')})` : ''}`);
}

console.log('\n== scheduled notes: finite, in range, in key');
for (const key of KEYS) {
  const set = MUSIC_SETS[key];
  const notes = attempt(`${key} notes`, () => withRandom(mulberry32(7), () => grid((status, k) => notesOf(recordSteps(key, status, k, set.chords.length * 2))).flat())) || [];
  const hz = notes.map((n) => n.hz);
  const wild = hz.filter((f) => typeof f !== 'number' || !Number.isFinite(f) || f < 30 || f > 5000);
  check(notes.length > 1000 && wild.length === 0, `${key}: ${notes.length} scheduled notes, all finite and between 30 Hz and 5 kHz (${Math.min(...hz).toFixed(1)} to ${Math.max(...hz).toFixed(1)} Hz)`);
  check(notes.every((n) => set.scale.pitchClasses.includes(pitchClass(n.hz))), `${key}: every scheduled note is in ${set.scale.name}`);
  const bassTop = Math.max(...notes.filter((n) => n.lane === 'bass').map((n) => n.hz)), leadLow = Math.min(...notes.filter((n) => n.lane === 'pluck').map((n) => n.hz));
  check(bassTop < leadLow, `${key}: the bass (up to ${bassTop.toFixed(0)} Hz) stays under the lead (from ${leadLow.toFixed(0)} Hz)`);
}

console.log('\n== night is the v57 synth: scheduling rules');
// The v57 scheduler, copied from the last commit before music sets (e983ba8, AudioEngine.playStep),
// with each instrument call written down instead of played.
const V57_CHORDS = [
  // A minor - F - C - G, as [root Hz, chord tones Hz]
  [110.0, [220.0, 261.63, 329.63]],
  [87.31, [174.61, 220.0, 261.63]],
  [130.81, [261.63, 329.63, 392.0]],
  [98.0, [196.0, 246.94, 293.66]],
];
function v57Steps(status, k, bars = 4, tempo = 117) {
  const out = [];
  const sixteenth = 60 / tempo / 4;
  for (let step = 0; step < bars * 16; step++) {
    const t = 10 + step * sixteenth;
    const inStep = step % 16;
    const bar = Math.floor(step / 16);
    const [root, chord] = V57_CHORDS[bar % V57_CHORDS.length];
    const brake = status === 'SafetyBrake';
    if (inStep === 0) chord.forEach((f, i) => out.push(['pad', i, f, t, 0.15]));
    if (!brake && inStep % 4 === 0 && (k > 0.2 || inStep % 8 === 0)) out.push(['kick', t, 0.7 + 0.3 * k]);
    if (!brake && k > 0.3 && (inStep === 4 || inStep === 12)) out.push(['clap', t, 0.35]);
    const sixteenths = k > 0.6 || status === 'Above';
    if (!brake && k > 0.2 && (sixteenths || inStep % 2 === 0)) out.push(['hat', t, inStep % 4 === 2 ? 0.16 : 0.09]);
    if (k > 0.15 ? inStep % 2 === 0 : inStep === 0) out.push(['bass', t, root, k > 0.15 ? sixteenth * 1.8 : sixteenth * 14, k]);
    if (status === 'InZone' && k > 0.25) {
      const notes = [chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[1] * 2];
      out.push(['pluck', t, notes[inStep % 4], 0.07]);
    }
    if (status === 'Below' && inStep % 4 === 0 && Math.random() < 0.35) {
      out.push(['bell', t, chord[Math.floor(Math.random() * 3)] * 4, 0.06]);
    }
  }
  return out;
}
// The sounds v57 had built into its instruments, and the levels it passed them.
const V57_SOUND = {
  kick: { from: 150, to: 45, sweep: 0.12, decay: 0.25, stop: 0.3 },
  clap: { freq: 1800, q: 0.8, decay: 0.14 },
  hat: { freq: 7500, q: 0.5, decay: 0.04 },
  bass: { wave: 'sawtooth', cutoff: 250, open: 1400, q: 4 },
  pluck: { wave: 'triangle', decay: 0.14, stop: 0.2 },
  bell: { partials: [[1, 1], [2.76, 0.4], [5.4, 0.2]], ring: 1.2, stop: 1.4 },
};
const V57_ARGS = { pad: 4, kick: 2, clap: 2, hat: 2, bass: 4, pluck: 3, bell: 3 }; // how many arguments v57 passed each
{
  const night = MUSIC_SETS.night;
  let cases = 0, events = 0;
  const diffs = [], extras = [];
  attempt('night against the v57 rules', () => grid((status, k) => {
    const want = withRandom(mulberry32(1234), () => v57Steps(status, k, 8));
    const got = withRandom(mulberry32(1234), () => recordSteps('night', status, k, 8));
    cases++; events += want.length;
    // Same calls, same order, same numbers to the last bit (=== on every argument v57 passed).
    const flat = got.map((c) => [c.lane, ...c.args.slice(0, V57_ARGS[c.lane])]);
    const first = want.findIndex((w, i) => !flat[i] || w.length !== flat[i].length || w.some((x, j) => x !== flat[i][j]));
    if (first >= 0 || flat.length !== want.length) diffs.push(`${status} k=${k}: call ${first}: v57 ${JSON.stringify(want[first])}, now ${JSON.stringify(flat[first])}`);
    // What is new in the call (the sound, and the bass level) must be the night set's own, at v57's values.
    got.forEach((c) => {
      if (c.lane === 'pad') return;
      const more = c.args.slice(V57_ARGS[c.lane]);
      const sound = more[more.length - 1];
      const ok = c.lane === 'bass' ? more.length === 2 && more[0] === 0.22 && sound === night.bass
        : more.length === 1 && sound === night[c.lane === 'pluck' ? 'lead' : c.lane];
      if (!ok) extras.push(`${c.lane} at step ${c.step}`);
    });
  }));
  check(diffs.length === 0, `night schedules exactly what v57 did: ${events} instrument calls over ${cases} status x intensity cases, 8 bars each${diffs.length ? ` (${diffs[0]})` : ''}`);
  check(extras.length === 0, `night passes each instrument its own sound and v57's levels${extras.length ? ` (not: ${extras.slice(0, 3).join(', ')})` : ''}`);
  const soundOf = { kick: night.kick, clap: night.clap, hat: night.hat, bass: night.bass, pluck: night.lead, bell: night.bell };
  const drift = Object.entries(V57_SOUND).flatMap(([lane, sound]) => Object.entries(sound).filter(([f, v]) => !same(soundOf[lane][f], v)).map(([f]) => `${lane}.${f}`));
  check(drift.length === 0, `night's sounds are v57's numbers${drift.length ? ` (changed: ${drift.join(', ')})` : ''}`);
  check(Object.values(night.gain).every((g) => g === 1) && night.swing === 0 && night.pad.detune === 7 && night.pad.tone === 1,
    'night has no trims, no swing, and the v57 pad');
  check(night.chords.every((ch, i) => ch.bass === V57_CHORDS[i][0] && same(ch.pad, V57_CHORDS[i][1])
    && ch.lead.every((hz, j) => hz === ch.pad[j] * 2) && ch.bell.every((hz, j) => hz === ch.pad[j] * 4)) && night.chords.length === 4,
    'night\'s chords are v57\'s CHORDS, with lead = pad x 2 and bell = pad x 4 to the last bit');
}

console.log('\n== night is the v57 synth: every Web Audio call');
// Recorded from the v57 file itself (git show e983ba8:js/audio.js) with playWorkout(): the number of
// Web Audio calls it made and their SHA-256. See the top of this file for how to re-make it.
const V57_RECORDING = { lines: 23991, sha256: 'fb57bd9ec68e0ccb00940df92f9423a8ae35c0797824fa26b2816772a178c228' };
const nightRun = attempt('night workout', () => playWorkout(AudioEngine, 'night'));
if (nightRun) {
  check(nightRun.lines.length === V57_RECORDING.lines && digest(nightRun.lines) === V57_RECORDING.sha256,
    `night makes the same ${V57_RECORDING.lines} Web Audio calls as v57 over the scripted workout, sound effects included (${nightRun.lines.length} calls, sha256 ${digest(nightRun.lines).slice(0, 16)}...)`);
  const fresh = attempt('default engine', () => playWorkout(AudioEngine, undefined));
  check(!!fresh && digest(fresh.lines) === digest(nightRun.lines), 'an engine that was never given a set plays night');
}
const refArg = process.argv.find((arg) => arg.startsWith('--ref='));
if (refArg && nightRun) {
  const { AudioEngine: RefEngine } = await import(pathToFileURL(resolve(refArg.slice(6))).href);
  const ref = playWorkout(RefEngine, undefined);
  console.log(`  reference build ${refArg.slice(6)}: { lines: ${ref.lines.length}, sha256: '${digest(ref.lines)}' }`);
  const first = ref.lines.findIndex((line, i) => line !== nightRun.lines[i]);
  check(first < 0 && ref.lines.length === nightRun.lines.length, first < 0 ? `night matches the reference build call for call (${ref.lines.length} calls)`
    : `night differs from the reference build at call ${first}: reference "${ref.lines[first]}", now "${nightRun.lines[first]}"`);
}

console.log('\n== every set through the real instruments');
for (const key of KEYS) {
  const c = attempt(`${key} workout`, () => playWorkout(AudioEngine, key));
  if (!c) continue;
  check(c.problems.length === 0, `${key}: a whole scripted workout without one call a browser would reject (${c.lines.length} Web Audio calls)${c.problems.length ? ` (${c.problems[0]})` : ''}`);
  const lo = Math.min(...c.oscHz), hi = Math.max(...c.oscHz);
  check(c.oscHz.length > 1000 && c.oscHz.every(Number.isFinite) && lo >= 30 && hi <= 9000,
    `${key}: every oscillator frequency, bell overtones and sound effects included, is between 30 Hz and 9 kHz (${lo.toFixed(0)} to ${hi.toFixed(0)} Hz)`);
  check(c.filterHz.every((f) => Number.isFinite(f) && f >= 20 && f <= 20000), `${key}: every filter stays inside the audible band`);
}

console.log('\n== no louder than night');
{
  const night = MUSIC_SETS.night;
  // Mean-square of each oscillator shape at the same peak: what a trim has to make up for.
  const POWER = { sine: 1 / 2, triangle: 1 / 3, sawtooth: 1 / 3, square: 1 };
  const hits = (steps, level = { x: 1 }) => [...steps].reduce((sum, ch) => sum + (level[ch] || 0) ** 2, 0);
  // A rough energy budget per bar and lane: level squared x how long each hit rings x how many hits.
  const budget = (set) => ({
    'kick (easy)': hits(set.kick.easy, { x: 1, o: 0.6 }) * set.gain.kick ** 2 * set.kick.decay,
    'kick (full)': hits(set.kick.full, { x: 1, o: 0.6 }) * set.gain.kick ** 2 * set.kick.decay,
    clap: hits(set.clap.steps) * set.gain.clap ** 2 * set.clap.decay * (set.clap.freq / set.clap.q),          // band-pass: width = freq / q
    'hat (base)': hits(set.hat.base, { x: 0.09, X: 0.16 }) * set.gain.hat ** 2 * set.hat.decay * (24000 - set.hat.freq), // high-pass: what is left above it
    'hat (busy)': hits(set.hat.busy, { x: 0.09, X: 0.16 }) * set.gain.hat ** 2 * set.hat.decay * (24000 - set.hat.freq),
    'bass (easy)': hits(set.bass.easy.steps, { r: 1, f: 1, R: 1 }) * set.gain.bass ** 2 * set.bass.easy.len * POWER[set.bass.wave],
    'bass (drive)': hits(set.bass.drive.steps, { r: 1, f: 1, R: 1 }) * set.gain.bass ** 2 * set.bass.drive.len * POWER[set.bass.wave],
    lead: Math.max(...set.chords.map((ch) => [...set.lead.steps].reduce((n, ch2) => n + (ch2 === '*' ? ch.lead.length : ch2 === '.' ? 0 : 1), 0)))
      * set.gain.lead ** 2 * set.lead.decay * POWER[set.lead.wave],
    bell: hits(set.bell.steps) * set.bell.chance * set.gain.bell ** 2 * set.bell.ring * set.bell.partials.reduce((sum, p) => sum + p[1] ** 2 / p[0], 0),
    pad: set.gain.pad ** 2 * set.pad.tone,
  });
  const base = budget(night);
  for (const key of NEW_KEYS) {
    const set = MUSIC_SETS[key];
    const mine = budget(set);
    const over = Object.keys(base).filter((lane) => mine[lane] > base[lane] * 1.0001).map((lane) => `${lane} +${(10 * Math.log10(mine[lane] / base[lane])).toFixed(1)} dB`);
    check(over.length === 0, `${key}: no layer carries more energy per bar than night's${over.length ? ` (${over.join(', ')})` : ''}`);
    check(Object.values(set.gain).every((g) => g <= 1) && set.bass.q <= night.bass.q && set.bass.cutoff + set.bass.open <= night.bass.cutoff + night.bass.open,
      `${key}: no trim above 1, and the bass filter no brighter or more resonant than night's`);
  }
  // The loudest single gain any instrument or effect is ever driven to, over the scripted workout.
  const peaks = KEYS.map((key) => attempt(`${key} peak`, () => playWorkout(AudioEngine, key).peak));
  check(peaks.every((p) => p <= peaks[0] + 1e-9), `no set drives any gain higher than night does (peaks ${peaks.map((p) => (p == null ? p : p.toFixed(4))).join(", ")})`);
}

console.log('\n== setMusicSet');
{
  const a = new AudioEngine();
  check(a.musicSet === 'night', 'a new engine is on night');
  const odd = [undefined, null, '', 'Night', 'nope', 'toString', 'constructor', '__proto__', 42, {}, ['storm']];
  check(odd.every((key) => { a.setMusicSet('storm'); a.setMusicSet(key); return a.musicSet === 'night'; }), `unknown keys fall back to night (${odd.length} odd values tried)`);
  check(NEW_KEYS.every((key) => { a.setMusicSet(key); return a.musicSet === key; }) && a.ctx === null, 'known keys are taken before there is an audio context, and nothing is created');
}
{
  // Before the context exists: the pad is built on the chosen set's first chord, and that set plays from bar 1.
  const a = attempt('boot on harbour', () => boot(AudioEngine, 'harbour'));
  if (a) {
    const harbour = MUSIC_SETS.harbour;
    const padHz = a.padOscs.map((o) => o.frequency.value), padCents = a.padOscs.map((o) => o.detune.value);
    check(same(padHz, harbour.chords[0].pad) && same(padCents, [-1, 0, 1].map((n) => n * harbour.pad.detune)), 'a set chosen before the first gesture is the one the pad is built on');
  }
}
{
  // While the synth plays: the change waits for the bar line, then starts the new set on its first chord.
  const a = attempt('boot', () => boot());
  if (a) attempt('switching sets mid-bar', () => {
    const seen = [];                                   // [step, set that played it]
    const spy = (obj, name, fn) => { const real = obj[name].bind(obj); obj[name] = (...args) => { fn(...args); return real(...args); }; };
    let step = -1;
    spy(a, 'playStep', (n) => { step = n; });
    spy(a, 'kick', (t, vol, sound) => seen.push([step, KEYS.find((key) => MUSIC_SETS[key].kick === sound)]));
    const state = at(0.5, 'InZone', 125);
    play(a, 5, state);
    while (a.step % 16 !== 6) play(a, 0.025, state);   // stop mid-bar
    const asked = a.step, line = Math.ceil(asked / 16) * 16;
    a.setMusicSet('furnace');
    check(a.musicSet === 'furnace', 'musicSet reports the waiting set straight away');
    const padBefore = a.padOscs.map((o) => o.frequency.value);
    while (a.step <= line) play(a, 0.025, state); // through the bar line's own step
    const firstNew = seen.find(([, key]) => key === 'furnace');
    check(seen.filter(([n]) => n < line).every(([, key]) => key === 'night') && seen.some(([n]) => n >= asked && n < line),
      `the bar in progress finishes in the old set (asked at step ${asked}, bar line at ${line})`);
    check(!!firstNew && firstNew[0] === line && line % 16 === 0 && seen.filter(([n]) => n >= line).every(([, key]) => key === 'furnace'),
      `the new set comes in exactly on the bar line (step ${firstNew?.[0]})`);
    check(!same(padBefore, MUSIC_SETS.furnace.chords[0].pad) && same(a.padOscs.map((o) => o.frequency.value), MUSIC_SETS.furnace.chords[0].pad),
      'and it starts on its own first chord');
    play(a, 12, state);
    check(a.musicSet === 'furnace' && seen.slice(-20).every(([, key]) => key === 'furnace'), 'it stays until asked again');
    // Asking for the set that is already playing cancels a waiting one.
    while (a.step % 16 !== 3) play(a, 0.025, state);
    a.setMusicSet('storm'); a.setMusicSet('furnace');
    const mark = seen.length;
    play(a, 8, state);
    check(a.musicSet === 'furnace' && seen.slice(mark).every(([, key]) => key === 'furnace'), 'asking again for the playing set cancels a waiting one');
    // Unknown key while playing: night on the next bar line.
    a.setMusicSet('bogus');
    play(a, 8, state);
    check(a.musicSet === 'night' && seen[seen.length - 1][1] === 'night', 'an unknown key while playing brings night back on the next bar line');
    check(a.ctx.problems.length === 0, 'switching makes no call a browser would reject');
  });
}
{
  // While the recorded song is playing: the synth stays silent, the song's chain is left alone, and the
  // new set is ready when the synth has to fill in.
  class FakeAudioElement {
    constructor() { this.paused = true; this.readyState = 4; this.currentTime = 0; this.playbackRate = 1; }
    addEventListener() {}
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const realAudio = globalThis.Audio;
  globalThis.Audio = FakeAudioElement;
  attempt('switching sets in song mode', () => {
    const a = new AudioEngine();
    a.setSong('song.mp3', 120);
    a.setMusicMode('song');
    a.ctx = new FakeContext(); a.build(); a.playSong();
    const played = [];
    for (const lane of LANES) { const real = a[lane].bind(a); a[lane] = (...args) => { played.push(lane); return real(...args); }; }
    const state = at(0.5, 'InZone', 125);
    play(a, 4, state);
    check(a.songLive && played.length === 0, 'song mode: the synth is silent while the song plays');
    const songChain = (lines) => lines.filter((line) => /^(media|filter)\d+/.test(line) && !line.includes('setTargetAtTime')).length;
    const before = songChain(a.ctx.lines);
    a.setMusicSet('storm');
    play(a, 6, state);
    check(a.musicSet === 'storm' && played.length === 0 && songChain(a.ctx.lines) === before && a.musicMode === 'song' && !a.song.el.paused,
      'song mode: a new set is taken without a sound and without touching the song');
    check(same(a.padOscs.map((o) => o.frequency.value), MUSIC_SETS.storm.chords[0].pad), 'song mode: the silent pad has already moved to the new set');
    a.song.el.readyState = 1;                          // the song stalls: the synth fills in
    play(a, 4, state);
    check(played.length > 0 && a.ctx.problems.length === 0, 'when the song stalls the synth fills in, in the new set');
  });
  globalThis.Audio = realAudio;
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
