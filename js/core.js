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

/**
 * Workout shapes (the target during training, relative to your chosen target):
 * - steady: flat.
 * - waves: rolls between +5 and -5 BPM on a 6-minute cycle (about 2.5 min up, 2.5 min down, smooth
 *   ~40 s changes). Minutes-long, because heart rate lags effort by 30-40 s.
 * - build: starts 6 BPM easier and climbs steadily to 6 BPM harder by 80% of the training time.
 */
export const PROFILES = Object.freeze(['steady', 'waves', 'build']);
export function profileOffset(profile, t, total = 900) {
  if (profile === 'waves') return 5 * clamp(Math.sin((2 * Math.PI * t) / 360) * 1.6, -1, 1);
  if (profile === 'build') return lerp(-6, 6, clamp01(t / Math.max(60, 0.8 * total)));
  return 0;
}

export function defaultZoneSettings() {
  return {
    targetBpm: 120,
    profile: 'steady',   // workout shape during training: 'steady' | 'waves' | 'build'
    zoneHalfWidth: 5,
    safetyCeilingBpm: 160,
    warmUpSeconds: 120,
    trainingSeconds: 900,
    coolDownSeconds: 120,
    startIntensity: 0.25,
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

  /** End the workout right now (skips whatever is left of the cool-down). */
  finishNow() {
    if (this.phase !== Phase.Finished) this.enterPhase(Phase.Finished);
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
    const setpointRate = this.phase === Phase.WarmUp || this.phase === Phase.Training ? this.setpointRampRate() : 0;
    const errorTrend = setpointRate - this.bpmTrend;
    const p = s.kp * error;
    const d = s.kd * errorTrend;
    // Catch-up: well below your zone and your heart rate isn't climbing yet, so build intensity
    // faster (heart rate lags effort by 30-60 s; the trend check stops it piling on once it's rising).
    const behind = error > 2 * s.zoneHalfWidth && this.bpmTrend < 0.25;
    const candidateIntegral = this.integral + s.ki * (behind ? 3 : 1) * error * dt;
    const unclamped = candidateIntegral + p + d;
    const desired = clamp(unclamped, s.minIntensity, s.maxIntensity);
    const saturatedHigh = unclamped > s.maxIntensity && error > 0;
    const saturatedLow = unclamped < s.minIntensity && error < 0;
    if (!saturatedHigh && !saturatedLow) this.integral = candidateIntegral;
    this.integral = clamp(this.integral, s.minIntensity, s.maxIntensity);
    this.intensity = this.step(this.intensity, desired, dt, behind ? 1.5 : 1);
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
    if (this.phase === Phase.Training) return this.trainingTarget(this.phaseElapsedSeconds);
    if (this.phase !== Phase.WarmUp) return s.targetBpm;
    // Warm up toward where training will start (with Build & peak that's below your target).
    const goal = this.trainingTarget(0);
    const start = Number.isNaN(this.warmUpStartBpm) ? goal : Math.min(this.warmUpStartBpm, goal);
    // Ease-out: most of the climb happens early, so you reach your zone sooner.
    const t = clamp01(this.phaseElapsedSeconds / Math.max(1, s.warmUpSeconds));
    return lerp(start, goal, 1 - (1 - t) ** 2);
  }

  /** Training target at time t (s into training): your target plus the workout shape, kept under the ceiling. */
  trainingTarget(t) {
    const s = this.s;
    return Math.min(s.targetBpm + profileOffset(s.profile, t, s.trainingSeconds), s.safetyCeilingBpm - 8);
  }

  setpointRampRate() {
    const s = this.s;
    // Training with a shaped workout: how fast the target is moving (feeds the controller's D term).
    if (this.phase === Phase.Training) return this.trainingTarget(this.phaseElapsedSeconds + 1) - this.trainingTarget(this.phaseElapsedSeconds);
    if (Number.isNaN(this.warmUpStartBpm) || this.phaseElapsedSeconds >= s.warmUpSeconds) return 0;
    const t = this.phaseElapsedSeconds / Math.max(1, s.warmUpSeconds);
    return (2 * (1 - t) * Math.max(0, this.trainingTarget(0) - this.warmUpStartBpm)) / Math.max(1, s.warmUpSeconds);
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
  spawnInterval: 2.2, orbSpeed: 1.6, horizontalSpread: 0.2, verticalSpread: 0.1,
  obstacleChance: 0, heavyOrbChance: 0, minPunchSpeed: 0.6, directionalChance: 0, crossBodyChance: 0,
});
export const HARD = Object.freeze({
  spawnInterval: 0.45, orbSpeed: 4.5, horizontalSpread: 0.45, verticalSpread: 0.55, // narrower after play-testing: less reaching
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
  // Follow-up only (never picked at random): a low box after every squat box, so you have to
  // stand all the way up instead of staying down for the next one.
  { type: 'rise', label: 'Stand tall!', from: 0, followUp: true },
]);
/** Boxes you get under by squatting or ducking: each one is followed by a "Stand tall!" box. */
export const LOW_WALLS = Object.freeze(['duck', 'squatLeft', 'squatRight']);

/** Which wall to send at this intensity (rng returns 0..1). Unlocked types are equally likely. */
export function pickWallType(intensity, rng = Math.random) {
  const open = WALL_TYPES.filter((w) => !w.followUp && intensity >= w.from);
  if (!open.length) return null;
  return open[Math.min(open.length - 1, Math.floor(rng() * open.length))].type;
}

/** Blocking polygon [[x, y], ...] for a wall, given the player's standing head height. */
export function wallPolygon(type, standing) {
  const W = 1.3, TOP = Math.max(2.4, standing + 0.6);
  const duckY = standing - 0.22;   // head must drop ~30 cm
  const squatY = standing - 0.32;  // a bit deeper for the side squats
  const riseY = standing - 0.25;   // stand tall: head (radius 9 cm) clears it within ~16 cm of full height
  switch (type) {
    case 'duck': return [[-W, duckY], [W, duckY], [W, TOP], [-W, TOP]];
    case 'pillar': return [[-0.22, 0], [0.22, 0], [0.22, TOP], [-0.22, TOP]];
    case 'dodgeLeft': return [[-0.12, 0], [W, 0], [W, TOP], [-0.12, TOP]];   // wall on the right: go left
    case 'dodgeRight': return [[-W, 0], [0.12, 0], [0.12, TOP], [-W, TOP]];  // wall on the left: go right
    case 'squatLeft': return [[-W, squatY], [-0.05, squatY], [-0.05, 0], [W, 0], [W, TOP], [-W, TOP]]; // open low-left
    case 'squatRight': return [[W, squatY], [0.05, squatY], [0.05, 0], [-W, 0], [-W, TOP], [W, TOP]];   // open low-right
    case 'rise': return [[-W, 0], [W, 0], [W, riseY], [-W, riseY]];                                   // keep your head above it
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
  down: [0, -1, 0],  // hammer fist: bring the bottom of your fist straight down
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
  { key: 'low', label: 'Squat punches', kind: 'orb', from: 0.15, base: 0.55, prior: 1.2 },
  { key: 'swing', label: 'Hooks & uppercuts', kind: 'orb', from: 0.25, base: 0.5, prior: 0.7 },
  { key: 'duck', label: 'Ducks', kind: 'wall', from: 0.15, base: 0.3, prior: 1.2 },
  { key: 'lateral', label: 'Side steps', kind: 'wall', from: 0.25, base: 0.35, prior: 1.0 },
  { key: 'squatSide', label: 'Side squats', kind: 'wall', from: 0.4, base: 0.3, prior: 1.6 },
  { key: 'trace', label: 'Rope tracing', kind: 'orb', from: 0.2, base: 0.35, prior: 0.8 },
  // Two ropes side by side, one per hand, sweeping wide left/right and dipping low: whole-body.
  { key: 'sweep', label: 'Two-hand rope', kind: 'orb', from: 0.3, base: 0.25, prior: 1.2 },
  // Full-body power moves. Bursts (speed bag, battle ropes) are short all-out efforts
  // that the challenge boost leans on when your heart rate is stuck.
  { key: 'power', label: 'Power punches', kind: 'orb', from: 0.3, base: 0.3, prior: 0.9 },
  { key: 'pair', label: 'Squat + reach', kind: 'orb', from: 0.25, base: 0.45, prior: 1.4 },
  { key: 'guard', label: 'Guard & counter', kind: 'orb', from: 0.3, base: 0.25, prior: 0.9 },
  // Drum pads (a left-right pair) at chest height, or low for a squat: strike DOWN with the bottom of your fist.
  { key: 'hammer', label: 'Hammer fists', kind: 'orb', from: 0.15, base: 0.55, prior: 1.0 },
  // Whole-body stations: they stop just in front of you and wait while you do the move (see STATIONS).
  { key: 'knee', label: 'Knee drives', kind: 'station', from: 0.3, base: 0.25, prior: 1.5 },
  // A wall-ball ROUND holds the lane for 20-30 s, so it's sent rarely in the normal mix (charges send it on purpose).
  { key: 'press', label: 'Wall-ball rounds', kind: 'station', from: 0.3, base: 0.07, prior: 1.6 },
  { key: 'chop', label: 'Woodchoppers', kind: 'station', from: 0.25, base: 0.25, prior: 1.2 },
  { key: 'tiptoe', label: 'Tiptoe reach', kind: 'station', from: 0.15, base: 0.2, prior: 0.6 },
  { key: 'bag', label: 'Speed bag', kind: 'burst', from: 0.35, base: 0.1, prior: 0.3 },     // per punch on the bag
  { key: 'ropes', label: 'Battle ropes', kind: 'burst', from: 0.45, base: 0.1, prior: 1.6 }, // per second of pumping
  { key: 'heavy', label: 'Heavy bag', kind: 'burst', from: 0.4, base: 0.1, prior: 0.9 },    // per strong punch (hooks, uppercuts)
  { key: 'sled', label: 'Sled run', kind: 'burst', from: 0.45, base: 0.1, prior: 1.5 },     // per double-pole stroke in a tuck
  // Core work: bombs aimed at your head; lean, duck and shift out of the way.
  { key: 'barrage', label: 'Dodge barrage', kind: 'dodge', from: 0.3, base: 0.25, prior: 1.3 },
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
  if (activity === 'stand') return 'rise';
  return null;
}

/** Walls are boxes: their length is how long you must hold the position (seconds at wall speed). */
export const WALL_HOLD_SECONDS = Object.freeze({ rise: 0.6, duck: 1.2, squatLeft: 1.0, squatRight: 1.0, dodgeLeft: 0.8, dodgeRight: 0.8, pillar: 0.6 });
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

/**
 * Centre line for the two-hand rope: big sweeps from one side to the other (you step and shift
 * your weight) with dips that need a squat. Each hand follows a rope SWEEP_HALF_GAP either side.
 */
export const SWEEP_HALF_GAP = 0.22;
export function sweepPath(standing, rng = Math.random, points = 6) {
  const out = [];
  let side = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < points; i++) {
    const x = i === 0 ? side * 0.15 : side * (0.35 + rng() * 0.25);
    const y = i % 2 ? standing - 0.6 - rng() * 0.25 : standing - 0.25 - rng() * 0.15;
    out.push([x, y]);
    side = -side;
  }
  return out;
}

/** How long a trace lasts: slower when easy, quicker when hard. The two-hand rope runs a bit longer. */
export const traceSeconds = (intensity) => lerp(4.5, 2.6, clamp01(intensity));
export const sweepSeconds = (intensity) => traceSeconds(intensity) * 1.3;

/**
 * How close your hand must be to count as "on the rope": within TRACE_RADIUS (sideways/up-down)
 * of the rope, measured anywhere within TRACE_DEPTH in front of or behind the ring. Once on, you
 * stay on until you drift past TRACE_RELEASE, so a wobble doesn't break the streak.
 */
export const TRACE_RADIUS = 0.2, TRACE_RELEASE = 0.27, TRACE_DEPTH = 0.35;
export function onRope(wasOn, dxy, dz) {
  if (Math.abs(dz) > TRACE_DEPTH + (wasOn ? 0.1 : 0)) return false;
  return dxy < (wasOn ? TRACE_RELEASE : TRACE_RADIUS);
}

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
/** Seconds between the two pads of a hammer-fist pair. */
export const HAMMER_GAP = 0.8;
export function lanePlan(activity, { now = 0, speed, intensity = 0.5, depth = 0, dist = SPAWN_DISTANCE, shots = 1 }) {
  const orbArrive = now + (SPAWN_DISTANCE - 0.5) / speed;
  switch (activity) {
    case 'jab': case 'low':
      return { kind: 'orb', start: orbArrive - 0.3, end: orbArrive + 0.3 };
    case 'swing': // hooks and uppercuts get the lane to themselves, so you can recover
      return { kind: 'solo', start: orbArrive - 0.45, end: orbArrive + 0.55 };
    case 'hammer': // two pads, left then right, HAMMER_GAP s apart
      return { kind: 'solo', start: orbArrive - 0.45, end: orbArrive + HAMMER_GAP + 0.55 };
    case 'power':
      return { kind: 'solo', start: orbArrive - 0.7, end: orbArrive + 0.6 };
    case 'pair':   // low orb, then the high one 0.85 s later
      return { kind: 'solo', start: orbArrive - 0.6, end: orbArrive + 0.85 + 0.6 };
    case 'guard': { // the hot shot, then a counter orb from close range
      const gs = speed * 0.9, cs = Math.max(2.5, speed);
      const arrive = now + (SPAWN_DISTANCE - 0.35) / gs;
      return { kind: 'solo', start: arrive - 0.8, end: arrive + GUARD_SEQ_GAP * (shots - 1) + COUNTER_DISTANCE / cs + 0.6 };
    }
    case 'trace': case 'sweep': {
      const ts = Math.max(2.2, speed * 0.85);
      const front = now + (SPAWN_DISTANCE - 0.5) / ts;
      const tail = front + (activity === 'sweep' ? sweepSeconds : traceSeconds)(intensity);
      // The two-hand rope ends with a slam bar SLAM_GAP s after its tail.
      return { kind: 'solo', start: front - 0.9, end: tail + (activity === 'sweep' ? SLAM_GAP : 0) + 0.7 };
    }
    case 'slam': { // after battle ropes: a slam bar sent from closer in (`dist`), so it comes soon
      const arrive = now + (dist - 0.5) / speed;
      return { kind: 'solo', start: arrive - 0.7, end: arrive + 0.7 };
    }
    case 'knee': case 'press': case 'chop': case 'tiptoe': { // flies in, stops in front of you, waits `hold` s
      const arrive = now + (SPAWN_DISTANCE - STATION_STOP) / speed;
      return { kind: 'solo', start: arrive - 0.6, end: arrive + stationHold(activity, intensity) + 0.5 };
    }
    case 'duck': case 'lateral': case 'squatSide': case 'stand': {
      const ws = speed * 0.8;
      return { kind: 'solo', start: now + SPAWN_DISTANCE / ws - 0.7, end: now + (SPAWN_DISTANCE + depth) / ws + 0.6 };
    }
    default: return null;
  }
}
/**
 * Finishing slam (after battle ropes and two-hand ropes): a wide bar at head height that you
 * smash DOWN with both fists together, like a medicine-ball slam.
 */
export const SLAM_GAP = 0.9;          // seconds between a two-hand rope's tail and its slam bar
export const SLAM_BOX = Object.freeze({ x: 0.5, y: 0.24, z: 0.3 }); // half-sizes of the hit zone
export const SLAM_SPEED = 1.1;        // m/s downward a fist needs (Punch mode)
export const SLAM_WINDOW = 0.3;       // both fists within this many seconds
/** Is this fist (position, vertical speed) smashing down through the bar right now? */
export function fistSlams(f, bar, touch = false) {
  return Math.abs(f.x - bar.x) < SLAM_BOX.x && Math.abs(f.y - bar.y) < SLAM_BOX.y && Math.abs(f.z - bar.z) < SLAM_BOX.z
    && (touch || f.vy < -SLAM_SPEED);
}
/** Both fists came down on it close enough together? (times in seconds, null = not yet) */
export const slamTogether = (tLeft, tRight) => tLeft != null && tRight != null && Math.abs(tLeft - tRight) <= SLAM_WINDOW;

/**
 * Side shifts (footwork): when you're below the zone, plain orbs come 35 cm to one side for 8 s,
 * so you take a wide side step and punch from there. Walls, ropes and bursts stay centred and
 * wait until the shift is over (the shift books an orb-only slot in the lane).
 */
export const SHIFT = Object.freeze({ offset: 0.35, seconds: 8, cooldown: 30, margin: 0.6 });
export function shiftWanted({ status, phase, intensity, boost = 0, now, readyAt }) {
  return status === 'Below' && phase === 'Training' && now >= readyAt && (intensity >= 0.35 || boost >= 0.2);
}
/** How far sideways an orb arriving at time t should be (0 outside the shift window). */
export const shiftOffsetAt = (plan, t) => (plan && t >= plan.start && t <= plan.end ? plan.offset : 0);

/**
 * Boxing combos: instead of one plain punch, sometimes a short combination lands on the music's
 * beat (one orb per beat). Each step is [hand, kind] with kind jab / hook / upper / low.
 */
export const COMBOS = Object.freeze([
  { name: '1-2', steps: [['left', 'jab'], ['right', 'jab']] },
  { name: '1-1-2', steps: [['left', 'jab'], ['left', 'jab'], ['right', 'jab']] },
  { name: '1-2-hook', steps: [['left', 'jab'], ['right', 'jab'], ['left', 'hook']] },
  { name: '1-2-1-upper', steps: [['left', 'jab'], ['right', 'jab'], ['left', 'jab'], ['right', 'upper']] },
  { name: 'squat-squat-hook-hook', steps: [['left', 'low'], ['right', 'low'], ['left', 'hook'], ['right', 'hook']] },
]);
/** Combos that only use moves you have (hooks/uppercuts need swings; squat combos need squat punches). */
export function availableCombos({ swing = true, low = true } = {}) {
  return COMBOS.filter((c) => c.steps.every(([, k]) => (k === 'hook' || k === 'upper' ? swing : k === 'low' ? low : true)));
}
/** Seconds between combo punches: one beat, or two when the music is fast (never under 0.45 s). */
export function comboGap(tempo) {
  const beat = 60 / Math.max(60, tempo || 120);
  return beat < 0.45 ? beat * 2 : beat;
}
/** Chance that a plain punch becomes a combo: none when it's easy, more as intensity rises. */
export const comboChance = (intensity) => (intensity < 0.25 ? 0 : 0.25 + 0.35 * clamp01(intensity));
/** Lane slot for a combo whose first punch arrives at `first` (gameTime) with `n` punches `gap` apart. */
export const comboPlan = (first, n, gap) => ({ kind: 'solo', start: first - 0.5, end: first + gap * (n - 1) + 0.5 });

/**
 * Spotlight rounds: every 4 minutes of training (first at 3:00) one move is featured for 60 s
 * (sent 2.5x as often). Below the zone it's one of the moves that raise YOUR heart rate most.
 */
export const SPOTLIGHT = Object.freeze({ first: 180, every: 240, seconds: 60, boost: 2.5 });
export const SPOTLIGHT_MOVES = Object.freeze(['power', 'guard', 'low', 'swing', 'pair', 'sweep', 'trace', 'duck', 'squatSide', 'lateral', 'knee', 'press', 'chop']);
export const SPOTLIGHT_NAMES = Object.freeze({
  power: 'POWER ROUND', guard: 'DEFENCE DRILL', low: 'SQUAT ROUND', swing: 'HOOKS & UPPERCUTS', pair: 'SQUAT + PUNCH UP', hammer: 'HAMMER FISTS',
  sweep: 'TWO-HAND ROPES', trace: 'ROPE ROUND', duck: 'DUCK & WEAVE', squatSide: 'SIDE SQUATS', lateral: 'FOOTWORK',
  knee: 'KNEE DRIVES', press: 'WALL BALLS', chop: 'WOODCHOPPERS', tiptoe: 'TIPTOE ROUND',
});
/** Is a spotlight due at this many seconds into training (given when the last one started)? */
export function spotlightDue(t, lastStart) {
  if (t < SPOTLIGHT.first) return false;
  return lastStart == null || t - lastStart >= SPOTLIGHT.every;
}
/**
 * Pick the featured move from the enabled ones. Below the zone: random among your top 3 by learned
 * gain (what works for you); otherwise any enabled one.
 */
export function pickSpotlight({ enabled, gains = null, below = false, rng = Math.random }) {
  const ok = SPOTLIGHT_MOVES.filter((k) => enabled[k]);
  if (!ok.length) return null;
  let pool = ok;
  if (below && gains) pool = [...ok].sort((a, b) => (gains[b] ?? 0) - (gains[a] ?? 0)).slice(0, 3);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * Dodge barrage (core work): 4-6 bombs aimed near your head, one every ~0.7-0.9 s. Move your head
 * out of the way (lean, duck, shift). A bomb hits if it passes within BOMB_RADIUS of your head.
 */
export const BOMB_RADIUS = 0.2;
export function barrageShape(intensity) {
  const t = clamp01(intensity);
  return { n: 4 + Math.round(2 * t), gap: lerp(0.9, 0.7, t) };
}
export const bombHits = (dx, dy) => Math.hypot(dx, dy) < BOMB_RADIUS;
/** Lane slot for a barrage: like a combo, it gets the lane to itself. */
export const barragePlan = (first, n, gap) => ({ kind: 'solo', start: first - 0.6, end: first + gap * (n - 1) + 0.6 });

/** Heavy bag targets: a glowing patch shows where (and with which hand) to hit next. */
export const HEAVY_TARGETS = Object.freeze([
  { key: 'hookL', hand: 'left', label: 'LEFT HOOK' },
  { key: 'hookR', hand: 'right', label: 'RIGHT HOOK' },
  { key: 'upper', hand: null, label: 'UPPERCUT' },
  { key: 'straight', hand: null, label: 'POWER' },
]);
/** Points for a heavy-bag punch: harder is better, the lit target doubles it. */
export const heavyPoints = (power, onTarget) => Math.round((4 + 8 * clamp01(power)) * (onTarget ? 2 : 1));

/** Sled run: you're "tucked" when your head is at least 15 cm below your standing height. */
export const sledTucked = (headY, standing) => headY < standing - 0.15;

// ---------------------------------------------------------------- whole-body stations

/**
 * Whole-body moves that fly in, stop just in front of you and wait while you do them, all on your
 * centre line (no steps): a pull-down knee drive (grab the bar overhead, pull it to your waist as a
 * knee comes up; 2 reps, alternating knees), a squat-to-ceiling press (wall ball), a woodchopper
 * (both hands from high on one side down to the opposite hip) and a tiptoe reach (2 stars just
 * out of reach). The headset can't see knees or toes, so those are judged from your hands and head.
 * `hold` = seconds it waits once stopped; `reps` = reps it asks for.
 */
export const STATIONS = Object.freeze({
  knee: { hold: 8, reps: 4 },    // alternating knees
  press: { hold: 25, reps: 8, round: true }, // a wall-ball ROUND: hold and reps come from WALLBALL below
  chop: { hold: 7.5, reps: 4 },  // alternating sides
  tiptoe: { hold: 6, reps: 4 },  // alternating hands
});
/**
 * Wall-ball rounds (Morty, 2026-11-17: "three reps is a taster; thirty seconds is a heart-rate
 * event"): squat -> drive up -> press overhead, continuously for 20 s (easy) to 30 s (full
 * intensity), on a beat that ladders from one rep every 3.2 s to one every 2.2 s across the round.
 * Stacks the three biggest heart-rate dials: legs driving up, arms overhead, and cadence.
 */
export const WALLBALL = Object.freeze({ minSeconds: 20, maxSeconds: 30, slowBeat: 3.2, fastBeat: 2.2, onBeat: 0.6 });
/** Seconds a station waits once stopped (the wall-ball round scales with intensity). */
// A non-number intensity (NaN) counts as the default 0.5, so a round always has a finite length.
export const stationHold = (key, intensity = 0.5) => (key === 'press' ? lerp(WALLBALL.minSeconds, WALLBALL.maxSeconds, clamp01(Number.isFinite(intensity) ? intensity : 0.5)) : STATIONS[key].hold);
/** Seconds between wall-ball beats, `frac` (0..1) of the way through the round. */
export const wallBallBeat = (frac) => lerp(WALLBALL.slowBeat, WALLBALL.fastBeat, clamp01(frac));
/** How many beats (reps asked for) fit in a round of `seconds`. */
export function wallBallGoal(seconds) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return 0; // 0 / NaN / Infinity used to loop forever (0/0 = NaN beat)
  let t = 0, n = 0;
  for (;;) { const b = wallBallBeat(t / seconds); if (t + b > seconds + 1e-6) return n; t += b; n++; }
}
export const STATION_STOP = 0.45; // metres in front of your head where a station stops
/** Seconds you get for the second half of a move (pull, press, chop) once the first half is done. */
export const STATION_WINDOW = Object.freeze({ knee: 1.6, press: 1.8, chop: 1.2 });
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Knee drive, part 1: both hands on the bar, anywhere along it (it's 74 cm wide), 28 cm leeway. */
const nearBar = (f, bar) => Math.abs(f.x - bar.x) < 0.45 && Math.hypot(f.y - bar.y, f.z - bar.z) < 0.28;
export const kneeGrab = (L, R, bar) => nearBar(L, bar) && nearBar(R, bar);
/**
 * Part 2: both hands pulled down to chest height or lower, with a small crunch (head 3 cm+ below
 * standing). A long pull (hands down by your waist) counts without the crunch.
 */
export const kneePulled = (L, R, headY, standing) => {
  const high = Math.max(L.y, R.y);
  return high < headY - 0.35 && (headY < standing - 0.03 || high < headY - 0.55);
};
/** Ceiling press, part 1: you're in a squat (head 25 cm+ below standing). */
export const pressLoaded = (headY, standing) => headY < standing - 0.25;
/** Part 2: standing tall again with both fists pushed up above your head. */
export const pressDone = (L, R, headY, standing) => headY > standing - 0.1 && L.y > headY + 0.12 && R.y > headY + 0.12;
/** Woodchopper: both hands on the high orb to start, both down at the opposite hip to finish. */
export const chopGrab = (L, R, orb) => dist3(L, orb) < 0.26 && dist3(R, orb) < 0.26;
export const chopDone = (L, R, hip) => dist3(L, hip) < 0.3 && dist3(R, hip) < 0.3;
/** Tiptoe reach: a hand on the star while your head is 3 cm+ above your usual standing height. */
export const TIPTOE_RADIUS = 0.22; // was 0.17: the star is bigger now and has an arrow up to it
export const tiptoeReached = (fist, star, headY, base) => dist3(fist, star) < TIPTOE_RADIUS && headY >= base + 0.03;
/** How high (above your eyes) to put the tiptoe stars, from how far up you've been seen to reach. */
export const tiptoeHeight = (reachUp) => Math.min(0.65, Math.max(0.4, reachUp + 0.05));

/** Can `plan` be added to the booked `lane` slots without crowding anything? */
export function laneFree(lane, plan) {
  if (!plan) return true;
  return lane.every((r) => (r.kind === 'orb' && plan.kind === 'orb') || plan.start >= r.end);
}
export const COUNTER_DISTANCE = 3.5;

// ---------------------------------------------------------------- directional guard

/** Where a guard shot is aimed, relative to your head (x right, y up), and what to call it. */
export const GUARD_ZONES = {
  high: { dx: 0, dy: -0.08, label: 'FACE', tip: 'both fists by your chin' },
  left: { dx: -0.2, dy: -0.02, label: 'LEFT', tip: 'left fist up by your left temple' },
  right: { dx: 0.2, dy: -0.02, label: 'RIGHT', tip: 'right fist up by your right temple' },
  body: { dx: 0, dy: -0.55, label: 'BODY', tip: 'elbows in, fists down by your ribs' },
};
/** Seconds between the two shots of a 1-2 guard. */
export const GUARD_SEQ_GAP = 0.75;
/** Early on every shot is at your face; side and body shots unlock with intensity. */
export const guardZonesFor = (intensity) => (intensity < 0.25 ? ['high'] : ['high', 'left', 'right', 'body']);
/**
 * Is this zone covered? L and R are your fists relative to your head (metres; x right, y up,
 * z toward you, so in front of your face is z < 0).
 */
export function guardCovers(zone, L, R) {
  const near = (f, r) => Math.hypot(f.x, f.y, f.z) < r;
  const upFront = (f) => near(f, 0.34) && f.z < 0.06 && f.y > -0.42;
  switch (zone) {
    case 'left': return near(L, 0.34) && L.x < -0.1 && L.y > -0.3 && L.y < 0.15 && L.z < 0.1;
    case 'right': return near(R, 0.34) && R.x > 0.1 && R.y > -0.3 && R.y < 0.15 && R.z < 0.1;
    case 'body': return [L, R].every((f) => f.y < -0.3 && f.y > -0.8 && Math.abs(f.x) < 0.35 && f.z < 0.15 && Math.hypot(f.x, f.z) < 0.45);
    default: return upFront(L) && upFront(R);
  }
}

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
/** Battle-rope intensity from your slower arm's pump speed: 0 none, 1 on, 2 hard (x1.5 points), 3 max (x2). */
export const ROPE_HARD = 1.4, ROPE_MAX = 2.2;
export const ROPE_TIER_MULT = Object.freeze([0, 1, 1.5, 2]);
export const ropeTier = (pump) => (pump >= ROPE_MAX ? 3 : pump >= ROPE_HARD ? 2 : pump >= ROPE_PUMP_SPEED ? 1 : 0);

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

  update(dt, { status, intensity, bpmTrend, climbing = false, hold = false }) {
    // hold: the heart-rate reading can't be trusted right now (stuck sensor, phone asleep): never
    // build on it. It still winds down normally if the reading says you're in or above the zone.
    if (hold && status === 'Below') { this.stuckSeconds = 0; return this.value; }
    if (hold) this.stuckSeconds = 0;
    // "Stuck": below the zone and HR rising slower than ~2 BPM per 10 s, or game already maxed out.
    // Not stuck if your effort already points into the zone ('climbing'): your heart just lags,
    // and pushing harder now would overshoot. Then the boost drains instead (~60 s from full).
    const stuck = !climbing && status === 'Below' && (bpmTrend < 0.2 || intensity > 0.9);
    this.stuckSeconds = stuck ? this.stuckSeconds + dt : 0;
    if (climbing && status === 'Below') this.value -= dt / 60;
    else if (stuck && this.stuckSeconds > 15) this.value += dt / this.riseSeconds;
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
    horizontalSpread: Math.min(0.5, d.horizontalSpread + 0.05 * boost),
  };
}

// ---------------------------------------------------------------- charge and coast (use the lag)

/**
 * Charge and coast (Morty, 2026-11-17): instead of fighting the 30-40 s lag between effort and
 * heart rate, make it the skill. Well below the zone and not climbing: a ~30 s all-out CHARGE
 * (a wall-ball round, or battle ropes). Then COAST: light moves while your heart rate keeps rising
 * on its own, and the game scores the LANDING: did it settle inside your zone? Like landing a plane:
 * it also stops the sprint -> overshoot -> crash cycle.
 */
export const CHARGE = Object.freeze({ chargeSeconds: 30, coastMin: 15, coastMax: 45, firstAfter: 60, cooldown: 150, belowBy: 10 });
/** Should a charge start now? (training only, well below the zone, heart rate not already on its way up) */
export function chargeWanted({ phase, status, bpm, target, climbing = false, trainingT, now, readyAt }) {
  return phase === 'Training' && status === 'Below' && !climbing && trainingT >= CHARGE.firstAfter && now >= readyAt
    && bpm > 0 && target - bpm >= CHARGE.belowBy;
}
/**
 * Where heart rate should peak after a charge: now + whatever the last ~12 s of effort still has to
 * add (the learner's projection), or the current climb rate carried ~15 s, whichever says more.
 * Never more than 35 BPM above now.
 */
export function predictPeak(bpm, projectedRise = 0, trend = 0) {
  return bpm + clamp(Math.max(projectedRise || 0, (trend || 0) * 15), 0, 35);
}
/** Is the coast over? Heart rate has stopped climbing (after coastMin), or coastMax has passed, or it went over. */
export function coastOver({ secs, trend, status }) {
  if (status === 'Above' || status === 'SafetyBrake') return true;
  if (secs >= CHARGE.coastMax) return true;
  return secs >= CHARGE.coastMin && trend < 0.05;
}
/** Landing verdict and bonus: inside the zone = perfect; within 3 BPM of it = nearly. */
export function landingVerdict(bpm, target, half = 5) {
  const off = bpm - target;
  if (Math.abs(off) <= half) return { verdict: 'perfect', points: 300 };
  if (Math.abs(off) <= half + 3) return { verdict: 'nearly', points: 100 };
  return { verdict: off > 0 ? 'over' : 'short', points: 0 };
}

// ---------------------------------------------------------------- learning what raises YOUR heart rate

/**
 * Online estimate of how much each activity raises YOUR heart rate.
 * Model: heart rate ~= resting level + sum over activities of gain x recent rate of that activity
 * (reps per minute). Heart rate doesn't jump when you move: it climbs over the next ~15-40 s. So
 * each rep's effect is passed through two smoothing stages in a row (each tau/2): its credit
 * starts at zero, peaks ~17 s later and fades, with an average delay of ~35 s. A rise in heart rate
 * is therefore credited to what you did 15-40 s ago, not to the move you're doing now. Every couple of seconds
 * the gains are nudged to explain the current BPM (normalised least-mean-squares). Gains read as
 * "BPM added per 1 rep/minute sustained". Noisy by nature: a trend that firms up over workouts.
 */
export class HeartRateAttribution {
  constructor({ tauSeconds = 35, learningRate = 0.08, weights = null, experience = 0 } = {}) {
    this.tau = tauSeconds;
    this.lr = learningRate;
    // How many real-heart-rate updates this player already has (saved across workouts). New players
    // learn ~3x faster, easing to the normal rate over their first ~10 minutes of real data.
    this.experience = experience;
    // Saved estimates are blended 70/30 with the starting guesses so one odd workout can't dominate.
    this.prior = Object.fromEntries(ACTIVITIES.map((a) => [a.key, a.prior]));
    this.w = Object.fromEntries(ACTIVITIES.map((a) => [a.key, weights?.[a.key] != null ? 0.7 * weights[a.key] + 0.3 * a.prior : a.prior]));
    this.rate = Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 0])); // delayed reps/min (what your heart is responding to now)
    this.rate1 = Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 0])); // first smoothing stage
    // Same, but over ~12 s: "how hard you're working right now", before your heart has caught up.
    this.fastTau = 12;
    this.fast = Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 0]));
    this.counts = Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 0]));
    this.base = null;          // learned resting-ish level
    this.lastT = null;
    this.lastUpdate = -Infinity;
    this.updates = 0;
  }

  decayTo(t) {
    if (this.lastT != null && t > this.lastT) {
      const dt = t - this.lastT, half = this.tau / 2;
      const f = Math.exp(-dt / half);
      const ff = Math.exp(-dt / this.fastTau);
      for (const k of ACTIVITY_KEYS) {
        // Two equal stages in a row (exact for any step): the second lags the first.
        this.rate[k] = (this.rate[k] + this.rate1[k] * (dt / half)) * f;
        this.rate1[k] *= f;
        this.fast[k] *= ff;
      }
    }
    this.lastT = t;
  }

  record(key, t) {
    if (!(key in this.w)) return;
    this.decayTo(t);
    this.rate1[key] += 60 / (this.tau / 2); // a steady r reps/min settles at rate1 = rate = r
    this.fast[key] += 60 / this.fastTau;
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
      this.w[k] = clamp(this.w[k] + (this.learningRateNow() * err * this.rate[k]) / norm, 0.25 * this.prior[k], 6);
    }
    // The baseline (resting-ish level) absorbs part of every error, more when you're barely moving.
    const active = ACTIVITY_KEYS.reduce((s, k) => s + this.rate[k], 0);
    this.base = clamp(this.base + err * (active < 3 ? 0.05 : 0.015), 40, 160);
    this.updates++;
    return true;
  }

  /** Learning rate right now: boosted for new players (few real updates so far), then normal. */
  learningRateNow() {
    return this.lr * (1 + 2 * Math.exp(-(this.experience + this.updates) / 300));
  }

  /**
   * Where your heart rate is heading if you keep up what you've been doing for the last ~12 s
   * (null until the model has a baseline). Heart rate lags effort by 30-40 s; this doesn't.
   */
  projected() {
    if (this.base == null) return null;
    return ACTIVITY_KEYS.reduce((s, k) => s + this.w[k] * this.fast[k], this.base);
  }

  /**
   * How much heart rate should still rise (or fall) because the last ~12 s of effort differs from
   * the last ~35 s: sum of gain x (fast rate - slow rate). Added to your CURRENT heart rate this
   * gives where it's heading, and any constant error in the model (e.g. a baseline that hasn't
   * settled yet) cancels out, unlike projected().
   */
  projectedRise() {
    return ACTIVITY_KEYS.reduce((s, k) => s + this.w[k] * (this.fast[k] - this.rate[k]), 0);
  }

  /** Activities sorted by estimated effect: BPM added per 10 reps/minute, plus this session's reps. */
  ranking() {
    return ACTIVITIES.map((a) => ({ key: a.key, label: a.label, bpmPer10: this.w[a.key] * 10, reps: this.counts[a.key] }))
      .sort((p, q) => q.bpmPer10 - p.bpmPer10);
  }
}

/**
 * Bridge the heart's lag on the HUD. 'climbing': you're below the zone but working hard enough
 * that your heart rate is on its way up into it. 'easing': you're above it but have eased off
 * enough that it's coming down. Otherwise null (just follow the usual cue).
 */
export function heartTrend({ status, bpm, projected, target, half = 5, margin = 4 }) {
  if (projected == null || !bpm) return null;
  if (status === 'Below' && projected >= target - half && projected - bpm >= margin) return 'climbing';
  if (status === 'Above' && projected <= target + half && bpm - projected >= margin) return 'easing';
  return null;
}

/** Zone streaks: which milestone (1 = 15 s, 2 = 30 s, ...) was just reached, or 0. */
export const ZONE_STREAK_STEP = 15;
export function streakMilestone(before, after, step = ZONE_STREAK_STEP) {
  const a = Math.floor(before / step), b = Math.floor(after / step);
  return b > a ? b : 0;
}

// ---------------------------------------------------------------- end-of-workout summary and personal bests

/**
 * Sum up a workout from its per-second log rows ({ t, phase, bpm, status, target }).
 * Time in zone counts training only; `pct` is of the training actually done (ending early is fair).
 */
export function summarizeWorkout(rows) {
  const training = rows.filter((r) => r.phase === 'Training');
  const beats = rows.map((r) => Number(r.bpm)).filter((b) => b > 0);
  const trainingBeats = training.map((r) => Number(r.bpm)).filter((b) => b > 0); // average = training, like the scoreboard
  const inZone = training.filter((r) => r.status === 'InZone').length;
  return {
    seconds: rows.length,
    trainingSeconds: training.length,
    inZoneSeconds: inZone,
    pct: training.length ? Math.round((100 * inZone) / training.length) : 0,
    avgBpm: trainingBeats.length ? Math.round(trainingBeats.reduce((a, b) => a + b, 0) / trainingBeats.length) : 0,
    peakBpm: beats.length ? Math.max(...beats) : 0,
  };
}

// ---------------------------------------------------------------- calories

/**
 * Estimated calories burned per minute from heart rate (Keytel et al. 2005, the formula most
 * heart-rate monitors use). sex: 'male' | 'female' | anything else = the average of both.
 * Never below a resting ~1 kcal per kg per hour. An estimate: typically within 15-20%.
 */
export function kcalPerMinute(bpm, { age = 30, weightKg = 75, sex = '' } = {}) {
  if (!(bpm > 0)) return 0;
  const male = (-55.0969 + 0.6309 * bpm + 0.1988 * weightKg + 0.2017 * age) / 4.184;
  const female = (-20.4022 + 0.4472 * bpm - 0.1263 * weightKg + 0.074 * age) / 4.184;
  const k = sex === 'male' ? male : sex === 'female' ? female : (male + female) / 2;
  return Math.max(weightKg / 60, k);
}

/** Workouts shorter than this (training seconds) don't set records: too easy to fluke 100%. */
export const MIN_RECORD_SECONDS = 180;
/**
 * Fold one finished workout into the saved personal bests.
 * Returns { bests, records } where records lists the stats that are new bests this time.
 */
export function updateBests(prev, w) {
  const b = { workouts: 0, totalZoneSeconds: 0, pct: 0, score: 0, streak: 0, reactor: 0, ...(prev || {}) };
  b.workouts++;
  b.totalZoneSeconds += w.inZoneSeconds || 0;
  const records = [];
  if (w.trainingSeconds >= MIN_RECORD_SECONDS) {
    for (const k of ['pct', 'score', 'streak', 'reactor']) {
      if ((w[k] || 0) > (b[k] || 0)) { if (prev) records.push(k); b[k] = w[k]; } // first workout: sets the bar, no "new best"
    }
  }
  return { bests: b, records };
}

// ---------------------------------------------------------------- sensor sanity

/**
 * Wrist sensors sometimes "lock" and repeat the same BPM for 20-40 s while sweaty, then jump.
 * If the reading hasn't changed at all for over 25 s while you're below the zone and clearly
 * working (>12 reps/min in the last ~12 s), treat it as stuck: don't learn from it and don't let
 * the challenge boost build on it.
 */
export const FLAT_SECONDS = 25; // a bit more margin than 18 s: a steady heart can hold one value for a while
export function sensorLooksFlat({ flatSeconds, status, effortRpm }) {
  return flatSeconds > FLAT_SECONDS && status === 'Below' && effortRpm > 12;
}

// ---------------------------------------------------------------- music colour and breathing

/**
 * The song's tone by zone: low-pass cutoff (Hz) and bass shelf (dB). Well below the zone it's
 * muffled (2.5 kHz) and opens up (to 18 kHz) as you climb to the target; in the zone it's fully
 * open with +4 dB of bass; above the zone a little darker again, to calm things down.
 */
export function songTone({ status, bpm, target }) {
  if (status === 'InZone') return { cutoff: 18000, bassDb: 4 };
  if (status === 'Above' || status === 'SafetyBrake') return { cutoff: 7000, bassDb: 0 };
  if (status === 'Below' && bpm && target) {
    const close = clamp01(1 - (target - bpm) / 25);
    return { cutoff: Math.round(2500 * Math.pow(18000 / 2500, close)), bassDb: 0 };
  }
  return { cutoff: 18000, bassDb: 0 };
}

/**
 * Song breakdowns (variety without new audio files): every 24 bars the song thins out for up
 * to 4 bars (low end cut, no bass boost), then the full sound slams back on the next big hit.
 * Only in the zone: below it the music should keep driving you, above it a slam-back would cheer
 * you on when you should ease off.
 */
export const BREAKDOWN_EVERY = 24, BREAKDOWN_BARS = 4;
export function breakdownDue(bar, lastPeriod, status) {
  // Any of the first 4 bars of each 24-bar stretch will do (being in the zone for one exact bar
  // was too rare); at most one breakdown per stretch.
  const period = Math.floor(bar / BREAKDOWN_EVERY);
  return bar >= BREAKDOWN_EVERY && bar % BREAKDOWN_EVERY < 4 && period !== lastPeriod && status === 'InZone';
}

/**
 * Paced breathing for coming back down when you're above the zone: 4 s in, 6 s out.
 * Returns 'in' or 'out' and how full the breath is (0..1, eased).
 */
export function breathAt(t) {
  const u = ((t % 10) + 10) % 10;
  if (u < 4) return { phase: 'in', fill: 0.5 - 0.5 * Math.cos((Math.PI * u) / 4) };
  return { phase: 'out', fill: 0.5 + 0.5 * Math.cos((Math.PI * (u - 4)) / 6) };
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
