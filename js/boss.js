// The Guardian (v58): a heart-rate boss. Pure logic like core.js: no DOM, no three.js and no
// storage, so node test/boss.test.mjs can check every rule. Design: docs/BOSS_SPEC_DRAFT.md.
//
// The boss gives the zone controller a face and adds no moves. The reps you already score chip
// a shield and then a core, but ONLY while your heart rate is in the zone:
// - Below the zone the shield stalls and, after a grace, creeps back. Never fast: dips below the
//   zone come from lag and from planned recovery (the coast after a charge), and a quick heal
//   would teach panic sprinting, the overshoot cycle that charge and coast exists to stop.
// - Above the zone everything freezes and the boss asks to be cooled down. Going harder is never
//   rewarded, and the safety brake always wins.
// Times (`now`) are seconds into training, supplied by the game; the boss never reads a clock.

export const BOSS = Object.freeze({
  shieldShare: 0.42,   // share of the training time, spent hitting in the zone, that breaks the shield
  coreShare: 0.28,     // ... and then finishes the core (together 0.70: the "about 70% in zone" player wins near the end)
  graceBelow: 20,      // seconds below the zone (and not climbing) before the shield starts to creep back
  regenPerSec: 1 / 3,  // then 1% every 3 s
  activeWindow: 3,     // a hit credits the time since the last credited hit, up to this many seconds
  perfect: 25,         // % a PERFECT landing (charge and coast) knocks off the shield
  nearly: 10,          // % a NEARLY landing knocks off
  coreLandingScale: 0.4, // once the shield is down a landing hits the core, scaled by this
  quality: Object.freeze({ tap: 0.7, solid: 1, heavy: 1.3 }), // how hard the rep was (core.js hitTier)
});

// Float sums of a few hundred chips land a hair off zero; anything closer than this is empty.
const EPS = 1e-9;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A fresh boss for a training block of `trainingSeconds` (the shield and core are sized to it). */
export function newBoss(trainingSeconds) {
  const secs = Number(trainingSeconds);
  const T = Number.isFinite(secs) && secs > 0 ? secs : 900; // a bad length must not make every hit infinite
  return { shield: 100, core: 100, state: 'guarded', secsBelow: 0, lastHitAt: -99, shieldBrokeAt: null, defeatedAt: null, T };
}

/** The boss state for a zone status (core.js Zone). Anything unknown waits, frozen, like no signal. */
export function bossStateFor(status) {
  switch (status) {
    case 'Below': return 'guarded';
    case 'InZone': return 'exposed';
    case 'Above': return 'overheating';
    case 'SafetyBrake': return 'stunned';
    default: return 'paused';
  }
}

/**
 * Once per frame (any dt): follow the zone status and let the shield creep back.
 * The shield only regrows after graceBelow seconds below the zone without climbing, at regenPerSec,
 * never past 100 and never once the boss is beaten. `climbing` (the effort estimate says your heart
 * rate is on its way up) restarts the grace: you are doing the right thing, the lag is not your fault.
 * Only the part of a step past the grace counts, so the result is the same at 72 frames a second or
 * one. The game also passes `now` (every boss call gets the same clock); the tick does not need it.
 */
export function bossTick(boss, { status, climbing = false, dt = 0 } = {}) {
  if (!boss) return boss;
  boss.state = bossStateFor(status);
  const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
  if (status !== 'Below' || climbing) { boss.secsBelow = 0; return boss; }
  boss.secsBelow += step;
  const past = Math.min(step, boss.secsBelow - BOSS.graceBelow);
  if (past > 0 && boss.defeatedAt == null) boss.shield = Math.min(100, boss.shield + BOSS.regenPerSec * past);
  return boss;
}

/** `amount` % off the shield while it is up, otherwise off the core. Never both: what is left over when the shield breaks is lost. */
function strike(boss, amount, now) {
  const out = { shield: 0, core: 0, broke: false, defeated: false };
  const layer = boss.shield > 0 ? 'shield' : 'core';
  const left = boss[layer] - amount;
  const after = left > EPS ? Math.min(100, left) : 0;
  out[layer] = boss[layer] - after;
  boss[layer] = after;
  if (after > 0) return out;
  if (layer === 'shield') {
    out.broke = true;
    if (boss.shieldBrokeAt == null) boss.shieldBrokeAt = now; // the first break is the one the summary remembers
  } else {
    out.defeated = true;
    boss.defeatedAt = now;
  }
  return out;
}

/**
 * A scored rep. Only counts while the boss is 'exposed' (you are in your zone) and not beaten;
 * otherwise returns null and changes nothing.
 * Damage is paid for TIME SPENT WORKING, not for the number of hits: each hit credits the seconds
 * since the last credited hit (at most activeWindow), so ten flicks a second earn the same as one
 * punch a second, and a single hit after a long rest is worth 3 s at most.
 *   chip % = 100 / (share * T) * min(now - lastHitAt, activeWindow) * quality
 * with share = shieldShare while the shield is up, coreShare after. Shield first; a hit never
 * spills from the shield into the core.
 * `quality`: a multiplier (BOSS.quality.tap / solid / heavy, or the slower arm's rate for
 * two-hand work); a tier name ('tap' | 'solid' | 'heavy') works too.
 * Returns { shield, core, broke, defeated }: the damage this hit dealt to each layer (in % points,
 * not what is left: that is on the boss), whether it broke the shield, whether it finished the core.
 */
export function bossHit(boss, { now, quality = 1 } = {}) {
  if (!boss || boss.state !== 'exposed' || boss.defeatedAt != null || !Number.isFinite(now)) return null;
  const named = typeof quality === 'string' && Object.hasOwn(BOSS.quality, quality) ? BOSS.quality[quality] : quality;
  const q = Number.isFinite(named) ? Math.max(0, named) : 1; // anything unreadable counts as a plain rep
  const active = clamp(now - boss.lastHitAt, 0, BOSS.activeWindow);
  boss.lastHitAt = now;
  const share = boss.shield > 0 ? BOSS.shieldShare : BOSS.coreShare;
  return strike(boss, (100 / (share * boss.T)) * active * q, now);
}

/**
 * A charge-and-coast landing. 'perfect' / 'nearly' knock BOSS.perfect / BOSS.nearly % off the
 * shield, or that times coreLandingScale off the core once the shield is down. 'over', 'short'
 * and anything else do nothing (null), with no penalty.
 * Unlike a rep this does not wait for 'exposed': a NEARLY landing is by definition just outside
 * the zone, and the landing is the reward for the whole charge. It is not a rep either, so the
 * hit clock (lastHitAt) is left alone. Same return shape as bossHit.
 */
export function bossLanding(boss, verdict, now) {
  if (!boss || boss.defeatedAt != null) return null;
  const pct = verdict === 'perfect' ? BOSS.perfect : verdict === 'nearly' ? BOSS.nearly : 0;
  if (!pct) return null;
  const at = Number.isFinite(now) ? now : Math.max(0, boss.lastHitAt); // a missing clock must not lose the win
  return strike(boss, boss.shield > 0 ? pct : pct * BOSS.coreLandingScale, at);
}

// Whole percent for the player. Only a truly empty bar reads 0 and only a full one reads 100, so
// "core 0% left. It will be back." can never be shown for a boss that is still standing.
const wholePct = (v) => (v <= 0 ? 0 : v >= 100 ? 100 : clamp(Math.round(v), 1, 99));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * For the end board: { defeated, shield, core, text }. shield and core are what is LEFT, in whole
 * percent. Nothing negative is said when it got away.
 */
export function bossSummary(boss) {
  const defeated = boss.defeatedAt != null;
  const shield = wholePct(boss.shield), core = wholePct(boss.core);
  const text = defeated
    ? `GUARDIAN DOWN at ${mmss(Math.max(0, boss.defeatedAt))}`
    : `Guardian: shield ${shield}% · core ${core}% left. It will be back.`;
  return { defeated, shield, core, text };
}
