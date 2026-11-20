// Knee tracking checks (v61): the detectors fire on made-up motion that looks like the move, and
// stay quiet on motion that doesn't. Real thresholds get checked against Gio's Knee lab file.
import { KNEE, StepCounter, KneeBump, CrunchDetector, KneeLift, headAngles, handsBehindHead, kneeOf } from '../js/kneetrack.js';
import { KneeLab, LAB_STEPS, labSeconds } from '../js/kneelab.js';

let failed = 0, passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? `  (${extra})` : ''}`); };
const DT = 1 / 72;

console.log('== head-bob steps');
{
  const jog = new StepCounter(); let n = 0;
  for (let t = 0; t < 10; t += DT) if (jog.update(1.65 + 0.015 * Math.sin(2 * Math.PI * 2.5 * t), t, DT)) n++; // 2.5 steps/s, 3 cm bounce
  check('a 3 cm bounce at 2.5 steps/s counts about 25 steps in 10 s', n >= 22 && n <= 26, `${n}`);
  check('cadence reads about 150/min', Math.abs(jog.cadence(10) - 150) <= 20, `${jog.cadence(10)}`);
  const still = new StepCounter(); let m = 0;
  for (let t = 0; t < 10; t += DT) if (still.update(1.65 + 0.002 * Math.sin(2 * Math.PI * 0.3 * t) + 0.001 * Math.sin(t * 17), t, DT)) m++;
  check('standing still (sway of a few mm) counts no steps', m === 0, `${m}`);
  const squat = new StepCounter(); let q = 0;
  for (let t = 0; t < 10; t += DT) if (squat.update(1.65 - 0.3 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 0.4 * t)), t, DT)) q++;
  check('slow squats count at most one step each', q <= 5, `${q}`);
}

console.log('== knee bumps');
{
  const pad = { x: 0.17, y: 0.97, z: -0.3 };
  const b = new KneeBump(); let n = 0;
  // Fist rests on the pad; every 0.8 s a knee jolts it up 6 cm in 0.08 s, then it settles back.
  let y = pad.y, prev = y;
  for (let t = 0; t < 8; t += DT) {
    const k = t % 0.8;
    y = pad.y + (k < 0.08 ? 0.06 * (k / 0.08) : k < 0.3 ? 0.06 * (1 - (k - 0.08) / 0.22) : 0);
    const vy = (y - prev) / DT; prev = y;
    if (b.update({ x: pad.x, y, z: pad.z }, pad, vy, t)) n++;
  }
  check('a knee jolting the fist every 0.8 s counts each bump', n >= 9 && n <= 10, `${n}`);
  const off = new KneeBump(); let m = 0; prev = 1.3;
  for (let t = 0; t < 4; t += DT) { const yy = 1.3 + 0.3 * Math.sin(t * 8); const vy = (yy - prev) / DT; prev = yy; if (off.update({ x: 0.17, y: yy, z: -0.3 }, pad, vy, t)) m++; }
  check('punching up away from the pad never counts', m === 0, `${m}`);
  const slow = new KneeBump(); let s = 0; prev = pad.y;
  for (let t = 0; t < 4; t += DT) { const yy = pad.y + 0.05 * Math.sin(t * 2); const vy = (yy - prev) / DT; prev = yy; if (slow.update({ x: pad.x, y: yy, z: pad.z }, pad, vy, t)) s++; }
  check('drifting slowly up and down on the pad never counts', s === 0, `${s}`);
}

console.log('== cross crunch');
{
  const head0 = { x: 0, y: 1.65, z: 0 };
  check('fists by the ears = hands behind the head', handsBehindHead({ x: -0.12, y: 1.6, z: 0.05 }, { x: 0.12, y: 1.6, z: 0.05 }, head0));
  check('fists at the chest are not', !handsBehindHead({ x: -0.12, y: 1.3, z: -0.2 }, { x: 0.12, y: 1.3, z: -0.2 }, head0));
  const c = new CrunchDetector(); const seen = [];
  for (let t = 0; t < 8; t += DT) {
    const k = Math.sin(2 * Math.PI * 0.5 * t); // left crunch, right crunch, every 2 s
    const amt = Math.max(0, Math.abs(k) - 0.3) / 0.7, side = k > 0 ? -1 : 1; // -1 = toward the left
    const head = { x: 0.05 * side * amt, y: 1.65 - 0.12 * amt, z: -0.05 * amt };
    const L = { x: head.x - 0.12, y: head.y - 0.04 + (side < 0 ? 0.05 : -0.1) * amt, z: 0.04 };
    const R = { x: head.x + 0.12, y: head.y - 0.04 + (side < 0 ? -0.1 : 0.05) * amt, z: 0.04 };
    const r = c.update({ head, yaw: 0, roll: 18 * side * amt, L, R, standing: 1.65, t });
    if (r) seen.push(r);
  }
  check('alternating crunches are counted on both sides', c.left >= 3 && c.right >= 3, `L ${c.left} R ${c.right}`);
  check('they alternate (left, right, left...)', seen.every((s, i) => i === 0 || s !== seen[i - 1]), seen.join(','));
  const sq = new CrunchDetector(); let n = 0;
  for (let t = 0; t < 6; t += DT) { const d = 0.3 * (0.5 - 0.5 * Math.cos(t * 2)); const head = { x: 0, y: 1.65 - d, z: 0 };
    if (sq.update({ head, yaw: 0, roll: 0, L: { x: -0.2, y: 1.2 - d, z: -0.3 }, R: { x: 0.2, y: 1.2 - d, z: -0.3 }, standing: 1.65, t })) n++; }
  check('plain squats with hands in front are not crunches', n === 0, `${n}`);
}

console.log('== head angles');
{
  const q = (ax, ay, az, deg) => { const h = (deg * Math.PI) / 360, s = Math.sin(h); return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) }; };
  check('level head = 0, 0, 0', Object.values(headAngles({ x: 0, y: 0, z: 0, w: 1 })).every((v) => Math.abs(v) < 1e-9));
  check('turned 30° left = yaw +30', Math.abs(headAngles(q(0, 1, 0, 30)).yaw - 30) < 1e-6);
  check('looking down 20° = pitch -20', Math.abs(headAngles(q(1, 0, 0, -20)).pitch + 20) < 1e-6);
  check('right ear down 15° = roll +15', Math.abs(headAngles(q(0, 0, 1, -15)).roll - 15) < 1e-6);
}

console.log('== tracked knees');
{
  const lift = new KneeLift(); lift.setBase(0.5); let n = 0;
  for (let t = 0; t < 4; t += DT) if (lift.update(0.5 + 0.25 * Math.max(0, Math.sin(2 * Math.PI * t)))) n++;
  check('a knee joint rising 25 cm once a second counts 4 lifts', n === 4, `${n}`);
  check('the knee comes from a "knee" joint or the lower leg', kneeOf({ 'left-lower-leg': { y: 1 }, 'right-knee': { y: 2 } }, 'left').y === 1 && kneeOf({ 'left-lower-leg': { y: 1 }, 'right-knee': { y: 2 } }, 'right').y === 2);
  check('no leg joints = no knee', kneeOf({ head: { y: 1 } }, 'left') === null);
}

console.log('== the lab runs start to finish (logic only)');
{
  const lab = new KneeLab(null, null); let done = null; lab.onDone = (r) => { done = r; };
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  lab.start({ head: { x: 0, y: 1.65, z: 0 }, quat, standing: 1.65, t: 0 });
  const total = labSeconds(); const kinds = new Set();
  for (let t = 0; t < total + 1; t += DT) {
    const ph = lab.phaseAt(t), key = LAB_STEPS[ph.idx]?.key;
    const bob = key === 'jog' || key === 'high' ? 0.015 * Math.sin(2 * Math.PI * 2.5 * t) : 0;
    const body = { 'left-lower-leg': { x: -0.1, y: 0.5 + (key === 'high' ? 0.25 * Math.max(0, Math.sin(2 * Math.PI * 1.25 * t)) : 0), z: 0 }, 'right-lower-leg': { x: 0.1, y: 0.5, z: 0 } };
    for (const e of lab.update({ t, dt: DT, head: { x: 0, y: 1.65 + bob, z: 0 }, quat, L: { x: -0.3, y: 1.0, z: -0.3 }, R: { x: 0.3, y: 1.0, z: -0.3 }, body })) kinds.add(e.type);
  }
  const s = (k) => done?.steps.find((x) => x.key === k);
  check('the lab finishes and hands over its result', !!done && !lab.active);
  check(`the lab lasts ${labSeconds()} s (5 steps + get-ready)`, labSeconds() === 75);
  check('jog and high knees count steps; standing still does not', s('jog')?.steps > 20 && s('high')?.steps > 20 && s('still')?.steps === 0, `${s('still')?.steps}/${s('jog')?.steps}/${s('high')?.steps}`);
  check('a tracked knee lifting in high knees is counted there', s('high')?.liftL >= 10 && s('jog')?.liftL === 0, `${s('high')?.liftL}`);
  check('body tracking and its leg joints are noted', done?.body.shared && done.body.legJoints.length === 2);
  check('raw motion is recorded every frame with its columns', done?.rows.length > 70 * 70 && done.rows[0].length === done.cols.length, `${done?.rows.length} rows`);
  check('the file stays small enough to send (under 1 MB)', JSON.stringify(done).length < 1e6, `${Math.round(JSON.stringify(done).length / 1024)} KB`);
  check('thresholds travel with the file', done?.thresholds.bumpVy === KNEE.bumpVy);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('SOME CHECKS FAILED'); process.exit(1); }
console.log('ALL CHECKS PASSED');
