// VR auto-player for the desktop emulator. It drives the pretend Quest 3 (Meta's IWER) like a real
// player: punches, hooks and hammer fists along the arrows, guards the called zone, ducks and leans
// walls and missiles, does sled reps and pumps the ropes. The game sees ordinary VR input and runs
// its real VR code paths, which ?smoke skips.
//
// Use (local server, Chrome):
//   open  http://localhost:8080/?emulate&warmup=0&minutes=5&cooldown=0
//   then in the console:
//     const bot = await import('/test/xr-bot.js');
//     bot.runChecks();              // about 3 minutes; progress in window.xrReport
//     // or just play along forever:  bot.start()   ...   bot.stop()
//
// Every movement stays on the centre line: leans, ducks and squats only, no steps.

const STAND = 1.6;                                  // emulated eye height (m)
const SWING = { up: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], down: [0, -1, 0] };
const GUARD_POSE = {                                // fist offsets from the head (x right, y up, z toward you)
  high: { left: [-0.09, -0.1, -0.18], right: [0.09, -0.1, -0.18] },
  left: { left: [-0.22, -0.05, -0.1], right: [0.09, -0.1, -0.18] },
  right: { left: [-0.09, -0.1, -0.18], right: [0.22, -0.05, -0.1] },
  body: { left: [-0.12, -0.5, -0.15], right: [0.12, -0.5, -0.15] },
};
const HEAD_SPOTS = [0, -0.3, 0.3, -0.4, 0.4].flatMap((dx) => [0, -0.25, -0.5].map((dy) => [dx, dy])); // leans and ducks, never a step

const pz = window.pz;
let raf = 0, last = 0, clock = 0;
const me = { head: [0, STAND, 0], left: null, right: null, punch: { left: null, right: null }, slamAt: -9 };
export const stats = { punches: 0, swingPunches: {}, guardPoses: 0, sledPushes: 0, ropeTiers: [], wallHits: [] };

// ---------------------------------------------------------------- small vector helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function towards(cur, target, maxStep) { // move at most maxStep metres
  const d = sub(target, cur), l = len(d);
  return l <= maxStep || l === 0 ? target.slice() : add(cur, mul(d, maxStep / l));
}

// ---------------------------------------------------------------- walls & missiles: pick a safe head spot
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function wallBlocks(poly, x, y, r = 0.11) { // the game counts a hit within 9 cm of the head's centre
  if (pointInPoly(x, y, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) < r) return true;
  return false;
}
function safeHead(p, base) {
  const hz = p.head[2];
  const walls = p.walls.filter((w) => !w.hit && (hz - (w.z + w.depth)) / w.speed < 0.5 && w.z <= hz + 0.05);
  const bombs = p.bombs.filter((b) => { const t = (hz - b.at[2]) / b.speed; return b.locked && t > -0.1 && t < 0.7; });
  if (!walls.length && !bombs.length) return base;
  const ok = (x, y) => walls.every((w) => !w.poly || !wallBlocks(w.poly, x - p.centerX, y))
    && bombs.every((b) => Math.hypot(x - b.at[0], y - b.at[1]) > 0.33);
  const spots = HEAD_SPOTS.map(([dx, dy]) => [p.centerX + dx, base[1] + dy]).filter(([x, y]) => ok(x, y));
  if (!spots.length) return base;
  spots.sort((a, b) => Math.hypot(a[0] - base[0], a[1] - base[1]) - Math.hypot(b[0] - base[0], b[1] - base[1]));
  return [spots[0][0], spots[0][1], 0];
}

// ---------------------------------------------------------------- punches along each orb's arrow
function planPunch(p, hand) {
  const hz = p.head[2], strikeZ = hz - 0.45;
  const WIND = 0.15, HOLD = 0.06;
  let best = null;
  for (const o of p.orbs) {
    if (o.hand !== hand) continue;
    const dur = o.power ? 0.09 : 0.13;
    const t = (strikeZ - o.at[2]) / o.speed;          // seconds until it reaches the strike plane
    if (t < WIND + HOLD + dur - 0.04 || t > WIND + HOLD + dur + 0.05) continue;
    if (!best || t < best.t) best = { o, t, dur };
  }
  if (!best) return null;
  const { o, dur } = best;
  if (o.swing) stats.swingPunches[o.swing] = (stats.swingPunches[o.swing] || 0) + 1;
  const end = [o.at[0], o.at[1], strikeZ];
  const dir = o.swing ? SWING[o.swing] : [0, 0, -1];
  const back = o.swing ? 0.38 : 0.42;
  return { start: sub(end, mul(dir, back)), finish: add(end, mul(dir, 0.12)), wind: WIND, hold: HOLD, dur, age: 0, from: null };
}
function stepPunch(pu, cur, dt) {
  if (!pu.from) pu.from = cur.slice();
  pu.age += dt;
  const a = pu.age;
  if (a < pu.wind) return lerp(pu.from, pu.start, a / pu.wind);
  if (a < pu.wind + pu.hold) return pu.start;
  if (a < pu.wind + pu.hold + pu.dur) return lerp(pu.start, pu.finish, (a - pu.wind - pu.hold) / pu.dur);
  return null; // done
}

// ---------------------------------------------------------------- one frame
function tick(ts) {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
  last = ts; clock += dt;
  const dev = pz.xr;
  const p = pz.peek();
  if (!dev || !p.presenting) return;
  const hz = p.head[2];
  const clash = p.stations.length > 0 && !!(p.ropes || p.sled || p.heavy || p.bag); // two things at once: a game bug
  if (clash && !me.clash) stats.clashes = (stats.clashes || 0) + 1;
  me.clash = clash;
  const hitWalls = p.walls.filter((w) => w.hit);
  if (hitWalls.length > (me.hitWalls || 0)) stats.wallHits.push({ type: hitWalls.at(-1).type, head: p.head, centerX: p.centerX, bombs: p.bombs.length });
  me.hitWalls = hitWalls.length;
  const rest = (hand) => [p.head[0] + (hand === 'left' ? -0.2 : 0.2), p.head[1] - 0.3, hz - 0.25];
  if (!me.left) { me.left = rest('left'); me.right = rest('right'); }

  // Head: stand, or squat for the sled / ropes, then dodge walls and missiles.
  let base = [p.centerX, STAND, 0];
  let target = { left: null, right: null };
  if (p.sled && p.sled.age > 1) {
    const c = (p.sled.age % 1.3) / 1.3;
    const push = c >= 0.4 && c < 0.62;
    base[1] = c < 0.4 ? STAND : c < 0.85 ? STAND - 0.3 : STAND;
    for (const hand of ['left', 'right']) {
      const sx = hand === 'left' ? -0.25 : 0.25;
      const up = [p.centerX + sx, STAND + 0.05, hz - 0.3], down = [p.centerX + sx, 0.72, hz + 0.1];
      target[hand] = c < 0.4 ? up : push ? lerp(up, down, (c - 0.4) / 0.22) : c < 0.85 ? down : up;
    }
    if (push && !me.pushed) { stats.sledPushes++; me.pushed = true; }
    if (!push) me.pushed = false;
  } else if (p.ropes && p.ropes.age > 1.2) {
    base[1] = STAND - 0.2;
    const a = p.ropes.age;
    const [A, f] = a < 2.7 ? [0.05, 2.0] : a < 4.2 ? [0.1, 2.2] : a < 5.7 ? [0.18, 2.4] : [0.26, 2.6];
    for (const hand of ['left', 'right']) {
      const ph = hand === 'left' ? 0 : Math.PI;
      target[hand] = [p.centerX + (hand === 'left' ? -0.22 : 0.22), p.standing - 0.72 + A * Math.sin(2 * Math.PI * f * a + ph), hz - 0.42];
    }
    const seg = a < 2.7 ? 0 : a < 4.2 ? 1 : a < 5.7 ? 2 : 3;
    stats.ropeTiers[seg] = Math.max(stats.ropeTiers[seg] ?? 0, p.ropes.tier);
  }
  const st = p.stations.find((x) => x.arrived && !x.done);
  if (st) { // whole-body stations: squat, crunch or rise on your toes as the move needs
    if (st.key === 'knee' && st.stage === 1) base[1] = STAND - 0.09;
    if (st.key === 'press') base[1] = st.stage === 0 ? STAND - 0.33 : STAND;
    if (st.key === 'tiptoe') base[1] = STAND + 0.05;
  }
  // Pose walls (v57): head in the hole, both fists in the rings while the box is close.
  const pose = p.walls.find((w) => w.pose && !w.hit && (hz - (w.z + w.depth)) / w.speed < 0.6 && w.z <= hz + 0.05);
  if (pose) {
    base = [p.centerX + pose.pose.head[0], pose.pose.head[1], 0];
    target.left = [p.centerX + pose.pose.rings[0][0], pose.pose.rings[0][1], hz - 0.3];
    target.right = [p.centerX + pose.pose.rings[1][0], pose.pose.rings[1][1], hz - 0.3];
  }
  const head = safeHead(p, base);
  me.head = towards(me.head, head, 2.6 * dt);

  // Hands: guard if a shot is close, else slam, else punch the orbs.
  if (!target.left && st) {
    const P = st.points;
    if (st.key === 'knee') {
      if (st.stage === 0) { target.left = P.gripL; target.right = P.gripR; }
      else { target.left = [P.gripL[0], me.head[1] - 0.65, P.gripL[2]]; target.right = [P.gripR[0], me.head[1] - 0.65, P.gripR[2]]; }
    } else if (st.key === 'press') {
      if (st.stage === 0) { target.left = add(P.ball, [-0.1, 0, 0.05]); target.right = add(P.ball, [0.1, 0, 0.05]); }
      else { target.left = [p.centerX - 0.12, me.head[1] + 0.3, hz - 0.35]; target.right = [p.centerX + 0.12, me.head[1] + 0.3, hz - 0.35]; }
    } else if (st.key === 'chop') {
      const to = st.stage === 0 ? P.orb : P.hip;
      target.left = add(to, [-0.06, 0, 0]); target.right = add(to, [0.06, 0, 0]);
    } else {
      const hand = P.star[0] < p.centerX ? 'left' : 'right';
      target[hand] = P.star; target[hand === 'left' ? 'right' : 'left'] = rest(hand === 'left' ? 'right' : 'left');
    }
  }
  if (!target.left) {
    const g = p.guards.map((x) => ({ ...x, tta: (x.hitZ - x.z) / x.speed })).filter((x) => x.tta > -0.15 && x.tta < 0.75).sort((a, b) => a.tta - b.tta)[0];
    const slam = p.slams.find((s) => s.at[2] > hz - 0.95 && s.at[2] < hz - 0.2);
    if (g) {
      const pose = GUARD_POSE[g.zone] || GUARD_POSE.high;
      for (const hand of ['left', 'right']) target[hand] = add(me.head, pose[hand]);
      if (!me.guarding) stats.guardPoses++;
      me.guarding = true;
    } else if (slam || clock - me.slamAt < 0.35) {
      if (slam && clock - me.slamAt > 0.6) me.slamAt = clock;
      const k = Math.min(1, (clock - me.slamAt) / 0.14);
      const bar = slam ? slam.at : [p.centerX, p.standing - 0.5, hz - 0.5];
      for (const hand of ['left', 'right']) {
        const sx = hand === 'left' ? -0.22 : 0.22;
        target[hand] = lerp([bar[0] + sx, bar[1] + 0.35, bar[2] + 0.05], [bar[0] + sx, bar[1] - 0.3, bar[2] + 0.05], k);
      }
    } else {
      me.guarding = false;
      for (const hand of ['left', 'right']) {
        if (!me.punch[hand]) { const pu = planPunch(p, hand); if (pu) { me.punch[hand] = pu; stats.punches++; } }
        if (me.punch[hand]) {
          const at = stepPunch(me.punch[hand], me[hand], dt);
          if (at) { target[hand] = at; me[hand] = at; continue; }
          me.punch[hand] = null;
        }
        target[hand] = towards(me[hand], rest(hand), 1.5 * dt);
      }
    }
  }
  for (const hand of ['left', 'right']) {
    const fast = (p.sled && p.sled.age > 1) || (p.ropes && p.ropes.age > 1.2) || clock - me.slamAt < 0.35;
    me[hand] = fast ? target[hand] : towards(me[hand], target[hand], 3.5 * dt);
  }

  dev.position.set(me.head[0], me.head[1], me.head[2]);
  dev.controllers.left.position.set(...me.left);
  dev.controllers.right.position.set(...me.right);
}

export function start() {
  if (!pz?.xr) throw new Error('Open the game with ?emulate first');
  if (!pz.peek().presenting) pz.enterVR();
  if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
}
export function stop() { cancelAnimationFrame(raf); raf = 0; }

// ---------------------------------------------------------------- a scripted run with a report
const COUNTERS = ['score', 'hits', 'perfect', 'misses', 'wrong', 'weak', 'blocks', 'guardsMissed', 'wallHits', 'dodges', 'bombHits', 'bombDodges'];
const snap = () => Object.fromEntries(COUNTERS.map((k) => [k, pz.state[k]]));
const diff = (a, b) => Object.fromEntries(COUNTERS.map((k) => [k, b[k] - a[k]]).filter(([, v]) => v));
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
async function waitFor(cond, timeout) { const t0 = performance.now(); while (!cond() && performance.now() - t0 < timeout * 1000) await wait(0.1); return cond(); }

export async function runChecks() {
  const report = window.xrReport = { done: false, steps: [], errors: [] };
  addEventListener('error', (e) => report.errors.push(String(e.message)));
  start();
  await waitFor(() => pz.peek().presenting, 5);
  await wait(1.5);
  const step = async (name, act, seconds, extra) => {
    const before = snap();
    if (act) pz.act(act);
    if (name === 'sled') await waitFor(() => pz.peek().sled, 25);
    if (name === 'ropes') { stats.ropeTiers = []; await waitFor(() => pz.peek().ropes, 25); }
    let sledReps = 0, stationReps = 0, stationNeed = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000) { const pk = pz.peek(); const s = pk.sled; if (s) sledReps = Math.max(sledReps, s.strokes); for (const x of pk.stations) if (x.key === name) { stationReps = Math.max(stationReps, x.reps); stationNeed = x.need; } await wait(0.1); }
    const row = { name, ...diff(before, snap()), ...(extra ? extra(sledReps) : {}), ...(stationNeed ? { reps: `${stationReps}/${stationNeed}` } : {}) };
    report.steps.push(row);
    return row;
  };
  await step('free play', null, 25);
  await step('guard', 'test-guard', 8);
  await step('guard 2', 'test-guard', 8);
  await step('hammer', 'test-hammer', 7);
  await step('walls', 'test-wall', 7);
  await step('walls 2', 'test-wall', 7);
  await step('missiles', 'test-barrage', 9);
  await step('sled', 'test-sled', 10, (reps) => ({ sledReps: reps, sledPushes: stats.sledPushes }));
  await step('ropes', 'test-ropes', 8, () => ({ ropeTiersBySegment: stats.ropeTiers.slice() }));
  await step('combo', 'test-combo', 9);
  for (const k of ['knee', 'press', 'chop', 'tiptoe', 'knee', 'chop']) await step(k, `test-${k}`, k === 'press' ? 38 : 17); // a wall-ball round lasts 20-30 s
  // The Guardian (v58): it arrives, and the bot's hits chip its shield whenever the heart rate is in the zone.
  await step('guardian', 'test-boss', 20, () => ({ boss: pz.state.boss, today: pz.state.today }));
  // Charge & coast: the charge (a wall-ball round) then the coast and the landing call.
  await step('charge', 'test-charge', 80, () => ({ events: pz.peek().keyEvents, boss: pz.state.boss }));
  report.total = snap();
  report.clashes = stats.clashes || 0; // a station and a burst at the same time
  report.done = true;
  return report;
}
