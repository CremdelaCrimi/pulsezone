// Knee tracking (v61): what the headset can tell about your legs without seeing them.
// The Quest gives the game your head and two fists only. Leg moves are read from their side effects:
//  - steps: each step bounces your head (a dip and a rise of a centimetre or more);
//  - knee bumps: a fist held still on a pad jolts upward when a knee hits it from below;
//  - crunches: hands behind your head, then the head drops and tilts or turns to one side, and the
//    opposite elbow (its fist) drops toward the knee;
//  - body tracking: if the Quest browser shares its estimated skeleton, the knee joint's height.
// Pure functions and small state machines (no three.js), so Node tests can drive them with
// made-up motion. Every threshold here is a first guess; the Knee lab logs raw motion so the
// guesses can be checked against Gio's real moves.

export const KNEE = Object.freeze({
  bobTau: 0.6,        // s: the head's slow baseline (an average over about this long)
  bobHalf: 0.006,     // m: a step = the head dipping this far below the baseline, then rising this far above it
  stepMin: 0.2,       // s: never two steps closer than this
  padRadius: 0.2,     // m: a fist within this of the pad counts as on it
  bumpVy: 0.7,        // m/s upward: the jolt a knee gives the fist
  bumpRise: 0.03,     // m the fist must rise within bumpWindow
  bumpWindow: 0.18,   // s
  bumpGap: 0.3,       // s between bumps on one hand
  padRest: 0.25,      // s the fist must have rested on the pad before a bump (a fist swinging through doesn't count)
  restRange: 0.03,    // m: 'rested' = it moved up or down less than this over padRest
  behindHead: 0.32,   // m: fists this close to the head (and not far below it) = hands behind your head
  crunchDrop: 0.06,   // m the head drops below standing in a crunch
  crunchTilt: 10,     // degrees of head roll (tilt), or...
  crunchTurn: 14,     // ...degrees of head turn from where you faced when the hands went up, or...
  crunchFist: 0.12,   // ...m one fist drops below the other
  crunchReset: 0.03,  // m: the head comes back up within this of standing before the next crunch
  liftMin: 0.15,      // m a tracked knee joint rises above its standing height = a knee lift
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Head-bob step counter. Feed head height every frame; returns true on the frame a step is counted. */
export class StepCounter {
  constructor() { this.base = null; this.low = false; this.lastStep = -9; this.steps = 0; this.min = 0; this.max = 0; this.amp = 0; this.times = []; }
  update(y, t, dt) {
    if (this.base == null) { this.base = y; return false; }
    this.base += (y - this.base) * (1 - Math.exp(-Math.max(0, dt) / KNEE.bobTau));
    const d = y - this.base;
    this.min = Math.min(this.min, d); this.max = Math.max(this.max, d);
    if (d < -KNEE.bobHalf) this.low = true;
    if (this.low && d > KNEE.bobHalf && t - this.lastStep >= KNEE.stepMin) {
      this.low = false; this.lastStep = t; this.steps++;
      this.amp = this.max - this.min; this.min = 0; this.max = 0;
      this.times.push(t); while (this.times.length && t - this.times[0] > 4) this.times.shift();
      return true;
    }
    return false;
  }
  /** Steps per minute over the last 4 s. */
  cadence(t) { const n = this.times.filter((x) => t - x <= 4).length; return Math.round(n * 15); }
}

/** One hand on a knee pad: counts upward jolts while the fist is on the pad. */
export class KneeBump {
  constructor() { this.hist = []; this.lastBump = -9; this.bumps = 0; this.on = false; this.onSince = null; }
  /** fist {x,y,z}, pad {x,y,z}, vy = the fist's upward speed (m/s). Returns true on a bump. */
  update(fist, pad, vy, t) {
    const d = Math.hypot(fist.x - pad.x, fist.y - pad.y, fist.z - pad.z);
    this.on = d < KNEE.padRadius;
    if (!this.on) this.onSince = null; else if (this.onSince == null) this.onSince = t;
    this.hist.push([t, fist.y, this.on]);
    while (this.hist.length && t - this.hist[0][0] > KNEE.bumpWindow + KNEE.padRest) this.hist.shift();
    if (!this.on || vy < KNEE.bumpVy || t - this.lastBump < KNEE.bumpGap || t - this.onSince < KNEE.padRest + KNEE.bumpWindow * 0.5) return false;
    const before = this.hist.filter((h) => t - h[0] > KNEE.bumpWindow);
    if (!before.length || !before.every((h) => h[2])) return false;
    const ys = before.map((h) => h[1]);
    if (Math.max(...ys) - Math.min(...ys) > KNEE.restRange) return false; // it wasn't resting: a swing, not a bump
    const lowest = Math.min(...this.hist.filter((h) => t - h[0] <= KNEE.bumpWindow).map((h) => h[1]));
    if (fist.y - lowest < KNEE.bumpRise) return false;
    this.lastBump = t; this.bumps++;
    return true;
  }
}

/** Are both fists behind / beside your head? */
export const handsBehindHead = (L, R, head) =>
  [L, R].every((f) => Math.hypot(f.x - head.x, f.y - head.y, f.z - head.z) < KNEE.behindHead && f.y > head.y - 0.2);

/**
 * Standing cross crunch: hands behind your head, then the head drops and tilts or turns, or one
 * fist drops. `side` is which knee came up: 'left' when you crunch toward your left (right elbow down).
 */
export class CrunchDetector {
  constructor() { this.armedUntil = -9; this.yaw0 = 0; this.ready = true; this.left = 0; this.right = 0; this.last = null; }
  /** head {x,y,z}, yaw/roll in degrees (roll > 0 = tilted to the right, yaw > 0 = turned left), L/R fists. */
  update({ head, yaw, roll, L, R, standing, t }) {
    if (handsBehindHead(L, R, head)) { if (this.armedUntil < t) this.yaw0 = yaw; this.armedUntil = t + 1.5; }
    const drop = standing - head.y;
    if (drop < KNEE.crunchReset) this.ready = true;
    if (!this.ready || t > this.armedUntil || drop < KNEE.crunchDrop) return null;
    const turn = ((yaw - this.yaw0 + 540) % 360) - 180;
    const fistGap = L.y - R.y; // > 0: the right fist is lower (right elbow down, toward the left knee)
    const cues = [];
    if (Math.abs(roll) >= KNEE.crunchTilt) cues.push(roll < 0 ? 'left' : 'right');
    if (Math.abs(turn) >= KNEE.crunchTurn) cues.push(turn > 0 ? 'left' : 'right');
    if (Math.abs(fistGap) >= KNEE.crunchFist) cues.push(fistGap > 0 ? 'left' : 'right');
    if (!cues.length) return null;
    const side = cues.filter((c) => c === 'left').length >= cues.filter((c) => c === 'right').length ? 'left' : 'right';
    this.ready = false;
    this[side]++;
    this.last = { side, drop: +drop.toFixed(3), roll: Math.round(roll), turn: Math.round(turn), fistGap: +fistGap.toFixed(3), cues: cues.length };
    return side;
  }
}

/** A tracked knee (body tracking): counts lifts above its own standing height. */
export class KneeLift {
  constructor() { this.base = null; this.up = false; this.lifts = 0; this.peak = 0; }
  setBase(y) { this.base = y; }
  update(y) {
    if (this.base == null || !Number.isFinite(y)) return false;
    const lift = y - this.base;
    this.peak = Math.max(this.peak, lift);
    if (!this.up && lift >= KNEE.liftMin) { this.up = true; this.lifts++; return true; }
    if (this.up && lift < KNEE.liftMin * 0.5) this.up = false;
    return false;
  }
}

/** Head yaw / pitch / roll in degrees from a quaternion {x,y,z,w} (three.js 'YXZ' order). */
export function headAngles(q) {
  const { x, y, z, w } = q;
  // Rotation matrix terms needed for YXZ.
  const m13 = 2 * (x * z + w * y), m23 = 2 * (y * z - w * x), m33 = 1 - 2 * (x * x + y * y);
  const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z);
  const pitch = Math.asin(clamp(-m23, -1, 1));
  let yaw, roll;
  if (Math.abs(m23) < 0.9999) { yaw = Math.atan2(m13, m33); roll = Math.atan2(m21, m22); } else { yaw = Math.atan2(-(2 * (x * z - w * y)), 1 - 2 * (y * y + z * z)); roll = 0; }
  const deg = 180 / Math.PI;
  return { yaw: yaw * deg, pitch: pitch * deg, roll: -roll * deg }; // roll > 0 = tilted to the right
}

/** Which body-tracking joints describe the legs (names differ between spec drafts). */
export const LEG_JOINT = /leg|knee|foot|ankle|hip/i;
/** The knee joint for a side from a { name: {x,y,z} } map: the lower leg's origin, or a 'knee' joint. */
export function kneeOf(joints, side) {
  const names = Object.keys(joints).filter((n) => n.toLowerCase().startsWith(side));
  const pick = names.find((n) => /knee/i.test(n)) || names.find((n) => /lower-leg|lowerleg|calf/i.test(n));
  return pick ? joints[pick] : null;
}
