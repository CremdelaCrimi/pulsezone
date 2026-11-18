// Test helpers for charge & coast (not loaded by the game).
//
// - chargeStep(): a side-effect-free MIRROR of updateCharge() in js/game.js (v54). game.js needs
//   three.js and a browser, so the Node tests can't load it; this copy lets them drive the real
//   core.js pieces (chargeWanted, predictPeak, coastOver, landingVerdict) through the same
//   transitions. test/core.test.mjs has a "mirror is in sync" check that greps game.js for the
//   conditions copied here, so if updateCharge changes, that check fails until this is updated.
// - LaggedHeart: heart rate that follows effort through two equal smoothing stages (mean lag
//   ~35 s by default, like the learner's model in HeartRateAttribution).
// - simulateChargeCoast(): a workout slice in training: steady effort, then a charge, a coast,
//   and the landing, with the real ZoneController (smoothing, trend, zone status) fed one reading
//   a second through the real RemoteHeartSource, as the phone bridge does. Gaps can be dropped in.
//
// Zero dependencies; plain ES module.
import {
  CHARGE, chargeWanted, predictPeak, coastOver, landingVerdict, heartTrend,
  ZoneController, RemoteHeartSource, HeartRateAttribution, ChallengeBoost, Phase, Zone, mulberry32,
} from '../js/core.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * One frame of updateCharge() (game.js), minus sound, call-outs, score and spawner side effects.
 * `charge` is null or { stage: 'charge' | 'coast', since, startBpm, peak, coastIntensity, wantPress }.
 * io = { now, phase, status, bpm (0 = no signal), target, half, trend, projectedRise, climbing,
 *        trainingT, readyAt, intensity, roundOn, stationsBusy, blocked (fallback / flat / burst) }
 * Returns { charge, readyAt, event } where event is null or { type: 'charge' | 'coast' | 'landing', ... }.
 */
export function chargeStep(charge, io) {
  const readyAt = io.readyAt ?? 0;
  if (io.phase !== Phase.Training) return { charge: null, readyAt, event: null };
  if (!charge) {
    if (io.blocked || io.stationsBusy) return { charge: null, readyAt, event: null };
    if (chargeWanted({ phase: io.phase, status: io.status, bpm: io.bpm, target: io.target, climbing: !!io.climbing,
      trainingT: io.trainingT, now: io.now, readyAt })) {
      return { charge: { stage: 'charge', since: io.now, startBpm: io.bpm, peak: null }, readyAt, event: { type: 'charge', t: io.now, bpm: io.bpm } };
    }
    return { charge: null, readyAt, event: null };
  }
  const secs = io.now - charge.since;
  const over = io.status === Zone.Above || io.status === Zone.SafetyBrake;
  if (charge.stage === 'charge') {
    const roundOn = !!io.roundOn;
    if (over || (secs >= CHARGE.chargeSeconds && !roundOn) || secs >= CHARGE.chargeSeconds + 15) {
      const next = { ...charge, stage: 'coast', since: io.now, peak: predictPeak(io.bpm, io.projectedRise, io.trend), coastIntensity: io.intensity };
      return { charge: next, readyAt, event: { type: 'coast', t: io.now, bpm: io.bpm, peak: Math.round(next.peak), over } };
    }
    return { charge, readyAt, event: null };
  }
  const coasting = { ...charge, peak: predictPeak(io.bpm, io.projectedRise, io.trend) };
  if (coastOver({ secs, trend: io.trend, status: io.status })) {
    const { verdict, points } = landingVerdict(io.bpm, io.target, io.half ?? 5);
    return { charge: null, readyAt: io.now + CHARGE.cooldown,
      event: { type: 'landing', t: io.now, secs, verdict, points, bpm: io.bpm, target: io.target, from: charge.startBpm, resumeIntensity: Math.min(io.intensity, charge.coastIntensity ?? io.intensity) } };
  }
  return { charge: coasting, readyAt, event: null };
}

/** Heart rate following effort (0..1) through two equal first-order stages: mean lag = 2 x tau. */
export class LaggedHeart {
  constructor({ rest = 70, max = 185, tau = 17.5, startBpm = 100, noiseBpm = 0, seed = 7 } = {}) {
    Object.assign(this, { rest, max, tau, noiseBpm });
    this.s1 = this.s2 = startBpm;
    this.rng = mulberry32(seed);
  }
  steady(effort) { return this.rest + (this.max - this.rest) * clamp01(effort); }
  /** Effort that holds `bpm` steady. */
  effortFor(bpm) { return clamp01((bpm - this.rest) / (this.max - this.rest)); }
  tick(dt, effort) {
    const a = 1 - Math.exp(-dt / this.tau);
    this.s1 += (this.steady(effort) - this.s1) * a;
    this.s2 += (this.s1 - this.s2) * a;
  }
  get bpm() { return this.s2 + (this.noiseBpm ? (this.rng() - 0.5) * 2 * this.noiseBpm : 0); }
}

/**
 * Run: `preSeconds` of steady effort in training (HR settled at startBpm), then the game's charge
 * logic decides when to charge. Player effort is chosen by stage: chargeEffort while the game says
 * CHARGE (for `chargeEffortSeconds` of it, if given; then coastEffort), coastEffort while it says
 * COAST (or a function (secsIntoCoast) => effort). After landing it keeps going for `afterSeconds`.
 * gaps: [[from, to], ...] absolute seconds with no phone readings (the bridge sends ~1 a second).
 * roundOn(secsIntoCharge) => bool: a wall-ball round is on (holds the charge open, up to 45 s).
 */
export function simulateChargeCoast({
  target = 120, half = 5, startBpm = 100, chargeEffort = 0.6, chargeEffortSeconds = Infinity, coastEffort = null,
  preSeconds = CHARGE.firstAfter, afterSeconds = 60, gaps = [], roundOn = () => false, heart = {}, dt = 0.1, maxSeconds = 400,
} = {}) {
  const h = new LaggedHeart({ startBpm, ...heart });
  const pre = h.effortFor(startBpm);
  const coastE = coastEffort ?? h.effortFor(target); // default: settle back to what holds the zone
  const ctrl = new ZoneController({ targetBpm: target, zoneHalfWidth: half, warmUpSeconds: 0, trainingSeconds: 3600, safetyCeilingBpm: 175 });
  const remote = new RemoteHeartSource();
  const att = new HeartRateAttribution();
  const boost = new ChallengeBoost();
  let charge = null, readyAt = 0, nextReading = 0, nextRep = 0, t = 0, landedAt = null;
  const events = [], trace = [];
  let chargeCount = 0, maxBpm = 0, maxBoostWhileCharging = 0;
  const inGap = (x) => gaps.some(([a, b]) => x >= a && x < b);
  while (t < maxSeconds) {
    // Player effort for this frame.
    let effort = pre;
    if (charge?.stage === 'charge') effort = t - charge.since < chargeEffortSeconds ? chargeEffort : (typeof coastE === 'function' ? coastE(0) : coastE);
    else if (charge?.stage === 'coast') effort = typeof coastE === 'function' ? coastE(t - charge.since) : coastE;
    else if (landedAt != null) effort = typeof coastE === 'function' ? coastE(t - landedAt + 45) : coastE;
    h.tick(dt, effort);
    // Reps feed the learner's ~12 s "effort now" (projectedRise); 80 reps/min at full effort.
    const rpm = 80 * effort;
    if (rpm > 0 && t >= nextRep) { att.record('jab', t); nextRep = t + 60 / rpm; }
    remote.tick(dt);
    if (t >= nextReading) { nextReading += 1; if (!inGap(t)) remote.push(h.bpm); }
    ctrl.tick(remote, dt);
    const signal = ctrl.status !== Zone.NoSignal;
    const bpm = signal && remote.hasReading ? remote.currentBpm : 0;
    if (signal) att.update(t, bpm);
    const projected = att.projected();
    const climbing = heartTrend({ status: ctrl.status, bpm, projected, target, half }) === 'climbing';
    // game.js also forces boost.value = 0 while charging; here only hold is applied, so the check sees whether hold alone keeps it still.
    boost.update(dt, { status: ctrl.status, intensity: ctrl.intensity, bpmTrend: ctrl.bpmTrend, climbing, hold: !!charge });
    if (charge && chargeCount) maxBoostWhileCharging = Math.max(maxBoostWhileCharging, boost.value);
    const r = chargeStep(charge, {
      now: t, phase: ctrl.phase, status: ctrl.status, bpm, target: ctrl.currentSetpoint, half, trend: ctrl.bpmTrend,
      projectedRise: att.projectedRise(), climbing, trainingT: t, readyAt, intensity: ctrl.intensity,
      roundOn: charge?.stage === 'charge' ? roundOn(t - charge.since) : false,
    });
    if (r.event) {
      events.push(r.event);
      if (r.event.type === 'charge') { chargeCount++; boost.value = 0; } // startCharge(): the charge replaces the boost
      if (r.event.type === 'landing') { landedAt = t; ctrl.intensity = ctrl.integral = r.event.resumeIntensity; }
    }
    charge = r.charge; readyAt = r.readyAt;
    if (charge || landedAt != null) maxBpm = Math.max(maxBpm, h.bpm);
    if (Math.abs(t - Math.round(t)) < dt / 2) trace.push({ t: Math.round(t), bpm: Math.round(h.bpm * 10) / 10, status: ctrl.status, stage: charge?.stage || '' });
    t += dt;
    if (landedAt != null && t - landedAt >= afterSeconds) break;
  }
  const landing = events.find((e) => e.type === 'landing') || null;
  const coast = events.find((e) => e.type === 'coast') || null;
  return { events, landing, coast, chargeCount, maxBpm, maxBoostWhileCharging, trace, readyAt, heart: h, finalStatus: ctrl.status };
}
