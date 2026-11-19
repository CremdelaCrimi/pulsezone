// Guardian (heart-rate boss) checks for js/boss.js.
// Run:  node test/boss.test.mjs     (exit code 0 = all passed)
import { BOSS, newBoss, bossStateFor, bossTick, bossHit, bossLanding, bossSummary } from '../js/boss.js';

let failures = 0;
const check = (ok, what) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const STATUSES = ['NoSignal', 'Below', 'InZone', 'Above', 'SafetyBrake'];
/** A boss already in the given zone status (one zero-length tick, so nothing else moves). */
const bossIn = (status, T = 900) => bossTick(newBoss(T), { status, dt: 0, now: 0 });
/** % per second of credited work, for a block of T seconds. */
const shieldRate = (T) => 100 / (BOSS.shieldShare * T);
const coreRate = (T) => 100 / (BOSS.coreShare * T);

console.log('\n== constants and a new boss');
check(BOSS.shieldShare === 0.42 && BOSS.coreShare === 0.28 && BOSS.graceBelow === 20 && BOSS.regenPerSec === 1 / 3
  && BOSS.activeWindow === 3 && BOSS.perfect === 25 && BOSS.nearly === 10 && BOSS.coreLandingScale === 0.4, 'BOSS numbers are the ones in the spec');
check(JSON.stringify(BOSS.quality) === JSON.stringify({ tap: 0.7, solid: 1, heavy: 1.3 }), 'BOSS.quality: tap 0.7, solid 1, heavy 1.3');
check(Object.isFrozen(BOSS) && Object.isFrozen(BOSS.quality), 'BOSS is frozen (and so is its quality table)');
check(JSON.stringify(newBoss(900)) === JSON.stringify({ shield: 100, core: 100, state: 'guarded', secsBelow: 0, lastHitAt: -99, shieldBrokeAt: null, defeatedAt: null, T: 900 }),
  'newBoss(900): full shield and core, guarded, nothing broken, T = 900');
check(newBoss(360).T === 360 && newBoss('600').T === 600, 'T is the training length it was given');
check([0, -5, NaN, undefined, 'abc'].every((bad) => newBoss(bad).T === 900), 'a missing or impossible length falls back to 15 minutes (never a zero-length fight)');

console.log('\n== states follow the zone status');
check(bossStateFor('Below') === 'guarded', 'Below -> guarded');
check(bossStateFor('InZone') === 'exposed', 'InZone -> exposed');
check(bossStateFor('Above') === 'overheating', 'Above -> overheating');
check(bossStateFor('SafetyBrake') === 'stunned', 'SafetyBrake -> stunned');
check(bossStateFor('NoSignal') === 'paused', 'NoSignal -> paused');
check(['', undefined, null, 'Finished', 'constructor'].every((s) => bossStateFor(s) === 'paused'), 'anything else waits like no signal (paused)');
{
  const b = newBoss(900);
  const seen = STATUSES.map((status) => bossTick(b, { status, dt: 1 / 72, now: 1 }).state);
  check(JSON.stringify(seen) === JSON.stringify(['paused', 'guarded', 'exposed', 'overheating', 'stunned']), 'bossTick sets boss.state from the status every call');
  check(bossTick(b, { status: 'InZone', dt: 0.01, now: 2 }) === b, 'bossTick returns the boss it was given');
}

console.log('\n== no damage unless exposed');
for (const status of STATUSES.filter((s) => s !== 'InZone')) {
  const b = bossIn(status);
  b.shield = 60; b.core = 80; b.lastHitAt = 5;
  const r = bossHit(b, { now: 10, quality: 1.3 });
  check(r === null && b.shield === 60 && b.core === 80 && b.lastHitAt === 5, `${bossStateFor(status)} (${status}): a hit returns null and changes nothing`);
}
{
  const b = bossIn('InZone');
  const r = bossHit(b, { now: 10 });
  check(r !== null && b.shield < 100 && b.core === 100, 'exposed (InZone): the same hit chips the shield');
  check(JSON.stringify(Object.keys(r)) === JSON.stringify(['shield', 'core', 'broke', 'defeated']), 'a hit returns { shield, core, broke, defeated }');
  check(near(r.shield, 100 - b.shield) && r.core === 0 && r.broke === false && r.defeated === false, 'shield / core in the result are the damage this hit dealt');
  check(b.lastHitAt === 10, 'a credited hit sets lastHitAt = now');
  check(bossHit(newBoss(900), { now: 10 }) === null, 'a brand-new boss is guarded until the first tick says otherwise');
  check(bossHit(b, {}) === null && bossHit(b, { now: NaN }) === null && bossHit(null, { now: 1 }) === null, 'a hit without a clock (or without a boss) is refused, not turned into NaN');
}

console.log('\n== shield first, then the core, no spill-over');
{
  const T = 100, b = bossIn('InZone', T);
  b.shield = 1; b.lastHitAt = 0;
  const r = bossHit(b, { now: 3 }); // worth 3 s = 7.1% of shield, far more than the 1% that is left
  check(near(shieldRate(T) * 3, 7.142857142857, 1e-9), `(a 3 s hit is worth ${(shieldRate(T) * 3).toFixed(2)}% of this shield)`);
  check(b.shield === 0 && r.broke === true, 'the hit that empties the shield reports broke');
  check(near(r.shield, 1) && r.core === 0 && b.core === 100, 'what was left over is lost: the core is untouched');
  check(b.shieldBrokeAt === 3, 'shieldBrokeAt records when (the now of that hit)');
  const r2 = bossHit(b, { now: 4 });
  check(near(r2.core, coreRate(T)) && r2.shield === 0 && near(b.core, 100 - coreRate(T)), `with the shield down, 1 s of work takes ${coreRate(T).toFixed(2)}% off the core (the core share)`);
  check(r2.broke === false && r2.defeated === false, 'a core hit is neither a break nor a defeat');
  // The shield creeps back while you are below the zone; breaking it again keeps the first time.
  for (let s = 0; s < 50; s++) bossTick(b, { status: 'Below', dt: 1, now: 5 + s });
  check(near(b.shield, 10), 'below the zone for 50 s: the broken shield creeps back to 10%');
  bossTick(b, { status: 'InZone', dt: 1, now: 56 });
  const before = b.core;
  let again = null, n = 0;
  for (let s = 57; !again?.broke && n < 20; s++, n++) again = bossHit(b, { now: s });
  check(again?.broke === true && b.shield === 0 && b.core === before, 'hits go to the shield first again, and the core waits');
  check(b.shieldBrokeAt === 3, 'shieldBrokeAt keeps the FIRST break');
  b.core = 2;
  const end = bossHit(b, { now: b.lastHitAt + 3 });
  check(end.defeated === true && b.core === 0 && near(end.core, 2) && end.shield === 0, 'the hit that empties the core reports defeated');
  check(b.defeatedAt === b.lastHitAt && typeof b.defeatedAt === 'number', 'defeatedAt records when');
  check(bossHit(b, { now: b.lastHitAt + 1 }) === null && b.core === 0, 'once defeated, hits return null');
}

console.log('\n== the active window: you are paid for time worked, not for the number of hits');
{
  const T = 900, rate = shieldRate(T);
  const longGap = bossIn('InZone', T);
  longGap.lastHitAt = 0;
  const r = bossHit(longGap, { now: 60 });
  check(near(r.shield, rate * BOSS.activeWindow), `one hit after a 60 s gap credits ${BOSS.activeWindow} s, no more (${r.shield.toFixed(3)}%)`);
  const first = bossHit(bossIn('InZone', T), { now: 0.5 });
  check(near(first.shield, rate * BOSS.activeWindow), 'the first hit of a fight is capped the same way');
  const close = bossIn('InZone', T);
  close.lastHitAt = 10;
  check(near(bossHit(close, { now: 11 }).shield, rate * 1), 'hits 1 s apart credit 1 s');
  check(near(bossHit(close, { now: 13.5 }).shield, rate * 2.5), 'hits 2.5 s apart credit 2.5 s');
  check(near(bossHit(close, { now: 18 }).shield, rate * 3), 'hits 4.5 s apart credit 3 s');
  const same = bossHit(close, { now: 18 });
  check(same !== null && same.shield === 0 && same.core === 0, 'a second hit in the same instant is accepted but worth nothing');
  check(bossHit(close, { now: 17 }).shield === 0 && close.lastHitAt === 17, 'a clock that steps back never heals: worth nothing, and the window restarts there');

  const damageAt = (perSecond, seconds = 30) => {
    const b = bossIn('InZone', T);
    b.lastHitAt = 0; // a hit at t = 0, then steady work
    for (let i = 1; i <= perSecond * seconds; i++) bossHit(b, { now: i / perSecond });
    return 100 - b.shield;
  };
  const slow = damageAt(1), fast = damageAt(10);
  check(near(slow, rate * 30, 1e-9), `once a second for 30 s: ${slow.toFixed(3)}% (30 s of work)`);
  check(near(fast, slow, 1e-9), `ten times a second for 30 s does the same total damage (${fast.toFixed(3)}%)`);
  check(near(damageAt(0.5), slow, 1e-9), 'and so does once every 2 s');
  check(damageAt(0.2) < slow * 0.61, 'slower than one rep every 3 s loses credit: the gaps are capped');
  const refused = bossIn('Below', T);
  refused.lastHitAt = 100;
  bossHit(refused, { now: 110 });
  check(refused.lastHitAt === 100, 'a refused hit does not move the window');
}

console.log('\n== quality scales the damage');
{
  const T = 900, rate = shieldRate(T);
  const hitWith = (quality) => {
    const b = bossIn('InZone', T);
    b.lastHitAt = 0;
    return bossHit(b, quality === undefined ? { now: 1 } : { now: 1, quality }).shield;
  };
  check(near(hitWith(undefined), rate), 'no quality given = 1');
  check(near(hitWith(BOSS.quality.tap), rate * 0.7), 'a tap is worth 0.7');
  check(near(hitWith(BOSS.quality.solid), rate), 'a solid hit is worth 1');
  check(near(hitWith(BOSS.quality.heavy), rate * 1.3), 'a heavy hit is worth 1.3');
  check(near(hitWith(0.5), rate * 0.5) && near(hitWith(2), rate * 2), 'any multiplier works (two-hand work passes the slower arm\'s rate)');
  check(near(hitWith('heavy'), rate * 1.3) && near(hitWith('tap'), rate * 0.7), 'tier names work too');
  check(hitWith(0) === 0 && hitWith(-3) === 0, 'zero or negative quality does no damage (and never heals)');
  check(near(hitWith(NaN), rate) && near(hitWith('nonsense'), rate) && near(hitWith(null), rate), 'an unreadable quality counts as a plain rep');
  const core = bossIn('InZone', T);
  core.shield = 0; core.lastHitAt = 0;
  check(near(bossHit(core, { now: 1, quality: 1.3 }).core, coreRate(T) * 1.3), 'quality scales core damage the same way');
}

console.log('\n== the shield creeps back below the zone: slowly, after a grace');
{
  const below = (b, seconds, dt = 1, extra = {}) => {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) bossTick(b, { status: 'Below', dt, now: 0, ...extra });
    return b;
  };
  const hurt = (shield = 50) => Object.assign(newBoss(900), { shield });

  const grace = below(hurt(), 20, 1 / 72);
  check(near(grace.shield, 50, 1e-6), 'nothing in the first 20 s below the zone (frame by frame at 72 Hz)');
  check(near(grace.secsBelow, 20, 1e-6), 'secsBelow counts the time below');
  check(near(below(hurt(), 23).shield, 51, 1e-9), '3 s later: +1%');
  check(near(below(hurt(), 26).shield, 52, 1e-9), '6 s later: +2%');
  const coast = below(hurt(), 45).shield - 50;
  check(coast > 8 && coast <= 9, `a full 45 s coast below the zone regrows ${coast.toFixed(2)}% (at most about 9%)`);
  const minute = below(hurt(), 60).shield - 50;
  check(near(minute, 40 / 3, 1e-9), `a whole minute below undoes ${minute.toFixed(1)}% (about 13%)`);
  const frames = below(hurt(), 45, 1 / 72).shield - 50, oneStep = below(hurt(), 45, 45).shield - 50;
  check(near(frames, coast, 1e-6) && near(oneStep, coast, 1e-9), 'the same whether it is ticked 72 times a second, once a second, or in one 45 s step');
  let worst = 0;
  { const b = hurt(); let last = b.shield; for (let i = 0; i < 300; i++) { bossTick(b, { status: 'Below', dt: 3, now: i * 3 }); worst = Math.max(worst, b.shield - last); last = b.shield; } }
  check(worst <= 1 + 1e-9, `never more than 1% in any 3 s (largest: ${worst.toFixed(3)}%)`);
  check(below(hurt(99.5), 600).shield === 100, 'never above 100');
  check(below(newBoss(900), 600).shield === 100, 'a full shield stays at 100');

  const climbing = below(hurt(), 120, 1, { climbing: true });
  check(climbing.shield === 50 && climbing.secsBelow === 0, 'none while climbing, however long (and the grace does not run)');
  const mixed = hurt();
  below(mixed, 19); below(mixed, 1, 1, { climbing: true }); below(mixed, 19);
  check(mixed.shield === 50 && near(mixed.secsBelow, 19), 'climbing restarts the 20 s grace');
  const left = hurt();
  below(left, 19); bossTick(left, { status: 'InZone', dt: 1, now: 0 });
  check(left.secsBelow === 0, 'leaving the zone status Below resets secsBelow');
  below(left, 20);
  check(left.shield === 50, 'so two short dips never add up to a heal');
  for (const status of ['InZone', 'Above', 'SafetyBrake', 'NoSignal']) {
    const b = hurt();
    below(b, 30);
    const at = b.shield;
    for (let i = 0; i < 120; i++) bossTick(b, { status, dt: 1, now: i });
    check(b.shield === at && b.secsBelow === 0, `${bossStateFor(status)}: frozen, no regrowth in 2 minutes`);
  }
  const beaten = Object.assign(hurt(0), { core: 0, shieldBrokeAt: 500, defeatedAt: 700 });
  check(below(beaten, 300).shield === 0, 'none once it is defeated');
  const odd = hurt();
  below(odd, 30);
  const at = odd.shield, secs = odd.secsBelow;
  for (const dt of [0, -1, NaN, undefined]) bossTick(odd, { status: 'Below', dt, now: 0 });
  check(odd.shield === at && odd.secsBelow === secs, 'a zero, negative or missing dt is ignored');
  check(bossTick(null, { status: 'Below', dt: 1 }) === null, 'no boss, no crash');
}

console.log('\n== landings (charge and coast)');
{
  const b = newBoss(900); // guarded: a landing does not wait for the zone
  const r = bossLanding(b, 'perfect', 120);
  check(b.shield === 75 && JSON.stringify(r) === JSON.stringify({ shield: 25, core: 0, broke: false, defeated: false }), 'PERFECT knocks 25% off the shield (same result shape as a hit)');
  check(bossLanding(b, 'nearly', 200).shield === 10 && b.shield === 65, 'NEARLY knocks 10% off');
  check(b.lastHitAt === -99, 'a landing is not a rep: the hit window is left alone');
  for (const verdict of ['over', 'short', '', undefined, 'PERFECT']) {
    check(bossLanding(b, verdict, 300) === null && b.shield === 65 && b.core === 100, `'${verdict}' does nothing`);
  }
  check(STATUSES.every((status) => bossLanding(bossIn(status), 'perfect', 10)?.shield === 25), 'it lands in every state (a NEARLY is by definition just outside the zone)');
  b.shield = 10;
  const brk = bossLanding(b, 'perfect', 400);
  check(b.shield === 0 && brk.broke === true && brk.shield === 10 && brk.core === 0 && b.core === 100, 'a landing can break the shield; the rest does not spill into the core');
  check(b.shieldBrokeAt === 400, 'and it stamps shieldBrokeAt');
  const onCore = bossLanding(b, 'perfect', 500);
  check(near(onCore.core, BOSS.perfect * BOSS.coreLandingScale) && near(b.core, 90), 'shield down: PERFECT takes 25% x 0.4 = 10% off the core');
  check(near(bossLanding(b, 'nearly', 600).core, 4) && near(b.core, 86), 'shield down: NEARLY takes 10% x 0.4 = 4% off the core');
  b.core = 5;
  const fin = bossLanding(b, 'perfect', 700);
  check(fin.defeated === true && b.core === 0 && b.defeatedAt === 700 && near(fin.core, 5), 'a landing can finish the core (defeatedAt = its time)');
  check(bossLanding(b, 'perfect', 800) === null, 'once defeated, landings return null');
  check(bossLanding(null, 'perfect', 1) === null, 'no boss, no crash');
}

console.log('\n== sizing: a 15-minute training block, second by second');
{
  // `inZone(s)` says whether second s is in the zone. The player lands one scored rep in every
  // in-zone second; outside the zone the status is Below (not climbing), so long dips regrow shield.
  const fight = (inZone, T = 900) => {
    const b = newBoss(T);
    for (let s = 1; s <= T; s++) {
      const zone = inZone(s);
      bossTick(b, { status: zone ? 'InZone' : 'Below', dt: 1, now: s });
      if (zone) bossHit(b, { now: s });
    }
    return b;
  };
  const cycle = (on, off) => (s) => (s - 1) % (on + off) < on;
  const share = (inZone, T = 900) => Array.from({ length: T }, (_, i) => inZone(i + 1)).filter(Boolean).length / T;
  const say = (b) => `shield broke at ${b.shieldBrokeAt == null ? '--' : pct(b.shieldBrokeAt / b.T)}, ${b.defeatedAt == null ? `not defeated (${bossSummary(b).text})` : `defeated at ${pct(b.defeatedAt / b.T)}`}`;

  const always = fight(() => true);
  check(near(always.shieldBrokeAt / 900, BOSS.shieldShare, 0.01) && near(always.defeatedAt / 900, BOSS.shieldShare + BOSS.coreShare, 0.01),
    `in the zone and hitting all the way: ${say(always)} (the two shares)`);

  const seventy = cycle(42, 18); // 42 s in the zone, an 18 s dip (inside the 20 s grace), all workout long
  const b70 = fight(seventy);
  check(near(share(seventy), 0.7, 1e-9), 'the 70% player: in the zone 42 s of every minute');
  check(b70.shieldBrokeAt != null && b70.shieldBrokeAt / 900 > 0.5 && b70.shieldBrokeAt / 900 < 0.66, `breaks the shield at roughly 60% of the workout (${pct(b70.shieldBrokeAt / 900)})`);
  check(b70.defeatedAt != null && b70.defeatedAt / 900 > 0.85 && b70.defeatedAt / 900 <= 1, `and finishes the core near the end (${pct(b70.defeatedAt / 900)}: ${bossSummary(b70).text})`);
  const b70b = fight(cycle(21, 9));
  check(b70b.defeatedAt != null && b70b.shieldBrokeAt / 900 > 0.5 && b70b.shieldBrokeAt / 900 < 0.66 && b70b.defeatedAt / 900 > 0.85, `the same in 21 s / 9 s pieces: ${say(b70b)}`);

  for (const [on, off] of [[15, 15], [30, 30], [45, 45], [90, 90]]) {
    const b = fight(cycle(on, off));
    check(near(share(cycle(on, off)), 0.5, 1e-9) && b.defeatedAt == null, `in the zone only 50% of the time (${on} s on, ${off} s off) does not win: ${say(b)}`);
  }
  const half = fight((s) => s <= 450);
  check(half.defeatedAt == null && half.shieldBrokeAt != null && half.core > 50, `a strong first half, then nothing: ${say(half)}`);
  const idle = fight(() => false);
  check(idle.shield === 100 && idle.core === 100 && idle.shieldBrokeAt == null, 'never in the zone: untouched');

  // Not rules, just how the sizing moves (useful when tuning BOSS): long dips cost shield, slivers of zone time are generous.
  console.log(`  (info) 70% as 70 s in / 30 s out, 10 s of regrowth per dip: ${say(fight(cycle(70, 30)))}`);
  console.log(`  (info) 70% as 7 s in / 3 s out: ${say(fight(cycle(7, 3)))}`);
  console.log(`  (info) 60% as 36 s in / 24 s out: ${say(fight(cycle(36, 24)))}`);
  console.log(`  (info) 80% as 48 s in / 12 s out: ${say(fight(cycle(48, 12)))}`);
  const b6 = fight(cycle(42, 18), 360);
  console.log(`  (info) the 70% player over 6 minutes: ${say(b6)}`);
}

console.log('\n== summary for the end board');
{
  const won = Object.assign(newBoss(900), { shield: 0, core: 0, shieldBrokeAt: 400, defeatedAt: 680 });
  const s = bossSummary(won);
  check(s.defeated === true && s.text === 'GUARDIAN DOWN at 11:20', `defeated at 680 s: "${s.text}"`);
  check(s.shield === 0 && s.core === 0, 'defeated: shield 0, core 0');
  check(bossSummary({ ...won, defeatedAt: 65 }).text === 'GUARDIAN DOWN at 1:05' && bossSummary({ ...won, defeatedAt: 59.9 }).text === 'GUARDIAN DOWN at 0:59', 'time is m:ss (seconds padded, not rounded up)');
  const away = bossSummary(Object.assign(newBoss(900), { shield: 0, core: 35.2, shieldBrokeAt: 500 }));
  check(away.defeated === false && away.text === 'Guardian: shield 0% · core 35% left. It will be back.', `got away: "${away.text}"`);
  check(away.shield === 0 && away.core === 35, 'shield and core left, rounded');
  const fresh = bossSummary(newBoss(900));
  check(fresh.text === 'Guardian: shield 100% · core 100% left. It will be back.' && fresh.shield === 100 && fresh.core === 100, `untouched: "${fresh.text}"`);
  const mid = bossSummary(Object.assign(newBoss(900), { shield: 61.6, core: 100 }));
  check(mid.shield === 62 && mid.text === 'Guardian: shield 62% · core 100% left. It will be back.', 'shield still up: its number is the one that moved');
  const sliver = bossSummary(Object.assign(newBoss(900), { shield: 0, core: 0.2 }));
  check(sliver.core === 1 && sliver.defeated === false, 'a boss still standing never reads "core 0%"');
  check(bossSummary(Object.assign(newBoss(900), { shield: 99.8 })).shield === 99, 'and a dented shield never reads 100%');
  check([s, away, fresh, mid, sliver].every((x) => !/[‒-―]/.test(x.text)), 'no em or en dashes in what the player reads');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
