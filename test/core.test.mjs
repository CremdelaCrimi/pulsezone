// Closed-loop workout simulations + Bluetooth parser checks for js/core.js.
// Run:  node test/core.test.mjs     (exit code 0 = all passed)
import {
  SimulatedHeart, SimulatedPlayer, RemoteHeartSource, ZoneController, Phase, Zone,
  evaluateDifficulty, parseHeartRateMeasurement, wallPolygon, wallHitsHead, pickWallType, planOrb, swingMatches, heatLook,
  ACTIVITY_KEYS, chooseActivity, wallTypeFor, ChallengeBoost, boostDifficulty, HeartRateAttribution, musicTempo, mulberry32,
  wallDepth, tracePath, traceSeconds, tracePoints, sweepPath, sweepSeconds, SWEEP_HALF_GAP, onRope, TRACE_RADIUS, LOW_WALLS, wallTypeFor as wallFor, minPunchTravel, powerPunchSpeed, punchPower, bagPoints, lanePlan, laneFree,
} from '../js/core.js';

const DT = 0.05;
let failures = 0;
const check = (ok, what) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`);
  if (!ok) failures++;
};
const pct = (x) => `${Math.round(x * 100)}%`;
const seedOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 17);

function run(name, target, compliance, { ceiling = 165, complianceAt, forcedAt, lostAt } = {}) {
  const heart = new SimulatedHeart({ seed: seedOf(name) });
  const player = new SimulatedPlayer();
  player.compliance = compliance;
  const ctrl = new ZoneController({ targetBpm: target, safetyCeilingBpm: ceiling });
  const r = { maxBpm: 0, maxJump: 0, brakeSeconds: 0, minWhileBraking: 1, noSignalSeconds: 0 };
  let settled = 0, inZone = 0, iSum = 0, iN = 0, prev = ctrl.intensity, t = 0;

  console.log(`\n== ${name}`);
  while (ctrl.phase !== Phase.Finished && t < 3600) {
    if (complianceAt) player.compliance = complianceAt(t);
    const w = player.tick(ctrl.intensity, DT);
    const forced = forcedAt ? forcedAt(t) : null;
    heart.workload = forced ?? w;
    heart.signalLost = lostAt ? lostAt(t) : false;
    heart.tick(DT);
    ctrl.tick(heart, DT);
    t += DT;

    if (heart.hasReading) r.maxBpm = Math.max(r.maxBpm, heart.currentBpm);
    if (ctrl.phase !== Phase.Finished) r.maxJump = Math.max(r.maxJump, Math.abs(ctrl.intensity - prev) / DT);
    prev = ctrl.intensity;
    if (ctrl.status === Zone.SafetyBrake) {
      r.brakeSeconds += DT;
      if (r.brakeSeconds > 20) r.minWhileBraking = Math.min(r.minWhileBraking, ctrl.intensity);
    }
    if (ctrl.status === Zone.NoSignal && t > 5) r.noSignalSeconds += DT;
    if (ctrl.phase === Phase.Training) {
      iSum += ctrl.intensity; iN++;
      const excluded = forced != null || heart.signalLost || ctrl.status === Zone.NoSignal;
      if (ctrl.phaseElapsedSeconds > 180 && !excluded) {
        settled += DT;
        if (ctrl.status === Zone.InZone) inZone += DT;
      }
    }
  }
  r.inZone = settled > 0 ? inZone / settled : 0;
  r.meanIntensity = iN ? iSum / iN : 0;
  r.finalIntensity = ctrl.intensity;
  r.endPhase = ctrl.phase;
  console.log(`  in-zone ${pct(r.inZone)} | max bpm ${r.maxBpm} | mean training intensity ${r.meanIntensity.toFixed(2)}`);
  return r;
}

const normal = run('Keeps up with the game, target 120', 120, 1.0);
check(normal.inZone >= 0.8, `in zone >= 80% (got ${pct(normal.inZone)})`);
check(normal.maxBpm < 135, `no big overshoot (max ${normal.maxBpm})`);
check(normal.maxJump <= 0.0201, `intensity never lurches (max ${normal.maxJump.toFixed(3)}/s)`);
check(normal.endPhase === Phase.Finished, 'session reaches Finished');
check(normal.finalIntensity < 0.1, 'cool-down ends easy');

const lazy = run('Lazy player (70% effort), target 120', 120, 0.7);
check(lazy.inZone >= 0.75, `lazy player reaches zone (got ${pct(lazy.inZone)})`);
check(lazy.meanIntensity > normal.meanIntensity, 'game pushes a lazy player harder');

const eager = run('Overdoes it (130% effort), target 120', 120, 1.3);
check(eager.inZone >= 0.75, `eager player held in zone (got ${pct(eager.inZone)})`);
check(eager.meanIntensity < normal.meanIntensity, 'game eases off for an eager player');

const hard = run('Keeps up, target 150', 150, 1.0);
check(hard.inZone >= 0.75, `high target reachable (got ${pct(hard.inZone)})`);

const tires = run('Player tires halfway', 125, 1.0, { complianceAt: (t) => (t < 600 ? 1 : 0.75) });
check(tires.inZone >= 0.7, `adapts when player tires (got ${pct(tires.inZone)})`);

const brake = run('Safety brake, ceiling 140', 120, 1.0, { ceiling: 140, forcedAt: (t) => (t > 300 && t < 420 ? 1 : null) });
check(brake.brakeSeconds > 0, `safety brake engaged (${brake.brakeSeconds.toFixed(0)}s)`);
check(brake.minWhileBraking <= 0.06, `brake drops game to minimum (${brake.minWhileBraking.toFixed(2)})`);

const drop = run('Signal lost for 45 s', 120, 1.0, { lostAt: (t) => t > 500 && t < 545 });
check(drop.noSignalSeconds > 30, `no-signal detected (${drop.noSignalSeconds.toFixed(0)}s)`);
check(drop.inZone >= 0.7, `recovers after dropout (got ${pct(drop.inZone)})`);

console.log('\n== Bluetooth packets (0x2A37) and phone bridge source');
let m = parseHeartRateMeasurement([0x00, 72]);
check(m && m.bpm === 72 && m.hasSkinContact, 'uint8 BPM');
m = parseHeartRateMeasurement([0x01, 0x2c, 0x01]);
check(m && m.bpm === 300, 'uint16 BPM little-endian');
check(!parseHeartRateMeasurement([0x04, 80]).hasSkinContact, 'contact supported, not detected');
check(parseHeartRateMeasurement([0x06, 80]).hasSkinContact, 'contact detected');
m = parseHeartRateMeasurement([0x18, 120, 0x10, 0x00, 0x00, 0x04, 0x00, 0x02]);
check(m && m.energyKj === 16 && m.rrIntervalsSeconds.length === 2 && Math.abs(m.rrIntervalsSeconds[1] - 0.5) < 1e-6, 'energy + RR intervals');
check(parseHeartRateMeasurement(new DataView(new Uint8Array([0x00, 99]).buffer)).bpm === 99, 'DataView input (as Web Bluetooth delivers)');
check(parseHeartRateMeasurement([0x01, 0x50]) === null, 'truncated uint16 rejected');
check(parseHeartRateMeasurement([0x00]) === null, 'too short rejected');

const remote = new RemoteHeartSource();
check(!remote.hasReading, 'no reading before first message');
remote.push(101); remote.tick(0.5);
check(remote.hasReading && remote.currentBpm === 101 && Math.abs(remote.secondsSinceLastReading - 0.5) < 1e-9, 'remote source reports BPM and age');
check(!remote.push(12) && !remote.push(250) && !remote.push(NaN) && remote.currentBpm === 101, 'implausible values rejected');
const ctrl = new ZoneController({ warmUpSeconds: 1, targetBpm: 120 });
for (let i = 0; i < 200; i++) { if (i % 20 === 0) remote.push(120); remote.tick(DT); ctrl.tick(remote, DT); }
check(ctrl.status === Zone.InZone, `controller accepts bridged readings (${ctrl.status})`);
for (let i = 0; i < 400; i++) { remote.tick(DT); ctrl.tick(remote, DT); }
check(ctrl.status === Zone.NoSignal, 'controller notices when the bridge goes quiet');

const { codeFromInput } = await import('../js/link.js?v4');
check(codeFromInput('fkgs5g') === 'FKGS5G', 'bare code, lowercase');
check(codeFromInput(' FK GS-5G ') === 'FKGS5G', 'code with spaces/dashes');
check(codeFromInput('https://cremdelacrimi.github.io/pulsezone/bridge.html?code=FKGS5G') === 'FKGS5G', 'whole bridge link pasted');
check(codeFromInput('https://cremdelacrimi.github.io/pulsezone/') === '', 'link without a code -> empty');

const easy = evaluateDifficulty(0), max = evaluateDifficulty(1);
check(easy.spawnInterval > max.spawnInterval && easy.orbSpeed < max.orbSpeed, 'difficulty monotonic at the ends');
check(evaluateDifficulty(0.2).obstacleChance === 0, 'no walls at low intensity');

console.log('\n== Walls, hands and swing directions');
const standing = 1.7;
const inWall = (type, x, y) => wallHitsHead(wallPolygon(type, standing), x, y);
check(inWall('duck', 0, standing) && !inWall('duck', 0, standing - 0.35), 'duck: standing hits, ducking 35 cm clears');
check(inWall('pillar', 0, standing) && !inWall('pillar', -0.35, standing) && !inWall('pillar', 0.35, standing), 'pillar: centre hits, either side clears');
check(inWall('dodgeLeft', 0, standing) && !inWall('dodgeLeft', -0.3, standing) && inWall('dodgeLeft', 0.3, standing), 'dodge left: only left is open');
check(inWall('dodgeRight', 0, standing) && !inWall('dodgeRight', 0.3, standing), 'dodge right: only right is open');
check(inWall('squatLeft', -0.3, standing) && inWall('squatLeft', 0.3, standing - 0.5) && !inWall('squatLeft', -0.3, standing - 0.5),
  'squat left: must be low AND left');
check(!inWall('squatRight', 0.3, standing - 0.5) && inWall('squatRight', -0.3, standing - 0.5), 'squat right: low and right');
check(pickWallType(0.2) === null && pickWallType(0.31, () => 0.99) === 'duck', 'only ducking unlocked at first');
const seen = new Set();
for (let i = 0; i < 200; i++) seen.add(pickWallType(0.9));
check(seen.size === 6, `all six wall types appear at high intensity (${[...seen].join(', ')})`);
const dLow = evaluateDifficulty(0.2), dHigh = evaluateDifficulty(1);
check(planOrb(-0.3, dLow).hand === 'left' && planOrb(0.3, dLow).hand === 'right' && planOrb(0.3, dLow).swing === null,
  'low intensity: side decides the hand, no swing arrows');
let cross = 0, arrows = 0;
for (let i = 0; i < 1000; i++) { const o = planOrb(0.4, dHigh); if (o.hand === 'left') cross++; if (o.swing) arrows++; }
check(cross > 150 && cross < 350 && arrows > 300 && arrows < 500, `high intensity: some cross-body (${cross}/1000) and arrow orbs (${arrows}/1000)`);
check(swingMatches('up', [0.1, 2, -0.5]) && !swingMatches('up', [0, -1, 0]), 'uppercut must move up');
check(swingMatches('left', [-2, 0.2, -1]) && !swingMatches('left', [0, 0, -3]), 'hook must move sideways; a straight jab fails');
check(swingMatches(null, [0, 0, -1]), 'plain orbs take any punch');
const hz = heatLook('InZone', 120, 120), hc = heatLook('Below', 95, 120), hh = heatLook('Above', 140, 120);
check(hz.flame === 1 && hc.cold === 1 && hh.hyper === 1 && heatLook('Below', 112, 120).cold < 1, 'thermometer looks: frost / flame / hyper');



console.log('\n== Adaptive challenge: activity mix, stuck boost, learning, music tempo');
{
  const count = (opts, n = 4000) => {
    const c = {}; const rng = mulberry32(11); for (let i = 0; i < n; i++) { const k = chooseActivity({ rng, ...opts }); c[k] = (c[k] || 0) + 1; } return c;
  };
  const easy = count({ intensity: 0.05, status: 'Below' });
  check(Object.keys(easy).length === 1 && easy.jab, 'very low intensity: only plain punches');
  const mid = count({ intensity: 0.5, status: 'InZone' });
  check(ACTIVITY_KEYS.every((k) => mid[k] > 0), `mid intensity: every activity appears (${JSON.stringify(mid)})`);
  const gains = { jab: 0.05, low: 0.3, swing: 0.1, duck: 0.3, lateral: 0.2, squatSide: 0.9, trace: 0.15, sweep: 0.3, power: 0.2, pair: 0.35, guard: 0.15 };
  const noBursts = { bag: false, ropes: false };
  const stuck = count({ intensity: 0.9, status: 'Below', boost: 1, gains, enabled: noBursts });
  const normal = count({ intensity: 0.9, status: 'InZone', gains, enabled: noBursts });
  check(stuck.squatSide > normal.squatSide * 1.6 && stuck.jab < normal.jab * 0.6,
    `stuck below zone: far more of what works (side squats ${normal.squatSide}->${stuck.squatSide}, punches ${normal.jab}->${stuck.jab})`);
  const bursts = (c) => (c.bag || 0) + (c.ropes || 0);
  const stuckAll = count({ intensity: 0.9, status: 'Below', boost: 1 }), zoneAll = count({ intensity: 0.9, status: 'InZone' });
  check(bursts(stuckAll) > bursts(zoneAll) * 4, `stuck: speed bag / battle ropes become the main tool (${bursts(zoneAll)}->${bursts(stuckAll)})`);
  const stuckEarly = count({ intensity: 0.2, status: 'Below', boost: 0.6 });
  check(bursts(stuckEarly) > 0 && !bursts(count({ intensity: 0.2, status: 'Below', boost: 0 })), 'bursts open up early only when you are stuck');
  check(!bursts(count({ intensity: 0.9, status: 'Above' })) || bursts(count({ intensity: 0.9, status: 'Above' })) < bursts(zoneAll) * 0.4, 'above the zone: hardly any bursts');
  const above = count({ intensity: 0.9, status: 'Above', gains });
  check(above.jab > normal.jab * 1.3, `above zone: mostly easy punches (${normal.jab}->${above.jab})`);
  check(wallTypeFor('duck') === 'duck' && ['squatLeft', 'squatRight'].includes(wallTypeFor('squatSide')) && wallTypeFor('jab') === null, 'activities map to wall shapes');

  const b = new ChallengeBoost();
  for (let i = 0; i < 20 * 10; i++) b.update(0.1, { status: 'Below', intensity: 0.5, bpmTrend: 0.5 });
  check(b.value === 0, 'boost stays off while heart rate is climbing');
  for (let i = 0; i < 70 * 10; i++) b.update(0.1, { status: 'Below', intensity: 0.95, bpmTrend: 0.0 });
  check(b.value > 0.9, `boost builds when stuck below with game maxed (${b.value.toFixed(2)})`);
  for (let i = 0; i < 20 * 10; i++) b.update(0.1, { status: 'Above', intensity: 0.5, bpmTrend: 0 });
  check(b.value < 0.1, 'boost drops quickly once you are above the zone');
  const bd = boostDifficulty(evaluateDifficulty(1), 1);
  check(bd.spawnInterval < evaluateDifficulty(1).spawnInterval * 0.7, 'boost makes spawns faster');

  // Learning: a synthetic player whose heart responds strongly to side squats and barely to punches.
  // Generated with a slightly different lag than the learner assumes, plus noise.
  const truth = { jab: 0.2, low: 1.0, swing: 0.5, duck: 1.1, lateral: 0.8, squatSide: 2.0, trace: 0.6, sweep: 1.0, power: 0.7, pair: 1.3, bag: 0.3, ropes: 1.5, guard: 0.9 };
  const att = new HeartRateAttribution({ weights: Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 1.0])) });
  const rng = mulberry32(7);
  const tr = Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, 0]));
  let hr = 75, t = 0;
  for (let i = 0; i < 30 * 60 * 10; i++) { // 30 minutes at 10 Hz
    t += 0.1;
    for (const k of ACTIVITY_KEYS) tr[k] *= Math.exp(-0.1 / 45);
    if (rng() < 0.05) { // ~30 reps/min, mix changes every minute
      const m = Math.floor(t / 60) % 4;
      const pool = m === 0 ? ['jab', 'jab', 'jab', 'swing'] : m === 1 ? ['squatSide', 'duck', 'jab'] : m === 2 ? ['lateral', 'low', 'swing'] : ['jab', 'low', 'squatSide', 'lateral'];
      const k = pool[Math.floor(rng() * pool.length)];
      att.record(k, t);
      tr[k] += 60 / 45;
    }
    const goal = 72 + ACTIVITY_KEYS.reduce((s, k) => s + truth[k] * tr[k], 0);
    hr += (goal - hr) * (1 - Math.exp(-0.1 / 15));
    att.update(t, Math.round(hr + (rng() - 0.5) * 4));
  }
  const ranked = att.ranking();
  const rank = ranked.map((r) => r.key);
  check(rank[0] === 'squatSide' && rank.indexOf('jab') >= 4,
    `learns that side squats drive heart rate most and punches least (${ranked.map((r) => `${r.key} ${r.bpmPer10.toFixed(0)}`).join(', ')})`);

  // Flat heart rate despite lots of activity (e.g. a stale reading): estimates must not collapse to zero.
  const flat = new HeartRateAttribution();
  const r2 = mulberry32(3);
  for (let i = 0; i < 10 * 60 * 10; i++) {
    const tt = i / 10;
    if (r2() < 0.1) flat.record(ACTIVITY_KEYS[Math.floor(r2() * 6)], tt);
    flat.update(tt, 100);
  }
  check(flat.ranking().every((r) => r.bpmPer10 > 0.5), `flat heart rate: no activity collapses to zero (${flat.ranking().map((r) => `${r.key} ${r.bpmPer10.toFixed(1)}`).join(', ')})`);

  // Options: switching activities and wall shapes off.
  const onlySome = count({ intensity: 0.9, status: 'Below', enabled: { duck: false, squatSide: false, swing: false } });
  check(!onlySome.duck && !onlySome.squatSide && !onlySome.swing && onlySome.jab && onlySome.lateral && onlySome.trace,
    `disabled activities never appear (${JSON.stringify(onlySome)})`);
  const onlyDucks = count({ intensity: 0.05, status: 'Below', enabled: Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, k === 'duck'])) });
  check(Object.keys(onlyDucks).length === 1 && onlyDucks.duck, `only ducks chosen -> ducks even before they'd normally unlock (${JSON.stringify(onlyDucks)})`);
  check(chooseActivity({ intensity: 0.5, status: 'Below', enabled: Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, false])) }) === 'jab', 'everything off -> falls back to punches');
  const shapes = new Set(); for (let i = 0; i < 300; i++) shapes.add(wallTypeFor('lateral', Math.random, { lean: false, pillar: true }));
  check(shapes.size === 1 && shapes.has('pillar'), 'side steps can be limited to the centre pillar');
  check(wallTypeFor('lateral', Math.random, { lean: false, pillar: false }) === null, 'no side-step shapes allowed -> no wall');
  check(Math.abs(wallDepth('duck', 2) - 2.4) < 1e-9 && wallDepth('pillar', 0.5) === 0.4, 'duck box length = 1.2 s of travel (with a minimum)');
  const tp = tracePath(1.7, mulberry32(4));
  check(tp.length === 5 && tp.every(([x, y]) => Math.abs(x) <= 0.5 && y >= 1.7 - 0.95 && y <= 1.7 - 0.05) && Math.min(...tp.map((p) => p[1])) < 1.45,
    'trace path stays within reach and dips low');
  check(traceSeconds(0) > traceSeconds(1) && tracePoints(1) === 50 && tracePoints(0.5) < 25, 'traces get quicker when hard; accuracy drives points');

  // Looser rope catch: within 20 cm sideways, anywhere within 35 cm in front of/behind the ring, and a wobble doesn't drop you.
  check(onRope(false, 0.18, 0.3) && !onRope(false, 0.22, 0) && onRope(true, 0.24, 0) && !onRope(true, 0.3, 0) && !onRope(false, 0.1, 0.5),
    'rope catch: 20 cm to get on, 27 cm before you drop off, 35 cm of depth either side');
  const sw = sweepPath(1.7, mulberry32(5));
  check(sw.length === 6 && sw.slice(1).every(([x], i) => Math.abs(x) >= 0.35 && Math.sign(x) !== Math.sign(sw[i][0]))
    && Math.min(...sw.map((p) => p[1])) <= 1.1 && sw.every(([x]) => Math.abs(x) + SWEEP_HALF_GAP <= 0.85),
    'two-hand rope sweeps side to side, dips into a squat and stays within reach');
  check(sweepSeconds(0.5) > traceSeconds(0.5), 'two-hand rope lasts a little longer');
  // Stand-up boxes: after a duck or squat box you have to stand tall.
  const rise = wallPolygon('rise', 1.7);
  check(wallFor('stand') === 'rise' && LOW_WALLS.includes('duck') && LOW_WALLS.includes('squatLeft') && !LOW_WALLS.includes('pillar'),
    'squat boxes are followed by a stand-up box');
  check(!wallHitsHead(rise, 0, 1.68) && wallHitsHead(rise, 0, 1.5) && wallHitsHead(rise, 0.4, 1.2), 'stand-up box: hits you if you stay low, clear when standing tall');
  check(!wallHitsHead(wallPolygon('duck', 1.7), 0, 1.35) && !wallHitsHead(rise, 0, 1.6), 'duck then stand: both passable from a normal duck and a normal stance');
  { const seen = new Set(); for (let i = 0; i < 300; i++) seen.add(pickWallType(1)); check(!seen.has('rise'), 'stand-up boxes only come after a squat, never at random'); }

  // Lane timeline: nothing crowds a rope, wall box, pair or guard shot.
  {
    const sp = 3;
    const rope = lanePlan('trace', { now: 0, speed: sp, intensity: 0.5 });
    const lane = [rope];
    check(!laneFree(lane, lanePlan('jab', { now: 0.5, speed: sp })), 'an orb that would arrive during a rope has to wait');
    check(!laneFree(lane, lanePlan('duck', { now: 1, speed: sp, depth: wallDepth('duck', sp * 0.8) })), 'a wall that would arrive during a rope has to wait');
    let t = 0; while (!laneFree(lane, lanePlan('jab', { now: t, speed: sp }))) t += 0.1;
    const orb = lanePlan('jab', { now: t, speed: sp });
    check(orb.start >= rope.end && orb.start - rope.end < 0.2, `the next orb arrives just after the rope (${(orb.start + 0.3 - (rope.end - 0.7)).toFixed(1)} s after its tail)`);
    const orbs = [lanePlan('jab', { now: 0, speed: sp })];
    check(laneFree(orbs, lanePlan('low', { now: 0.4, speed: sp })), 'plain orbs can share the lane');
    check(!laneFree(orbs, lanePlan('power', { now: 0.4, speed: sp })) && !laneFree(orbs, lanePlan('guard', { now: 0.2, speed: sp })),
      'power orbs and guard shots get the lane to themselves');
    const wall = lanePlan('duck', { now: 0, speed: sp, depth: wallDepth('duck', sp * 0.8) });
    check(!laneFree([wall], lanePlan('jab', { now: 0.5, speed: sp })), 'a faster orb sent just after a wall would fly through it, so it waits');
  }

  // Punch quality: wrist flicks don't count, power orbs need a full punch, strength scales feedback.
  check(minPunchTravel(0) < minPunchTravel(1) && minPunchTravel(1) <= 0.25 && minPunchTravel(0.5, true) >= 0.3,
    'a hit needs real fist travel (more when hard, a full punch for power orbs)');
  check(powerPunchSpeed(1.6) > 1.6 && powerPunchSpeed(0.6) >= 2.2, 'power orbs need a faster punch than normal orbs');
  check(punchPower(1, 0.05) < 0.1 && punchPower(5, 0.5) > 0.95 && punchPower(3, 0.3) > punchPower(2, 0.2), 'punch strength grows with speed and travel');
  check(bagPoints(10) === 50 && bagPoints(25) > 25 * 5, 'speed bag: 5 points a hit, bonus for a big flurry');

  check(musicTempo({ intensity: 0.5, status: 'Below', bpm: 100, target: 120 }) > musicTempo({ intensity: 0.5, status: 'InZone', bpm: 120, target: 120 }),
    'music speeds up when you need to pick it up');
  check(musicTempo({ intensity: 0.5, status: 'Above', bpm: 135, target: 120 }) < musicTempo({ intensity: 0.5, status: 'InZone', bpm: 120, target: 120 }) - 15,
    'music slows down when you need to ease off');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
