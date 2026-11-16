// PulseZone VR: WebXR game for Meta Quest Browser (also playable on desktop with a mouse).
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import {
  SimulatedHeart, SimulatedPlayer, RemoteHeartSource, ZoneController, Phase, Zone,
  evaluateDifficulty, estimatedMaxBpm, WALL_TYPES, pickWallType, wallPolygon, wallHitsHead,
  planOrb, swingMatches, heatLook,
} from './core.js?v4';
import { HostLink } from './link.js?v4';
import { AudioEngine } from './audio.js?v4';
import { HeartThermometer } from './thermo.js?v4';

const params = new URLSearchParams(location.search);
const SMOKE = params.has('smoke');            // automated play-through for testing
const BASE_SPEED = Number(params.get('speed')) || 1;
const PHONE_TIMEOUT = 6;                       // seconds without phone readings before estimating (controller gives up at 8)

// ------------------------------------------------------------------ settings

const SETTINGS_KEY = 'pulsezone.settings';
const settings = { targetBpm: 120, age: 30, trainingMinutes: 15, warmUpMinutes: 2, coolDownMinutes: 2, sound: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* ignore */ }
if (params.has('warmup')) settings.warmUpMinutes = Number(params.get('warmup'));
if (params.has('minutes')) settings.trainingMinutes = Number(params.get('minutes'));
if (params.has('cooldown')) settings.coolDownMinutes = Number(params.get('cooldown'));
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

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
// Floor stripes that rush toward you at orb speed: a feel for the pace.
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
const unlockAudio = () => audio.unlock();
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

// ------------------------------------------------------------------ fists (colour = hand)

const HAND_COLOR = { left: 0x3fa9ff, right: 0xff7a3d };
const FIST_R = 0.055;
function makeFist(hand) {
  // Slightly glove-shaped, in the same colour as that hand's orbs.
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(FIST_R, 20, 14),
    new THREE.MeshStandardMaterial({ color: HAND_COLOR[hand], emissive: HAND_COLOR[hand], emissiveIntensity: 0.25, roughness: 0.4 }),
  );
  m.scale.set(1, 0.85, 1.25);
  return { hand, mesh: m, speed: 0, vel: new THREE.Vector3(), last: new THREE.Vector3(), hasLast: false, world: new THREE.Vector3(), source: null };
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
  }
}
renderer.xr.addEventListener('sessionstart', () => {
  audio.unlock();
  setTimeout(() => { attachFistsForMode(); recenterSoon = true; }, 300);
});
renderer.xr.addEventListener('sessionend', () => { camera.position.set(0, 1.6, 0); camera.rotation.set(0, 0, 0); attachFistsForMode(); centerX = 0; });
attachFistsForMode();

function pulse(fist, strength = 0.6, ms = 40) {
  try { fist?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); } catch { /* not supported */ }
}
const pulseBoth = (s, ms) => fists.forEach((f) => pulse(f, s, ms));

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
let difficulty = evaluateDifficulty(0.15);
let signalLostToggle = false;
let avgSum = 0, avgN = 0;
let lastStatus = Zone.NoSignal;

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
  const maxBpm = estimatedMaxBpm(settings.age);
  settings.targetBpm = Math.max(80, Math.min(settings.targetBpm, Math.round(maxBpm * 0.85)));
  sim = new SimulatedHeart({ restingBpm: 65, maxBpm, seed: (Math.random() * 2 ** 31) | 0 });
  controller = new ZoneController({
    targetBpm: settings.targetBpm,
    safetyCeilingBpm: Math.min(maxBpm * 0.9, settings.targetBpm + 35),
    warmUpSeconds: settings.warmUpMinutes * 60,
    trainingSeconds: settings.trainingMinutes * 60,
    coolDownSeconds: settings.coolDownMinutes * 60,
  });
  signalLostToggle = false;
  phoneFallback = false;
  avgSum = avgN = 0;
  finishedPlayed = false;
  clearObstacles();
  score.reset();
  hudKey = '';
  recenterSoon = true;
}

function nudgeTarget(delta) {
  const maxBpm = estimatedMaxBpm(settings.age);
  settings.targetBpm = Math.max(80, Math.min(settings.targetBpm + delta, Math.round(maxBpm * 0.85)));
  controller.s.targetBpm = settings.targetBpm;
  controller.s.safetyCeilingBpm = Math.min(maxBpm * 0.9, settings.targetBpm + 35);
  saveSettings();
  updatePanel(true);
}

function toggleSource() {
  userChoseSource = true;
  sourceKind = sourceKind === 'sim' ? 'phone' : 'sim';
  phoneFallback = false;
  say(sourceKind === 'sim' ? 'Simulated heart rate' : 'Phone heart rate');
  updatePanel(true);
}

/** Phone went quiet (screen locked?): keep the workout adapting from movement until it's back. */
function updatePhoneFallback(xr, dt) {
  if (sourceKind !== 'phone') { phoneFallback = false; return; }
  if (!phoneFallback && remote.hasReading && remote.secondsSinceLastReading > PHONE_TIMEOUT) {
    phoneFallback = true;
    // Start the estimate from the last real reading so the game doesn't jump.
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
    // Sideways leaning counts as well as squatting.
    const bodyMove = Math.hypot(head.y - motion.lastHead.y, (head.x - motion.lastHead.x) * 0.7) / dt;
    motion.head += (Math.min(2, bodyMove) - motion.head) * a;
  }
  motion.lastHead.copy(head); motion.lastL.copy(l); motion.lastR.copy(r); motion.has = true;
  motion.workload = Math.min(1, 0.12 + 0.55 * Math.min(1, motion.hand / 2.2) + 0.45 * Math.min(1, motion.head / 0.6));
}

// ------------------------------------------------------------------ score

const score = {
  reset() { Object.assign(this, { score: 0, combo: 0, best: 0, hits: 0, misses: 0, weak: 0, wrong: 0, dodges: 0, wallHits: 0 }); },
  inZone: () => controller?.status === Zone.InZone,
  hit(bonus = 1) {
    this.hits++; this.combo++; this.best = Math.max(this.best, this.combo);
    const pts = Math.round(10 * bonus * Math.min(4, 1 + Math.floor(this.combo / 10)) * (this.inZone() ? 2 : 1));
    this.score += pts;
    say(this.inZone() ? `+${pts}  IN ZONE x2` : `+${pts}`);
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

// ------------------------------------------------------------------ orbs, walls, bursts

const orbGeo = new THREE.SphereGeometry(1, 24, 16);
const ringGeo = new THREE.TorusGeometry(1.25, 0.12, 8, 32);
const arrowGeo = new THREE.ConeGeometry(0.45, 0.9, 16);
const burstGeo = new THREE.SphereGeometry(1, 12, 8);
const orbMat = (hand) => new THREE.MeshStandardMaterial({ color: HAND_COLOR[hand], emissive: HAND_COLOR[hand], emissiveIntensity: 0.35, roughness: 0.3 });
const MAT = {
  left: orbMat('left'),
  right: orbMat('right'),
  weak: new THREE.MeshStandardMaterial({ color: 0x80808c, roughness: 0.5 }),
  ring: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  arrow: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  wall: new THREE.MeshBasicMaterial({ color: 0xd94cf2, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
  wallEdge: new THREE.LineBasicMaterial({ color: 0xf5a3ff }),
  wallHit: new THREE.MeshBasicMaterial({ color: 0xff2626, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
};
const orbs = [], walls = [], bursts = [];
let spawnTimer = 0, wallCooldown = 0;
let centerX = 0;           // your "home" position; walls are built around it
let recenterSoon = true;

function clearObstacles() {
  for (const o of [...orbs, ...walls, ...bursts]) scene.remove(o.mesh);
  orbs.length = walls.length = bursts.length = 0;
  spawnTimer = 0;
}

function spawnWall(head, standing, type) {
  const poly = wallPolygon(type, standing);
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x + centerX, y)));
  const group = new THREE.Group();
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), MAT.wall);
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(poly.map(([x, y]) => new THREE.Vector3(x + centerX, y, 0))), MAT.wallEdge);
  group.add(fill, edge);
  group.position.z = head.z - 14;
  scene.add(group);
  walls.push({
    mesh: group, fill, poly, type, speed: difficulty.orbSpeed * 0.8, passZ: head.z + 0.6, hit: false, announced: false,
    label: WALL_TYPES.find((w) => w.type === type).label,
  });
  wallCooldown = 1.4; // room to recover before the next one
}

function spawnOrb(head, standing) {
  const d = difficulty;
  const heavy = Math.random() < d.heavyOrbChance;
  const r = heavy ? 0.16 : 0.125;
  const x = (Math.random() * 2 - 1) * d.horizontalSpread;
  const { hand, swing } = planOrb(x, d);
  const mesh = new THREE.Mesh(orbGeo, MAT[hand]);
  mesh.scale.setScalar(r);
  const chest = standing - 0.35;
  mesh.position.set(centerX + x, Math.max(0.5, chest + (Math.random() * 1.4 - 1) * d.verticalSpread), head.z - 14);
  if (heavy) {
    const ring = new THREE.Mesh(ringGeo, MAT.ring); // white ring = needs two hits
    mesh.add(ring);
  }
  if (swing) {
    // White arrow on the front of the orb showing which way to swing.
    const arrow = new THREE.Mesh(arrowGeo, MAT.arrow);
    arrow.position.z = 1.05;
    arrow.rotation.z = swing === 'up' ? 0 : swing === 'left' ? Math.PI / 2 : -Math.PI / 2;
    mesh.add(arrow);
  }
  scene.add(mesh);
  orbs.push({ mesh, r, hand, swing, speed: d.orbSpeed, hits: heavy ? 2 : 1, minPunch: d.minPunchSpeed, immuneUntil: 0, flashUntil: 0, heavy, passZ: head.z + 0.6 });
}

/**
 * A fist touched an orb. `fist` is null for desktop clicks / smoke test, in which case
 * `hand` says which hand was used and swing direction isn't checked.
 */
function tryHit(orb, fist, hand = fist?.hand, speed = fist ? fist.speed : 3) {
  const t = now();
  if (t < orb.immuneUntil) return false;
  orb.immuneUntil = t + 0.25;
  const flashWeak = () => { orb.mesh.material = MAT.weak; orb.flashUntil = t + 0.15; };

  if (hand !== orb.hand) {
    score.wrongHand(orb.hand);
    audio.sfx('wrong');
    pulse(fist, 0.2, 30);
    flashWeak();
    return false;
  }
  if (speed < orb.minPunch) {
    score.weakHit();
    audio.sfx('weak');
    pulse(fist, 0.2, 20);
    flashWeak();
    return false;
  }
  if (fist && orb.swing && !swingMatches(orb.swing, [fist.vel.x, fist.vel.y, fist.vel.z])) {
    score.weakHit(orb.swing === 'up' ? 'Uppercut - swing up!' : 'Hook - swing sideways!');
    audio.sfx('weak');
    flashWeak();
    return false;
  }
  orb.hits--;
  pulse(fist, 0.8, 50);
  if (orb.hits > 0) {
    orb.r *= 0.8;
    orb.mesh.scale.setScalar(orb.r);
    orb.mesh.position.z -= 0.4;
    audio.sfx('crack');
    return true;
  }
  score.hit(orb.swing ? 1.5 : 1);
  audio.sfx(orb.heavy ? 'heavy' : 'hit', { hand });
  const b = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color: HAND_COLOR[orb.hand], transparent: true }));
  b.position.copy(orb.mesh.position);
  b.scale.setScalar(orb.r);
  scene.add(b);
  bursts.push({ mesh: b, age: 0, r: orb.r });
  scene.remove(orb.mesh);
  orbs.splice(orbs.indexOf(orb), 1);
  return true;
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

// Heat gauge to the left of the scoreboard.
const thermo = new HeartThermometer();
thermo.mesh.scale.setScalar(1.3);
scene.add(thermo.mesh);

const ZONE_COLOR = {
  InZone: '#4dff73', Below: '#59b3ff', Above: '#ff9933', SafetyBrake: '#ff3333', NoSignal: '#999999',
};
function statusLabel(c) {
  if (c.phase === Phase.Finished) return 'NICE WORK';
  if (c.phase === Phase.CoolDown && c.status !== Zone.SafetyBrake) return 'COOLING DOWN';
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
  const key = [bpmText, c.status, c.phase, Math.floor(remaining), Math.round(c.intensity * 100), score.score, score.combo,
    fresh ? lastEvent : '', statusLine, sourceKind, phoneFallback, workloadMode, link.code, xr, Math.round(c.currentSetpoint), c.s.targetBpm].join('|');
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
  g.fillStyle = '#dfe3ea'; g.font = '600 44px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText('BPM', W / 2 + (bpmText.length * 42), 128);
  g.textAlign = 'center';

  const target = c.phase === Phase.WarmUp
    ? `target ${Math.round(c.currentSetpoint)} -> ${c.s.targetBpm}`
    : `target ${c.s.targetBpm} +/-${c.s.zoneHalfWidth}`;
  g.fillStyle = zc; g.font = '600 40px system-ui, sans-serif';
  g.fillText(c.phase === Phase.Finished ? statusLabel(c) : `${statusLabel(c)}  ·  ${target}`, W / 2, 230);

  g.fillStyle = '#c9ced8'; g.font = '32px system-ui, sans-serif';
  const srcName = sourceKind === 'sim' ? `SIMULATED HR (${workloadMode})` : phoneFallback ? 'ESTIMATED HR (phone asleep)' : 'PHONE HR';
  g.fillText(c.phase === Phase.Finished ? 'WORKOUT COMPLETE'
    : `${PHASE_LABEL[c.phase]} ${mmss(remaining)}  ·  intensity ${Math.round(c.intensity * 100)}%  ·  ${srcName}`, W / 2, 290);

  // intensity bar
  const bx = 212, by = 325, bw = 600, bh = 22;
  g.fillStyle = '#262a38'; g.beginPath(); g.roundRect(bx, by, bw, bh, 11); g.fill();
  g.fillStyle = `hsl(${190 - 175 * c.intensity} 85% 58%)`;
  g.beginPath(); g.roundRect(bx, by, Math.max(bh, bw * c.intensity), bh, 11); g.fill();

  g.fillStyle = '#ffffff'; g.font = '600 40px system-ui, sans-serif';
  if (c.phase === Phase.Finished) {
    const pctZone = Math.round((c.secondsInZone / Math.max(1, c.s.trainingSeconds)) * 100);
    g.font = '600 34px system-ui, sans-serif';
    g.fillText(`Score ${score.score}  ·  ${score.hits} hits  ·  ${score.dodges} dodges`, W / 2, 395);
    g.fillText(`Time in zone ${pctZone}%  ·  avg ${avgN ? Math.round(avgSum / avgN) : '--'} BPM`, W / 2, 440);
    g.fillText(xr ? 'Press A to go again' : 'Press R to go again', W / 2, 485);
  } else if (fresh) {
    g.fillText(lastEvent, W / 2, 400);
  }

  if (statusLine) {
    const ok = !phoneFallback && src.hasReading && src.secondsSinceLastReading < 5;
    g.fillStyle = ok ? '#b8bfcc' : '#ffd34d'; g.font = '26px system-ui, sans-serif';
    wrapText(g, statusLine, W / 2, 520, 900, 30);
  }
  g.fillStyle = '#8d95a5'; g.font = '24px system-ui, sans-serif';
  g.fillText(xr ? `blue orbs = left hand · orange = right · B/Y: sim <-> phone · code ${link.code}`
    : `blue orbs = left click · orange = right click · phone code ${link.code}`, W / 2, 595);

  // score block
  g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = '600 30px system-ui, sans-serif';
  g.fillText(`SCORE ${score.score}`, 760, 60);
  g.font = '26px system-ui, sans-serif'; g.fillStyle = '#c9ced8';
  g.fillText(`combo ${score.combo} (best ${score.best})`, 760, 100);
  g.fillText(`in zone ${mmss(c.secondsInZone)}`, 760, 136);

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

// ------------------------------------------------------------------ DOM panel

const $ = (id) => document.getElementById(id);
const panel = { code: $('code'), link: $('bridgeLink'), srcName: $('srcName'), srcStatus: $('srcStatus') };
$('target').value = settings.targetBpm; $('age').value = settings.age; $('minutes').value = settings.trainingMinutes;
$('sound').checked = settings.sound;
$('sound').addEventListener('change', (e) => { settings.sound = e.target.checked; audio.setEnabled(settings.sound); saveSettings(); });
$('apply').addEventListener('click', () => {
  settings.targetBpm = Number($('target').value) || 120;
  settings.age = Number($('age').value) || 30;
  settings.trainingMinutes = Math.max(1, Number($('minutes').value) || 15);
  saveSettings();
  startWorkout();
  $('apply').blur();
});
$('srcBtn').addEventListener('click', (e) => { toggleSource(); e.target.blur(); });
$('hide').addEventListener('click', () => { $('panel').style.display = 'none'; $('show').style.display = 'block'; });
$('show').addEventListener('click', () => { $('panel').style.display = ''; $('show').style.display = 'none'; });
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
    case 'KeyM': settings.sound = !settings.sound; audio.setEnabled(settings.sound); $('sound').checked = settings.sound; saveSettings(); break;
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
  if (e.button === 0) desktopPunch('left');
  else if (e.button === 2) desktopPunch('right');
});

function desktopPunch(hand) {
  raycaster.setFromCamera(pointer, camera);
  raycaster.far = 3.2;
  punchTimer = 0.15;
  punchHand = hand;
  punchPoint.copy(raycaster.ray.at(1.0, new THREE.Vector3()));
  const hits = raycaster.intersectObjects(orbs.map((o) => o.mesh), false);
  if (hits.length) {
    punchPoint.copy(hits[0].point);
    const orb = orbs.find((o) => o.mesh === hits[0].object);
    if (orb) tryHit(orb, null, hand, 3);
  }
}

let duckY = 0, leanX = 0;
function updateDesktop(dt, head) {
  // C = duck, A / D = lean left / right (the smoke test steers itself around walls).
  let wantDuck = keys.has('KeyC') || keys.has('ControlLeft');
  let wantLean = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (SMOKE) {
    const w = walls.find((x) => !x.hit && x.mesh.position.z > head.z - 2.5 && x.mesh.position.z < head.z + 0.3);
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

  // Fists follow the mouse; the clicked hand jabs to the target. Positions are camera-local.
  raycaster.setFromCamera(pointer, camera);
  punchTimer -= dt;
  // Fists rest low in the corners (so they don't look like orbs) and jab out on click.
  for (const f of fists) {
    const rest = new THREE.Vector3(f.hand === 'left' ? -0.24 : 0.24, -0.3, -0.38);
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

// ------------------------------------------------------------------ main loop

const head = new THREE.Vector3();
let standing = 1.6;
let lastTime = 0;
let finishedPlayed = false;

function frame(time) {
  const rawDt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0;
  lastTime = time;
  const dt = rawDt * BASE_SPEED * (fastForward ? 5 : 1);
  const xr = renderer.xr.isPresenting;

  if (!xr) updateDesktop(rawDt, head);
  const btn = xrButtons();
  if (btn.b) toggleSource();
  if (btn.a && controller.phase === Phase.Finished) startWorkout();

  camera.getWorldPosition(head);
  standing = head.y > standing ? head.y : standing - 0.01 * dt;
  standing = Math.min(2.1, Math.max(1.0, standing));
  if (recenterSoon && (!xr || head.y > 0.8)) { centerX = xr ? head.x : 0; recenterSoon = false; }

  for (const f of fists) {
    f.mesh.getWorldPosition(f.world);
    if (f.hasLast && rawDt > 0) {
      const inst = f.world.clone().sub(f.last).divideScalar(rawDt);
      f.vel.lerp(inst, 1 - Math.exp(-rawDt / 0.04));
      f.speed = Math.max(inst.length(), f.speed - 8 * rawDt);
    }
    f.last.copy(f.world);
    f.hasLast = true;
  }
  updateMotion(rawDt, head);

  // Heart rate -> controller -> difficulty.
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
  controller.tick(source(), dt);
  difficulty = evaluateDifficulty(controller.intensity);
  if (controller.phase === Phase.Training && source().hasReading) { avgSum += source().currentBpm; avgN++; }
  if (controller.status === Zone.InZone && lastStatus !== Zone.InZone && controller.phase !== Phase.Finished) audio.sfx('zone');
  lastStatus = controller.status;
  if (controller.phase === Phase.Finished && !finishedPlayed) { finishedPlayed = true; audio.sfx('finish'); }
  audio.update({ intensity: controller.intensity, status: controller.status, bpm: source().hasReading ? source().currentBpm : 0, phase: controller.phase });

  // Spawning.
  if (controller.phase !== Phase.Finished) {
    spawnTimer += dt;
    wallCooldown -= dt;
    if (spawnTimer >= difficulty.spawnInterval && wallCooldown <= 0) {
      spawnTimer = 0;
      const wallType = Math.random() < difficulty.obstacleChance ? pickWallType(difficulty.intensity) : null;
      if (wallType) spawnWall(head, standing, wallType);
      else spawnOrb(head, standing);
    }
  }

  // Orbs.
  const t = now();
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.mesh.position.z += o.speed * dt;
    if (o.flashUntil && t > o.flashUntil) { o.flashUntil = 0; o.mesh.material = MAT[o.hand]; }
    if (xr) {
      for (const f of fists) {
        if (f.world.distanceTo(o.mesh.position) < o.r + FIST_R + 0.02) { tryHit(o, f); break; }
      }
    }
    if (SMOKE && orbs[i] === o && o.mesh.position.z > head.z - 1.2) tryHit(o, null, o.hand, 5);
    if (orbs[i] === o && o.mesh.position.z > o.passZ) { score.miss(); audio.sfx('miss'); scene.remove(o.mesh); orbs.splice(i, 1); }
  }

  // Walls: duck, step aside, lean left/right, squat left/right.
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    const prevZ = w.mesh.position.z;
    w.mesh.position.z += w.speed * dt;
    if (!w.announced && w.mesh.position.z > head.z - 6) { w.announced = true; say(w.label); }
    if (!w.hit && prevZ < head.z && w.mesh.position.z >= head.z && wallHitsHead(w.poly, head.x - centerX, head.y)) {
      w.hit = true;
      w.fill.material = MAT.wallHit;
      score.wallHit();
      say(w.type === 'duck' || w.type.startsWith('squat') ? 'Get lower!' : 'Move over!');
      audio.sfx('wall');
      pulseBoth(1, 120);
    }
    if (w.mesh.position.z > w.passZ) {
      if (!w.hit) { score.dodge(); audio.sfx('dodge'); }
      scene.remove(w.mesh);
      walls.splice(i, 1);
    }
  }

  // Bursts.
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.age += rawDt;
    const k = b.age / 0.25;
    b.mesh.scale.setScalar(b.r * (1 + 0.8 * k)); // small: punches land at arm's length
    b.mesh.material.opacity = 1 - k;
    if (k >= 1) { scene.remove(b.mesh); b.mesh.material.dispose(); bursts.splice(i, 1); }
  }

  // Floor stripes move at orb speed.
  for (const s of stripes) {
    s.position.z += difficulty.orbSpeed * dt;
    if (s.position.z > 1) s.position.z -= 28;
  }

  // Sky tints with your zone.
  const zc = new THREE.Color(ZONE_COLOR[controller.phase === Phase.Finished ? 'NoSignal' : controller.status]).multiplyScalar(0.03).add(skyBase);
  scene.background.lerp(zc, 1 - Math.exp(-rawDt * 2));
  scene.fog.color.copy(scene.background);

  hud.position.set(centerX, standing + 0.35, head.z - 3.2);
  thermo.mesh.position.set(centerX - 1.65, standing + 0.3, head.z - 3.1);
  const src = source();
  const hasSignal = src.hasReading && controller.status !== Zone.NoSignal;
  thermo.update(rawDt, {
    bpm: src.currentBpm, hasSignal, target: controller.s.targetBpm, halfWidth: controller.s.zoneHalfWidth,
    maxBpm: estimatedMaxBpm(settings.age) + 5,
    look: controller.phase === Phase.Finished ? { cold: 0, flame: 0.3, hyper: 0 } : heatLook(controller.status, src.currentBpm, controller.s.targetBpm),
  });
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

// For automated tests / debugging in the console.
window.pz = {
  get state() {
    const c = controller, s = source();
    return {
      phase: c.phase, status: c.status, intensity: +c.intensity.toFixed(3), bpm: s.currentBpm, hasReading: s.hasReading,
      sourceKind, phoneFallback, workloadMode, code: link.code, link: link.state, remoteStatus: remote.statusText,
      score: score.score, hits: score.hits, misses: score.misses, wrong: score.wrong, weak: score.weak, dodges: score.dodges, wallHits: score.wallHits,
      orbs: orbs.length, walls: walls.length, wallTypes: walls.map((w) => w.type), secondsInZone: Math.round(c.secondsInZone),
      thermo: Object.fromEntries(Object.entries(thermo.uniforms).map(([k, v]) => [k, +v.value.toFixed(2)])),
      audio: audio.ctx ? audio.ctx.state : 'locked',
    };
  },
  toggleSource, startWorkout, nudgeTarget,
  /** Test helper: render one frame and save the canvas via the local dev server. */
  async snapshot(name = 'snap') {
    frame(lastTime + 33);
    const data = renderer.domElement.toDataURL('image/png');
    return (await fetch(`/__snapshot?name=${name}`, { method: 'POST', body: data })).text();
  },
  /** Advance the game by `seconds` of real time in fixed frames (works even when the tab isn't drawing). */
  step(seconds, fps = 30) {
    const ms = 1000 / fps;
    for (let i = 0; i < seconds * fps; i++) frame(lastTime + ms);
    return this.state;
  },
  /** Test helper: pretend the phone sent a reading. */
  phone(bpm) { remote.push(bpm); if (sourceKind === 'sim' && !userChoseSource) sourceKind = 'phone'; },
};
