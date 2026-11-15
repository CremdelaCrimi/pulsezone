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
  duckBarChance: 0, heavyOrbChance: 0, minPunchSpeed: 0.6,
});
export const HARD = Object.freeze({
  spawnInterval: 0.45, orbSpeed: 4.5, horizontalSpread: 0.75, verticalSpread: 0.55,
  duckBarChance: 0.3, heavyOrbChance: 0.35, minPunchSpeed: 1.6,
});

const ramp = (t, start) => (t <= start ? 0 : (t - start) / (1 - start));

/** Map intensity 0..1 to concrete gameplay numbers. */
export function evaluateDifficulty(intensity, easy = EASY, hard = HARD) {
  const t = clamp01(intensity);
  return {
    spawnInterval: Math.exp(lerp(Math.log(easy.spawnInterval), Math.log(hard.spawnInterval), t)),
    orbSpeed: lerp(easy.orbSpeed, hard.orbSpeed, t),
    horizontalSpread: lerp(easy.horizontalSpread, hard.horizontalSpread, t),
    verticalSpread: lerp(easy.verticalSpread, hard.verticalSpread, t),
    duckBarChance: lerp(easy.duckBarChance, hard.duckBarChance, ramp(t, 0.3)),
    heavyOrbChance: lerp(easy.heavyOrbChance, hard.heavyOrbChance, ramp(t, 0.5)),
    minPunchSpeed: lerp(easy.minPunchSpeed, hard.minPunchSpeed, t),
  };
}

/** Tanaka estimate of max heart rate. */
export const estimatedMaxBpm = (age) => 208 - 0.7 * age;
