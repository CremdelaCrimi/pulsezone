// PulseZone progress logic (v58): what turns single workouts into a habit. Today's named workout,
// a level fed by minutes in your zone, badges, the ghost of your last run and what the recovery
// number means. Like core.js: no DOM, no three.js and no storage. The game loads and saves; these
// functions only read what they are handed, so node test/progress.test.mjs can check every rule.
import { weekStart, weekSummary, WEEK_GOAL, PLAN_SHAPES } from './core.js?v60';

const DAY = 86400000;
const WEEK = 7 * DAY;
// The same floors the rest of the game uses: under 3 minutes of training a workout doesn't count
// (weekly plan, personal bests), and under 6 it is too short for acts or a fair % in zone.
const COUNTED_SECONDS = 180;
const FULL_SECONDS = 360;

// ---------------------------------------------------------------- named workouts

/**
 * A named workout every day (v58; Morty's top gap: "Today: Steady, 15 min" is forgettable, a name
 * is something you keep an appointment with). Same engine underneath: the weekly plan still picks
 * the shape, and the bank dresses it with a name, a world, a music set, a cover colour, one
 * featured move (sent more often that day) and four act titles. Four names per shape, so each one
 * comes round every fourth week.
 * The worlds, music sets and coach clips are built against these rows (the coach has a
 * "Today: <name>" clip per id), so a change here has to be made there too.
 */
const named = (id, name, shape, world, music, colour, feature, acts) =>
  Object.freeze({ id, name, shape, world, music, colour, feature, acts: Object.freeze(acts.split(' / ')) });
const BANK = [
  named('harbour-lights', 'Harbour Lights', 'steady', 'harbour', 'harbour', '#5fd0c5', 'trace', 'Cast Off / Open Water / The Crossing / Home Lights'),
  named('long-road', 'Long Road', 'steady', 'grid', 'night', '#7c9cff', 'hammer', 'First Mile / Cruise / Headwind / Last Mile'),
  named('morning-engine', 'Morning Engine', 'steady', 'dojo', 'harbour', '#ffb36b', 'chop', 'Ignition / Idle Up / Full Steam / Whistle'),
  named('night-shift', 'Night Shift', 'steady', 'reactor', 'night', '#b48cff', 'bag', 'Clock In / The Line / Overtime / Clock Out'),
  named('tide-runner', 'Tide Runner', 'waves', 'harbour', 'storm', '#4db8ff', 'sweep', 'Low Tide / Swell / Breakers / High Tide'),
  named('storm-front', 'Storm Front', 'waves', 'snow', 'storm', '#9fb4ff', 'barrage', 'Still Air / First Gusts / The Squall / Clear Sky'),
  named('canyon-echo', 'Canyon Echo', 'waves', 'dojo', 'harbour', '#ff9a5c', 'pose', 'Trailhead / Switchbacks / The Rim / Echo'),
  named('rolling-hills', 'Rolling Hills', 'waves', 'snow', 'night', '#8fe08a', 'knee', 'Foothills / Crest / Valley / Summit View'),
  named('summit-push', 'Summit Push', 'build', 'snow', 'furnace', '#cfe6ff', 'press', 'Base Camp / The Ridge / Thin Air / The Summit'),
  named('furnace', 'Furnace', 'build', 'reactor', 'furnace', '#ff6a3d', 'ropes', 'Kindling / Stoke / White Heat / Meltdown'),
  named('launch-day', 'Launch Day', 'build', 'grid', 'storm', '#ffd34d', 'heavy', 'Countdown / Ignition / Max Q / Orbit'),
  named('last-round', 'Last Round', 'build', 'dojo', 'furnace', '#ff4f6d', 'swing', 'Bell / Trading Blows / Championship Rounds / Final Bell'),
];
/** { steady: [4], waves: [4], build: [4] }, in the order the weeks rotate through them. */
export const WORKOUT_BANK = Object.freeze(Object.fromEntries(
  PLAN_SHAPES.map((shape) => [shape, Object.freeze(BANK.filter((w) => w.shape === shape))]),
));
/**
 * The restart session (Morty's #10: a missed week becomes a short restart, never a guilt debt).
 * After RESTART_GAP_DAYS away, today is Fresh Start instead of the plan's workout: Steady, about
 * 60% of your usual length and no boss, so coming back is easy to say yes to.
 */
export const RESTART_WORKOUT = Object.freeze({
  ...named('fresh-start', 'Fresh Start', 'steady', 'harbour', 'harbour', '#7cffb0', 'jab', 'Ease In / Find It / Hold It / Done'),
  restart: true,
});
export const RESTART_GAP_DAYS = 7;

// Whole weeks since 1970. A local Monday midnight sits 3.4 to 4.6 days into a 7-day epoch week in
// every time zone, nowhere near the edges, so a daylight-saving hour can't push a week into its
// neighbour.
const weekIndexOf = (now) => Math.floor(weekStart(now) / WEEK);
/**
 * The plan's workout for a week with `done` workouts already behind you. The first three keep
 * that week's names; extras that week (done 3, 4, 5...) borrow the following weeks' names.
 */
function planned(weekIndex, done) {
  const names = WORKOUT_BANK[PLAN_SHAPES[done % PLAN_SHAPES.length]];
  const i = (weekIndex + Math.floor(done / WEEK_GOAL)) % names.length;
  // A headset whose clock has reset to 1 Jan 1970 is in week -1, and -1 % 4 is -1 in JavaScript:
  // wrap it so there is always a workout to show.
  return names[(i + names.length) % names.length];
}
const brief = ({ id, name, shape }) => ({ id, name, shape });

/**
 * Today's workout: the bank entry for this week and this point in it, plus
 * { restart, minutes, boss, n (which workout of the week this is), goal, next: { id, name, shape } }.
 * `log` is the game's week log (see weekSummary in core.js), `minutes` the player's usual length.
 * `next` is what the plan gives once this one is done; after a restart it is the workout the
 * restart stood in for. That is a preview only: a finished restart goes in the log as a workout
 * like any other, so for what really comes next, ask again once it is logged.
 */
export function todayWorkout({ log, now = Date.now(), minutes = 15, bossOn = true } = {}) {
  const at = new Date(now).getTime();
  const week = weekSummary(log, at);
  const weekIndex = weekIndexOf(at);
  const normal = planned(weekIndex, week.done);
  const place = { n: week.done + 1, goal: WEEK_GOAL };
  // Time away is measured from the last workout that counted: a two-minute false start yesterday
  // is not a comeback. A first-ever workout is not one either, so an empty log is never a restart.
  const away = week.last ? at - new Date(week.last.date).getTime() : 0;
  if (away >= RESTART_GAP_DAYS * DAY) {
    return { ...RESTART_WORKOUT, minutes: Math.max(6, Math.round(minutes * 0.6)), boss: false, ...place, next: brief(normal) };
  }
  // THE GUARDIAN guards the week's last planned workout (with the default plan, the Build day).
  const boss = !!bossOn && week.done % WEEK_GOAL === WEEK_GOAL - 1;
  return { ...normal, restart: false, minutes, boss, ...place, next: brief(planned(weekIndex, week.done + 1)) };
}

/**
 * Titles for a workout split into `n` acts (core's actPlan gives 2 to 4): the first n - 1 in
 * order, then always the LAST title, because the last act is always the finale and the last title
 * was written as the ending. [] when there are no acts.
 */
export function actTitles(workout, n) {
  const titles = workout?.acts || [];
  const count = Math.min(Math.floor(n) || 0, titles.length);
  return count < 2 ? [] : [...titles.slice(0, count - 1), titles[titles.length - 1]];
}

// ---------------------------------------------------------------- levels

/**
 * Levels (v58; Morty's #4: a local level curve fed by minutes in zone, not score). Score can be
 * farmed with wrist flicks; time in your zone can only be earned by doing the workout, so that is
 * what levels you up. The curve starts quick (level 2 inside a first decent workout) and each
 * level asks a little more than the one before.
 */
export const levelMinutes = (L) => 4 * (L - 1) + 1.5 * (L - 1) ** 2; // cumulative in-zone minutes to reach level L
/** A title every few levels, so there is a name to grow into between the numbers: [from level, title]. */
export const LEVEL_TITLES = Object.freeze([[1, 'Spark'], [3, 'Ember'], [5, 'Flame'], [8, 'Blaze'], [12, 'Furnace'], [16, 'Reactor'], [20, 'Star']].map(Object.freeze));
const levelSeconds = (L) => Math.round(levelMinutes(L) * 60);
const titleFor = (level) => LEVEL_TITLES.reduce((title, [from, name]) => (level >= from ? name : title), LEVEL_TITLES[0][1]);

/**
 * Where a lifetime total of seconds in zone puts you: `intoSec` of this level's `needSec` are done,
 * and `frac` (0..1) is the bar toward the next level. Levels have no top; the title stays at the
 * last one.
 */
export function levelFor(zoneSeconds) {
  // The total comes out of saved data: junk counts as zero, and the cap (about 30 years in zone)
  // keeps the walk below short whatever was stored.
  const s = Math.min(Math.max(Number(zoneSeconds) || 0, 0), 1e9);
  let level = 1;
  while (levelSeconds(level + 1) <= s) level++;
  const from = levelSeconds(level), needSec = levelSeconds(level + 1) - from;
  return { level, title: titleFor(level), intoSec: s - from, needSec, frac: (s - from) / needSec };
}
/** Did this workout take you up? { from, to, title } (it can be several levels at once), or null. */
export function levelUp(beforeSec, afterSec) {
  const from = levelFor(beforeSec).level, after = levelFor(afterSec);
  return after.level > from ? { from, to: after.level, title: after.title } : null;
}

/**
 * What levels unlock: new colours for the in-zone embers. The exports still say "trail" because
 * the first plan recoloured the fist trails, but those have to stay blue = left and orange = right
 * (the same colours as the orbs each hand hits), and the game already imports these names.
 */
export const TRAIL_UNLOCKS = Object.freeze([
  { level: 1, key: 'ember', name: 'Amber embers', colour: 0xffa040 },
  { level: 3, key: 'gold', name: 'Gold embers', colour: 0xffd34d },
  { level: 6, key: 'violet', name: 'Violet embers', colour: 0xb48cff },
  { level: 10, key: 'aqua', name: 'Aqua embers', colour: 0x4fd1c5 },
  { level: 15, key: 'white', name: 'White-hot embers', colour: 0xf2f5ff },
].map(Object.freeze));
/** The highest colour unlocked at `level` (the first one for anything below level 1, so there always is one). */
export function trailFor(level) {
  let best = TRAIL_UNLOCKS[0];
  for (const t of TRAIL_UNLOCKS) if (level >= t.level) best = t;
  return best;
}
/** The colour this level-up unlocked (the highest, if it crossed more than one), or null. */
export function trailUnlocked(fromLevel, toLevel) {
  const now = trailFor(toLevel);
  return toLevel > fromLevel && now.level > fromLevel ? now : null;
}

// ---------------------------------------------------------------- badges

/**
 * Badges (v58; Morty's #4, Gemini's #8): for real behaviours only, things you did with your heart
 * rate or your week, never raw score. Each row is id, name, hint (how to earn it; the game shows
 * the first one you don't have as the next to go for) and the rule, side by side so the hint
 * can't drift from what is checked. Everything is local.
 * The rules read c = { w, week, bests, heavy, poses, bossWon, restart, perfect, counted, full }
 * (see newBadges).
 */
const BADGE_RULES = [
  ['first', 'First Workout', 'Train for 3 minutes or more', (c) => c.counted],
  ['zone50', 'Half in the Zone', '50% in your zone, training 6 minutes or more', (c) => c.full && c.w.pct >= 50],
  ['zone80', 'Zone Keeper', '80% in your zone, training 6 minutes or more', (c) => c.full && c.w.pct >= 80],
  ['streak2', 'Two-Minute Hold', 'Stay in your zone for 2 minutes without a break', (c) => c.w.streak >= 120],
  ['streak5', 'Five-Minute Hold', 'Stay in your zone for 5 minutes without a break', (c) => c.w.streak >= 300],
  ['landing', 'Perfect Landing', 'Charge, coast and land inside your zone', (c) => c.perfect >= 1],
  ['landing3', 'Triple Landing', '3 perfect landings in one workout', (c) => c.perfect >= 3],
  ['week3', 'Full Week', '3 workouts in one week, Monday to Sunday', (c) => c.week.done >= 3],
  ['weeks2', 'Two Weeks Strong', '3 workouts a week, 2 weeks in a row', (c) => c.week.streak >= 2],
  ['weeks4', 'Four Weeks Strong', '3 workouts a week, 4 weeks in a row', (c) => c.week.streak >= 4],
  ['waves', 'Wave Rider', 'A Waves workout, training 6 minutes or more', (c) => c.full && c.w.profile === 'waves'],
  ['build', 'Peak Climber', 'A Build & peak workout, training 6 minutes or more', (c) => c.full && c.w.profile === 'build'],
  ['boss', 'Guardian Down', 'Bring down the Guardian', (c) => !!c.bossWon],
  ['heavy25', 'Heavy Hitter', '25 heavy hits in one workout', (c) => c.heavy >= 25],
  ['poses10', 'Shape Holder', 'Hold 10 pose walls in one workout', (c) => c.poses >= 10],
  ['recovery20', 'Quick Recovery', 'Drop 20 BPM in the first minute of cool-down', (c) => c.w.recovery >= 20],
  // Worded as "if you missed a week", not as a goal: nobody should skip a week to collect a badge.
  ['comeback', 'Comeback', 'Missed a week? Finish the Fresh Start workout', (c) => !!c.restart && c.counted],
  ['ten', 'Double Digits', 'Finish 10 workouts', (c) => c.bests.workouts >= 10],
  ['hour', 'Golden Hour', '1 hour in your zone, all workouts added up', (c) => c.bests.totalZoneSeconds >= 3600],
];
export const BADGES = Object.freeze(BADGE_RULES.map(([id, name, hint]) => Object.freeze({ id, name, hint })));

/**
 * The badges this workout earned that aren't in `have` yet ({ id: anything truthy }), as
 * [{ id, name }] in BADGES order.
 * ctx = { w, landings, week, bests, heavy, poses, bossWon, restart }: w is the workout summary
 * (pct, inZoneSeconds, trainingSeconds, streak, recovery, profile), landings the list of landing
 * verdicts, week the weekSummary and bests the saved bests, both AFTER this workout was added.
 */
export function newBadges(ctx, have = {}) {
  const { w, landings, week, bests, heavy, poses, bossWon, restart } = ctx || {};
  const seen = have || {}; // nothing saved yet often arrives as null
  const c = {
    w: w || {}, week: week || {}, bests: bests || {}, heavy, poses, bossWon, restart,
    perfect: (landings || []).filter((v) => v === 'perfect').length,
    counted: w?.trainingSeconds >= COUNTED_SECONDS,
    full: w?.trainingSeconds >= FULL_SECONDS,
  };
  return BADGE_RULES.filter(([id, , , earned]) => !seen[id] && earned(c)).map(([id, name]) => ({ id, name }));
}

// ---------------------------------------------------------------- ghost of your last run

/**
 * The ghost (v58; Morty's #6 "race last Tuesday's you", Gemini's #9): time in zone is the one
 * number that is fair to race, so the ghost is your last run of the same shape as a curve of
 * cumulative in-zone seconds. One sample per GHOST_STEP seconds of training keeps a 15-minute run
 * to 90 small numbers in storage.
 */
export const GHOST_STEP = 10;
/**
 * The trace of a finished run from its per-second log rows ({ phase, status }): in-zone seconds so
 * far after every GHOST_STEP seconds of TRAINING. A run that stops between steps gets one last
 * sample holding its total, so the ghost's final score is never short-changed (the price: inside
 * that last stretch ghostAt can read up to GHOST_STEP / 4 seconds low, never high).
 */
export function ghostTrace(rows) {
  const trace = [];
  let secs = 0, inZone = 0;
  for (const r of rows || []) {
    if (r?.phase !== 'Training') continue;
    secs++;
    if (r.status === 'InZone') inZone++;
    if (secs % GHOST_STEP === 0) trace.push(inZone);
  }
  if (secs % GHOST_STEP !== 0) trace.push(inZone);
  return trace;
}
/**
 * The ghost's in-zone seconds at training second `t`: a straight line between samples (from 0 at
 * the start), and flat once its run has ended. null without a trace.
 */
export function ghostAt(trace, t) {
  if (!Array.isArray(trace) || !trace.length) return null;
  const x = Math.max(0, Number(t) || 0) / GHOST_STEP;
  const i = Math.floor(x);
  if (i >= trace.length) return trace[trace.length - 1];
  const before = i > 0 ? trace[i - 1] : 0;
  return before + (trace[i] - before) * (x - i);
}
/** Seconds in zone you are ahead of (+) or behind (-) the ghost at training second `t`; null without a trace. */
export function ghostDelta(trace, t, inZoneNow) {
  const ghost = ghostAt(trace, t);
  return ghost == null ? null : inZoneNow - ghost;
}
/** '+0:12' ahead, '-0:08' behind, '0:00' level (to the nearest second); '' when there is no ghost. */
export function ghostLabel(delta) {
  if (delta == null || !Number.isFinite(delta)) return '';
  const s = Math.round(Math.abs(delta));
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return s === 0 ? text : (delta > 0 ? '+' : '-') + text;
}

// ---------------------------------------------------------------- heart-rate recovery as a story

/**
 * One line that says what today's recovery number means (v58; Morty's #10: interpretation turns
 * the heart-rate graph into a story about fitness improving). Compares this workout's one-minute
 * recovery (a bigger drop is a fitter heart) with the last 30 days of the log, whose entries may
 * carry { date, recovery }:
 * '' without a number, 'first one on record' when the month has none to compare with, 'best this
 * month' when it beats them all, else '+N vs your month' / '-N vs your month' against the month's
 * average ('' when that rounds to no difference).
 * Call it before this workout joins the log, or it gets compared with itself.
 */
export function recoveryStory(log, recovery, now = Date.now()) {
  if (recovery == null || !Number.isFinite(recovery)) return '';
  const at = new Date(now).getTime();
  const month = (log || []).filter((e) => {
    if (!e || !Number.isFinite(e.recovery)) return false;
    const age = at - new Date(e.date).getTime();
    return age >= 0 && age <= 30 * DAY;
  }).map((e) => e.recovery);
  if (!month.length) return 'first one on record';
  if (recovery > Math.max(...month)) return 'best this month';
  const diff = recovery - month.reduce((a, b) => a + b, 0) / month.length;
  const n = Math.round(Math.abs(diff)); // round the size, so +2.5 and -2.5 both read as 3
  return n === 0 ? '' : `${diff > 0 ? '+' : '-'}${n} vs your month`;
}
