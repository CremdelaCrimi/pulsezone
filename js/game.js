// PulseZone VR: WebXR game for Meta Quest Browser (also playable on desktop with a mouse).
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import {
  SimulatedHeart, SimulatedPlayer, RemoteHeartSource, ZoneController, Phase, Zone,
  evaluateDifficulty, estimatedMaxBpm, EASY, HARD, WALL_TYPES, wallPolygon, wallHitsHead, kcalPerMinute,
  GUARD_ZONES, GUARD_SEQ_GAP, guardZonesFor, guardCovers,
  planOrb, swingMatches, heatLook, ACTIVITIES, chooseActivity, wallTypeFor, ChallengeBoost, boostDifficulty,
  HeartRateAttribution, PROFILES, profileOffset, wallDepth, barrageShape, barragePlan, bombHits, HEAVY_TARGETS, heavyPoints, sledTucked, tracePath, traceSeconds, tracePoints, sweepPath, sweepSeconds, SWEEP_HALF_GAP,
  TRACE_RADIUS, TRACE_DEPTH, onRope, LOW_WALLS, heartTrend, streakMilestone, ZONE_STREAK_STEP,
  summarizeWorkout, updateBests, MIN_RECORD_SECONDS, SLAM_BOX, SLAM_GAP, fistSlams, slamTogether,
  SHIFT, shiftWanted, shiftOffsetAt, breathAt, sensorLooksFlat, SPOTLIGHT, SPOTLIGHT_NAMES, spotlightDue, pickSpotlight, availableCombos, comboGap, comboChance, comboPlan,
  STATIONS, STATION_STOP, STATION_WINDOW, HAMMER_GAP, kneeGrab, kneePulled, pressLoaded, pressDone, chopSwing, TREE_CHOP, SLALOM, slalomCount, BOMB_VOLLEY, barrageVolleys, tiptoeReached, tiptoeHeight,
  stationHold, wallBallBeat, wallBallGoal, WALLBALL, ACTS, actPlan, actAt, actWeights, weekSummary, weekDots, PLAN_SHAPES, CHARGE, chargeWanted, predictPeak, coastOver, landingVerdict,
  minPunchTravel, powerPunchSpeed, punchPower, bagPoints, ROPE_PUMP_SPEED, ROPE_HARD, ROPE_MAX, ROPE_TIER_MULT, ropeTier,
  lanePlan, laneFree, SPAWN_DISTANCE, COUNTER_DISTANCE,
  hitTier, HEAVY_BONUS, posePoints, poseHeld, POSE_RING_R, POSE_HOLD,
} from './core.js?v58';
import { todayWorkout, actTitles, levelFor, levelUp, trailFor, trailUnlocked, BADGES, newBadges, ghostTrace, ghostDelta, ghostLabel, recoveryStory } from './progress.js?v58';
import { BOSS, newBoss, bossTick, bossHit, bossLanding, bossSummary } from './boss.js?v58';
import { BossView } from './bossview.js?v58';
import { WorldView } from './worlds.js?v58';
import { VoiceCoach } from './coach.js?v58';
import { HostLink } from './link.js?v9';
import { AudioEngine } from './audio.js?v58';
import { HeartThermometer } from './thermo.js?v7';
import { OptionsPanel } from './options.js?v58';
import { loadTuning, createDevPanel } from './dev.js?v58';

const params = new URLSearchParams(location.search);
const SMOKE = params.has('smoke');            // automated play-through for testing
const BASE_SPEED = Number(params.get('speed')) || 1;
const PHONE_TIMEOUT = 6;                       // seconds without phone readings before estimating (controller gives up at 8)

// Desktop VR emulator, for testing on a computer: ?emulate loads Meta's Immersive Web Emulation
// Runtime (IWER), a pretend Quest 3 with two controllers, in place of the browser's own WebXR. Tests
// then move the headset and controllers (pz.xr.position, pz.xr.controllers.left.position, ...) and the
// game runs its real VR code: fists, guard zones, sled reps, rope pumping. Never loads without ?emulate.
let xrDevice = null;
if (params.has('emulate')) {
  // A covered or hidden test window stops animation frames and slows timers to once a second (or
  // once a minute). &emutimer runs frames and timers off a MessageChannel clock instead, which hidden
  // windows don't throttle. It spins a CPU core while anything is waiting: test runs only.
  if (params.has('emutimer')) {
    // A hidden window is 0 x 0, which turns the emulated headset's camera into NaN: pretend it's 1280 x 720.
    for (const [k, fallback] of [['innerWidth', 1280], ['innerHeight', 720]]) {
      const real = Object.getOwnPropertyDescriptor(window, k)?.get?.bind(window) || (() => 0);
      try { Object.defineProperty(window, k, { configurable: true, get: () => real() || fallback }); } catch { /* keep the real size */ }
    }
    const timers = new Map(), mc = new MessageChannel(), clearT = window.clearTimeout;
    let nextId = 1e7, posted = false;
    const kick = () => { if (!posted && timers.size) { posted = true; mc.port2.postMessage(0); } };
    mc.port1.onmessage = () => {
      posted = false;
      const now = performance.now();
      for (const [id, t] of [...timers]) {
        if (now < t.at) continue;
        timers.delete(id);
        try { t.fn(...t.args); } catch (e) { console.error(e); }
      }
      kick();
    };
    window.setTimeout = (fn, ms = 0, ...args) => { const id = nextId++; timers.set(id, { fn, args, at: performance.now() + ms }); kick(); return id; };
    window.clearTimeout = (id) => { if (!timers.delete(id)) clearT(id); };
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
  const { XRDevice, metaQuest3 } = await import('https://cdn.jsdelivr.net/npm/iwer@2.8.0/build/iwer.module.min.js');
  xrDevice = new XRDevice(metaQuest3);
  xrDevice.installRuntime({ forceInstall: true });
}

// ------------------------------------------------------------------ settings & tuning

const SETTINGS_KEY = 'pulsezone.settings';
const settings = {
  targetBpm: 120, age: 30, weightLb: 165, sex: '', trainingMinutes: 15, warmUpSeconds: 30, coolDownMinutes: 2, sound: true, volume: 0.8, challenge: 'normal',
  gameType: 'punch',   // 'punch' = hit hard enough; 'touch' = just hold your hand where the orb arrives
  voice: true,         // voice coach (v57): short spoken cues from the browser's own speech
  musicStyle: 'song',
  diag: false,         // show the diagnostics line (what the game is doing) on the scoreboard
  profile: 'steady',   // workout shape: 'steady' | 'waves' (target rolls +/-5 BPM) | 'build' (climbs to a peak)  // 'song' = recorded track (time-stretched to your pace) when available; 'synth' = live synth
  // The moveset: which moves the game may send you. Shared by the page checklist and the VR board.
  moves: {
    jab: true, low: true, swing: true, power: true, pair: true, guard: false, trace: true, sweep: true, hammer: true,
    knee: true, press: true, chop: true, tiptoe: true, // whole-body stations
    charge: true, // charge and coast: an all-out 30 s, then land in your zone
    acts: true,    // the workout in themed chapters of ~4 min (v55)
    program: true, // weekly plan: 3 workouts a week, Steady -> Waves -> Build (picks the shape)
    boss: true,    // the Guardian (v58): a heart-rate boss on the week's last planned workout
    bag: true, ropes: true, heavy: true, sled: true, barrage: true, duck: true, squatSide: true, lean: true, pillar: true,
    pose: true,   // pose walls (v57): hold a Y / T / squat-press shape while a body-shaped wall slides past
    shift: false, // side shifts (stepping off your centre line) are off by default: safer to stay centred
  },
};
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  const moves = { ...settings.moves, ...(saved.walls || {}), ...(saved.moves || {}) }; // older saves had walls/trace
  if (typeof saved.trace === 'boolean' && !saved.moves) moves.trace = saved.trace;
  Object.assign(settings, saved, { moves });
  delete settings.walls; delete settings.trace;
  delete settings.warmUpMinutes; // older saves had a 2-minute warm-up; it's now in seconds (30 s default)
  if (!(saved.migrated >= 2)) { settings.moves.shift = false; settings.migrated = 2; } // 2026-11-16: side shifts now off by default (stay centred)
  if (!(saved.migrated >= 3)) { settings.moves.guard = false; settings.migrated = 3; } // 2026-11-16: guard & counter removed from the mix (not fun)
} catch { /* ignore */ }
const MOVE_LABELS = {
  jab: 'Punches', low: 'Squat punches', swing: 'Hooks & uppercuts', power: 'Power orbs', pair: 'Squat then punch up', guard: 'Guard & counter', hammer: 'Hammer fists',
  trace: 'Rope tracing', sweep: 'Two-hand rope', bag: 'Speed bag', ropes: 'Battle ropes', heavy: 'Heavy bag', sled: 'Sled run', barrage: 'Dodge barrage (missiles)',
  duck: 'Duck', squatSide: 'Side squat', lean: 'Lean left/right', pillar: 'Centre pillar', shift: 'Side shifts (step left/right)', pose: 'Pose walls (hold a Y, a T, or a squat + press)',
  knee: 'Pull-down knee drive', press: 'Wall-ball rounds', chop: 'Woodchopper', tiptoe: 'Tiptoe reach',
  charge: 'Charge & coast (all out, then land in your zone)',
  acts: 'Acts (the workout in ~4-minute chapters)', program: 'Weekly plan (3 a week: Steady, Waves, Build; each day has a name)',
  boss: 'The Guardian (a boss on the last workout of the week: your hits only count in your zone)',
};
/** Which activities the moveset allows right now (forSpawn: also respect burst cooldowns). */
const enabledActivities = (forSpawn = false) => ({
  jab: settings.moves.jab,
  low: settings.moves.low,
  swing: settings.moves.swing && settings.gameType === 'punch', // swing direction needs a real punch
  power: settings.moves.power && settings.gameType === 'punch', // power is all about punching hard
  hammer: settings.moves.hammer && settings.gameType === 'punch', // the strike direction needs a real punch
  pair: settings.moves.pair,
  guard: settings.moves.guard,
  trace: settings.moves.trace,
  sweep: settings.moves.sweep,
  bag: settings.moves.bag && (!forSpawn || gameTime >= bagReadyAt),
  ropes: settings.moves.ropes && (!forSpawn || gameTime >= ropesReadyAt),
  heavy: settings.moves.heavy && (!forSpawn || gameTime >= heavyReadyAt),
  sled: settings.moves.sled && (!forSpawn || gameTime >= sledReadyAt),
  barrage: settings.moves.barrage,
  duck: settings.moves.duck,
  squatSide: settings.moves.squatSide,
  pose: settings.moves.pose,
  lateral: settings.moves.lean || settings.moves.pillar,
  knee: settings.moves.knee, press: settings.moves.press, chop: settings.moves.chop, tiptoe: settings.moves.tiptoe,
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
const vrButton = VRButton.createButton(renderer);
document.body.appendChild(vrButton);
if (!navigator.xr) vrButton.style.display = 'none';
// three.js fills the button in after its own check, so hide it whenever it says VR isn't available.
new MutationObserver(() => { if (vrButton.style.display !== 'none' && /NOT (SUPPORTED|ALLOWED)/.test(vrButton.textContent)) vrButton.style.display = 'none'; }).observe(vrButton, { childList: true, characterData: true, subtree: true, attributes: true });

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

// Worlds (v58; both research lists: "worlds that change by day"): each named workout has its own
// palette and a little horizon scenery. 'grid' is the look the game has always had.
const world = new WorldView(scene, { floorMat: floor.material, railMat, stripeMat, sun });

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
  applyMusic();
}).catch(() => { /* offline: synth only */ });
/**
 * Music style: 'song' = the recorded track, 'synth' = the live synth, 'daily' (v58) = the live synth
 * playing today's own set, so Tuesday doesn't sound like Thursday.
 */
function applyMusic() {
  audio.setMusicSet(settings.musicStyle === 'daily' ? (today?.music || 'night') : 'night');
  audio.setMusicMode(songAvailable && settings.musicStyle === 'song' ? 'song' : 'synth');
}
let coachWired = false;
const unlockAudio = () => {
  audio.unlock(); coach.warm();
  if (audio.ctx && audio.master && !coachWired) { coachWired = true; coach.attach(audio.ctx, audio.master); } // v58: coach clips share the game's volume
};
let songWarned = false;
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

// ------------------------------------------------------------------ fists (colour = hand)

const HAND_COLOR = { left: 0x3fa9ff, right: 0xff7a3d };
const VERSION = new URL(import.meta.url).search.slice(1) || 'dev'; // e.g. 'v48', from game.js?v55
{ const el = document.getElementById('version'); if (el) el.textContent = VERSION; }
const HAND_CSS = { left: '#7cc4ff', right: '#ffa070' };
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
let avgSum = 0, avgN = 0, kcal = 0; // kcal: estimated calories this workout
let lastStatus = Zone.NoSignal;
let lastPhase = null, statusSince = 0, voicedStatus = null, coolDownAt = null, recoveryVoiced = false, last30Voiced = false; // voice coach (v57)
let gameTime = 0;              // seconds of (unpaused) workout

// Learned "what raises your heart rate", kept across workouts in this browser.
const GAINS_KEY = 'pulsezone.gains';
const loadGains = () => { try { return JSON.parse(localStorage.getItem(GAINS_KEY) || 'null'); } catch { return null; } };
// Learned gains are only saved from real heart rate (the phone, not estimates or the simulator),
// so testing with the simulator never overwrites what the game has learned about your body.
const LEARN_N_KEY = 'pulsezone.learnUpdates';
const loadExperience = () => { try { return Number(localStorage.getItem(LEARN_N_KEY)) || 0; } catch { return 0; } };
let realHrSeconds = 0;   // this workout: seconds of real phone heart rate
let flatBpm = null, flatFor = 0, flatWarned = false, sensorFlat = false; // stuck-sensor watch (phone only)
const saveGains = () => {
  if (realHrSeconds < 60) return;
  try {
    localStorage.setItem(GAINS_KEY, JSON.stringify(attribution.w));
    localStorage.setItem(LEARN_N_KEY, String(attribution.experience + attribution.updates));
  } catch { /* ignore */ }
};
const newAttribution = () => {
  const a = new HeartRateAttribution({ weights: loadGains(), experience: loadExperience() });
  const record = a.record.bind(a);
  a.record = (key, t) => { record(key, t); bossRep(repQuality); repQuality = 1; }; // v58: every real rep also reaches the Guardian
  return a;
};
let attribution = newAttribution();
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
  // Today's workout (v58): with the weekly plan on it has a name, a featured move, act titles and a
  // length (a restart session after a week away is shorter); the plan still picks the shape.
  week = weekSummary(loadWeek());
  today = planToday();
  workoutShape = today ? today.shape : settings.profile;
  workoutMinutes = today ? today.minutes : settings.trainingMinutes;
  controller = new ZoneController({
    ...tuning.controller,
    kp: tuning.controller.kp * ch.kp,
    ki: tuning.controller.ki * ch.ki,
    targetBpm: settings.targetBpm,
    profile: workoutShape,
    safetyCeilingBpm: Math.min(maxBpm * 0.9, settings.targetBpm + 35),
    warmUpSeconds: settings.warmUpSeconds,
    trainingSeconds: workoutMinutes * 60,
    coolDownSeconds: settings.coolDownMinutes * 60,
  });
  boost = new ChallengeBoost({ riseSeconds: tuning.boostRiseSeconds * ch.rise });
  attribution = newAttribution();
  gainsSavedAt = 0;
  realHrSeconds = 0; flatBpm = null; flatFor = 0; flatWarned = false; sensorFlat = false;
  signalLostToggle = false;
  phoneFallback = false;
  avgSum = avgN = 0; kcal = 0;
  gameTime = 0;
  sessionLog.length = 0;
  workoutEvents.length = 0;
  finishedPlayed = false;
  shiftReadyAt = 0;
  waveState = 0;
  audio.dropIn(); // never start a workout with the song still thinned out
  spotlight = null; spotlightStarted = null;
  charge = null; chargeReadyAt = 0; verdictShow = null;
  acts = settings.moves.acts ? actPlan(workoutMinutes * 60) : []; actIdx = -1;
  ghost = loadGhosts()[workoutShape] || null; ghostSayAt = 0; // your last real run of this shape, to race
  boss = null; bossView.hide(true); repQuality = 1; bossRetreatSayAt = 0;
  world.set(today?.world || 'grid'); applyMusic();
  tierLog.length = 0; formSaidAt = -99;
  lastPhase = null; statusSince = 0; voicedStatus = null; coolDownAt = null; recoveryVoiced = false; last30Voiced = false; // (v57 never reset these: the last-30 and recovery lines only spoke in the first workout)
  progressBoard.visible = false;
  applyEmberColour();
  lastPick = lastReason = ''; forceShiftNext = false; testQueued = false; comboReadyAt = 0;
  Object.assign(tstat, { slams: 0, slamHits: 0, aboveSec: 0, flatSec: 0, notes: [], landings: [] }); pendingNote = '';
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
/** Workout shape (applies straight away, also to the workout in progress). */
function setProfile(p) {
  if (!PROFILES.includes(p)) return;
  settings.profile = p;
  controller.s.profile = p;
  workoutShape = p;
  if (settings.moves.program) { settings.moves.program = false; syncMovesUI(); say('Weekly plan off: you picked the shape', 2); }
  waveState = 0; // start the call-outs fresh for the new shape
  document.querySelectorAll('input[name=profile]').forEach((r) => { r.checked = r.value === p; });
  saveSettings();
}
const NOTE_LABEL = { 'note-slam': 'slam missed', 'note-guard': 'rep missed', 'note-fast': 'too fast', 'note-great': 'felt great' };
/** Note buttons (VR board): bookmark this second in the workout CSV (column 'note'). */
function addNote(label) {
  pendingNote = pendingNote ? `${pendingNote}; ${label}` : label;
  tstat.notes.push({ t: Math.round(gameTime), label });
  say(`Noted: ${label}  (${mmss(gameTime)})`, 2);
}
/** Test buttons (VR board): queue that exact move for the next free lane slot. */
function testMove(key) {
  if (controller.phase === Phase.Finished) startWorkout();
  if (key === 'shift') { forceShiftNext = true; say('Test: side shift coming', 2); return; }
  if (key === 'charge') {
    if (controller.phase !== Phase.Training) { say('Charge & coast runs in training (after the warm-up)', 2); return; }
    if (charge) { say('Already charging or coasting', 2); return; }
    queuedActivity = null; queuedFor = 0; queuedCombo = null; if (pendingBurst && !pendingBurstTest) pendingBurst = null;
    startCharge(true); return;
  }
  if (key === 'boss') {
    if (controller.phase !== Phase.Training) { say('The Guardian only comes in training (after the warm-up)', 2); return; }
    if (boss && !boss.left) { say('Already here', 2); return; }
    startBoss(true); return;
  }
  if (key === 'wall') { // one of the wall shapes you have switched on
    const on = [settings.moves.duck && 'duck', (settings.moves.lean || settings.moves.pillar) && 'lateral', settings.moves.squatSide && 'squatSide', settings.moves.pose && 'pose'].filter(Boolean);
    if (!on.length) { say('No walls switched on', 2); return; }
    key = on[Math.floor(Math.random() * on.length)];
  }
  const after = burstActive() ? ' after this burst' : shiftPlan ? ' after the side shift' : '';
  // A test press jumps the queue: whatever the game had lined up itself (a burst, a queued move, a
  // side shift that hasn't started) is dropped. Test call-outs are top priority so you always see them.
  if (!testQueued) { queuedActivity = null; queuedFor = 0; queuedCombo = null; }
  if (shiftPlan && shiftPlan.start - SHIFT.margin > gameTime + 0.5) { lane = lane.filter((r) => !r.shift); shiftPlan = null; }
  if (BURSTS.includes(key)) { pendingBurst = key; pendingBurstTest = true; say(`Test: ${MOVE_LABELS[key].toLowerCase()} coming${after}`, 1); return; }
  if (pendingBurst && !pendingBurstTest) pendingBurst = null; // an automatic burst that hasn't started yet gives way to the test move
  if (key === 'combo') {
    const en = enabledActivities();
    const list = availableCombos({ swing: en.swing, low: en.low });
    if (!list.length) { say('No combos with your current moves', 2); return; }
    queuedCombo = list[Math.floor(Math.random() * list.length)];
  }
  queuedActivity = key; queuedFor = 0; testQueued = true;
  const names = { sweep: 'two-hand rope + slam', duck: 'duck wall', lateral: 'lean wall', squatSide: 'side-squat wall', knee: 'knee drive', press: 'ceiling press', chop: 'woodchopper', tiptoe: 'tiptoe reach' };
  say(`Test: ${names[key] || key} coming${after}`, 1);
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
    say('Phone went quiet - estimating from movement', 1);
    audio.sfx('alert');
    pulseBoth(0.8, 150);
  } else if (phoneFallback && remote.secondsSinceLastReading < 2) {
    phoneFallback = false;
    say('Phone heart rate is back', 1);
    audio.sfx('reconnect');
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
  reset() { Object.assign(this, { score: 0, combo: 0, best: 0, hits: 0, perfect: 0, misses: 0, weak: 0, wrong: 0, dodges: 0, wallHits: 0, blocks: 0, guardsMissed: 0, bombDodges: 0, bombHits: 0, heavy: 0, powerSum: 0, powerN: 0, poses: 0 }); },
  /** Average punch power 0..100 over the workout (v57: power-graded hits). */
  powerPct() { return this.powerN ? Math.round((100 * this.powerSum) / this.powerN) : 0; },
  inZone: () => controller?.status === Zone.InZone,
  hit(bonus = 1, label = '') {
    this.hits++; this.combo++; this.best = Math.max(this.best, this.combo);
    const pts = Math.round(10 * bonus * Math.min(4, 1 + Math.floor(this.combo / 10)) * (this.inZone() ? 2 : 1));
    this.score += pts;
    return `${label}+${pts}${this.inZone() ? '  x2' : ''}`; // shown as floating text at the orb
  },
  dodge() {
    this.dodges++; this.combo++; this.best = Math.max(this.best, this.combo);
    const pts = 15 * (this.inZone() ? 2 : 1);
    this.score += pts;
    say(`Dodged! +${pts}`, 3);
  },
  miss() { this.misses++; this.combo = 0; },
  weakHit(msg = 'Punch harder!') { this.weak++; say(msg); },
  wrongHand(hand) { this.wrong++; say(hand === 'left' ? 'Left hand - blue!' : 'Right hand - orange!'); },
  wallHit() { this.wallHits++; this.combo = 0; },
  // Bombs keep their own tally (so the walls stat stays about walls) and stay quiet: they come in fast runs.
  bombDodge() { this.bombDodges++; this.combo++; this.best = Math.max(this.best, this.combo); this.score += 10 * (this.inZone() ? 2 : 1); },
  bombHit() { this.bombHits++; this.combo = 0; },
};
score.reset();
let lastEvent = '', lastEventAt = -10, lastTier = 3;
const now = () => performance.now() / 1000;
/**
 * One call-out slot on the scoreboard, with priorities so the important ones aren't buried:
 * tier 1 = do this now / safety (walls, guard, slam, step, drift, phone), 2 = workout news
 * (zone, waves, spotlight, streaks, results), 3 = praise. A lower tier can't replace a higher one
 * that's still showing (tiers 1-2 show for 1.8 s, praise for 0.9 s).
 */
const coach = new VoiceCoach(); // v57: spoken cues (browser speech); 'Coach voice' on the board
coach.setEnabled(settings.voice !== false);
coach.onSpeak = (seconds) => audio.duck(0.5, Math.min(5, seconds + 0.3)); // the music dips under the coach
coach.load(); // v58: the pre-rendered clip bank (assets/voice); silent failure = browser speech, as in v57
const SAY_HOLD = { 1: 1.8, 2: 1.8, 3: 0.9 };
function say(text, tier = 2) {
  const t = now();
  if (t - lastEventAt < SAY_HOLD[lastTier] && tier > lastTier) return false;
  lastEvent = text; lastEventAt = t; lastTier = tier;
  // The voice coach (v57) reads out the do-this-now cues (walls, stations, slams), never test lines.
  if (tier === 1 && !/^(Test|Already|No |Saved|Song|Weekly|COOL-DOWN|CHARGE|COAST|LANDING)/.test(text)) coach.say(text, 1);
  return true;
}
const sayFresh = () => now() - lastEventAt < SAY_HOLD[lastTier];

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
  wallHitNear: new THREE.MeshBasicMaterial({ color: 0xff2626, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }),
  wallNear: new THREE.MeshBasicMaterial({ color: 0xd94cf2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
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
  down: [[0, 0.46, 0.22], [0, 0.4, -0.02], [0, -0.16, -0.02]],         // hammer fist: from above, straight down onto the pad
};
const hammerGeo = new THREE.CylinderGeometry(1, 1, 0.42, 28); // a flat drum pad (scaled by the orb radius)
const hammerRimGeo = new THREE.TorusGeometry(1.05, 0.09, 8, 28).rotateX(Math.PI / 2);
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
// Test-session stats for the end-board report (Diag on) and bookmarks ('Note' buttons) for the CSV.
const tstat = { slams: 0, slamHits: 0, aboveSec: 0, flatSec: 0, notes: [] };
let pendingNote = '';
let lastPick = '', lastReason = '';  // what the spawner sent last, and why (diagnostics / CSV)
let forceShiftNext = false, testQueued = false;          // a 'Test: Shift' press: plan a shift as soon as the lane allows
let standNext = false;                                // a squat box was sent: a "Stand tall!" box comes next
let bag = null, ropes = null, pendingBurst = null, pendingBurstTest = false;   // speed bag / battle ropes (one at a time)
let bagReadyAt = 0, ropesReadyAt = 0;                // burst cooldowns (game seconds)
let centerX = 0;
let recenterSoon = true;

let laneHidden = false;
function setLaneVisible(v) {
  laneHidden = !v;
  for (const o of orbs) o.group.visible = v;
  for (const w of walls) w.mesh.visible = v;
  for (const t of traces) { t.group.visible = v; for (const r of t.strands) r.marker.visible = v; }
  for (const x of [...guards, ...slams, ...bombs]) x.group.visible = v;
  for (const b of [bag, heavy]) if (b) b.group.visible = v;
}
function clearObstacles() {
  for (const o of [...orbs, ...walls, ...bursts]) scene.remove(o.group || o.mesh);
  for (const p of shardPool) p.alive = false;
  for (const t of traces) scene.remove(t.group, ...t.strands.map((r) => r.marker));
  orbs.length = walls.length = bursts.length = traces.length = shards.length = 0;
  if (bag) disposeBag();
  if (ropes) { endRopes(false); }
  if (heavy) endHeavy(false);
  if (sled) endSled(false);
  for (const b of bombs) scene.remove(b.group);
  bombs.length = 0;
  for (const g of guards) scene.remove(g.group, g.ring);
  guards.length = 0;
  for (const s of slams) scene.remove(s.group);
  slams.length = 0;
  while (stations.length) removeStation(stations[0]);
  pendingBurst = null;
  bagReadyAt = ropesReadyAt = heavyReadyAt = sledReadyAt = 0;
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
const poseRingGeo = new THREE.TorusGeometry(POSE_RING_R, 0.025, 8, 28);
const poseRingMat = { left: new THREE.MeshBasicMaterial({ color: HAND_COLOR.left }), right: new THREE.MeshBasicMaterial({ color: HAND_COLOR.right }), held: new THREE.MeshBasicMaterial({ color: 0x4dff73 }) };
/** A pose wall's shape: the full lane with a body-shaped hole (head circle, torso, two arms out to the rings). */
function poseShape(pose, standing) {
  const W = 1.3, TOP = Math.max(2.4, standing + 0.6);
  const shape = new THREE.Shape([[-W, 0], [W, 0], [W, TOP], [-W, TOP]].map(([x, y]) => new THREE.Vector2(x + centerX, y)));
  const [hx, hy] = pose.head;
  const hole = new THREE.Path();
  hole.absarc(centerX + hx, hy, 0.24, 0, Math.PI * 2, false);
  shape.holes.push(hole);
  const torso = new THREE.Path(); // from the floor up to the shoulders
  const sh = hy - 0.28;
  torso.moveTo(centerX + hx - 0.26, 0); torso.lineTo(centerX + hx + 0.26, 0); torso.lineTo(centerX + hx + 0.26, sh); torso.lineTo(centerX + hx - 0.26, sh); torso.closePath();
  shape.holes.push(torso);
  for (const [rx, ry] of pose.rings) { // an arm: a bar from the shoulder to just past the ring
    const sx = centerX + hx + Math.sign(rx) * 0.2, sy = sh - 0.02, ex = centerX + rx, ey = ry;
    const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) + POSE_RING_R + 0.06, nx = -dy / Math.hypot(dx, dy) * 0.16, ny = dx / Math.hypot(dx, dy) * 0.16;
    const ux = dx / Math.hypot(dx, dy) * len, uy = dy / Math.hypot(dx, dy) * len;
    const arm = new THREE.Path();
    arm.moveTo(sx + nx, sy + ny); arm.lineTo(sx + ux + nx, sy + uy + ny); arm.lineTo(sx + ux - nx, sy + uy - ny); arm.lineTo(sx - nx, sy - ny); arm.closePath();
    shape.holes.push(arm);
  }
  return shape;
}
function spawnWall(head, standing, type, activity, opts = {}) {
  const pose = posePoints(type, standing);
  const poly = pose ? null : wallPolygon(type, standing);
  const speed = difficulty.orbSpeed * 0.8;
  const depth = opts.hold ? Math.max(0.3, opts.hold * speed) : wallDepth(type, speed);
  const shape = pose ? poseShape(pose, standing) : new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x + centerX, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const group = new THREE.Group();
  const fill = new THREE.Mesh(geo, MAT.wall);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), MAT.wallEdge);
  group.add(fill, edge);
  group.position.z = head.z - 14 - depth - (opts.behind || 0); // geometry spans z..z+depth (near face = z+depth)
  scene.add(group);
  if (LOW_WALLS.includes(type)) standNext = true;   // you'll have to stand back up for the next box
  if (type === 'rise') standNext = false;
  let rings = null;
  if (pose) { // two fist rings on the near face, in hand colours; green while a fist is in them
    rings = pose.rings.map(([x, y], i) => {
      const m = new THREE.Mesh(poseRingGeo, poseRingMat[i === 0 ? 'left' : 'right']);
      m.position.set(centerX + x, y, depth); group.add(m); return m;
    });
  }
  walls.push({
    mesh: group, fill, poly, type, activity: activity === 'stand' ? null : activity, depth, speed, passZ: head.z + 0.3, hit: false, announced: false,
    label: WALL_TYPES.find((w) => w.type === type).label, pose, rings, held: 0, inside: 0, cued: false,
  });
}

/**
 * Orbs. `opts` can fix the position / hand / swing (used by squat-then-reach pairs) and push the
 * orb further back (`behind` metres) so it arrives later. Power orbs are faceted, armoured and
 * need a full punch.
 */
let lastSwing = { hand: null, at: -99 }, hammerHand = 'right';
function spawnOrb(head, standing, activity, opts = {}) {
  const d = difficulty;
  const power = activity === 'power';
  const r = power ? 0.15 : 0.125;
  let x = opts.x ?? (Math.random() * 2 - 1) * d.horizontalSpread * (power ? 0.7 : 1);
  let hand = opts.hand ?? planOrb(x, d).hand;
  let swing = opts.swing ?? null;
  if (activity === 'swing' && !opts.swing) {
    hand = x < 0 ? 'left' : 'right';
    // Flow: right after a swing, the next one comes off the other hand (hook one way, then hook or
    // uppercut the other), so you're never asked to wind up the same hook twice in a row.
    if (gameTime - lastSwing.at < 2.5 && hand === lastSwing.hand) { hand = hand === 'left' ? 'right' : 'left'; x = -x || (hand === 'left' ? -0.1 : 0.1); }
    swing = Math.random() < 0.5 ? 'up' : (hand === 'right' ? 'left' : 'right');
    lastSwing = { hand, at: gameTime };
  }
  if (power) hand = x < 0 ? 'left' : 'right';
  if (activity === 'hammer') { // alternate hands, pad just inside each shoulder
    hammerHand = hammerHand === 'left' ? 'right' : 'left';
    hand = hammerHand; x = hand === 'left' ? -0.12 : 0.12; swing = 'down';
  }
  const chest = standing - 0.35;
  const y = opts.y ?? (activity === 'hammer' ? standing - 0.45 : activity === 'low'
    ? Math.max(0.55, standing - 0.95 + Math.random() * 0.15)   // knee-to-hip height: squat and punch
    : power ? chest + (Math.random() - 0.5) * 0.15
      : Math.max(0.6, chest + (Math.random() * 1.4 - 1) * d.verticalSpread));
  const group = new THREE.Group();
  group.position.set(centerX + x + (opts.shift || 0), y, head.z - (opts.dist ?? SPAWN_DISTANCE) - (opts.behind || 0));
  const baseMat = power ? (hand === 'left' ? MAT.powerL : MAT.powerR) : MAT[hand];
  const mesh = new THREE.Mesh(power ? powerGeo : activity === 'hammer' ? hammerGeo : orbGeo, baseMat);
  mesh.scale.setScalar(activity === 'hammer' ? 0.15 : r);
  group.add(mesh);
  if (activity === 'hammer') { const rim = new THREE.Mesh(hammerRimGeo, MAT.guide); rim.scale.setScalar(0.15); group.add(rim); }
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
 * Hammer fists come as a pair of drum pads, left then right, HAMMER_GAP s apart. Once you're warmed
 * up some pairs come in low, so you squat and hammer down.
 */
function spawnHammers(head, standing) {
  const low = difficulty.intensity > 0.35 && Math.random() < 0.4;
  const y = low ? Math.max(0.6, standing - 0.85) : standing - 0.45;
  for (const k of [0, 1]) spawnOrb(head, standing, 'hammer', { y, behind: k * difficulty.orbSpeed * HAMMER_GAP });
  if (low) say('SQUAT + HAMMER FISTS!', 1);
}

/**
 * Squat, then reach up: a low orb for one hand, then a high orb for the other hand about 0.85 s
 * later (it flies in behind the first). Like a squat jump without leaving the floor.
 */
function spawnPair(head, standing, finish = 'up') {
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
    swing: settings.gameType !== 'punch' ? null : finish === 'hook' ? (highHand === 'right' ? 'left' : 'right') : 'up',
    link: [lowX - highX, lowY - highY, gap],
  });
  say(finish === 'hook' ? 'Squat... then HOOK!' : 'Squat... then PUNCH UP!');
}

// ------------------------------------------------------------------ whole-body stations

/**
 * Whole-body moves that fly in, stop just in front of you and wait while you do them (see STATIONS
 * in core.js): pull-down knee drive, squat + ceiling press, woodchopper and tiptoe reach. All on
 * your centre line. A label on each one says what to do, how many reps are left and the time left.
 */
const stations = [];
let chopSide = 1, kneeLeg = 'left', tiptoeUntil = -9, reachUp = 0.45;
const STATION_COLOR = 0x6dffd8; // mint: nothing else in the game uses it
const stationMat = new THREE.MeshStandardMaterial({ color: 0x14302a, emissive: STATION_COLOR, emissiveIntensity: 0.6, roughness: 0.4 });
const stationGlowMat = new THREE.MeshBasicMaterial({ color: STATION_COLOR, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
const kneeBarGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.74, 12).rotateZ(Math.PI / 2);
const kneeGripGeo = new THREE.TorusGeometry(0.06, 0.014, 8, 20).rotateY(Math.PI / 2);
const kneeRingGeo = new THREE.RingGeometry(0.1, 0.13, 32);
const pressBallGeo = new THREE.SphereGeometry(0.13, 24, 16);
const ceilingRingGeo = new THREE.RingGeometry(0.17, 0.21, 40).rotateX(Math.PI / 2);
const chopOrbGeo = new THREE.SphereGeometry(0.11, 20, 14);
// Tree chop (v56): a trunk to swing through, a lit start spot by one shoulder, an axe in your hands.
const treeTrunkGeo = new THREE.CylinderGeometry(0.075, 0.11, 2.6, 14).translate(0, 1.3, 0);
const treeCrownGeo = new THREE.ConeGeometry(0.55, 1.3, 10).translate(0, 3.0, 0);
const treeCutGeo = new THREE.BoxGeometry(0.14, 0.08, 0.14);
const treeBarkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x1f5a34, roughness: 0.8, emissive: 0x0b2414, emissiveIntensity: 0.5 });
const treeCutMat = new THREE.MeshStandardMaterial({ color: 0xe8c79a, emissive: 0x6d4a20, emissiveIntensity: 0.6 });
const axeHandleGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.55, 8);
const axeHeadGeo = new THREE.BoxGeometry(0.16, 0.1, 0.03);
const axeMat = new THREE.MeshStandardMaterial({ color: 0xc8d2dc, metalness: 0.7, roughness: 0.3, emissive: 0x334455, emissiveIntensity: 0.4 });
const hipRingGeo = new THREE.RingGeometry(0.12, 0.16, 32);
const tipStarGeo = new THREE.OctahedronGeometry(0.13, 0); // bigger again in v55 (Morty: still looked small)
const tipHaloGeo = new THREE.RingGeometry(0.17, 0.22, 32);
/** A straight guide like the hook arrows: a tube, an arrowhead at `to` and a ghost dot sliding along it. */
function stationGuide(from, to, mat) {
  const group = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(from, to), 1, 0.012, 6), mat);
  const tip = new THREE.Mesh(arrowHeadGeo, mat);
  tip.position.copy(to);
  tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  const ghost = new THREE.Mesh(ghostGeo, MAT.guide);
  group.add(tube, tip, ghost);
  return { group, tube, ghost, from: from.clone(), to: to.clone() };
}
function disposeGuide(gd) { gd.group.parent?.remove(gd.group); gd.tube.geometry.dispose(); }
function slideGuides(s) { for (const gd of s.p.guides || []) gd.ghost.position.lerpVectors(gd.from, gd.to, (gameTime * 0.9) % 1); }
/** Tree chop: the lit start spot beside the shoulder on `side` (x>0 = your right), an arrow across the trunk to the other side. */
function placeChop(s) {
  const p = s.p;
  p.home.set(p.side * 0.42, s.base - 0.3, 0.05);
  p.orb.position.copy(p.home);
  p.hip.position.set(-p.side * 0.42, s.base - 0.4, 0.05); // where the swing ends (kept as 'hip' for the test hooks)
  for (const gd of p.guides) disposeGuide(gd);
  p.guides = [stationGuide(p.home, p.hip.position, p.guideMat)];
  s.group.add(p.guides[0].group);
}
const STATION_SAY = {
  knee: 'KNEE DRIVE! Grab the bar overhead, pull it down and drive your knee up',
  press: 'WALL BALL ROUND! Squat, drive up, press it to the ring - on the beat, all the way',
  chop: 'CHOP THE TREE! Hands together by your shoulder, swing across through the trunk',
  tiptoe: 'TIPTOE REACH! Up on your toes and touch the star',
};
const stTmpL = new THREE.Vector3(), stTmpR = new THREE.Vector3(), stTmpH = new THREE.Vector3(), stMid = new THREE.Vector3();
function spawnStation(head, standing, key) {
  const group = new THREE.Group();
  const speed = difficulty.orbSpeed;
  const stopZ = head.z - STATION_STOP;
  group.position.set(centerX, 0, stopZ - (SPAWN_DISTANCE - STATION_STOP));
  const base = standing, p = {}, mats = [];
  const glow = () => { const m = stationGlowMat.clone(); mats.push(m); return m; };
  if (key === 'knee') {
    p.bar = new THREE.Group();
    p.bar.add(new THREE.Mesh(kneeBarGeo, stationMat));
    for (const sx of [-1, 1]) { const g = new THREE.Mesh(kneeGripGeo, stationMat); g.position.x = sx * 0.25; p.bar.add(g); }
    p.home = new THREE.Vector3(0, base + 0.15, 0);
    p.bar.position.copy(p.home);
    p.knee = new THREE.Mesh(kneeRingGeo, glow()); // where to bring your knee: a cue only (knees can't be tracked)
    p.knee.position.set(kneeLeg === 'left' ? -0.12 : 0.12, 0.62, 0.2);
    p.kneeArrow = new THREE.Mesh(arrowHeadGeo, p.knee.material); // bobbing up-arrow under the ring: knee UP
    p.kneeArrow.scale.setScalar(1.6);
    p.kneeArrow.position.set(p.knee.position.x, 0.42, 0.2);
    const gm = glow(); gm.opacity = 0.8;
    // Pull-down guides from each end of the bar to your waist, like the hook arrows.
    p.guides = [-1, 1].map((sx) => stationGuide(new THREE.Vector3(sx * 0.25, base + 0.1, 0), new THREE.Vector3(sx * 0.22, base - 0.5, 0.12), gm));
    group.add(p.bar, p.knee, p.kneeArrow, ...p.guides.map((gd) => gd.group));
  } else if (key === 'press') {
    p.ball = new THREE.Mesh(pressBallGeo, stationMat);
    p.home = new THREE.Vector3(0, base - 0.45, 0);
    p.ball.position.copy(p.home);
    p.ring = new THREE.Mesh(ceilingRingGeo, glow()); // the target on the "ceiling"
    p.ring.position.set(0, base + 0.5, 0);
    const gm = glow(); gm.opacity = 0.8;
    p.guides = [stationGuide(new THREE.Vector3(0, base - 0.25, 0), new THREE.Vector3(0, base + 0.42, 0), gm)]; // drive it UP
    p.guides[0].group.visible = false; // shows once you're down in the squat
    group.add(p.ball, p.ring, p.guides[0].group);
  } else if (key === 'chop') {
    p.side = chopSide; chopSide = -chopSide;
    p.orb = new THREE.Mesh(chopOrbGeo, glow()); // the start spot: hands together here
    p.orb.material.opacity = 0.7;
    p.home = new THREE.Vector3();
    p.hip = new THREE.Object3D();
    p.guideMat = glow(); p.guideMat.opacity = 0.8;
    p.guides = [];
    p.swing = { armedAt: null };
    p.tree = new THREE.Group(); // the trunk stands a little beyond where your hands pass
    p.tree.position.set(0, 0, -0.4); // 85 cm out: in view without filling it
    p.tree.add(new THREE.Mesh(treeTrunkGeo, treeBarkMat), new THREE.Mesh(treeCrownGeo, treeLeafMat));
    p.cut = new THREE.Mesh(treeCutGeo, treeCutMat); // the notch: deeper with every chop
    p.cut.position.set(0, base - 0.35, 0.07); p.cut.scale.set(0.3, 1, 0.3);
    p.tree.add(p.cut);
    p.axe = new THREE.Group();
    const handle = new THREE.Mesh(axeHandleGeo, treeBarkMat), headM = new THREE.Mesh(axeHeadGeo, axeMat);
    handle.position.y = -0.1; headM.position.set(0.07, 0.16, 0);
    p.axe.add(handle, headM); p.axe.visible = false;
    group.add(p.orb, p.hip, p.tree, p.axe);
  } else {
    const h = tiptoeHeight(reachUp);
    p.stars = [-1, 1].map((sx) => { const m = new THREE.Mesh(tipStarGeo, stationMat); m.position.set(sx * 0.14, base + h, 0); m.add(new THREE.Mesh(tipHaloGeo, glow())); group.add(m); return m; });
    p.next = Math.random() < 0.5 ? 0 : 1;
    p.stars[1 - p.next].visible = false; // one star at a time, alternating hands
    // An arrow from shoulder height up to the lit star, so the reach has somewhere to go (v54).
    p.guideMat = glow(); p.guideMat.opacity = 0.8;
    p.guides = [];
    p.placeGuide = () => {
      for (const gd of p.guides) disposeGuide(gd);
      const star = p.stars[p.next].position;
      p.guides = [stationGuide(new THREE.Vector3(star.x * 1.4, base - 0.25, 0.1), star.clone().setY(star.y - 0.1), p.guideMat)];
      group.add(p.guides[0].group);
    };
    p.placeGuide();
  }
  const { lc, tex, label } = burstLabel();
  label.position.set(0, base - 0.3, -0.9); label.scale.setScalar(1.4); // further back, so it never blocks your view
  group.add(label);
  scene.add(group);
  const st = {
    key, group, p, mats, lc, tex, label, labelKey: '', speed, stopZ, base, arrived: false, held: 0, duration: stationHold(key, difficulty.intensity),
    reps: 0, need: STATIONS[key].reps, stage: 0, stageAt: 0, smokeT: 0, done: false, doneAge: 0, nagAt: -9,
    round: !!STATIONS[key].round, beatAt: -9, nextBeatAt: 0, onBeat: 0,
    coach: makeMoveCoach(key), grabNear: 9, pullBest: { drop: 0, crunch: 0 },
  };
  if (key === 'chop') placeChop(st);
  if (st.round) { st.need = wallBallGoal(st.duration); st.coachPh = 0.3; }
  stations.push(st);
  say(STATION_SAY[key], 1);
}
/** World positions of a station's targets (for the test hooks). */
function stationPoints(s) {
  const g = s.group, w = (v) => g.localToWorld(v.clone()), p = s.p;
  if (s.key === 'knee') return { gripL: w(p.home.clone().setX(-0.25)), gripR: w(p.home.clone().setX(0.25)) };
  if (s.key === 'press') return { ball: w(p.ball.position), ring: w(p.ring.position) };
  if (s.key === 'chop') return { orb: w(p.orb.position), hip: w(p.hip.position) };
  return { star: w(p.stars[p.next].position) };
}
function stationRep(s, at, label) {
  s.reps++;
  // Wall-ball rounds: a rep within WALLBALL.onBeat s of a beat is ON THE BEAT (worth 1.5x).
  const onBeat = s.round && s.arrived && Math.min(Math.abs(gameTime - s.beatAt), Math.abs(s.nextBeatAt - gameTime)) <= WALLBALL.onBeat;
  if (onBeat) { s.onBeat++; label = 'ON THE BEAT! '; }
  logEvent('rep', { act: s.key, rep: s.reps, secs: +(gameTime - s.stageAt).toFixed(2), onBeat: s.round ? onBeat : undefined });
  attribution.record(s.key, gameTime);
  popText(score.hit(s.key === 'press' ? (onBeat ? 2.2 : 1.5) : 1.5, label), at, '#6dffd8');
  audio.sfx('perfect', { hand: 'left', power: 0.8 });
  pulseBoth(0.6, 60);
  shatter(at, new THREE.Vector3(0, 1, 0.3), STATION_COLOR, 0.5);
  if (s.reps >= s.need && !s.round) { s.done = true; if (s.key !== 'press' && s.key !== 'chop') s.group.visible = false; } // a round runs its full time; the tree falls
}
/** End of a wall-ball round: the ball flies to the ring, and a call-out with how you did. */
function finishRound(s) {
  s.done = true;
  s.flyFrom = s.p.ball.position.clone();
  const pct = s.reps / Math.max(1, s.need);
  logEvent('round', { act: s.key, reps: s.reps, need: s.need, onBeat: s.onBeat, secs: +s.duration.toFixed(1) });
  if (s.reps >= s.need) {
    const pts = 20 * s.reps;
    score.score += pts;
    say(`WALL BALL ROUND: ${s.reps} reps, ${s.onBeat} on the beat!  +${pts}`, 1);
    audio.sfx('streak', { level: 3 }); pulseBoth(0.9, 120);
  } else if (pct >= 0.5) say(`Round done: ${s.reps}/${s.need} reps - keep the pace next time!`, 2);
  else { if (!s.reps) score.miss(); say(s.reps ? `Round done: ${s.reps}/${s.need} - squat, drive, press!` : 'Missed the round - next one!', 2); }
}
function stationNag(s, text) { if (gameTime - s.nagAt > 2) { s.nagAt = gameTime; say(text, 2); } }
function stationStep(s, xr, head) {
  const g = s.group, p = s.p;
  const L = g.worldToLocal(stTmpL.copy(fistByHand.left.world)), R = g.worldToLocal(stTmpR.copy(fistByHand.right.world));
  const hy = head.y;
  const late = gameTime - s.stageAt > (STATION_WINDOW[s.key] ?? 9);
  stMid.addVectors(L, R).multiplyScalar(0.5);
  if (s.stage === 1) { // what you managed this attempt (for the workout data, to tune the moves)
    s.pullBest.drop = Math.max(s.pullBest.drop, hy - Math.max(L.y, R.y));
    s.pullBest.crunch = Math.max(s.pullBest.crunch, standing - hy);
  }
  const grabbed = () => { s.stage = 1; s.stageAt = gameTime; s.pullBest = { drop: 0, crunch: 0 }; pulseBoth(0.3, 30); logEvent('grab', { act: s.key }); };
  const gaveUp = () => logEvent('late', { act: s.key, drop: +s.pullBest.drop.toFixed(2), crunch: +s.pullBest.crunch.toFixed(2) });
  if (s.key === 'knee') {
    if (s.stage === 0) {
      s.grabNear = Math.min(s.grabNear, Math.max(L.distanceTo(p.home), R.distanceTo(p.home)));
      if (kneeGrab(L, R, p.home)) grabbed();
    }
    if (s.stage === 1) {
      p.bar.position.set(0, Math.min(p.home.y, stMid.y), 0); // the bar comes down with your hands
      if (kneePulled(L, R, hy, standing)) {
        stationRep(s, g.localToWorld(p.knee.position.clone()), `${kneeLeg.toUpperCase()} KNEE! `);
        kneeLeg = kneeLeg === 'left' ? 'right' : 'left';
        p.knee.position.x = p.kneeArrow.position.x = kneeLeg === 'left' ? -0.12 : 0.12;
        p.bar.position.copy(p.home); s.stage = 0;
      } else if (late) { gaveUp(); p.bar.position.copy(p.home); s.stage = 0; stationNag(s, 'Pull the bar right down to your waist!'); }
    }
  } else if (s.key === 'press') {
    if (s.stage === 0 && pressLoaded(hy, standing)) { grabbed(); if (!s.round) say('Now PRESS it up!', 2); } // rounds: the label + coach are the one cue
    p.guides[0].group.visible = s.stage === 1;
    if (s.stage === 1) {
      p.ball.position.lerp(stMid, 0.35); // the ball rides up with your hands
      if (pressDone(L, R, hy, standing)) {
        s.flyFrom = p.ball.position.clone(); s.flyAt = gameTime;
        stationRep(s, g.localToWorld(p.ring.position.clone()), 'WALL BALL! ');
        s.stage = 0;
      } else if (late) { gaveUp(); s.stage = 0; p.ball.position.copy(p.home); stationNag(s, 'Squat, then drive it all the way up!'); }
    } else if (!s.done) {
      if (s.flyFrom && gameTime - s.flyAt < 0.3) p.ball.position.lerpVectors(s.flyFrom, p.ring.position, (gameTime - s.flyAt) / 0.3); // up to the ring...
      else p.ball.position.lerp(p.home, 0.2); // ...then back down for the next rep
    }
  } else if (s.key === 'chop') {
    // Tree chop (v56): hands together by the lit shoulder arms it; swinging across through the trunk is a chop.
    const gap = L.distanceTo(R);
    p.axe.visible = gap < TREE_CHOP.together + 0.1;
    if (p.axe.visible) { p.axe.position.copy(stMid); p.axe.rotation.set(0, 0, -p.side * 0.5 + stMid.x * p.side * 1.5); }
    const r = chopSwing(p.swing, { midX: stMid.x, midY: stMid.y - s.base, gap, side: p.side, t: gameTime });
    if (r === 'armed' && s.stage === 0) grabbed();
    else if (r === 'chop') {
      stationRep(s, g.localToWorld(new THREE.Vector3(0, stMid.y, 0)), s.reps + 1 < s.need ? 'CHOP! Other side! ' : 'TIMBER! ');
      const deep = 0.3 + 0.7 * Math.min(1, s.reps / s.need);
      p.cut.scale.set(deep, 1, deep);
      s.stage = 0;
      if (!s.done) { p.side = -p.side; placeChop(s); } // swing back the other way
    } else if (r === 'late') { gaveUp(); s.stage = 0; stationNag(s, 'Swing right across the tree!'); }
  } else {
    const star = p.stars[p.next];
    for (const f of [L, R]) {
      if (f.distanceTo(star.position) < 0.22) {
        // One touch per rep: with both hands up, the other hand was already on the next star, so one
        // reach counted 3 reps in a frame (2026-11-18 workout). Wait a beat before the next star counts.
        if (gameTime - (p.lastTipAt ?? -9) < 0.6) break;
        if (tiptoeReached(f, star.position, hy, s.base)) {
          p.lastTipAt = gameTime;
          stationRep(s, g.localToWorld(star.position.clone()), 'TIPTOE! ');
          star.visible = false; p.next = 1 - p.next; p.stars[p.next].visible = true; p.placeGuide();
          break;
        }
        stationNag(s, 'Up on your toes!');
      }
    }
  }
}
function updateStations(dt, xr, head) {
  for (let i = stations.length - 1; i >= 0; i--) {
    const s = stations[i];
    const g = s.group;
    if (s.done) { // finished: the wall ball flies up to the ceiling ring, then everything goes
      s.doneAge += dt;
      if (s.key === 'press' && s.flyFrom) s.p.ball.position.lerpVectors(s.flyFrom, s.p.ring.position, Math.min(1, s.doneAge / 0.3));
      if (s.coach) s.coach.group.visible = false;
      if (s.key === 'chop') { // TIMBER: the tree tips away from you, then goes
        s.p.axe.visible = false; s.p.orb.visible = false; for (const gd of s.p.guides) gd.group.visible = false;
        s.p.tree.rotation.x = -Math.min(1, (s.doneAge / 0.9) ** 2) * 1.45;
        if (s.doneAge > 1.0) removeStation(s);
        continue;
      }
      if (s.doneAge > 0.35) removeStation(s);
      continue;
    }
    if (!s.arrived) {
      g.position.z = Math.min(s.stopZ, g.position.z + s.speed * dt);
      if (g.position.z >= s.stopZ) { s.arrived = true; s.stageAt = gameTime; audio.sfx('alert'); logEvent('station', { act: s.key, need: s.need }); }
    } else {
      g.position.set(centerX, 0, head.z - STATION_STOP); // waits just in front of you
      s.held += dt;
      if (SMOKE) { s.smokeT += dt; if (s.smokeT > 0.7) { s.smokeT = 0; stationRep(s, g.position.clone().setY(standing - 0.2), 'NICE! '); } }
      else if (xr) stationStep(s, xr, head);
      if (s.round && !s.done) { // the beat: ladders faster across the round; the ring pulses, a tick sounds
        if (s.nextBeatAt === 0) s.nextBeatAt = gameTime + wallBallBeat(0);
        if (gameTime >= s.nextBeatAt) {
          s.beatAt = s.nextBeatAt;
          s.nextBeatAt += wallBallBeat(s.held / s.duration);
          audio.sfx('bag');
          s.coachPh = Math.floor(s.coachPh) + 0.65; // the coach presses on the beat
        }
        s.coachPh += dt / wallBallBeat(s.held / s.duration);
        s.p.ring.scale.setScalar(1 + 0.45 * Math.exp(-(gameTime - s.beatAt) * 7));
      }
      if (s.round && !s.done && s.held >= s.duration) { finishRound(s); continue; }
      if (!s.done && s.held >= s.duration) { // time's up
        logEvent('timeout', { act: s.key, reps: s.reps, need: s.need, stage: s.stage, grabNear: s.key === 'knee' ? +s.grabNear.toFixed(2) : undefined });
        if (s.reps < s.need) { score.miss(); say(s.reps ? 'Nearly - keep that pace!' : 'Missed it - next one!', 2); }
        removeStation(s);
        continue;
      }
    }
    slideGuides(s);
    if (s.key === 'knee') s.p.kneeArrow.position.y = 0.42 + 0.06 * Math.sin(gameTime * 6);
    if (s.coach) { s.coach.group.visible = s.arrived; if (s.arrived) poseMoveCoach(s, head); } // v56: not while it flies in (Gio: it hid the orbs before it)
    s.label.lookAt(camera.getWorldPosition(sledTmp));
    let what = { knee: s.stage ? 'PULL DOWN + KNEE UP!' : 'GRAB THE BAR', press: s.stage ? 'PRESS IT UP!' : 'SQUAT LOW',
      chop: s.stage ? 'SWING ACROSS!' : 'HANDS TOGETHER AT THE LIGHT', tiptoe: 'TIPTOE + TOUCH THE STAR' }[s.key];
    // Rounds: one cue, the coach's, which flips with the beat (Morty: "SQUAT LOW" and "DRIVE UP + PRESS" fought).
    if (s.round) what = `${(s.coach?.text || what).replace('DRIVE UP + PRESS', 'DRIVE UP + PRESS!')}  ·  ${Math.ceil(Math.max(0, s.duration - s.held))}s`;
    if (!renderer.xr.isPresenting) what += '  ·  click = rep'; // desktop: say what the input is (Morty)
    const left = s.arrived ? Math.max(0, s.duration - s.held) : s.duration;
    const beatFlash = s.round && s.arrived && gameTime - s.beatAt < 0.18; // the beat has a face: the label flashes white
    drawBurstLabel(s, `${s.reps}/${s.need}`, what, left / s.duration, beatFlash ? '#ffffff' : s.stage ? '#7cffb0' : '#6dffd8');
  }
}
function removeStation(s) {
  const i = stations.indexOf(s);
  if (i >= 0) stations.splice(i, 1);
  scene.remove(s.group);
  for (const m of s.mats) m.dispose();
  for (const gd of s.p.guides || []) disposeGuide(gd);
  if (s.coach) { scene.remove(s.coach.group); s.coach.tex.dispose(); s.coach.label.geometry.dispose(); s.coach.label.material.dispose(); }
  s.tex.dispose(); s.label.geometry.dispose(); s.label.material.dispose();
  if (s.key === 'tiptoe') tiptoeUntil = gameTime + 1.5; // give your heels time to come down before standing height updates
}

// A ghost coach to your right that loops the station's move, like the sled coach. Poses are
// keyframes in metres: y up, z toward you, x = YOUR right as you look at it (it mirrors you, like a
// fitness video), so its lit knee / chop side / reaching hand match yours. `mirror` flips sides.
const MC_BASE = {
  head: [0, 1.62, 0.02], neck: [0, 1.45, 0], pelvis: [0, 0.95, 0], hipL: [-0.1, 0.95, 0], hipR: [0.1, 0.95, 0],
  kneeL: [-0.1, 0.5, 0.03], kneeR: [0.1, 0.5, 0.03], ankleL: [-0.1, 0.06, 0], ankleR: [0.1, 0.06, 0],
  shL: [-0.19, 1.42, 0], shR: [0.19, 1.42, 0], elL: [-0.22, 1.13, 0.04], elR: [0.22, 1.13, 0.04], haL: [-0.22, 0.86, 0.1], haR: [0.22, 0.86, 0.1],
};
const mcPose = (o) => ({ ...MC_BASE, ...o });
const mcRaise = (pose, dy) => Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, k.startsWith('ankle') ? [v[0], v[1] + dy * 0.7, v[2] - 0.03] : [v[0], v[1] + dy, v[2]]]));
const MC_BONES = [['neck', 'pelvis', 0.06], ['hipL', 'hipR', 0.05], ['hipL', 'kneeL', 0.05], ['kneeL', 'ankleL', 0.045], ['hipR', 'kneeR', 0.05], ['kneeR', 'ankleR', 0.045],
  ['shL', 'shR', 0.04], ['shL', 'elL', 0.04], ['elL', 'haL', 0.035], ['shR', 'elR', 0.04], ['elR', 'haR', 0.035]];
const MC_KNEE_UP = mcPose({ elL: [-0.24, 1.7, 0.08], elR: [0.24, 1.7, 0.08], haL: [-0.25, 1.95, 0.14], haR: [0.25, 1.95, 0.14] });
const MC_KNEE_PULL = mcPose({ // left knee up (mirrored for the right)
  head: [0, 1.52, 0.16], neck: [0, 1.37, 0.1], shL: [-0.19, 1.34, 0.08], shR: [0.19, 1.34, 0.08],
  elL: [-0.28, 1.12, 0.18], elR: [0.28, 1.12, 0.18], haL: [-0.22, 1.02, 0.36], haR: [0.22, 1.02, 0.36],
  kneeL: [-0.1, 0.98, 0.42], ankleL: [-0.1, 0.58, 0.32],
});
const MC_PRESS_HOLD = mcPose({ elL: [-0.24, 1.12, 0.12], elR: [0.24, 1.12, 0.12], haL: [-0.12, 1.22, 0.28], haR: [0.12, 1.22, 0.28] });
const MC_PRESS_SQUAT = mcPose({
  head: [0, 1.24, 0.14], neck: [0, 1.08, 0.07], pelvis: [0, 0.62, -0.2], hipL: [-0.11, 0.62, -0.2], hipR: [0.11, 0.62, -0.2],
  kneeL: [-0.16, 0.5, 0.24], kneeR: [0.16, 0.5, 0.24], shL: [-0.19, 1.05, 0.05], shR: [0.19, 1.05, 0.05],
  elL: [-0.25, 0.84, 0.18], elR: [0.25, 0.84, 0.18], haL: [-0.12, 0.92, 0.36], haR: [0.12, 0.92, 0.36],
});
const MC_PRESS_UP = mcPose({ head: [0, 1.63, -0.01], elL: [-0.21, 1.72, 0.03], elR: [0.21, 1.72, 0.03], haL: [-0.1, 1.98, 0.05], haR: [0.1, 1.98, 0.05] });
const MC_CHOP_HIGH = mcPose({ // wound up by the right shoulder (mirrored for the left); horizontal since v56
  head: [0.02, 1.6, 0.03], shL: [-0.16, 1.42, 0.07], shR: [0.2, 1.42, -0.05],
  elL: [0.02, 1.3, 0.24], elR: [0.36, 1.2, 0.02], haL: [0.36, 1.36, 0.2], haR: [0.44, 1.36, 0.12],
});
const MC_CHOP_LOW = mcPose({ // swung across to the left at chest height, shoulders turned
  head: [-0.02, 1.58, 0.06], shL: [-0.2, 1.41, -0.05], shR: [0.15, 1.41, 0.09],
  elL: [-0.36, 1.18, 0.04], elR: [-0.04, 1.26, 0.26], haL: [-0.46, 1.24, 0.14], haR: [-0.38, 1.25, 0.22],
});
const MC_TOES = mcRaise(mcPose({ elR: [0.21, 1.72, 0.03], haR: [0.15, 1.98, 0.06] }), 0.09); // right hand up (mirrored for the left)
const MOVE_COACH = { // [phase 0..1, pose, caption from here on]
  knee: { cycle: 2.2, prop: 'bar', frames: [[0, MC_KNEE_UP, 'GRAB THE BAR'], [0.3, MC_KNEE_UP], [0.55, MC_KNEE_PULL, 'PULL DOWN + KNEE UP'], [0.75, MC_KNEE_PULL, 'BACK UP TALL'], [1, MC_KNEE_UP]] },
  press: { cycle: 2.6, prop: 'ball', frames: [[0, MC_PRESS_HOLD, 'SQUAT LOW'], [0.12, MC_PRESS_HOLD], [0.4, MC_PRESS_SQUAT], [0.5, MC_PRESS_SQUAT, 'DRIVE UP + PRESS'], [0.7, MC_PRESS_UP], [0.82, MC_PRESS_UP, 'BRING IT DOWN'], [1, MC_PRESS_HOLD]] },
  chop: { cycle: 1.6, prop: 'orb', frames: [[0, MC_CHOP_HIGH, 'HANDS BY YOUR SHOULDER'], [0.3, MC_CHOP_HIGH], [0.5, MC_CHOP_LOW, 'SWING ACROSS THE TREE'], [0.7, MC_CHOP_LOW, 'WIND UP AGAIN'], [1, MC_CHOP_HIGH]] },
  tiptoe: { cycle: 2.0, prop: 'star', frames: [[0, MC_BASE, 'UP ON YOUR TOES'], [0.2, MC_BASE], [0.5, MC_TOES, 'REACH THE STAR'], [0.75, MC_TOES], [1, MC_BASE]] },
};
const mcFlip = (name) => (name.endsWith('L') ? name.slice(0, -1) + 'R' : name.endsWith('R') ? name.slice(0, -1) + 'L' : name);
const mcA = new THREE.Vector3(), mcB = new THREE.Vector3();
function makeMoveCoach(key) {
  const group = new THREE.Group();
  const bones = MC_BONES.map(([a, b, r]) => { const m = new THREE.Mesh(coachLimbGeo, coachMat); group.add(m); return { m, a, b, r }; });
  const headMesh = new THREE.Mesh(coachHeadGeo, coachMat);
  const prop = new THREE.Mesh({ bar: coachLimbGeo, ball: pressBallGeo, orb: chopOrbGeo, star: tipStarGeo }[MOVE_COACH[key].prop], stationMat);
  group.add(headMesh, prop);
  const { lc, tex, label } = burstLabel();
  label.position.set(0, 2.05, 0); label.scale.setScalar(2.2);
  group.add(label);
  group.scale.setScalar(0.85);
  group.visible = false; // shown once its station arrives
  scene.add(group);
  return { group, bones, headMesh, prop, lc, tex, label, text: '', joints: {} };
}
function poseMoveCoach(s, head) {
  const c = s.coach, mv = MOVE_COACH[s.key];
  c.group.position.set(centerX + 0.95, 0, head.z - 3.0);
  c.group.rotation.y = -0.5;
  const mirror = s.key === 'knee' ? kneeLeg === 'right' : s.key === 'chop' ? s.p.side < 0 : s.key === 'tiptoe' ? s.p.next === 0 : false;
  if (s.coachT0 === undefined) s.coachT0 = gameTime;
  const t = s.coachPh != null ? ((s.coachPh % 1) + 1) % 1 : ((gameTime - s.coachT0) % mv.cycle) / mv.cycle; // rounds: on the beat
  const f = mv.frames;
  let i = 0;
  while (i < f.length - 2 && t >= f[i + 1][0]) i++;
  const k = coachEase(Math.min(1, (t - f[i][0]) / Math.max(1e-4, f[i + 1][0] - f[i][0])));
  let caption = '';
  for (const fr of f) if (fr[0] <= t && fr[2]) caption = fr[2];
  const J = c.joints;
  for (const name of Object.keys(MC_BASE)) {
    const src = mirror ? mcFlip(name) : name, a = f[i][1][src], b = f[i + 1][1][src];
    const v = J[name] || (J[name] = new THREE.Vector3());
    v.set((a[0] + (b[0] - a[0]) * k) * (mirror ? -1 : 1), a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
  }
  for (const bn of c.bones) {
    mcA.copy(J[bn.a]); mcB.copy(J[bn.b]);
    const len = Math.max(1e-4, mcA.distanceTo(mcB));
    bn.m.position.addVectors(mcA, mcB).multiplyScalar(0.5);
    mcB.sub(mcA).divideScalar(len);
    bn.m.quaternion.setFromUnitVectors(sledUp, mcB);
    bn.m.scale.set(bn.r, len, bn.r);
  }
  c.headMesh.position.copy(J.head);
  if (mv.prop === 'bar') { // a bar between the hands, a little wider than them
    mcA.copy(J.haL); mcB.copy(J.haR);
    const len = mcA.distanceTo(mcB) + 0.24;
    c.prop.position.addVectors(mcA, mcB).multiplyScalar(0.5);
    c.prop.quaternion.setFromUnitVectors(sledUp, mcB.sub(mcA).normalize());
    c.prop.scale.set(0.022, len, 0.022);
  } else if (mv.prop === 'star') c.prop.position.set(mirror ? -0.15 : 0.15, 2.2, 0.06);
  else c.prop.position.addVectors(J.haL, J.haR).multiplyScalar(0.5).add(mcA.set(0, mv.prop === 'ball' ? 0.08 : 0.02, 0.06));
  if (caption !== c.text) {
    c.text = caption;
    const g = c.lc.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(8,10,18,0.6)'; g.beginPath(); g.roundRect(4, 34, 248, 60, 18); g.fill();
    g.fillStyle = '#9fe6ff'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(caption, 128, 64, 236);
    c.tex.needsUpdate = true;
  }
  c.label.lookAt(camera.getWorldPosition(sledTmp));
}

// ------------------------------------------------------------------ guard & counter

/**
 * A red-hot shot flies at your face: don't punch it, bring both fists up by your chin to block.
 * Block it and a counter orb comes straight in from close range for double points.
 */
const guards = [];
const guardGeo = new THREE.IcosahedronGeometry(0.15, 1);
const guardHaloGeo = new THREE.SphereGeometry(0.24, 18, 12);
// Guard shots use no hand colour (blue/orange mean 'punch with this hand'): a white core with a teal shield glow.
const guardMat = new THREE.MeshStandardMaterial({ color: 0xf2f5ff, emissive: 0xdfe8ff, emissiveIntensity: 0.9, roughness: 0.4, flatShading: true });
const guardHaloMat = new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
const guardIcons = {};
const guardIconFor = (zone) => guardIcons[zone] || (guardIcons[zone] = (() => { // a shield badge floating above the shot: GUARD + where
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(40,6,4,0.75)'; g.beginPath(); g.roundRect(4, 4, 248, 120, 26); g.fill();
  g.strokeStyle = '#ff7a3d'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#ffd9c7'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 40px system-ui, sans-serif'; g.fillText('GUARD', 128, 44);
  g.font = '700 34px system-ui, sans-serif'; g.fillStyle = '#ffffff'; g.fillText(GUARD_ZONES[zone].label, 128, 92);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
})());
// The spot to block: a ring that appears where the shot will land about a second before it does.
const guardRingGeo = new THREE.RingGeometry(0.09, 0.12, 32);
const guardRingMat = new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
let guardSeq = 0;
const guardIconGeo = new THREE.PlaneGeometry(0.34, 0.17);
function spawnGuard(head, standing, { zone = 'high', delay = 0, last = true, first = true, seq = ++guardSeq, names = null } = {}) {
  const z = GUARD_ZONES[zone];
  const speed = difficulty.orbSpeed * 0.9;
  const group = new THREE.Group();
  const core = new THREE.Mesh(guardGeo, guardMat);
  const halo = new THREE.Mesh(guardHaloGeo, guardHaloMat);
  const icon = new THREE.Mesh(guardIconGeo, guardIconFor(zone));
  icon.position.y = 0.33;
  group.add(core, halo, icon);
  group.position.set(centerX + z.dx, standing + z.dy, head.z - SPAWN_DISTANCE - delay * speed);
  scene.add(group);
  const ring = new THREE.Mesh(guardRingGeo, guardRingMat);
  ring.visible = false;
  scene.add(ring);
  guards.push({ group, core, halo, icon, ring, zone, last, first, seq, names, speed, hitZ: head.z - 0.35, announced: false, teach: zone === 'high' && first ? teach('guard') : null });
}
/** One guard shot, or a 1-2 (two zones, GUARD_SEQ_GAP apart); the counter orb comes after the last. */
function spawnGuardSet(head, standing, shots) {
  const pool = guardZonesFor(difficulty.intensity);
  const a = pool[Math.floor(Math.random() * pool.length)];
  const others = pool.filter((k) => k !== a);
  const b = others.length ? others[Math.floor(Math.random() * others.length)] : a;
  const zones = shots === 2 ? [a, b] : [a];
  const names = zones.map((k) => GUARD_ZONES[k].label);
  const seq = ++guardSeq;
  zones.forEach((zone, i) => spawnGuard(head, standing, { zone, delay: i * GUARD_SEQ_GAP, first: i === 0, last: i === zones.length - 1, seq, names }));
}
/** Both fists up by your face, in front of you. */
const guardRel = (f, head) => ({ x: f.world.x - head.x, y: f.world.y - head.y, z: f.world.z - head.z });
function isGuarding(head, xr, zone = 'high') {
  if (SMOKE) return true;
  if (!xr) return keys.has('KeyG'); // desktop: hold G for any guard
  return guardCovers(zone, guardRel(fistByHand.left, head), guardRel(fistByHand.right, head));
}
function updateGuards(dt, xr, head) {
  for (let i = guards.length - 1; i >= 0; i--) {
    const g = guards[i];
    g.group.position.z += g.speed * dt;
    g.core.rotation.x += dt * 5; g.core.rotation.y += dt * 3;
    g.halo.scale.setScalar(1 + 0.15 * Math.sin(gameTime * 18 + i));
    g.icon.lookAt(camera.getWorldPosition(new THREE.Vector3()));
    if (!g.announced && g.group.position.z > head.z - 7) {
      g.announced = true;
      if (g.first) {
        say(g.names.length > 1 ? `Incoming 1-2! GUARD ${g.names.join(' then ')}` : g.zone === 'high' ? 'Incoming! GUARD UP - both fists by your chin' : `Incoming! GUARD ${GUARD_ZONES[g.zone].label}: ${GUARD_ZONES[g.zone].tip}`, 1);
        audio.sfx('alert');
      }
    }
    // About a second out, a ring marks the spot to cover, just in front of you.
    const tta = (g.hitZ - g.group.position.z) / g.speed;
    g.ring.visible = tta < 1.2 && tta > 0;
    if (g.ring.visible) {
      g.ring.position.set(g.group.position.x, g.group.position.y, head.z - 0.6);
      g.ring.scale.setScalar(1 + 0.6 * Math.max(0, tta) / 1.2); // closes in as it arrives
    }
    if (g.group.position.z < g.hitZ) continue;
    const pos = g.group.position.clone();
    if (isGuarding(head, xr, g.zone)) {
      score.blocks++; score.combo++; score.best = Math.max(score.best, score.combo);
      const pts = 15 * (score.inZone() ? 2 : 1);
      score.score += pts;
      say(g.last ? `Blocked! +${pts}  COUNTER!` : `Blocked! +${pts}  next one...`);
      audio.sfx('block');
      pulseBoth(1, 90);
      shatter(pos.add(new THREE.Vector3(0, 0, -0.35)), new THREE.Vector3(0, 0.4, -1), 0x4fd1c5, 0.5); // burst away from your face
      if (g.last) spawnCounter(head, standing);
      attribution.record('guard', gameTime); // only reps you actually did teach the model
    } else {
      score.guardsMissed++; score.combo = 0;
      say(`Guard ${GUARD_ZONES[g.zone].label.toLowerCase()}: ${GUARD_ZONES[g.zone].tip}`, 1);
      audio.sfx('wall');
      pulseBoth(1, 160);
      hitFlash = 1;
    }
    scene.remove(g.group, g.ring);
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
  // Above the zone: the cage breathes (4 s in, 6 s out) and the scoreboard leads your breathing.
  const pace = running && r.state === 'overheat' && controller.phase === Phase.Training;
  if (pace) { if (breathFrom == null) breathFrom = gameTime; } else breathFrom = null;
  const b = pace ? breathAt(gameTime - breathFrom) : null;
  breathCue = b ? b.phase : null;
  r.cage.scale.setScalar(b ? 1 + 0.5 * b.fill : 1);
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
    const word = { zone: `REACTOR ${pct}%`, overheat: 'OVERHEATING', stalled: 'REACTOR WAITING', idle: 'REACTOR' }[r.state];
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
let breathFrom = null, breathCue = null; // paced breathing while above the zone
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
const railZone = new THREE.Color(0xff7a1f);
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
  railMat.emissive.copy(world.railGlow).lerp(railZone, zoneAmt);
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
    group, body, cord, mat, label, lc, tex, station, startZ: head.z - 10, age: 0, duration: 4 + 1 * (1 - difficulty.intensity),
    hits: 0, armed: { left: true, right: true }, off: new THREE.Vector3(), offV: new THREE.Vector3(), labelKey: '', smokeT: 0,
  };
  say('SPEED BAG! Hit it fast!', 1);
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
function disposeBag() {
  scene.remove(bag.group);
  bag.mat.dispose(); bag.tex.dispose();
  for (const m of [bag.cord, bag.label]) if (m) { m.geometry.dispose(); if (m !== bag.cord) m.material.dispose(); }
  bag = null;
}
function endBag() {
  const pts = bagPoints(bag.hits) * (score.inZone() ? 2 : 1);
  score.score += pts;
  if (bag.hits >= 8) { score.hits++; score.combo++; score.best = Math.max(score.best, score.combo); }
  say(`Speed bag: ${bag.hits} hits  +${pts}`);
  audio.sfx(bag.hits >= 15 ? 'perfect' : 'hit', { hand: 'right', power: 1 });
  bag.body.getWorldPosition(bagCenter);
  shatter(bagCenter, new THREE.Vector3(0, 0.3, -1), 0xff5a6e, 1);
  disposeBag();
  bagReadyAt = gameTime + 20;
}

// ------------------------------------------------------------------ heavy bag (a burst: hooks, uppercuts, power)

/**
 * A big hanging bag for 6 s. A glowing patch shows where to hit next (left hook on its left side,
 * right hook on its right, uppercut low at the front, power straight at the front) in the colour of
 * the hand to use. Any hard punch scores; hitting the lit patch with the right hand doubles it.
 */
let heavy = null, heavyReadyAt = 0;
const heavyGeo = new THREE.CapsuleGeometry(0.2, 0.55, 6, 18);
const heavyPatchGeo = new THREE.CircleGeometry(0.1, 24);
const HEAVY_ARRIVE = 1.0;
const HEAVY_TELEGRAPH = 0.3; // seconds a new target flashes before it settles
const HEAVY_PATCH = {
  hookL: { pos: [-0.145, 0.05, 0.145], rot: [0, -Math.PI / 4, 0] },  // front-left corner, so you can see it
  hookR: { pos: [0.145, 0.05, 0.145], rot: [0, Math.PI / 4, 0] },
  upper: { pos: [0, -0.374, 0.181], rot: [0.5, 0, 0] }, // on the lower curve, facing down and out
  straight: { pos: [0, 0.08, 0.205], rot: [0, 0, 0] },
};
function burstLabel() {
  const lc = document.createElement('canvas'); lc.width = 256; lc.height = 128;
  const tex = new THREE.CanvasTexture(lc); tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  return { lc, tex, label };
}
function drawBurstLabel(b, big, small, frac, color) {
  const secs = Math.ceil(frac * (b.duration || 0));
  const key = `${big}|${small}|${Math.ceil(frac * 20)}|${secs}`;
  if (key === b.labelKey) return;
  b.labelKey = key;
  const g = b.lc.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(8,10,18,0.7)'; g.beginPath(); g.roundRect(4, 4, 248, 120, 22); g.fill();
  g.fillStyle = '#ffffff'; g.font = '700 56px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(big), 128, 46);
  g.font = '600 22px system-ui, sans-serif'; g.fillStyle = color; g.fillText(small, 128, 84, 230);
  g.fillStyle = '#262a38'; g.fillRect(28, 104, 200, 10);
  g.fillStyle = color; g.fillRect(28, 104, 200 * Math.max(0, frac), 10);
  if (b.duration) { g.fillStyle = '#c9ced8'; g.font = '600 20px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`${secs}s`, 236, 22); } // time left in this burst
  b.tex.needsUpdate = true;
}
function spawnHeavy(head, standing) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a2b2b, emissive: 0x5a1a1a, emissiveIntensity: 0.3, roughness: 0.7 });
  const body = new THREE.Mesh(heavyGeo, mat);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.8, 6), MAT.guide);
  chain.position.y = 0.88;
  const patchMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const patch = new THREE.Mesh(heavyPatchGeo, patchMat);
  body.add(patch);
  const { lc, tex, label } = burstLabel();
  label.position.set(0.62, 0.3, -0.3); label.scale.setScalar(1.3); // beside the bag, clear of the scoreboard
  group.add(body, chain, label);
  const station = new THREE.Vector3(centerX, standing - 0.25, head.z - 0.78); // 20 cm higher in v56 so the uppercut spot is in view
  group.position.set(station.x, station.y, head.z - 10);
  scene.add(group);
  heavy = {
    group, body, chain, mat, patch, patchMat, lc, tex, label, station, startZ: head.z - 10, age: 0, duration: 6,
    hits: 0, onTarget: 0, points: 0, armed: { left: true, right: true }, off: new THREE.Vector3(), offV: new THREE.Vector3(),
    target: null, targetHand: 'left', targetAge: 0, smokeT: 0, labelKey: '',
  };
  nextHeavyTarget();
  say('HEAVY BAG! Hooks and uppercuts - hit the lit spot hard', 1);
  audio.sfx('burst');
  pulseBoth(0.4, 60);
}
let heavyAlt = 'right';
function nextHeavyTarget() {
  const prev = heavy.target?.key;
  const pool = HEAVY_TARGETS.filter((t) => t.key !== prev);
  const t = pool[Math.floor(Math.random() * pool.length)];
  heavyAlt = heavyAlt === 'left' ? 'right' : 'left';
  heavy.target = t;
  heavy.targetHand = t.hand || heavyAlt;
  heavy.targetAge = 0;
  const p = HEAVY_PATCH[t.key];
  heavy.patch.position.set(...p.pos);
  heavy.patch.rotation.set(...p.rot);
  heavy.patchMat.color.set(0xffffff); // telegraph: flashes white and big, then shrinks onto the spot in the hand's colour
  heavy.patch.scale.setScalar(1.8);
}
const heavyTmp = new THREE.Vector3(), heavyPatchW = new THREE.Vector3();
function heavyHit(hand, fist, power, onTarget) {
  heavy.hits++;
  const pts = heavyPoints(power, onTarget) * (score.inZone() ? 2 : 1);
  heavy.points += pts;
  const push = fist && fist.vel.lengthSq() > 0.01 ? fist.vel.clone().normalize() : new THREE.Vector3(0, 0, -1);
  heavy.offV.addScaledVector(push, 0.6 + 1.2 * power);
  heavy.mat.emissiveIntensity = 0.9;
  pulse(fist, 0.4 + 0.6 * power, 40);
  audio.sfx('hit', { hand, power: Math.max(power, onTarget ? 0.7 : power) });
  if (power >= 0.3 || settings.gameType === 'touch') attribution.record('heavy', gameTime);
  if (onTarget) {
    heavy.onTarget++;
    heavy.patch.getWorldPosition(heavyPatchW);
    popText(`${heavy.target.label}! +${pts}`, heavyPatchW, '#ffffff');
    nextHeavyTarget();
  }
}
function updateHeavy(dt, xr) {
  const h = heavy;
  h.age += dt;
  const k = Math.min(1, h.age / HEAVY_ARRIVE);
  h.group.position.z = h.startZ + (h.station.z - h.startZ) * (1 - (1 - k) ** 3);
  h.offV.addScaledVector(h.off, -90 * dt).multiplyScalar(Math.exp(-5 * dt)); // heavier, slower swing than the speed bag
  h.off.addScaledVector(h.offV, dt);
  h.body.position.copy(h.off);
  h.body.rotation.set(h.off.z * 1.2, 0, -h.off.x * 1.2);
  h.mat.emissiveIntensity += (0.3 - h.mat.emissiveIntensity) * Math.min(1, dt * 6);
  h.patchMat.opacity = 0.55 + 0.4 * Math.abs(Math.sin(h.age * 6));
  if (h.target) { // new target: 0.3 s white flash that closes in, so you can load the punch before it settles
    const tele = Math.min(1, h.targetAge / HEAVY_TELEGRAPH);
    h.patch.scale.setScalar(1 + 0.8 * (1 - tele) * (1 - tele));
    if (tele >= 1 && !h.colored) { h.patchMat.color.set(HAND_COLOR[h.targetHand]); h.colored = true; }
    if (tele < 1) h.colored = false;
  }
  h.label.lookAt(camera.getWorldPosition(heavyTmp));
  if (h.age >= HEAVY_ARRIVE) {
    h.targetAge += dt;
    if (h.targetAge > 1.8) nextHeavyTarget();          // missed it: move on so it never gets stale
    h.body.getWorldPosition(bagCenter);
    h.patch.getWorldPosition(heavyPatchW);
    if (xr) {
      for (const f of fists) {
        const dx = f.world.x - bagCenter.x, dz = f.world.z - bagCenter.z;
        const dy = Math.max(0, Math.abs(f.world.y - bagCenter.y) - 0.275);
        const dist = Math.hypot(dx, dy, dz);
        const reach = 0.2 + FIST_R + 0.04;
        const hard = settings.gameType === 'touch' || f.speed > 1.5;
        if (h.armed[f.hand] && dist < reach && hard) {
          h.armed[f.hand] = false;
          const travel = fistDisplacement(f, 0.15).length();
          const power = settings.gameType === 'touch' ? 0.5 : punchPower(f.speed, travel);
          const onTarget = f.hand === h.targetHand && f.world.distanceTo(heavyPatchW) < 0.18;
          heavyHit(f.hand, f, power, onTarget);
        } else if (dist > reach + 0.08) h.armed[f.hand] = true;
      }
    }
    if (SMOKE) { h.smokeT += dt; while (h.smokeT > 0.45) { h.smokeT -= 0.45; heavyHit(h.targetHand, null, 0.7, true); } }
  }
  const left = Math.max(0, h.duration - Math.max(0, h.age - HEAVY_ARRIVE));
  drawBurstLabel(h, h.hits, h.target ? h.target.label : '', left / h.duration, h.target ? `#${HAND_COLOR[h.targetHand].toString(16).padStart(6, '0')}` : '#ffffff');
  if (h.age >= HEAVY_ARRIVE + h.duration) endHeavy(true);
}
function endHeavy(award) {
  const h = heavy;
  if (award) {
    score.score += h.points;
    if (h.hits >= 6) { score.hits++; score.combo++; score.best = Math.max(score.best, score.combo); }
    say(`Heavy bag: ${h.hits} hits, ${h.onTarget} on target  +${h.points}`);
    audio.sfx(h.onTarget >= 5 ? 'perfect' : 'hit', { hand: 'right', power: 1 });
    h.body.getWorldPosition(bagCenter);
    shatter(bagCenter, new THREE.Vector3(0, 0.3, -1), 0xc24a4a, 1);
  }
  scene.remove(h.group);
  h.mat.dispose(); h.patchMat.dispose(); h.tex.dispose();
  h.chain.geometry.dispose(); h.label.geometry.dispose(); h.label.material.dispose();
  heavy = null;
  heavyReadyAt = gameTime + 25;
}

// ------------------------------------------------------------------ sled run (a burst: tuck low, double-pole)

/**
 * 8 s of a downhill sled/ski run. Each rep: stand tall with both arms up, then squat (head 15+ cm
 * lower) while pushing both poles down together (both fists moving down fast within 0.35 s).
 * You hold a ski-pole grip in each hand; the poles run down to baskets in the snow.
 */
let sled = null, sledReadyAt = 0;
const SLED_ARRIVE = 1.0;
const sledGripGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.13, 10);
const sledShaftGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 8);
const sledBasketGeo = new THREE.TorusGeometry(0.05, 0.008, 6, 16);
const sledGripMat = new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.6 });
const sledShaftMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ff, emissive: 0x8fa3c8, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.6 });
const sledUp = new THREE.Vector3(0, 1, 0), sledDir = new THREE.Vector3(), sledEnd = new THREE.Vector3();
// Your skis, on the snow under your feet, so you can see where you're standing.
const skiGeo = new THREE.BoxGeometry(0.085, 0.02, 1.5);
const skiTipGeo = new THREE.BoxGeometry(0.085, 0.02, 0.16);
const skiBindGeo = new THREE.BoxGeometry(0.1, 0.05, 0.16);
const skiMat = new THREE.MeshStandardMaterial({ color: 0xff5a36, emissive: 0xff5a36, emissiveIntensity: 0.45, roughness: 0.4 });
const skiBindMat = new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.6 });
function makeSkis(mat = skiMat, bindMat = skiBindMat) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const ski = new THREE.Mesh(skiGeo, mat); ski.position.set(sx * 0.11, 0.02, -0.25);
    const tip = new THREE.Mesh(skiTipGeo, mat); tip.position.set(sx * 0.11, 0.058, -1.07); tip.rotation.x = 0.5; // turned-up tip
    const bind = new THREE.Mesh(skiBindGeo, bindMat); bind.position.set(sx * 0.11, 0.045, 0);
    g.add(ski, tip, bind);
  }
  return g;
}
// A ghost coach on the snow ahead, looping the rep so you can copy it: stand tall with arms up,
// then squat and drive both poles down and back past your hips, then rise again.
const coachMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.6, depthWrite: false });
const coachLimbGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const coachHeadGeo = new THREE.SphereGeometry(0.11, 14, 10);
const COACH_CYCLE = 2.0; // seconds per rep
const COACH_POSE = { // metres; y up, z = the way the coach faces, x for its right side (left is mirrored)
  tall: { head: [0, 1.62, 0.02], neck: [0, 1.45, 0], hip: [0, 0.95, 0], knee: [0.1, 0.5, 0.03], ankle: [0.1, 0.06, 0], shoulder: [0.19, 1.42, 0], elbow: [0.22, 1.36, 0.24], hand: [0.22, 1.5, 0.4] },
  squat: { head: [0, 1.3, 0.26], neck: [0, 1.15, 0.16], hip: [0, 0.7, -0.2], knee: [0.1, 0.45, 0.2], ankle: [0.1, 0.06, 0], shoulder: [0.19, 1.12, 0.14], elbow: [0.22, 0.86, -0.02], hand: [0.22, 0.66, -0.32] },
};
const COACH_BONES = [['neck', 'hip', 0.06, false], ['hip', 'knee', 0.05, true], ['knee', 'ankle', 0.045, true],
  ['shoulder', 'elbow', 0.04, true], ['elbow', 'hand', 0.035, true], ['hand', 'pole', 0.012, true], ['shoulder', 'neck', 0.04, true]];
const coachA = new THREE.Vector3(), coachB = new THREE.Vector3();
function coachJoint(name, side, s, out) {
  if (name === 'pole') return out.set(0.25 * side, 0.02, 0.12); // pole tips stay planted by your feet
  const a = COACH_POSE.tall[name], b = COACH_POSE.squat[name];
  return out.set((a[0] + (b[0] - a[0]) * s) * side, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s);
}
function makeCoach() {
  const group = new THREE.Group();
  const bones = [];
  for (const [a, b, r, both] of COACH_BONES) for (const side of both ? [-1, 1] : [1]) {
    const m = new THREE.Mesh(coachLimbGeo, coachMat);
    group.add(m);
    bones.push({ m, a, b, r, side });
  }
  const headMesh = new THREE.Mesh(coachHeadGeo, coachMat);
  group.add(headMesh, makeSkis(coachMat, coachMat));
  const { lc, tex, label } = burstLabel();
  label.position.set(0, 2.05, 0); label.scale.setScalar(2.2);
  group.add(label);
  return { group, bones, headMesh, lc, tex, label, text: '' };
}
const coachEase = (x) => x * x * (3 - 2 * x);
function poseCoach(c, t) {
  const p = (t % COACH_CYCLE) / COACH_CYCLE;
  const s = p < 0.3 ? 0 : p < 0.55 ? coachEase((p - 0.3) / 0.25) : p < 0.7 ? 1 : 1 - coachEase((p - 0.7) / 0.3); // 0 tall .. 1 squat
  for (const bn of c.bones) {
    coachJoint(bn.a, bn.side, s, coachA); coachJoint(bn.b, bn.side, s, coachB);
    const len = Math.max(1e-4, coachA.distanceTo(coachB));
    bn.m.position.addVectors(coachA, coachB).multiplyScalar(0.5);
    coachB.sub(coachA).divideScalar(len);
    bn.m.quaternion.setFromUnitVectors(sledUp, coachB);
    bn.m.scale.set(bn.r, len, bn.r);
  }
  coachJoint('head', 1, s, c.headMesh.position);
  const text = p < 0.3 ? 'STAND TALL' : p < 0.7 ? 'SQUAT + PUSH BACK' : 'RISE, ARMS UP';
  if (text !== c.text) {
    c.text = text;
    const g = c.lc.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(8,10,18,0.6)'; g.beginPath(); g.roundRect(4, 34, 248, 60, 18); g.fill();
    g.fillStyle = '#9fe6ff'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 64, 236);
    c.tex.needsUpdate = true;
  }
  c.label.lookAt(camera.getWorldPosition(sledTmp));
}
function spawnSled(head, standing) {
  const poleMat = new THREE.LineBasicMaterial({ color: 0xdfe8ff }); // kept for disposal symmetry
  const poles = [0, 1].map(() => { // grip in your hand, a shaft down to a basket in the snow
    const g = new THREE.Group();
    const grip = new THREE.Mesh(sledGripGeo, sledGripMat);
    const shaft = new THREE.Mesh(sledShaftGeo, sledShaftMat);
    const basket = new THREE.Mesh(sledBasketGeo, sledShaftMat);
    g.add(grip, shaft, basket);
    g.frustumCulled = false;
    scene.add(g);
    return { g, grip, shaft, basket };
  });
  const snowMat = new THREE.MeshBasicMaterial({ color: 0xeaf2ff, transparent: true, opacity: 0, depthWrite: false });
  const snow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 30), snowMat);
  snow.rotation.x = -Math.PI / 2;
  snow.position.set(centerX, 0.015, head.z - 14);
  scene.add(snow);
  const skis = makeSkis();
  skis.position.set(head.x, 0, head.z);
  const coach = makeCoach(); // off to your right, turned so you see its arms drive back
  coach.group.position.set(centerX + 0.95, 0, head.z - 3.0); coach.group.rotation.y = -0.9; coach.group.scale.setScalar(0.85);
  scene.add(skis, coach.group);
  const { lc, tex, label } = burstLabel();
  label.position.set(centerX, standing - 0.55, head.z - 2.2); label.scale.setScalar(1.8); // below the scoreboard
  scene.add(label);
  sled = {
    poles, poleMat, snow, snowMat, skis, coach, lc, tex, label, age: 0, duration: 8, strokes: 0, tuckTime: 0, points: 0,
    down: { left: null, right: null }, armed: { left: true, right: true }, smokeT: 0, labelKey: '', tucked: false, ready: false,
  };
  say('SLED RUN! Copy the coach: stand tall, arms up... then squat and push both poles down and back', 1);
  audio.sfx('burst');
  pulseBoth(0.4, 60);
}
const sledTmp = new THREE.Vector3();
function sledStroke(fist) {
  const pts = 9 * (score.inZone() ? 2 : 1); // a full rep: stand tall, then squat and push
  sled.ready = false;
  sled.strokes++;
  sled.points += pts;
  sled.down.left = sled.down.right = null;
  attribution.record('sled', gameTime);
  audio.sfx('dodge');
  pulseBoth(0.5, 50);
  if (fist) popText(`PUSH! +${pts}`, fist.world, '#dfe8ff');
}
function updateSled(dt, xr, head, standing) {
  const s = sled;
  s.age += dt;
  s.snowMat.opacity = 0.35 * Math.min(1, s.age / SLED_ARRIVE);
  s.snow.position.z = head.z - 14;
  s.skis.position.set(head.x, 0, head.z); // under your feet
  poseCoach(s.coach, s.age);
  s.tucked = SMOKE ? true : sledTucked(head.y, standing);
  for (const [i, f] of fists.entries()) { // grip at your fist, shaft down and a little back to the basket in the snow
    const p = s.poles[i];
    sledEnd.set(f.world.x + (f.hand === 'left' ? -0.05 : 0.05), 0.04, f.world.z + 0.25);
    sledDir.subVectors(sledEnd, f.world);
    const len = Math.max(0.2, sledDir.length());
    sledDir.divideScalar(len);
    p.grip.position.copy(f.world); p.grip.quaternion.setFromUnitVectors(sledUp, sledDir);
    p.shaft.position.copy(f.world).addScaledVector(sledDir, len / 2); p.shaft.quaternion.copy(p.grip.quaternion); p.shaft.scale.set(1, len, 1);
    p.basket.position.copy(sledEnd).addScaledVector(sledDir, -0.08); p.basket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sledDir);
  }
  if (s.age >= SLED_ARRIVE) {
    if (s.tucked) s.tuckTime += dt;
    // Ready for the next rep once you're standing tall with both arms up.
    const tall = head.y > standing - 0.08;
    if (xr && tall && fists.every((f) => f.world.y > head.y - 0.35)) s.ready = true;
    if (!xr && tall) s.ready = true; // desktop: let go of C to stand, then hold C and click
    if (xr) {
      const need = settings.gameType === 'touch' ? 0.6 : 1.0;
      for (const f of fists) {
        if (f.world.y > head.y - 0.35) s.armed[f.hand] = true;                  // raised: ready for the next push
        if (s.armed[f.hand] && f.vel.y < -need && f.world.y < head.y - 0.45) {  // pushed down past the waist
          s.armed[f.hand] = false;
          s.down[f.hand] = gameTime;
        }
      }
      if (s.down.left != null && s.down.right != null && Math.abs(s.down.left - s.down.right) <= 0.35) {
        if (s.ready && s.tucked) sledStroke(fists[1]);           // stood tall, then squatted as you pushed: a rep
        else { s.down.left = s.down.right = null; say(s.ready ? 'Squat as you push!' : 'Stand tall, arms up first', 2); }
      }
      for (const hnd of ['left', 'right']) if (s.down[hnd] != null && gameTime - s.down[hnd] > 0.35) s.down[hnd] = null;
    }
    if (SMOKE) { s.smokeT += dt; while (s.smokeT > 0.6) { s.smokeT -= 0.6; sledStroke(null); } }
  }
  s.label.lookAt(camera.getWorldPosition(sledTmp));
  const left = Math.max(0, s.duration - Math.max(0, s.age - SLED_ARRIVE));
  drawBurstLabel(s, s.strokes, s.ready ? 'SQUAT + PUSH BACK!' : 'STAND TALL, ARMS UP', left / s.duration, s.ready ? '#7cffb0' : '#dfe8ff');
  if (s.age >= SLED_ARRIVE + s.duration) endSled(true);
}
function endSled(award) {
  const s = sled;
  if (award) {
    const pts = Math.round(s.points);
    score.score += pts;
    if (s.strokes >= 6) { score.hits++; score.combo++; score.best = Math.max(score.best, score.combo); }
    say(`Sled run: ${s.strokes} reps  +${pts}`);
    audio.sfx(s.strokes >= 10 ? 'perfect' : 'hit', { hand: 'left', power: 0.9 });
  }
  for (const p of s.poles) scene.remove(p.g);
  scene.remove(s.snow, s.label, s.skis, s.coach.group);
  s.coach.tex.dispose(); s.coach.label.geometry.dispose(); s.coach.label.material.dispose();
  s.poleMat.dispose(); s.snowMat.dispose(); s.tex.dispose();
  s.snow.geometry.dispose(); s.label.geometry.dispose(); s.label.material.dispose();
  sled = null;
  sledReadyAt = gameTime + 30;
}

// ------------------------------------------------------------------ dodge barrage (core: bombs aimed at your head)

const bombs = [];
let barrageSeq = 0;
// Homing missiles: a grey body with a hazard-yellow nose and fins, and a flame out the back.
// Built pointing +z (toward you); each frame it turns to face the way it's flying.
const missileBodyGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.34, 14).rotateX(Math.PI / 2);
const missileNoseGeo = new THREE.ConeGeometry(0.055, 0.15, 14).rotateX(Math.PI / 2).translate(0, 0, 0.245);
const missileFinGeo = new THREE.BoxGeometry(0.008, 0.07, 0.1).translate(0, 0.085, -0.12);
const missileFlameGeo = new THREE.ConeGeometry(0.045, 0.24, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.29);
const missileBodyMat = new THREE.MeshStandardMaterial({ color: 0xc9ced8, emissive: 0x30343c, roughness: 0.35, metalness: 0.5 });
// Hazard yellow: nothing you punch uses it (hands blue/orange, guard white/teal, walls purple).
const bombMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xd8ff1a, emissiveIntensity: 0.7, roughness: 0.5 });
const missileFlameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const bombHaloMat = new THREE.MeshBasicMaterial({ color: 0xd8ff1a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
const bombHaloGeo = new THREE.SphereGeometry(0.095, 14, 10).translate(0, 0, 0.22); // a glow round the nose, so you see one coming head-on
const missilePrev = new THREE.Vector3(), missileVel = new THREE.Vector3(), missileAim = new THREE.Vector3();
function makeBomb() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(missileBodyGeo, missileBodyMat), new THREE.Mesh(missileNoseGeo, bombMat), new THREE.Mesh(bombHaloGeo, bombHaloMat));
  for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(missileFinGeo, bombMat); f.rotation.z = (k * Math.PI) / 2; g.add(f); }
  const flame = new THREE.Mesh(missileFlameGeo, missileFlameMat);
  g.add(flame);
  g.userData.flame = flame;
  return g;
}
/** Send a barrage (one lane slot): bombs aimed close to where your head is. False if the lane is busy. */
function spawnBarrage(head, standing) {
  const { n, gap } = barrageShape(difficulty.intensity);
  const speed = difficulty.orbSpeed * 0.9;
  const first = gameTime + SPAWN_DISTANCE / speed;
  const plan = barragePlan(first, n, gap);
  if (!laneFree(lane, plan)) return false;
  lane.push(plan);
  const id = ++barrageSeq;
  const offsets = [-0.12, -0.06, 0, 0.06, 0.12];
  const volleys = barrageVolleys(n); // v56: rows to duck under and pairs that pick your side, so you weave
  const weave = volleys.includes('L') || volleys.includes('R');
  for (let i = 0; i < n; i++) {
    const v = volleys[i], single = v === 'S';
    const jitter = single ? offsets[Math.floor(Math.random() * offsets.length)] : 0;
    const oy = single ? Math.random() * 0.12 - 0.08 : 0.01; // rows and pairs at eye height: go under or aside
    const [bx, by] = BOMB_STARTS[Math.floor(Math.random() * BOMB_STARTS.length)];
    for (const dx of BOMB_VOLLEY[v]) {
      // Singles start off to one side (or above / below) and curve in; rows and pairs fan in from above.
      const sx = single ? bx : dx, sy = single ? by : 0.5;
      const g = makeBomb();
      const x = head.x + jitter + dx;
      g.position.set(x + sx, head.y + oy + sy, head.z - SPAWN_DISTANCE - gap * i * speed);
      scene.add(g);
      const t0 = (head.z - g.position.z) / speed;
      bombs.push({ group: g, speed, passed: false, id, ox: x - head.x, oy, sx, sy, t0, row: !single, lead: dx === 0 });
    }
  }
  say(weave ? 'DUCK AND WEAVE! Lean away, duck under the row, come up the other side' : 'MISSILES! Lean or duck out of the way', 1);
  return true;
}
const BOMB_LOCK = 0.7; // seconds before arrival when a bomb stops following your head
const BOMB_STARTS = [[-1.3, 0.1], [1.3, 0.1], [0, 0.9], [-0.9, -0.55], [0.9, -0.55], [0, 0]]; // left, right, above, low-left, low-right, straight
function updateBombs(dt, head) {
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    missilePrev.copy(b.group.position);
    b.group.position.z += b.speed * dt;
    // Aimed at your head: each bomb follows you until it's 0.7 s out, then locks, so you dodge by moving.
    if (!b.passed && !b.locked && (head.z - b.group.position.z) / b.speed > BOMB_LOCK) {
      const k = Math.min(1, dt * 6);
      const tta = (head.z - b.group.position.z) / b.speed;
      const far = Math.max(0, Math.min(1, (tta - BOMB_LOCK) / Math.max(0.1, b.t0 - BOMB_LOCK))) ** 1.5; // 1 at launch, 0 at lock
      const lim = b.row ? 0.75 : 0.4; // rows and pairs keep their spread
      const tx = Math.max(centerX - lim, Math.min(centerX + lim, head.x + b.ox)) + b.sx * far;
      const ty = Math.max(0.7, head.y + b.oy) + b.sy * far;
      b.group.position.x += (tx - b.group.position.x) * k;
      b.group.position.y += (ty - b.group.position.y) * k;
    } else if (!b.passed && !b.locked) {
      b.locked = true; // stops following you now: whistle from its side so you know to move
      if (!b.row || b.lead) audio.sfx('incoming', { pan: b.row ? 0 : (b.group.position.x - head.x) / 0.12 }); // one whistle per row; singles pan full left/right
    }
    // Nose the way it's flying, a slow roll, and a flickering flame.
    missileVel.subVectors(b.group.position, missilePrev);
    if (missileVel.lengthSq() > 1e-10) b.group.lookAt(missileAim.copy(b.group.position).add(missileVel));
    b.roll = (b.roll || 0) + dt * 5;
    b.group.rotateZ(b.roll);
    const fl = 0.8 + Math.random() * 0.4;
    b.group.userData.flame.scale.set(fl, fl, 1);
    if (!b.passed && b.group.position.z >= head.z) {
      b.passed = true;
      const p = b.group.position;
      if (bombHits(head.x - p.x, head.y - p.y)) {
        score.bombHit();
        say('Hit! Keep your head moving', 1);
        audio.sfx('wall');
        pulseBoth(1, 120);
        hitFlash = 1;
      } else {
        score.bombDodge();
        audio.sfx('dodge');
        attribution.record('barrage', gameTime);
      }
    }
    if (b.group.position.z > head.z + 1.5) { scene.remove(b.group); bombs.splice(i, 1); }
  }
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
      hand, mesh, mat, hist: [], pump: 0, lastY: null, sparkT: 0, crest: new THREE.Vector3(),
      handle: new THREE.Vector3(centerX + sx * 0.22, standing - 0.72, head.z - 0.42),
      anchor: new THREE.Vector3(centerX + sx * 0.45, 0.75, head.z - 6.5),
    };
  });
  const { lc, tex, label } = burstLabel(); // the intensity meter, below the scoreboard
  label.position.set(centerX, standing - 0.55, head.z - 2.2); label.scale.setScalar(1.8);
  scene.add(label);
  ropes = {
    sides, age: 0, duration: 6, onTime: 0, credited: 0, points: 0, lowTime: 0, hardTime: 0, tip: '', dummy: new THREE.Object3D(),
    lc, tex, label, labelKey: '', tier: 0, tierAt: -9,
  };
  say('BATTLE ROPES! Pump both arms, stay low!', 1);
  audio.sfx('burst');
  pulseBoth(0.4, 60);
}
const ROPE_SPARK_DIR = new THREE.Vector3(0, 1, 0.3).normalize();
const ROPE_METER_TOP = 2.8; // pump speed (m/s) at the right end of the meter
function drawRopeMeter(r, level, tier, secs) {
  const key = `${tier}|${Math.round(level * 5)}|${secs}`;
  if (key === r.labelKey) return;
  r.labelKey = key;
  const g = r.lc.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(8,10,18,0.7)'; g.beginPath(); g.roundRect(4, 4, 248, 120, 22); g.fill();
  const col = ['#8d95a5', '#7cffb0', '#ffb36b', '#ffd34d'][tier];
  g.fillStyle = col; g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(['PUMP!', 'GOOD', 'HARD x1.5', 'MAX x2'][tier], 120, 50, 200);
  const x0 = 28, w = 200, y0 = 88; // the meter, with a tick where GOOD, HARD and MAX start
  g.fillStyle = '#262a38'; g.fillRect(x0, y0, w, 18);
  g.fillStyle = col; g.fillRect(x0, y0, w * Math.min(1, level / ROPE_METER_TOP), 18);
  g.fillStyle = '#ffffff';
  for (const m of [ROPE_PUMP_SPEED, ROPE_HARD, ROPE_MAX]) g.fillRect(x0 + w * (m / ROPE_METER_TOP) - 1, y0 - 4, 3, 26);
  g.fillStyle = '#c9ced8'; g.font = '600 18px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`${secs}s`, 242, 20);
  r.tex.needsUpdate = true;
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
      if (i === 12) s.crest.copy(base); // where the wave is biggest: sparks fly from here
      ropes.dummy.position.copy(base);
      ropes.dummy.scale.setScalar(shown ? 1 : 0.001);
      ropes.dummy.updateMatrix();
      s.mesh.setMatrixAt(i, ropes.dummy.matrix);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
    const st = active ? ropeTier(s.pump) : 0;
    s.mat.emissiveIntensity = [0.4, 1.0, 1.5, 2.2][st];
    s.mat.emissive.set(st === 3 ? 0xffd34d : HAND_COLOR[s.hand]); // goes gold at max
    if (st >= 2) { // sparks fly off the rope when you go hard - twice as many, and gold, at max
      s.sparkT -= dt;
      if (s.sparkT <= 0) { s.sparkT = st === 3 ? 0.1 : 0.2; shatter(s.crest, ROPE_SPARK_DIR, st === 3 ? 0xffd34d : HAND_COLOR[s.hand], 0.05); }
    }
  }
  const level = Math.min(...ropes.sides.map((s) => s.pump)); // your slower arm sets the pace
  const tier = active ? ropeTier(level) : 0;
  drawRopeMeter(ropes, active ? level : 0, tier, Math.ceil(Math.max(0, ROPES_ARRIVE + ropes.duration - t)));
  ropes.label.lookAt(camera.getWorldPosition(sledTmp));
  if (active) {
    const low = head.y < standing - 0.12 || SMOKE;
    if (bothOn) {
      ropes.onTime += dt;
      if (low) ropes.lowTime += dt;
      ropes.points += dt * 10 * (low ? 1.5 : 1) * ROPE_TIER_MULT[tier];
      if (tier >= 2) ropes.hardTime += dt;
      if (xr && Math.random() < 0.25) pulseBoth(0.2, 15);
    }
    if (tier >= 2 && tier > ropes.tier && gameTime - ropes.tierAt > 1.2) { // stepped up: a reward
      ropes.tierAt = gameTime;
      popText(tier === 3 ? 'MAX POWER! x2' : 'HARDER! x1.5', ropes.label.position.clone().setY(ropes.label.position.y + 0.25), tier === 3 ? '#ffd34d' : '#7cffb0');
      audio.sfx(tier === 3 ? 'perfect' : 'hit', { hand: 'left', power: 0.7 });
      pulseBoth(0.6, 60);
    }
    ropes.tier = tier;
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
    say(`Battle ropes ${pct}%${ropes.hardTime >= 1 ? ` · ${Math.round(ropes.hardTime)} s hard` : ''}  +${pts}`);
    audio.sfx(pct >= 70 ? 'perfect' : 'hit', { hand: 'left', power: 0.8 });
  }
  for (const s of ropes.sides) { scene.remove(s.mesh); s.mesh.dispose(); s.mat.dispose(); }
  scene.remove(ropes.label); ropes.tex.dispose(); ropes.label.geometry.dispose(); ropes.label.material.dispose();
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
  // Only counts if your hand actually followed it (moved 10 cm+), not if it just sat where the rope passed.
  const moved = t.strands.some((r) => r.box && Math.max(r.box.x1 - r.box.x0, r.box.y1 - r.box.y0) >= 0.1);
  const frac = !moved ? 0 : t.totalTime > 0 ? t.strands.reduce((sum, r) => sum + r.onTime, 0) / t.strands.length / t.totalTime : 0;
  const pts = Math.round(tracePoints(frac) * (t.two ? 1.5 : 1)) * (score.inZone() ? 2 : 1);
  score.score += pts;
  if (frac >= 0.6) { score.hits++; score.combo++; score.best = Math.max(score.best, score.combo); } else score.combo = 0;
  say(`${t.two ? 'Two ropes' : 'Rope'} ${Math.round(frac * 100)}%  +${pts}`);
  audio.sfx(frac >= 0.8 ? 'perfect' : frac >= 0.5 ? 'hit' : 'miss', { hand: t.strands[0].hand });
  if (frac >= 0.3) attribution.record(t.two ? 'sweep' : 'trace', gameTime); // you actually followed it
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
    if (!t.started) { t.started = true; say(t.two ? 'Both hands on the ropes!' : 'Ride the rope!', 1); }
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
      if (!r.box) r.box = { x0: hand.x, x1: hand.x, y0: hand.y, y1: hand.y };
      else { r.box.x0 = Math.min(r.box.x0, hand.x); r.box.x1 = Math.max(r.box.x1, hand.x); r.box.y0 = Math.min(r.box.y0, hand.y); r.box.y1 = Math.max(r.box.y1, hand.y); }
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
const slamBarGeo = new THREE.BoxGeometry(SLAM_BOX.x * 1.8, 0.05, 0.05); // the handle bar you grab both sides of
const slamEdgeGeo = new THREE.EdgesGeometry(slamBarGeo);
const slamBallGeo = new THREE.SphereGeometry(0.2, 24, 16);
const slamBandGeo = new THREE.TorusGeometry(0.205, 0.018, 8, 32);
const slamFloorGeo = new THREE.RingGeometry(0.32, 0.4, 40).rotateX(-Math.PI / 2);
const slamWaveGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
const slamBallMat = new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffb02e, emissiveIntensity: 0.35, roughness: 0.55 });
const slamFloorMat = new THREE.MeshBasicMaterial({ color: 0xffc04d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
const slamWaves = []; // shockwave rings on the floor after a slam
const slamArrowGeo = new THREE.ConeGeometry(0.07, 0.16, 4).rotateX(Math.PI); // points down
const slamMat = new THREE.MeshStandardMaterial({ color: 0xffc04d, emissive: 0xff9a1f, emissiveIntensity: 0.8, roughness: 0.35 });
const slamEdgeMat = new THREE.LineBasicMaterial({ color: 0xb46bff });
function spawnSlam(head, standing, { dist = SPAWN_DISTANCE, speed = difficulty.orbSpeed } = {}) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(slamBarGeo, slamMat), new THREE.LineSegments(slamEdgeGeo, slamEdgeMat));
  const ball = new THREE.Mesh(slamBallGeo, slamBallMat); // medicine ball in the middle of the bar
  const band = new THREE.Mesh(slamBandGeo, slamMat);
  group.add(ball, band);
  const floor = new THREE.Mesh(slamFloorGeo, slamFloorMat); // where it's going: smash it into the floor
  floor.position.y = -(standing - 0.02) + 0.02;
  group.add(floor);
  const arrows = [-0.32, 0, 0.32].map((x) => { const a = new THREE.Mesh(slamArrowGeo, slamMat); a.position.set(x, 0.36, 0); group.add(a); return a; });
  group.position.set(centerX, standing - 0.02, head.z - dist);
  scene.add(group);
  slams.push({ group, arrows, speed, t: { left: null, right: null }, passZ: head.z + 0.4, announced: false, age: 0, teach: teach('slam') });
}
function endSlam(s, i, hit) {
  tstat.slams++; if (hit) tstat.slamHits++;
  if (hit) {
    const pts = 60 * (score.inZone() ? 2 : 1);
    score.score += pts; score.hits++; score.combo++; score.best = Math.max(score.best, score.combo);
    say(`SLAM!  +${pts}`);
    audio.sfx('power', { power: 1 });
    pulseBoth(1, 160);
    for (const dx of [-0.35, 0.35]) shatter(s.group.position.clone().add(new THREE.Vector3(dx, 0, 0)), new THREE.Vector3(dx, -1, -0.3).normalize(), 0xffc04d, 1);
    shatter(s.group.position.clone(), new THREE.Vector3(0, -1, 0), 0xffb02e, 1);
    const wave = new THREE.Mesh(slamWaveGeo, new THREE.MeshBasicMaterial({ color: 0xffc04d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    wave.position.set(s.group.position.x, 0.03, s.group.position.z);
    wave.scale.setScalar(0.3);
    scene.add(wave);
    slamWaves.push({ mesh: wave, age: 0 });
    hitFlash = Math.max(hitFlash, 0.4);
  } else {
    score.combo = 0;
    say('Missed the slam - both fists down together');
    audio.sfx('miss');
  }
  scene.remove(s.group);
  slams.splice(i, 1);
}
const slamTmp = new THREE.Vector3();
function updateSlamWaves(dt) { // the shockwave rolls out across the floor and fades
  for (let i = slamWaves.length - 1; i >= 0; i--) {
    const w = slamWaves[i];
    w.age += dt;
    w.mesh.scale.setScalar(0.3 + 2.2 * w.age);
    w.mesh.material.opacity = Math.max(0, 0.9 * (1 - w.age / 0.6));
    if (w.age >= 0.6) { scene.remove(w.mesh); w.mesh.material.dispose(); slamWaves.splice(i, 1); }
  }
}
function updateSlams(dt, xr, head) {
  updateSlamWaves(dt);
  for (let i = slams.length - 1; i >= 0; i--) {
    const s = slams[i];
    s.age += dt;
    s.group.position.z += s.speed * dt;
    const bob = Math.sin(s.age * 9);
    s.arrows.forEach((a) => { a.position.y = 0.3 + 0.05 * bob; });
    if (!s.announced && s.group.position.z > head.z - 6) { s.announced = true; say('SLAM IT - both fists, down!', 1); }
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
let seen = (() => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; } })();
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
    if (!g.taught) { g.taught = true; say('Guard: both fists up to your chin!', 1); }
    return;
  }
  // Ropes: a ghost hand rides each ring.
  const t = traces.find((x) => x.teach && x.started);
  if (t) {
    for (const r of t.strands) show(r.hand, r.contact.x, r.contact.y, r.contact.z);
    if (!t.taught) { t.taught = true; say(t.two ? 'One hand on each rope - follow the rings!' : 'Keep your hand inside the ring as the rope slides by', 1); }
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
let comboReadyAt = 0;            // combos at most every ~9 s, so they stay special (with few moves on, half of all punches became combos)
const COMBO_COOLDOWN = 9;
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
  comboReadyAt = gameTime + COMBO_COOLDOWN + gap * tpl.steps.length;
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
  audio.dropIn(); // a combo clear slams a song breakdown back in
  // Finisher: the last punch gets a big pop-up and a strong buzz on both hands.
  popText(`COMBO CLEAR +${pts}`, orb.group.position, '#ffc04d', 0.32); // above the hit's own points
  pulseBoth(0.9, 120);
}

// ------------------------------------------------------------------ spotlight rounds

let spotlight = null;          // { key, until } while a round is on
let spotlightStarted = null;   // training seconds when the last round started
function updateSpotlight() {
  const c = controller;
  if (c.phase !== Phase.Training) { spotlight = null; return; }
  const t = c.phaseElapsedSeconds;
  const over = c.status === Zone.Above || c.status === Zone.SafetyBrake;
  if (spotlight && (t >= spotlight.until || over)) {
    if (over) say('Spotlight off - ease off and breathe');
    spotlight = null;
  }
  if (!spotlight && !over && spotlightDue(t, spotlightStarted)) {
    spotlightStarted = t;
    const en = enabledActivities();
    const open = Object.fromEntries(Object.entries(en).map(([k, on]) => [k, on && (ACTIVITIES.find((a) => a.key === k)?.from ?? 0) <= c.intensity]));
    const key = pickSpotlight({ enabled: open, gains: attribution.w, below: c.status === Zone.Below });
    if (!key) return;
    spotlight = { key, until: t + SPOTLIGHT.seconds };
    say(`SPOTLIGHT: ${SPOTLIGHT_NAMES[key]}  (60 s)`);
    audio.sfx('burst');
  }
}
// ------------------------------------------------------------------ acts and the weekly plan (see ACTS / weekSummary in core.js)

let acts = [], actIdx = -1;       // this workout's chapters, and which one is on
let week = null, workoutShape = 'steady';
// Named daily workouts (v58; Morty's #1: "a named workout every day"): same engine, but today has a
// name, a colour, act titles and a featured move, from a bank on weekly rotation (progress.js).
let today = null;                 // today's named workout, or null with the weekly plan off
let workoutMinutes = 15;          // this workout's training length (a restart session is shorter)
const FEATURE_BOOST = 1.6;        // how much more often today's featured move is sent
const planToday = () => (settings.moves.program
  ? todayWorkout({ log: loadWeek(), minutes: settings.trainingMinutes, bossOn: settings.moves.boss !== false }) : null);
const WEEK_KEY = 'pulsezone.week'; // a light log of finished workouts (date, % in zone, shape), last 120
function loadWeek() { try { return JSON.parse(localStorage.getItem(WEEK_KEY) || '[]'); } catch { return []; } }
function logWeek(w) {
  if (!w.real) return; // only real-heart-rate workouts count toward the plan (not simulator test runs)
  const log = [...loadWeek(), { date: new Date(Date.now() - gameTime * 1000).toISOString(), pct: w.pct, inZoneSec: w.inZoneSeconds, trainingSec: w.trainingSeconds, profile: workoutShape, landings: (tstat.landings || []).length,
    name: today?.name || '', id: today?.id || '', recovery: w.recovery ?? null }].slice(-120);
  try { localStorage.setItem(WEEK_KEY, JSON.stringify(log)); } catch { /* full */ }
}
const SHAPE_NAME = { steady: 'STEADY', waves: 'WAVES', build: 'BUILD & PEAK' };
const SHAPE_TITLE = { steady: 'Steady', waves: 'Waves', build: 'Build & peak' };
function setProgram(on) {
  settings.moves.program = on;
  saveSettings(); syncMovesUI();
  today = planToday();
  if (on && controller && controller.phase === Phase.WarmUp) { // still warming up: today's shape and length can apply now
    workoutShape = today.shape; controller.s.profile = workoutShape;
    workoutMinutes = today.minutes; controller.s.trainingSeconds = workoutMinutes * 60;
    acts = settings.moves.acts ? actPlan(workoutMinutes * 60) : [];
  }
  say(on ? `Weekly plan on: today is ${today.name.toUpperCase()} (${SHAPE_NAME[today.shape]})` : 'Weekly plan off', 2);
  hudKey = '';
}
/** The warm-up line: where you are in the week, today's shape, and what to beat. */
function weekLine() {
  if (!week) return '';
  const beat = week.toBeat ? `  ·  beat ${week.toBeat.pct}% in zone${week.toBeat.profile === workoutShape ? ` (last ${SHAPE_NAME[workoutShape]})` : ''}` : '';
  if (!settings.moves.program) return week.done || week.toBeat ? `This week ${weekDots(week.done)}${beat}` : '';
  if (today) return `${SHAPE_TITLE[workoutShape]} ${workoutMinutes} min  ·  this week ${weekDots(week.done)}${beat}`;
  return `This week ${weekDots(week.done)}  ·  today: ${SHAPE_NAME[workoutShape]}${beat}`;
}
/** The headline above it: today's named workout (v58). */
function todayLine() {
  if (!today) return '';
  if (today.restart) return `WELCOME BACK: ${today.name.toUpperCase()}  ·  short and easy today`;
  return `TODAY: ${today.name.toUpperCase()}${today.boss ? '  ·  GUARDIAN DAY' : ''}`;
}
/** This act's title: the named workout's own (v58), or the act's standard name. */
const actTitle = (i) => (today && actTitles(today, acts.length)[i]?.toUpperCase()) || ACTS[acts[i].key].name;
/** Act changes: a call-out, a chime, a new sky tint and a new mix. */
function updateActs() {
  const c = controller;
  if (c.phase !== Phase.Training || !acts.length) { if (c.phase !== Phase.Training) actIdx = -1; return; }
  const i = actAt(acts, c.phaseElapsedSeconds);
  if (i === actIdx) return;
  actIdx = i;
  const a = ACTS[acts[i].key];
  say(`ACT ${i + 1}/${acts.length}: ${actTitle(i)} - ${a.blurb}`, 1);
  if (i === acts.length - 1 && acts.length > 1) coach.line('finale', 1);
  else if (!coach.line(`act${i + 1}`, 1)) coach.say(`Act ${i + 1}. ${actTitle(i)}.`, 1);
  audio.sfx('streak', { level: i + 2 });
  audio.dropIn();
  logEvent('act', { act: acts[i].key, n: i + 1, title: actTitle(i) });
  if (i > 0 && ghost) ghostSayAt = gameTime + 8; // a few seconds later: how you're doing against your last run
}
const actNow = () => (actIdx >= 0 && acts[actIdx] ? acts[actIdx].key : null);

// ------------------------------------------------------------------ progress: levels, badges, the ghost of your last run (v58)

/**
 * From the VR fitness research (Morty's #4 and #6, Gemini's #8 and #9): a level that grows with
 * MINUTES IN YOUR ZONE (never score), badges for real behaviours, and "last Tuesday's you" to race.
 * All local, and only real-heart-rate workouts count, like the personal bests.
 */
const PROGRESS_KEY = 'pulsezone.progress'; // { badges: { id: ISO date } }
const GHOSTS_KEY = 'pulsezone.ghosts';     // the last real workout of each shape: { [shape]: { date, name, pct, trace } }
function loadProgress() { try { return { badges: {}, ...(JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {}) }; } catch { return { badges: {} }; } }
function loadGhosts() { try { return JSON.parse(localStorage.getItem(GHOSTS_KEY) || '{}') || {}; } catch { return {}; } }
let ghost = null, ghostSayAt = 0;
let boss = null; // the Guardian (v58, boss.js): only on the week's last planned workout, or from its Test button
/** Seconds in the zone you are ahead of (+) or behind (-) your last run of this shape, at this point in training. */
const ghostNow = () => (ghost && controller && controller.phase === Phase.Training ? ghostDelta(ghost.trace, controller.phaseElapsedSeconds, controller.secondsInZone) : null);
function updateGhost() {
  if (!ghostSayAt || gameTime < ghostSayAt) return;
  ghostSayAt = 0;
  const d = ghostNow();
  if (d == null || Math.abs(d) < 10 || charge) return; // too close to call (or mid-charge: stay out of the way)
  say(d > 0 ? `Ahead of your last ${SHAPE_NAME[workoutShape]} by ${ghostLabel(d).slice(1)}` : `Your last ${SHAPE_NAME[workoutShape]} is ${ghostLabel(d).slice(1)} ahead`, 2);
  coach.line(d > 0 ? 'ghostAhead' : 'ghostBehind', 3);
}
const actSkyTarget = new THREE.Color(), actSkyNow = new THREE.Color(0x0b0d18);

// ------------------------------------------------------------------ the Guardian: a heart-rate boss (v58, see boss.js)

/**
 * The Guardian (Morty's #3, docs/BOSS_SPEC_DRAFT.md): the zone controller with a face. A figure at
 * the far end of the lane with a shield ring round its core. Your scored reps only hurt it while
 * you're IN YOUR ZONE; below the zone the shield stalls (and creeps back after 20 s), above it the
 * Guardian overheats and asks you to breathe. It adds no moves. One per workout, on the week's last
 * planned workout (or from its Test button); it leaves when the cool-down starts.
 */
const bossView = new BossView(scene);
const BOSS_POINTS = 500;
const BOSS_LINES = { // [on-screen, coach phrase] once a state has settled
  exposed: ['GUARDIAN OPEN: hit it now', 'bossExposed'],
  guarded: ['Shield up: get back in your zone', 'bossGuarded'],
  overheating: ['It is overheating: ease off and breathe', 'bossOverheat'],
};
let repQuality = 1; // how hard the rep being recorded was (punches set it from their power tier; 1 otherwise)
let bossSaid = '', bossStateSince = 0, bossSaidAt = -99, bossLeaveAt = 0, bossRetreatSayAt = 0;
function startBoss(test = false) {
  const c = controller, inTraining = c.phase === Phase.Training;
  const left = Math.max(120, c.s.trainingSeconds - (inTraining ? c.phaseElapsedSeconds : 0)); // sized to the training time it has
  boss = newBoss(left);
  boss.test = test;
  bossSaid = ''; bossStateSince = gameTime; bossSaidAt = gameTime; bossLeaveAt = 0; bossRetreatSayAt = 0;
  bossView.show();
  say('THE GUARDIAN: your hits only count while you are in your zone', 1);
  coach.line('bossArrive', 1);
  audio.sfx('streak', { level: 5 });
  logEvent('boss', { stage: 'arrive', seconds: Math.round(left), test: test || undefined });
}
/** A scored rep (every attribution.record): chips the shield, then the core, while it's exposed. */
function bossRep(quality) {
  if (!boss || boss.left || boss.defeatedAt != null || controller.phase !== Phase.Training) return;
  const r = bossHit(boss, { now: controller.phaseElapsedSeconds, quality });
  if (r) bossStruck(r, 'hit');
}
function bossStruck(r, kind) {
  bossView.flash(r.defeated ? 'defeated' : r.broke ? 'broke' : kind);
  if (r.broke && !r.defeated) {
    say('SHIELD DOWN! Now the core', 1); coach.line('bossBroke', 1);
    audio.sfx('streak', { level: 6 }); pulseBoth(0.8, 140);
    logEvent('boss', { stage: 'broke' });
  }
  if (r.defeated) {
    score.score += BOSS_POINTS;
    say(`GUARDIAN DOWN!  +${BOSS_POINTS}`, 1); coach.line('bossDefeated', 1);
    audio.sfx('streak', { level: 8 }); pulseBoth(1, 260);
    logEvent('boss', { stage: 'defeated' });
    bossLeaveAt = gameTime + 6; // let its finale play, then it's gone
  }
}
function updateBoss(gdt) {
  if (!boss || boss.left) return;
  const c = controller;
  if (c.phase !== Phase.Training) { if (c.phase !== Phase.WarmUp) endBoss(); return; }
  const prev = boss.state;
  bossTick(boss, { status: c.status, climbing: trendShown === 'climbing', dt: gdt, now: c.phaseElapsedSeconds });
  if (boss.state !== prev) bossStateSince = gameTime;
  if (bossLeaveAt && gameTime >= bossLeaveAt) { bossLeaveAt = 0; boss.left = true; bossView.hide(); return; }
  // Call-outs only once a state has settled (heart rate wobbles at the zone's edge), and not too often.
  if (boss.defeatedAt == null && boss.state !== bossSaid && BOSS_LINES[boss.state] && gameTime - bossStateSince > 4 && gameTime - bossSaidAt > 20 && !charge) {
    bossSaid = boss.state; bossSaidAt = gameTime;
    say(BOSS_LINES[boss.state][0], 2); coach.line(BOSS_LINES[boss.state][1], 2);
  }
}
/** Cool-down: the Guardian leaves. Not beaten = it got away, said plainly, no blame. */
function endBoss() {
  if (!boss || boss.left) return;
  boss.left = true;
  if (boss.defeatedAt == null) {
    say('The Guardian got away. It will be back.', 2);
    bossRetreatSayAt = gameTime + 8; // spoken after the cool-down guidance, not over it
    logEvent('boss', { stage: 'retreat', shield: Math.round(boss.shield), core: Math.round(boss.core) });
  }
  bossView.hide();
}

// ------------------------------------------------------------------ charge and coast (see CHARGE in core.js)

let charge = null;      // { stage: 'charge' | 'coast', since, startBpm, peak, coastIntensity }
let verdictShow = null; // { text, color, until }: the landing verdict's banner
let chargeReadyAt = 0;  // gameTime when the next charge may start
function startCharge(test = false) {
  const c = controller, bpm = source().hasReading ? source().currentBpm : 0;
  charge = { stage: 'charge', since: gameTime, startBpm: bpm, peak: null, test };
  boost.value = 0; // the charge replaces the challenge boost
  say('CHARGE! 30 seconds ALL OUT', 1);
  audio.sfx('burst');
  logEvent('charge', { bpm, target: Math.round(c.currentSetpoint), test: test || undefined });
  // The engine of a charge is a wall-ball round (legs + overhead + cadence); battle ropes if that's off.
  // If a round is already on, that's the engine; if another station is in the lane, it's sent once that's done.
  const en = enabledActivities(true);
  if (stations.some((x) => x.round && !x.done)) return;
  if (en.press) { if (stations.length) charge.wantPress = true; else { queuedActivity = 'press'; queuedFor = 0; testQueued = false; } }
  else if (en.ropes && !burstActive()) { pendingBurst = 'ropes'; pendingBurstTest = false; }
}
function updateCharge() {
  const c = controller, src = source();
  const bpm = src.hasReading && c.status !== Zone.NoSignal ? src.currentBpm : 0;
  if (c.phase !== Phase.Training) { charge = null; return; }
  if (!charge) {
    if (!settings.moves.charge || phoneFallback || sensorFlat || burstActive() || pendingBurst || stations.length) return;
    if (actNow() && !ACTS[actNow()].charge) return; // not in the opening act: find your groove first
    if (chargeWanted({ phase: c.phase, status: c.status, bpm, target: c.currentSetpoint, climbing: trendShown === 'climbing',
      trainingT: c.phaseElapsedSeconds, now: gameTime, readyAt: chargeReadyAt })) startCharge();
    return;
  }
  const secs = gameTime - charge.since;
  const over = c.status === Zone.Above || c.status === Zone.SafetyBrake;
  if (charge.stage === 'charge') {
    // v58: the coach counts the charge down (halfway, last five seconds).
    if (!charge.saidHalf && secs >= CHARGE.chargeSeconds / 2) { charge.saidHalf = true; coach.line('chargeHalf', 2); }
    if (!charge.saidLast && secs >= CHARGE.chargeSeconds - 5 && secs < CHARGE.chargeSeconds) { charge.saidLast = true; coach.line('chargeLast5', 1); }
    if (charge.wantPress && !stations.length && !burstActive() && secs < 12) { charge.wantPress = false; queuedActivity = 'press'; queuedFor = 0; testQueued = false; }
    const roundOn = stations.some((x) => x.round && x.arrived && !x.done);
    if (over || (secs >= CHARGE.chargeSeconds && !roundOn) || secs >= CHARGE.chargeSeconds + 15) {
      charge = { ...charge, stage: 'coast', since: gameTime, peak: predictPeak(bpm, attribution.projectedRise(), c.bpmTrend), coastIntensity: c.intensity };
      say(over ? 'COAST! Ease right off' : 'COAST! Light moves - let your heart rate land', 1);
      coach.line('coast', 1);
      audio.sfx('zone');
      logEvent('coast', { bpm, peak: Math.round(charge.peak) });
    }
    return;
  }
  // Coasting: keep re-predicting; land when it stops climbing (or goes over).
  if (!charge.saidHold && secs >= 8) { charge.saidHold = true; coach.line('coastHold', 2); } // "hold... let it rise... land it"
  charge.peak = predictPeak(bpm, attribution.projectedRise(), c.bpmTrend);
  if (coastOver({ secs, trend: c.bpmTrend, status: c.status })) {
    const { verdict, points } = landingVerdict(bpm, c.currentSetpoint, c.s.zoneHalfWidth);
    score.score += points;
    // Its own banner for 6 s (Morty, v54: the verdict "pays out silently" - call-outs get replaced in 1.8 s).
    const lo = Math.round(c.currentSetpoint - c.s.zoneHalfWidth), hi = Math.round(c.currentSetpoint + c.s.zoneHalfWidth);
    verdictShow = {
      text: { perfect: `PERFECT LANDING!  ${bpm} BPM in ${lo}-${hi}  +${points}`, nearly: `NEARLY!  ${bpm} BPM, just off ${lo}-${hi}  +${points}`,
        over: `OVERSHOT: ${bpm} BPM (zone ${lo}-${hi}) - charge softer next time`, short: `SHORT: ${bpm} BPM (zone ${lo}-${hi}) - charge harder next time` }[verdict],
      color: { perfect: '#ffd34d', nearly: '#7cffb0', over: '#ff9933', short: '#59b3ff' }[verdict], until: gameTime + 6,
    };
    say({ perfect: 'PERFECT LANDING!', nearly: 'NEARLY!', over: 'OVERSHOT', short: 'SHORT' }[verdict], 1);
    coach.line({ perfect: 'landingPerfect', nearly: 'landingNearly', over: 'landingOver', short: 'landingShort' }[verdict], 1);
    pendingNote = pendingNote ? `${pendingNote}; landing ${verdict}` : `landing ${verdict}`; // in the workout CSV too
    if (verdict === 'perfect' || verdict === 'nearly') { audio.sfx('streak', { level: verdict === 'perfect' ? 4 : 2 }); pulseBoth(verdict === 'perfect' ? 1 : 0.6, 160); }
    else audio.sfx('zone');
    logEvent('landing', { verdict, bpm, target: Math.round(c.currentSetpoint), points, from: charge.startBpm });
    tstat.landings = [...(tstat.landings || []), verdict];
    if (boss && !boss.left && boss.defeatedAt == null) { const r = bossLanding(boss, verdict, c.phaseElapsedSeconds); if (r) bossStruck(r, 'landing'); } // a PERFECT LANDING knocks 25% off the shield
    // Pick up from the effort that got you here, not whatever the controller wound up to while it waited.
    c.intensity = c.integral = Math.min(c.intensity, charge.coastIntensity ?? c.intensity);
    charge = null;
    chargeReadyAt = gameTime + CHARGE.cooldown;
  }
}
/** What a charge does to intensity: all out while charging, light while coasting. */
function chargeIntensity(i) { return !charge ? i : charge.stage === 'charge' ? Math.max(i, 0.85) : Math.min(i, 0.3); }
function chargeLine() {
  if (!charge) return '';
  const secs = gameTime - charge.since;
  const c = controller, lo = Math.round(c.currentSetpoint - c.s.zoneHalfWidth), hi = Math.round(c.currentSetpoint + c.s.zoneHalfWidth);
  if (charge.stage === 'charge') return `CHARGE: ALL OUT  ${Math.max(0, Math.ceil(CHARGE.chargeSeconds - secs))}s`;
  return `COAST: land in ${lo}-${hi}  ·  heading for ~${Math.round(charge.peak)}`;
}

/** The activity mix's base weights, with the spotlight move boosted while a round is on. */
function spawnWeights() {
  let base = actNow() ? actWeights(actNow(), attribution.w, tuning.weights) : tuning.weights;
  const feat = today && ACTIVITIES.find((x) => x.key === today.feature); // today's featured move comes up more often
  if (feat) base = { ...(base || {}), [feat.key]: ((base || {})[feat.key] ?? feat.base) * FEATURE_BOOST };
  if (!spotlight) return base;
  const a = ACTIVITIES.find((x) => x.key === spotlight.key);
  return { ...(base || {}), [spotlight.key]: ((base || {})[spotlight.key] ?? a.base) * SPOTLIGHT.boost };
}

// Floating text at a hit point (per-hit points, combo clears). A pool of 3, oldest reused.
const pops = Array.from({ length: 3 }, () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), mat);
  mesh.visible = false; mesh.renderOrder = 10;
  scene.add(mesh);
  return { canvas, tex, mat, mesh, age: 0 };
});
let popNext = 0;
function popText(text, pos, color = '#ffc04d', lift = 0.12) {
  if (!text) return;
  const p = pops[popNext]; popNext = (popNext + 1) % pops.length;
  const g = p.canvas.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.font = '800 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(text, 256, 64, 490); // squeeze long text instead of clipping
  g.fillStyle = color; g.fillText(text, 256, 64, 490);
  p.tex.needsUpdate = true;
  p.mesh.position.set(pos.x, pos.y + lift, pos.z);
  // Up close (e.g. the heavy bag at arm's length) the text shrinks so it doesn't fill your view.
  p.mesh.scale.setScalar(Math.max(0.35, Math.min(1, p.mesh.position.distanceTo(camera.getWorldPosition(camTmp)) / 2.5)));
  p.mesh.visible = true; p.age = 0;
}
function updatePop(rawDt) {
  camera.getWorldPosition(camTmp);
  for (const p of pops) {
    if (!p.mesh.visible) continue;
    p.age += rawDt;
    p.mesh.position.y += rawDt * 0.35;
    p.mat.opacity = Math.max(0, 1 - p.age / 0.9);
    p.mesh.lookAt(camTmp);
    if (p.age > 0.9) p.mesh.visible = false;
  }
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
/**
 * Form cue (v58; Morty's #7: grade the punch, then say something true about it). Mostly flicks
 * lately WHILE you're below your zone: one nudge a minute to punch through. Mostly heavy hits: the
 * odd word of praise. In the zone, light punches are fine and nobody nags.
 */
const tierLog = [];
let formSaidAt = -99;
function formCue(tier) {
  tierLog.push(tier);
  if (tierLog.length > 8) tierLog.shift();
  if (tierLog.length < 8 || gameTime - formSaidAt < 60 || charge) return;
  const count = (t) => tierLog.filter((x) => x === t).length;
  if (count('tap') >= 6 && controller.status === Zone.Below) { formSaidAt = gameTime; say('Those are flicks: punch through the target', 2); coach.line('flick', 2); }
  else if (count('heavy') >= 5) { formSaidAt = gameTime + 60; coach.line('powerPraise', 3); }
}
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
    logEvent('weak', { act: orb.activity, speed: +speed.toFixed(2) });
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
  if (orb.swing === 'down' && fist && punchMode) { // a hammer fist only counts coming down onto the pad
    const d = fistDisplacement(fist);
    if (!swingMatches('down', [d.x, d.y, d.z], 0.45)) {
      logEvent('weak', { act: 'hammer', why: 'not down' });
      score.weakHit('Hammer fist - strike DOWN onto the pad!');
      audio.sfx('weak'); pulse(fist, 0.2, 20); flashWeak();
      return false;
    }
  }
  if (orb.swing && fist) {
    const d = fistDisplacement(fist);
    if (swingMatches(orb.swing, [d.x, d.y, d.z], 0.25)) {
      bonus = 2;
      label = orb.swing === 'up' ? 'Perfect uppercut! ' : orb.swing === 'down' ? 'HAMMER! ' : 'Perfect hook! ';
      score.perfect++;
    } else {
      label = 'Follow the curve for x2  ';
    }
  }
  if (bonus > 1 && !orb.power) power = Math.max(power, 0.7);
  // Power-graded hits (v57): every plain punch is a tap, solid or HEAVY; heavy ones score x1.5
  // with a bigger boom, so you throw from the shoulder instead of flicking.
  const tier = punchMode && fist && !orb.power ? hitTier(punchPower(speed, travel)) : null;
  if (tier === 'heavy') { bonus *= HEAVY_BONUS; label = `HEAVY! ${label}`; score.heavy++; if (Math.random() < 0.3) coach.line('heavy', 3); }
  if (tier) { score.powerSum += punchPower(speed, travel); score.powerN++; }
  pulse(fist, 0.35 + 0.65 * power, 30 + 60 * power);
  popText(score.hit(bonus, label), orb.group.position, label ? '#ffffff' : HAND_CSS[orb.hand]);
  audio.sfx(orb.power ? 'power' : bonus > 1 && tier !== 'heavy' ? 'perfect' : 'hit', { hand, power: tier === 'heavy' ? Math.max(power, 0.85) : power });
  repQuality = tier ? BOSS.quality[tier] ?? 1 : 1;
  if (tier) formCue(tier);
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
  Object.assign(w, { score: score.score, streak: Math.min(Math.floor(longestStreak), w.inZoneSeconds), reactor: reactor.level, combo: score.best, kcal: Math.round(kcal) });
  // Personal bests only count workouts driven mostly by your real heart rate (not the simulator).
  w.real = w.trainingSeconds > 0 && realHrSeconds >= 0.5 * w.trainingSeconds;
  const zoneBefore = bests?.totalZoneSeconds || 0; // minutes in zone so far = your level before this workout
  let records = [];
  if (w.real) {
    const r = updateBests(bests, w);
    bests = r.bests; records = r.records;
    try { localStorage.setItem(BESTS_KEY, JSON.stringify(bests)); } catch { /* ignore */ }
  }
  w.profile = workoutShape;
  w.name = today?.name || ''; w.restart = !!today?.restart;
  const story = recoveryStory(loadWeek(), w.recovery); // against the month BEFORE this workout joins the log
  if (boss) w.boss = bossSummary(boss);
  logWeek(w);
  const before = week;
  week = weekSummary(loadWeek());
  w.weekText = weekEndLine(w, before);
  const progress = tallyProgress(w, zoneBefore, story);
  w.level = { level: progress.lvl.level, title: progress.lvl.title }; w.badges = progress.earned;
  lastSummary = { w, records, progress };
  archiveWorkout(w);
  clearObstacles(); // nothing left hanging in front of the board
  drawSummary(w, records);
  drawProgress(w, progress);
  summaryBoard.visible = true; progressBoard.visible = true;
  applyEmberColour();
  // A few seconds after "workout done": the level-up or the new badge, spoken once.
  if (progress.up || progress.earned.length) setTimeout(() => coach.line(progress.up ? 'levelUp' : 'badge', 2), 4500);
}

/** Level, badges and the ghost for the workout that just ended (and save them; real heart rate only). */
function tallyProgress(w, zoneBefore, story) {
  const zoneAfter = w.real ? (bests?.totalZoneSeconds || 0) : zoneBefore;
  const lvl = levelFor(zoneAfter);
  const up = w.real ? levelUp(zoneBefore, zoneAfter) : null;
  const store = loadProgress();
  let earned = [];
  if (w.real) {
    earned = newBadges({ w, landings: tstat.landings || [], week, bests, heavy: score.heavy, poses: score.poses, bossWon: !!(boss && boss.defeatedAt != null), restart: w.restart }, store.badges);
    if (earned.length) {
      const at = new Date().toISOString();
      for (const b of earned) store.badges[b.id] = at;
      try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(store)); } catch { /* full */ }
    }
  }
  const vsGhost = ghost ? ghostDelta(ghost.trace, w.trainingSeconds, w.inZoneSeconds) : null;
  if (w.real && w.trainingSeconds >= MIN_RECORD_SECONDS) { // this run becomes the one to race next time
    const ghosts = { ...loadGhosts(), [workoutShape]: { date: new Date(Date.now() - gameTime * 1000).toISOString(), name: w.name, pct: w.pct, trace: ghostTrace(sessionLog) } };
    try { localStorage.setItem(GHOSTS_KEY, JSON.stringify(ghosts)); } catch { /* full */ }
  }
  return {
    lvl, up, ember: up ? trailUnlocked(up.from, up.to) : null, earned, have: Object.keys(store.badges).length, total: BADGES.length,
    hint: BADGES.find((b) => !store.badges[b.id]) || null, vsGhost, story, next: planToday(),
  };
}
/** Your level's ember colour (v58: higher levels unlock new colours for the in-zone embers). */
function applyEmberColour() { emberMat.color.setHex(trailFor(levelFor(bests?.totalZoneSeconds || 0).level).colour); }

/**
 * The progress board (v58): to the right of the summary, angled toward you. Today's named workout,
 * your level and the minutes in zone to the next one, new badges (or the next one to earn), how you
 * did against your last run of this shape, what the recovery number means, and what's next.
 */
const progCanvas = document.createElement('canvas');
progCanvas.width = 512; progCanvas.height = 640;
const progTex = new THREE.CanvasTexture(progCanvas);
progTex.colorSpace = THREE.SRGBColorSpace;
const progressBoard = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.125), new THREE.MeshBasicMaterial({ map: progTex, transparent: true }));
progressBoard.rotation.order = 'YXZ';
progressBoard.visible = false;
scene.add(progressBoard);
function drawProgress(w, p) {
  const g = progCanvas.getContext('2d'), W = progCanvas.width, H = progCanvas.height;
  const x = 34, mw = W - 68;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,10,18,0.82)';
  g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 24); g.fill();
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillStyle = today?.colour || '#e6e9ef'; g.font = '700 34px system-ui, sans-serif';
  g.fillText(today ? today.name.toUpperCase() : 'YOUR PROGRESS', x, 46, mw);
  g.fillStyle = '#8d95a5'; g.font = '22px system-ui, sans-serif';
  g.fillText(`${SHAPE_TITLE[workoutShape]}  ·  this week ${weekDots(week.done)}`, x, 82, mw);

  g.fillStyle = '#ffffff'; g.font = '700 44px system-ui, sans-serif';
  g.fillText(`LEVEL ${p.lvl.level}`, x, 134);
  g.textAlign = 'right'; g.fillStyle = '#ffc04d'; g.font = '700 26px system-ui, sans-serif';
  g.fillText(p.up ? 'LEVEL UP!' : p.lvl.title.toUpperCase(), W - x, 138, 200);
  g.textAlign = 'left';
  g.fillStyle = '#262a38'; g.beginPath(); g.roundRect(x, 164, mw, 16, 8); g.fill();
  g.fillStyle = '#ffc04d'; g.beginPath(); g.roundRect(x, 164, Math.max(16, mw * Math.min(1, p.lvl.frac)), 16, 8); g.fill();
  g.fillStyle = '#8d95a5'; g.font = '20px system-ui, sans-serif';
  g.fillText(!w.real ? 'Estimated heart rate: progress not saved'
    : p.ember ? `New: ${p.ember.name} while you're in the zone`
      : `${mmss(p.lvl.intoSec)} of ${mmss(p.lvl.needSec)} in zone to level ${p.lvl.level + 1}`, x, 202, mw);

  g.fillStyle = '#8d95a5'; g.font = '600 22px system-ui, sans-serif';
  g.fillText(`BADGES  ${p.have} / ${p.total}`, x, 250);
  if (p.earned.length) {
    g.fillStyle = '#ffc04d'; g.font = '700 26px system-ui, sans-serif';
    p.earned.slice(0, 3).forEach((b, i) => g.fillText(`★ ${b.name}`, x, 288 + i * 34, mw));
    if (p.earned.length > 3) { g.fillStyle = '#c9ced8'; g.font = '20px system-ui, sans-serif'; g.fillText(`and ${p.earned.length - 3} more`, x, 390, mw); }
  } else if (p.hint) {
    g.fillStyle = '#c9ced8'; g.font = '22px system-ui, sans-serif';
    wrapText(g, `Next: ${p.hint.name} (${p.hint.hint})`, x, 288, mw, 30);
  }

  if (p.vsGhost != null) {
    g.fillStyle = '#8d95a5'; g.font = '22px system-ui, sans-serif';
    g.fillText(`vs your last ${SHAPE_NAME[workoutShape]}`, x, 420, mw);
    g.fillStyle = p.vsGhost >= 0 ? '#4dff73' : '#ff8a6b'; g.font = '700 30px system-ui, sans-serif';
    g.fillText(`${ghostLabel(p.vsGhost)} in zone`, x, 454, mw);
  }
  if (w.recovery != null && p.story) {
    g.fillStyle = '#7fd8ff'; g.font = '600 22px system-ui, sans-serif';
    g.fillText(`1-min recovery -${w.recovery} BPM: ${p.story}`, x, 492, mw);
  }
  if (w.boss) {
    g.fillStyle = w.boss.defeated ? '#ffc04d' : '#c9ced8'; g.font = '600 22px system-ui, sans-serif';
    g.fillText(w.boss.text, x, 526, mw);
  }
  if (p.next) {
    g.fillStyle = '#8d95a5'; g.font = '22px system-ui, sans-serif';
    g.fillText('Next up', x, 568, mw);
    g.fillStyle = p.next.colour || '#ffffff'; g.font = '700 26px system-ui, sans-serif';
    g.fillText(`${p.next.name.toUpperCase()} (${SHAPE_TITLE[p.next.shape]})${p.next.boss ? ' + GUARDIAN' : ''}`, x, 602, mw);
  }
  progTex.needsUpdate = true;
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
    // Target band, following the target second by second (warm-up ramp, waves, build).
    g.fillStyle = 'rgba(77,255,115,0.16)';
    const colW = Math.max(2, (x1 - x0) / rows.length + 1);
    for (const r of rows) g.fillRect(X(r.t), Y(r.target + half), colW, Y(r.target - half) - Y(r.target + half));
    const tgt = controller.s.targetBpm;
    g.strokeStyle = 'rgba(77,255,115,0.5)'; g.lineWidth = 2; g.setLineDash([8, 8]);
    g.beginPath(); rows.forEach((r, i) => (i ? g.lineTo(X(r.t), Y(r.target)) : g.moveTo(X(r.t), Y(r.target)))); g.stroke(); g.setLineDash([]);
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
    g.textAlign = 'center'; g.font = '20px system-ui, sans-serif';
    g.fillText('line: your heart rate (green = in zone)  ·  band: target zone  ·  shaded: warm-up / cool-down', (x0 + x1) / 2, y1 + 22, 560);
  } else {
    g.fillStyle = '#8d95a5'; g.font = '28px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('No heart-rate readings this time', W / 2, (y0 + y1) / 2);
  }

  // Stats, with gold "NEW BEST" tags.
  const isNew = (k) => records.includes(k);
  const stat = (label, value, x, y, rec, maxW = 230) => {
    g.textAlign = 'left'; g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif'; g.fillText(label, x, y, maxW);
    g.fillStyle = rec ? '#ffc04d' : '#ffffff'; g.font = '700 40px system-ui, sans-serif'; g.fillText(value, x, y + 40, maxW);
    if (rec) { g.font = '700 20px system-ui, sans-serif'; g.fillText('NEW BEST', x, y + 76); }
  };
  stat('Time in zone', `${mmss(w.inZoneSeconds)}  (${w.pct}%)`, 48, 380, isNew('pct'));
  stat('Avg / peak', `${w.avgBpm || '--'} / ${w.peakBpm || '--'}`, 400, 380, false);
  stat('Longest streak', mmss(w.streak), 640, 380, isNew('streak'));
  if (w.recovery != null) stat('1-min recovery', `-${w.recovery} BPM`, 830, 380, false, 170); // v57: HR drop in the first minute of cool-down
  stat('Score', String(w.score), 48, 490, isNew('score'));
  stat('Calories · punch power', `${w.kcal} kcal · ${score.powerPct()}%`, 400, 490, false, 225); // v57: average hit power (heavy hits raise it)
  // Your top 3 heart-raising moves (learned), with bars: BPM added per 10 reps/min, and reps today.
  const rank = attribution.ranking().slice(0, 3);
  const maxG = Math.max(1, ...rank.map((r) => r.bpmPer10));
  g.textAlign = 'left'; g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif';
  g.fillText(w.real ? 'Raises YOUR heart most' : 'Starting estimates', 640, 490, 360); // learning needs your real heart rate
  rank.forEach((r, i) => {
    const y = 522 + i * 28;
    g.fillStyle = i === 0 ? '#ffffff' : '#c9ced8'; g.font = `${i === 0 ? '700 ' : ''}22px system-ui, sans-serif`;
    g.fillText(r.label, 640, y, 170);
    g.fillStyle = '#262a38'; g.fillRect(820, y - 9, 150, 18);
    g.fillStyle = `hsl(${20 + 160 * (1 - r.bpmPer10 / maxG)} 85% 55%)`; g.fillRect(820, y - 9, Math.max(6, 120 * (r.bpmPer10 / maxG)), 18);
    g.fillStyle = '#c9ced8'; g.font = '18px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`+${r.bpmPer10.toFixed(0)}`, 990, y); g.textAlign = 'left';
  });
  g.textAlign = 'center'; g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif';
  const short = !w.real ? 'Simulator / estimated heart rate: personal bests not saved'
    : w.trainingSeconds < MIN_RECORD_SECONDS ? 'Workouts under 3 min don\'t set records' : '';
  const report = settings.diag
    ? `Test: slams ${tstat.slamHits}/${tstat.slams} · guards ${score.blocks}/${score.blocks + score.guardsMissed} · walls hit ${score.wallHits}/${score.wallHits + score.dodges} · bombs hit ${score.bombHits}/${score.bombHits + score.bombDodges} · above zone ${mmss(tstat.aboveSec)} · stuck sensor ${mmss(tstat.flatSec)} · notes ${tstat.notes.length}`
    : '';
  const bestLine = report ? '' : bests ? `Bests: ${bests.pct}% in zone · ${mmss(bests.streak)} streak · ${bests.score} points · ${bests.workouts} workout${bests.workouts === 1 ? '' : 's'}` : '';
  g.fillText(report || [w.weekText || bestLine, short].filter(Boolean).join('  ·  '), W / 2, 600, W - 60);
  sumTex.needsUpdate = true;
}

/** End-board line: the week's dots, the streak, and how this one compared with the last of its shape. */
function weekEndLine(w, before) {
  if (!w.real) return '';
  const vs = before?.toBeat ? `  ·  ${w.pct - before.toBeat.pct >= 0 ? '+' : ''}${w.pct - before.toBeat.pct}% in zone vs last ${before.toBeat.profile === w.profile ? SHAPE_NAME[w.profile] : 'workout'}` : '';
  return `This week ${weekDots(week.done)} ${week.done >= week.goal ? 'DONE!' : `${week.done} of ${week.goal}`}${week.streak ? `  ·  week streak ${week.streak}` : ''}${vs}`;
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
  // Where heart rate is heading: current BPM + the rise still to come from the last ~12 s of effort
  // (bias-free), steadied over ~4 s because single reps make it jumpy.
  const p = src.hasReading && controller.status !== Zone.NoSignal ? src.currentBpm + attribution.projectedRise() : null;
  projSmooth = p == null ? null : projSmooth == null ? p : projSmooth + (p - projSmooth) * (1 - Math.exp(-rawDt / 4));
  const t = controller.phase === Phase.Training ? heartTrend({ // warm-up stays calm: no arrows yet
    status: controller.status, bpm: src.hasReading ? src.currentBpm : 0, projected: projSmooth,
    target: controller.currentSetpoint, half: controller.s.zoneHalfWidth,
  }) : null;
  if (t !== trend) { trend = t; trendFor = 0; } else trendFor += rawDt;
  if (trend && trendFor >= 2) trendShown = trend;
  else if (!trend && trendFor >= 3) trendShown = null; // linger a little so it doesn't flicker
}

/** Zone streaks: every 15 s you hold the zone, a chime (higher each time), bonus points and charge. */
/** Workout shape call-outs: when a wave turns, or the build passes a step. */
let waveState = 0;
function updateWaves() {
  const c = controller;
  if (c.phase !== Phase.Training || c.s.profile === 'steady') { waveState = 0; return; }
  const off = profileOffset(c.s.profile, c.phaseElapsedSeconds, c.s.trainingSeconds);
  if (c.s.profile === 'waves') {
    const st = off > 2.5 ? 1 : off < -2.5 ? -1 : waveState;
    if (st !== waveState) { waveState = st; say(st > 0 ? `WAVE UP - target ${Math.round(c.currentSetpoint)}` : `RECOVERY WAVE - target ${Math.round(c.currentSetpoint)}`); audio.sfx('burst'); }
  } else {
    const st = Math.floor((off + 6) / 3); // every 3 BPM up the build
    if (st > waveState) { if (waveState) { say(`BUILDING - target ${Math.round(c.currentSetpoint)}`); audio.sfx('burst'); } waveState = st; }
  }
}

function updateStreak(gdt) {
  if (controller.phase !== Phase.Training || controller.status !== Zone.InZone) { zoneStreak = 0; return; }
  const before = zoneStreak;
  zoneStreak += gdt;
  longestStreak = Math.max(longestStreak, zoneStreak);
  const m = streakMilestone(before, zoneStreak);
  if (!m) return;
  const bonus = 20 * Math.min(m, 8);
  score.score += bonus;
  if (m === 2) coach.line('streak30', 2); else if (m === 4) coach.line('streak60', 2); else if (m === 8) coach.line('streak120', 2);
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
  if (c.phase === Phase.WarmUp && c.status === Zone.InZone) return 'WARM-UP: ON PACE';
  if (charge && c.status !== Zone.SafetyBrake) return charge.stage === 'charge' ? 'CHARGE: ALL OUT' : 'COASTING';
  if (trendShown === 'climbing' && c.status === Zone.Below) return 'CLIMBING';
  if (trendShown === 'easing' && c.status === Zone.Above) return 'SETTLING';
  return { InZone: 'IN THE ZONE', Below: 'PICK IT UP', Above: 'EASE OFF', SafetyBrake: 'SAFETY BRAKE - SLOW DOWN', NoSignal: 'NO HEART-RATE SIGNAL' }[c.status];
}
const PROFILE_LABEL = { steady: 'steady', waves: 'waves', build: 'build & peak' };
const PHASE_LABEL = { WarmUp: 'WARM-UP', Training: 'TRAINING', CoolDown: 'COOL-DOWN', Finished: 'DONE' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const hudCompact = () => renderer.xr.isPresenting && controller.phase !== Phase.Finished && !options.open;
function drawHud(xr) {
  const c = controller, src = source();
  const compact = hudCompact();
  const fresh = sayFresh();
  // "~" and a muted colour while the heart rate is only estimated (phone asleep).
  const bpmText = src.hasReading && c.status !== Zone.NoSignal ? `${phoneFallback ? '~' : ''}${src.currentBpm}` : '--';
  const remaining = Math.max(0, c.phaseDuration - c.phaseElapsedSeconds);
  const statusLine = sourceKind === 'phone' ? remote.statusText : '';
  const boostPct = Math.round(boost.value * 100);
  const key = [bpmText, c.status, c.phase, Math.floor(remaining), Math.round(c.intensity * 100), score.score, score.combo,
    fresh ? lastEvent : '', statusLine, sourceKind, phoneFallback, workloadMode, link.code, xr, Math.round(c.currentSetpoint), c.s.targetBpm,
    Math.round(boostPct / 5), options.open, trendShown, settings.diag && `${lastPick}|${lastReason}|${projSmooth == null ? '' : Math.round(projSmooth)}`, Math.floor(zoneStreak), !!breathCue, spotlight && spotlight.key,
    spotlight && Math.ceil(spotlight.until - c.phaseElapsedSeconds), chargeLine(), actIdx, workoutShape, verdictShow && gameTime < verdictShow.until ? verdictShow.text : '', compact,
    today && today.id, workoutMinutes].join('|');
  if (key === hudKey) return;
  hudKey = key;

  const g = hctx, W = hudCanvas.width;
  g.clearRect(0, 0, W, hudCanvas.height);
  g.fillStyle = compact ? 'rgba(8,10,18,0.35)' : 'rgba(8,10,18,0.55)';
  g.beginPath(); g.roundRect(8, 8, W - 16, (compact ? 480 : hudCanvas.height) - 16, 28); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const zc = c.phase === Phase.Finished ? '#dfe3ea' : ZONE_COLOR[c.status];

  g.fillStyle = phoneFallback ? '#9aa3b5' : zc; g.font = '700 150px system-ui, sans-serif';
  g.fillText(bpmText, W / 2 - 50, 110);
  if (trendShown && c.phase !== Phase.Finished) { // arrow: where your heart rate is heading
    g.fillStyle = trendShown === 'climbing' ? '#4dff73' : '#7fd8ff'; g.font = '700 70px system-ui, sans-serif';
    g.fillText(trendShown === 'climbing' ? '\u25B2' : '\u25BC', W / 2 - 50 - bpmText.length * 46 - 50, 105);
  }
  g.fillStyle = '#dfe3ea'; g.font = '600 44px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText('BPM', W / 2 + (bpmText.length * 42), 128);
  if (c.phase !== Phase.Finished) { // time left in this part of the workout, big enough to read mid-move
    g.fillStyle = '#ffffff'; g.font = '700 58px system-ui, sans-serif';
    g.fillText(mmss(remaining), 40, 70);
    g.fillStyle = '#8d95a5'; g.font = '600 24px system-ui, sans-serif';
    g.fillText(`${PHASE_LABEL[c.phase]} LEFT`, 42, 120);
  }
  if (!compact) { g.fillStyle = '#ffb36b'; g.font = '600 28px system-ui, sans-serif'; g.fillText(`${Math.round(kcal)} kcal`, 42, 162); } // estimated from heart rate
  g.textAlign = 'center';

  const shaped = c.phase === Phase.Training && c.s.profile !== 'steady';
  const target = c.phase === Phase.WarmUp
    ? `target ${Math.round(c.currentSetpoint)} -> ${Math.round(c.trainingTarget(0))}`
    : shaped ? `target ${Math.round(c.currentSetpoint)} (${PROFILE_LABEL[c.s.profile]})` : `target ${c.s.targetBpm} +/-${c.s.zoneHalfWidth}`;
  g.fillStyle = zc; g.font = '600 40px system-ui, sans-serif';
  g.fillText(c.phase === Phase.Finished ? statusLabel(c) : `${statusLabel(c)}  ·  ${target}`, W / 2, 230);

  g.fillStyle = '#c9ced8'; g.font = compact ? '600 34px system-ui, sans-serif' : '30px system-ui, sans-serif';
  const srcName = sourceKind === 'sim' ? (workloadMode === 'Manual' ? `SIM HR (Manual, effort ${Math.round(manualWorkload * 100)}%)` : `SIM HR (${workloadMode})`) : phoneFallback ? 'ESTIMATED HR (phone asleep)' : 'PHONE HR';
  const boostText = ''; // the challenge boost shows as the red glow past the intensity bar
  g.fillText(c.phase === Phase.Finished ? 'WORKOUT COMPLETE'
    : options.open ? 'PAUSED - options open'
      : compact ? (c.phase === Phase.Training && actNow() ? `ACT ${actIdx + 1}/${acts.length}  ${actTitle(actIdx)}` : PHASE_LABEL[c.phase])
        : `${c.phase === Phase.Training && actNow() ? `ACT ${actIdx + 1}/${acts.length} ${actTitle(actIdx)}` : PHASE_LABEL[c.phase]} ${mmss(remaining)}  ·  intensity ${Math.round(c.intensity * 100)}%${boostText}  ·  ${srcName}`, W / 2, 290);

  const bx = 212, by = 325, bw = 600, bh = 22;
  if (!compact) {
  g.fillStyle = '#262a38'; g.beginPath(); g.roundRect(bx, by, bw, bh, 11); g.fill();
  g.fillStyle = `hsl(${190 - 175 * c.intensity} 85% 58%)`;
  g.beginPath(); g.roundRect(bx, by, Math.max(bh, bw * c.intensity), bh, 11); g.fill();
  if (boostPct >= 5) { // challenge boost shown as a glowing extension past the bar
    g.fillStyle = 'rgba(255,90,60,0.85)';
    g.beginPath(); g.roundRect(bx + bw + 8, by, 60 * boost.value, bh, 11); g.fill();
  }
  }

  g.fillStyle = '#ffffff'; g.font = '600 40px system-ui, sans-serif';
  if (c.phase === Phase.Finished) {
    const sw = lastSummary?.w; // same numbers as the board below
    const pctZone = sw ? sw.pct : Math.round((c.secondsInZone / Math.max(1, c.s.trainingSeconds)) * 100);
    const avgTxt = sw ? (sw.avgBpm || '--') : avgN ? Math.round(avgSum / avgN) : '--';
    const top = attribution.ranking()[0];
    g.font = '600 32px system-ui, sans-serif';
    g.fillText(`Score ${score.score}  ·  ${score.hits} hits${score.perfect ? ` (${score.perfect} perfect)` : ''}  ·  ${score.dodges + score.bombDodges} dodges${score.blocks ? `  ·  ${score.blocks} blocks` : ''}  ·  reactor level ${reactor.level}`, W / 2, 392, W - 60);
    const ld = tstat.landings || [], landTxt = ld.length ? `  ·  landings ${ld.filter((v) => v === 'perfect').length}/${ld.length}` : '';
    g.fillText(`Time in zone ${pctZone}%  ·  avg ${avgTxt} BPM${landTxt}  ·  best for you: ${top.label}`, W / 2, 436, W - 60);
    g.fillText(xr ? 'Press A to go again' : 'Press R to go again', W / 2, 480);
  } else if (fresh) {
    g.fillText(lastEvent, W / 2, 400, W - 60);
  } else if (c.phase === Phase.WarmUp && todayLine()) { // v58: today's named workout, then the week underneath
    g.fillStyle = today.colour || '#ffc04d'; g.font = '700 38px system-ui, sans-serif';
    g.fillText(todayLine(), W / 2, 394, W - 60);
    g.fillStyle = '#ffc04d'; g.font = '600 28px system-ui, sans-serif';
    g.fillText(weekLine(), W / 2, 440, W - 60);
  } else if (c.phase === Phase.WarmUp && (weekLine() || bestsLine())) {
    g.fillStyle = '#ffc04d'; g.font = '600 32px system-ui, sans-serif';
    g.fillText(weekLine() || bestsLine(), W / 2, 400, W - 60);
  }

  if (verdictShow && gameTime < verdictShow.until && c.phase !== Phase.Finished) { // the landing verdict beats everything for 6 s
    g.fillStyle = verdictShow.color; g.font = '700 38px system-ui, sans-serif';
    g.fillText(verdictShow.text, W / 2, 455, W - 50);
  } else if (charge && !breathCue && c.phase === Phase.Training) { // charge / coast takes the line over a spotlight
    g.fillStyle = charge.stage === 'charge' ? '#ff7a45' : '#7cffb0'; g.font = '600 32px system-ui, sans-serif';
    g.fillText(chargeLine(), W / 2, 455, W - 60);
  } else if (spotlight && !breathCue && c.phase === Phase.Training) {
    g.fillStyle = '#ffc04d'; g.font = '600 30px system-ui, sans-serif';
    g.fillText(`SPOTLIGHT: ${SPOTLIGHT_NAMES[spotlight.key]}  ${Math.max(0, Math.ceil(spotlight.until - c.phaseElapsedSeconds))}s`, W / 2, 455);
  }
  if (breathCue && c.phase !== Phase.Finished) { // its own line, so hit call-outs don't hide it
    g.fillStyle = '#7fd8ff'; g.font = '600 34px system-ui, sans-serif';
    g.fillText('Breathe with the reactor: 4 in, 6 out', W / 2, 455);
  }
  if (statusLine && !(compact && !phoneFallback && src.hasReading && src.secondsSinceLastReading < 5)) { // compact: only when something's wrong
    const ok = !phoneFallback && src.hasReading && src.secondsSinceLastReading < 5;
    g.fillStyle = ok ? '#b8bfcc' : '#ffd34d'; g.font = '26px system-ui, sans-serif';
    wrapText(g, statusLine, W / 2, 520, 900, 30);
  }
  if (compact && !settings.diag) { /* no footer on the compact board */ } else if (settings.diag && c.phase !== Phase.Finished) {
    // Diagnostics: what the game is doing right now (for test sessions).
    const top = attribution.ranking()[0];
    const proj = projSmooth == null ? '--' : Math.round(projSmooth);
    g.fillStyle = '#9fe8ff'; g.font = '22px ui-monospace, Consolas, monospace';
    g.fillText(`int ${Math.round(c.intensity * 100)}%  boost ${boostPct}%  effort->${proj} vs ${src.hasReading ? src.currentBpm : '--'}  sent: ${lastPick || '-'} (${lastReason || '-'})  learned top: ${top.key}  lr x${(attribution.learningRateNow() / attribution.lr).toFixed(1)}${sensorFlat ? '  SENSOR FLAT' : ''}`, W / 2, 595, W - 40);
  } else {
  g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif';
  const phoneLive = sourceKind === 'phone' && !phoneFallback && src.hasReading; // linked: no need to show the code
  const codeText = phoneLive ? 'phone live' : `code ${link.code}`;
  g.fillText(xr ? `${settings.gameType === 'touch' ? 'TOUCH MODE' : 'blue = left · orange = right'} · white curve = swing path · Y = options · ${codeText}`
    : `blue = left click · orange = right click · O = options · ${phoneLive ? 'phone live' : `phone code ${link.code}`} · ${VERSION}`, W / 2, 595);
  }

  g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = '600 30px system-ui, sans-serif';
  g.fillText(`SCORE ${score.score}`, 760, 60);
  g.font = '26px system-ui, sans-serif'; g.fillStyle = '#c9ced8';
  g.fillText(`combo ${score.combo} (best ${score.best})`, 760, 100);
  const zoneText = `in zone ${mmss(c.phase === Phase.Finished && lastSummary ? lastSummary.w.inZoneSeconds : c.secondsInZone)}`;
  const zoneW = g.measureText(`${zoneText}  `).width;
  g.fillText(zoneText, 760, 136);
  const gd = ghostNow(); // v58: ahead of / behind your last run of this shape, right after the time in zone
  if (gd != null && c.phaseElapsedSeconds >= 30) {
    g.fillStyle = gd >= 0 ? '#4dff73' : '#ff8a6b'; g.font = '600 24px system-ui, sans-serif';
    g.fillText(ghostLabel(gd), 760 + zoneW, 136);
    g.font = '26px system-ui, sans-serif'; g.fillStyle = '#c9ced8';
  }
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
    target: settings.targetBpm, minutes: settings.trainingMinutes, warmUp: settings.warmUpSeconds, profile: settings.profile, diag: settings.diag, source: sourceKind, sound: settings.sound,
    volume: Math.round(settings.volume * 10), challenge: settings.challenge,
    gameType: settings.gameType, moves: { ...settings.moves }, phase: controller.phase,
    musicStyle: settings.musicStyle, songAvailable, voice: settings.voice !== false, voiceOk: coach.available,
    ranking: attribution.ranking().map((r) => ({ ...r, bpmPer10: Math.round(r.bpmPer10) })),
  }),
  act: (id) => {
    audio.sfx('hit', { hand: 'right' });
    switch (id) {
      case 'target-': nudgeTarget(-5); break;
      case 'target+': nudgeTarget(5); break;
      case 'shape-steady': case 'shape-waves': case 'shape-build': setProfile(id.slice(6)); break;
      case 'shape-plan': setProgram(!settings.moves.program); break;
      case 'warmup-': setWarmUp(stepWarmUp(settings.warmUpSeconds, -1)); break;
      case 'warmup+': setWarmUp(stepWarmUp(settings.warmUpSeconds, 1)); break;
      case 'minutes-': settings.trainingMinutes = Math.max(1, settings.trainingMinutes - (settings.trainingMinutes > 5 ? 5 : 1)); controller.s.trainingSeconds = settings.trainingMinutes * 60; saveSettings(); break;
      case 'minutes+': settings.trainingMinutes = Math.min(60, settings.trainingMinutes + (settings.trainingMinutes >= 5 ? 5 : 1)); controller.s.trainingSeconds = settings.trainingMinutes * 60; saveSettings(); break;
      case 'src-phone': setSource('phone'); break;
      case 'src-sim': setSource('sim'); break;
      case 'sound': setSound(!settings.sound); break;
      case 'voice': settings.voice = !settings.voice; coach.setEnabled(settings.voice); saveSettings(); if (settings.voice) coach.say(coach.available ? 'Coach voice on.' : '', 1); say(settings.voice ? (coach.available ? 'Coach voice on' : 'Coach voice: no voices in this browser') : 'Coach voice off', 2); break;
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
      case 'music-song': case 'music-synth': case 'music-daily':
        settings.musicStyle = id.slice(6);
        applyMusic();
        saveSettings();
        break;
      default:
        if (id.startsWith('move-')) toggleMove(id.slice(5));
        break;
      case 'restart': startWorkout(); options.toggle(false); break;
      case 'diag': settings.diag = !settings.diag; saveSettings(); break;
      case 'note-slam': case 'note-guard': case 'note-fast': case 'note-great': addNote(NOTE_LABEL[id]); options.toggle(false); break;
      case 'test-guard': case 'test-sweep': case 'test-combo': case 'test-shift': case 'test-hammer':
      case 'test-heavy': case 'test-sled': case 'test-barrage': case 'test-bag': case 'test-ropes': case 'test-wall':
      case 'test-knee': case 'test-press': case 'test-chop': case 'test-tiptoe': case 'test-charge': case 'test-boss': testMove(id.slice(5)); options.toggle(false); break;
      case 'end': endPressed(); options.toggle(false); break;
      case 'save': saveWorkoutData(); break;
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
    <div class="mv-title">Workout shape</div>
    <div class="mv-grid">
      <label><input type="radio" name="profile" value="steady"> Steady (hold your target)</label>
      <label><input type="radio" name="profile" value="waves"> Waves (+/-5 BPM every few minutes)</label>
      <label><input type="radio" name="profile" value="build"> Build &amp; peak (start easy, finish hard)</label>
    </div>
    ${group('Orbs', ['jab', 'low', 'swing', 'hammer', 'power', 'pair', 'guard', 'trace', 'sweep'])}
    ${group('Workout plan', ['program', 'acts', 'boss'])}
    ${group('Whole-body moves', ['knee', 'press', 'chop', 'tiptoe', 'charge'])}
    ${group('Bursts (when you\'re stuck below your zone)', ['bag', 'ropes', 'heavy', 'sled', 'barrage'])}
    ${group('Walls & footwork', ['duck', 'squatSide', 'pose', 'lean', 'pillar', 'shift'])}
    <div class="muted" id="movesNote" style="font-size:12px"></div>`;
  box.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'gtype') setGameType(t.value);
    else if (t.name === 'profile') setProfile(t.value);
    else if (t.dataset.move) toggleMove(t.dataset.move, t.checked);
  });
  syncMovesUI();
}
function syncMovesUI() {
  const box = $('moves');
  if (!box || !box.firstChild) return;
  box.querySelectorAll('input[data-move]').forEach((el) => { el.checked = !!settings.moves[el.dataset.move]; });
  box.querySelectorAll('input[name=gtype]').forEach((el) => { el.checked = el.value === settings.gameType; });
  box.querySelectorAll('input[name=profile]').forEach((el) => { el.checked = el.value === settings.profile; });
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
    status: controller.status, target: Math.round(controller.currentSetpoint), intensity: controller.intensity.toFixed(3), boost: boost.value.toFixed(2),
    ...Object.fromEntries(ACTIVITIES.map((a) => [`reps_${a.key}`, attribution.counts[a.key]])),
    hits: score.hits, misses: score.misses, dodges: score.dodges, wallHits: score.wallHits,
    last_sent: lastPick, reason: lastReason, effort_bpm: projSmooth == null ? '' : Math.round(projSmooth), trend: trendShown || '',
    spotlight: spotlight ? spotlight.key : '', shift: shiftPlan ? 1 : 0, learned_top: attribution.ranking()[0].key,
    note: pendingNote,
  });
  pendingNote = '';
}
// Every workout's per-second log and events, kept on the headset (last 12, about 3 MB at most) and
// sent to the phone at the end. "Save data" downloads them all as one JSON file.
const workoutEvents = [];
function logEvent(type, data = {}) { if (workoutEvents.length < 4000) workoutEvents.push({ t: +gameTime.toFixed(1), type, ...data }); }
const HISTORY_KEY = 'pulsezone.history';
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function workoutRecord(summary) {
  const cols = sessionLog.length ? Object.keys(sessionLog[0]) : [];
  return {
    date: new Date(Date.now() - gameTime * 1000).toISOString(), version: VERSION, summary,
    name: summary?.name || today?.name || '', shape: workoutShape, level: summary?.level || null, badges: summary?.badges || [], // v58: for the phone's summary card
    settings: { targetBpm: settings.targetBpm, minutes: settings.trainingMinutes, warmUp: settings.warmUpSeconds, profile: settings.profile,
      challenge: settings.challenge, gameType: settings.gameType, moves: { ...settings.moves } },
    cols, rows: sessionLog.map((r) => cols.map((c) => r[c])), events: workoutEvents.slice(),
  };
}
function archiveWorkout(summary) {
  if (sessionLog.length < 30) return; // under 30 s: nothing worth keeping
  const rec = workoutRecord(summary);
  const hist = [...loadHistory(), rec].slice(-12);
  while (hist.length > 1 && JSON.stringify(hist).length > 3e6) hist.shift();
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); } catch { /* storage full: keep the latest only */
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify([rec])); } catch { /* give up */ }
  }
  sendToPhone(rec);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
/**
 * Send one workout to the linked phone in small pieces: PeerJS's JSON channel drops messages over
 * ~16 KB, and re-escaping the quotes inside each piece can nearly double it, so 6000 characters each.
 */
function sendToPhone(rec) {
  if (link.state !== 'linked') return false;
  const text = JSON.stringify({ app: 'PulseZone', version: VERSION, saved: new Date().toISOString(), workouts: [rec] });
  const id = Math.random().toString(36).slice(2, 8), size = 6000, n = Math.ceil(text.length / size);
  const name = `pulsezone-workout-${rec.date.slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const label = `${new Date(rec.date).toLocaleString()} · ${Math.max(1, Math.round(rec.rows.length / 60))} min`;
  for (let i = 0; i < n; i++) link.send({ t: 'wk', id, i, n, name, label, part: text.slice(i * size, (i + 1) * size) });
  return true;
}
function saveWorkoutData() {
  const all = loadHistory();
  if (controller.phase !== Phase.Finished && sessionLog.length >= 10) all.push(workoutRecord(null)); // the one in progress
  if (!all.length) { say('No workout data yet', 1); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'PulseZone', version: VERSION, saved: new Date().toISOString(), workouts: all })], { type: 'application/json' }));
  a.download = `pulsezone-workouts-${stamp()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  const phone = sendToPhone(all[all.length - 1]);
  say(`Saved ${all.length} workout${all.length > 1 ? 's' : ''} to Downloads${phone ? ' + sent the latest to your phone' : ''}`, 1);
}
/** End workout: the first press starts the 2-minute cool-down, a second press ends it right away. */
function endPressed() {
  if (controller.phase === Phase.CoolDown) controller.finishNow();
  else if (controller.phase !== Phase.Finished) {
    controller.beginCoolDown();
    say('COOL-DOWN: 2 easy minutes. Press End again (Options) to finish now', 1);
  }
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
$('weight').value = settings.weightLb; $('sex').value = settings.sex;
$('warmup').value = settings.warmUpSeconds;
$('sound').checked = settings.sound;
$('sound').addEventListener('change', (e) => setSound(e.target.checked));
$('apply').addEventListener('click', () => {
  settings.targetBpm = Number($('target').value) || 120;
  settings.age = Number($('age').value) || 30;
  settings.weightLb = Math.min(500, Math.max(60, Number($('weight').value) || 165));
  settings.sex = $('sex').value;
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
    onResetLearning: () => { try { localStorage.removeItem(GAINS_KEY); localStorage.removeItem(LEARN_N_KEY); } catch { /* ignore */ } attribution = new HeartRateAttribution(); },
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
  panel.link.replaceChildren(...`${url.origin}${url.pathname}${url.search}`.split(/(?<=\/)|(?=\?)/).flatMap((part) => [part, document.createElement('wbr')]));
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
    case 'KeyE': endPressed(); break;
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
  const st = stations.find((s) => s.arrived && !s.done);
  if (st) { punchTimer = 0.12; punchHand = hand; stationRep(st, st.group.position.clone().setY(standing - 0.2), 'NICE! '); return; } // desktop: a click = one rep
  if (heavy && heavy.age >= HEAVY_ARRIVE) { punchTimer = 0.12; punchHand = hand; heavyHit(hand, null, 0.7, hand === heavy.targetHand); return; }
  if (sled && sled.age >= SLED_ARRIVE) { // desktop: stand (let go of C), then hold C and click = one rep
    punchTimer = 0.12; punchHand = hand;
    if (sled.ready && sled.tucked) sledStroke(null); else say(sled.ready ? 'Hold C to squat as you push' : 'Let go of C to stand tall first', 2);
    return;
  }
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
    const b = bombs.find((x) => !x.passed && x.group.position.z > head.z - 2.5);
    if (b) wantLean = b.group.position.x - centerX > 0 ? -1 : 1; // lean away from the incoming bomb
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
const BURSTS = ['bag', 'ropes', 'heavy', 'sled'];
const burstActive = () => !!(bag || ropes || heavy || sled);
/** Slalom (v56): quick side-squat boxes, alternating left and right. False if the lane is busy. */
function spawnSlalom() {
  const n = slalomCount(difficulty.intensity), ws = difficulty.orbSpeed * 0.8;
  const span = (n - 1) * SLALOM.period * ws + Math.max(0.3, SLALOM.hold * ws);
  const plan = lanePlan('squatSide', { now: gameTime, speed: difficulty.orbSpeed, intensity: difficulty.intensity, depth: span });
  if (!laneFree(lane, plan)) return false;
  lane.push(plan);
  let side = Math.random() < 0.5 ? 'squatLeft' : 'squatRight';
  for (let i = 0; i < n; i++) {
    spawnWall(head, standing, side, 'squatSide', { hold: SLALOM.hold, behind: i * SLALOM.period * ws });
    side = side === 'squatLeft' ? 'squatRight' : 'squatLeft';
  }
  say('SLALOM! Dip left, dip right - quick!', 1);
  return true;
}
function trySpawn(activity, extra = {}) {
  if (activity === 'combo') return queuedCombo ? spawnCombo(head, standing, queuedCombo) : true;
  if (activity === 'barrage') return spawnBarrage(head, standing);
  if (BURSTS.includes(activity)) {
    if (pendingBurst && pendingBurstTest) return true; // a test burst is waiting: drop the automatic one
    pendingBurst = activity; pendingBurstTest = false;
    say({ bag: 'Speed bag coming...', ropes: 'Battle ropes coming...', heavy: 'Heavy bag coming...', sled: 'Sled run coming...' }[activity]);
    return true;
  }
  if (activity === 'squatSide' && difficulty.intensity >= SLALOM.from && Math.random() < SLALOM.chance) return spawnSlalom();
  const wallType = wallTypeFor(activity, Math.random, { ...settings.moves, intensity: difficulty.intensity });
  const kind = ACTIVITIES.find((a) => a.key === activity)?.kind;
  if (kind === 'wall' && !wallType) return true; // no wall shape allowed for this one: skip it
  const speed = difficulty.orbSpeed;
  const shots = activity === 'guard' && guardZonesFor(difficulty.intensity).length > 1 && difficulty.intensity > 0.4 && Math.random() < 0.45 ? 2 : 1;
  const plan = lanePlan(activity, {
    now: gameTime, speed, intensity: difficulty.intensity,
    depth: wallType ? wallDepth(wallType, speed * 0.8) : 0, dist: SLAM_DIST, shots,
  });
  if (!laneFree(lane, plan)) return false;
  if (plan) lane.push(plan);
  if (activity === 'slam') spawnSlam(head, standing, { dist: SLAM_DIST, speed });
  else if (wallType) spawnWall(head, standing, wallType, activity);
  else if (activity === 'trace' || activity === 'sweep') spawnTrace(head, standing, activity === 'sweep');
  else if (activity === 'pair') spawnPair(head, standing);
  else if (activity === 'low') spawnPair(head, standing, 'hook'); // v56: the lone knee-high orb was unclear
  else if (activity === 'guard') spawnGuardSet(head, standing, shots);
  else if (STATIONS[activity]) spawnStation(head, standing, activity);
  else if (activity === 'hammer') spawnHammers(head, standing);
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
  else if (!drifting && Math.abs(dx) > DRIFT_OUT) { drifting = true; say(dx > 0 ? '<<  Step back to the centre' : 'Step back to the centre  >>', 1); }
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
  if (shiftPlan || burstActive() || pendingBurst) return;
  if (testQueued && !forceShiftNext) return; // a test move goes first
  if (!forceShiftNext) {
    if (!settings.moves.shift) return;
    if (!PLAIN_ORBS.some((k) => enabledActivities(true)[k])) return; // shifts are plain punches only
    if (trendShown === 'climbing') return; // already working hard enough: your heart just needs time
  }
  if (!forceShiftNext && !shiftWanted({ status: controller.status, phase: controller.phase, intensity: controller.intensity, boost: boost.value, now: gameTime, readyAt: shiftReadyAt })) return;
  const start = gameTime + (SPAWN_DISTANCE - 0.5) / difficulty.orbSpeed + 0.4;
  const slot = { kind: 'orb', start: start - SHIFT.margin, end: start + SHIFT.seconds + SHIFT.margin, shift: true };
  if (!laneFree(lane, slot)) return;  // something solo is on its way: try again later
  lane.push(slot);
  forceShiftNext = false;
  lastPick = 'shift'; lastReason = 'shift';
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
  // One-way stages ('' -> 'go' -> 'back'), so each call-out fires exactly once.
  if (shiftSaid === '' && gameTime >= showFrom) { shiftSaid = 'go'; say(p.offset > 0 ? 'STEP RIGHT  >>' : '<<  STEP LEFT', 1); audio.sfx('burst'); }
  if (shiftSaid === 'go' && gameTime >= p.end) { shiftSaid = 'back'; say('Back to the centre'); }
  if (gameTime > p.end + SHIFT.margin) { shiftPlan = null; shiftSaid = ''; }
}


// ------------------------------------------------------------------ main loop

const head = new THREE.Vector3();
let standing = 1.6, lastLowAt = -99;
let lastTime = 0;
let finishedPlayed = false;

const skyTmp = new THREE.Color(), instTmp = new THREE.Vector3(), HIT_RED = new THREE.Color(0x5a0a0a); // reused every frame
function frame(time) {
  if (!Number.isFinite(time)) time = performance.now(); // a bad frame time would freeze the clock for good
  const rawDt = lastTime ? Math.max(0, Math.min(0.1, (time - lastTime) / 1000)) : 0;
  lastTime = Math.max(lastTime, time);
  const dt = rawDt * BASE_SPEED * (fastForward ? 5 : 1);
  const xr = renderer.xr.isPresenting;

  if (!xr) updateDesktop(rawDt, head);
  const btn = xrButtons();
  if (btn.b) options.toggle();                                   // B / Y = options
  if (btn.a && controller.phase === Phase.Finished && !options.open) startWorkout();
  const paused = options.open;
  if (paused !== laneHidden) setLaneVisible(!paused);
  const gdt = paused ? 0 : dt;                                   // game time stops while options are open

  camera.getWorldPosition(head);
  const onToes = gameTime < tiptoeUntil || stations.some((s) => s.key === 'tiptoe');
  standing = head.y > standing && !onToes ? head.y : head.y > standing ? standing : standing - 0.01 * gdt;
  if (xr) for (const f of fists) reachUp = Math.max(reachUp, Math.min(0.7, f.world.y - head.y)); // how far above your eyes you reach
  standing = Math.min(2.1, Math.max(1.0, standing));
  if (head.y < standing - 0.25) lastLowAt = gameTime; // for stand-tall boxes: did you actually get low?
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
    // (v56 fix: in v54 the charge line landed between this if and its else, so the cool-down drain
    // ran every frame and the boost could never grow - Gio's 2026-11-18 workout sat at boost 0.)
    if (controller.phase !== Phase.CoolDown) boost.update(gdt, { status: controller.status, intensity: controller.intensity, bpmTrend: controller.bpmTrend, climbing: trendShown === 'climbing', hold: sensorFlat || phoneFallback || !!charge });
    else boost.value = Math.max(0, boost.value - gdt / 10);
    if (charge) boost.value = 0; // the charge replaces the boost
    // Watch for a stuck sensor: the same BPM for a long time while you're clearly working.
    if (sourceKind === 'phone' && !phoneFallback && src.hasReading) {
      if (src.currentBpm !== flatBpm) { flatBpm = src.currentBpm; flatFor = 0; } else flatFor += gdt;
    } else { flatBpm = null; flatFor = 0; }
    const effortRpm = Object.values(attribution.fast).reduce((a, b) => a + b, 0);
    sensorFlat = sensorLooksFlat({ flatSeconds: flatFor, status: controller.status, effortRpm });
    if (sensorFlat && !flatWarned) flatWarned = say('Heart rate looks stuck - check the band is snug', 1); // retried until shown
    if (!sensorFlat && flatFor === 0) flatWarned = false;
    // Learn only from heart rate the game didn't make up (not while estimating from movement, not while stuck).
    const realBpm = sourceKind === 'phone' && src.hasReading && controller.status !== Zone.NoSignal && !phoneFallback && !sensorFlat ? src.currentBpm : null;
    attribution.update(gameTime, realBpm);
    if (realBpm != null) realHrSeconds += gdt;
    if (controller.phase === Phase.Training && (controller.status === Zone.Above || controller.status === Zone.SafetyBrake)) tstat.aboveSec += gdt;
    if (sensorFlat) tstat.flatSec += gdt;
    updateStreak(gdt);
    updateWaves();
    updateSpotlight();
    updateActs();
    updateGhost();
    updateBoss(gdt);
    updateCharge();
    if (gameTime - gainsSavedAt > 30) { gainsSavedAt = gameTime; saveGains(); }
    logTimer += gdt;
    if (logTimer >= 1) { logTimer = 0; logRow(); }
  }
  difficulty = boostDifficulty(difficultyFor(chargeIntensity(controller.intensity)), charge?.stage === 'charge' ? 1 : boost.value);
  updateTrend(rawDt, src);
  if (controller.phase === Phase.Training && src.hasReading && !paused) { avgSum += src.currentBpm; avgN++; }
  if (controller.phase !== Phase.Finished && src.hasReading && !paused) {
    kcal += kcalPerMinute(src.currentBpm, { age: settings.age, weightKg: settings.weightLb * 0.4536, sex: settings.sex }) * gdt / 60;
  }
  if (controller.status === Zone.InZone && lastStatus !== Zone.InZone && controller.phase !== Phase.Finished) audio.sfx('zone');
  // Voice coach (v57): zone news, spoken a few seconds after the status settles (heart rate wobbles at the edge).
  if (controller.status !== lastStatus) statusSince = gameTime;
  // (v58: "below" waits 12 s as intended; v57 marked it as said at 4 s, so it was almost never spoken. And the
  // line now says roughly how far off you are: Morty's "you're 8 below, bigger swings".)
  if (!paused && controller.phase === Phase.Training && !charge && controller.status !== voicedStatus && gameTime - statusSince > (controller.status === Zone.Below ? 12 : 4) && !(boss && !boss.left && boss.defeatedAt == null)) { // (on Guardian days its own lines carry the zone news)
    voicedStatus = controller.status;
    const off = src.hasReading ? Math.abs(controller.currentSetpoint - src.currentBpm) : 0;
    if (voicedStatus === Zone.InZone) coach.line('zoneIn', 2);
    else if (voicedStatus === Zone.Below) { if (trendShown === 'climbing') coach.line('climbing', 2); else if (!coach.line(off >= 15 ? 'below15' : off >= 10 ? 'below10' : 'below5', 2)) coach.line('below', 2); }
    else if (voicedStatus === Zone.Above) { if (!coach.line(off >= 10 ? 'above10' : 'above5', 2)) coach.line('above', 2); }
  }
  if (controller.phase !== lastPhase) {
    if (controller.phase === Phase.CoolDown) { coach.line('coolDown', 1); coolDownAt = gameTime; }
    else if (controller.phase === Phase.Training) { if (today?.boss && settings.moves.boss !== false && !boss) startBoss(); else coach.line('training', 2); }
    else if (controller.phase === Phase.WarmUp) { if (!(today && coach.line(today.restart ? 'restart' : `workout.${today.id}`, 2))) coach.line('warmUp', 2); } // v58: today's named workout
    lastPhase = controller.phase;
  }
  if (bossRetreatSayAt && gameTime >= bossRetreatSayAt) { bossRetreatSayAt = 0; coach.line('bossRetreat', 2); }
  if (boss && controller.phase !== Phase.Training && controller.phase !== Phase.WarmUp) endBoss();
  if (boss && (!boss.left || bossView.visible)) { bossView.group.position.set(centerX, 0, -18); bossView.update(boss, { dt: rawDt, time: gameTime, beat: beatPhase }); }
  if (controller.phase === Phase.CoolDown && coolDownAt != null && gameTime - coolDownAt > 45 && !recoveryVoiced) { recoveryVoiced = true; coach.line('recovery', 2); }
  if (controller.phase === Phase.Training && !last30Voiced && controller.phaseDuration - controller.phaseElapsedSeconds <= 30 && controller.phaseDuration - controller.phaseElapsedSeconds > 20) { last30Voiced = true; coach.line('last30', 2); }
  lastStatus = controller.status;
  if (controller.phase === Phase.Finished && !finishedPlayed) { finishedPlayed = true; audio.sfx('finish'); coach.line('finish', 1); saveSession(); finishWorkout(); }
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
      if (!burstActive() && !orbs.length && !walls.length && !traces.length && !guards.length && !slams.length && !bombs.length && !stations.length) {
        ({ bag: spawnBag, ropes: spawnRopes, heavy: spawnHeavy, sled: spawnSled })[pendingBurst](head, standing);
        lastPick = pendingBurst; lastReason = pendingBurstTest ? 'test' : 'burst'; // the diag line shows what actually came
        pendingBurst = null; pendingBurstTest = false;
        spawnTimer = 0;
      }
    } else if (!burstActive() && spawnTimer >= difficulty.spawnInterval) {
      // Pick what's next (or keep waiting for the move already picked), then only send it once its
      // arrival slot is free, so nothing crowds a rope, a wall box, a pair or a guard shot.
      // During a side shift only plain orbs come (offset to the side); anything queued waits.
      const arrive = gameTime + (SPAWN_DISTANCE - 0.5) / difficulty.orbSpeed;
      const inShift = shiftPlan && arrive >= shiftPlan.start - SHIFT.margin && arrive <= shiftPlan.end + SHIFT.margin;
      const plain = PLAIN_ORBS.filter((k) => enabledActivities(true)[k]);
      const activity = inShift ? (plain[Math.floor(Math.random() * plain.length)] || 'jab') : standNext ? 'stand' : queuedActivity || chooseActivity({
        intensity: difficulty.intensity, gains: attribution.w,
        status: charge ? (charge.stage === 'charge' ? Zone.Below : Zone.Above) : controller.status, // coasting = light moves
        boost: charge?.stage === 'charge' ? 1 : boost.value,
        baseWeights: spawnWeights(), enabled: { ...enabledActivities(true), ...(charge?.stage === 'charge' ? { tiptoe: false } : {}), // no light reaches mid-charge
          ...(controller.phase !== Phase.Training ? { press: false } : {}) }, // wall-ball rounds are training only (not in the warm-up)
      });
      // A plain punch sometimes becomes a combo; like other solo moves it waits for a free lane slot.
      let pick = activity;
      if (!inShift && !standNext && !queuedActivity && activity === 'jab' && controller.phase === Phase.Training && gameTime >= comboReadyAt && Math.random() < comboChance(difficulty.intensity)) {
        const en = enabledActivities(true);
        const list = availableCombos({ swing: en.swing, low: en.low });
        if (list.length) { queuedCombo = list[Math.floor(Math.random() * list.length)]; pick = 'combo'; }
      }
      const reason = inShift ? 'shift' : standNext ? 'stand-up' : queuedActivity ? (testQueued ? 'test' : 'queued')
        : pick === 'combo' ? 'combo' : spotlight && activity === spotlight.key ? 'spotlight'
          : charge ? charge.stage : boost.value > 0.2 && controller.status === Zone.Below ? 'boost' : 'mix';
      if (inShift) {
        trySpawn(activity, { shift: shiftOffsetAt(shiftPlan, arrive) });
        lastPick = activity; lastReason = reason;
        spawnTimer = 0;
      } else if (trySpawn(pick)) {
        lastPick = pick === 'combo' && queuedCombo ? `combo ${queuedCombo.name}` : pick; lastReason = reason;
        if (pick !== 'stand') { queuedActivity = null; queuedFor = 0; testQueued = false; } // a stand-up box keeps whatever was queued
        spawnTimer = 0;
      } else if (pick !== 'stand') {
        queuedActivity = pick;
        queuedFor += gdt;
        if (queuedFor > (testQueued ? 30 : 10)) { queuedActivity = null; queuedFor = 0; testQueued = false; } // give up and pick something else
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
    if (heavy) updateHeavy(gdt, xr);
    if (sled) updateSled(gdt, xr, head, standing);
    updateBombs(gdt, head);
    updateStations(gdt, xr, head);
  }
  updateShards(rawDt);
  updatePop(rawDt);

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
      score.miss(); audio.sfx('miss'); // a missed orb is not a rep: the model only learns from what you did
      logEvent('miss', { act: o.activity });
      if (o.combo) comboResult(o, false);
      removeOrb(o);
    }
  }

  // Walls: duck, step aside, lean left/right, squat left/right.
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    w.mesh.position.z += w.speed * gdt;
    const far = w.mesh.position.z, near = far + w.depth;
    if (!w.announced && near > head.z - 6) { w.announced = true; say(w.label, 1); }
    if (!w.faded && near > head.z - 1.0) { w.faded = true; if (!w.hit) w.fill.material = MAT.wallNear; }
    if (w.faded && w.hit && w.fill.material !== MAT.wallHitNear) w.fill.material = MAT.wallHitNear; // you've seen it: don't hide the scoreboard
    if (w.pose) { // pose wall (v57): count how long you hold the shape while the box passes
      const fl = fists.map((f) => [f.world.x - centerX, f.world.y]);
      const ok = xr && poseHeld(w.pose, [head.x - centerX, head.y], fl);
      w.rings.forEach((m, i) => { m.material = ok ? poseRingMat.held : poseRingMat[i === 0 ? 'left' : 'right']; });
      if (near >= head.z - 0.15 && far <= head.z) {
        w.inside += gdt; if (ok || SMOKE) w.held += gdt;
        if (!w.cued && ok) { w.cued = true; pulseBoth(0.4, 40); }
      }
    }
    // You're inside the box while its near face has passed you and its far face hasn't.
    if (!w.hit && near >= head.z && far <= head.z && wallHitsHead(w.poly, head.x - centerX, head.y)) {
      w.hit = true;
      w.fill.material = MAT.wallHit;
      score.wallHit();
      logEvent('wall-hit', { act: w.type });
      say(w.type === 'rise' ? 'Stand up!' : w.type === 'duck' || w.type.startsWith('squat') ? 'Get lower!' : 'Move over!', 1);
      audio.sfx('wall');
      pulseBoth(1, 120);
    }
    if (far > w.passZ) {
      if (w.pose) { // held the shape for most of the pass: a rep; otherwise it counts as a wall hit
        const need = POSE_HOLD * Math.max(0.2, w.depth / w.speed);
        if (w.held >= need) { score.dodge(); score.poses++; audio.sfx('dodge'); attribution.record('pose', gameTime); logEvent('pose', { act: w.type, held: +w.held.toFixed(2) }); if (w.type === 'poseLow') lastLowAt = gameTime; }
        else { score.wallHit(); logEvent('wall-hit', { act: w.type, held: +w.held.toFixed(2) }); say('Hold the shape - both fists in the rings!', 1); audio.sfx('wall'); pulseBoth(1, 120); }
        scene.remove(w.mesh); walls.splice(i, 1); continue;
      }
      // Would standing still have hit it? (A stand-tall box only counts if you were low just before.)
      const neededMove = w.type === 'rise' ? gameTime - lastLowAt < 4 : wallHitsHead(w.poly, 0, standing);
      if (!w.hit && neededMove) { score.dodge(); audio.sfx('dodge'); }
      if (w.activity && !w.hit && neededMove) attribution.record(w.activity, gameTime); // only when you actually ducked/squatted/stepped
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
  world.update(rawDt);
  // The act's tint over the world's own sky (in the classic grid world the act tint is the whole sky, as before).
  if (actNow() && controller.phase === Phase.Training) actSkyTarget.set(ACTS[actNow()].sky).lerp(world.sky, world.key === 'grid' ? 0 : 0.6);
  else actSkyTarget.copy(world.sky);
  actSkyNow.lerp(actSkyTarget, 1 - Math.exp(-rawDt / 3)); // ~3 s fade into each act's sky
  const zc = skyTmp.set(ZONE_COLOR[controller.phase === Phase.Finished ? 'NoSignal' : controller.status]).multiplyScalar(0.03 * (1 - 0.5 * zoneAmt)).add(actSkyNow).lerp(zoneSky, 0.5 * zoneAmt);
  scene.background.lerp(zc, 1 - Math.exp(-rawDt * 2));
  if (hitFlash > 0) { scene.background.lerp(HIT_RED, hitFlash * 0.6); hitFlash = Math.max(0, hitFlash - rawDt * 3); }
  scene.fog.color.copy(scene.background);

  // Layout: scoreboard ahead, heat gauge and options tab to its left, options board on the left.
  // v56 (Gio: "cleaner and further away so you can see what's coming up"): in the headset, while you
  // work out, the board is a compact strip high up and 5 m out, above the lane; the full board comes back at the end.
  if (hudCompact()) { hud.position.set(centerX, standing + 1.0, head.z - 5.2); hud.scale.setScalar(1.45); }
  else { hud.position.set(centerX, standing + 0.35, head.z - 3.2); hud.scale.setScalar(1); }
  if (summaryBoard.visible) { summaryBoard.position.set(centerX, standing - 1.0, head.z - 2.5); summaryBoard.rotation.x = -0.35; }
  if (progressBoard.visible) { progressBoard.position.set(centerX + 1.45, standing - 1.0, head.z - 2.25); progressBoard.rotation.set(-0.35, -0.55, 0); }
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
      lastPick, lastReason, dodges: score.dodges, wallHits: score.wallHits, bombDodges: score.bombDodges, bombHits: score.bombHits, boost: +boost.value.toFixed(2), spawnInterval: +difficulty.spawnInterval.toFixed(2),
      orbs: orbs.length, walls: walls.length, swingOrbs: orbs.filter((o) => o.swing).length, secondsInZone: Math.round(c.secondsInZone),
      reps: { ...attribution.counts }, ranking: attribution.ranking().map((r) => `${r.key} ${r.bpmPer10.toFixed(1)}`),
      optionsOpen: options.open, logRows: sessionLog.length, traces: traces.length, gameType: settings.gameType,
      powerOrbs: orbs.filter((o) => o.power).length, pairOrbs: orbs.filter((o) => o.activity === 'pair').length, shards: shards.length, draws: renderer.info.render.calls,
      bag: bag ? { hits: bag.hits, age: +bag.age.toFixed(1) } : null, ropes: ropes ? { on: +ropes.onTime.toFixed(1), pts: Math.round(ropes.points) } : null,
      pendingBurst, guards: guards.length, blocks: score.blocks, guardsMissed: score.guardsMissed, counters: orbs.filter((o) => o.counter).length,
      lane: lane.map((r) => `${r.kind} ${(r.start - gameTime).toFixed(1)}..${(r.end - gameTime).toFixed(1)}`), queued: queuedActivity,
      reactor: { charge: +reactor.charge.toFixed(2), level: reactor.level, state: reactor.state }, zoneAmt: +zoneAmt.toFixed(2), slams: slams.length, heavy: !!heavy, sled: !!sled, bombs: bombs.length, tstat, shift: shiftPlan, drifting, breath: breathCue, spotlight, sensorFlat, combosSent: comboSeq, comboOrbs: orbs.filter((o) => o.combo).length, seen, ghosts: ghostFists.left.visible || ghostFists.right.visible, trend: trendShown, zoneStreak: Math.floor(zoneStreak), longestStreak: Math.floor(longestStreak), summary: lastSummary, bests, projected: projSmooth == null ? null : Math.round(projSmooth),
      thermo: Object.fromEntries(Object.entries(thermo.uniforms).map(([k, v]) => [k, +v.value.toFixed(2)])),
      audio: audio.ctx ? audio.ctx.state : 'locked', tempo: Math.round(audio.tempo), musicMode: audio.musicMode, songAvailable,
      boss: boss && { state: boss.state, shield: +boss.shield.toFixed(1), core: +boss.core.toFixed(1), defeatedAt: boss.defeatedAt, left: !!boss.left, test: !!boss.test, shown: bossView.visible },
      today: today && { id: today.id, name: today.name, shape: today.shape, boss: today.boss, restart: today.restart, minutes: today.minutes, feature: today.feature }, workoutMinutes,
      ghost: ghost && { name: ghost.name, pct: ghost.pct, now: ghostNow() }, level: levelFor(bests?.totalZoneSeconds || 0), progress: lastSummary?.progress || null,
    };
  },
  toggleSource, startWorkout, nudgeTarget, options, audio,
  xr: xrDevice, // the emulated headset (only with ?emulate)
  /** Test helper (read-only): where everything is right now, for the scripted VR checks (test/xr-bot.js). */
  peek() {
    const v = (p) => [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
    return {
      t: gameTime, head: v(head), standing, centerX, paused: options.open, phase: controller.phase, events: workoutEvents.slice(-12), keyEvents: workoutEvents.filter((e) => ['charge', 'coast', 'landing', 'round'].includes(e.type)).slice(-8), charge: charge && { stage: charge.stage, peak: charge.peak && Math.round(charge.peak) }, act: actNow(), actIdx, acts: acts.map((a) => a.key), week, workoutShape, coach: stations[0]?.coach?.text || null, presenting: renderer.xr.isPresenting,
      fists: fists.map((f) => ({ hand: f.hand, at: v(f.world), speed: +f.speed.toFixed(2) })),
      orbs: orbs.filter((o) => !o.dying).map((o) => ({ at: v(o.group.position), r: o.r, hand: o.hand, swing: o.swing || null, activity: o.activity, power: !!o.power, speed: o.speed })),
      walls: walls.map((w) => ({ type: w.type, z: w.mesh.position.z, depth: w.depth, speed: w.speed, hit: w.hit, poly: w.poly, pose: w.pose, held: w.held })),
      guards: guards.map((g) => ({ zone: g.zone, z: g.group.position.z, speed: g.speed, hitZ: g.hitZ })),
      bombs: bombs.filter((b) => !b.passed).map((b) => ({ at: v(b.group.position), speed: b.speed, locked: !!b.locked })),
      slams: slams.map((s) => ({ at: v(s.group.position), speed: s.speed })),
      sled: sled && { age: sled.age, ready: sled.ready, tucked: sled.tucked, strokes: sled.strokes },
      ropes: ropes && { age: ropes.age, tier: ropes.tier, pumps: ropes.sides.map((s) => +s.pump.toFixed(2)), hard: +ropes.hardTime.toFixed(1), on: +ropes.onTime.toFixed(1) },
      heavy: !!heavy, bag: !!bag, traces: traces.length,
      stations: stations.map((s) => ({ key: s.key, stage: s.stage, reps: s.reps, need: s.need, arrived: s.arrived, done: !!s.done, held: +s.held.toFixed(2), duration: s.duration, base: s.base,
        points: Object.fromEntries(Object.entries(stationPoints(s)).map(([k, p]) => [k, v(p)])) })),
      reachUp: +reachUp.toFixed(2),
    };
  },
  /** Emulator only: start the VR session, as if you pressed ENTER VR. */
  enterVR() { vrButton.click(); },
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
      ...bombs.filter((b) => !b.passed).map((b) => ({ what: `bomb${b.id}`, a: (head.z - b.group.position.z) / b.speed, b: (head.z - b.group.position.z) / b.speed })),
      ...slams.map((s) => ({ what: 'slam', a: (head.z - 0.8 - s.group.position.z) / s.speed, b: (head.z - 0.2 - s.group.position.z) / s.speed })),
      ...traces.map((t) => ({ what: 'rope', a: (t.planeZ - t.group.position.z) / t.speed, b: (t.planeZ - t.group.position.z + t.length) / t.speed })),
      ...guards.map((g) => ({ what: `guard${g.seq}`, a: (g.hitZ - g.group.position.z) / g.speed, b: (g.hitZ - g.group.position.z) / g.speed })),
      ...stations.map((s) => { const a = s.arrived ? 0 : (s.stopZ - s.group.position.z) / s.speed; return { what: s.key, a, b: a + s.duration - s.held }; }),
    ];
    const plain = new Set(['jab', 'low']);
    const out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const p = items[i], q = items[j];
      if (plain.has(p.what) && plain.has(q.what)) continue;
      if (p.what === 'pair' && q.what === 'pair') continue;
      if (p.what === q.what && (p.what.startsWith('combo') || p.what.startsWith('bomb') || p.what.startsWith('guard'))) continue; // the same combo / barrage / 1-2
      if ((p.what === 'counter' && q.what.startsWith('guard')) || (q.what === 'counter' && p.what.startsWith('guard'))) continue;
      if (p.a < q.b + 0.25 && q.a < p.b + 0.25) out.push(`${p.what}~${q.what}`);
    }
    return out;
  },
  /** Test hook: run the drift guard as if your head were at x (VR only otherwise). */
  drift(x) { updateDrift({ x, z: head.z }, true, false); return drifting; },
  act: (id) => options.hooks.act(id),
  logRows: () => sessionLog,
};
