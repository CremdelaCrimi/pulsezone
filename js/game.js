// PulseZone VR: WebXR game for Meta Quest Browser (also playable on desktop with a mouse).
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import {
  SimulatedHeart, SimulatedPlayer, RemoteHeartSource, ZoneController, Phase, Zone,
  evaluateDifficulty, estimatedMaxBpm, EASY, HARD, WALL_TYPES, wallPolygon, wallHitsHead,
  planOrb, swingMatches, heatLook, ACTIVITIES, chooseActivity, wallTypeFor, ChallengeBoost, boostDifficulty,
  HeartRateAttribution, wallDepth, tracePath, traceSeconds, tracePoints, sweepPath, sweepSeconds, SWEEP_HALF_GAP,
  TRACE_RADIUS, TRACE_DEPTH, onRope, LOW_WALLS, heartTrend, streakMilestone, ZONE_STREAK_STEP,
  summarizeWorkout, updateBests, MIN_RECORD_SECONDS, SLAM_BOX, SLAM_GAP, fistSlams, slamTogether,
  SHIFT, shiftWanted, shiftOffsetAt, availableCombos, comboGap, comboChance, comboPlan,
  minPunchTravel, powerPunchSpeed, punchPower, bagPoints, ROPE_PUMP_SPEED,
  lanePlan, laneFree, SPAWN_DISTANCE, COUNTER_DISTANCE,
} from './core.js?v20';
import { HostLink } from './link.js?v8';
import { AudioEngine } from './audio.js?v20';
import { HeartThermometer } from './thermo.js?v7';
import { OptionsPanel } from './options.js?v20';
import { loadTuning, createDevPanel } from './dev.js?v20';

const params = new URLSearchParams(location.search);
const SMOKE = params.has('smoke');            // automated play-through for testing
const BASE_SPEED = Number(params.get('speed')) || 1;
const PHONE_TIMEOUT = 6;                       // seconds without phone readings before estimating (controller gives up at 8)

// ------------------------------------------------------------------ settings & tuning

const SETTINGS_KEY = 'pulsezone.settings';
const settings = {
  targetBpm: 120, age: 30, trainingMinutes: 15, warmUpSeconds: 30, coolDownMinutes: 2, sound: true, volume: 0.8, challenge: 'normal',
  gameType: 'punch',   // 'punch' = hit hard enough; 'touch' = just hold your hand where the orb arrives
  musicStyle: 'song',  // 'song' = recorded track (time-stretched to your pace) when available; 'synth' = live synth
  // The moveset: which moves the game may send you. Shared by the page checklist and the VR board.
  moves: {
    jab: true, low: true, swing: true, power: true, pair: true, guard: true, trace: true, sweep: true,
    bag: true, ropes: true, duck: true, squatSide: true, lean: true, pillar: true, shift: true,
  },
};
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  const moves = { ...settings.moves, ...(saved.walls || {}), ...(saved.moves || {}) }; // older saves had walls/trace
  if (typeof saved.trace === 'boolean' && !saved.moves) moves.trace = saved.trace;
  Object.assign(settings, saved, { moves });
  delete settings.walls; delete settings.trace;
  delete settings.warmUpMinutes; // older saves had a 2-minute warm-up; it's now in seconds (30 s default)
} catch { /* ignore */ }
const MOVE_LABELS = {
  jab: 'Punches', low: 'Squat punches', swing: 'Hooks & uppercuts', power: 'Power orbs', pair: 'Squat then reach up', guard: 'Guard & counter',
  trace: 'Rope tracing', sweep: 'Two-hand rope', bag: 'Speed bag', ropes: 'Battle ropes',
  duck: 'Duck', squatSide: 'Side squat', lean: 'Lean left/right', pillar: 'Centre pillar', shift: 'Side shifts (step left/right)',
};
/** Which activities the moveset allows right now (forSpawn: also respect burst cooldowns). */
const enabledActivities = (forSpawn = false) => ({
  jab: settings.moves.jab,
  low: settings.moves.low,
  swing: settings.moves.swing && settings.gameType === 'punch', // swing direction needs a real punch
  power: settings.moves.power && settings.gameType === 'punch', // power is all about punching hard
  pair: settings.moves.pair,
  guard: settings.moves.guard,
  trace: settings.moves.trace,
  sweep: settings.moves.sweep,
  bag: settings.moves.bag && (!forSpawn || gameTime >= bagReadyAt),
  ropes: settings.moves.ropes && (!forSpawn || gameTime >= ropesReadyAt),
  duck: settings.moves.duck,
  squatSide: settings.moves.squatSide,
  lateral: settings.moves.lean || settings.moves.pillar,
});
if (params.has('warmup')) settings.warmUpSeconds = Number(params.get('warmup')) * 60; // ?warmup= is in minutes
if (params.has('minutes')) settings.trainingMinutes = Number(params.get('minutes'));
if (params.has('cooldown')) settings.coolDownMinutes = Number(params.get('cooldown'));
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

let tuning = loadTuning();
const CHALLENGE = {
  gentle: { kp: 0.7, ki: 0.7, rise: 2.0 },
  normal: { kp: 1.0, ki: 1.0, rise: 1.0 },
  hard: { kp: 1.4, ki: 1.6, rise: 0.55 },
};
const difficultyFor = (intensity) => evaluateDifficulty(intensity, { ...EASY, ...tuning.easy }, { ...HARD, ...tuning.hard });

// ------------------------------------------------------------------ renderer & scene

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
const skyBase = new THREE.Color(0x0b0d18);
scene.background = skyBase.clone();
scene.fog = new THREE.Fog(0x0b0d18, 14, 32);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
camera.position.set(0, 1.6, 0);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1a2a, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(2, 5, 3);
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 44), new THREE.MeshStandardMaterial({ color: 0x141826, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.z = -16;
scene.add(floor);
const railMat = new THREE.MeshStandardMaterial({ color: 0x3f7fe6, emissive: 0x1a3d80 });
for (const x of [-1.3, 1.3]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 30), railMat);
  rail.position.set(x, 0.02, -13);
  scene.add(rail);
}
const stripeMat = new THREE.MeshBasicMaterial({ color: 0x233050 });
const stripes = [];
for (let i = 0; i < 14; i++) {
  const s = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.005, 0.06), stripeMat);
  s.position.set(0, 0.006, -i * 2);
  scene.add(s);
  stripes.push(s);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ audio

const audio = new AudioEngine();
audio.setEnabled(settings.sound);
audio.setVolume(settings.volume);
// Recorded soundtrack: "Hard-Knuckle Focus" (made with Gemini). Measured 121 BPM; loops over 87 whole
// bars, skipping its intro and silent ending. If the file is missing, the live synth plays instead.
const SONG = { url: 'assets/music/hard-knuckle-focus.mp3', bpm: 121, loopStart: 4.096, loopEnd: 176.63 };
let songAvailable = false;
fetch(SONG.url, { method: 'HEAD' }).then((r) => {
  songAvailable = r.ok;
  if (songAvailable) audio.setSong(SONG.url, SONG.bpm, SONG.loopStart, SONG.loopEnd);
  audio.setMusicMode(songAvailable && settings.musicStyle === 'song' ? 'song' : 'synth');
}).catch(() => { /* offline: synth only */ });
const unlockAudio = () => audio.unlock();
let songWarned = false;
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

// ------------------------------------------------------------------ fists (colour = hand)

const HAND_COLOR = { left: 0x3fa9ff, right: 0xff7a3d };
const FIST_R = 0.055;
function makeFist(hand) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(FIST_R, 20, 14),
    new THREE.MeshStandardMaterial({ color: HAND_COLOR[hand], emissive: HAND_COLOR[hand], emissiveIntensity: 0.25, roughness: 0.4 }),
  );
  m.scale.set(1, 0.85, 1.25);
  return { hand, mesh: m, speed: 0, vel: new THREE.Vector3(), last: new THREE.Vector3(), hasLast: false, world: new THREE.Vector3(), source: null, hist: [] };
}
const fists = [makeFist('left'), makeFist('right')];
const fistByHand = { left: fists[0], right: fists[1] };
const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
const gripHand = [null, null];
grips.forEach((g, i) => {
  rig.add(g);
  g.addEventListener('connected', (e) => { gripHand[i] = e.data; if (renderer.xr.isPresenting) attachFistsForMode(); });
  g.addEventListener('disconnected', () => { gripHand[i] = null; });
});

function attachFistsForMode() {
  const xr = renderer.xr.isPresenting;
  for (let i = 0; i < 2; i++) {
    const f = fists[i];
    f.mesh.removeFromParent();
    if (xr) {
      const gi = gripHand.findIndex((s) => s && s.handedness === f.hand);
      (gi >= 0 ? grips[gi] : grips[i]).add(f.mesh);
      f.mesh.position.set(0, 0, 0);
      f.source = gi >= 0 ? gripHand[gi] : gripHand[i];
    } else {
      camera.add(f.mesh);
    }
    f.hasLast = false;
    f.hist.length = 0;
  }
}
renderer.xr.addEventListener('sessionstart', () => {
  audio.unlock();
  setTimeout(() => { attachFistsForMode(); recenterSoon = true; }, 300);
  // In VR there are no page taps: a controller trigger or grip is the gesture that can start audio.
  const session = renderer.xr.getSession();
  for (const ev of ['selectstart', 'squeezestart']) session?.addEventListener(ev, unlockAudio);
});
renderer.xr.addEventListener('sessionend', () => { camera.position.set(0, 1.6, 0); camera.rotation.set(0, 0, 0); attachFistsForMode(); centerX = 0; });
attachFistsForMode();

function pulse(fist, strength = 0.6, ms = 40) {
  try { fist?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); } catch { /* not supported */ }
}
const pulseBoth = (s, ms) => fists.forEach((f) => pulse(f, s, ms));

/** Where the fist was `secondsAgo` (from a short position history), for judging swing direction. */
function fistDisplacement(f, secondsAgo = 0.18) {
  const tNow = performance.now() / 1000;
  let old = null;
  for (let i = f.hist.length - 1; i >= 0; i--) { if (tNow - f.hist[i][0] >= secondsAgo) { old = f.hist[i][1]; break; } }
  if (!old && f.hist.length) old = f.hist[0][1];
  return old ? f.world.clone().sub(old) : f.vel.clone();
}

// ------------------------------------------------------------------ heart rate & workout

let sim = null;
const remote = new RemoteHeartSource();
let sourceKind = 'sim';        // 'sim' | 'phone'
let userChoseSource = false;
let phoneFallback = false;     // phone went quiet: estimate from movement until it's back
let workloadMode = 'Motion';   // simulator: Motion | AutoPlayer | Manual
let manualWorkload = 0.3;
const autoPlayer = new SimulatedPlayer();
let controller = null;
let boost = new ChallengeBoost();
let difficulty = difficultyFor(0.15);
let signalLostToggle = false;
let avgSum = 0, avgN = 0;
let lastStatus = Zone.NoSignal;
let gameTime = 0;              // seconds of (unpaused) workout

// Learned "what raises your heart rate", kept across workouts in this browser.
const GAINS_KEY = 'pulsezone.gains';
const loadGains = () => { try { return JSON.parse(localStorage.getItem(GAINS_KEY) || 'null'); } catch { return null; } };
const saveGains = () => { try { localStorage.setItem(GAINS_KEY, JSON.stringify(attribution.w)); } catch { /* ignore */ } };
let attribution = new HeartRateAttribution({ weights: loadGains() });
let gainsSavedAt = 0;

/** The heart-rate source actually driving the game right now. */
const source = () => (sourceKind === 'phone' && !phoneFallback ? remote : sim);

let bridgeStatus = '';
const link = new HostLink({
  onBpm: (bpm) => {
    remote.push(bpm);
    if (sourceKind === 'sim' && !userChoseSource) {
      sourceKind = 'phone';
      say('Phone heart rate connected');
    }
  },
  onBridgeStatus: (text) => { bridgeStatus = text; },
  onChange: (l) => { if (l.state !== 'linked') bridgeStatus = ''; updatePanel(true); },
});

function updateRemoteStatus() {
  if (phoneFallback) {
    remote.statusText = 'Phone went quiet - estimating from your movement. Wake the phone to restore real heart rate.';
  } else if (link.state === 'linked') {
    remote.statusText = remote.hasReading && remote.secondsSinceLastReading < 5
      ? (bridgeStatus || 'Live from phone')
      : (bridgeStatus || 'Phone linked') + ' - waiting for heart rate';
  } else if (link.state === 'waiting') {
    remote.statusText = remote.hasReading
      ? `Phone disconnected - wake it or reopen the bridge (code ${link.code})`
      : `Phone not linked - open the bridge page in Bluefy, code ${link.code}`;
  } else if (link.state === 'offline') {
    remote.statusText = link.error || 'Offline';
  } else {
    remote.statusText = 'Starting phone link...';
  }
}

function startWorkout() {
  if (controller && gameTime > 30) saveSession();
  const maxBpm = estimatedMaxBpm(settings.age);
  settings.targetBpm = Math.max(80, Math.min(settings.targetBpm, Math.round(maxBpm * 0.85)));
  const ch = CHALLENGE[settings.challenge] || CHALLENGE.normal;
  sim = new SimulatedHeart({ restingBpm: 65, maxBpm, seed: (Math.random() * 2 ** 31) | 0 });
  controller = new ZoneController({
    ...tuning.controller,
    kp: tuning.controller.kp * ch.kp,
    ki: tuning.controller.ki * ch.ki,
    targetBpm: settings.targetBpm,
    safetyCeilingBpm: Math.min(maxBpm * 0.9, settings.targetBpm + 35),
    warmUpSeconds: settings.warmUpSeconds,
    trainingSeconds: settings.trainingMinutes * 60,
    coolDownSeconds: settings.coolDownMinutes * 60,
  });
  boost = new ChallengeBoost({ riseSeconds: tuning.boostRiseSeconds * ch.rise });
  attribution = new HeartRateAttribution({ weights: loadGains() });
  signalLostToggle = false;
  phoneFallback = false;
  avgSum = avgN = 0;
  gameTime = 0;
  sessionLog.length = 0;
  finishedPlayed = false;
  shiftReadyAt = 0;
  zoneStreak = 0; longestStreak = 0; streakFlash = 0; trend = trendShown = projSmooth = null; trendFor = 0;
  summaryBoard.visible = false; lastSummary = null;
  clearObstacles();
  score.reset();
  resetReactor();
  hudKey = '';
  recenterSoon = true;
}

function setTarget(bpm) {
  const maxBpm = estimatedMaxBpm(settings.age);
  settings.targetBpm = Math.max(80, Math.min(bpm, Math.round(maxBpm * 0.85)));
  controller.s.targetBpm = settings.targetBpm;
  controller.s.safetyCeilingBpm = Math.min(maxBpm * 0.9, settings.targetBpm + 35);
  saveSettings();
  updatePanel(true);
}
const nudgeTarget = (delta) => setTarget(settings.targetBpm + delta);

function setSource(kind) {
  userChoseSource = true;
  sourceKind = kind;
  phoneFallback = false;
  say(sourceKind === 'sim' ? 'Simulated heart rate' : 'Phone heart rate');
  updatePanel(true);
}
const toggleSource = () => setSource(sourceKind === 'sim' ? 'phone' : 'sim');

/** Warm-up length choices on the VR board (seconds; 0 = straight into training). */
const WARMUP_STEPS = [0, 15, 30, 45, 60, 90, 120, 180, 300];
function stepWarmUp(sec, dir) {
  const next = dir > 0 ? WARMUP_STEPS.find((v) => v > sec) : [...WARMUP_STEPS].reverse().find((v) => v < sec);
  return next ?? sec;
}
/** Change the warm-up, also for the workout in progress (a shorter one ends it straight away). */
function setWarmUp(sec) {
  settings.warmUpSeconds = sec;
  controller.s.warmUpSeconds = sec;
  $('warmup').value = sec;
  saveSettings();
}
function setSound(on) { settings.sound = on; audio.setEnabled(on); $('sound').checked = on; saveSettings(); }

/** Phone went quiet (screen locked?): keep the workout adapting from movement until it's back. */
function updatePhoneFallback(xr, dt) {
  if (sourceKind !== 'phone') { phoneFallback = false; return; }
  if (!phoneFallback && remote.hasReading && remote.secondsSinceLastReading > PHONE_TIMEOUT) {
    phoneFallback = true;
    sim.trueBpm = remote.currentBpm;
    sim.drift = 0;
    sim.noise = 0;
    sim.currentBpm = remote.currentBpm;
    sim.hasReading = true;
    sim.secondsSinceLastReading = 0;
    sim.signalLost = false;
    say('Phone went quiet - estimating from movement');
    audio.sfx('alert');
    pulseBoth(0.8, 150);
  } else if (phoneFallback && remote.secondsSinceLastReading < 2) {
    phoneFallback = false;
    say('Phone heart rate is back');
    audio.sfx('zone');
  }
  if (phoneFallback) sim.workload = xr ? motion.workload : autoPlayer.tick(controller.intensity, dt);
}

// Motion -> workload, for the simulator in the headset.
const motion = { hand: 0, head: 0, lastHead: new THREE.Vector3(), lastL: new THREE.Vector3(), lastR: new THREE.Vector3(), has: false, workload: 0.15 };
function updateMotion(dt, head) {
  const l = fists[0].world, r = fists[1].world;
  if (motion.has && dt > 0) {
    const rel = (p, lp) => Math.hypot(p.x - head.x - (lp.x - motion.lastHead.x), p.y - head.y - (lp.y - motion.lastHead.y), p.z - head.z - (lp.z - motion.lastHead.z)) / dt;
    const a = 1 - Math.exp(-dt / 4);
    motion.hand += (Math.min(6, (rel(l, motion.lastL) + rel(r, motion.lastR)) / 2) - motion.hand) * a;
    const bodyMove = Math.hypot(head.y - motion.lastHead.y, (head.x - motion.lastHead.x) * 0.7) / dt;
    motion.head += (Math.min(2, bodyMove) - motion.head) * a;
  }
  motion.lastHead.copy(head); motion.lastL.copy(l); motion.lastR.copy(r); motion.has = true;
  motion.workload = Math.min(1, 0.12 + 0.55 * Math.min(1, motion.hand / 2.2) + 0.45 * Math.min(1, motion.head / 0.6));
}

// ------------------------------------------------------------------ score

const score = {
  reset() { Object.assign(this, { score: 0, combo: 0, best: 0, hits: 0, perfect: 0, misses: 0, weak: 0, wrong: 0, dodges: 0, wallHits: 0, blocks: 0, guardsMissed: 0 }); },
  inZone: () => controller?.status === Zone.InZone,
  hit(bonus = 1, label = '') {
    this.hits++; this.combo++; this.best = Math.max(this.best, this.combo);
    const pts = Math.round(10 * bonus * Math.min(4, 1 + Math.floor(this.combo / 10)) * (this.inZone() ? 2 : 1));
    this.score += pts;
    say(`${label}+${pts}${this.inZone() ? '  IN ZONE x2' : ''}`);
  },
  dodge() {
    this.dodges++; this.combo++; this.best = Math.max(this.best, this.combo);
    const pts = 15 * (this.inZone() ? 2 : 1);
    this.score += pts;
    say(`Dodged! +${pts}`);
  },
  miss() { this.misses++; this.combo = 0; },
  weakHit(msg = 'Punch harder!') { this.weak++; say(msg); },
  wrongHand(hand) { this.wrong++; say(hand === 'left' ? 'Left hand - blue!' : 'Right hand - orange!'); },
  wallHit() { this.wallHits++; this.combo = 0; },
};
score.reset();
let lastEvent = '', lastEventAt = -10;
const now = () => performance.now() / 1000;
function say(text) { lastEvent = text; lastEventAt = now(); }

// ------------------------------------------------------------------ orbs, swing guides, walls, bursts

const orbGeo = new THREE.SphereGeometry(1, 24, 16);
const burstGeo = new THREE.SphereGeometry(1, 12, 8);
const ghostGeo = new THREE.SphereGeometry(0.035, 12, 8);
const arrowHeadGeo = new THREE.ConeGeometry(0.045, 0.1, 14);
const orbMat = (hand) => new THREE.MeshStandardMaterial({ color: HAND_COLOR[hand], emissive: HAND_COLOR[hand], emissiveIntensity: 0.35, roughness: 0.3 });
const MAT = {
  left: orbMat('left'),
  right: orbMat('right'),
  weak: new THREE.MeshStandardMaterial({ color: 0x80808c, roughness: 0.5 }),
  guide: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
  ghostL: new THREE.MeshBasicMaterial({ color: HAND_COLOR.left, transparent: true, opacity: 0.9 }),
  ghostR: new THREE.MeshBasicMaterial({ color: HAND_COLOR.right, transparent: true, opacity: 0.9 }),
  wall: new THREE.MeshBasicMaterial({ color: 0xd94cf2, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
  wallEdge: new THREE.LineBasicMaterial({ color: 0xf5a3ff }),
  wallHit: new THREE.MeshBasicMaterial({ color: 0xff2626, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  // Power orbs: faceted, armoured, glowing harder.
  powerL: new THREE.MeshStandardMaterial({ color: HAND_COLOR.left, emissive: HAND_COLOR.left, emissiveIntensity: 0.75, roughness: 0.25, metalness: 0.3, flatShading: true }),
  powerR: new THREE.MeshStandardMaterial({ color: HAND_COLOR.right, emissive: HAND_COLOR.right, emissiveIntensity: 0.75, roughness: 0.25, metalness: 0.3, flatShading: true }),
  shell: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  pairLink: new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, dashSize: 0.12, gapSize: 0.08 }),
};
const powerGeo = new THREE.IcosahedronGeometry(1, 0);
const powerShellGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.35, 0));
const shardGeo = new THREE.TetrahedronGeometry(1, 0);

/**
 * The curve your fist should travel for a swing orb, drawn through the orb (orb at origin,
 * +z toward you): a glowing tube, an arrowhead at the end and a "ghost fist" that keeps sliding
 * along it so you can see the motion.
 */
const SWING_PATHS = {
  up: [[0, -0.42, 0.3], [0, -0.38, -0.02], [0, 0.24, -0.02]],          // uppercut: from low in front, up through the orb
  left: [[0.48, -0.04, 0.28], [0.12, -0.02, -0.1], [-0.28, 0, -0.02]],  // hook travelling right-to-left
  right: [[-0.48, -0.04, 0.28], [-0.12, -0.02, -0.1], [0.28, 0, -0.02]],
};
const guideCache = {};
function swingGuide(swing, hand) {
  const [a, b, c] = SWING_PATHS[swing].map((p) => new THREE.Vector3(...p));
  const curve = new THREE.QuadraticBezierCurve3(a, b, c);
  if (!guideCache[swing]) guideCache[swing] = new THREE.TubeGeometry(curve, 24, 0.02, 8, false);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(guideCache[swing], MAT.guide));
  const head = new THREE.Mesh(arrowHeadGeo, MAT.guide);
  head.position.copy(c);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
  group.add(head);
  const ghost = new THREE.Mesh(ghostGeo, hand === 'left' ? MAT.ghostL : MAT.ghostR);
  group.add(ghost);
  return { group, curve, ghost };
}

const orbs = [], walls = [], bursts = [], shards = [];
window.__orbs = orbs; // test hook
window.__walls = walls;
setTimeout(() => { window.__traces = traces; });
let spawnTimer = 0;
// Lane timeline: booked arrival slots so obstacles never crowd each other (see lanePlan in core.js).
let lane = [];
let queuedActivity = null, queuedFor = 0;
let shiftPlan = null, shiftReadyAt = 0, shiftSaid = '';      // side shift (footwork) window, in arrival time
let standNext = false;                                // a squat box was sent: a "Stand tall!" box comes next
let bag = null, ropes = null, pendingBurst = null;   // speed bag / battle ropes (one at a time)
let bagReadyAt = 0, ropesReadyAt = 0;                // burst cooldowns (game seconds)
let centerX = 0;
let recenterSoon = true;

function clearObstacles() {
  for (const o of [...orbs, ...walls, ...bursts]) scene.remove(o.group || o.mesh);
  for (const p of shardPool) p.alive = false;
  for (const t of traces) scene.remove(t.group, ...t.strands.map((r) => r.marker));
  orbs.length = walls.length = bursts.length = traces.length = shards.length = 0;
  if (bag) { scene.remove(bag.group); bag = null; }
  if (ropes) { endRopes(false); }
  for (const g of guards) scene.remove(g.group);
  guards.length = 0;
  for (const s of slams) scene.remove(s.group);
  slams.length = 0;
  pendingBurst = null;
  bagReadyAt = ropesReadyAt = 0;
  spawnTimer = 0;
  lane = [];
  queuedActivity = null; queuedFor = 0;
  standNext = false;
  combos.clear();
  shiftPlan = null; shiftSaid = ''; shiftPad.visible = false;
}

/**
 * Walls are translucent boxes: the open gap is where your head goes, and the box's length is
 * how long you have to hold the position (about 1.2 s for a duck).
 */
function spawnWall(head, standing, type, activity) {
  const poly = wallPolygon(type, standing);
  const speed = difficulty.orbSpeed * 0.8;
  const depth = wallDepth(type, speed);
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x + centerX, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const group = new THREE.Group();
  const fill = new THREE.Mesh(geo, MAT.wall);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), MAT.wallEdge);
  group.add(fill, edge);
  group.position.z = head.z - 14 - depth; // geometry spans z..z+depth (near face = z+depth)
  scene.add(group);
  if (LOW_WALLS.includes(type)) standNext = true;   // you'll have to stand back up for the next box
  if (type === 'rise') standNext = false;
  walls.push({
    mesh: group, fill, poly, type, activity: activity === 'stand' ? null : activity, depth, speed, passZ: head.z + 0.3, hit: false, announced: false,
    label: WALL_TYPES.find((w) => w.type === type).label,
  });
}

/**
 * Orbs. `opts` can fix the position / hand / swing (used by squat-then-reach pairs) and push the
 * orb further back (`behind` metres) so it arrives later. Power orbs are faceted, armoured and
 * need a full punch.
 */
function spawnOrb(head, standing, activity, opts = {}) {
  const d = difficulty;
  const power = activity === 'power';
  const r = power ? 0.15 : 0.125;
  const x = opts.x ?? (Math.random() * 2 - 1) * d.horizontalSpread * (power ? 0.7 : 1);
  let hand = opts.hand ?? planOrb(x, d).hand;
  let swing = opts.swing ?? null;
  if (activity === 'swing' && !opts.swing) {
    hand = x < 0 ? 'left' : 'right';
    swing = Math.random() < 0.5 ? 'up' : (hand === 'right' ? 'left' : 'right');
  }
  if (power) hand = x < 0 ? 'left' : 'right';
  const chest = standing - 0.35;
  const y = opts.y ?? (activity === 'low'
    ? Math.max(0.55, standing - 0.95 + Math.random() * 0.15)   // knee-to-hip height: squat and punch
    : power ? chest + (Math.random() - 0.5) * 0.15
      : Math.max(0.6, chest + (Math.random() * 1.4 - 1) * d.verticalSpread));
  const group = new THREE.Group();
  group.position.set(centerX + x + (opts.shift || 0), y, head.z - (opts.dist ?? SPAWN_DISTANCE) - (opts.behind || 0));
  const baseMat = power ? (hand === 'left' ? MAT.powerL : MAT.powerR) : MAT[hand];
  const mesh = new THREE.Mesh(power ? powerGeo : orbGeo, baseMat);
  mesh.scale.setScalar(r);
  group.add(mesh);
  let shell = null;
  if (power) { // spiky wireframe armour that spins
    shell = new THREE.LineSegments(powerShellGeo, MAT.shell);
    shell.scale.setScalar(r);
    group.add(shell);
  }
  let guide = null;
  if (swing) { guide = swingGuide(swing, hand); group.add(guide.group); }
  if (opts.link) { // dashed line back to the first orb of a pair: "low, then up"
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(...opts.link)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), MAT.pairLink);
    line.computeLineDistances();
    group.add(line);
  }
  scene.add(group);
  const orb = {
    group, mesh, shell, baseMat, r, hand, swing, guide, activity, power, counter: !!opts.counter, speed: opts.speed ?? d.orbSpeed, minPunch: d.minPunchSpeed,
    immuneUntil: 0, flashUntil: 0, passZ: head.z + 0.6, dying: 0, combo: opts.combo || 0,
  };
  orbs.push(orb);
  return orb;
}

/**
 * Squat, then reach up: a low orb for one hand, then a high orb for the other hand about 0.85 s
 * later (it flies in behind the first). Like a squat jump without leaving the floor.
 */
function spawnPair(head, standing) {
  const d = difficulty;
  const side = Math.random() < 0.5 ? -1 : 1;
  const lowX = side * (0.12 + Math.random() * 0.15);
  const lowY = Math.max(0.55, standing - 0.95 + Math.random() * 0.1);
  const highX = -side * (0.08 + Math.random() * 0.12);
  const highY = standing + 0.1 + Math.random() * 0.08;
  const lowHand = side < 0 ? 'left' : 'right';
  const highHand = lowHand === 'left' ? 'right' : 'left';
  const gap = d.orbSpeed * 0.85;
  spawnOrb(head, standing, 'pair', { x: lowX, y: lowY, hand: lowHand, speed: d.orbSpeed });
  spawnOrb(head, standing, 'pair', {
    x: highX, y: highY, hand: highHand, behind: gap, speed: d.orbSpeed,
    swing: settings.gameType === 'punch' ? 'up' : null,
    link: [lowX - highX, lowY - highY, gap],
  });
  say('Squat... then reach up!');
}

// ------------------------------------------------------------------ guard & counter

/**
 * A red-hot shot flies at your face: don't punch it, bring both fists up by your chin to block.
 * Block it and a counter orb comes straight in from close range for double points.
 */
const guards = [];
const guardGeo = new THREE.IcosahedronGeometry(0.15, 1);
const guardHaloGeo = new THREE.SphereGeometry(0.24, 18, 12);
const guardMat = new THREE.MeshStandardMaterial({ color: 0xff3b1f, emissive: 0xff3b1f, emissiveIntensity: 1, roughness: 0.4, flatShading: true });
const guardHaloMat = new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
const guardIcon = (() => { // a shield badge floating above the shot
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(40,6,4,0.75)'; g.beginPath(); g.roundRect(4, 4, 248, 120, 26); g.fill();
  g.strokeStyle = '#ff7a3d'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#ffd9c7'; g.font = '700 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('GUARD', 128, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
})();
const guardIconGeo = new THREE.PlaneGeometry(0.34, 0.17);
function spawnGuard(head, standing) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(guardGeo, guardMat);
  const halo = new THREE.Mesh(guardHaloGeo, guardHaloMat);
  const icon = new THREE.Mesh(guardIconGeo, guardIcon);
  icon.position.y = 0.33;
  group.add(core, halo, icon);
  group.position.set(centerX, standing - 0.08, head.z - SPAWN_DISTANCE);
  scene.add(group);
  guards.push({ group, core, halo, icon, speed: difficulty.orbSpeed * 0.9, hitZ: head.z - 0.35, announced: false, teach: teach('guard') });
}
/** Both fists up by your face, in front of you. */
function isGuarding(head, xr) {
  if (SMOKE) return true;
  if (!xr) return keys.has('KeyG');
  return fists.every((f) => f.world.distanceTo(head) < 0.34 && f.world.z < head.z + 0.06 && f.world.y > head.y - 0.42);
}
function updateGuards(dt, xr, head) {
  for (let i = guards.length - 1; i >= 0; i--) {
    const g = guards[i];
    g.group.position.z += g.speed * dt;
    g.core.rotation.x += dt * 5; g.core.rotation.y += dt * 3;
    g.halo.scale.setScalar(1 + 0.15 * Math.sin(gameTime * 18 + i));
    g.icon.lookAt(camera.getWorldPosition(new THREE.Vector3()));
    if (!g.announced && g.group.position.z > head.z - 7) { g.announced = true; say('Incoming! GUARD UP - both fists by your chin'); audio.sfx('alert'); }
    if (g.group.position.z < g.hitZ) continue;
    const pos = g.group.position.clone();
    if (isGuarding(head, xr)) {
      score.blocks++; score.combo++; score.best = Math.max(score.best, score.combo);
      const pts = 15 * (score.inZone() ? 2 : 1);
      score.score += pts;
      say(`Blocked! +${pts}  COUNTER!`);
      audio.sfx('block');
      pulseBoth(1, 90);
      shatter(pos.add(new THREE.Vector3(0, 0, -0.35)), new THREE.Vector3(0, 0.4, -1), 0xff7a3d, 0.5); // burst away from your face
      spawnCounter(head, standing);
    } else {
      score.guardsMissed++; score.combo = 0;
      say('Guard up! Both fists by your chin');
      audio.sfx('wall');
      pulseBoth(1, 160);
      hitFlash = 1;
    }
    attribution.record('guard', gameTime);
    scene.remove(g.group);
    guards.splice(i, 1);
  }
}
let counterHand = 'right';
function spawnCounter(head, standing) {
  counterHand = counterHand === 'right' ? 'left' : 'right';
  const x = counterHand === 'left' ? -0.14 : 0.14;
  spawnOrb(head, standing, 'guard', {
    x, y: standing - 0.32, hand: counterHand, dist: COUNTER_DISTANCE, speed: Math.max(2.5, difficulty.orbSpeed), counter: true,
  });
}

// ------------------------------------------------------------------ the reactor (charges while you're in the zone)

/**
 * A core on the right, opposite the heat gauge. It only charges while your heart rate is in the
 * zone (about a minute of zone time per level). Above the zone it overheats and stops charging;
 * below it stalls and frosts over. Each full charge is a level and a points bonus.
 */
const REACTOR_SECONDS = 60;
const reactor = (() => {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffb347, emissiveIntensity: 0.6, roughness: 0.3, flatShading: true });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), coreMat);
  const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.24, 0)), new THREE.LineBasicMaterial({ color: 0x9fb3d9, transparent: true, opacity: 0.7 }));
  const track = new THREE.Mesh(new THREE.RingGeometry(0.29, 0.325, 64), new THREE.MeshBasicMaterial({ color: 0x262a38, side: THREE.DoubleSide }));
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc04d, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.29, 0.325, 64, 1, Math.PI / 2, 0.001), ringMat);
  ring.position.z = 0.002;
  const lc = document.createElement('canvas'); lc.width = 512; lc.height = 128;
  const tex = new THREE.CanvasTexture(lc); tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.155), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  label.position.y = -0.45;
  group.add(core, cage, track, ring, label);
  scene.add(group);
  return { group, core, coreMat, cage, ring, ringMat, lc, tex, label, charge: 0, level: 0, state: 'idle', pct: -1, key: '', shake: 0, lastWarn: '' };
})();
function resetReactor() { reactor.charge = 0; reactor.level = 0; reactor.pct = -1; reactor.key = ''; reactor.lastWarn = ''; }
const REACTOR_LOOK = {
  zone: { color: 0xffb347, ring: 0xffc04d, text: '#ffd27a' },
  overheat: { color: 0xff2a1a, ring: 0xff5a3d, text: '#ff7a5c' },
  stalled: { color: 0x5fb8ff, ring: 0x5fb8ff, text: '#9fd4ff' },
  idle: { color: 0x8d95a5, ring: 0x8d95a5, text: '#b8bfcc' },
};
const tmpColor = new THREE.Color();
function updateReactor(dt, rawDt, status, running) {
  const r = reactor;
  r.state = status === 'InZone' ? 'zone' : status === 'Above' || status === 'SafetyBrake' ? 'overheat' : status === 'Below' ? 'stalled' : 'idle';
  if (running) {
    if (r.state === 'zone') {
      r.charge += dt / REACTOR_SECONDS;
      if (r.charge >= 1) {
        r.charge = 0; r.level++;
        const bonus = 250 * r.level;
        score.score += bonus;
        say(`REACTOR CHARGED! Level ${r.level}  +${bonus}`);
        audio.sfx('zone');
        pulseBoth(0.7, 120);
        shatter(r.group.position.clone(), new THREE.Vector3(0, 1, 0), 0xffc04d, 1);
      }
    }
    if (r.state === 'overheat' && r.lastWarn !== 'overheat') say('Reactor overheating - ease off, slow your breathing');
    r.lastWarn = r.state;
  }
  const look = REACTOR_LOOK[r.state];
  r.coreMat.color.lerp(tmpColor.set(look.color), 1 - Math.exp(-rawDt * 4));
  r.coreMat.emissive.copy(r.coreMat.color);
  r.ringMat.color.set(look.ring);
  const beat = Math.exp(-6 * (beatPhase % 1));
  r.coreMat.emissiveIntensity = r.state === 'zone' ? 0.7 + 0.8 * beat : r.state === 'overheat' ? 0.6 + 0.6 * Math.random() : 0.25;
  r.core.rotation.y += rawDt * (r.state === 'zone' ? 2.2 : r.state === 'overheat' ? 4 : 0.4);
  r.cage.rotation.y -= rawDt * 0.5; r.cage.rotation.x += rawDt * 0.2;
  r.core.position.x = r.state === 'overheat' ? (Math.random() - 0.5) * 0.02 : 0;
  r.core.scale.setScalar(1 + (r.state === 'zone' ? 0.12 * beat : 0));
  const pct = Math.floor(r.charge * 100);
  if (pct !== r.pct) {
    r.pct = pct;
    r.ring.geometry.dispose();
    r.ring.geometry = new THREE.RingGeometry(0.29, 0.325, 64, 1, Math.PI / 2, -Math.max(0.001, r.charge * Math.PI * 2));
  }
  const key = `${pct}|${r.level}|${r.state}`;
  if (key !== r.key) {
    r.key = key;
    const g = r.lc.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(8,10,18,0.6)'; g.beginPath(); g.roundRect(4, 4, 504, 120, 26); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = look.text; g.font = '700 46px system-ui, sans-serif';
    const word = { zone: `REACTOR ${pct}%`, overheat: 'OVERHEATING', stalled: 'REACTOR STALLED', idle: 'REACTOR' }[r.state];
    g.fillText(word, 256, 50);
    g.fillStyle = '#c9ced8'; g.font = '30px system-ui, sans-serif';
    g.fillText(r.state === 'stalled' ? 'get into your zone to charge' : r.state === 'overheat' ? 'ease off to cool it' : `level ${r.level}`, 256, 98);
    r.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ in-the-zone world (equalizer pillars, embers, fist trails)

let zoneAmt = 0;        // 0..1, eases in when you're in the zone
let beatPhase = 0;      // music beats, for pulsing things to the tempo
let hitFlash = 0;       // red flash when a guard shot gets through
let zoneStreak = 0;     // seconds in the zone without dropping out (training only)
let longestStreak = 0;
let streakFlash = 0;    // lane rails flare up at each streak milestone
let trend = null, trendShown = null, trendFor = 0, projSmooth = null; // 'climbing' / 'easing' (heart catching up with effort)
const eqMats = [0xff8a3d, 0xff4fa3].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.5 }));
const eqGeo = new THREE.BoxGeometry(0.28, 1, 0.28);
eqGeo.translate(0, 0.5, 0); // grow up from the floor
const eqPillars = [];
for (const side of [-1, 1]) {
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(eqGeo, eqMats[(i + (side > 0 ? 1 : 0)) % 2]);
    m.position.set(side * (2.9 + (i % 2) * 0.4), 0, -6 - i * 2.6);
    m.scale.y = 0.001;
    m.visible = false;
    scene.add(m);
    eqPillars.push({ m, i, side });
  }
}
const EMBERS = 260;
const emberPos = new Float32Array(EMBERS * 3);
const emberSpeed = new Float32Array(EMBERS);
for (let i = 0; i < EMBERS; i++) {
  emberPos[i * 3] = (Math.random() - 0.5) * 7; emberPos[i * 3 + 1] = Math.random() * 4; emberPos[i * 3 + 2] = 1 - Math.random() * 30;
  emberSpeed[i] = 0.3 + Math.random() * 0.8;
}
const emberGeo = new THREE.BufferGeometry();
emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
const emberTex = (() => { // soft round glow instead of square points
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,200,120,0.6)'); grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const emberMat = new THREE.PointsMaterial({ color: 0xffa040, map: emberTex, size: 0.07, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const embers = new THREE.Points(emberGeo, emberMat);
embers.frustumCulled = false;
embers.visible = false;
scene.add(embers);
const TRAIL = 14;
const trailGeo = new THREE.SphereGeometry(0.028, 8, 6);
const trails = fists.map((f) => {
  const mat = new THREE.MeshBasicMaterial({ color: HAND_COLOR[f.hand], transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.InstancedMesh(trailGeo, mat, TRAIL);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return { f, mesh, mat };
});
const railBase = new THREE.Color(0x1a3d80), railZone = new THREE.Color(0xff7a1f);
const zoneSky = new THREE.Color(0x1a0e14); // warm dark sky while you're in the zone
const trailDummy = new THREE.Object3D();
function updateZoneWorld(rawDt, inZone, paused, head) {
  zoneAmt += ((inZone ? 1 : 0) - zoneAmt) * (1 - Math.exp(-rawDt / (inZone ? 0.8 : 1.5)));
  const on = zoneAmt > 0.02;
  for (const p of eqPillars) {
    p.m.visible = on;
    if (!on) continue;
    const env = Math.exp(-5 * ((beatPhase + (p.i % 4) * 0.25) % 1));
    const h = 0.1 + zoneAmt * (0.4 + 1.5 * env * (0.6 + 0.4 * Math.sin(p.i * 1.7 + p.side)));
    p.m.scale.y = h;
    p.m.position.z = head.z - 6 - p.i * 2.6;
  }
  for (const m of eqMats) m.emissiveIntensity = 0.5 + 0.8 * Math.exp(-5 * (beatPhase % 1));
  embers.visible = on;
  emberMat.opacity = 0.85 * zoneAmt;
  if (on && !paused) {
    for (let i = 0; i < EMBERS; i++) {
      emberPos[i * 3 + 1] += emberSpeed[i] * rawDt;
      emberPos[i * 3] += Math.sin(beatPhase * 0.5 + i) * 0.1 * rawDt;
      if (emberPos[i * 3 + 1] > 4.2) emberPos[i * 3 + 1] = 0;
    }
    emberGeo.attributes.position.needsUpdate = true;
  }
  embers.position.z = head.z;
  for (const t of trails) {
    t.mesh.visible = on && t.f.hist.length > 2;
    if (!t.mesh.visible) continue;
    const h = t.f.hist;
    for (let i = 0; i < TRAIL; i++) {
      const e = h[Math.max(0, h.length - 1 - Math.round((i / (TRAIL - 1)) * (h.length - 1)))];
      trailDummy.position.copy(e[1]);
      trailDummy.scale.setScalar(1 - i / TRAIL);
      trailDummy.updateMatrix();
      t.mesh.setMatrixAt(i, trailDummy.matrix);
    }
    t.mesh.instanceMatrix.needsUpdate = true;
    t.mat.opacity = 0.75 * zoneAmt;
  }
  railMat.emissive.copy(railBase).lerp(railZone, zoneAmt);
  streakFlash = Math.max(0, streakFlash - rawDt * 1.5);
  railMat.emissiveIntensity = 1 + 2.5 * streakFlash;
}

// ------------------------------------------------------------------ hit feel: flash, shatter along your punch

/** Shards fly off along the punch direction; more and faster for harder punches. */
// All shards share one instanced mesh (one draw call, nothing created per hit): a fixed pool that
// recycles the oldest shard when full. Shards shrink away instead of fading.
const SHARD_MAX = 192;
const shardMesh = new THREE.InstancedMesh(shardGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), SHARD_MAX);
shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
shardMesh.frustumCulled = false;
shardMesh.count = 0;
// Create the per-shard colour buffer now, before the first render compiles the shader without it.
for (let i = 0; i < SHARD_MAX; i++) shardMesh.setColorAt(i, new THREE.Color(0xffffff));
scene.add(shardMesh);
const shardPool = Array.from({ length: SHARD_MAX }, () => ({
  pos: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), size: 0, age: 0, life: 0, alive: false,
}));
let shardNext = 0;
const shardDummy = new THREE.Object3D(), shardColor = new THREE.Color();
function shatter(pos, dir, color, power) {
  const n = 6 + Math.round(10 * power);
  shardColor.set(color);
  for (let i = 0; i < n; i++) {
    const p = shardPool[shardNext];
    const idx = shardNext;
    shardNext = (shardNext + 1) % SHARD_MAX;
    p.alive = true; p.age = 0; p.life = 0.45 + 0.25 * power;
    p.size = 0.02 + Math.random() * 0.025;
    p.pos.set(pos.x + (Math.random() - 0.5) * 0.08, pos.y + (Math.random() - 0.5) * 0.08, pos.z + (Math.random() - 0.5) * 0.08);
    p.v.copy(dir).multiplyScalar(1.2 + 3.2 * power * (0.6 + Math.random() * 0.6));
    p.v.x += (Math.random() - 0.5) * 1.6; p.v.y += Math.random() * 1.2; p.v.z += (Math.random() - 0.5) * 1.6;
    p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
    shardMesh.setColorAt(idx, shardColor);
  }
  if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
}
function updateShards(dt) {
  let live = 0;
  for (let i = 0; i < SHARD_MAX; i++) {
    const p = shardPool[i];
    if (p.alive) {
      p.age += dt;
      if (p.age >= p.life) p.alive = false;
    }
    if (p.alive) {
      p.v.y -= 6 * dt;
      p.pos.addScaledVector(p.v, dt);
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      shardDummy.position.copy(p.pos);
      shardDummy.rotation.copy(p.rot);
      shardDummy.scale.setScalar(p.size * (1 - p.age / p.life));
      live++;
    } else {
      shardDummy.scale.setScalar(0);   // hidden
    }
    shardDummy.updateMatrix();
    shardMesh.setMatrixAt(i, shardDummy.matrix);
  }
  shardMesh.count = live ? SHARD_MAX : 0;
  shardMesh.instanceMatrix.needsUpdate = true;
  shards.length = live; // kept as a live count for the test hooks
}

// ------------------------------------------------------------------ speed bag (a burst: hit it as fast as you can)

const bagGeo = new THREE.CapsuleGeometry(0.11, 0.16, 6, 16);
const BAG_ARRIVE = 1.0;
function spawnBag(head, standing) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xff3d5a, emissive: 0xff3d5a, emissiveIntensity: 0.35, roughness: 0.5 });
  const body = new THREE.Mesh(bagGeo, mat);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.45, 6), MAT.guide);
  cord.position.y = 0.42;
  // Floating counter above the bag: hits and a time bar.
  const lc = document.createElement('canvas'); lc.width = 256; lc.height = 128;
  const tex = new THREE.CanvasTexture(lc); tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  label.position.set(0, 0.55, -1.4);   // counter floats further back so it never blocks your view
  label.scale.setScalar(2.2);
  group.add(body, cord, label);
  const station = new THREE.Vector3(centerX, standing - 0.42, head.z - 0.5);
  group.position.set(station.x, station.y, head.z - 10);
  scene.add(group);
  bag = {
    group, body, mat, label, lc, tex, station, startZ: head.z - 10, age: 0, duration: 4 + 1 * (1 - difficulty.intensity),
    hits: 0, armed: { left: true, right: true }, off: new THREE.Vector3(), offV: new THREE.Vector3(), labelKey: '', smokeT: 0,
  };
  say('SPEED BAG! Hit it fast!');
  audio.sfx('burst');
  pulseBoth(0.4, 60);
}
function drawBagLabel() {
  const left = Math.max(0, bag.duration - Math.max(0, bag.age - BAG_ARRIVE));
  const key = `${bag.hits}|${Math.ceil(left * 4)}`;
  if (key === bag.labelKey) return;
  bag.labelKey = key;
  const g = bag.lc.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(8,10,18,0.7)'; g.beginPath(); g.roundRect(4, 4, 248, 120, 22); g.fill();
  g.fillStyle = '#ffffff'; g.font = '700 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(bag.hits), 128, 56);
  g.fillStyle = '#262a38'; g.fillRect(28, 98, 200, 12);
  g.fillStyle = '#ff5a6e'; g.fillRect(28, 98, 200 * (left / bag.duration), 12);
  bag.tex.needsUpdate = true;
}
function bagHit(hand, fist) {
  bag.hits++;
  const push = fist && fist.vel.lengthSq() > 0.01 ? fist.vel.clone().setY(0).normalize() : new THREE.Vector3(0, 0, -1);
  bag.offV.addScaledVector(push, 1.4);
  bag.mat.emissiveIntensity = 1.2;
  pulse(fist, 0.55, 25);
  audio.sfx('bag', { hand });
  attribution.record('bag', gameTime);
}
const bagCenter = new THREE.Vector3();
function updateBag(dt, xr) {
  bag.age += dt;
  const arriving = bag.age < BAG_ARRIVE;
  const k = Math.min(1, bag.age / BAG_ARRIVE);
  bag.group.position.z = bag.startZ + (bag.station.z - bag.startZ) * (1 - (1 - k) ** 3);
  // Springy wobble after each hit.
  bag.offV.addScaledVector(bag.off, -320 * dt).multiplyScalar(Math.exp(-9 * dt));
  bag.off.addScaledVector(bag.offV, dt);
  bag.body.position.copy(bag.off);
  bag.body.rotation.set(bag.off.z * 2.5, 0, -bag.off.x * 2.5);
  bag.mat.emissiveIntensity += (0.35 - bag.mat.emissiveIntensity) * Math.min(1, dt * 8);
  bag.label.lookAt(camera.getWorldPosition(new THREE.Vector3()));
  if (!arriving) {
    bag.body.getWorldPosition(bagCenter);
    if (xr) {
      for (const f of fists) {
        const dx = f.world.x - bagCenter.x, dz = f.world.z - bagCenter.z;
        const dy = Math.max(0, Math.abs(f.world.y - bagCenter.y) - 0.08);
        const dist = Math.hypot(dx, dy, dz);
        const reach = 0.11 + FIST_R + 0.04;
        if (bag.armed[f.hand] && dist < reach && (settings.gameType === 'touch' || f.speed > 1.0)) {
          bag.armed[f.hand] = false;
          bagHit(f.hand, f);
        } else if (dist > reach + 0.06) bag.armed[f.hand] = true;
      }
    }
    if (SMOKE) { bag.smokeT += dt; while (bag.smokeT > 0.16) { bag.smokeT -= 0.16; bagHit(bag.hits % 2 ? 'left' : 'right', null); } }
  }
  drawBagLabel();
  if (bag.age >= BAG_ARRIVE + bag.duration) endBag();
}
function endBag() {
  const pts = bagPoints(bag.hits) * (score.inZone() ? 2 : 1);
  score.score += pts;
  if (bag.hits >= 8) { score.hits++; score.combo++; score.best = Math.max(score.best, score.combo); }
  say(`Speed bag: ${bag.hits} hits  +${pts}`);
  audio.sfx(bag.hits >= 15 ? 'perfect' : 'hit', { hand: 'right', power: 1 });
  bag.body.getWorldPosition(bagCenter);
  shatter(bagCenter, new THREE.Vector3(0, 0.3, -1), 0xff5a6e, 1);
  scene.remove(bag.group);
  bag.mat.dispose(); bag.tex.dispose();
  bag = null;
  bagReadyAt = gameTime + 20;
}

// ------------------------------------------------------------------ battle ropes (a burst: pump both arms, stay low)

const ROPE_BEADS = 56;
const ropeBeadGeo = new THREE.SphereGeometry(0.032, 10, 8);
const ROPES_ARRIVE = 1.2;
const ROPE_DELAY = 0.7;    // seconds for a wave to run from your hand to the anchor
function spawnRopes(head, standing) {
  const sides = ['left', 'right'].map((hand) => {
    const sx = hand === 'left' ? -1 : 1;
    const mat = new THREE.MeshStandardMaterial({ color: HAND_COLOR[hand], emissive: HAND_COLOR[hand], emissiveIntensity: 0.4, roughness: 0.5 });
    const mesh = new THREE.InstancedMesh(ropeBeadGeo, mat, ROPE_BEADS);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return {
      hand, mesh, mat, hist: [], pump: 0, lastY: null,
      handle: new THREE.Vector3(centerX + sx * 0.22, standing - 0.72, head.z - 0.42),
      anchor: new THREE.Vector3(centerX + sx * 0.45, 0.75, head.z - 6.5),
    };
  });
  ropes = { sides, age: 0, duration: 6, onTime: 0, credited: 0, points: 0, lowTime: 0, tip: '', dummy: new THREE.Object3D() };
  say('BATTLE ROPES! Pump both arms, stay low!');
  audio.sfx('burst');
  pulseBoth(0.4, 60);
}
function ropeHandPos(side, xr, t) {
  if (xr) return fistByHand[side.hand].world;
  const phase = side.hand === 'left' ? 0 : Math.PI;
  const y = SMOKE ? 0.16 * Math.sin(2 * Math.PI * 2.4 * t + phase) : pointer.y * 0.35;
  return side.handle.clone().setY(side.handle.y + y);
}
function updateRopes(dt, xr, head) {
  ropes.age += dt;
  const t = ropes.age;
  const active = t >= ROPES_ARRIVE && t < ROPES_ARRIVE + ropes.duration;
  const reveal = Math.min(1, t / ROPES_ARRIVE);             // ropes snake in from the anchors
  let bothOn = true;
  for (const s of ropes.sides) {
    const hp = ropeHandPos(s, xr, t);
    s.hist.push([t, hp.y]);
    while (s.hist.length && t - s.hist[0][0] > ROPE_DELAY + 0.3) s.hist.shift();
    if (s.lastY != null && dt > 0) s.pump += (Math.min(4, Math.abs(hp.y - s.lastY) / dt) - s.pump) * (1 - Math.exp(-dt / 0.25));
    s.lastY = hp.y;
    if (s.pump < ROPE_PUMP_SPEED) bothOn = false;
    const restY = s.hist.reduce((a, [, y]) => a + y, 0) / s.hist.length;
    const yAt = (ago) => { // hand height `ago` seconds back
      for (let i = s.hist.length - 1; i >= 0; i--) if (t - s.hist[i][0] >= ago) return s.hist[i][1];
      return s.hist[0][1];
    };
    for (let i = 0; i < ROPE_BEADS; i++) {
      const u = i / (ROPE_BEADS - 1);                        // 0 = your hand, 1 = anchor
      const shown = u >= 1 - reveal;
      const base = new THREE.Vector3().lerpVectors(hp.clone().setY(restY), s.anchor, u);
      base.y -= 0.18 * Math.sin(Math.PI * u);                // a little sag
      base.y += (yAt(u * ROPE_DELAY) - restY) * (1 - u) ** 0.6 * 1.3;
      ropes.dummy.position.copy(base);
      ropes.dummy.scale.setScalar(shown ? 1 : 0.001);
      ropes.dummy.updateMatrix();
      s.mesh.setMatrixAt(i, ropes.dummy.matrix);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
    s.mat.emissiveIntensity = active && s.pump >= ROPE_PUMP_SPEED ? 1.0 : 0.4;
  }
  if (active) {
    const low = head.y < standing - 0.12 || SMOKE;
    if (bothOn) {
      ropes.onTime += dt;
      if (low) ropes.lowTime += dt;
      ropes.points += dt * 10 * (low ? 1.5 : 1);
      if (xr && Math.random() < 0.25) pulseBoth(0.2, 15);
    }
    while (ropes.onTime - ropes.credited >= 1) { ropes.credited++; attribution.record('ropes', gameTime); }
    const left = Math.ceil(ROPES_ARRIVE + ropes.duration - t);
    const tip = !bothOn ? (ropes.sides.every((s) => s.pump < ROPE_PUMP_SPEED) ? 'Pump both arms!' : 'Both arms - faster!')
      : !low ? 'Great! Now get low!' : `Keep going! ${left}`;
    if (tip !== ropes.tip) { ropes.tip = tip; say(tip); }
  }
  if (t >= ROPES_ARRIVE + ropes.duration) endRopes(true);
}
function endRopes(award) {
  if (award) {
    const pts = Math.round(ropes.points) * (score.inZone() ? 2 : 1);
    score.score += pts;
    const pct = Math.round((ropes.onTime / ropes.duration) * 100);
    if (pct >= 50) { score.hits++; score.combo++; score.best = Math.max(score.best, score.combo); }
    say(`Battle ropes ${pct}%  +${pts}`);
    audio.sfx(pct >= 70 ? 'perfect' : 'hit', { hand: 'left', power: 0.8 });
  }
  for (const s of ropes.sides) { scene.remove(s.mesh); s.mesh.dispose(); s.mat.dispose(); }
  ropes = null;
  ropesReadyAt = gameTime + 30;
  if (award) trySpawn('slam'); // finish with a two-fisted slam
}

/**
 * Tracing rope: a long glowing rope that curves left/right and up/down as it flows toward you
 * along the lane. Where it crosses your "hand plane" (arm's reach) there's a ring: keep the
 * matching hand on the rope there while it passes. Points = how much of it you stayed on.
 * Two-hand rope: two ropes side by side (one per hand) that sweep wide and dip low.
 */
const traces = [];
const beadGeo = new THREE.SphereGeometry(0.06, 16, 12);
// The catch zone, drawn where the rope meets you: a ring (how far off the rope you can be) and a
// faint sleeve along the lane (how far in front of or behind the ring your hand can be).
const ringGeo = new THREE.RingGeometry(TRACE_RADIUS - 0.03, TRACE_RADIUS, 40);
const discGeo = new THREE.CircleGeometry(TRACE_RADIUS - 0.03, 40);
// The sleeve is drawn mostly beyond the ring (35 cm back, 15 cm forward) so it never crowds your face;
// the catch itself reaches TRACE_DEPTH either way.
const sleeveGeo = new THREE.CylinderGeometry(TRACE_RADIUS, TRACE_RADIUS, TRACE_DEPTH + 0.15, 40, 1, true)
  .rotateX(Math.PI / 2).translate(0, 0, (0.15 - TRACE_DEPTH) / 2);
const ROPE_SAMPLES = 160;
function makeStrand(group, pts, hand) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const samples = curve.getSpacedPoints(ROPE_SAMPLES).sort((a, b) => b.z - a.z); // sorted by z for depth lookups
  const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 220, 0.028, 10, false),
    new THREE.MeshStandardMaterial({ color: HAND_COLOR[hand], emissive: HAND_COLOR[hand], emissiveIntensity: 0.6, roughness: 0.4 }));
  const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 220, 0.06, 10, false),
    new THREE.MeshBasicMaterial({ color: HAND_COLOR[hand], transparent: true, opacity: 0.18, depthWrite: false }));
  const bead = new THREE.Mesh(beadGeo, MAT[hand]);                   // the rope's leading end
  bead.position.copy(pts[0]);
  group.add(core, glow, bead);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
  const marker = new THREE.Group();
  const face = new THREE.Group();                                    // ring + disc turn to face you
  face.add(new THREE.Mesh(ringGeo, ringMat), new THREE.Mesh(discGeo, fillMat));
  marker.add(new THREE.Mesh(sleeveGeo, fillMat), face);
  marker.visible = false;
  scene.add(marker);
  return { hand, samples, core, glow, marker, face, ringMat, fillMat, contact: new THREE.Vector3(), on: false, onTime: 0 };
}
function spawnTrace(head, standing, two = false) {
  const speed = Math.max(2.2, difficulty.orbSpeed * 0.85);
  const length = speed * (two ? sweepSeconds : traceSeconds)(difficulty.intensity); // metres
  const ctrl = two ? sweepPath(standing, Math.random, 6) : tracePath(standing, Math.random, 7);
  // Control points run from the rope's front end (local z = 0) back to its tail (local z = -length).
  const ptsAt = (dx) => ctrl.map(([x, y], i) => new THREE.Vector3(centerX + x + dx, y, -length * (i / (ctrl.length - 1))));
  const group = new THREE.Group();
  group.position.z = head.z - 14;                                    // front end starts 14 m away
  const strands = two
    ? [makeStrand(group, ptsAt(-SWEEP_HALF_GAP), 'left'), makeStrand(group, ptsAt(SWEEP_HALF_GAP), 'right')]
    : [makeStrand(group, ptsAt(0), ctrl.reduce((sum, [x]) => sum + x, 0) < 0 ? 'left' : 'right')];
  scene.add(group);
  traces.push({ group, strands, two, length, speed, planeZ: head.z - 0.5, started: false, totalTime: 0, teach: teach(two ? 'sweep' : 'trace') });
  // Two-hand rope: a slam bar follows SLAM_GAP s after the tail (booked in its lane slot).
  if (two) spawnSlam(head, standing, { dist: 14 + length + SLAM_GAP * speed, speed });
}
/** Rope position at a given local depth z (0 = front end, -length = tail). */
function ropeAt(strand, localZ, out) {
  const s = strand.samples;
  let i = 0;
  while (i < s.length - 2 && s[i + 1].z > localZ) i++;
  const a = s[i], b = s[i + 1];
  const k = a.z === b.z ? 0 : (localZ - a.z) / (b.z - a.z);
  return out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 0);
}
function endTrace(t, i) {
  // Two ropes: your score is the average of both hands.
  const frac = t.totalTime > 0 ? t.strands.reduce((sum, r) => sum + r.onTime, 0) / t.strands.length / t.totalTime : 0;
  const pts = Math.round(tracePoints(frac) * (t.two ? 1.5 : 1)) * (score.inZone() ? 2 : 1);
  score.score += pts;
  if (frac >= 0.6) { score.hits++; score.combo++; score.best = Math.max(score.best, score.combo); } else score.combo = 0;
  say(`${t.two ? 'Two ropes' : 'Rope'} ${Math.round(frac * 100)}%  +${pts}`);
  audio.sfx(frac >= 0.8 ? 'perfect' : frac >= 0.5 ? 'hit' : 'miss', { hand: t.strands[0].hand });
  attribution.record(t.two ? 'sweep' : 'trace', gameTime);
  scene.remove(t.group);
  for (const r of t.strands) {
    scene.remove(r.marker);
    r.core.geometry.dispose(); r.glow.geometry.dispose(); r.ringMat.dispose(); r.fillMat.dispose();
  }
  traces.splice(i, 1);
}
/** Where the player's hand is for tracing: the matching fist in VR, the mouse on desktop. */
const tracePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const traceTmp = new THREE.Vector3(), camTmp = new THREE.Vector3();
function traceHandPos(t, strand, xr) {
  if (xr) return fistByHand[strand.hand].world;
  if (SMOKE) return strand.contact;
  tracePlane.constant = -t.planeZ;
  raycaster.setFromCamera(pointer, camera);
  const p = raycaster.ray.intersectPlane(tracePlane, new THREE.Vector3());
  if (!p) return fistByHand[strand.hand].world;
  if (t.two) p.x += strand.hand === 'left' ? -SWEEP_HALF_GAP : SWEEP_HALF_GAP; // desktop: the mouse steers the middle
  return p;
}
function updateTraces(dt, xr) {
  camera.getWorldPosition(camTmp);
  for (let i = traces.length - 1; i >= 0; i--) {
    const t = traces[i];
    t.group.position.z += t.speed * dt;
    const localZ = t.planeZ - t.group.position.z;   // which part of the rope is at your hand plane
    if (localZ > 0) continue;                        // front end hasn't reached you yet
    if (!t.started) { t.started = true; say(t.two ? 'Both hands on the ropes!' : 'Ride the rope!'); }
    if (localZ < -t.length) { endTrace(t, i); continue; } // tail has passed
    t.totalTime += dt;
    for (const r of t.strands) {
      ropeAt(r, localZ, r.contact);
      r.contact.z = t.planeZ;
      // Judge against the rope at the depth your hand is at (anywhere in the sleeve), sideways and
      // up/down only, so reaching a bit short or long doesn't matter.
      const hand = traceHandPos(t, r, xr);
      const dz = hand.z - t.planeZ;
      const handLocalZ = Math.min(0, Math.max(-t.length, localZ + Math.max(-TRACE_DEPTH, Math.min(TRACE_DEPTH, dz))));
      ropeAt(r, handLocalZ, traceTmp);
      r.on = onRope(r.on, Math.hypot(hand.x - traceTmp.x, hand.y - traceTmp.y), dz);
      if (r.on) r.onTime += dt;
      r.marker.visible = true;
      r.marker.position.copy(r.contact);
      r.face.lookAt(camTmp);
      const col = r.on ? 0x4dff73 : 0xffffff;
      r.ringMat.color.set(col);
      r.fillMat.color.set(col);
      r.fillMat.opacity = r.on ? 0.16 : 0.07;
      r.glow.material.opacity = r.on ? 0.32 : 0.18;
      if (r.on && xr && Math.random() < 0.3) pulse(fistByHand[r.hand], 0.15, 15);
    }
  }
}

// ------------------------------------------------------------------ finishing slam (after ropes)

/**
 * A wide gold bar at head height with arrows pointing down: raise both fists and smash it DOWN
 * together (a medicine-ball slam). Comes right after battle ropes and two-hand ropes.
 */
const slams = [];
const slamBarGeo = new THREE.BoxGeometry(SLAM_BOX.x * 1.8, 0.12, 0.14);
const slamEdgeGeo = new THREE.EdgesGeometry(slamBarGeo);
const slamArrowGeo = new THREE.ConeGeometry(0.07, 0.16, 4).rotateX(Math.PI); // points down
const slamMat = new THREE.MeshStandardMaterial({ color: 0xffc04d, emissive: 0xff9a1f, emissiveIntensity: 0.8, roughness: 0.35 });
const slamEdgeMat = new THREE.LineBasicMaterial({ color: 0xb46bff });
function spawnSlam(head, standing, { dist = SPAWN_DISTANCE, speed = difficulty.orbSpeed } = {}) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(slamBarGeo, slamMat), new THREE.LineSegments(slamEdgeGeo, slamEdgeMat));
  const arrows = [-0.3, 0, 0.3].map((x) => { const a = new THREE.Mesh(slamArrowGeo, slamMat); a.position.set(x, 0.3, 0); group.add(a); return a; });
  group.position.set(centerX, standing - 0.02, head.z - dist);
  scene.add(group);
  slams.push({ group, arrows, speed, t: { left: null, right: null }, passZ: head.z + 0.4, announced: false, age: 0, teach: teach('slam') });
}
function endSlam(s, i, hit) {
  if (hit) {
    const pts = 60 * (score.inZone() ? 2 : 1);
    score.score += pts; score.hits++; score.combo++; score.best = Math.max(score.best, score.combo);
    say(`SLAM!  +${pts}`);
    audio.sfx('power', { power: 1 });
    pulseBoth(1, 160);
    for (const dx of [-0.35, 0.35]) shatter(s.group.position.clone().add(new THREE.Vector3(dx, 0, 0)), new THREE.Vector3(dx, -1, -0.3).normalize(), 0xffc04d, 1);
  } else {
    score.combo = 0;
    say('Missed the slam - both fists down together');
    audio.sfx('miss');
  }
  scene.remove(s.group);
  slams.splice(i, 1);
}
const slamTmp = new THREE.Vector3();
function updateSlams(dt, xr, head) {
  for (let i = slams.length - 1; i >= 0; i--) {
    const s = slams[i];
    s.age += dt;
    s.group.position.z += s.speed * dt;
    const bob = Math.sin(s.age * 9);
    s.arrows.forEach((a) => { a.position.y = 0.3 + 0.05 * bob; });
    if (!s.announced && s.group.position.z > head.z - 6) { s.announced = true; say('SLAM IT - both fists, down!'); }
    const bar = s.group.position;
    if (SMOKE && bar.z > head.z - 0.5) { endSlam(s, i, true); continue; }
    if (xr || !SMOKE) {
      for (const f of fists) {
        f.mesh.getWorldPosition(slamTmp);
        if (fistSlams({ x: slamTmp.x, y: slamTmp.y, z: slamTmp.z, vy: f.vel.y }, bar, settings.gameType === 'touch')) s.t[f.hand] = gameTime;
      }
      if (slamTogether(s.t.left, s.t.right)) { endSlam(s, i, true); continue; }
    }
    if (bar.z > s.passZ) endSlam(s, i, false);
  }
}
/** Desktop: a click while the bar is within reach counts as the slam. */
function desktopSlam(head) {
  const s = slams.find((x) => x.group.position.z > head.z - 1.4 && x.group.position.z < head.z + 0.2);
  if (!s) return false;
  endSlam(s, slams.indexOf(s), true);
  return true;
}

// ------------------------------------------------------------------ first-time hints (ghost fists)

/**
 * The first couple of times you ever meet a guard shot, a rope, a two-hand rope or a slam bar,
 * see-through "ghost" fists show you the move: fists up by your chin, a hand riding the ring,
 * both fists smashing down. What you've seen is remembered in the browser.
 */
const SEEN_KEY = 'pulsezone.seen';
const TEACH_TIMES = 2;
let seen = (() => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; } })();
/** Should this new guard/rope/slam come with a hint? (counts it as seen) */
function teach(kind) {
  if ((seen[kind] || 0) >= TEACH_TIMES) return false;
  seen[kind] = (seen[kind] || 0) + 1;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* ignore */ }
  return true;
}
const ghostMat = (hand) => new THREE.MeshBasicMaterial({ color: HAND_COLOR[hand], transparent: true, opacity: 0.45, depthWrite: false });
const ghostFists = { left: new THREE.Mesh(ghostGeo, ghostMat('left')), right: new THREE.Mesh(ghostGeo, ghostMat('right')) };
for (const g of Object.values(ghostFists)) { g.scale.set(1.4, 1.2, 1.75); g.visible = false; scene.add(g); } // fist-sized, see-through
const teachTmp = new THREE.Vector3();
function updateTeach(head) {
  ghostFists.left.visible = ghostFists.right.visible = false;
  const show = (hand, x, y, z) => { const g = ghostFists[hand]; g.visible = true; g.position.set(x, y, z); };
  // Guard: fists up by your chin while the shot comes in.
  const g = guards.find((x) => x.teach && x.group.position.z > head.z - 7);
  if (g) {
    camera.getWorldPosition(teachTmp);
    const bob = 0.02 * Math.sin(gameTime * 8);
    // A little lower and further than real guard fists, so they show the pose without hiding the shot.
    show('left', teachTmp.x - 0.15, teachTmp.y - 0.22 + bob, teachTmp.z - 0.45);
    show('right', teachTmp.x + 0.15, teachTmp.y - 0.22 + bob, teachTmp.z - 0.45);
    if (!g.taught) { g.taught = true; say('Guard: both fists up to your chin!'); }
    return;
  }
  // Ropes: a ghost hand rides each ring.
  const t = traces.find((x) => x.teach && x.started);
  if (t) {
    for (const r of t.strands) show(r.hand, r.contact.x, r.contact.y, r.contact.z);
    if (!t.taught) { t.taught = true; say(t.two ? 'One hand on each rope - follow the rings!' : 'Keep your hand inside the ring as the rope slides by'); }
    return;
  }
  // Slam: both fists come down on the bar, over and over.
  const s = slams.find((x) => x.teach && x.group.position.z > head.z - 5);
  if (s) {
    const p = s.group.position, k = (gameTime * 1.6) % 1;
    for (const [hand, dx] of [['left', -0.15], ['right', 0.15]]) show(hand, p.x + dx, p.y + 0.6 - 0.55 * k, p.z + 0.1); // between the arrows
  }
}

// ------------------------------------------------------------------ boxing combos on the beat

const combos = new Map(); // id -> { name, n, hit, failed }
let comboSeq = 0, queuedCombo = null;
/** Send a combo (one orb per beat, first one landing on a beat). False if the lane isn't free. */
function spawnCombo(head, standing, tpl) {
  const speed = difficulty.orbSpeed;
  const tempo = audio.tempo || 120;
  const gap = comboGap(tempo), beat = 60 / tempo;
  let first = gameTime + (SPAWN_DISTANCE - 0.5) / speed;
  const phaseAt = beatPhase + (first - gameTime) / beat;
  const snap = ((1 - (phaseAt % 1)) % 1) * beat;  // wait for the next beat
  first += snap;
  const plan = comboPlan(first, tpl.steps.length, gap);
  if (!laneFree(lane, plan)) return false;
  lane.push(plan);
  const id = ++comboSeq;
  combos.set(id, { name: tpl.name, n: tpl.steps.length, hit: 0, failed: false });
  const chest = standing - 0.35;
  tpl.steps.forEach(([hand, kind], i) => {
    const side = hand === 'left' ? -1 : 1;
    const x = side * (kind === 'hook' ? 0.28 : 0.17);
    const y = kind === 'low' ? Math.max(0.55, standing - 0.85) : kind === 'upper' ? chest - 0.08 : chest + (i % 2 ? 0.05 : -0.02);
    const swing = kind === 'hook' ? (hand === 'left' ? 'right' : 'left') : kind === 'upper' ? 'up' : null;
    const activity = kind === 'low' ? 'low' : swing ? 'swing' : 'jab';
    spawnOrb(head, standing, activity, { x, y, hand, swing, behind: (snap + gap * i) * speed, combo: id });
  });
  say(`COMBO  ${tpl.name.toUpperCase()}`);
  return true;
}
/** A combo orb was hit or missed: pay the bonus when the whole combo is cleared. */
function comboResult(orb, hit) {
  const c = combos.get(orb.combo);
  if (!c) return;
  if (!hit) { c.failed = true; combos.delete(orb.combo); return; }
  c.hit++;
  if (c.hit < c.n || c.failed) return;
  combos.delete(orb.combo);
  const pts = 15 * c.n * (score.inZone() ? 2 : 1);
  score.score += pts;
  say(`${c.name.toUpperCase()} COMBO!  +${pts}`);
  audio.sfx('streak', { level: c.n });
}

function removeOrb(orb) {
  scene.remove(orb.group);
  const i = orbs.indexOf(orb);
  if (i >= 0) orbs.splice(i, 1);
}

/**
 * A fist touched an orb. `fist` is null for desktop clicks / smoke test, in which case
 * `hand` says which hand was used and swing direction isn't judged.
 * Swing orbs are forgiving: any good punch counts; following the curve doubles the points.
 */
function tryHit(orb, fist, hand = fist?.hand, speed = fist ? fist.speed : 3) {
  const t = now();
  if (orb.dying || t < orb.immuneUntil) return false;
  orb.immuneUntil = t + 0.25;
  const flashWeak = () => { orb.mesh.material = MAT.weak; orb.flashUntil = t + 0.15; };
  const punchMode = settings.gameType === 'punch';
  // How far the fist travelled just before contact: a real punch, not a wrist flick.
  const travel = fist ? fistDisplacement(fist, 0.15).length() : 0.4;

  if (hand !== orb.hand) {
    score.wrongHand(orb.hand);
    audio.sfx('wrong');
    pulse(fist, 0.2, 30);
    // A double buzz on the hand you should have used, so you feel which one without looking.
    const right = fistByHand[orb.hand];
    pulse(right, 0.7, 45); setTimeout(() => pulse(right, 0.7, 45), 130);
    flashWeak();
    return false;
  }
  const needSpeed = orb.power ? powerPunchSpeed(orb.minPunch) : orb.minPunch * (orb.swing ? 0.7 : 1);
  const needTravel = minPunchTravel(difficulty.intensity, orb.power) * (orb.swing ? 0.8 : 1);
  if (punchMode && (speed < needSpeed || travel < needTravel)) {
    score.weakHit(orb.power ? 'Power orb - full punch from the shoulder!' : speed < needSpeed ? 'Punch harder!' : 'Punch through it - not a flick!');
    audio.sfx('weak');
    pulse(fist, 0.2, 20);
    flashWeak();
    return false;
  }
  let power = fist ? punchPower(speed, travel) : 0.6;
  if (!punchMode) power = Math.max(0.35, power * 0.7);
  let bonus = 1, label = '';
  if (orb.counter) { bonus = 2; label = 'COUNTER! '; }
  if (orb.power) {
    bonus = 1.5 + 1.5 * power;
    label = `POWER ${Math.round(power * 100)}%  `;
    power = Math.max(power, 0.75);
  }
  if (orb.swing && fist) {
    const d = fistDisplacement(fist);
    if (swingMatches(orb.swing, [d.x, d.y, d.z], 0.25)) {
      bonus = 2;
      label = orb.swing === 'up' ? 'Perfect uppercut! ' : 'Perfect hook! ';
      score.perfect++;
    } else {
      label = 'Follow the curve for x2  ';
    }
  }
  if (bonus > 1 && !orb.power) power = Math.max(power, 0.7);
  pulse(fist, 0.35 + 0.65 * power, 30 + 60 * power);
  score.hit(bonus, label);
  audio.sfx(orb.power ? 'power' : bonus > 1 ? 'perfect' : 'hit', { hand, power });
  attribution.record(orb.activity, gameTime);
  if (orb.combo) comboResult(orb, true);
  // Hit feel: the orb freezes and flashes white for a split second, then shatters along your punch.
  orb.dying = 0.035;
  orb.mesh.material = MAT.flash;
  orb.mesh.scale.setScalar(orb.r * 1.2);
  if (orb.shell) orb.shell.visible = false;
  if (orb.guide) orb.guide.group.visible = false;
  orb.hitPower = power;
  orb.hitDir = fist && fist.vel.lengthSq() > 0.09 ? fist.vel.clone().normalize() : new THREE.Vector3(0, 0, -1);
  orb.hitColor = bonus > 1 ? 0xffffff : HAND_COLOR[orb.hand];
  return true;
}
/** End of the hit flash: burst ring + shards, then the orb is gone. */
function popOrb(orb) {
  const b = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color: orb.hitColor, transparent: true }));
  b.position.copy(orb.group.position);
  b.scale.setScalar(orb.r * 0.8);
  scene.add(b);
  bursts.push({ mesh: b, age: 0, r: orb.r * 0.8 });
  shatter(orb.group.position, orb.hitDir, orb.hitColor, orb.hitPower);
  removeOrb(orb);
}

// ------------------------------------------------------------------ HUD (canvas texture in the world)

const hudCanvas = document.createElement('canvas');
hudCanvas.width = 1024; hudCanvas.height = 640;
const hctx = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true }));
scene.add(hud);
let hudKey = '';

// ------------------------------------------------------------------ end-of-workout summary board

/**
 * When the workout ends, a board below the scoreboard shows your heart rate over the whole
 * workout against your target band, time in zone, and your personal bests (saved in the browser).
 */
const BESTS_KEY = 'pulsezone.bests';
const loadBests = () => { try { return JSON.parse(localStorage.getItem(BESTS_KEY) || 'null'); } catch { return null; } };
let bests = loadBests();
const sumCanvas = document.createElement('canvas');
sumCanvas.width = 1024; sumCanvas.height = 640;
const sumTex = new THREE.CanvasTexture(sumCanvas);
sumTex.colorSpace = THREE.SRGBColorSpace;
const summaryBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.125), new THREE.MeshBasicMaterial({ map: sumTex, transparent: true }));
summaryBoard.visible = false;
scene.add(summaryBoard);
let lastSummary = null;

function finishWorkout() {
  const w = summarizeWorkout(sessionLog);
  Object.assign(w, { score: score.score, streak: Math.floor(longestStreak), reactor: reactor.level, combo: score.best });
  const { bests: b, records } = updateBests(bests, w);
  bests = b;
  try { localStorage.setItem(BESTS_KEY, JSON.stringify(bests)); } catch { /* ignore */ }
  lastSummary = { w, records };
  clearObstacles(); // nothing left hanging in front of the board
  drawSummary(w, records);
  summaryBoard.visible = true;
}

function drawSummary(w, records) {
  const g = sumCanvas.getContext('2d'), W = sumCanvas.width, H = sumCanvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,10,18,0.82)';
  g.beginPath(); g.roundRect(8, 8, W - 16, H - 16, 28); g.fill();
  g.textBaseline = 'middle';
  g.fillStyle = '#e6e9ef'; g.font = '700 38px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText('Your heart rate this workout', 48, 50);

  // Graph: heart rate (coloured by zone) over time, the target band, warm-up / cool-down shaded.
  const rows = sessionLog.filter((r) => Number(r.bpm) > 0);
  const half = controller.s.zoneHalfWidth;
  const x0 = 90, x1 = W - 40, y0 = 90, y1 = 320;
  if (rows.length > 1) {
    const tMin = rows[0].t, tMax = rows[rows.length - 1].t || 1;
    const lo = Math.min(...rows.map((r) => Math.min(Number(r.bpm), r.target - half))) - 5;
    const hi = Math.max(...rows.map((r) => Math.max(Number(r.bpm), r.target + half))) + 5;
    const X = (t) => x0 + ((t - tMin) / Math.max(1, tMax - tMin)) * (x1 - x0);
    const Y = (b) => y1 - ((b - lo) / Math.max(1, hi - lo)) * (y1 - y0);
    for (const r of rows) if (r.phase !== 'Training') { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(X(r.t), y0, Math.max(2, (x1 - x0) / rows.length), y1 - y0); }
    g.fillStyle = 'rgba(77,255,115,0.16)';
    const tgt = rows.find((r) => r.phase === 'Training')?.target ?? rows[0].target;
    g.fillRect(x0, Y(tgt + half), x1 - x0, Y(tgt - half) - Y(tgt + half));
    g.strokeStyle = 'rgba(77,255,115,0.5)'; g.lineWidth = 2; g.setLineDash([8, 8]);
    g.beginPath(); g.moveTo(x0, Y(tgt)); g.lineTo(x1, Y(tgt)); g.stroke(); g.setLineDash([]);
    g.lineWidth = 5; g.lineJoin = 'round';
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      g.strokeStyle = ZONE_COLOR[b.status] || '#999999';
      g.beginPath(); g.moveTo(X(a.t), Y(Number(a.bpm))); g.lineTo(X(b.t), Y(Number(b.bpm))); g.stroke();
    }
    g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText(String(tgt + half), x0 - 10, Y(tgt + half)); g.fillText(String(tgt - half), x0 - 10, Y(tgt - half));
    g.textAlign = 'left'; g.fillText('0:00', x0, y1 + 22);
    g.textAlign = 'right'; g.fillText(mmss(tMax - tMin), x1, y1 + 22);
  } else {
    g.fillStyle = '#8d95a5'; g.font = '28px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('No heart-rate readings this time', W / 2, (y0 + y1) / 2);
  }

  // Stats, with gold "NEW BEST" tags.
  const isNew = (k) => records.includes(k);
  const stat = (label, value, x, y, rec) => {
    g.textAlign = 'left'; g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif'; g.fillText(label, x, y);
    g.fillStyle = rec ? '#ffc04d' : '#ffffff'; g.font = '700 40px system-ui, sans-serif'; g.fillText(value, x, y + 40);
    if (rec) { g.font = '700 20px system-ui, sans-serif'; g.fillText('NEW BEST', x, y + 76); }
  };
  stat('Time in zone', `${mmss(w.inZoneSeconds)}  (${w.pct}%)`, 48, 380, isNew('pct'));
  stat('Avg / peak', `${w.avgBpm || '--'} / ${w.peakBpm || '--'}`, 400, 380, false);
  stat('Longest streak', mmss(w.streak), 640, 380, isNew('streak'));
  stat('Score', String(w.score), 48, 490, isNew('score'));
  stat('Reactor', `level ${w.reactor}`, 400, 490, isNew('reactor'));
  const top = attribution.ranking()[0];
  stat('Raises YOUR heart most', top.label, 640, 490, false);
  g.textAlign = 'center'; g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif';
  const short = w.trainingSeconds < MIN_RECORD_SECONDS ? '  ·  workouts under 3 min don\'t set records' : '';
  g.fillText(bests ? `Bests: ${bests.pct}% in zone · ${mmss(bests.streak)} streak · ${bests.score} points · ${bests.workouts} workout${bests.workouts === 1 ? '' : 's'}${short}` : '', W / 2, 600);
  sumTex.needsUpdate = true;
}

/** A line for the scoreboard during warm-up: what to beat today. */
function bestsLine() {
  if (!bests || !bests.pct) return '';
  return `To beat: ${bests.pct}% in zone · ${mmss(bests.streak)} streak · ${bests.score} points`;
}

const thermo = new HeartThermometer();
thermo.mesh.scale.setScalar(1.3);
scene.add(thermo.mesh);

const ZONE_COLOR = {
  InZone: '#4dff73', Below: '#59b3ff', Above: '#ff9933', SafetyBrake: '#ff3333', NoSignal: '#999999',
};
/** Is your heart rate on its way into the zone (or back down to it)? Shown after it holds 2 s. */
function updateTrend(rawDt, src) {
  const p = attribution.projected();   // effort-based estimate, steadied over ~4 s (single reps make it jumpy)
  projSmooth = p == null ? null : projSmooth == null ? p : projSmooth + (p - projSmooth) * (1 - Math.exp(-rawDt / 4));
  const t = controller.phase === Phase.Training || controller.phase === Phase.WarmUp ? heartTrend({
    status: controller.status, bpm: src.hasReading ? src.currentBpm : 0, projected: projSmooth,
    target: controller.currentSetpoint, half: controller.s.zoneHalfWidth,
  }) : null;
  if (t !== trend) { trend = t; trendFor = 0; } else trendFor += rawDt;
  if (trend && trendFor >= 2) trendShown = trend;
  else if (!trend && trendFor >= 3) trendShown = null; // linger a little so it doesn't flicker
}

/** Zone streaks: every 15 s you hold the zone, a chime (higher each time), bonus points and charge. */
function updateStreak(gdt) {
  if (controller.phase !== Phase.Training || controller.status !== Zone.InZone) { zoneStreak = 0; return; }
  const before = zoneStreak;
  zoneStreak += gdt;
  longestStreak = Math.max(longestStreak, zoneStreak);
  const m = streakMilestone(before, zoneStreak);
  if (!m) return;
  const bonus = 20 * Math.min(m, 8);
  score.score += bonus;
  reactor.charge = Math.min(0.999, reactor.charge + 0.04);
  say(`ZONE STREAK ${mmss(m * ZONE_STREAK_STEP)}!  +${bonus}`);
  audio.sfx('streak', { level: m });
  streakFlash = 1;
  pulseBoth(0.3, 60);
}

function statusLabel(c) {
  if (c.phase === Phase.Finished) return 'NICE WORK';
  if (c.phase === Phase.CoolDown && c.status !== Zone.SafetyBrake) return 'COOLING DOWN';
  // Heart rate lags effort by 30-40 s: say so when you're already doing the right thing.
  if (trendShown === 'climbing' && c.status === Zone.Below) return 'CLIMBING - KEEP IT UP';
  if (trendShown === 'easing' && c.status === Zone.Above) return 'SETTLING - NICE';
  return { InZone: 'IN THE ZONE', Below: 'PICK IT UP', Above: 'EASE OFF', SafetyBrake: 'SAFETY BRAKE - SLOW DOWN', NoSignal: 'NO HEART-RATE SIGNAL' }[c.status];
}
const PHASE_LABEL = { WarmUp: 'WARM-UP', Training: 'TRAINING', CoolDown: 'COOL-DOWN', Finished: 'DONE' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function drawHud(xr) {
  const c = controller, src = source();
  const fresh = now() - lastEventAt < 0.9;
  const bpmText = src.hasReading && c.status !== Zone.NoSignal ? String(src.currentBpm) : '--';
  const remaining = Math.max(0, c.phaseDuration - c.phaseElapsedSeconds);
  const statusLine = sourceKind === 'phone' ? remote.statusText : '';
  const boostPct = Math.round(boost.value * 100);
  const key = [bpmText, c.status, c.phase, Math.floor(remaining), Math.round(c.intensity * 100), score.score, score.combo,
    fresh ? lastEvent : '', statusLine, sourceKind, phoneFallback, workloadMode, link.code, xr, Math.round(c.currentSetpoint), c.s.targetBpm,
    Math.round(boostPct / 5), options.open, trendShown, Math.floor(zoneStreak)].join('|');
  if (key === hudKey) return;
  hudKey = key;

  const g = hctx, W = hudCanvas.width;
  g.clearRect(0, 0, W, hudCanvas.height);
  g.fillStyle = 'rgba(8,10,18,0.55)';
  g.beginPath(); g.roundRect(8, 8, W - 16, hudCanvas.height - 16, 28); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const zc = c.phase === Phase.Finished ? '#dfe3ea' : ZONE_COLOR[c.status];

  g.fillStyle = zc; g.font = '700 150px system-ui, sans-serif';
  g.fillText(bpmText, W / 2 - 50, 110);
  if (trendShown && c.phase !== Phase.Finished) { // arrow: where your heart rate is heading
    g.fillStyle = trendShown === 'climbing' ? '#4dff73' : '#7fd8ff'; g.font = '700 70px system-ui, sans-serif';
    g.fillText(trendShown === 'climbing' ? '\u25B2' : '\u25BC', W / 2 - 50 - bpmText.length * 46 - 50, 105);
  }
  g.fillStyle = '#dfe3ea'; g.font = '600 44px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText('BPM', W / 2 + (bpmText.length * 42), 128);
  g.textAlign = 'center';

  const target = c.phase === Phase.WarmUp
    ? `target ${Math.round(c.currentSetpoint)} -> ${c.s.targetBpm}`
    : `target ${c.s.targetBpm} +/-${c.s.zoneHalfWidth}`;
  g.fillStyle = zc; g.font = '600 40px system-ui, sans-serif';
  g.fillText(c.phase === Phase.Finished ? statusLabel(c) : `${statusLabel(c)}  ·  ${target}`, W / 2, 230);

  g.fillStyle = '#c9ced8'; g.font = '30px system-ui, sans-serif';
  const srcName = sourceKind === 'sim' ? `SIM HR (${workloadMode})` : phoneFallback ? 'ESTIMATED HR (phone asleep)' : 'PHONE HR';
  const boostText = boostPct >= 5 ? `  ·  CHALLENGE +${boostPct}%` : '';
  g.fillText(c.phase === Phase.Finished ? 'WORKOUT COMPLETE'
    : options.open ? 'PAUSED - options open'
      : `${PHASE_LABEL[c.phase]} ${mmss(remaining)}  ·  intensity ${Math.round(c.intensity * 100)}%${boostText}  ·  ${srcName}`, W / 2, 290);

  const bx = 212, by = 325, bw = 600, bh = 22;
  g.fillStyle = '#262a38'; g.beginPath(); g.roundRect(bx, by, bw, bh, 11); g.fill();
  g.fillStyle = `hsl(${190 - 175 * c.intensity} 85% 58%)`;
  g.beginPath(); g.roundRect(bx, by, Math.max(bh, bw * c.intensity), bh, 11); g.fill();
  if (boostPct >= 5) { // challenge boost shown as a glowing extension past the bar
    g.fillStyle = 'rgba(255,90,60,0.85)';
    g.beginPath(); g.roundRect(bx + bw + 8, by, 60 * boost.value, bh, 11); g.fill();
  }

  g.fillStyle = '#ffffff'; g.font = '600 40px system-ui, sans-serif';
  if (c.phase === Phase.Finished) {
    const pctZone = Math.round((c.secondsInZone / Math.max(1, c.s.trainingSeconds)) * 100);
    const top = attribution.ranking()[0];
    g.font = '600 32px system-ui, sans-serif';
    g.fillText(`Score ${score.score}  ·  ${score.hits} hits (${score.perfect} perfect)  ·  ${score.dodges} dodges  ·  reactor level ${reactor.level}`, W / 2, 392);
    g.fillText(`Time in zone ${pctZone}%  ·  avg ${avgN ? Math.round(avgSum / avgN) : '--'} BPM  ·  best for you: ${top.label}`, W / 2, 436);
    g.fillText(xr ? 'Press A to go again' : 'Press R to go again', W / 2, 480);
  } else if (fresh) {
    g.fillText(lastEvent, W / 2, 400);
  } else if (c.phase === Phase.WarmUp && bestsLine()) {
    g.fillStyle = '#ffc04d'; g.font = '600 32px system-ui, sans-serif';
    g.fillText(bestsLine(), W / 2, 400);
  }

  if (statusLine) {
    const ok = !phoneFallback && src.hasReading && src.secondsSinceLastReading < 5;
    g.fillStyle = ok ? '#b8bfcc' : '#ffd34d'; g.font = '26px system-ui, sans-serif';
    wrapText(g, statusLine, W / 2, 520, 900, 30);
  }
  g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif';
  g.fillText(xr ? `${settings.gameType === 'touch' ? 'TOUCH MODE' : 'blue = left · orange = right'} · white curve = swing path · Y = options · code ${link.code}`
    : `blue = left click · orange = right click · O = options · phone code ${link.code}`, W / 2, 595);

  g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = '600 30px system-ui, sans-serif';
  g.fillText(`SCORE ${score.score}`, 760, 60);
  g.font = '26px system-ui, sans-serif'; g.fillStyle = '#c9ced8';
  g.fillText(`combo ${score.combo} (best ${score.best})`, 760, 100);
  g.fillText(`in zone ${mmss(c.secondsInZone)}`, 760, 136);
  if (zoneStreak >= ZONE_STREAK_STEP && c.phase !== Phase.Finished) {
    g.fillStyle = '#ffc04d'; g.fillText(`streak ${mmss(zoneStreak)}`, 760, 172);
  }

  hudTex.needsUpdate = true;
}

function wrapText(g, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '', lines = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  lines.push(line);
  lines = lines.slice(0, 2);
  lines.forEach((l, i) => g.fillText(l, x, y + i * lineHeight));
}

// ------------------------------------------------------------------ options panel (left side, in VR too)

const options = new OptionsPanel({
  getState: () => ({
    target: settings.targetBpm, minutes: settings.trainingMinutes, warmUp: settings.warmUpSeconds, source: sourceKind, sound: settings.sound,
    volume: Math.round(settings.volume * 10), challenge: settings.challenge,
    gameType: settings.gameType, moves: { ...settings.moves },
    musicStyle: settings.musicStyle, songAvailable,
    ranking: attribution.ranking().map((r) => ({ ...r, bpmPer10: Math.round(r.bpmPer10) })),
  }),
  act: (id) => {
    audio.sfx('hit', { hand: 'right' });
    switch (id) {
      case 'target-': nudgeTarget(-5); break;
      case 'target+': nudgeTarget(5); break;
      case 'warmup-': setWarmUp(stepWarmUp(settings.warmUpSeconds, -1)); break;
      case 'warmup+': setWarmUp(stepWarmUp(settings.warmUpSeconds, 1)); break;
      case 'minutes-': settings.trainingMinutes = Math.max(1, settings.trainingMinutes - (settings.trainingMinutes > 5 ? 5 : 1)); controller.s.trainingSeconds = settings.trainingMinutes * 60; saveSettings(); break;
      case 'minutes+': settings.trainingMinutes = Math.min(60, settings.trainingMinutes + (settings.trainingMinutes >= 5 ? 5 : 1)); controller.s.trainingSeconds = settings.trainingMinutes * 60; saveSettings(); break;
      case 'src-phone': setSource('phone'); break;
      case 'src-sim': setSource('sim'); break;
      case 'sound': setSound(!settings.sound); break;
      case 'vol-': settings.volume = Math.max(0.1, settings.volume - 0.1); audio.setVolume(settings.volume); saveSettings(); break;
      case 'vol+': settings.volume = Math.min(1, settings.volume + 0.1); audio.setVolume(settings.volume); saveSettings(); break;
      case 'ch-gentle': case 'ch-normal': case 'ch-hard': {
        settings.challenge = id.slice(3);
        const ch = CHALLENGE[settings.challenge];
        controller.s.kp = tuning.controller.kp * ch.kp;
        controller.s.ki = tuning.controller.ki * ch.ki;
        boost.riseSeconds = tuning.boostRiseSeconds * ch.rise;
        saveSettings();
        break;
      }
      case 'mode-punch': case 'mode-touch': setGameType(id.slice(5)); break;
      case 'music-song': case 'music-synth':
        settings.musicStyle = id.slice(6);
        audio.setMusicMode(songAvailable && settings.musicStyle === 'song' ? 'song' : 'synth');
        saveSettings();
        break;
      default:
        if (id.startsWith('move-')) toggleMove(id.slice(5));
        break;
      case 'restart': startWorkout(); options.toggle(false); break;
      case 'end': controller.beginCoolDown(); options.toggle(false); break;
      case 'close': options.toggle(false); break;
    }
    $('target').value = settings.targetBpm; $('minutes').value = settings.trainingMinutes;
    syncMovesUI();
    updatePanel(true);
  },
});

// ------------------------------------------------------------------ moveset (page checklist + VR board)

function setGameType(type) {
  settings.gameType = type;
  saveSettings();
  say(type === 'touch' ? 'Touch mode: just hold your hand there' : 'Punch mode');
  syncMovesUI();
}
function toggleMove(key, on = !settings.moves[key]) {
  settings.moves[key] = on;
  saveSettings();
  syncMovesUI();
}
function buildMovesUI() {
  const box = $('moves');
  const group = (title, keys) => `<div class="mv-title">${title}</div><div class="mv-grid">${keys.map((k) =>
    `<label><input type="checkbox" data-move="${k}"> ${MOVE_LABELS[k]}</label>`).join('')}</div>`;
  box.innerHTML = `
    <div class="mv-title">Game type</div>
    <div class="mv-grid">
      <label><input type="radio" name="gtype" value="punch"> Punch (hit hard)</label>
      <label><input type="radio" name="gtype" value="touch"> Touch (just hold your hand there)</label>
    </div>
    ${group('Orbs', ['jab', 'low', 'swing', 'power', 'pair', 'guard', 'trace', 'sweep'])}
    ${group('Bursts (when you\'re stuck below your zone)', ['bag', 'ropes'])}
    ${group('Walls & footwork', ['duck', 'squatSide', 'lean', 'pillar', 'shift'])}
    <div class="muted" id="movesNote" style="font-size:12px"></div>`;
  box.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'gtype') setGameType(t.value);
    else if (t.dataset.move) toggleMove(t.dataset.move, t.checked);
  });
  syncMovesUI();
}
function syncMovesUI() {
  const box = $('moves');
  if (!box || !box.firstChild) return;
  box.querySelectorAll('input[data-move]').forEach((el) => { el.checked = !!settings.moves[el.dataset.move]; });
  box.querySelectorAll('input[name=gtype]').forEach((el) => { el.checked = el.value === settings.gameType; });
  const notes = [];
  if (settings.gameType === 'touch' && (settings.moves.swing || settings.moves.power)) notes.push('Hooks, uppercuts and power orbs are skipped in Touch mode (they need a real punch).');
  if (!Object.values(enabledActivities()).some(Boolean)) notes.push('Everything is off, so you\'ll get plain punches.');
  $('movesNote').textContent = notes.join(' ');
}
scene.add(options.mesh, options.tab);

// Laser pointers (controller target rays) for clicking the options panel in VR.
const lasers = [0, 1].map((i) => {
  const ctrl = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.85 }),
  );
  line.scale.z = 3;
  line.visible = false;
  ctrl.add(line);
  rig.add(ctrl);
  ctrl.addEventListener('selectstart', () => {
    if (!options.open) return;
    const hit = laserHit(ctrl);
    if (hit) options.clickUv(hit.uv);
  });
  return { ctrl, line };
});
const laserRay = new THREE.Raycaster();
const tmpMat = new THREE.Matrix4();
function laserHit(ctrl) {
  tmpMat.identity().extractRotation(ctrl.matrixWorld);
  laserRay.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
  laserRay.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
  return laserRay.intersectObject(options.mesh, false)[0] || null;
}

// ------------------------------------------------------------------ session log (download from the developer panel)

const sessionLog = [];
let logTimer = 0;
const SESSION_KEY = 'pulsezone.lastSession';
function logRow() {
  const s = source();
  sessionLog.push({
    t: Math.round(gameTime), phase: controller.phase, bpm: s.hasReading ? s.currentBpm : '', source: sourceKind + (phoneFallback ? '-estimated' : ''),
    status: controller.status, target: controller.s.targetBpm, intensity: controller.intensity.toFixed(3), boost: boost.value.toFixed(2),
    ...Object.fromEntries(ACTIVITIES.map((a) => [`reps_${a.key}`, attribution.counts[a.key]])),
    hits: score.hits, misses: score.misses, dodges: score.dodges, wallHits: score.wallHits,
  });
}
function saveSession() {
  if (!sessionLog.length) return;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessionLog)); } catch { /* storage full: skip */ }
  saveGains();
}
function downloadLog() {
  let rows = sessionLog;
  if (!rows.length) { try { rows = JSON.parse(localStorage.getItem(SESSION_KEY) || '[]'); } catch { rows = []; } }
  if (!rows.length) { alertPanel('No workout logged yet.'); return; }
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `pulsezone-workout-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function alertPanel(text) { $('srcStatus').textContent = text; }

// ------------------------------------------------------------------ DOM panel

const $ = (id) => document.getElementById(id);
const panel = { code: $('code'), link: $('bridgeLink'), srcName: $('srcName'), srcStatus: $('srcStatus') };
$('target').value = settings.targetBpm; $('age').value = settings.age; $('minutes').value = settings.trainingMinutes;
$('warmup').value = settings.warmUpSeconds;
$('sound').checked = settings.sound;
$('sound').addEventListener('change', (e) => setSound(e.target.checked));
$('apply').addEventListener('click', () => {
  settings.targetBpm = Number($('target').value) || 120;
  settings.age = Number($('age').value) || 30;
  settings.trainingMinutes = Math.max(1, Number($('minutes').value) || 15);
  settings.warmUpSeconds = Math.min(300, Math.max(0, Math.round(Number($('warmup').value) || 0)));
  saveSettings();
  startWorkout();
  $('apply').blur();
});
$('srcBtn').addEventListener('click', (e) => { toggleSource(); e.target.blur(); });
$('hide').addEventListener('click', () => { $('panel').style.display = 'none'; $('show').style.display = 'block'; });
$('show').addEventListener('click', () => { $('panel').style.display = ''; $('show').style.display = 'none'; });
let devPanel = null;
function openDev() {
  if (devPanel) { devPanel.style.display = ''; return; }
  devPanel = createDevPanel({
    tuning,
    onApply: (t) => { tuning = t; startWorkout(); },
    onDownloadLog: downloadLog,
    onResetLearning: () => { try { localStorage.removeItem(GAINS_KEY); } catch { /* ignore */ } attribution = new HeartRateAttribution(); },
    getRanking: () => attribution.ranking(),
  });
}
$('devBtn').addEventListener('click', (e) => { openDev(); e.target.blur(); });
buildMovesUI();
if (params.has('dev')) openDev();

let panelTimer = 0;
function updatePanel(force) {
  if (!force && (panelTimer -= 1) > 0) return;
  panelTimer = 15;
  panel.code.textContent = link.state === 'starting' ? '······' : link.code;
  const url = new URL('bridge.html', location.href);
  url.search = `?code=${link.code}`;
  panel.link.href = url.toString();
  panel.link.textContent = url.toString();
  panel.srcName.textContent = sourceKind === 'sim' ? `Simulator (${workloadMode})` : phoneFallback ? 'Estimated (phone asleep)' : 'Phone (Charge 6)';
  updateRemoteStatus();
  panel.srcStatus.textContent = sourceKind === 'sim' ? `Phone: ${remote.statusText}` : remote.statusText;
}

// ------------------------------------------------------------------ desktop input

const keys = new Set();
let fastForward = false;
const pointer = new THREE.Vector2(0.15, -0.2);
let punchTimer = 0, punchHand = 'right';
const punchPoint = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  switch (e.code) {
    case 'BracketRight': nudgeTarget(5); break;
    case 'BracketLeft': nudgeTarget(-5); break;
    case 'Tab': e.preventDefault(); workloadMode = { Motion: 'AutoPlayer', AutoPlayer: 'Manual', Manual: 'Motion' }[workloadMode]; updatePanel(true); break;
    case 'KeyL': signalLostToggle = !signalLostToggle; break;
    case 'KeyT': fastForward = !fastForward; break;
    case 'KeyE': controller.beginCoolDown(); break;
    case 'KeyR': startWorkout(); break;
    case 'KeyB': toggleSource(); break;
    case 'KeyO': options.toggle(); break;
    case 'KeyM': setSound(!settings.sound); break;
    default: break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  if (options.open) {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(options.mesh, false)[0];
    if (hit) options.clickUv(hit.uv);
    return;
  }
  if (e.button === 0) desktopPunch('left');
  else if (e.button === 2) desktopPunch('right');
});

function desktopPunch(hand) {
  if (desktopSlam(head)) { punchTimer = 0.15; punchHand = hand; return; }
  raycaster.setFromCamera(pointer, camera);
  if (bag && bag.age >= BAG_ARRIVE && raycaster.intersectObject(bag.body, false).length) {
    punchTimer = 0.12; punchHand = hand;
    punchPoint.copy(bag.body.getWorldPosition(new THREE.Vector3()));
    bagHit(hand, null);
    return;
  }
  raycaster.far = 3.2;
  punchTimer = 0.15;
  punchHand = hand;
  punchPoint.copy(raycaster.ray.at(1.0, new THREE.Vector3()));
  const hits = raycaster.intersectObjects(orbs.map((o) => o.mesh), false);
  raycaster.far = Infinity;
  if (hits.length) {
    punchPoint.copy(hits[0].point);
    const orb = orbs.find((o) => o.mesh === hits[0].object);
    if (orb) tryHit(orb, null, hand, 3);
  }
}

let duckY = 0, leanX = 0;
function updateDesktop(dt, head) {
  let wantDuck = keys.has('KeyC') || keys.has('ControlLeft');
  let wantLean = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (SMOKE) {
    const w = walls.find((x) => !x.hit && x.mesh.position.z + x.depth > head.z - 2.5 && x.mesh.position.z < head.z + 0.3);
    if (w) {
      const opts = [[0, 0], [-0.35, 0], [0.35, 0], [0, 0.5], [-0.35, 0.5], [0.35, 0.5]];
      const ok = opts.find(([lx, dy]) => !wallHitsHead(w.poly, lx, 1.6 - dy));
      if (ok) { wantLean = ok[0] / 0.35; wantDuck = ok[1] > 0; }
    }
  }
  duckY += ((wantDuck ? 0.5 : 0) - duckY) * Math.min(1, dt * 12);
  leanX += (wantLean * 0.35 - leanX) * Math.min(1, dt * 12);
  camera.position.set(leanX, 1.6 - duckY, 0);
  if (keys.has('ArrowUp')) manualWorkload = Math.min(1, manualWorkload + dt * 0.3);
  if (keys.has('ArrowDown')) manualWorkload = Math.max(0, manualWorkload - dt * 0.3);

  punchTimer -= dt;
  const guarding = keys.has('KeyG');
  for (const f of fists) {
    const rest = guarding ? new THREE.Vector3(f.hand === 'left' ? -0.09 : 0.09, -0.12, -0.22)
      : new THREE.Vector3(f.hand === 'left' ? -0.24 : 0.24, -0.3, -0.38);
    const jabbing = punchTimer > 0 && f.hand === punchHand;
    const goal = jabbing ? camera.worldToLocal(punchPoint.clone()) : rest;
    f.mesh.position.lerp(goal, 1 - Math.exp(-dt * (jabbing ? 30 : 10)));
  }
}

// ------------------------------------------------------------------ XR buttons

const buttonWas = new Map();
function xrButtons() {
  const session = renderer.xr.getSession();
  if (!session) return { a: false, b: false };
  let a = false, b = false;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    for (const [idx, flag] of [[4, 'a'], [5, 'b']]) {
      const pressed = !!gp.buttons[idx]?.pressed;
      const k = src.handedness + idx;
      if (pressed && !buttonWas.get(k)) { if (flag === 'a') a = true; else b = true; }
      buttonWas.set(k, pressed);
    }
  }
  return { a, b };
}

// ------------------------------------------------------------------ sending things down the lane

/** Send `activity` if its arrival slot is free. Returns false to try again a moment later. */
const SLAM_DIST = 7; // after battle ropes the slam comes from 7 m, so it arrives in ~2 s
function trySpawn(activity, extra = {}) {
  if (activity === 'combo') return queuedCombo ? spawnCombo(head, standing, queuedCombo) : true;
  if (activity === 'bag' || activity === 'ropes') {
    pendingBurst = activity;
    say(activity === 'bag' ? 'Speed bag coming...' : 'Battle ropes coming...');
    return true;
  }
  const wallType = wallTypeFor(activity, Math.random, settings.moves);
  const kind = ACTIVITIES.find((a) => a.key === activity)?.kind;
  if (kind === 'wall' && !wallType) return true; // no wall shape allowed for this one: skip it
  const speed = difficulty.orbSpeed;
  const plan = lanePlan(activity, {
    now: gameTime, speed, intensity: difficulty.intensity,
    depth: wallType ? wallDepth(wallType, speed * 0.8) : 0, dist: SLAM_DIST,
  });
  if (!laneFree(lane, plan)) return false;
  if (plan) lane.push(plan);
  if (activity === 'slam') spawnSlam(head, standing, { dist: SLAM_DIST, speed });
  else if (wallType) spawnWall(head, standing, wallType, activity);
  else if (activity === 'trace' || activity === 'sweep') spawnTrace(head, standing, activity === 'sweep');
  else if (activity === 'pair') spawnPair(head, standing);
  else if (activity === 'guard') spawnGuard(head, standing);
  else spawnOrb(head, standing, activity, { shift: extra.shift || 0 });
  return true;
}

// ------------------------------------------------------------------ side shifts (footwork)

// A glowing pad on the floor where to stand, with an arrow from the centre.
const shiftPadMat = new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
const shiftPad = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.23, 32), shiftPadMat);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 3), shiftPadMat);
  ring.rotation.x = -Math.PI / 2;
  arrow.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); // flat on the floor, pointing +x
  arrow.position.x = -0.32;
  shiftPad.add(ring, arrow);
  shiftPad.visible = false;
  scene.add(shiftPad);
}
const PLAIN_ORBS = ['jab', 'low', 'swing'];

// Drift guard: if your head wanders more than 55 cm from where you should be (the lane centre,
// or the side-shift spot), an amber arrow on the floor points you back. Keeps you clear of wall
// boxes and of real-world furniture after a lot of side steps.
const DRIFT_OUT = 0.55, DRIFT_BACK = 0.3;
const driftMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const driftArrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 3), driftMat);
driftArrow.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); // flat on the floor, pointing +x
driftArrow.visible = false;
scene.add(driftArrow);
let drifting = false;
function updateDrift(head, xr, paused) {
  const active = xr && !paused && (controller.phase === Phase.Training || controller.phase === Phase.WarmUp);
  const home = centerX + shiftOffsetAt(shiftPlan, gameTime);
  const dx = head.x - home;
  if (!active) drifting = false;
  else if (!drifting && Math.abs(dx) > DRIFT_OUT) { drifting = true; say(dx > 0 ? '<<  Step back to the centre' : 'Step back to the centre  >>'); }
  else if (drifting && Math.abs(dx) < DRIFT_BACK) drifting = false;
  driftArrow.visible = drifting;
  if (drifting) {
    driftArrow.position.set(head.x - Math.sign(dx) * 0.25, 0.03, head.z - 2.2);
    driftArrow.scale.set(1, dx > 0 ? -1 : 1, 1); // flip so it points back toward home
    driftMat.opacity = 0.5 + 0.4 * Math.abs(Math.sin(gameTime * 6));
  }
}
/** Plan a shift when you're stuck below the zone, if no wall/rope/etc. would arrive during it. */
function maybePlanShift() {
  if (!settings.moves.shift || shiftPlan || bag || ropes || pendingBurst) return;
  if (trendShown === 'climbing') return; // already working hard enough: your heart just needs time
  if (!shiftWanted({ status: controller.status, phase: controller.phase, intensity: controller.intensity, boost: boost.value, now: gameTime, readyAt: shiftReadyAt })) return;
  const start = gameTime + (SPAWN_DISTANCE - 0.5) / difficulty.orbSpeed + 0.4;
  const slot = { kind: 'orb', start: start - SHIFT.margin, end: start + SHIFT.seconds + SHIFT.margin, shift: true };
  if (!laneFree(lane, slot)) return;  // something solo is on its way: try again later
  lane.push(slot);
  shiftPlan = { start, end: start + SHIFT.seconds, offset: (Math.random() < 0.5 ? -1 : 1) * SHIFT.offset };
  shiftReadyAt = shiftPlan.end + SHIFT.cooldown;
}
/** Pad, call-outs, and ending the shift. */
function updateShift(head, standing) {
  const p = shiftPlan;
  if (!p) { shiftPad.visible = false; return; }
  const showFrom = p.start - 2;
  shiftPad.visible = gameTime >= showFrom && gameTime <= p.end;
  if (shiftPad.visible) {
    // ~2 m ahead on the floor, low in view while you watch the orbs (right under your feet it is out of sight).
    shiftPad.position.set(centerX + p.offset, 0.02, head.z - 2.2);
    shiftPad.scale.set(p.offset > 0 ? 1.8 : -1.8, 1.8, 1.8); // arrow points the way to step
    shiftPadMat.opacity = 0.55 + 0.35 * Math.abs(Math.sin(gameTime * 5));
  }
  if (gameTime >= showFrom && shiftSaid !== 'go') { shiftSaid = 'go'; say(p.offset > 0 ? 'STEP RIGHT  >>' : '<<  STEP LEFT'); audio.sfx('burst'); }
  if (gameTime >= p.end && shiftSaid !== 'back') { shiftSaid = 'back'; say('Back to the centre'); }
  if (gameTime > p.end + SHIFT.margin) { shiftPlan = null; shiftSaid = ''; }
}


// ------------------------------------------------------------------ main loop

const head = new THREE.Vector3();
let standing = 1.6;
let lastTime = 0;
let finishedPlayed = false;

const skyTmp = new THREE.Color(), instTmp = new THREE.Vector3(), HIT_RED = new THREE.Color(0x5a0a0a); // reused every frame
function frame(time) {
  const rawDt = lastTime ? Math.max(0, Math.min(0.1, (time - lastTime) / 1000)) : 0;
  lastTime = Math.max(lastTime, time);
  const dt = rawDt * BASE_SPEED * (fastForward ? 5 : 1);
  const xr = renderer.xr.isPresenting;

  if (!xr) updateDesktop(rawDt, head);
  const btn = xrButtons();
  if (btn.b) options.toggle();                                   // B / Y = options
  if (btn.a && controller.phase === Phase.Finished && !options.open) startWorkout();
  const paused = options.open;
  const gdt = paused ? 0 : dt;                                   // game time stops while options are open

  camera.getWorldPosition(head);
  standing = head.y > standing ? head.y : standing - 0.01 * gdt;
  standing = Math.min(2.1, Math.max(1.0, standing));
  if (recenterSoon && (!xr || head.y > 0.8)) { centerX = xr ? head.x : 0; recenterSoon = false; }

  const tNow = now();
  for (const f of fists) {
    f.mesh.getWorldPosition(f.world);
    if (f.hasLast && rawDt > 0) {
      const inst = instTmp.copy(f.world).sub(f.last).divideScalar(rawDt);
      f.vel.lerp(inst, 1 - Math.exp(-rawDt / 0.04));
      f.speed = Math.max(inst.length(), f.speed - 8 * rawDt);
    }
    f.last.copy(f.world);
    f.hasLast = true;
    f.hist.push([tNow, f.world.clone()]);
    while (f.hist.length && tNow - f.hist[0][0] > 0.35) f.hist.shift();
  }
  updateMotion(rawDt, head);

  // Heart rate -> controller -> difficulty (+ challenge boost when you're stuck).
  sim.signalLost = signalLostToggle && sourceKind === 'sim';
  if (sourceKind === 'sim') {
    if (workloadMode === 'Motion') sim.workload = xr ? motion.workload : 0.15;
    else if (workloadMode === 'AutoPlayer') sim.workload = autoPlayer.tick(controller.intensity, dt);
    else sim.workload = manualWorkload;
  }
  updatePhoneFallback(xr, dt);
  sim.tick(dt);
  remote.tick(dt);
  updateRemoteStatus();
  controller.tick(source(), gdt);
  const src = source();
  if (!paused && controller.phase !== Phase.Finished) {
    gameTime += gdt;
    if (controller.phase !== Phase.CoolDown) boost.update(gdt, { status: controller.status, intensity: controller.intensity, bpmTrend: controller.bpmTrend, climbing: trendShown === 'climbing' });
    else boost.value = Math.max(0, boost.value - gdt / 10);
    attribution.update(gameTime, src.hasReading && controller.status !== Zone.NoSignal ? src.currentBpm : null);
    updateStreak(gdt);
    if (gameTime - gainsSavedAt > 30) { gainsSavedAt = gameTime; saveGains(); }
    logTimer += gdt;
    if (logTimer >= 1) { logTimer = 0; logRow(); }
  }
  difficulty = boostDifficulty(difficultyFor(controller.intensity), boost.value);
  updateTrend(rawDt, src);
  if (controller.phase === Phase.Training && src.hasReading && !paused) { avgSum += src.currentBpm; avgN++; }
  if (controller.status === Zone.InZone && lastStatus !== Zone.InZone && controller.phase !== Phase.Finished) audio.sfx('zone');
  lastStatus = controller.status;
  if (controller.phase === Phase.Finished && !finishedPlayed) { finishedPlayed = true; audio.sfx('finish'); saveSession(); finishWorkout(); }
  audio.update({
    intensity: controller.intensity, status: controller.status, bpm: src.hasReading ? src.currentBpm : 0,
    phase: controller.phase, paused, target: controller.s.targetBpm,
  });
  audio.schedule();   // also driven from here: timers can run slow while in VR
  if (audio.song?.silentFor > 5 && !songWarned) { songWarned = true; say('Song blocked: synth music instead. Pull a trigger to retry'); }
  if (audio.songLive) songWarned = false;

  // Spawning: the activity mix adapts to what raises YOUR heart rate.
  if (!paused && controller.phase !== Phase.Finished) {
    spawnTimer += gdt;
    lane = lane.filter((r) => r.end > gameTime);
    maybePlanShift();
    const shiftBusy = shiftPlan && gameTime < shiftPlan.end + SHIFT.margin;
    if (pendingBurst && !standNext && !shiftBusy) {
      // A burst waits until the lane is clear, then takes over for a few seconds.
      if (!orbs.length && !walls.length && !traces.length && !guards.length && !slams.length) {
        if (pendingBurst === 'bag') spawnBag(head, standing); else spawnRopes(head, standing);
        pendingBurst = null;
        spawnTimer = 0;
      }
    } else if (!bag && !ropes && spawnTimer >= difficulty.spawnInterval) {
      // Pick what's next (or keep waiting for the move already picked), then only send it once its
      // arrival slot is free, so nothing crowds a rope, a wall box, a pair or a guard shot.
      // During a side shift only plain orbs come (offset to the side); anything queued waits.
      const arrive = gameTime + (SPAWN_DISTANCE - 0.5) / difficulty.orbSpeed;
      const inShift = shiftPlan && arrive >= shiftPlan.start - SHIFT.margin && arrive <= shiftPlan.end + SHIFT.margin;
      const plain = PLAIN_ORBS.filter((k) => enabledActivities(true)[k]);
      const activity = inShift ? (plain[Math.floor(Math.random() * plain.length)] || 'jab') : standNext ? 'stand' : queuedActivity || chooseActivity({
        intensity: difficulty.intensity, status: controller.status, boost: boost.value, gains: attribution.w,
        baseWeights: tuning.weights, enabled: enabledActivities(true),
      });
      // A plain punch sometimes becomes a combo; like other solo moves it waits for a free lane slot.
      let pick = activity;
      if (!inShift && !standNext && !queuedActivity && activity === 'jab' && Math.random() < comboChance(difficulty.intensity)) {
        const en = enabledActivities(true);
        const list = availableCombos({ swing: en.swing, low: en.low });
        if (list.length) { queuedCombo = list[Math.floor(Math.random() * list.length)]; pick = 'combo'; }
      }
      if (inShift) {
        trySpawn(activity, { shift: shiftOffsetAt(shiftPlan, arrive) });
        spawnTimer = 0;
      } else if (trySpawn(pick)) {
        queuedActivity = null; queuedFor = 0;
        spawnTimer = 0;
      } else {
        queuedActivity = pick;
        queuedFor += gdt;
        if (queuedFor > 10) { queuedActivity = null; queuedFor = 0; } // give up and pick something else
      }
    }
  }

  if (!paused) {
    updateTraces(gdt, xr);
    updateGuards(gdt, xr, head);
    updateSlams(gdt, xr, head);
    updateShift(head, standing);
    updateTeach(head);
    updateDrift(head, xr, paused);
    if (bag) updateBag(gdt, xr);
    if (ropes) updateRopes(gdt, xr, head);
  }
  updateShards(rawDt);

  // Orbs.
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    if (o.dying) { // hit flash: frozen for a split second, then it shatters
      o.dying -= rawDt;
      if (o.dying <= 0) popOrb(o);
      continue;
    }
    o.group.position.z += o.speed * gdt;
    if (o.shell) { o.shell.rotation.y += gdt * 1.8; o.shell.rotation.x += gdt * 0.9; o.mesh.rotation.y -= gdt * 0.6; }
    if (o.guide) { // ghost fist keeps sliding along the swing path
      const u = (tNow * 1.3 + i * 0.37) % 1;
      o.guide.ghost.position.copy(o.guide.curve.getPoint(u));
      o.guide.ghost.material.opacity = 0.35 + 0.6 * Math.sin(Math.PI * u);
    }
    if (o.flashUntil && tNow > o.flashUntil) { o.flashUntil = 0; o.mesh.material = o.baseMat; }
    if (xr && !paused) {
      for (const f of fists) {
        const reach = o.r + FIST_R + (o.swing ? 0.05 : 0.02) + (settings.gameType === 'touch' ? 0.03 : 0);
        if (f.world.distanceTo(o.group.position) < reach) { tryHit(o, f); break; }
      }
    }
    if (SMOKE && orbs[i] === o && o.group.position.z > head.z - 1.2) tryHit(o, null, o.hand, 5);
    if (orbs[i] === o && !o.dying && o.group.position.z > o.passZ) {
      score.miss(); audio.sfx('miss');
      attribution.record(o.activity, gameTime);
      if (o.combo) comboResult(o, false);
      removeOrb(o);
    }
  }

  // Walls: duck, step aside, lean left/right, squat left/right.
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    w.mesh.position.z += w.speed * gdt;
    const far = w.mesh.position.z, near = far + w.depth;
    if (!w.announced && near > head.z - 6) { w.announced = true; say(w.label); }
    // You're inside the box while its near face has passed you and its far face hasn't.
    if (!w.hit && near >= head.z && far <= head.z && wallHitsHead(w.poly, head.x - centerX, head.y)) {
      w.hit = true;
      w.fill.material = MAT.wallHit;
      score.wallHit();
      say(w.type === 'rise' ? 'Stand up!' : w.type === 'duck' || w.type.startsWith('squat') ? 'Get lower!' : 'Move over!');
      audio.sfx('wall');
      pulseBoth(1, 120);
    }
    if (far > w.passZ) {
      if (!w.hit) { score.dodge(); audio.sfx('dodge'); }
      if (w.activity) attribution.record(w.activity, gameTime); // you moved either way (standing up is part of the squat)
      scene.remove(w.mesh);
      walls.splice(i, 1);
    }
  }

  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.age += rawDt;
    const k = b.age / 0.25;
    b.mesh.scale.setScalar(b.r * (1 + 0.8 * k));
    b.mesh.material.opacity = 1 - k;
    if (k >= 1) { scene.remove(b.mesh); b.mesh.material.dispose(); bursts.splice(i, 1); }
  }

  for (const s of stripes) {
    s.position.z += difficulty.orbSpeed * gdt;
    if (s.position.z > 1) s.position.z -= 28;
  }

  if (!paused) beatPhase += rawDt * (audio.tempo || 120) / 60;
  const inZoneNow = controller.status === Zone.InZone && controller.phase !== Phase.Finished;
  updateZoneWorld(rawDt, inZoneNow, paused, head);
  updateReactor(gdt, rawDt, controller.phase === Phase.Finished ? 'NoSignal' : controller.status, !paused && controller.phase !== Phase.Finished && controller.phase !== Phase.WarmUp);
  const zc = skyTmp.set(ZONE_COLOR[controller.phase === Phase.Finished ? 'NoSignal' : controller.status]).multiplyScalar(0.03 * (1 - 0.5 * zoneAmt)).add(skyBase).lerp(zoneSky, 0.5 * zoneAmt);
  scene.background.lerp(zc, 1 - Math.exp(-rawDt * 2));
  if (hitFlash > 0) { scene.background.lerp(HIT_RED, hitFlash * 0.6); hitFlash = Math.max(0, hitFlash - rawDt * 3); }
  scene.fog.color.copy(scene.background);

  // Layout: scoreboard ahead, heat gauge and options tab to its left, options board on the left.
  hud.position.set(centerX, standing + 0.35, head.z - 3.2);
  if (summaryBoard.visible) { summaryBoard.position.set(centerX, standing - 1.0, head.z - 2.5); summaryBoard.rotation.x = -0.35; }
  thermo.mesh.position.set(centerX - 1.65, standing + 0.3, head.z - 3.1);
  reactor.group.position.set(centerX + 1.65, standing + 0.45, head.z - 3.1);
  options.tab.position.set(centerX - 1.65, standing - 0.85, head.z - 3.05);
  if (xr) { // on your left, angled toward you
    options.mesh.position.set(centerX - 1.05, standing - 0.15, head.z - 1.55);
    options.mesh.rotation.set(0, 0.62, 0);
  } else {   // desktop: straight ahead so it fits the screen
    options.mesh.position.set(centerX, standing - 0.1, head.z - 1.45);
    options.mesh.rotation.set(0, 0, 0);
  }

  const hasSignal = src.hasReading && controller.status !== Zone.NoSignal;
  thermo.update(rawDt, {
    bpm: src.currentBpm, hasSignal, target: controller.s.targetBpm, halfWidth: controller.s.zoneHalfWidth,
    maxBpm: estimatedMaxBpm(settings.age) + 5,
    look: controller.phase === Phase.Finished ? { cold: 0, flame: 0.3, hyper: 0 } : heatLook(controller.status, src.currentBpm, controller.s.targetBpm),
  });

  // Options: laser pointers in VR, mouse hover on desktop.
  if (options.open) {
    let hoverUv = null;
    if (xr) {
      for (const l of lasers) {
        l.line.visible = true;
        const hit = laserHit(l.ctrl);
        l.line.scale.z = hit ? hit.distance : 3;
        if (hit) hoverUv = hit.uv;
      }
    } else {
      raycaster.setFromCamera(pointer, camera);
      hoverUv = raycaster.intersectObject(options.mesh, false)[0]?.uv || null;
    }
    options.setHoverUv(hoverUv);
    options.draw();
  } else {
    for (const l of lasers) l.line.visible = false;
  }

  drawHud(xr);
  updatePanel(false);
  renderer.render(scene, camera);
}

startWorkout();
link.start();
if (SMOKE) workloadMode = 'AutoPlayer';
else if (!navigator.xr) workloadMode = 'AutoPlayer';
navigator.xr?.isSessionSupported?.('immersive-vr').then((ok) => { if (!ok && workloadMode === 'Motion') workloadMode = 'AutoPlayer'; updatePanel(true); });
updatePanel(true);
renderer.setAnimationLoop(frame);
window.addEventListener('pagehide', () => saveSession());

// For automated tests / debugging in the console.
window.pz = {
  get state() {
    const c = controller, s = source();
    return {
      phase: c.phase, status: c.status, intensity: +c.intensity.toFixed(3), bpm: s.currentBpm, hasReading: s.hasReading,
      sourceKind, phoneFallback, workloadMode, code: link.code, link: link.state, remoteStatus: remote.statusText,
      score: score.score, hits: score.hits, perfect: score.perfect, misses: score.misses, wrong: score.wrong, weak: score.weak,
      dodges: score.dodges, wallHits: score.wallHits, boost: +boost.value.toFixed(2), spawnInterval: +difficulty.spawnInterval.toFixed(2),
      orbs: orbs.length, walls: walls.length, swingOrbs: orbs.filter((o) => o.swing).length, secondsInZone: Math.round(c.secondsInZone),
      reps: { ...attribution.counts }, ranking: attribution.ranking().map((r) => `${r.key} ${r.bpmPer10.toFixed(1)}`),
      optionsOpen: options.open, logRows: sessionLog.length, traces: traces.length, gameType: settings.gameType,
      powerOrbs: orbs.filter((o) => o.power).length, pairOrbs: orbs.filter((o) => o.activity === 'pair').length, shards: shards.length, draws: renderer.info.render.calls,
      bag: bag ? { hits: bag.hits, age: +bag.age.toFixed(1) } : null, ropes: ropes ? { on: +ropes.onTime.toFixed(1), pts: Math.round(ropes.points) } : null,
      pendingBurst, guards: guards.length, blocks: score.blocks, guardsMissed: score.guardsMissed, counters: orbs.filter((o) => o.counter).length,
      lane: lane.map((r) => `${r.kind} ${(r.start - gameTime).toFixed(1)}..${(r.end - gameTime).toFixed(1)}`), queued: queuedActivity,
      reactor: { charge: +reactor.charge.toFixed(2), level: reactor.level, state: reactor.state }, zoneAmt: +zoneAmt.toFixed(2), slams: slams.length, shift: shiftPlan, drifting, combosSent: comboSeq, comboOrbs: orbs.filter((o) => o.combo).length, seen, ghosts: ghostFists.left.visible || ghostFists.right.visible, trend: trendShown, zoneStreak: Math.floor(zoneStreak), longestStreak: Math.floor(longestStreak), summary: lastSummary, bests, projected: projSmooth == null ? null : Math.round(projSmooth),
      thermo: Object.fromEntries(Object.entries(thermo.uniforms).map(([k, v]) => [k, +v.value.toFixed(2)])),
      audio: audio.ctx ? audio.ctx.state : 'locked', tempo: Math.round(audio.tempo), musicMode: audio.musicMode, songAvailable,
    };
  },
  toggleSource, startWorkout, nudgeTarget, options, audio,
  async snapshot(name = 'snap') {
    frame(lastTime + 33);
    const data = renderer.domElement.toDataURL('image/png');
    return (await fetch(`/__snapshot?name=${name}`, { method: 'POST', body: data })).text();
  },
  step(seconds, fps = 30) {
    const ms = 1000 / fps;
    for (let i = 0; i < seconds * fps; i++) frame(lastTime + ms);
    return this.state;
  },
  phone(bpm) { remote.push(bpm); if (sourceKind === 'sim' && !userChoseSource) sourceKind = 'phone'; },
  /** Test helper: touch the nearest plain orb with the correct hand at a given hand speed. */
  testHit(speed, travel = 0.4, kind = 'plain') {
    const orb = orbs.find((o) => !o.swing && !o.dying && (kind === 'power' ? o.power : !o.power));
    if (!orb) return null;
    const world = orb.group.position.clone();
    const fake = {
      hand: orb.hand, speed, vel: new THREE.Vector3(0, 0, -speed), world, source: null,
      hist: [[now() - 0.2, world.clone().add(new THREE.Vector3(0, 0, travel))]],
    };
    return tryHit(orb, fake);
  },
  /** Test helper: force the next thing the game sends (e.g. 'bag', 'ropes', 'pair', 'power'). */
  force(activity) {
    clearObstacles();
    trySpawn(activity);
    return this.state;
  },
  /** Test helper: is anything about to reach the player at the same time as something else? */
  overlaps() {
    // Arrival windows of everything currently in the lane, from live positions and speeds.
    const items = [
      ...orbs.filter((o) => !o.dying).map((o) => ({ what: o.counter ? 'counter' : o.combo ? `combo${o.combo}` : o.activity, a: (head.z - 0.5 - o.group.position.z) / o.speed, b: (head.z - 0.5 - o.group.position.z) / o.speed })),
      ...walls.map((w) => ({ what: 'wall', a: (head.z - w.mesh.position.z - w.depth) / w.speed, b: (head.z - w.mesh.position.z) / w.speed })),
      ...slams.map((s) => ({ what: 'slam', a: (head.z - 0.8 - s.group.position.z) / s.speed, b: (head.z - 0.2 - s.group.position.z) / s.speed })),
      ...traces.map((t) => ({ what: 'rope', a: (t.planeZ - t.group.position.z) / t.speed, b: (t.planeZ - t.group.position.z + t.length) / t.speed })),
      ...guards.map((g) => ({ what: 'guard', a: (g.hitZ - g.group.position.z) / g.speed, b: (g.hitZ - g.group.position.z) / g.speed })),
    ];
    const plain = new Set(['jab', 'low', 'swing']);
    const out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const p = items[i], q = items[j];
      if (plain.has(p.what) && plain.has(q.what)) continue;
      if (p.what === 'pair' && q.what === 'pair') continue;
      if (p.what === q.what && p.what.startsWith('combo')) continue; // punches of the same combo
      if ((p.what === 'counter' && q.what === 'guard') || (q.what === 'counter' && p.what === 'guard')) continue;
      if (p.a < q.b + 0.25 && q.a < p.b + 0.25) out.push(`${p.what}~${q.what}`);
    }
    return out;
  },
  /** Test hook: run the drift guard as if your head were at x (VR only otherwise). */
  drift(x) { updateDrift({ x, z: head.z }, true, false); return drifting; },
  act: (id) => options.hooks.act(id),
  logRows: () => sessionLog,
};
