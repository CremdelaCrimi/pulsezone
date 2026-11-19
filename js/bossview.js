// The Guardian's body (v58): the three.js view of the heart-rate boss in boss.js. A dark figure at
// the far end of the lane with a segmented shield ring round a glowing core, and a small label
// over its head. It only SHOWS the boss it is handed each frame; every rule lives in boss.js.
//
// Built for a Quest: everything is made once in the constructor, update() allocates nothing, and
// the whole figure is 5 draw calls (6 while a shockwave is out): two instanced meshes of boxes (the
// dark body; the ring segments and the visor), the core, its glow and the label. No material takes
// the scene fog, so it reads at 18 m.
//
// The game owns `group` (it sets group.position to the lane centre, about 18 m out, every frame).
// Everything here is in the group's LOCAL space: feet at the origin, facing +z, the player's way.
// Rising, sinking and kneeling move the inner `rig`, never the group.
import * as THREE from 'three';

// ---------------------------------------------------------------- layout (metres, local space)
// Seen from the player's eye at 18 m, orbs spawn in front of everything below about y = 2.0 and the
// lower edge of the headset scoreboard sits at about y = 3.3. The bright parts stay between the
// two: the ring spans 1.57..2.84 round the core, the label 2.87..3.27. Only the dark body goes
// lower, where it makes a calm backdrop for the orbs.
const SEGMENTS = 14;
const CORE_Y = 2.2, CORE_Z = 0.12, CORE_R = 0.27;
const RING_R = 0.58, RING_Z = 0.5;
const SLOT = (Math.PI * 2) / SEGMENTS;      // angle of one ring segment
const SEG_LEN = RING_R * SLOT, SEG_THICK = 0.11, SEG_DEPTH = 0.07;
const HALO_Z = 0.3, WAVE_Z = 0.46;
const LABEL_Y = 3.07, LABEL_W = 3.2, LABEL_H = 0.4, LABEL_Z = 0.55;
const SUNK = 3.6;                           // how far under the floor it waits (deeper than it is tall)
const KNEEL = 0.6;                          // how far it sinks while stunned
const RISE_SECONDS = 1.8, SINK_SECONDS = 1.5, BURST_SECONDS = 0.7, FINALE_SECONDS = 3.9;
const GHOST = 0.06;                         // brightness left in a ring segment that has gone out

// The body: boxes as [x, y, z, width, height, depth, lean]. Depths differ so no two faces fight.
const BODY = [
  [0, -0.3, 0, 1.8, 1.0, 1.0, 0],           // plinth: runs 0.8 m under the floor, so nudging the group up never shows a gap
  [-0.4, 0.75, 0, 0.42, 1.1, 0.5, 0],       // legs
  [0.4, 0.75, 0, 0.42, 1.1, 0.5, 0],
  [0, 1.42, 0, 1.2, 0.3, 0.56, 0],          // hips
  [-0.56, 2.05, 0, 0.28, 1.0, 0.5, 0],      // chest: two columns, the core hangs between them
  [0.56, 2.05, 0, 0.28, 1.0, 0.5, 0],
  [0, 2.05, -0.24, 0.9, 1.0, 0.1, 0],       // back plate, so the core sits against something dark
  [0, 2.58, -0.05, 1.5, 0.14, 0.46, 0],     // yoke
  [0, 2.66, 0, 0.44, 0.26, 0.44, 0],        // head, low between the shoulders
  [-0.95, 2.42, 0, 0.52, 0.44, 0.64, 0.15], // shoulders
  [0.95, 2.42, 0, 0.52, 0.44, 0.64, -0.15],
  [-1.0, 1.75, 0, 0.3, 0.95, 0.36, 0],      // arms
  [1.0, 1.75, 0, 0.3, 0.95, 0.36, 0],
  [-1.0, 1.15, 0.06, 0.38, 0.36, 0.44, 0],  // fists
  [1.0, 1.15, 0.06, 0.38, 0.36, 0.44, 0],
];
const VISOR_Y = 2.67, VISOR_Z = 0.235;      // a slit of light on the front of the head

// ---------------------------------------------------------------- looks
const C = (hex) => new THREE.Color(hex);
const WHITE = C(0xffffff), GOLD = C(0xffd34d), BLACK = C(0x000000), BODY_GLOW = C(0x0a0f1e);
/**
 * One look per boss state, in the reactor's colour language: blue waits, amber is on, red is too
 * hot, grey has no signal. gain = ring brightness, glow = core, aura = the glow round the core,
 * crack = how far the ring's segments pull apart, spin = ring turn (rad/s). `line` is the state
 * line on the label; `warn` makes it the big line (in those states the number is frozen anyway).
 */
const LOOK = {
  guarded: { ring: C(0x5fb8ff), core: C(0x8ccfff), gain: 0.9, glow: 0.3, aura: 0.14, crack: 0, spin: 0.1, css: '#9fd4ff', line: 'GET INTO YOUR ZONE', warn: false },
  exposed: { ring: C(0xffa63d), core: C(0xffc04d), gain: 1, glow: 0.75, aura: 0.4, crack: 1, spin: 0.3, css: '#ffd27a', line: 'OPEN: HIT IT NOW', warn: false },
  overheating: { ring: C(0xff3b2a), core: C(0xff2a1a), gain: 0.8, glow: 0.5, aura: 0.22, crack: 0.35, spin: 0.05, css: '#ff8a6c', line: 'COOL ME DOWN - BREATHE', warn: true },
  stunned: { ring: C(0xb03a3a), core: C(0x8a2a2a), gain: 0.6, glow: 0.2, aura: 0.08, crack: 0.2, spin: 0, css: '#ff8a6c', line: 'SAFETY BRAKE - SLOW DOWN', warn: true },
  paused: { ring: C(0x6b7384), core: C(0x6b7384), gain: 0.5, glow: 0.1, aura: 0.02, crack: 0, spin: 0, css: '#b8bfcc', line: 'WAITING FOR YOUR HEART RATE', warn: true },
};
const STATES = Object.keys(LOOK);

// ---------------------------------------------------------------- small helpers
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
/** Whole percent as boss.js rounds it for the end board: only empty reads 0, only full reads 100. */
const wholePct = (v) => (v <= 0 ? 0 : v >= 100 ? 100 : clamp(Math.round(v), 1, 99));
/** 0..1 breath, 4 s in and 6 s out: the same curve as breathAt in core.js (the reactor's pacer). */
const breathFill = (t) => {
  const u = ((t % 10) + 10) % 10;
  return u < 4 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 4) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 4)) / 6);
};
// Fixed per-segment "randomness", so the ring cracks and bursts the same way every time and
// nothing is rolled per frame. A segment's RANK is when it goes out (0 = first); stepping round the
// ring five at a time scatters the gaps, so the ring looks cracked instead of emptying like a dial.
const hash = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
const RANK = Array.from({ length: SEGMENTS }, (_, i) => (i * 3) % SEGMENTS);
const SIDE = Array.from({ length: SEGMENTS }, (_, i) => (i % 2 ? 1 : -1));
const JIT = Array.from({ length: SEGMENTS }, (_, i) => hash(i, 1) * 2 - 1);
const RND = Array.from({ length: SEGMENTS }, (_, i) => hash(i, 2));

/** A soft round glow (white, fading out), tinted by the material that uses it. */
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LABEL_PX = [1024, 128], BIG = '700 64px system-ui, sans-serif', SMALL = '600 36px system-ui, sans-serif';
/**
 * The label: the status ("GUARDIAN  SHIELD 62%") over the state line. Normally the status is the
 * big line; in the warning states the state line is (it is the thing to act on).
 */
function drawLabel(g, status, line, css, warn) {
  const [W, H] = LABEL_PX;
  g.clearRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = warn ? SMALL : BIG; const w1 = g.measureText(status).width;
  g.font = warn ? BIG : SMALL; const w2 = line ? g.measureText(line).width : 0;
  const w = Math.min(W - 8, Math.max(w1, w2) + 70); // the dark plate hugs the text
  g.fillStyle = 'rgba(8,10,18,0.6)'; g.beginPath(); g.roundRect((W - w) / 2, 4, w, H - 8, 26); g.fill();
  g.font = warn ? SMALL : BIG; g.fillStyle = warn ? '#c9ced8' : '#f2f5ff';
  g.fillText(status, W / 2, line ? (warn ? 28 : 44) : H / 2, W - 30);
  if (!line) return;
  g.font = warn ? BIG : SMALL; g.fillStyle = css;
  g.fillText(line, W / 2, warn ? 84 : 101, W - 30); // long lines squeeze instead of clipping
}

export class BossView {
  /** Builds everything once and leaves it hidden under the floor. The game then only moves `group`. */
  constructor(scene) {
    this.group = new THREE.Group(); // placed by the game
    this.group.visible = false;
    this.rig = new THREE.Group();   // rise / sink / kneel
    this.group.add(this.rig);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const dummy = this._dummy = new THREE.Object3D();

    // The body: dark, lit by the scene so it has a shape, with a faint glow of its own.
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a3350, emissive: 0x0a0f1e, roughness: 0.85, metalness: 0.1, fog: false });
    this.body = new THREE.InstancedMesh(box, this.bodyMat, BODY.length);
    BODY.forEach(([x, y, z, w, h, depth, lean], i) => {
      dummy.position.set(x, y, z); dummy.rotation.set(0, 0, lean); dummy.scale.set(w, h, depth); dummy.updateMatrix();
      this.body.setMatrixAt(i, dummy.matrix);
    });
    this.body.frustumCulled = false; // (instanced bounds are not kept up to date, and it is always ahead of you)

    // The shield ring's segments, plus one more box for the visor: plain bright colour per box.
    this.ring = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), SEGMENTS + 1);
    dummy.scale.setScalar(0); dummy.updateMatrix();
    for (let i = 0; i <= SEGMENTS; i++) { this.ring.setMatrixAt(i, dummy.matrix); this.ring.setColorAt(i, BLACK); }
    this.ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ring.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.ring.frustumCulled = false;

    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x8ccfff, emissive: 0x8ccfff, emissiveIntensity: 0.3, roughness: 0.3, flatShading: true, fog: false });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(CORE_R, 0), this.coreMat);
    this.core.position.set(0, CORE_Y, CORE_Z);

    // The glow round the core and the shockwave: additive, so they never hide what is behind them.
    this.haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.haloMat);
    this.halo.position.set(0, CORE_Y, HALO_Z);
    this.halo.visible = false;
    this.waveMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.wave = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), this.waveMat);
    this.wave.position.set(0, CORE_Y, WAVE_Z);
    this.wave.visible = false;

    const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = LABEL_PX;
    this._g = canvas.getContext('2d');
    this.labelTex = new THREE.CanvasTexture(canvas); this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelMat = new THREE.MeshBasicMaterial({ map: this.labelTex, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(LABEL_W, LABEL_H), this.labelMat);
    this.label.position.set(0, LABEL_Y, LABEL_Z);
    this.label.visible = false;

    this.rig.add(this.body, this.ring, this.core, this.halo, this.wave, this.label);
    scene.add(this.group);

    // What it is showing (eased toward the boss it is handed, so nothing snaps).
    this._boss = null; this._state = 'guarded'; this._shield = 100; this._core = 100; this._hitSeen = -99;
    this._ringCol = LOOK.guarded.ring.clone(); this._coreCol = LOOK.guarded.core.clone(); this._c = new THREE.Color();
    this._gain = LOOK.guarded.gain; this._glow = LOOK.guarded.glow; this._aura = LOOK.guarded.aura;
    this._crack = 0; this._spinRate = LOOK.guarded.spin; this._spin = 0; this._open = 0; this._heat = 0; this._kneel = 0;
    this._ringVis = 1; this._labelKey = NaN;
    this._shown = false; this._rise = 0; this._t = 0;
    this._wave = { t: -1, from: 0, to: 1, seconds: 1, gain: 1 };
    this._resetFight();
    this._stage();
  }

  /** True from show() until it has sunk out of sight (or the defeat finale has finished). */
  get visible() { return this.group.visible; }

  /** Bring it on: it rises out of the floor over ~2 s. show(true) puts it there at once. */
  show(instant = false) {
    if (!this._shown || this._finale >= 0) { this._boss = null; this._resetFight(); } // a new entrance: forget the last fight
    this._shown = true;
    this.group.visible = true;
    if (instant) this._rise = 1;
    this._stage(); // placed now, so a frame drawn before the next update() cannot show it popped up
  }

  /** Send it away: it sinks back into the floor over ~1.5 s (keep calling update()). hide(true) removes it at once. */
  hide(instant = false) {
    this._shown = false;
    if (instant || this._rise <= 0) { this._rise = 0; this._park(); }
  }

  /**
   * A short pulse: 'hit' (small), 'landing' (the core flashes), 'broke' (the ring bursts),
   * 'defeated' (the finale). update() also starts hit / broke / defeated by itself when it sees
   * them on the boss, so calling these is safe but not required; a break or a defeat never plays twice.
   */
  flash(kind) {
    if (!this.group.visible) return;
    if (kind === 'hit') this._hit = 1;
    else if (kind === 'landing') { this._land = 1; this._ripple(CORE_R, 0.95, 0.5, WHITE, 0.8); }
    else if (kind === 'broke') this._breakRing();
    else if (kind === 'defeated') this._startFinale();
  }

  /**
   * Once per frame while `visible` (it returns at once when hidden).
   * boss: the object from boss.js (shield, core, state, lastHitAt, defeatedAt are read, never written).
   * dt: seconds since the last frame. time: a running clock in seconds (paces the breathing).
   * beat: the music's running beat count (the game's beatPhase); the core pulses on each whole beat.
   * breath (optional): 0..1 from the game's own breathing pacer, to stay in step with the reactor.
   */
  update(boss, { dt = 0, time, beat = 0, breath } = {}) {
    if (!this.group.visible) return;
    const d = dt > 0 ? Math.min(dt, 0.1) : 0; // a stalled tab must not fling everything forward (and NaN lands on 0)
    this._t += d;
    this._rise = clamp01(this._rise + (this._shown ? d / RISE_SECONDS : -d / SINK_SECONDS));
    if (!this._shown && this._rise <= 0) { this._park(); return; }

    if (boss) this._watch(boss);
    if (this._finale >= 0) this._finaleFrame(d);
    else this._liveFrame(d, num(time, this._t), beat, breath);
    if (!this.group.visible) return; // the finale parks it when it is over
    this._rippleFrame(d);
    this._stage();
    this.ring.instanceMatrix.needsUpdate = true;
    this.ring.instanceColor.needsUpdate = true;
    this._labelFrame();
  }

  // ---------------------------------------------------------------- inside

  /** Read the boss: a new fight? a hit? did the shield just break, or regrow? is it beaten? */
  _watch(boss) {
    const shield = clamp(num(boss.shield, this._shield), 0, 100), core = clamp(num(boss.core, this._core), 0, 100);
    if (boss !== this._boss) {
      this._boss = boss;
      this._resetFight();
      this._shield = shield; this._hitSeen = boss.lastHitAt; this._ringVis = shield > 0 ? 1 : 0;
    }
    if (boss.lastHitAt !== this._hitSeen) { this._hitSeen = boss.lastHitAt; this._hit = 1; }
    if (shield > this._shield + 1e-6) this._regen = 1;
    if (this._shield > 0 && shield <= 0) this._breakRing();
    this._shield = shield; this._core = core;
    this._state = Object.hasOwn(LOOK, boss.state) ? boss.state : 'paused';
    if (boss.defeatedAt != null) this._startFinale();
  }

  _resetFight() {
    this._hit = 0; this._land = 0; this._regen = 0;
    this._burst = -1; this._finale = -1; this._finaleDone = false; this._fall = 0; this._hotAt = null;
    this._wave.t = -1; this.wave.visible = false; this.core.visible = true;
  }

  /** The shield just broke: every segment flares and flies outward, with a shockwave. */
  _breakRing() {
    if (this._burst >= 0 || this._finale >= 0) return; // flash('broke') and the view's own watch see the same break
    this._burst = 0; this._ringVis = 0; this._land = Math.max(this._land, 0.5);
    this._ripple(RING_R, 1.6, BURST_SECONDS, this._c.copy(this._ringCol).lerp(WHITE, 0.5), 0.9);
  }

  _startFinale() {
    if (this._finale >= 0 || this._finaleDone) return;
    this._finale = 0; this._burst = -1; this._hit = 0; this._land = 0;
    this._ripple(CORE_R, 2.2, 1, this._c.copy(GOLD).lerp(WHITE, 0.5), 1);
  }

  /** An expanding ring of light round the core. One at a time: a new one replaces the last. */
  _ripple(from, to, seconds, color, gain) {
    const w = this._wave;
    w.t = 0; w.from = from; w.to = to; w.seconds = seconds; w.gain = gain;
    this.waveMat.color.copy(color);
    this.waveMat.opacity = 0;
    this.wave.scale.setScalar(from);
    this.wave.visible = true;
  }

  _rippleFrame(d) {
    const w = this._wave;
    if (w.t < 0) return;
    w.t += d;
    const k = w.t / w.seconds;
    if (k >= 1) { w.t = -1; this.wave.visible = false; return; }
    this.wave.scale.setScalar(w.from + (w.to - w.from) * (1 - (1 - k) ** 3));
    this.waveMat.opacity = w.gain * (1 - k) * (1 - k);
  }

  /** Where the rig stands: risen out of the floor, sunk 0.6 m and bowed while stunned, gone under after a defeat. */
  _stage() {
    const up = 1 - (1 - this._rise) ** 3; // fast out of the floor, settling gently; run backwards it sinks slowly at first
    this.rig.position.y = -SUNK * (1 - up) - KNEEL * this._kneel - SUNK * this._fall * this._fall;
    this.rig.rotation.x = 0.1 * this._kneel - 0.08 * this._fall;
  }

  _park() {
    this.group.visible = false;
    this._wave.t = -1; this.wave.visible = false;
    this._stage();
  }

  /** A normal frame: ease toward the state's look, then pose the ring, the visor, the core and its glow. */
  _liveFrame(d, clock, beat, breath) {
    const look = LOOK[this._state], k = 1 - Math.exp(-d * 5), c = this._c, dummy = this._dummy;
    this._ringCol.lerp(look.ring, k); this._coreCol.lerp(look.core, k);
    this._gain += (look.gain - this._gain) * k; this._glow += (look.glow - this._glow) * k; this._aura += (look.aura - this._aura) * k;
    this._crack += (look.crack - this._crack) * k; this._spinRate += (look.spin - this._spinRate) * k;
    this._open += ((this._state === 'exposed' ? 1 : 0) - this._open) * k;
    this._heat += ((this._state === 'overheating' ? 1 : 0) - this._heat) * k;
    this._kneel += ((this._state === 'stunned' ? 1 : 0) - this._kneel) * (1 - Math.exp(-d * 3));
    this._hit = Math.max(0, this._hit - d * 7);
    this._land = Math.max(0, this._land - d * 1.6);
    this._regen = Math.max(0, this._regen - d);
    this._spin += d * this._spinRate;

    // Open: the core kicks on every beat of the music.
    const pulse = this._open * (Number.isFinite(beat) ? Math.exp(-6 * (beat - Math.floor(beat))) : 0);
    // Too hot: it swells and settles at breathing pace. Its clock starts when the heat does, like the reactor's.
    const hot = this._state === 'overheating' || this._state === 'stunned';
    if (!hot) this._hotAt = null; else if (this._hotAt === null) this._hotAt = clock;
    const swell = hot ? this._heat * (Number.isFinite(breath) ? clamp01(breath) : breathFill(clock - this._hotAt)) : 0;
    const flash = Math.min(1, 0.5 * this._hit + 0.8 * this._land);

    // The ring. Gone in a burst when the shield breaks; back as a broken frame if it regrows.
    let burst = -1;
    if (this._burst >= 0) { this._burst += d; if (this._burst >= BURST_SECONDS) this._burst = -1; else burst = this._burst / BURST_SECONDS; }
    this._ringVis += ((this._shield > 0 && burst < 0 ? 1 : 0) - this._ringVis) * (1 - Math.exp(-d * 4));
    const lit = (this._shield / 100) * SEGMENTS, vis = this._ringVis, radius = RING_R * (1 + 0.05 * swell);
    for (let i = 0; i < SEGMENTS; i++) {
      const a = this._spin + i * SLOT;
      let r, turn, len, thick, bright, white;
      if (burst >= 0) {
        const fade = 1 - burst;
        r = RING_R + (0.45 + 0.4 * RND[i]) * (1 - fade ** 3);
        turn = 5 * burst * JIT[i];
        len = SEG_LEN * 0.7 * fade; thick = SEG_THICK * fade;
        bright = 1 - 0.5 * burst; white = 0.9 * fade; // white-hot, cooling to the ring's colour as it shrinks away
      } else {
        const on = clamp01(lit - (SEGMENTS - 1 - RANK[i])); // 1 = lit, 0 = out, between = the one being chipped right now
        r = radius + 0.035 * this._crack * SIDE[i];
        turn = 0.2 * this._crack * JIT[i];
        len = SEG_LEN * (0.86 - 0.2 * this._crack) * (0.45 + 0.55 * on) * vis;
        thick = SEG_THICK * (0.4 + 0.6 * on) * vis;
        bright = this._gain * (GHOST + (1 - GHOST) * on);
        white = flash * on + (on > 0 && on < 1 ? 0.35 * this._regen * (0.5 + 0.5 * Math.sin(this._t * 9)) : 0);
      }
      dummy.position.set(Math.cos(a) * r, CORE_Y + Math.sin(a) * r, RING_Z);
      dummy.rotation.set(0, 0, a + Math.PI / 2 + turn);
      dummy.scale.set(len, thick, SEG_DEPTH);
      dummy.updateMatrix();
      this.ring.setMatrixAt(i, dummy.matrix);
      this.ring.setColorAt(i, c.copy(this._ringCol).multiplyScalar(bright).lerp(WHITE, clamp01(white)));
    }
    // The visor: a slit of light in the state's colour. It narrows while stunned.
    dummy.position.set(0, VISOR_Y, VISOR_Z); dummy.rotation.set(0, 0, 0); dummy.scale.set(0.3, 0.06 * (1 - 0.5 * this._kneel), 0.03); dummy.updateMatrix();
    this.ring.setMatrixAt(SEGMENTS, dummy.matrix);
    this.ring.setColorAt(SEGMENTS, c.copy(this._ringCol).multiplyScalar(this._gain * (0.8 + 0.2 * pulse)).lerp(WHITE, 0.5 * flash));

    // The core: its size and brightness are what is left of it; brighter once nothing shields it.
    const alive = this._core / 100, bare = this._shield > 0 ? 0.8 : 1;
    let glow = this._glow * (0.35 + 0.65 * alive) * bare + 0.8 * pulse * (0.4 + 0.6 * alive) + 0.5 * swell;
    if (alive < 0.25) glow *= 0.82 + 0.18 * Math.sin(this._t * 29); // nearly out: it flickers
    this.core.scale.setScalar((0.55 + 0.45 * alive) * (1 + 0.12 * pulse + 0.08 * swell + 0.1 * this._hit + 0.3 * this._land));
    this.core.rotation.y += d * (0.4 + 1.8 * this._open);
    this.core.rotation.x += d * 0.27;
    this.coreMat.emissive.copy(this._coreCol).lerp(WHITE, clamp01(0.4 * this._hit + 0.9 * this._land));
    this.coreMat.color.copy(this.coreMat.emissive).multiplyScalar(0.5);
    this.coreMat.emissiveIntensity = glow + 0.6 * this._hit * this._open + 1.5 * this._land;

    const aura = clamp01(this._aura * (0.4 + 0.6 * alive) * bare + 0.3 * pulse + 0.35 * swell + 0.2 * this._hit + 0.9 * this._land);
    this.halo.visible = aura > 0.004;
    this.halo.scale.setScalar((1.3 + 0.3 * pulse + 0.7 * swell + 0.25 * this._hit + 1.4 * this._land) * (0.7 + 0.3 * alive));
    this.haloMat.color.copy(this.coreMat.emissive);
    this.haloMat.opacity = aura;

    this.bodyMat.emissive.copy(this._ringCol).multiplyScalar(0.012 * this._gain).add(BODY_GLOW); // the body picks up a little of the ring's light
  }

  /** Defeated: the core swells white and bursts once, its pieces fly out, the lights go out and the figure sinks away. */
  _finaleFrame(d) {
    const f = (this._finale += d), c = this._c, dummy = this._dummy;
    const swell = f / 0.3;
    this.core.visible = swell < 1;
    this.core.scale.setScalar(0.6 + 0.9 * swell);
    this.coreMat.emissive.copy(WHITE); this.coreMat.color.copy(WHITE); this.coreMat.emissiveIntensity = 2;
    const h = clamp01(f / 0.9);
    this.halo.visible = h < 1;
    this.halo.scale.setScalar(1.6 + 3.2 * (1 - (1 - h) ** 3));
    this.haloMat.color.copy(GOLD).lerp(WHITE, 1 - h);
    this.haloMat.opacity = (1 - h) * (1 - h);
    // The pieces: the ring's boxes, free now that the shield is gone.
    const s = clamp01(f / 1.3), out = 1 - (1 - s) ** 3;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * SLOT + 2 * JIT[i], r = 0.2 + (0.8 + 0.6 * RND[i]) * out;
      dummy.position.set(Math.cos(a) * r, CORE_Y + Math.sin(a) * r, RING_Z);
      dummy.rotation.set(0, 0, a + 6 * s * SIDE[i]);
      dummy.scale.setScalar(0.2 * (1 - s) * (0.6 + 0.8 * RND[i]));
      dummy.updateMatrix();
      this.ring.setMatrixAt(i, dummy.matrix);
      this.ring.setColorAt(i, c.copy(GOLD).lerp(WHITE, 1 - s));
    }
    dummy.scale.setScalar(0); dummy.updateMatrix();
    this.ring.setMatrixAt(SEGMENTS, dummy.matrix); // the visor goes dark
    this.bodyMat.emissive.copy(BODY_GLOW).multiplyScalar(1 - 0.8 * clamp01((f - 0.5) / 1.2));
    this._fall = clamp01((f - 1.6) / 2.3);
    if (f >= FINALE_SECONDS) { this._finale = -1; this._finaleDone = true; this._shown = false; this._rise = 0; this._park(); }
  }

  /** The label is redrawn only when what it says changes: a whole percent, the state, or the regrowing note. */
  _labelFrame() {
    const down = this._finale >= 0, up = this._shield > 0;
    const pct = wholePct(up ? this._shield : this._core);
    const regrowing = this._state === 'guarded' && this._regen > 0;
    const key = down ? -1 : STATES.indexOf(this._state) * 10000 + (up ? 2000 : 0) + (regrowing ? 1000 : 0) + pct;
    if (key !== this._labelKey) {
      this._labelKey = key;
      const look = LOOK[this._state];
      if (down) drawLabel(this._g, 'GUARDIAN DOWN', '', '', false);
      else drawLabel(this._g, `GUARDIAN  ${up ? 'SHIELD' : 'CORE'} ${pct}%`, regrowing ? 'SHIELD REGROWING' : look.line, look.css, look.warn);
      this.labelTex.needsUpdate = true;
    }
    const fade = clamp01((this._rise - 0.5) / 0.4) * (down ? 1 - clamp01((this._finale - 2.4) / 0.8) : 1);
    this.label.visible = fade > 0.004;
    this.labelMat.opacity = fade;
  }
}
