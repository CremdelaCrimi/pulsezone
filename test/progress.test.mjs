// Named workouts, levels, badges, the ghost and the recovery story: checks for js/progress.js.
// Run:  node test/progress.test.mjs     (exit code 0 = all passed)
import {
  WORKOUT_BANK, RESTART_WORKOUT, RESTART_GAP_DAYS, todayWorkout, actTitles,
  levelMinutes, LEVEL_TITLES, levelFor, levelUp, TRAIL_UNLOCKS, trailFor, trailUnlocked,
  BADGES, newBadges, GHOST_STEP, ghostTrace, ghostAt, ghostDelta, ghostLabel, recoveryStory,
} from '../js/progress.js';
import { ACTIVITIES, weekStart, weekSummary, WEEK_GOAL, PLAN_SHAPES, summarizeWorkout, updateBests } from '../js/core.js';

let failures = 0;
const check = (ok, what) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DAY = 86400000;
// Local-time dates (never ISO strings with a Z), so the checks hold in any time zone and across
// daylight-saving changes. A day number past the end of the month rolls over, which is what lets
// "Monday + 7 * week + day" walk a calendar.
const D = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// One finished workout as the game logs it (see logWeek in game.js).
const logged = (t, profile = 'steady', trainingSec = 600, extra = {}) => ({
  date: new Date(t).toISOString(), pct: 60, inZoneSec: Math.round(trainingSec * 0.6), trainingSec, profile, landings: 0, ...extra,
});
const brief = ({ id, name, shape }) => ({ id, name, shape });
const bankIndex = (t) => WORKOUT_BANK[t.shape].findIndex((w) => w.id === t.id);

// ---------------------------------------------------------------- the bank

// The "Shared names" rows of docs/V58_BUILD_SPEC.md, pasted as they are: the worlds, music sets
// and coach clips are built against them, so the bank has to match letter for letter.
const SPEC_TABLE = `
| harbour-lights | Harbour Lights | steady | harbour | harbour | #5fd0c5 | trace | Cast Off / Open Water / The Crossing / Home Lights |
| long-road | Long Road | steady | grid | night | #7c9cff | hammer | First Mile / Cruise / Headwind / Last Mile |
| morning-engine | Morning Engine | steady | dojo | harbour | #ffb36b | chop | Ignition / Idle Up / Full Steam / Whistle |
| night-shift | Night Shift | steady | reactor | night | #b48cff | bag | Clock In / The Line / Overtime / Clock Out |
| tide-runner | Tide Runner | waves | harbour | storm | #4db8ff | sweep | Low Tide / Swell / Breakers / High Tide |
| storm-front | Storm Front | waves | snow | storm | #9fb4ff | barrage | Still Air / First Gusts / The Squall / Clear Sky |
| canyon-echo | Canyon Echo | waves | dojo | harbour | #ff9a5c | pose | Trailhead / Switchbacks / The Rim / Echo |
| rolling-hills | Rolling Hills | waves | snow | night | #8fe08a | knee | Foothills / Crest / Valley / Summit View |
| summit-push | Summit Push | build | snow | furnace | #cfe6ff | press | Base Camp / The Ridge / Thin Air / The Summit |
| furnace | Furnace | build | reactor | furnace | #ff6a3d | ropes | Kindling / Stoke / White Heat / Meltdown |
| launch-day | Launch Day | build | grid | storm | #ffd34d | heavy | Countdown / Ignition / Max Q / Orbit |
| last-round | Last Round | build | dojo | furnace | #ff4f6d | swing | Bell / Trading Blows / Championship Rounds / Final Bell |
| fresh-start | Fresh Start (the restart session) | steady | harbour | harbour | #7cffb0 | jab | Ease In / Find It / Hold It / Done |
`;
const spec = SPEC_TABLE.trim().split('\n').map((line) => {
  const [id, name, shape, world, music, colour, feature, acts] = line.split('|').slice(1, -1).map((s) => s.trim());
  return { id, name: name.replace(/ \(.*\)$/, ''), shape, world, music, colour, feature, acts: acts.split(' / ') }; // "(the restart session)" is a note, not part of the name
});
const fields = ({ id, name, shape, world, music, colour, feature, acts }) => ({ id, name, shape, world, music, colour, feature, acts });
const WORLDS = ['grid', 'harbour', 'reactor', 'snow', 'dojo'];
const MUSIC = ['night', 'harbour', 'furnace', 'storm'];

console.log('\n== the workout bank');
{
  const bank = PLAN_SHAPES.flatMap((s) => WORKOUT_BANK[s] || []);
  const all = [...bank, RESTART_WORKOUT];
  check(same(Object.keys(WORKOUT_BANK), PLAN_SHAPES) && PLAN_SHAPES.every((s) => WORKOUT_BANK[s].length === 4) && bank.length === 12, '12 workouts: 4 Steady, 4 Waves, 4 Build');
  check(PLAN_SHAPES.every((s) => WORKOUT_BANK[s].every((w) => w.shape === s)), 'every workout sits under its own shape');
  const off = all.map((w, i) => (same(fields(w), spec[i]) ? null : w.id)).filter(Boolean);
  check(spec.length === 13 && all.length === 13 && off.length === 0, `ids, names, shapes, worlds, music, colours, featured moves and act titles match the spec table, in its order${off.length ? ` (differs: ${off.join(', ')})` : ''}`);
  const keys = new Set(ACTIVITIES.map((a) => a.key));
  const strangers = all.filter((w) => !keys.has(w.feature)).map((w) => `${w.id}: ${w.feature}`);
  check(strangers.length === 0, `every featured move is a real activity key${strangers.length ? ` (not: ${strangers.join(', ')})` : ''}`);
  check(new Set(all.map((w) => w.id)).size === 13 && new Set(all.map((w) => w.name)).size === 13, 'ids and names are unique (the restart included)');
  check(all.every((w) => Array.isArray(w.acts) && w.acts.length === 4 && w.acts.every((t) => typeof t === 'string' && t.trim() === t && t.length > 0)), '4 act titles each');
  check(all.every((w) => WORLDS.includes(w.world) && MUSIC.includes(w.music) && /^#[0-9a-f]{6}$/.test(w.colour)), 'worlds and music sets come from the shared lists; colours are #rrggbb');
  check(RESTART_WORKOUT.id === 'fresh-start' && RESTART_WORKOUT.name === 'Fresh Start' && RESTART_WORKOUT.restart === true && RESTART_WORKOUT.shape === 'steady'
    && !bank.some((w) => w.id === RESTART_WORKOUT.id) && bank.every((w) => !('restart' in w)), 'the restart entry is Fresh Start, marked restart: true, and stays out of the rotation');
  check(RESTART_GAP_DAYS === 7, 'a restart is due after 7 days away');
  check(Object.isFrozen(WORKOUT_BANK) && PLAN_SHAPES.every((s) => Object.isFrozen(WORKOUT_BANK[s])) && all.every((w) => Object.isFrozen(w) && Object.isFrozen(w.acts)), 'the bank is frozen (a caller cannot rename a workout by accident)');
}

// ---------------------------------------------------------------- todayWorkout

console.log('\n== todayWorkout: a simulated month (Mon / Wed / Fri at 18:00)');
{
  check(new Date(D(2026, 11, 2)).getDay() === 1 && WEEK_GOAL === 3, 'the month starts on Monday 2 Nov 2026; the plan is 3 workouts a week');
  const log = [], weeks = [], shapeOfCall = [];
  let coreShape = true, passThrough = true, bossOff = true;
  for (let wk = 0; wk < 5; wk++) {
    const row = [];
    for (const day of [0, 2, 4]) {
      const now = D(2026, 11, 2 + 7 * wk + day, 18);
      const t = todayWorkout({ log, now, minutes: 20 });
      const quiet = todayWorkout({ log, now, minutes: 20, bossOn: false });
      if (t.shape !== weekSummary(log, now).nextShape) coreShape = false;
      if (t.minutes !== 20 || t.restart !== false) passThrough = false;
      if (quiet.boss !== false || !same({ ...quiet, boss: t.boss }, t)) bossOff = false;
      shapeOfCall.push(t.shape);
      row.push(t);
      log.push(logged(now, t.shape));
    }
    weeks.push(row);
  }
  check(weeks.every((r) => same(r.map((t) => t.shape), ['steady', 'waves', 'build'])) && coreShape, `Steady, Waves, Build inside every week, the shape core's weekSummary gives (${shapeOfCall.slice(0, 6).join(' ')} ...)`);
  check(weeks.every((r) => same(r.map((t) => t.n), [1, 2, 3]) && r.every((t) => t.goal === 3)), 'n counts 1, 2, 3 through the week; goal is 3');
  check(passThrough, 'a normal day: restart false and your minutes pass through');
  check(weeks.every((r) => bankIndex(r[0]) >= 0 && new Set(r.map(bankIndex)).size === 1), "a week's three workouts share one row of the bank");
  check(weeks.every((r, i) => i === 0 || bankIndex(r[0]) === (bankIndex(weeks[i - 1][0]) + 1) % 4), `next week rotates to the next names (${weeks.map((r) => r[0].name).join(' > ')})`);
  check(new Set(weeks.slice(0, 4).flat().map((t) => t.id)).size === 12 && same(weeks[4].map((t) => t.id), weeks[0].map((t) => t.id)), 'four weeks use all 12 names once; the fifth week is back to the first names');
  check(same(weeks[2].map((t) => t.id), ['night-shift', 'rolling-hills', 'last-round']), `the week of 16 Nov 2026 is Night Shift / Rolling Hills / Last Round in every time zone (${weeks[2].map((t) => t.name).join(' / ')})`);
  check(weeks.every((r) => same(r.map((t) => t.boss), [false, false, true])), "the boss only guards the week's third workout");
  check(bossOff, 'boss switched off: never a boss, and nothing else changes');
  check(weeks.every((r) => same(r[0].next, brief(r[1])) && same(r[1].next, brief(r[2]))), '`next` inside a week is the workout you get once this one is logged');
  check(weeks.slice(0, 4).every((r, i) => same(r[2].next, brief(weeks[i + 1][0])) && r[2].next.shape === 'steady'), "`next` after the week's third workout is next week's Steady");
  const t = weeks[0][0];
  const want = ['id', 'name', 'shape', 'world', 'music', 'colour', 'feature', 'acts', 'restart', 'minutes', 'boss', 'n', 'goal', 'next'];
  check(same(Object.keys(t).sort(), [...want].sort()) && same(Object.keys(t.next), ['id', 'name', 'shape']), 'the result is the bank entry plus restart, minutes, boss, n, goal and next { id, name, shape }');
  check(same(fields(t), fields(WORKOUT_BANK.steady[bankIndex(t)])) && Object.isFrozen(t.acts) && !Object.isFrozen(t), 'it carries the whole bank entry, as a copy the game may add to');
}

console.log('\n== todayWorkout: names hold all week');
{
  // One workout on Monday evening, then nothing: every later day that week offers the same Waves.
  const log = [logged(D(2026, 11, 2, 18), 'steady')];
  const days = [];
  for (let day = 1; day <= 6; day++) days.push(todayWorkout({ log, now: D(2026, 11, 2 + day, 9) }), todayWorkout({ log, now: D(2026, 11, 2 + day, 23, 30) }));
  check(days.every((t) => t.shape === 'waves' && t.id === days[0].id && t.n === 2 && !t.restart), `Tuesday to Sunday night all offer the same Waves workout (${days[0].name})`);
  const monday = todayWorkout({ log, now: D(2026, 11, 9, 0, 30) });
  check(monday.shape === 'steady' && monday.n === 1 && !monday.restart && bankIndex(monday) === (bankIndex(days[0]) + 1) % 4, `half past midnight on Monday is a new week with the next names (${monday.name})`);
  check(typeof todayWorkout({ log: [] }).id === 'string' && todayWorkout({ log: null }).n === 1 && todayWorkout().minutes === 15, 'defaults: now, 15 minutes, and no log at all is a first workout');
}

console.log('\n== todayWorkout: a whole year of weeks (every daylight-saving change, any time zone)');
{
  check(new Date(D(2026, 1, 5)).getDay() === 1, 'the year starts on Monday 5 Jan 2026');
  let steadyAllWeek = true, rotates = true, prev = null;
  for (let wk = 0; wk < 60; wk++) {
    const ids = new Set();
    for (let day = 0; day < 7; day++) {
      for (const [h, min] of [[0, 30], [12, 0], [23, 30]]) ids.add(todayWorkout({ log: [], now: D(2026, 1, 5 + 7 * wk + day, h, min) }).id);
    }
    const idx = WORKOUT_BANK.steady.findIndex((w) => ids.has(w.id));
    if (ids.size !== 1 || idx < 0) steadyAllWeek = false;
    if (prev != null && idx !== (prev + 1) % 4) rotates = false;
    prev = idx;
  }
  check(steadyAllWeek, 'each of 60 weeks has one name from Monday 00:30 to Sunday 23:30');
  check(rotates, 'and every Monday moves on exactly one name');
  const weekOf = (now) => Math.floor(weekStart(now) / (7 * DAY));
  const k = weekOf(D(2026, 11, 16));
  check(k % 4 === 3 && todayWorkout({ log: [], now: D(2026, 11, 16) }).id === WORKOUT_BANK.steady[3].id, `the name index is whole weeks since 1970 (week ${k}) modulo 4`);
  const unset = todayWorkout({ log: [], now: 0 }), older = todayWorkout({ log: [], now: D(1969, 6, 2) });
  check(unset.id === 'night-shift' && unset.next.id === 'rolling-hills' && bankIndex(older) >= 0 && typeof older.next.name === 'string',
    `a headset clock that has reset to 1 Jan 1970 (week -1) still gets a real workout (${unset.name})`);
}

console.log('\n== todayWorkout: extra workouts in one week keep cycling');
{
  const log = [], got = [];
  for (let i = 0; i < 7; i++) {
    const now = D(2026, 11, 16 + i, 8 + i); // Monday 16 to Sunday 22 Nov 2026, one a day
    const t = todayWorkout({ log, now });
    got.push(t);
    log.push(logged(now, t.shape));
  }
  const k = bankIndex(got[0]);
  check(same(got.map((t) => t.shape), ['steady', 'waves', 'build', 'steady', 'waves', 'build', 'steady']) && same(got.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7]), 'the 4th to 7th workouts go round the shapes again; n keeps counting');
  check(same(got.map(bankIndex), [k, k, k, (k + 1) % 4, (k + 1) % 4, (k + 1) % 4, (k + 2) % 4]), `each lap of extras moves on to the next names (${got.map((t) => t.name).join(' > ')})`);
  check(same(got.map((t) => t.boss), [false, false, true, false, false, true, false]), 'the boss comes back on the 6th (the last of each lap), not on the 4th or 5th');
  check(got.slice(0, 6).every((t, i) => same(t.next, brief(got[i + 1]))), '`next` follows the extras too');
  const monday = todayWorkout({ log, now: D(2026, 11, 23, 9) });
  check(monday.n === 1 && monday.id === got[3].id && !monday.restart, `the Monday after starts the new week at 1 of 3 (${monday.name})`);
}

console.log('\n== todayWorkout: the restart session');
{
  const last = D(2026, 11, 4, 18); // Wednesday 4 Nov 2026, 18:00
  const log = [logged(D(2026, 10, 26, 18), 'steady'), logged(last, 'waves')];
  const at7 = last + RESTART_GAP_DAYS * DAY; // exactly 7 x 24 hours later, whatever the clocks did
  const r = todayWorkout({ log, now: at7 });
  const under = todayWorkout({ log, now: at7 - 1 });
  check(r.restart === true && r.id === 'fresh-start' && same(fields(r), fields(RESTART_WORKOUT)), 'exactly 7 days after the last workout: Fresh Start');
  check(under.restart === false && under.id !== 'fresh-start' && under.shape === 'steady' && under.n === 1, `one millisecond under 7 days: the plan's own workout (${under.name})`);
  check(r.shape === 'steady' && r.boss === false && r.n === 1 && r.goal === 3, 'a restart is Steady, has no boss and is workout 1 of the week');
  check(same(r.next, brief(under)) && same(r.next, brief(todayWorkout({ log: [], now: at7 }))), `after a restart, \`next\` is the workout it replaced (${r.next.name})`);
  check(todayWorkout({ log, now: at7 + 40 * DAY }).restart === true, 'still a restart after a longer break');
  const mins = (m) => todayWorkout({ log, now: at7, minutes: m }).minutes;
  const table = [[15, 9], [20, 12], [25, 15], [30, 18], [12, 7], [11, 7], [10, 6], [8, 6], [5, 6], [60, 36]];
  check(table.every(([m, want]) => mins(m) === want && want === Math.max(6, Math.round(0.6 * m))), `restart minutes = max(6, round(0.6 x)): ${table.map(([m, want]) => `${m} -> ${want}`).join(', ')}`);
  check(todayWorkout({ log, now: at7 }).minutes === 9 && todayWorkout({ log, now: at7 - 1 }).minutes === 15 && todayWorkout({ log, now: at7 - 1, minutes: 22 }).minutes === 22, 'default 15 minutes becomes 9 on a restart; without one, minutes pass through');
  check(todayWorkout({ log: [], now: at7 }).restart === false, 'an empty log is a first workout, not a restart');
  check(todayWorkout({ log: [logged(D(2026, 9, 1), 'steady', 179)], now: at7 }).restart === false, 'a log with only short sessions (under 3 minutes of training) is not a restart either');
  check(todayWorkout({ log: [...log, logged(at7 - DAY, 'steady', 120)], now: at7 }).restart === true, 'a 2-minute session yesterday does not cancel the restart: it is 7 days since a workout that counted');
  check(todayWorkout({ log: [...log, logged(at7 - DAY, 'steady', 180)], now: at7 }).restart === false, 'a 3-minute one does');
  // Not a state the game can reach (the log is in time order), but it pins the rule: a restart never has a boss.
  const jumbled = [logged(at7 - 2 * DAY, 'steady'), logged(at7 - DAY, 'waves'), logged(at7 - 20 * DAY, 'build')];
  const j = todayWorkout({ log: jumbled, now: at7, bossOn: true });
  check(j.restart === true && j.boss === false && j.n === 3 && j.next.shape === 'build', 'no boss on a restart even where the plan had one');
  // What the plan does next: the finished restart is logged as a Steady workout and counts.
  const after = todayWorkout({ log: [...log, logged(at7, 'steady', r.minutes * 60)], now: at7 + DAY });
  check(after.restart === false && after.n === 2 && after.shape === 'waves', `the day after a finished restart the plan carries on (${after.name}, workout 2)`);
}

console.log('\n== actTitles');
{
  const w = WORKOUT_BANK.build[0]; // Summit Push: Base Camp / The Ridge / Thin Air / The Summit
  check(same(actTitles(w, 0), []) && same(actTitles(w, 1), []), 'n = 0 or 1: no acts, no titles');
  check(same(actTitles(w, 2), ['Base Camp', 'The Summit']), `n = 2: the first title, then the finale (${actTitles(w, 2).join(' / ')})`);
  check(same(actTitles(w, 3), ['Base Camp', 'The Ridge', 'The Summit']), `n = 3: the first two, then the finale (${actTitles(w, 3).join(' / ')})`);
  check(same(actTitles(w, 4), ['Base Camp', 'The Ridge', 'Thin Air', 'The Summit']), 'n = 4: all four in order');
  const everyOne = [...PLAN_SHAPES.flatMap((s) => WORKOUT_BANK[s]), RESTART_WORKOUT];
  check(everyOne.every((x) => [2, 3, 4].every((n) => actTitles(x, n).length === n && actTitles(x, n)[n - 1] === x.acts[3] && actTitles(x, n)[0] === x.acts[0])), 'for every workout: n titles, opening with the first and always ending on the last');
  check(same(actTitles(w, 5), w.acts) && same(actTitles(null, 3), []) && same(actTitles({}, 3), []) && actTitles(w, 4) !== w.acts, 'more than 4 acts gets the 4 there are; no workout, no titles');
  check(same(actTitles(todayWorkout({ log: [], now: D(2026, 11, 16) }), 3), ['Clock In', 'The Line', 'Clock Out']), "works on todayWorkout's result");
}

// ---------------------------------------------------------------- levels

console.log('\n== levels');
{
  check(same([1, 2, 3, 4, 5].map(levelMinutes), [0, 5.5, 14, 25.5, 40]), 'levels 1 to 5 start at 0, 5.5, 14, 25.5 and 40 minutes in zone');
  check(same(LEVEL_TITLES, [[1, 'Spark'], [3, 'Ember'], [5, 'Flame'], [8, 'Blaze'], [12, 'Furnace'], [16, 'Reactor'], [20, 'Star']]), 'level titles');
  check(same(levelFor(0), { level: 1, title: 'Spark', intoSec: 0, needSec: 330, frac: 0 }), 'no time in zone yet: level 1, Spark, 0 of 330 s');
  const edges = [[329, 1], [330, 2], [839, 2], [840, 3], [1529, 3], [1530, 4], [2399, 4], [2400, 5]];
  check(edges.every(([s, L]) => levelFor(s).level === L), `just below and at the first thresholds: ${edges.map(([s, L]) => `${s} s = L${L}`).join(', ')}`);
  let exact = true;
  for (let L = 2; L <= 60; L++) {
    const at = levelMinutes(L) * 60, on = levelFor(at);
    if (levelFor(at - 1).level !== L - 1 || on.level !== L || on.intoSec !== 0 || on.frac !== 0) exact = false;
  }
  check(exact, 'every level up to 60 starts on the second levelMinutes says, not one early or late');
  check(same(levelFor(585), { level: 2, title: 'Spark', intoSec: 255, needSec: 510, frac: 0.5 }), 'halfway through level 2: 255 of 510 s, frac 0.5');
  let steps = true, bar = true, last = 1;
  for (let s = 0; s <= 40000; s++) {
    const l = levelFor(s);
    if (l.level < last || l.level > last + 1) steps = false;
    if (!(l.frac >= 0 && l.frac < 1 && l.intoSec >= 0 && l.intoSec < l.needSec && Math.abs(l.frac - l.intoSec / l.needSec) < 1e-12)) bar = false;
    if (!(levelMinutes(l.level) * 60 <= s && s < levelMinutes(l.level + 1) * 60)) steps = false;
    last = l.level;
  }
  check(steps, `levels only ever go up, one at a time, as seconds in zone add up (0 to 40000 s reaches level ${last})`);
  check(bar, 'frac stays in 0..1 and is intoSec / needSec');
  const titles = [[1, 'Spark'], [2, 'Spark'], [3, 'Ember'], [4, 'Ember'], [5, 'Flame'], [7, 'Flame'], [8, 'Blaze'], [11, 'Blaze'], [12, 'Furnace'], [15, 'Furnace'], [16, 'Reactor'], [19, 'Reactor'], [20, 'Star'], [35, 'Star']];
  check(titles.every(([L, title]) => levelFor(levelMinutes(L) * 60).title === title), 'titles change at levels 3, 5, 8, 12, 16 and 20');
  check(levelFor(1e7).level > 20 && levelFor(1e7).title === 'Star', `no top level: the number keeps climbing, the title stays Star (10 million s = level ${levelFor(1e7).level})`);
  check([-5, NaN, undefined, null, 'x'].every((bad) => levelFor(bad).level === 1 && levelFor(bad).frac === 0) && Number.isFinite(levelFor(Infinity).level), 'a junk saved total reads as level 1 (and can never hang the page)');
}

console.log('\n== levelUp');
{
  check(levelUp(0, 329) === null && levelUp(400, 800) === null && levelUp(330, 330) === null, 'no threshold crossed: null');
  check(same(levelUp(100, 330), { from: 1, to: 2, title: 'Spark' }) && same(levelUp(839, 840), { from: 2, to: 3, title: 'Ember' }), 'one level: { from, to, title of the new level }');
  check(same(levelUp(0, 2400), { from: 1, to: 5, title: 'Flame' }) && same(levelUp(300, 900), { from: 1, to: 3, title: 'Ember' }), 'a big workout can take several levels at once');
  check(levelUp(900, 300) === null && levelUp(undefined, 0) === null, 'a total that went down (or was never there) is not a level-up');
}

console.log('\n== ember colours (TRAIL_UNLOCKS)');
{
  check(same(TRAIL_UNLOCKS, [
    { level: 1, key: 'ember', name: 'Amber embers', colour: 0xffa040 },
    { level: 3, key: 'gold', name: 'Gold embers', colour: 0xffd34d },
    { level: 6, key: 'violet', name: 'Violet embers', colour: 0xb48cff },
    { level: 10, key: 'aqua', name: 'Aqua embers', colour: 0x4fd1c5 },
    { level: 15, key: 'white', name: 'White-hot embers', colour: 0xf2f5ff },
  ]), 'the five unlocks: Amber (1), Gold (3), Violet (6), Aqua (10), White-hot (15) embers');
  check(TRAIL_UNLOCKS.every((t) => /embers$/.test(t.name) && !/trail/i.test(t.name)), 'they are named as embers (fist trails keep their left / right colours)');
  const at = [[1, 'ember'], [2, 'ember'], [3, 'gold'], [5, 'gold'], [6, 'violet'], [9, 'violet'], [10, 'aqua'], [14, 'aqua'], [15, 'white'], [99, 'white']];
  check(at.every(([L, key]) => trailFor(L).key === key), `trailFor is the highest one unlocked: ${at.map(([L, key]) => `L${L} ${key}`).join(', ')}`);
  check(trailFor(0) === TRAIL_UNLOCKS[0] && trailFor(undefined) === TRAIL_UNLOCKS[0] && trailFor(levelFor(0).level).colour === 0xffa040, 'there is always a colour (level 1 is the amber the embers have today)');
  check(trailUnlocked(2, 3)?.key === 'gold' && trailUnlocked(5, 6)?.key === 'violet' && trailUnlocked(9, 10)?.key === 'aqua' && trailUnlocked(14, 15)?.key === 'white', 'reaching level 3, 6, 10 or 15 unlocks a colour');
  check(trailUnlocked(1, 2) === null && trailUnlocked(3, 5) === null && trailUnlocked(6, 9) === null && trailUnlocked(15, 30) === null, 'a level-up between them unlocks nothing');
  check(trailUnlocked(1, 3)?.key === 'gold' && trailUnlocked(2, 7)?.key === 'violet' && trailUnlocked(1, 20)?.key === 'white', 'a jump past several gives the highest');
  check(trailUnlocked(3, 3) === null && trailUnlocked(6, 3) === null && trailUnlocked(0, 0) === null, 'no level-up, no unlock');
  const up = levelUp(700, 900);
  check(trailUnlocked(up.from, up.to) === TRAIL_UNLOCKS[1], "works on levelUp's result (level 2 to 3 = Gold embers)");
}

// ---------------------------------------------------------------- badges

console.log('\n== badges');
{
  const IDS = ['first', 'zone50', 'zone80', 'streak2', 'streak5', 'landing', 'landing3', 'week3', 'weeks2', 'weeks4', 'waves', 'build', 'boss', 'heavy25', 'poses10', 'recovery20', 'comeback', 'ten', 'hour'];
  check(same(BADGES.map((b) => b.id), IDS), `the ${IDS.length} badges of the spec, in its order`);
  check(BADGES.every((b) => same(Object.keys(b), ['id', 'name', 'hint']) && [b.name, b.hint].every((s) => typeof s === 'string' && s.trim() === s && s.length > 0)), 'each is { id, name, hint }');
  check(new Set(BADGES.map((b) => b.name)).size === BADGES.length && BADGES.every((b) => b.name.length <= 24 && b.hint.length <= 60 && !b.hint.includes('\n')), 'names are unique and short; hints are one short line');

  // A workout that earns nothing: too short, never near the zone, nothing special happened.
  const nothing = () => ({
    w: { pct: 10, inZoneSeconds: 10, trainingSeconds: 100, streak: 10, recovery: null, profile: 'steady' },
    landings: [], week: { done: 1, streak: 0 }, bests: { workouts: 1, totalZoneSeconds: 10 }, heavy: 0, poses: 0, bossWon: false, restart: false,
  });
  const ctx = (patch) => {
    const c = nothing();
    for (const [k, v] of Object.entries(patch)) c[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...c[k], ...v } : v;
    return c;
  };
  const ids = (c, have) => newBadges(c, have).map((b) => b.id);
  check(same(newBadges(nothing()), []), 'a 100-second false start earns nothing');

  // [badge, what earns it, exactly which badges that workout gets, near misses that must not earn it]
  const W = (w) => ({ w });
  const cases = [
    ['first', W({ trainingSeconds: 180 }), ['first'], [W({ trainingSeconds: 179 })]],
    ['zone50', W({ pct: 50, trainingSeconds: 360 }), ['first', 'zone50'], [W({ pct: 49, trainingSeconds: 360 }), W({ pct: 50, trainingSeconds: 359 })]],
    ['zone80', W({ pct: 80, trainingSeconds: 360 }), ['first', 'zone50', 'zone80'], [W({ pct: 79, trainingSeconds: 360 }), W({ pct: 100, trainingSeconds: 359 })]],
    ['streak2', W({ streak: 120 }), ['streak2'], [W({ streak: 119 })]],
    ['streak5', W({ streak: 300 }), ['streak2', 'streak5'], [W({ streak: 299 })]],
    ['landing', { landings: ['short', 'perfect'] }, ['landing'], [{ landings: ['nearly', 'over', 'short'] }, { landings: [] }]],
    ['landing3', { landings: ['perfect', 'nearly', 'perfect', 'perfect'] }, ['landing', 'landing3'], [{ landings: ['perfect', 'perfect', 'nearly', 'over'] }]],
    ['week3', { week: { done: 3 } }, ['week3'], [{ week: { done: 2 } }]],
    ['weeks2', { week: { streak: 2 } }, ['weeks2'], [{ week: { streak: 1 } }]],
    ['weeks4', { week: { streak: 4 } }, ['weeks2', 'weeks4'], [{ week: { streak: 3 } }]],
    ['waves', W({ profile: 'waves', trainingSeconds: 360 }), ['first', 'waves'], [W({ profile: 'waves', trainingSeconds: 359 }), W({ profile: 'steady', trainingSeconds: 900 }), W({ profile: 'build', trainingSeconds: 900 })]],
    ['build', W({ profile: 'build', trainingSeconds: 360 }), ['first', 'build'], [W({ profile: 'build', trainingSeconds: 359 }), W({ profile: 'steady', trainingSeconds: 900 }), W({ profile: 'waves', trainingSeconds: 900 })]],
    ['boss', { bossWon: true }, ['boss'], [{ bossWon: false }]],
    ['heavy25', { heavy: 25 }, ['heavy25'], [{ heavy: 24 }]],
    ['poses10', { poses: 10 }, ['poses10'], [{ poses: 9 }]],
    ['recovery20', W({ recovery: 20 }), ['recovery20'], [W({ recovery: 19 }), W({ recovery: null })]],
    ['comeback', { restart: true, w: { trainingSeconds: 180 } }, ['first', 'comeback'], [{ restart: false, w: { trainingSeconds: 900 } }, { restart: true, w: { trainingSeconds: 179 } }]],
    ['ten', { bests: { workouts: 10 } }, ['ten'], [{ bests: { workouts: 9 } }]],
    ['hour', { bests: { totalZoneSeconds: 3600 } }, ['hour'], [{ bests: { totalZoneSeconds: 3599 } }]],
  ];
  check(same(cases.map(([id]) => id), IDS), 'the cases below cover every badge');
  for (const [id, earns, exactly, misses] of cases) {
    const got = ids(ctx(earns));
    const leaked = misses.filter((m) => ids(ctx(m)).includes(id));
    check(same(got, exactly) && leaked.length === 0, `${id}: earned at the threshold (${got.join(' + ') || 'nothing'}), not ${misses.length > 1 ? 'by any near miss' : 'just under it'}`);
  }

  const everything = ctx({
    w: { pct: 90, inZoneSeconds: 800, trainingSeconds: 900, streak: 400, recovery: 25, profile: 'waves' },
    landings: ['perfect', 'perfect', 'perfect'], week: { done: 3, streak: 4 }, bests: { workouts: 12, totalZoneSeconds: 5000 }, heavy: 30, poses: 12, bossWon: true, restart: true,
  });
  const all = newBadges(everything);
  check(same(all.map((b) => b.id), IDS.filter((id) => id !== 'build')), 'one workout can earn many at once, listed in BADGES order');
  check(all.every((b) => same(Object.keys(b), ['id', 'name']) && b.name === BADGES.find((x) => x.id === b.id).name), 'each result is { id, name }');
  check(same(ids(everything, { first: '2026-11-02T18:00:00.000Z', zone80: true, hour: 1 }), IDS.filter((id) => !['build', 'first', 'zone80', 'hour'].includes(id))), 'badges already in `have` are skipped');
  check(same(ids(everything, Object.fromEntries(IDS.map((id) => [id, '2026-11-02']))), []) && same(ids(ctx({ w: { profile: 'build', trainingSeconds: 400 } }), { first: 1 }), ['build']), 'nothing new when you have them all; only the new one when you have the rest');
  check(same(ids(everything, null), ids(everything)) && same(ids(everything, undefined), ids(everything)), 'no saved badges yet (null) is the same as none');
  check(same(newBadges({}), []) && same(newBadges(null), []) && same(ids({ w: { trainingSeconds: 200 } }), ['first']), 'missing fields earn nothing instead of throwing');
}

console.log("\n== badges from the game's own numbers (core's summary, bests and week)");
{
  // A 12-minute Waves workout: 100 s to get there, then in the zone to the end; a 22 BPM drop in the cool-down.
  const rows = [];
  for (let t = 0; t < 720; t++) rows.push({ t, phase: 'Training', bpm: t < 100 ? 110 : 140, status: t < 100 ? 'Below' : 'InZone', target: 140 });
  for (let t = 720; t < 840; t++) rows.push({ t, phase: 'CoolDown', bpm: t < 760 ? 140 : 118, status: 'Below', target: 110 });
  const w = { ...summarizeWorkout(rows), profile: 'waves' };
  w.streak = w.inZoneSeconds;
  const bests = updateBests({ workouts: 9, totalZoneSeconds: 3000, pct: 80, score: 0, streak: 0, reactor: 0 }, w).bests;
  const now = D(2026, 11, 20, 19); // Friday of the week of 16 Nov 2026
  const fullWeek = (monday) => [0, 2, 4].map((d, i) => logged(monday + d * DAY + 6 * 3600000, PLAN_SHAPES[i]));
  const log = [...fullWeek(D(2026, 11, 2, 12)), ...fullWeek(D(2026, 11, 9, 12)), ...fullWeek(D(2026, 11, 16, 12))];
  const week = weekSummary(log, now);
  check(w.pct === 86 && w.trainingSeconds === 720 && w.recovery === 22 && bests.workouts === 10 && bests.totalZoneSeconds === 3620 && week.done === 3 && week.streak === 3,
    `core gives: ${w.pct}% of ${w.trainingSeconds} s, recovery ${w.recovery}, ${bests.workouts} workouts, ${bests.totalZoneSeconds} s in zone, week ${week.done}/3, streak ${week.streak}`);
  const got = newBadges({ w, landings: [], week, bests, heavy: 0, poses: 0, bossWon: false, restart: false }).map((b) => b.id);
  check(same(got, ['first', 'zone50', 'zone80', 'streak2', 'streak5', 'week3', 'weeks2', 'waves', 'recovery20', 'ten', 'hour']), `that workout earns: ${got.join(', ')}`);
}

// ---------------------------------------------------------------- ghost

console.log('\n== ghost of your last run');
{
  check(GHOST_STEP === 10, 'one sample per 10 s of training');
  const rows = [];
  const add = (n, phase, inZone) => { for (let i = 0; i < n; i++) rows.push({ t: rows.length, phase, status: inZone(i) ? 'InZone' : 'Below' }); };
  add(30, 'WarmUp', () => true);        // in the zone during warm-up: must not count
  add(10, 'Training', (i) => i >= 6);    // 4 of the first 10 s
  add(10, 'Training', () => true);       // all of the next 10
  add(5, 'Training', (i) => i < 3);      // a partial last step: 3 of 5 s
  add(20, 'CoolDown', () => true);       // nor does the cool-down
  const trace = ghostTrace(rows);
  check(same(trace, [4, 14, 17]), `only Training rows count, and the partial last step becomes a last sample with the total (${trace.join(', ')})`);
  check(trace[trace.length - 1] === summarizeWorkout(rows).inZoneSeconds, "the last sample is the run's time in zone, as the summary counts it");
  check(same(ghostTrace(rows.filter((r) => r.phase !== 'Training' || r.t < 50)), [4, 14]), 'a run that ends on a step gets no extra sample');
  check(same(ghostTrace(rows.filter((r) => r.phase === 'Training').slice(0, 7)), [1]), 'under 10 s of training: one sample');
  check(same(ghostTrace([]), []) && same(ghostTrace(null), []) && same(ghostTrace(rows.filter((r) => r.phase !== 'Training')), []), 'no rows or no training: an empty trace');
  const noisy = [{ phase: 'Training', status: 'Above' }, { phase: 'Training', status: 'SafetyBrake' }, { phase: 'Training', status: 'NoSignal' }, null, { phase: 'Training', status: 'InZone' }];
  check(same(ghostTrace(noisy), [1]), 'only InZone seconds add up (not Above, SafetyBrake or NoSignal)');

  const at = [[0, 0], [5, 2], [10, 4], [15, 9], [20, 14], [25, 15.5], [30, 17]];
  check(at.every(([t, want]) => Math.abs(ghostAt(trace, t) - want) < 1e-9), `ghostAt runs straight between samples, from 0 at the start: ${at.map(([t, want]) => `${t} s = ${want}`).join(', ')}`);
  check(ghostAt(trace, 31) === 17 && ghostAt(trace, 5000) === 17, 'flat once the ghost run has ended');
  check(ghostAt(trace, -20) === 0 && ghostAt(trace, NaN) === 0, 'never before the start');
  check(ghostAt(null, 10) === null && ghostAt([], 10) === null && ghostAt(undefined, 10) === null, 'no trace: null');
  let rises = true;
  for (let t = 0; t <= 40; t += 0.5) if (ghostAt(trace, t + 0.5) < ghostAt(trace, t)) rises = false;
  check(rises, 'the ghost never loses time in zone');

  check(ghostDelta(trace, 15, 12) === 3 && ghostDelta(trace, 15, 5) === -4 && ghostDelta(trace, 20, 14) === 0, 'ghostDelta: + ahead, - behind, 0 level');
  check(ghostDelta(null, 15, 12) === null && ghostDelta([], 15, 12) === null, 'no trace: no delta');
  // Racing yourself: the same run again is level at every sample and at the end.
  let level = true, zone = 0, secs = 0;
  for (const r of rows.filter((x) => x.phase === 'Training')) {
    secs++; if (r.status === 'InZone') zone++;
    if (secs % GHOST_STEP === 0 && ghostDelta(trace, secs, zone) !== 0) level = false;
  }
  check(level && ghostDelta(trace, 30, zone) === 0, 'the same run again is level with its own ghost');
  // The game compares at the run's own last second (25 here), inside the ghost's partial step,
  // where the straight line is still on its way up to the total: a small lead, never a deficit.
  const atEnd = ghostDelta(trace, secs, zone);
  check(secs === 25 && atEnd === 1.5 && atEnd >= 0 && atEnd <= GHOST_STEP / 4, `inside a partial last step the ghost reads at most ${GHOST_STEP / 4} s low (here ${atEnd} s)`);

  const labels = [[12, '+0:12'], [-8, '-0:08'], [0, '0:00'], [0.4, '0:00'], [-0.4, '0:00'], [0.5, '+0:01'], [-0.5, '-0:01'], [59.6, '+1:00'], [75, '+1:15'], [-125, '-2:05'], [600, '+10:00'], [-3725, '-62:05']];
  check(labels.every(([d, want]) => ghostLabel(d) === want), `ghostLabel: ${labels.map(([d, want]) => `${d} = ${want}`).join(', ')}`);
  check(ghostLabel(null) === '' && ghostLabel(undefined) === '' && ghostLabel(NaN) === '' && ghostLabel(ghostDelta(null, 5, 5)) === '', 'no ghost: no label');
  check(ghostLabel(10)[0] === '+' && ghostLabel(-10)[0] === '-' && ghostLabel(-10).slice(1) === '0:10', 'the sign is one plain character in front (the game strips it for spoken lines)');
}

// ---------------------------------------------------------------- recovery story

console.log('\n== recoveryStory');
{
  const now = D(2026, 11, 19, 19);
  const e = (daysAgo, recovery) => ({ date: new Date(now - daysAgo * DAY).toISOString(), pct: 60, trainingSec: 600, profile: 'steady', recovery });
  check(recoveryStory([e(2, 20)], null, now) === '' && recoveryStory([e(2, 20)], undefined, now) === '' && recoveryStory([], NaN, now) === '', 'no recovery number: nothing to say');
  check(recoveryStory([], 22, now) === 'first one on record' && recoveryStory(null, 22, now) === 'first one on record', 'empty log: first one on record');
  check(recoveryStory([e(1, null), { date: e(3).date, pct: 50 }], 22, now) === 'first one on record', 'earlier workouts without a number: still the first on record');
  check(recoveryStory([e(10, 20), e(3, 25)], 26, now) === 'best this month' && recoveryStory([e(3, 25)], 26, now) === 'best this month', 'beats every one of the last 30 days: best this month');
  check(recoveryStory([e(10, 20), e(3, 30)], 28, now) === '+3 vs your month', 'above the 30-day average (25): +3 vs your month');
  check(recoveryStory([e(10, 20), e(3, 30)], 21, now) === '-4 vs your month', 'below it: -4 vs your month');
  check(recoveryStory([e(10, 20), e(3, 30)], 25, now) === '' && recoveryStory([e(3, 22)], 22, now) === '', 'the same as the average: nothing to say');
  check(recoveryStory([e(10, 20), e(3, 30)], 30, now) === '+5 vs your month', 'equalling the best is not beating it: +5 vs your month');
  check(recoveryStory([e(31, 40), e(5, 20)], 25, now) === 'best this month', 'a 40 from 31 days ago is ignored: 25 is the best this month');
  check(recoveryStory([e(31, 40), e(45, 35)], 10, now) === 'first one on record', 'only older entries: reads as the first on record');
  check(recoveryStory([e(31, 40), e(29, 30), e(2, 20)], 22, now) === '-3 vs your month', 'the average is of the last 30 days only (25, not 30)');
  const edge = (ms) => [{ date: new Date(now - 30 * DAY - ms).toISOString(), recovery: 40 }];
  check(recoveryStory(edge(0), 10, now) === '-30 vs your month' && recoveryStory(edge(1), 10, now) === 'first one on record', 'exactly 30 days old still counts; a millisecond older does not');
  check(recoveryStory([{ date: new Date(now + DAY).toISOString(), recovery: 40 }], 10, now) === 'first one on record', 'an entry dated after now (a clock change) is not an earlier one');
  check(recoveryStory([e(10, 20), e(3, 25)], 25, now) === '+3 vs your month' && recoveryStory([e(10, 20), e(3, 25)], 20, now) === '-3 vs your month', 'half a beat rounds away from zero both ways (22.5 average: +3 and -3)');
  check(recoveryStory([e(10, 20), e(3, 21), e(1, 30)], 24, now) === '' && recoveryStory([e(10, 20), e(3, 25)], 22, now) === '-1 vs your month', 'under half a beat from the average says nothing; exactly half reads as 1');
  check(recoveryStory([{ date: new Date(Date.now() - 2 * DAY).toISOString(), recovery: 18 }], 30) === 'best this month', 'now defaults to the present');
  check(recoveryStory([e(2, 15), e(1, 0)], -3, now) === '-11 vs your month', 'a heart rate that rose after training is still a number (-3 against 7.5)');
}

// ---------------------------------------------------------------- player-facing text

console.log('\n== house rules for text');
{
  const now = D(2026, 11, 19, 19);
  const text = [
    ...[...PLAN_SHAPES.flatMap((s) => WORKOUT_BANK[s]), RESTART_WORKOUT].flatMap((w) => [w.name, ...w.acts]),
    ...LEVEL_TITLES.map(([, title]) => title), ...TRAIL_UNLOCKS.map((t) => t.name), ...BADGES.flatMap((b) => [b.name, b.hint]),
    ghostLabel(12), ghostLabel(-8), ghostLabel(0),
    recoveryStory([], 20, now), recoveryStory([{ date: new Date(now - DAY).toISOString(), recovery: 10 }], 20, now),
    recoveryStory([{ date: new Date(now - DAY).toISOString(), recovery: 30 }, { date: new Date(now - 2 * DAY).toISOString(), recovery: 20 }], 28, now),
  ];
  // Figure dash to horizontal bar: the range holds the en and em dashes. Built from code points so
  // this file stays plain ASCII.
  const dashes = new RegExp(`[${String.fromCharCode(0x2012)}-${String.fromCharCode(0x2015)}]`);
  const dashed = text.filter((s) => dashes.test(s));
  check(text.length > 100 && dashed.length === 0, `no em or en dashes in anything a player reads (${text.length} strings)${dashed.length ? `: ${dashed.join(' | ')}` : ''}`);
  check(text.every((s) => typeof s === 'string' && s === s.trim() && !/\s{2,}/.test(s)), 'no stray spaces');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
