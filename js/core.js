// PulseZone core logic: no DOM, no three.js. Shared by the game page, the phone bridge
// page and the Node tests. Ported from the Unity project's Scripts/Core (same tuning).

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const alpha = (dt, tau) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

// Small seeded RNG so simulations are repeatable in tests.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- heart-rate sources
// Every source has: displayName, isSimulated, hasReading, currentBpm,
// secondsSinceLastReading, statusText, tick(dt).

/** Physiological model of heart rate responding to effort (workload 0..1). */
export class SimulatedHeart {
  constructor(opts = {}) {
    this.s = {
      restingBpm: 65, maxBpm: 185,
      riseTimeConstant: 30, recoveryTimeConstant: 45,
      driftBpmPerMinuteAtFullLoad: 1.5, maxDriftBpm: 10,
      noiseBpm: 1.5, sampleIntervalSeconds: 1, seed: 12345,
      ...opts,
    };
    this.rng = mulberry32(this.s.seed);
    this.trueBpm = this.s.restingBpm;
    this.drift = 0;
    this.noise = 0;
    this.sinceSample = this.s.sampleIntervalSeconds;
    this.secondsSinceLastReading = Infinity;
    this.hasReading = false;
    this.currentBpm = 0;
    this.workload = 0;
    this.signalLost = false;
    this.displayName = 'Simulated heart';
    this.isSimulated = true;
  }

  get statusText() { return this.signalLost ? 'Simulated signal loss' : ''; }

  steadyStateBpm(workload) {
    const reserve = this.s.maxBpm - this.s.restingBpm;
    return this.s.restingBpm + reserve * (0.05 + 0.85 * clamp01(workload));
  }

  gaussian() {
    const u1 = 1 - this.rng();
    const u2 = this.rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  tick(dt) {
    if (dt <= 0) return;
    const s = this.s;
    const w = clamp01(this.workload);
    const goal = this.steadyStateBpm(w);
    const tau = goal > this.trueBpm ? s.riseTimeConstant : s.recoveryTimeConstant;
    this.trueBpm += (goal - this.trueBpm) * (1 - Math.exp(-dt / tau));

    if (w > 0.5) this.drift += (s.driftBpmPerMinuteAtFullLoad * ((w - 0.5) * 2) * dt) / 60;
    else this.drift -= (this.drift * dt) / 120;
    this.drift = clamp(this.drift, 0, s.maxDriftBpm);

    const noiseTau = 6;
    const sigma = s.noiseBpm * Math.sqrt(2 / noiseTau);
    this.noise += (-this.noise * dt) / noiseTau + sigma * Math.sqrt(dt) * this.gaussian();

    this.secondsSinceLastReading += dt;
    this.sinceSample += dt;
    if (this.sinceSample >= s.sampleIntervalSeconds) {
      this.sinceSample = 0;
      if (!this.signalLost) {
        const bpm = this.trueBpm + this.drift + this.noise;
        this.currentBpm = Math.round(clamp(bpm, 35, s.maxBpm + 5));
        this.hasReading = true;
        this.secondsSinceLastReading = 0;
      }
    }
  }
}

/** Pretend player for desktop testing: turns game intensity into physical workload. */
export class SimulatedPlayer {
  constructor() {
    this.compliance = 1;
    this.reactionSeconds = 2;
    this.idleWorkload = 0.15;
    this.workload = 0;
  }
  tick(gameIntensity, dt) {
    const wanted = clamp01(this.idleWorkload + 0.8 * Math.max(0, gameIntensity) * this.compliance);
    this.workload += (wanted - this.workload) * (1 - Math.exp(-dt / this.reactionSeconds));
    return this.workload;
  }
}

/**
 * Heart rate arriving from outside (the phone bridge). push(bpm) whenever a reading
 * arrives; implausible values are rejected.
 */
export class RemoteHeartSource {
  constructor(displayName = 'Phone heart-rate bridge') {
    this.displayName = displayName;
    this.isSimulated = false;
    this.hasReading = false;
    this.currentBpm = 0;
    this.secondsSinceLastReading = Infinity;
    this.statusText = '';
    this.accepted = 0;
    this.rejected = 0;
  }
  tick(dt) { if (dt > 0) this.secondsSinceLastReading += dt; }
  push(bpm) {
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 230) { this.rejected++; return false; }
    this.currentBpm = Math.round(bpm);
    this.hasReading = true;
    this.secondsSinceLastReading = 0;
    this.accepted++;
    return true;
  }
}

// ---------------------------------------------------------------- Bluetooth packet parsing

/**
 * Parse a Bluetooth Heart Rate Measurement (characteristic 0x2A37).
 * Accepts a DataView, ArrayBuffer, Uint8Array or plain array of bytes.
 * Returns null if malformed.
 */
export function parseHeartRateMeasurement(input) {
  let bytes;
  if (input == null) return null;
  if (input instanceof DataView) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = Uint8Array.from(input);
  if (bytes.length < 2) return null;

  const flags = bytes[0];
  const hr16 = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const hasSkinContact = !contactSupported || (flags & 0x02) !== 0;
  const energyPresent = (flags & 0x08) !== 0;
  const rrPresent = (flags & 0x10) !== 0;

  let i;
  let bpm;
  if (hr16) {
    if (bytes.length < 3) return null;
    bpm = bytes[1] | (bytes[2] << 8);
    i = 3;
  } else {
    bpm = bytes[1];
    i = 2;
  }
  let energyKj = -1;
  if (energyPresent) {
    if (bytes.length < i + 2) return null;
    energyKj = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
  }
  const rr = [];
  if (rrPresent) for (; i + 1 < bytes.length; i += 2) rr.push((bytes[i] | (bytes[i + 1] << 8)) / 1024);
  return { bpm, hasSkinContact, contactSupported, energyKj, rrIntervalsSeconds: rr };
}

// ---------------------------------------------------------------- zone controller

export const Phase = Object.freeze({ WarmUp: 'WarmUp', Training: 'Training', CoolDown: 'CoolDown', Finished: 'Finished' });
export const Zone = Object.freeze({ NoSignal: 'NoSignal', Below: 'Below', InZone: 'InZone', Above: 'Above', SafetyBrake: 'SafetyBrake' });

export function defaultZoneSettings() {
  return {
    targetBpm: 120,
    zoneHalfWidth: 5,
    safetyCeilingBpm: 160,
    warmUpSeconds: 120,
    trainingSeconds: 900,
    coolDownSeconds: 120,
    startIntensity: 0.15,
    coolDownEndIntensity: 0.05,
    minIntensity: 0.05,
    maxIntensity: 1,
    bpmSmoothingSeconds: 4,
    slopeSmoothingSeconds: 6,
    kp: 0.008,
    ki: 0.00025,
    kd: 0.3,
    maxIntensityChangePerSecond: 0.02,
    signalTimeoutSeconds: 8,
    noSignalIntensity: 0.3,
  };
}

/**
 * Reads heart rate, compares it to the target and outputs game intensity 0..1.
 * Warm-up ramps the target up; training runs a PID loop; cool-down eases off;
 * the safety brake overrides everything above the ceiling.
 */
export class ZoneController {
  constructor(settings = {}) {
    this.s = { ...defaultZoneSettings(), ...settings };
    this.intensity = this.s.startIntensity;
    this.integral = this.intensity;
    this.phase = Phase.WarmUp;
    this.status = Zone.NoSignal;
    this.currentSetpoint = this.s.targetBpm;
    this.smoothedBpm = NaN;
    this.bpmTrend = 0;
    this.elapsedSeconds = 0;
    this.phaseElapsedSeconds = 0;
    this.secondsInZone = 0;
    this.warmUpStartBpm = NaN;
    this.coolDownStartIntensity = 0;
    this.braking = false;
  }

  get phaseDuration() {
    switch (this.phase) {
      case Phase.WarmUp: return this.s.warmUpSeconds;
      case Phase.Training: return this.s.trainingSeconds;
      case Phase.CoolDown: return this.s.coolDownSeconds;
      default: return 0;
    }
  }

  beginCoolDown() {
    if (this.phase === Phase.CoolDown || this.phase === Phase.Finished) return;
    this.enterPhase(Phase.CoolDown);
  }

  tick(source, dt) {
    if (dt <= 0 || this.phase === Phase.Finished) return;
    const s = this.s;
    this.elapsedSeconds += dt;
    this.phaseElapsedSeconds += dt;
    this.advancePhaseIfDue();

    const signal = source && source.hasReading && source.secondsSinceLastReading <= s.signalTimeoutSeconds;
    if (signal) this.updateSmoothing(source.currentBpm, dt);
    this.currentSetpoint = this.computeSetpoint();

    if (!signal) {
      this.status = Zone.NoSignal;
      const desired = this.intensity + (s.noSignalIntensity - this.intensity) * (1 - Math.exp(-dt / 20));
      this.integral = desired;
      this.intensity = this.step(this.intensity, desired, dt, 1);
      return;
    }

    if (this.smoothedBpm >= s.safetyCeilingBpm || (this.braking && this.smoothedBpm > s.targetBpm)) {
      this.braking = true;
      this.status = Zone.SafetyBrake;
      this.integral = s.minIntensity;
      this.intensity = this.step(this.intensity, s.minIntensity, dt, 4);
      return;
    }
    this.braking = false;

    const target = this.phase === Phase.CoolDown ? s.targetBpm : this.currentSetpoint;
    const zoneError = target - this.smoothedBpm;
    this.status = Math.abs(zoneError) <= s.zoneHalfWidth ? Zone.InZone : zoneError > 0 ? Zone.Below : Zone.Above;
    if (this.phase === Phase.Training && this.status === Zone.InZone) this.secondsInZone += dt;

    if (this.phase === Phase.CoolDown) {
      const t = clamp01(this.phaseElapsedSeconds / Math.max(1, s.coolDownSeconds));
      this.intensity = this.step(this.intensity, lerp(this.coolDownStartIntensity, s.coolDownEndIntensity, t), dt, 1);
      return;
    }

    const error = this.currentSetpoint - this.smoothedBpm;
    const setpointRate = this.phase === Phase.WarmUp ? this.setpointRampRate() : 0;
    const errorTrend = setpointRate - this.bpmTrend;
    const p = s.kp * error;
    const d = s.kd * errorTrend;
    const candidateIntegral = this.integral + s.ki * error * dt;
    const unclamped = candidateIntegral + p + d;
    const desired = clamp(unclamped, s.minIntensity, s.maxIntensity);
    const saturatedHigh = unclamped > s.maxIntensity && error > 0;
    const saturatedLow = unclamped < s.minIntensity && error < 0;
    if (!saturatedHigh && !saturatedLow) this.integral = candidateIntegral;
    this.integral = clamp(this.integral, s.minIntensity, s.maxIntensity);
    this.intensity = this.step(this.intensity, desired, dt, 1);
  }

  updateSmoothing(bpm, dt) {
    if (Number.isNaN(this.smoothedBpm)) {
      this.smoothedBpm = bpm;
      this.bpmTrend = 0;
      if (Number.isNaN(this.warmUpStartBpm)) this.warmUpStartBpm = bpm;
      return;
    }
    const prev = this.smoothedBpm;
    this.smoothedBpm += (bpm - this.smoothedBpm) * alpha(dt, this.s.bpmSmoothingSeconds);
    const inst = (this.smoothedBpm - prev) / dt;
    this.bpmTrend += (inst - this.bpmTrend) * alpha(dt, this.s.slopeSmoothingSeconds);
  }

  computeSetpoint() {
    const s = this.s;
    if (this.phase !== Phase.WarmUp) return s.targetBpm;
    const start = Number.isNaN(this.warmUpStartBpm) ? s.targetBpm : Math.min(this.warmUpStartBpm, s.targetBpm);
    return lerp(start, s.targetBpm, clamp01(this.phaseElapsedSeconds / Math.max(1, s.warmUpSeconds)));
  }

  setpointRampRate() {
    const s = this.s;
    if (Number.isNaN(this.warmUpStartBpm) || this.phaseElapsedSeconds >= s.warmUpSeconds) return 0;
    return Math.max(0, s.targetBpm - this.warmUpStartBpm) / Math.max(1, s.warmUpSeconds);
  }

  advancePhaseIfDue() {
    if (this.phaseElapsedSeconds < this.phaseDuration) return;
    if (this.phase === Phase.WarmUp) this.enterPhase(Phase.Training);
    else if (this.phase === Phase.Training) this.enterPhase(Phase.CoolDown);
    else if (this.phase === Phase.CoolDown) this.enterPhase(Phase.Finished);
  }

  enterPhase(next) {
    this.phase = next;
    this.phaseElapsedSeconds = 0;
    if (next === Phase.CoolDown) this.coolDownStartIntensity = this.intensity;
    if (next === Phase.Finished) this.intensity = 0;
  }

  step(current, desired, dt, rateMultiplier) {
    const maxStep = this.s.maxIntensityChangePerSecond * rateMultiplier * dt;
    return clamp(current + clamp(desired - current, -maxStep, maxStep), 0, 1);
  }
}

// ---------------------------------------------------------------- difficulty

export const EASY = Object.freeze({
  spawnInterval: 2.2, orbSpeed: 1.6, horizontalSpread: 0.25, verticalSpread: 0.1,
  obstacleChance: 0, heavyOrbChance: 0, minPunchSpeed: 0.6, directionalChance: 0, crossBodyChance: 0,
});
export const HARD = Object.freeze({
  spawnInterval: 0.45, orbSpeed: 4.5, horizontalSpread: 0.75, verticalSpread: 0.55,
  obstacleChance: 0.32, heavyOrbChance: 0, minPunchSpeed: 1.6, directionalChance: 0.4, crossBodyChance: 0.25,
});

const ramp = (t, start) => (t <= start ? 0 : (t - start) / (1 - start));

/** Map intensity 0..1 to concrete gameplay numbers. */
export function evaluateDifficulty(intensity, easy = EASY, hard = HARD) {
  const t = clamp01(intensity);
  return {
    intensity: t,
    spawnInterval: Math.exp(lerp(Math.log(easy.spawnInterval), Math.log(hard.spawnInterval), t)),
    orbSpeed: lerp(easy.orbSpeed, hard.orbSpeed, t),
    horizontalSpread: lerp(easy.horizontalSpread, hard.horizontalSpread, t),
    verticalSpread: lerp(easy.verticalSpread, hard.verticalSpread, t),
    obstacleChance: lerp(easy.obstacleChance, hard.obstacleChance, ramp(t, 0.3)),
    heavyOrbChance: lerp(easy.heavyOrbChance, hard.heavyOrbChance, ramp(t, 0.5)),
    minPunchSpeed: lerp(easy.minPunchSpeed, hard.minPunchSpeed, t),
    // Swing-direction orbs (uppercuts / hooks) from medium intensity.
    directionalChance: lerp(easy.directionalChance, hard.directionalChance, ramp(t, 0.35)),
    // Cross-body punches (left hand on the right side) twist the core; hard intensities only.
    crossBodyChance: lerp(easy.crossBodyChance, hard.crossBodyChance, ramp(t, 0.6)),
  };
}

/** Tanaka estimate of max heart rate. */
export const estimatedMaxBpm = (age) => 208 - 0.7 * age;

// ---------------------------------------------------------------- walls (dodge / duck / squat)

/**
 * Wall types and the intensity at which each unlocks. Each wall is a blocking polygon in the
 * plane it flies through (x = metres right of your starting position, y = metres up).
 * Your head must be in the open part when the wall reaches you.
 */
export const WALL_TYPES = Object.freeze([
  { type: 'duck', label: 'Duck!', from: 0.3 },
  { type: 'pillar', label: 'Step aside!', from: 0.35 },
  { type: 'dodgeLeft', label: 'Lean left!', from: 0.4 },
  { type: 'dodgeRight', label: 'Lean right!', from: 0.4 },
  { type: 'squatLeft', label: 'Squat left!', from: 0.55 },
  { type: 'squatRight', label: 'Squat right!', from: 0.55 },
]);

/** Which wall to send at this intensity (rng returns 0..1). Unlocked types are equally likely. */
export function pickWallType(intensity, rng = Math.random) {
  const open = WALL_TYPES.filter((w) => intensity >= w.from);
  if (!open.length) return null;
  return open[Math.min(open.length - 1, Math.floor(rng() * open.length))].type;
}

/** Blocking polygon [[x, y], ...] for a wall, given the player's standing head height. */
export function wallPolygon(type, standing) {
  const W = 1.3, TOP = Math.max(2.4, standing + 0.6);
  const duckY = standing - 0.22;   // head must drop ~30 cm
  const squatY = standing - 0.32;  // a bit deeper for the side squats
  switch (type) {
    case 'duck': return [[-W, duckY], [W, duckY], [W, TOP], [-W, TOP]];
    case 'pillar': return [[-0.22, 0], [0.22, 0], [0.22, TOP], [-0.22, TOP]];
    case 'dodgeLeft': return [[-0.12, 0], [W, 0], [W, TOP], [-0.12, TOP]];   // wall on the right: go left
    case 'dodgeRight': return [[-W, 0], [0.12, 0], [0.12, TOP], [-W, TOP]];  // wall on the left: go right
    case 'squatLeft': return [[-W, squatY], [-0.05, squatY], [-0.05, 0], [W, 0], [W, TOP], [-W, TOP]]; // open low-left
    case 'squatRight': return [[W, squatY], [0.05, squatY], [0.05, 0], [-W, 0], [-W, TOP], [W, TOP]];   // open low-right
    default: return null;
  }
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True if a head (sphere of radius r at x, y) touches the wall polygon. */
export function wallHitsHead(poly, x, y, r = 0.09) {
  if (!poly) return false;
  if (pointInPolygon(x, y, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distToSegment(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) < r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- orbs: hands and swing directions

/** Unit vectors for the swing an arrow orb asks for (x right, y up, z toward the player). */
export const SWING = Object.freeze({
  up: [0, 1, 0],     // uppercut
  left: [-1, 0, 0],  // hook travelling right-to-left
  right: [1, 0, 0],  // hook travelling left-to-right
});

/**
 * Choose which hand an orb belongs to and whether it needs a particular swing.
 * Orbs on your left are for the left hand, unless it's a cross-body orb.
 */
export function planOrb(x, d, rng = Math.random) {
  let hand = x < 0 ? 'left' : 'right';
  if (rng() < d.crossBodyChance) hand = hand === 'left' ? 'right' : 'left';
  let swing = null;
  if (rng() < d.directionalChance) {
    // Hooks come from the outside in: right hand hooks leftward, left hand hooks rightward.
    swing = rng() < 0.5 ? 'up' : (hand === 'right' ? 'left' : 'right');
  }
  return { hand, swing };
}

/** Did a fist moving with velocity v ([x, y, z]) swing the right way? */
export function swingMatches(swing, v, minDot = 0.45) {
  if (!swing) return true;
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-6) return false;
  const s = SWING[swing];
  return (v[0] * s[0] + v[1] * s[1] + v[2] * s[2]) / len >= minDot;
}

// ---------------------------------------------------------------- heart thermometer

/**
 * Target looks for the heat gauge: how frosty / flaming / hyper it should be (0..1 each).
 * Frost grows the further below the zone you are; above the zone it's a hyper flame.
 */
export function heatLook(status, bpm, target) {
  switch (status) {
    case 'InZone': return { cold: 0, flame: 1, hyper: 0 };
    case 'Below': return { cold: clamp((target - bpm) / 20, 0.35, 1), flame: 0, hyper: 0 };
    case 'Above': return { cold: 0, flame: 0.4, hyper: clamp((bpm - target) / 15, 0.5, 1) };
    case 'SafetyBrake': return { cold: 0, flame: 0.3, hyper: 1 };
    default: return { cold: 0, flame: 0, hyper: 0 };
  }
}

// ---------------------------------------------------------------- activity mix (what the game sends)

/**
 * Everything the game can send at you. `from` = intensity at which it unlocks;
 * `base` = how often it appears relative to the others; `prior` = starting guess of how much it
 * raises heart rate (BPM per 1 rep/minute sustained), refined by HeartRateAttribution as you play.
 */
export const ACTIVITIES = Object.freeze([
  { key: 'jab', label: 'Punches', kind: 'orb', from: 0, base: 1.0, prior: 0.5 },
  { key: 'low', label: 'Squat punches', kind: 'orb', from: 0.2, base: 0.45, prior: 1.2 },
  { key: 'swing', label: 'Hooks & uppercuts', kind: 'orb', from: 0.25, base: 0.5, prior: 0.7 },
  { key: 'duck', label: 'Ducks', kind: 'wall', from: 0.15, base: 0.3, prior: 1.2 },
  { key: 'lateral', label: 'Side steps', kind: 'wall', from: 0.25, base: 0.35, prior: 1.0 },
  { key: 'squatSide', label: 'Side squats', kind: 'wall', from: 0.4, base: 0.3, prior: 1.6 },
  { key: 'trace', label: 'Rope tracing', kind: 'orb', from: 0.2, base: 0.35, prior: 0.8 },
  // Full-body power moves. Bursts (speed bag, battle ropes) are short all-out efforts
  // that the challenge boost leans on when your heart rate is stuck.
  { key: 'power', label: 'Power punches', kind: 'orb', from: 0.3, base: 0.3, prior: 0.9 },
  { key: 'pair', label: 'Squat + reach', kind: 'orb', from: 0.3, base: 0.3, prior: 1.4 },
  { key: 'guard', label: 'Guard & counter', kind: 'orb', from: 0.3, base: 0.25, prior: 0.9 },
  { key: 'bag', label: 'Speed bag', kind: 'burst', from: 0.35, base: 0.1, prior: 0.3 },     // per punch on the bag
  { key: 'ropes', label: 'Battle ropes', kind: 'burst', from: 0.45, base: 0.1, prior: 1.6 }, // per second of pumping
]);
export const ACTIVITY_KEYS = ACTIVITIES.map((a) => a.key);

/**
 * Pick the next thing to send.
 * - Below your zone: favour what has raised YOUR heart rate the most (learned gains), more so
 *   the longer you've been stuck (boost). Walls and squat punches get extra weight under boost.
 * - Above your zone: favour plain punches (easy on the legs) so you can come down.
 * `baseWeights` lets the developer panel override the mix.
 */
export function chooseActivity({ intensity, status, boost = 0, gains = null, baseWeights = null, enabled = null, rng = Math.random }) {
  const weights = ACTIVITIES.map((a) => {
    if (enabled && enabled[a.key] === false) return 0; // turned off in options
    let unlock = clamp01((intensity - a.from) / 0.1 + (a.from === 0 ? 1 : 0));
    if (a.kind === 'burst' && status === 'Below') unlock = Math.max(unlock, clamp01((boost - 0.2) / 0.2)); // stuck: bursts open up early
    let w = (baseWeights?.[a.key] ?? a.base) * unlock;
    if (w <= 0) return 0;
    if (status === 'Below') {
      if (gains) {
        const g = gains[a.key] ?? a.prior;
        const mean = ACTIVITIES.reduce((s, b) => s + (gains[b.key] ?? b.prior), 0) / ACTIVITIES.length || 1e-6;
        w *= Math.exp((0.5 + 0.7 * boost) * clamp((g - mean) / Math.max(mean, 0.05), -1, 1));
      }
      if (a.key !== 'jab') w *= 1 + 1.2 * boost;
      if (a.kind === 'burst') w *= 1 + 5 * boost; // the boost's main tool: pour effort into a bag or ropes
      w = Math.max(w, 0.12 * (baseWeights?.[a.key] ?? a.base) * unlock); // always keep some variety
    } else if (status === 'Above' || status === 'SafetyBrake') {
      if (a.key !== 'jab') w *= a.kind === 'burst' ? 0.05 : 0.35;
    } else if (a.kind === 'burst') {
      w *= 0.5; // in the zone: an occasional burst for variety
    }
    return w;
  });
  let total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    // Nothing allowed is unlocked yet (e.g. the player picked only ducks): ignore unlock levels
    // and use whatever moves are switched on.
    ACTIVITIES.forEach((a, i) => { weights[i] = enabled && enabled[a.key] === false ? 0 : (baseWeights?.[a.key] ?? a.base); });
    total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return 'jab'; // everything switched off: fall back to punches
  }
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return ACTIVITIES[i].key;
  }
  return 'jab';
}

/**
 * Which concrete wall shape an activity uses. `allow` can switch off side leans or the centre
 * pillar (the two shapes behind "side steps").
 */
export function wallTypeFor(activity, rng = Math.random, allow = { lean: true, pillar: true }) {
  if (activity === 'duck') return 'duck';
  if (activity === 'lateral') {
    const shapes = [...(allow.pillar !== false ? ['pillar'] : []), ...(allow.lean !== false ? ['dodgeLeft', 'dodgeRight'] : [])];
    return shapes.length ? shapes[Math.floor(rng() * shapes.length) % shapes.length] : null;
  }
  if (activity === 'squatSide') return rng() < 0.5 ? 'squatLeft' : 'squatRight';
  return null;
}

/** Walls are boxes: their length is how long you must hold the position (seconds at wall speed). */
export const WALL_HOLD_SECONDS = Object.freeze({ duck: 1.2, squatLeft: 1.0, squatRight: 1.0, dodgeLeft: 0.8, dodgeRight: 0.8, pillar: 0.6 });
export const wallDepth = (type, speed) => Math.max(0.4, (WALL_HOLD_SECONDS[type] ?? 0.8) * speed);

// ---------------------------------------------------------------- tracing orbs (follow the string)

/**
 * Control points for a tracing orb's path, in the plane at arm's reach (x right of centre,
 * y height). It dips low enough to need a squat and swings side to side.
 */
export function tracePath(standing, rng = Math.random, points = 5) {
  const out = [];
  let x = (rng() - 0.5) * 0.3;
  for (let i = 0; i < points; i++) {
    x = clamp(x + (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.3), -0.5, 0.5);
    const y = clamp(standing - 0.35 + (rng() - 0.6) * 0.75, standing - 0.95, standing - 0.05);
    out.push([x, y]);
  }
  return out;
}

/** How long a trace lasts: slower when easy, quicker when hard. */
export const traceSeconds = (intensity) => lerp(4.5, 2.6, clamp01(intensity));

/** Points for a trace from the fraction of time your hand stayed on the orb. */
export const tracePoints = (fraction) => Math.round(50 * clamp01(fraction) ** 1.5);

// ---------------------------------------------------------------- lane timeline (spacing between obstacles)

/**
 * Everything flies down one lane, so the game books a time slot for when each thing reaches you.
 * Plain orbs can share the lane with other plain orbs; everything else ("solo": walls, ropes,
 * power orbs, pairs, guard + counter) gets the lane to itself, with a little breathing room
 * before and after. Because things spawn at the same distance, a new thing must also arrive
 * after every solo thing already on its way, or it would fly through it.
 */
export const SPAWN_DISTANCE = 14;
export function lanePlan(activity, { now = 0, speed, intensity = 0.5, depth = 0 }) {
  const orbArrive = now + (SPAWN_DISTANCE - 0.5) / speed;
  switch (activity) {
    case 'jab': case 'low': case 'swing':
      return { kind: 'orb', start: orbArrive - 0.3, end: orbArrive + 0.3 };
    case 'power':
      return { kind: 'solo', start: orbArrive - 0.7, end: orbArrive + 0.6 };
    case 'pair':   // low orb, then the high one 0.85 s later
      return { kind: 'solo', start: orbArrive - 0.6, end: orbArrive + 0.85 + 0.6 };
    case 'guard': { // the hot shot, then a counter orb from close range
      const gs = speed * 0.9, cs = Math.max(2.5, speed);
      const arrive = now + (SPAWN_DISTANCE - 0.35) / gs;
      return { kind: 'solo', start: arrive - 0.8, end: arrive + COUNTER_DISTANCE / cs + 0.6 };
    }
    case 'trace': {
      const ts = Math.max(2.2, speed * 0.85);
      const front = now + (SPAWN_DISTANCE - 0.5) / ts;
      const tail = front + traceSeconds(intensity);
      return { kind: 'solo', start: front - 0.9, end: tail + 0.7 };
    }
    case 'duck': case 'lateral': case 'squatSide': {
      const ws = speed * 0.8;
      return { kind: 'solo', start: now + SPAWN_DISTANCE / ws - 0.7, end: now + (SPAWN_DISTANCE + depth) / ws + 0.6 };
    }
    default: return null;
  }
}
/** Can `plan` be added to the booked `lane` slots without crowding anything? */
export function laneFree(lane, plan) {
  if (!plan) return true;
  return lane.every((r) => (r.kind === 'orb' && plan.kind === 'orb') || plan.start >= r.end);
}
export const COUNTER_DISTANCE = 3.5;

// ---------------------------------------------------------------- punch quality (anti wrist-flick)

/**
 * How far (metres) a fist must have travelled in the last ~0.15 s for a hit to count in Punch
 * mode, so flicking the wrist at an orb doesn't pop it. Power orbs need a full punch.
 */
export const minPunchTravel = (intensity, power = false) => (power ? 0.32 : lerp(0.13, 0.22, clamp01(intensity)));
/** Speed (m/s) a power orb needs, given the normal minimum punch speed. */
export const powerPunchSpeed = (minPunch) => Math.max(2.2, minPunch * 1.6);
/** 0..1 "how strong was that punch" from fist speed and travel, used for points, sound and haptics. */
export const punchPower = (speed, travel) => clamp01(0.55 * clamp01((speed - 1) / 3.5) + 0.45 * clamp01((travel - 0.1) / 0.35));

/** Speed bag: points for a burst of hits (5 each, more for a big flurry). */
export const bagPoints = (hits) => Math.round(5 * hits + 2 * Math.max(0, hits - 15));
/** Battle ropes: is a hand pumping hard enough? (smoothed vertical speed, m/s) */
export const ROPE_PUMP_SPEED = 0.7;

// ---------------------------------------------------------------- challenge boost (when you're stuck)

/**
 * Grows while you're below your zone and your heart rate isn't climbing (or the game is already
 * at full intensity), shrinks once you're in the zone. 0 = normal, 1 = maximum extra challenge:
 * faster spawns, more walls and squat punches.
 */
export class ChallengeBoost {
  constructor({ riseSeconds = 45, inZoneFallSeconds = 90, aboveFallSeconds = 15 } = {}) {
    this.value = 0;
    this.riseSeconds = riseSeconds;
    this.inZoneFallSeconds = inZoneFallSeconds;
    this.aboveFallSeconds = aboveFallSeconds;
    this.stuckSeconds = 0;
  }

  update(dt, { status, intensity, bpmTrend }) {
    // "Stuck": below the zone and HR rising slower than ~2 BPM per 10 s, or game already maxed out.
    const stuck = status === 'Below' && (bpmTrend < 0.2 || intensity > 0.9);
    this.stuckSeconds = stuck ? this.stuckSeconds + dt : 0;
    if (stuck && this.stuckSeconds > 15) this.value += dt / this.riseSeconds;
    else if (status === 'InZone') this.value -= dt / this.inZoneFallSeconds;
    else if (status === 'Above' || status === 'SafetyBrake' || status === 'NoSignal') this.value -= dt / this.aboveFallSeconds;
    this.value = clamp01(this.value);
    return this.value;
  }
}

/** Apply boost on top of the normal difficulty. */
export function boostDifficulty(d, boost) {
  return {
    ...d,
    spawnInterval: d.spawnInterval * (1 - 0.35 * boost),
    orbSpeed: d.orbSpeed * (1 + 0.12 * boost),
    horizontalSpread: Math.min(0.9, d.horizontalSpread + 0.15 * boost),
  };
}

// ---------------------------------------------------------------- learning what raises YOUR heart rate

/**
 * Online estimate of how much each activity raises YOUR heart rate.
 * Model: heart rate ~= resting level + sum over activities of gain x recent rate of that activity
 * (reps per minute, smoothed over ~35 s because the heart lags effort). Every couple of seconds
 * the gains are nudged to explain the current BPM (normalised least-mean-squares). Gains read as
 * "BPM added per 1 rep/minute sustained". Noisy by nature: a trend that firms up over workouts.
 */
export class HeartRateAttribution {
  constructor({ tauSeconds = 35, learningRate = 0.08, weights = null } = {}) {
    this.tau = tauSeconds;
    this.lr = learningRate;
    // Saved estimates are blended 70/30 with the starting guesses so one odd workout can't dominate.
    this.prior = Object.fromEntries(ACTIVITIES.map((a) => [a.key, a.prior]));
    this.w = Object.fromEntries(ACTIVITIES.map((a) => [a.key, weights?.[a.key] != null ? 0.7 * weights[a.key] + 0.3 * a.prior : a.prior]));
    this.rate = Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 0])); // smoothed reps/min
    this.counts = Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 0]));
    this.base = null;          // learned resting-ish level
    this.lastT = null;
    this.lastUpdate = -Infinity;
    this.updates = 0;
  }

  decayTo(t) {
    if (this.lastT != null && t > this.lastT) {
      const f = Math.exp(-(t - this.lastT) / this.tau);
      for (const k of ACTIVITY_KEYS) this.rate[k] *= f;
    }
    this.lastT = t;
  }

  record(key, t) {
    if (!(key in this.w)) return;
    this.decayTo(t);
    this.rate[key] += 60 / this.tau; // a steady r reps/min settles at rate = r
    this.counts[key]++;
  }

  /** Call every frame (or second) with the current time (s) and BPM (null if no signal). */
  update(t, bpm, intervalSeconds = 2) {
    this.decayTo(t);
    if (bpm == null || t - this.lastUpdate < intervalSeconds) return false;
    this.lastUpdate = t;
    if (this.base == null) this.base = bpm;
    let pred = this.base, norm = 1;
    for (const k of ACTIVITY_KEYS) { pred += this.w[k] * this.rate[k]; norm += this.rate[k] ** 2; }
    const err = bpm - pred;
    for (const k of ACTIVITY_KEYS) {
      if (this.rate[k] < 0.05) continue;
      // Floor at a quarter of the starting guess: every activity does *something*, and it keeps
      // the ranking meaningful when heart rate is flat for reasons the game can't see.
      this.w[k] = clamp(this.w[k] + (this.lr * err * this.rate[k]) / norm, 0.25 * this.prior[k], 6);
    }
    // The baseline (resting-ish level) absorbs part of every error, more when you're barely moving.
    const active = ACTIVITY_KEYS.reduce((s, k) => s + this.rate[k], 0);
    this.base = clamp(this.base + err * (active < 3 ? 0.05 : 0.015), 40, 160);
    this.updates++;
    return true;
  }

  /** Activities sorted by estimated effect: BPM added per 10 reps/minute, plus this session's reps. */
  ranking() {
    return ACTIVITIES.map((a) => ({ key: a.key, label: a.label, bpmPer10: this.w[a.key] * 10, reps: this.counts[a.key] }))
      .sort((p, q) => q.bpmPer10 - p.bpmPer10);
  }
}

// ---------------------------------------------------------------- music tempo as a pacing cue

/**
 * Song tempo (beats per minute): rises with game intensity, and leads you — faster when you
 * need to pick it up, slower when you need to ease off.
 */
export function musicTempo({ intensity, status, bpm, target }) {
  let tempo = 96 + 44 * clamp01(intensity);
  if (status === 'Below' && bpm) tempo += clamp((target - bpm) * 0.8, 4, 22);
  else if (status === 'Above' && bpm) tempo -= clamp((bpm - target) * 1.5, 8, 30);
  else if (status === 'SafetyBrake') tempo = 78;
  return clamp(tempo, 70, 165);
}
