// Closed-loop workout simulations + Bluetooth parser checks for js/core.js.
// Run:  node test/core.test.mjs     (exit code 0 = all passed)
import {
  SimulatedHeart, SimulatedPlayer, RemoteHeartSource, ZoneController, Phase, Zone,
  evaluateDifficulty, parseHeartRateMeasurement,
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

const easy = evaluateDifficulty(0), max = evaluateDifficulty(1);
check(easy.spawnInterval > max.spawnInterval && easy.orbSpeed < max.orbSpeed, 'difficulty monotonic at the ends');
check(evaluateDifficulty(0.2).duckBarChance === 0, 'no squats at low intensity');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
